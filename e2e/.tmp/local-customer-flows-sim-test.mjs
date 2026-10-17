// ============================================================================
//  local-customer-flows-sim-test.mjs — 本机模拟三类客户激活全流程（mock KV，零网络）
//
//  2026-10-14 P3（buildActivationPayload 请求体收口）后回归：
//    A 淘宝云端客户（预置 cloud 码 claim → 自动开通）：自设密码/随机密码/pro/旧客户端
//    B 淘宝离线客户（预置 offline 码 99/299）：桌面 desktop / APP app / pro 299
//    C 免费客户（claim-free）：首领/重领幂等/无手机号/4 类错误输入
//    D 试用客户：trial 码 claim（不自动开通/不发邀请）+ 硬件证明 challenge/register
//    E P3 契约：从 offline.js/cloud.js 抽真身 buildActivationPayload 造 body，
//      直喂 claim 门面 onRequest，端到端 200
//
//  用法: node e2e/.tmp/local-customer-flows-sim-test.mjs   （退出码 0=全过）
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRequest as claimFacade } from '../../functions/api/license/claim.js';
import { onRequest as freeOnRequest } from '../../functions/api/license/claim-free.js';
import { onRequest as attOnRequest } from '../../functions/api/license/attestation/register.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..', '..');
const CLAIM_URL = 'https://tcm-prescription-system.pages.dev/api/license/claim';
const FREE_URL = 'https://tcm-prescription-system.pages.dev/api/license/claim-free';
const ATT_URL = 'https://tcm-prescription-system.pages.dev/api/license/attestation/register';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log('  PASS  ' + name); pass++; }
    else { console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); fail++; }
};

// —— 唯一种子生成（避开限流/占用）——
let _ip = 1;
const nextIp = () => '10.7.' + Math.floor(_ip / 254) + '.' + (++_ip % 254);
let _phoneTail = 10000000;
const nextPhone = () => '139' + String(++_phoneTail);
let _midN = 0;
const nextMid = (tag) => 'mid-sim-' + tag + '-' + String(++_midN).padStart(4, '0');
// 激活码：commitTaobaoCloudAuto 码正则只允许 A-HJ-NP-Z2-9（无 I/O/0/1）
const CODE_ALPHA = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 30 字符（无 0/1/I/O）
let _codeN = 0;
const nextCode = () => {
    const n = ++_codeN;
    const enc = (v) => {
        let s = '';
        for (let i = 0; i < 4; i++) { s = CODE_ALPHA[v % 30] + s; v = Math.floor(v / 30); }
        return s;
    };
    return `BNZC-${enc(n)}-${enc(n + 10000)}-${enc(n + 20000)}-${enc(n + 30000)}`;
};

// —— mock KV（put 接受第三参 expirationTtl，mock 忽略）——
function makeKV(seed = {}) {
    const m = new Map(Object.entries(seed));
    return {
        _m: m,
        async get(k, type) {
            if (!m.has(k)) return null;
            const v = m.get(k);
            return type === 'json' ? (typeof v === 'string' ? JSON.parse(v) : v) : v;
        },
        async put(k, v) { m.set(k, v); },
        async delete(k) { m.delete(k); },
        async list(o = {}) {
            const p = o.prefix || '';
            return { keys: [...m.keys()].filter(k => k.startsWith(p)).map(name => ({ name })), list_complete: true };
        }
    };
}
const clinicsOf = (kv) => JSON.parse(kv._m.get('system:clinics') || '[]');
const adminReqsOf = (kv) => [...kv._m.keys()]
    .filter(k => k.startsWith('admin_req:')).map(k => JSON.parse(kv._m.get(k)));

function postCtx(kv, url, bodyObj, ip, waitUntil) {
    return {
        env: { KV: kv },
        waitUntil: typeof waitUntil === 'function' ? waitUntil : (() => {}),
        request: new Request(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
            body: JSON.stringify(bodyObj)
        })
    };
}
async function callOn(handler, kv, url, bodyObj, opts = {}) {
    const res = await handler(postCtx(kv, url, bodyObj, opts.ip || nextIp(), opts.waitUntil));
    let body = null;
    try { body = await res.json(); } catch (_) {}
    return { status: res.status, body };
}

// 淘宝预置码记录（productClass 即"码记录锁端"硬证据）
function presetRecord(code, over = {}) {
    return Object.assign({
        code, user: '淘宝买家', phone: '', type: 'personal', status: 'unused',
        days: 365, expiresAt: null, issuedAt: '2026-10-01T00:00:00.000Z',
        maxDevices: 1, clinicName: null, devices: [], note: '模拟备货码'
    }, over);
}
// 捕获 waitUntil 后台任务
function captureJobs() {
    const jobs = [];
    return { waitUntil: (p) => { jobs.push(p); }, jobs, flush: () => Promise.all(jobs) };
}
// 自动开通后的统一台账断言（唯一诊所 + 唯一 admin_req）
function assertAutoProvisioned(ok, kv, expect) {
    const clinics = clinicsOf(kv);
    ok('★ 自动开通：建成且仅建成 1 个诊所', clinics.length === 1, JSON.stringify(clinics.map(c => c.id)));
    const clinic = clinics[0] || {};
    ok('★ 诊所 edition=' + expect.edition, clinic.edition === expect.edition, String(clinic.edition));
    ok('诊所 status=active', clinic.status === 'active');
    ok('诊所 source=activation', clinic.source === 'activation');
    ok('诊所有效期 ≈ 365 天后',
        Math.abs(Date.parse(clinic.expiresAt) - (Date.now() + 365 * 86400000)) < 60000,
        String(clinic.expiresAt));
    if (expect.carrier) {
        ok('★ 离线诊所 offlineCarrier=' + expect.carrier,
            clinic.offlineCarrier === expect.carrier, String(clinic.offlineCarrier));
    } else {
        ok('★ 云端诊所不写 offlineCarrier', !('offlineCarrier' in clinic), String(clinic.offlineCarrier));
    }
    const reqs = adminReqsOf(kv);
    ok('★ admin_req 台账恰好 1 条', reqs.length === 1, String(reqs.length));
    const r = reqs[0] || {};
    ok('★ orderSource=' + expect.orderSource, r.orderSource === expect.orderSource, String(r.orderSource));
    ok('resolvedBy=' + expect.resolvedBy, r.resolvedBy === expect.resolvedBy, String(r.resolvedBy));
    ok('appMode=' + expect.appMode, r.appMode === expect.appMode, String(r.appMode));
    ok('台账 edition=' + expect.recordEdition, r.edition === expect.recordEdition, String(r.edition));
    ok('台账 status=activated', r.status === 'activated', String(r.status));
    ok('台账 machineId 落库', r.machineId === expect.machineId, String(r.machineId));
    if (expect.carrier) {
        ok('★ 台账 appModeCarrier=' + expect.carrier, r.appModeCarrier === expect.carrier, String(r.appModeCarrier));
    }
    ok('licenseBase64 已回填台账', typeof r.licenseBase64 === 'string' && r.licenseBase64.length > 20,
        'len=' + String(r.licenseBase64 || '').length);
    // 诊所用户行
    const users = JSON.parse(kv._m.get(`clinic:${clinic.id}:users`) || '[]');
    ok('诊所下建成 1 个账号', users.length === 1, String(users.length));
    const u = users[0] || {};
    ok('账号角色 clinic_admin（首个管理员）', u.role === 'clinic_admin', String(u.role));
    ok('账号 username=手机号', u.username === expect.phone, String(u.username));
    ok('pwdMode=' + expect.pwdMode, r.pwdMode === expect.pwdMode, String(r.pwdMode));
    if (expect.pwdMode === 'random') {
        ok('随机密码：账号带 mustChangePassword', u.mustChangePassword === true);
        ok('随机密码：密码哈希已落库（非 admin 固定哈希场景）', !!u.passwordHash && !!u.salt);
    } else if (expect.pwdMode === 'selfset') {
        ok('自设密码：密码哈希已落库', !!u.passwordHash && !!u.salt);
        ok('自设密码：不带 mustChangePassword', u.mustChangePassword !== true);
    } else {
        ok('旧客户端：不带 mustChangePassword', u.mustChangePassword !== true);
    }
    return { clinic, req: r, user: u };
}

// ============================================================================
// A 组：淘宝云端客户（预置 cloud 码，claim 门面端到端）
// ============================================================================
console.log('=== A) 淘宝云端客户：预置云端码 claim 自动开通 ===');

// ---- A1 personal + 自设密码（pwdCap v2 + password）→ waitUntil 后台开通 ----
console.log('--- A1) 云端 personal + 买家自设密码（异步开通）---');
{
    const CODE = nextCode(), MID = nextMid('ca'), PHONE = nextPhone();
    const kv = makeKV({ [`license:${CODE}`]: JSON.stringify(presetRecord(CODE, { productClass: 'cloud' })) });
    const cap = captureJobs();
    const r = await callOn(claimFacade, kv, CLAIM_URL, {
        code: CODE, machineId: MID, user: PHONE, phone: PHONE,
        productClass: 'cloud', clientClass: 'desktop', pwdCap: 'v2', password: 'Abcd1234'
    }, { waitUntil: cap.waitUntil });
    ok('响应 200 success', r.status === 200 && r.body && r.body.success === true,
        r.status + ' ' + JSON.stringify(r.body && r.body.error));
    ok('响应带回 license', !!(r.body && r.body.license));
    ok('licenseInfo.type=personal', r.body && r.body.licenseInfo.type === 'personal');
    ok('自设密码响应不下发 initialPassword', r.body && !r.body.initialPassword);
    ok('identitySource=taobao-auto', r.body && r.body.identitySource === 'taobao-auto');
    ok('★ 开通走 waitUntil（不阻塞响应）', cap.jobs.length === 1, String(cap.jobs.length));
    await cap.flush();
    assertAutoProvisioned(ok, kv, {
        edition: 'cloud_personal', orderSource: 'taobao-cloud-auto', resolvedBy: 'system:taobao-cloud-auto',
        appMode: 'cloud', recordEdition: 'personal', pwdMode: 'selfset', carrier: '', machineId: MID, phone: PHONE
    });
}

// ---- A2 personal + 留空密码 → 同步返回随机初始密码 ----
console.log('--- A2) 云端 personal + 留空密码（同步开通+一次性随机密码）---');
{
    const CODE = nextCode(), MID = nextMid('ca'), PHONE = nextPhone();
    const kv = makeKV({ [`license:${CODE}`]: JSON.stringify(presetRecord(CODE, { productClass: 'cloud' })) });
    const cap = captureJobs();
    const r = await callOn(claimFacade, kv, CLAIM_URL, {
        code: CODE, machineId: MID, user: PHONE, phone: PHONE,
        productClass: 'cloud', clientClass: 'desktop', pwdCap: 'v2'
    }, { waitUntil: cap.waitUntil });
    ok('响应 200 success', r.status === 200 && r.body && r.body.success === true,
        r.status + ' ' + JSON.stringify(r.body && r.body.error));
    ok('★ 一次性随机初始密码随响应下发（>=8 位）',
        !!(r.body && r.body.initialPassword && /^[A-Za-z0-9]{8,}$/.test(r.body.initialPassword)),
        JSON.stringify(r.body && r.body.initialPassword));
    ok('mustChangePassword=true', r.body && r.body.mustChangePassword === true);
    ok('★ 随机密码分支不走 waitUntil（必须同步）', cap.jobs.length === 0, String(cap.jobs.length));
    assertAutoProvisioned(ok, kv, {
        edition: 'cloud_personal', orderSource: 'taobao-cloud-auto', resolvedBy: 'system:taobao-cloud-auto',
        appMode: 'cloud', recordEdition: 'personal', pwdMode: 'random', carrier: '', machineId: MID, phone: PHONE
    });
}

// ---- A3 pro 码（云端 299 机构版）→ cloud_clinic ----
console.log('--- A3) 云端 pro 机构码 → cloud_clinic ---');
{
    const CODE = nextCode(), MID = nextMid('ca'), PHONE = nextPhone();
    const kv = makeKV({ [`license:${CODE}`]: JSON.stringify(
        presetRecord(CODE, { productClass: 'cloud', type: 'pro' })) });
    const cap = captureJobs();
    const r = await callOn(claimFacade, kv, CLAIM_URL, {
        code: CODE, machineId: MID, user: PHONE, phone: PHONE,
        productClass: 'cloud', clientClass: 'desktop', pwdCap: 'v2', password: 'Abcd1234'
    }, { waitUntil: cap.waitUntil });
    ok('响应 200 success', r.status === 200 && r.body && r.body.success === true,
        r.status + ' ' + JSON.stringify(r.body && r.body.error));
    ok('licenseInfo.type=pro', r.body && r.body.licenseInfo.type === 'pro');
    await cap.flush();
    assertAutoProvisioned(ok, kv, {
        edition: 'cloud_clinic', orderSource: 'taobao-cloud-auto', resolvedBy: 'system:taobao-cloud-auto',
        appMode: 'cloud', recordEdition: 'institution', pwdMode: 'selfset', carrier: '', machineId: MID, phone: PHONE
    });
}

// ---- A4 旧客户端（不带 pwdCap）→ 固定 admin，零回归 ----
console.log('--- A4) 旧客户端无 pwdCap → 自动开通但密码固定 admin（一期行为）---');
{
    const CODE = nextCode(), MID = nextMid('ca'), PHONE = nextPhone();
    const kv = makeKV({ [`license:${CODE}`]: JSON.stringify(presetRecord(CODE, { productClass: 'cloud' })) });
    const cap = captureJobs();
    const r = await callOn(claimFacade, kv, CLAIM_URL, {
        code: CODE, machineId: MID, user: PHONE, phone: PHONE,
        productClass: 'cloud', clientClass: 'desktop'
    }, { waitUntil: cap.waitUntil });
    ok('响应 200 success（旧客户端零回归）', r.status === 200 && r.body && r.body.success === true,
        r.status + ' ' + JSON.stringify(r.body && r.body.error));
    ok('旧客户端响应无 initialPassword', r.body && !r.body.initialPassword);
    await cap.flush();
    assertAutoProvisioned(ok, kv, {
        edition: 'cloud_personal', orderSource: 'taobao-cloud-auto', resolvedBy: 'system:taobao-cloud-auto',
        appMode: 'cloud', recordEdition: 'personal', pwdMode: 'admin', carrier: '', machineId: MID, phone: PHONE
    });
}

// ---- A5 熔断开关 config:taobao-cloud-auto={mode:"off"} → 只发 license 不开通 ----
console.log('--- A5) 熔断开关关闭云端自动开通 → license 照发、不开诊所 ---');
{
    const CODE = nextCode(), MID = nextMid('ca'), PHONE = nextPhone();
    const kv = makeKV({
        [`license:${CODE}`]: JSON.stringify(presetRecord(CODE, { productClass: 'cloud' })),
        'config:taobao-cloud-auto': JSON.stringify({ mode: 'off' })
    });
    const cap = captureJobs();
    const r = await callOn(claimFacade, kv, CLAIM_URL, {
        code: CODE, machineId: MID, user: PHONE, phone: PHONE,
        productClass: 'cloud', clientClass: 'desktop', pwdCap: 'v2'
    }, { waitUntil: cap.waitUntil });
    ok('激活本身成功', r.status === 200 && r.body && r.body.success === true,
        r.status + ' ' + JSON.stringify(r.body && r.body.error));
    ok('无随机密码（未触发开通）', r.body && !r.body.initialPassword);
    ok('无后台开通任务', cap.jobs.length === 0, String(cap.jobs.length));
    ok('★ 熔断期间不建诊所', clinicsOf(kv).length === 0);
    ok('★ 熔断期间不建台账', adminReqsOf(kv).length === 0);
}

// ============================================================================
// B 组：淘宝离线客户（预置 offline 码，99 personal / 299 pro）
// ============================================================================
console.log('\n=== B) 淘宝离线客户：预置本地码 claim 自动开通（后台离线诊所台账）===');

// ---- B1 桌面客户端（activate.js body：clientClass=desktop + pwdCap v2 空密码）----
console.log('--- B1) 离线 99 personal · 桌面端（carrier=desktop）---');
{
    const CODE = nextCode(), MID = nextMid('cb'), PHONE = nextPhone();
    const kv = makeKV({ [`license:${CODE}`]: JSON.stringify(presetRecord(CODE, { productClass: 'offline' })) });
    const cap = captureJobs();
    // 与 app_project/db-offline/desktop/electron/activate.js 构造完全同形
    const body = { code: CODE, machineId: MID, user: PHONE, phone: PHONE,
        productClass: 'offline', clientClass: 'desktop', pwdCap: 'v2' };
    const r = await callOn(claimFacade, kv, CLAIM_URL, body, { waitUntil: cap.waitUntil });
    ok('响应 200 success', r.status === 200 && r.body && r.body.success === true,
        r.status + ' ' + JSON.stringify(r.body && r.body.error));
    ok('licenseInfo.type=personal', r.body && r.body.licenseInfo.type === 'personal');
    ok('★ 留空密码仍同步回随机密码（本地/云端同协议）',
        !!(r.body && r.body.initialPassword && r.body.initialPassword.length >= 8));
    ok('随机密码分支同步（无后台任务）', cap.jobs.length === 0, String(cap.jobs.length));
    assertAutoProvisioned(ok, kv, {
        edition: 'offline_personal', orderSource: 'taobao-local-auto', resolvedBy: 'system:taobao-local-auto',
        appMode: 'local', recordEdition: 'personal', pwdMode: 'random', carrier: 'desktop',
        machineId: MID, phone: PHONE
    });
}

// ---- B2 离线 APP（P3 builder 同形 body：clientClass=app、不带密码）----
console.log('--- B2) 离线 99 personal · APP（carrier=app，无 pwdCap → admin）---');
{
    const CODE = nextCode(), MID = nextMid('cb'), PHONE = nextPhone();
    const kv = makeKV({ [`license:${CODE}`]: JSON.stringify(presetRecord(CODE, { productClass: 'offline' })) });
    const cap = captureJobs();
    const r = await callOn(claimFacade, kv, CLAIM_URL, {
        code: CODE, machineId: MID, user: PHONE, clinicName: '', phone: PHONE,
        productClass: 'offline', clientClass: 'app'
    }, { waitUntil: cap.waitUntil });
    ok('响应 200 success', r.status === 200 && r.body && r.body.success === true,
        r.status + ' ' + JSON.stringify(r.body && r.body.error));
    ok('★ 开通走 waitUntil', cap.jobs.length === 1, String(cap.jobs.length));
    await cap.flush();
    assertAutoProvisioned(ok, kv, {
        edition: 'offline_personal', orderSource: 'taobao-local-auto', resolvedBy: 'system:taobao-local-auto',
        appMode: 'local', recordEdition: 'personal', pwdMode: 'admin', carrier: 'app',
        machineId: MID, phone: PHONE
    });
}

// ---- B3 离线 299 pro · 桌面端 → offline_clinic ----
console.log('--- B3) 离线 299 pro · 桌面端 → offline_clinic ---');
{
    const CODE = nextCode(), MID = nextMid('cb'), PHONE = nextPhone();
    const kv = makeKV({ [`license:${CODE}`]: JSON.stringify(
        presetRecord(CODE, { productClass: 'offline', type: 'pro' })) });
    const cap = captureJobs();
    const r = await callOn(claimFacade, kv, CLAIM_URL, {
        code: CODE, machineId: MID, user: PHONE, phone: PHONE,
        productClass: 'offline', clientClass: 'desktop', pwdCap: 'v2', password: 'Abcd1234'
    }, { waitUntil: cap.waitUntil });
    ok('响应 200 success', r.status === 200 && r.body && r.body.success === true,
        r.status + ' ' + JSON.stringify(r.body && r.body.error));
    await cap.flush();
    assertAutoProvisioned(ok, kv, {
        edition: 'offline_clinic', orderSource: 'taobao-local-auto', resolvedBy: 'system:taobao-local-auto',
        appMode: 'local', recordEdition: 'institution', pwdMode: 'selfset', carrier: 'desktop',
        machineId: MID, phone: PHONE
    });
}

// ---- B4 端锁定：offline 码用 cloud 端请求 → 403 拒绝（防套利）----
console.log('--- B4) 端锁定闸：offline 码从 cloud 端请求 → 403 ---');
{
    const CODE = nextCode(), MID = nextMid('cb'), PHONE = nextPhone();
    const kv = makeKV({ [`license:${CODE}`]: JSON.stringify(presetRecord(CODE, { productClass: 'offline' })) });
    const r = await callOn(claimFacade, kv, CLAIM_URL, {
        code: CODE, machineId: MID, user: PHONE, phone: PHONE,
        productClass: 'cloud', clientClass: 'desktop'
    });
    ok('★ 403 拒绝', r.status === 403, 'status=' + r.status);
    ok('码未消耗（仍 unused）',
        JSON.parse(kv._m.get(`license:${CODE}`)).status === 'unused');
    ok('未建诊所/台账', clinicsOf(kv).length === 0 && adminReqsOf(kv).length === 0);
}

// ============================================================================
// C 组：免费客户 claim-free
// ============================================================================
console.log('\n=== C) 免费客户：claim-free 自助领取 ===');

// ---- C1 首次领取（带手机号）----
console.log('--- C1) 首次领取（留手机号）---');
{
    const MID = nextMid('cf'), PHONE = '13955000001';
    const kv = makeKV();
    const r = await callOn(freeOnRequest, kv, FREE_URL,
        { machineId: MID, phone: PHONE, productClass: 'offline', clientClass: 'desktop' });
    ok('响应 200 success', r.status === 200 && r.body && r.body.success === true,
        r.status + ' ' + JSON.stringify(r.body && r.body.error));
    const li = r.body && r.body.licenseInfo;
    ok('licenseInfo.type=free', li && li.type === 'free', JSON.stringify(li));
    ok('★ 永久授权（expiresAt=2099）', li && String(li.expiresAt).indexOf('2099') === 0, String(li && li.expiresAt));
    ok('maxPrescriptions=0（不限开方）', li && li.maxPrescriptions === 0);
    ok('features=[]（零付费功能位）', Array.isArray(li.features) && li.features.length === 0);
    ok('license blob 已签发', !!(r.body && r.body.license));
    const rec = JSON.parse(kv._m.get('free:device:' + MID));
    ok('每机记录 claimCount=1', rec.claimCount === 1, String(rec.claimCount));
    ok('记录锁定手机号', rec.phone === PHONE, String(rec.phone));
    ok('记录 user=手机号', rec.user === PHONE);
    ok('记录 productClass/clientClass 落库', rec.productClass === 'offline' && rec.clientClass === 'desktop');
    ok('license user=手机号', li.user === PHONE);
}

// ---- C2 重领幂等：换手机号无效、计数 +1、license 身份不变 ----
console.log('--- C2) 重装/丢码重领：身份以首次为准，计数 +1 ---');
{
    const MID = nextMid('cf'), FIRST = '13955000002';
    const kv = makeKV();
    const r1 = await callOn(freeOnRequest, kv, FREE_URL, { machineId: MID, phone: FIRST });
    const r2 = await callOn(freeOnRequest, kv, FREE_URL, { machineId: MID, phone: '13955000099' });
    ok('两次均 200', r1.status === 200 && r2.status === 200);
    const rec = JSON.parse(kv._m.get('free:device:' + MID));
    ok('★ claimCount=2', rec.claimCount === 2, String(rec.claimCount));
    ok('★ 重领锁定首次手机号（新号被忽略）', rec.phone === FIRST, String(rec.phone));
    ok('★ license user 仍是首次手机号',
        r2.body.licenseInfo.user === FIRST, String(r2.body.licenseInfo.user));
    ok('两次 license 均为 free',
        r1.body.licenseInfo.type === 'free' && r2.body.licenseInfo.type === 'free');
}

// ---- C3 不留手机号也能领 ----
console.log('--- C3) 不留手机号直接领取 ---');
{
    const MID = nextMid('cf');
    const kv = makeKV();
    const r = await callOn(freeOnRequest, kv, FREE_URL, { machineId: MID });
    ok('响应 200 success', r.status === 200 && r.body && r.body.success === true,
        r.status + ' ' + JSON.stringify(r.body && r.body.error));
    ok('默认用户名=免费用户', r.body.licenseInfo.user === '免费用户', String(r.body.licenseInfo.user));
    const rec = JSON.parse(kv._m.get('free:device:' + MID));
    ok('记录手机号为空', rec.phone === '', String(rec.phone));
    ok('默认 productClass=offline/clientClass=desktop',
        rec.productClass === 'offline' && rec.clientClass === 'desktop');
}

// ---- C4 错误输入 ----
console.log('--- C4) 错误输入全部 400 ---');
{
    const kv = makeKV();
    const r1 = await callOn(freeOnRequest, kv, FREE_URL, {});
    ok('缺 machineId → 400', r1.status === 400, 'status=' + r1.status);
    const r2 = await callOn(freeOnRequest, kv, FREE_URL, { machineId: 'bad id!!' });
    ok('坏 machineId → 400（schema-guard）', r2.status === 400, 'status=' + r2.status);
    const r3 = await callOn(freeOnRequest, kv, FREE_URL,
        { machineId: nextMid('cf'), phone: '12345' });
    ok('坏手机号 → 400', r3.status === 400, 'status=' + r3.status);
    const r4 = await callOn(freeOnRequest, kv, FREE_URL,
        { machineId: 'short' });
    ok('过短 machineId → 400', r4.status === 400, 'status=' + r4.status);
    ok('失败均不签发 license',
        !(r1.body && r1.body.license) && !(r2.body && r2.body.license) &&
        !(r3.body && r3.body.license) && !(r4.body && r4.body.license));
}

// ============================================================================
// D 组：试用客户（trial 码 claim + Android 硬件证明）
// ============================================================================
console.log('\n=== D) 试用客户：trial 码不自动开通 + 硬件证明注册 ===');

// ---- D1 trial 预置码 claim：签发 trial license，但不自动开通/不发邀请奖励 ----
console.log('--- D1) trial 码 claim：能激活、不建诊所台账、不触发邀请奖励 ---');
{
    const CODE = nextCode(), MID = nextMid('td'), PHONE = nextPhone();
    // 预置一个邀请人（若错误发奖，其 inviteCount/rewardDays 会变）
    const INVITER_CODE = nextCode();
    const inviterSeed = presetRecord(INVITER_CODE, {
        productClass: 'cloud', type: 'personal', status: 'used',
        inviteCode: 'ABCD', inviteCount: 0, rewardDays: 0
    });
    const kv = makeKV({
        [`license:${CODE}`]: JSON.stringify(presetRecord(CODE, {
            productClass: 'cloud', type: 'trial', days: 7
        })),
        [`license:${INVITER_CODE}`]: JSON.stringify(inviterSeed)
    });
    const cap = captureJobs();
    const r = await callOn(claimFacade, kv, CLAIM_URL, {
        code: CODE, machineId: MID, user: PHONE, phone: PHONE,
        productClass: 'cloud', clientClass: 'app', inviteCode: 'ABCD'
    }, { waitUntil: cap.waitUntil });
    ok('响应 200 success（trial 可正常签发）', r.status === 200 && r.body && r.body.success === true,
        r.status + ' ' + JSON.stringify(r.body && r.body.error));
    const li = r.body && r.body.licenseInfo;
    ok('★ licenseInfo.type=trial', li && li.type === 'trial', JSON.stringify(li));
    ok('trial maxPrescriptions=30', li && li.maxPrescriptions === 30, String(li && li.maxPrescriptions));
    ok('★ trial 不触发自动开通（无后台任务）', cap.jobs.length === 0, String(cap.jobs.length));
    ok('★ 不建诊所', clinicsOf(kv).length === 0);
    ok('★ 不建 admin_req 台账', adminReqsOf(kv).length === 0);
    ok('★ 携带邀请码也不发邀请奖励（inviteeBonusDays=0）',
        r.body && r.body.inviteInfo && r.body.inviteInfo.inviteeBonusDays === 0,
        JSON.stringify(r.body && r.body.inviteInfo));
    const inviterAfter = JSON.parse(kv._m.get(`license:${INVITER_CODE}`));
    ok('★ 邀请人 inviteCount 未增加', inviterAfter.inviteCount === 0, String(inviterAfter.inviteCount));
    const trialAfter = JSON.parse(kv._m.get(`license:${CODE}`));
    ok('trial 码正常消耗（status=used + 设备绑定）',
        trialAfter.status === 'used' && Array.isArray(trialAfter.devices) &&
        trialAfter.devices.some(d => d.machineId === MID),
        trialAfter.status + '/' + JSON.stringify(trialAfter.devices));
}

// ---- D2 硬件证明 challenge（APP 首试第一步）----
console.log('--- D2) attestation challenge：下发挑战串 ---');
{
    const MID = nextMid('att');
    const kv = makeKV();
    const r = await callOn(attOnRequest, kv, ATT_URL, { action: 'challenge', mid: MID });
    ok('响应 200 success', r.status === 200 && r.body && r.body.success === true,
        r.status + ' ' + JSON.stringify(r.body));
    ok('★ 返回非空 challenge', typeof (r.body && r.body.challenge) === 'string' && r.body.challenge.length >= 16,
        JSON.stringify(r.body && r.body.challenge));
    ok('返回 serverTime', !!(r.body && r.body.serverTime));
    const ch = JSON.parse(kv._m.get('att_ch:' + MID));
    ok('★ KV 落 att_ch 挑战记录', ch && ch.challenge === r.body.challenge, JSON.stringify(ch));
    ok('挑战有效期 ≈ 10 分钟', ch && ch.exp > Math.floor(Date.now() / 1000) + 500);
}

// ---- D3 register 无 certChain → 200 allowed:false missing_cert_chain ----
console.log('--- D3) register 缺少密钥证明链 → 业务拒绝（HTTP 200）---');
{
    const MID = nextMid('att');
    const kv = makeKV();
    const r = await callOn(attOnRequest, kv, ATT_URL, { action: 'register', mid: MID });
    ok('HTTP 200（业务裁决不走 403）', r.status === 200, 'status=' + r.status);
    ok('★ success=false/allowed=false', r.body && r.body.success === false && r.body.allowed === false,
        JSON.stringify(r.body));
    ok('reason=missing_cert_chain', r.body && r.body.reason === 'missing_cert_chain', String(r.body && r.body.reason));
    ok('未写设备登记 device_att', !kv._m.has('device_att:' + MID));
}

// ---- D4 register 伪造 certChain → 验链失败，无软绕过 ----
console.log('--- D4) register 伪造证明链 → 验链拒绝（无软绕过开关）---');
{
    const MID = nextMid('att');
    const kv = makeKV();
    // 先取合法 challenge
    const rc = await callOn(attOnRequest, kv, ATT_URL, { action: 'challenge', mid: MID });
    const r = await callOn(attOnRequest, kv, ATT_URL, {
        action: 'register', mid: MID,
        certChain: [Buffer.from('not-a-real-cert-1').toString('base64'),
                    Buffer.from('not-a-real-cert-2').toString('base64')],
        apiLevel: 30
    });
    ok('HTTP 200', r.status === 200, 'status=' + r.status);
    ok('★ allowed=false', r.body && r.body.allowed === false, JSON.stringify(r.body));
    ok('★ success=false', r.body && r.body.success === false);
    ok('拒绝原因非空（验链类错误）', typeof (r.body && r.body.reason) === 'string' && r.body.reason.length > 0,
        String(r.body && r.body.reason));
    ok('reason 不是 missing_cert_chain（证明走到了真实验链）',
        r.body && r.body.reason !== 'missing_cert_chain', String(r.body.reason));
    ok('★ 未写设备登记（伪造设备无法完成首试注册）', !kv._m.has('device_att:' + MID));
}

// ---- D5 attestation 入口校验 ----
console.log('--- D5) attestation 入口参数校验 ---');
{
    const kv = makeKV();
    const r1 = await callOn(attOnRequest, kv, ATT_URL, { action: 'hack' });
    ok('未知 action → 400', r1.status === 400, 'status=' + r1.status);
    const r2 = await callOn(attOnRequest, kv, ATT_URL, { action: 'challenge' });
    ok('缺 mid → 400', r2.status === 400, 'status=' + r2.status);
    const r3 = await callOn(attOnRequest, kv, ATT_URL, { action: 'challenge', mid: '坏机器!!' });
    ok('坏 mid → 400（schema-guard）', r3.status === 400, 'status=' + r3.status);
}

// ============================================================================
// E 组：P3 buildActivationPayload 双权威源真身 → claim 端到端
// ============================================================================
console.log('\n=== E) P3 契约：auth-core 双源 builder 生成 body → claim 门面 200 ===');

function extractFn(src, marker) {
    const start = src.indexOf(marker);
    if (start < 0) throw new Error('未找到函数: ' + marker);
    const brace = src.indexOf('{', start);
    let depth = 0, i = brace;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(start, i);
}
function loadBuilder(file) {
    const src = fs.readFileSync(path.join(ROOT, 'shared', 'auth-core', file), 'utf8');
    return new Function(extractFn(src, 'function buildActivationPayload(kind, id)') +
        '\nreturn buildActivationPayload;')();
}

for (const srcName of ['offline.js', 'cloud.js']) {
    const build = loadBuilder(srcName);
    console.log('--- E/' + srcName + ' claim-cloud（自设密码）→ 云端自动开通 ---');
    {
        const CODE = nextCode(), MID = nextMid('p3'), PHONE = nextPhone();
        const kv = makeKV({ [`license:${CODE}`]: JSON.stringify(presetRecord(CODE, { productClass: 'cloud' })) });
        const cap = captureJobs();
        const body = build('claim-cloud', {
            code: CODE, machineId: MID, user: 'P3买家' + PHONE.slice(-4),
            clinicName: '', phone: PHONE, password: 'P3pass123'
        });
        ok('builder body 契约：productClass=cloud/pwdCap=v2/带密码',
            body.productClass === 'cloud' && body.pwdCap === 'v2' && body.password === 'P3pass123'
            && body.clientClass === 'app', JSON.stringify(body));
        const r = await callOn(claimFacade, kv, CLAIM_URL, body, { waitUntil: cap.waitUntil });
        ok('★ claim 200 success', r.status === 200 && r.body && r.body.success === true,
            r.status + ' ' + JSON.stringify(r.body && r.body.error));
        await cap.flush();
        const c = clinicsOf(kv)[0] || {};
        ok('诊所 cloud_personal 建成', c.edition === 'cloud_personal', String(c.edition));
        const req = adminReqsOf(kv)[0] || {};
        ok('台账 taobao-cloud-auto', req.orderSource === 'taobao-cloud-auto', String(req.orderSource));
        ok('自设密码响应无初始密码', !r.body.initialPassword);
    }

    console.log('--- E/' + srcName + ' claim-cloud（留空密码）→ 同步随机密码 ---');
    {
        const CODE = nextCode(), MID = nextMid('p3'), PHONE = nextPhone();
        const kv = makeKV({ [`license:${CODE}`]: JSON.stringify(presetRecord(CODE, { productClass: 'cloud' })) });
        const cap = captureJobs();
        const body = build('claim-cloud', {
            code: CODE, machineId: MID, user: 'P3买家', clinicName: '', phone: PHONE
        });
        ok('空密码 body 不带 password 键', !('password' in body) && body.pwdCap === 'v2');
        const r = await callOn(claimFacade, kv, CLAIM_URL, body, { waitUntil: cap.waitUntil });
        ok('★ claim 200 success', r.status === 200 && r.body && r.body.success === true,
            r.status + ' ' + JSON.stringify(r.body && r.body.error));
        ok('★ 随机初始密码一次性下发', !!(r.body && r.body.initialPassword), JSON.stringify(r.body && r.body.initialPassword));
        ok('同步路径无后台任务', cap.jobs.length === 0, String(cap.jobs.length));
        ok('诊所已建', clinicsOf(kv).length === 1);
    }

    console.log('--- E/' + srcName + ' claim-offline（APP 默认 clientClass=app）→ 离线自动开通 ---');
    {
        const CODE = nextCode(), MID = nextMid('p3'), PHONE = nextPhone();
        const kv = makeKV({ [`license:${CODE}`]: JSON.stringify(presetRecord(CODE, { productClass: 'offline' })) });
        const cap = captureJobs();
        const body = build('claim-offline', {
            code: CODE, machineId: MID, user: 'P3买家', clinicName: '', phone: PHONE
        });
        ok('builder body 契约：productClass=offline、无 pwdCap/password',
            body.productClass === 'offline' && body.clientClass === 'app'
            && !('pwdCap' in body) && !('password' in body), JSON.stringify(body));
        const r = await callOn(claimFacade, kv, CLAIM_URL, body, { waitUntil: cap.waitUntil });
        ok('★ claim 200 success', r.status === 200 && r.body && r.body.success === true,
            r.status + ' ' + JSON.stringify(r.body && r.body.error));
        await cap.flush();
        const c = clinicsOf(kv)[0] || {};
        ok('★ 诊所 offline_personal + carrier=app',
            c.edition === 'offline_personal' && c.offlineCarrier === 'app',
            c.edition + '/' + c.offlineCarrier);
        const req = adminReqsOf(kv)[0] || {};
        ok('台账 taobao-local-auto', req.orderSource === 'taobao-local-auto', String(req.orderSource));
    }
}

// 桌面端经 builder 显式覆盖 clientClass=desktop（桌面 activate.js 自行拼体的等价路径）
console.log('--- E/desktop claim-offline 显式 clientClass=desktop → carrier=desktop ---');
{
    const build = loadBuilder('offline.js');
    const CODE = nextCode(), MID = nextMid('p3'), PHONE = nextPhone();
    const kv = makeKV({ [`license:${CODE}`]: JSON.stringify(presetRecord(CODE, { productClass: 'offline' })) });
    const cap = captureJobs();
    const body = build('claim-offline', {
        code: CODE, machineId: MID, user: PHONE, clinicName: '', phone: PHONE, clientClass: 'desktop'
    });
    ok('builder 尊重调用方 clientClass 覆盖', body.clientClass === 'desktop', body.clientClass);
    const r = await callOn(claimFacade, kv, CLAIM_URL, body, { waitUntil: cap.waitUntil });
    ok('★ claim 200 success', r.status === 200 && r.body && r.body.success === true,
        r.status + ' ' + JSON.stringify(r.body && r.body.error));
    await cap.flush();
    const c = clinicsOf(kv)[0] || {};
    ok('★ carrier=desktop', c.offlineCarrier === 'desktop', String(c.offlineCarrier));
}

console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
process.exit(fail === 0 ? 0 : 1);
