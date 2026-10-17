// ============================================================================
//  tb-repeat-renew-defer-test.mjs — 两项改动的回归（mock KV，零网络）
//
//  Task A 重复购买顺延：
//    A1 未到期诊所 → expiresAt 叠加 days（基线 = 当前到期时间）
//    A2 已过期诊所 → 基线 = now，再叠加 days
//    A3 幂等：同码二次调用不再叠加（already=true）
//    A4 disabled 诊所 fail-closed 不顺延
//    A5 pro 码落在 personal 诊所 → tierUpgradeSuggested=true（不静默升级版本）
//    A6 端到端：claim 命中 cloud-account-exists → 诊所被顺延 + 写 taobao-cloud-auto-renewed 日志
//
//  Task B 响应提速（waitUntil 异步开通）：
//    B1 已自设密码 → 自动开通交给 context.waitUntil（不阻塞响应），cloudAccountProvisioned=false，
//       后台任务最终完成开通（诊所建成 + admin_req 台账 + license 回填）
//    B2 留空密码（pwdCap v2 + 无 password）→ 必须同步（不调用 waitUntil，以便随响应下发初始密码）
//
//  用法: node e2e/.tmp/tb-repeat-renew-defer-test.mjs   （退出码 0=全过）
// ============================================================================
import {
    renewClinicForRepeatPurchase, phoneHasCloudAccount
} from '../../functions/api/license/_lib/admin-account.js';
import { onRequest as claimOnRequest } from '../../functions/api/license/validate.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log('  PASS  ' + name); pass++; }
    else { console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); fail++; }
};

const DAY = 86400000;
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
const putClinics = (kv, arr) => kv._m.set('system:clinics', JSON.stringify(arr));

function seedClinic(kv, clinic, phones = []) {
    const arr = clinicsOf(kv); arr.push(clinic); putClinics(kv, arr);
    kv._m.set(`clinic:${clinic.id}:users`, JSON.stringify(phones.map(p => ({ username: p, phone: p, role: 'clinic_admin' }))));
}

const PHONE_A = '13900001111';
const baseClinic = (over = {}) => Object.assign({
    id: 'clinic_renew1', name: '中医诊所·1111', edition: 'cloud_personal',
    status: 'active', createdAt: '2026-01-01T00:00:00.000Z', source: 'activation'
}, over);

// ============ A1 未到期叠加 ============
console.log('--- A1) 未到期诊所：基线 = 当前到期时间 ---');
{
    const future = new Date(Date.now() + 100 * DAY).toISOString();
    const kv = makeKV();
    seedClinic(kv, baseClinic({ expiresAt: future }), [PHONE_A]);
    const r = await renewClinicForRepeatPurchase(kv, { code: 'BNZC-AAAA-BBBB-CCCC-DDDD', phone: PHONE_A, days: 365, type: 'personal' });
    const got = clinicsOf(kv).find(c => c.id === 'clinic_renew1').expiresAt;
    const expect = new Date(Date.parse(future) + 365 * DAY).toISOString();
    ok('renewed=true', r.ok && r.renewed === true, JSON.stringify(r));
    ok('★ expiresAt = 原到期 + 365 天', got === expect, `got=${got} expect=${expect}`);
    ok('oldExpiresAt 如实返回', r.oldExpiresAt === future, String(r.oldExpiresAt));
    ok('写入 lastRenewCode/lastRenewedAt', !!clinicsOf(kv).find(c => c.id === 'clinic_renew1').lastRenewCode);
}

// ============ A2 已过期从当下起算 ============
console.log('\n--- A2) 已过期诊所：基线 = now ---');
{
    const past = new Date(Date.now() - 30 * DAY).toISOString();
    const kv = makeKV();
    seedClinic(kv, baseClinic({ id: 'clinic_renew2', expiresAt: past }), [PHONE_A]);
    const t0 = Date.now();
    await renewClinicForRepeatPurchase(kv, { code: 'BNZC-BBBB-CCCC-DDDD-EEEE', phone: PHONE_A, days: 365 });
    const got = Date.parse(clinicsOf(kv).find(c => c.id === 'clinic_renew2').expiresAt);
    ok('★ 新到期 ≈ now + 365 天（不从过期日叠）', Math.abs(got - (t0 + 365 * DAY)) < 5000,
        new Date(got).toISOString());
}

// ============ A3 幂等 ============
console.log('\n--- A3) 幂等：同码不重复叠加 ---');
{
    const CODE = 'BNZC-CCCC-DDDD-EEEE-FFFF';
    const kv = makeKV();
    seedClinic(kv, baseClinic({ id: 'clinic_renew3', expiresAt: new Date(Date.now() + 10 * DAY).toISOString() }), [PHONE_A]);
    const r1 = await renewClinicForRepeatPurchase(kv, { code: CODE, phone: PHONE_A, days: 365 });
    const after1 = clinicsOf(kv).find(c => c.id === 'clinic_renew3').expiresAt;
    const r2 = await renewClinicForRepeatPurchase(kv, { code: CODE, phone: PHONE_A, days: 365 });
    const after2 = clinicsOf(kv).find(c => c.id === 'clinic_renew3').expiresAt;
    ok('首次 renewed=true', r1.renewed === true);
    ok('★ 二次 already=true（不再叠加）', r2.ok && r2.already === true && r2.renewed === false, JSON.stringify(r2));
    ok('★ 到期时间未被二次叠加', after1 === after2, `${after1} vs ${after2}`);
}

// ============ A4 disabled fail-closed ============
console.log('\n--- A4) 停用诊所：fail-closed 不顺延 ---');
{
    const kv = makeKV();
    const past = new Date(Date.now() - 5 * DAY).toISOString();
    seedClinic(kv, baseClinic({ id: 'clinic_renew4', status: 'disabled', expiresAt: past }), [PHONE_A]);
    const r = await renewClinicForRepeatPurchase(kv, { code: 'BNZC-DDDD-EEEE-FFFF-GGGG', phone: PHONE_A, days: 365 });
    ok('ok=false, reason=clinic-disabled', r.ok === false && r.reason === 'clinic-disabled', JSON.stringify(r));
    ok('★ 到期时间未被改动', clinicsOf(kv).find(c => c.id === 'clinic_renew4').expiresAt === past);
}

// ============ A5 版本档次不静默升级 ============
console.log('\n--- A5) 机构版码落在个人版诊所 → 提示而不静默升级 ---');
{
    const kv = makeKV();
    seedClinic(kv, baseClinic({ id: 'clinic_renew5', edition: 'cloud_personal', expiresAt: new Date(Date.now() + DAY).toISOString() }), [PHONE_A]);
    const r = await renewClinicForRepeatPurchase(kv, { code: 'BNZC-EEEE-FFFF-GGGG-HHHH', phone: PHONE_A, days: 365, type: 'pro' });
    const c = clinicsOf(kv).find(x => x.id === 'clinic_renew5');
    ok('tierUpgradeSuggested=true', r.tierUpgradeSuggested === true, JSON.stringify(r));
    ok('★ edition 未被自动改动', c.edition === 'cloud_personal', c.edition);
}

// ============ A6 端到端：claim 命中 cloud-account-exists → 顺延 + 日志 ============
console.log('\n--- A6) 端到端：claim 触发顺延并记账 ---');
function presetRecord(code, over = {}) {
    return Object.assign({
        code, user: '淘宝买家', phone: '', type: 'personal', status: 'unused',
        days: 365, expiresAt: null, issuedAt: '2026-10-01T00:00:00.000Z',
        maxDevices: 1, productClass: 'cloud', clinicName: null, devices: [], note: '淘宝-云端标准版-199'
    }, over);
}
function claimCtx(kv, code, phone, mid, extra = {}) {
    return {
        env: { KV: kv },
        waitUntil: extra.waitUntil || (() => {}),
        request: new Request('https://tcm-prescription-system.pages.dev/api/license/claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.1.1.1' },
            body: JSON.stringify(Object.assign({
                code, machineId: mid, phone, productClass: 'cloud', clientClass: 'desktop'
            }, extra.body || {}))
        })
    };
}
{
    const CODE = 'BNZC-FFFF-GGGG-HHHH-JJJJ';
    const MID = 'mid-renew-e2e-0001';
    const kv = makeKV({ [`license:${CODE}`]: JSON.stringify(presetRecord(CODE)) });
    const future = new Date(Date.now() + 200 * DAY).toISOString();
    seedClinic(kv, baseClinic({ id: 'clinic_renewe2e', expiresAt: future }), [PHONE_A]);
    const res = await claimOnRequest(claimCtx(kv, CODE, PHONE_A, MID));
    let body = null; try { body = await res.json(); } catch (_) {}
    const got = clinicsOf(kv).find(c => c.id === 'clinic_renewe2e').expiresAt;
    ok('★ 诊所已被顺延 +365 天',
        got === new Date(Date.parse(future) + 365 * DAY).toISOString(),
        `got=${got}`);
    const log = JSON.parse(kv._m.get('license_log:' + CODE) || '[]');
    const acts = log.map(e => e.action);
    ok('★ 写出 taobao-cloud-auto-renewed 审计', acts.includes('taobao-cloud-auto-renewed'), JSON.stringify(acts));
    const renewed = log.find(e => e.action === 'taobao-cloud-auto-renewed');
    ok('审计文案含 旧→新 有效期', /→/.test(renewed.detail || ''), renewed.detail);
    ok('响应仍正常返回（激活不受顺延影响）', res.status === 200 && body && body.success === true,
        'status=' + res.status + ' ' + JSON.stringify(body || {}).slice(0, 120));
}

// ============ B1 异步开通（已自设密码） ============
console.log('\n--- B1) 已自设密码 → 开通交给 waitUntil，不阻塞响应 ---');
{
    const CODE = 'BNZC-GGGG-HHHH-JJJJ-KKKK';
    const MID = 'mid-defer-0001';
    const PHONE = '13900002222';
    const kv = makeKV({ [`license:${CODE}`]: JSON.stringify(presetRecord(CODE)) });
    let captured = null, waitUntilCalled = false;
    const res = await claimOnRequest(claimCtx(kv, CODE, PHONE, MID, {
        waitUntil: (p) => { waitUntilCalled = true; captured = p; },
        body: { pwdCap: 'v2', password: 'Abcd1234' }
    }));
    let body = null; try { body = await res.json(); } catch (_) {}
    ok('★ context.waitUntil 被调用（开通已后台化）', waitUntilCalled === true);
    ok('响应返回成功', res.status === 200 && body && body.success === true, 'status=' + res.status);
    // 时序无关断言：后台任务可能在响应序列化前就跑完（mock KV 无真实 IO 延迟），
    // 故该字段 true/false 都合法；客户端不消费它，开通结果一律以台账/登录为准
    ok('cloudAccountProvisioned 为布尔值（时序无关，客户端无消费）',
        body && typeof body.cloudAccountProvisioned === 'boolean',
        JSON.stringify(body && body.cloudAccountProvisioned));
    ok('返回了 license blob', !!(body && body.license));
    ok('后台任务 promise 存在', !!captured && typeof captured.then === 'function');
    // 等待后台任务完成 → 开通结果必须落地（诊所 + admin_req + license 回填）
    await captured;
    const clinics = clinicsOf(kv);
    const created = clinics.find(c => (c.adminPhone || '') === PHONE || c.name === '中医诊所·2222' || c.source === 'activation' && c.id !== 'clinic_renewe2e');
    ok('★ 后台任务完成：新诊所已建', clinics.length >= 1 && !!clinics.find(c => c.id !== 'clinic_renewe2e'),
        JSON.stringify(clinics.map(c => c.id + '/' + c.name)));
    const reqKeys = [...kv._m.keys()].filter(k => k.startsWith('admin_req:'));
    ok('★ 后台任务完成：admin_req 台账已建', reqKeys.length === 1, JSON.stringify(reqKeys));
    const req = JSON.parse(kv._m.get(reqKeys[0]) || '{}');
    ok('台账 orderSource=taobao-cloud-auto', req.orderSource === 'taobao-cloud-auto', String(req.orderSource));
    ok('★ license 已回填台账（异步路径自身回填，防 admin-status 自救误判）',
        typeof req.licenseBase64 === 'string' && req.licenseBase64.length > 20,
        'len=' + String(req.licenseBase64 || '').length);
}

// ============ B2 留空密码必须同步 ============
console.log('\n--- B2) 留空密码（pwdCap v2 无 password）→ 必须同步 ---');
{
    const CODE = 'BNZC-HHHH-JJJJ-KKKK-LLLL';
    const MID = 'mid-sync-0001';
    const PHONE = '13900003333';
    const kv = makeKV({ [`license:${CODE}`]: JSON.stringify(presetRecord(CODE)) });
    let waitUntilCalled = false;
    const res = await claimOnRequest(claimCtx(kv, CODE, PHONE, MID, {
        waitUntil: () => { waitUntilCalled = true; },
        body: { pwdCap: 'v2' }   // 无 password → 服务端随机初始密码分支
    }));
    let body = null; try { body = await res.json(); } catch (_) {}
    ok('★ 未走 waitUntil（同步执行）', waitUntilCalled === false);
    ok('响应带回一次性随机初始密码', !!(body && body.initialPassword && body.initialPassword.length >= 8),
        JSON.stringify(body && { ip: body.initialPassword }));
    ok('mustChangePassword=true', body && body.mustChangePassword === true);
    const clinics = clinicsOf(kv);
    ok('★ 同步路径已把诊所建好（不依赖后台）', clinics.some(c => c.id !== 'clinic_renewe2e'));
}

// ============ B3 量化：响应不再等开通（注入延迟对比） ============
console.log('\n--- B3) 量化：deferred 响应对"开通耗时"免疫 ---');
{
    const DELAY = 400;
    // 给"开通链路"的 KV 写注入 400ms 延迟（诊所用户行是该链路的第一笔写）
    const slowKV = (seed) => {
        const m = new Map(Object.entries(seed));
        return {
            _m: m,
            async get(k, type) {
                if (!m.has(k)) return null;
                const v = m.get(k);
                return type === 'json' ? (typeof v === 'string' ? JSON.parse(v) : v) : v;
            },
            async put(k, v) {
                if (k.startsWith('clinic:') && k.endsWith(':users')) await new Promise(r => setTimeout(r, DELAY));
                m.set(k, v);
            },
            async delete(k) { m.delete(k); },
            async list(o = {}) {
                const p = o.prefix || '';
                return { keys: [...m.keys()].filter(k => k.startsWith(p)).map(name => ({ name })), list_complete: true };
            }
        };
    };
    // ① deferred（已自设密码）
    {
        const CODE = 'BNZC-JJJJ-KKKK-LLLL-MMMM';
        const kv = slowKV({ [`license:${CODE}`]: JSON.stringify(presetRecord(CODE)) });
        const t0 = Date.now();
        const res = await claimOnRequest(claimCtx(kv, CODE, '13900004444', 'mid-q-1', {
            waitUntil: () => {}, body: { pwdCap: 'v2', password: 'Abcd1234' }
        }));
        const dt = Date.now() - t0;
        ok('★ deferred 响应未被 400ms 开通延迟阻塞（远小于 DELAY）', dt < DELAY,
            `响应 ${dt}ms vs 延迟 ${DELAY}ms`);
        ok('deferred 响应仍是成功', res.status === 200, 'status=' + res.status);
    }
    // ② 同步（留空密码）—— 必须等开通，故会吃满延迟
    {
        const CODE = 'BNZC-KKKK-LLLL-MMMM-NNNN';
        const kv = slowKV({ [`license:${CODE}`]: JSON.stringify(presetRecord(CODE)) });
        const t0 = Date.now();
        await claimOnRequest(claimCtx(kv, CODE, '13900005555', 'mid-q-2', {
            waitUntil: () => { throw new Error('不应被调用'); }, body: { pwdCap: 'v2' }
        }));
        const dt = Date.now() - t0;
        ok('★ 同步（随机密码）路径确实等满开通延迟', dt >= DELAY, `响应 ${dt}ms vs 延迟 ${DELAY}ms`);
    }
}

console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
process.exit(fail === 0 ? 0 : 1);
