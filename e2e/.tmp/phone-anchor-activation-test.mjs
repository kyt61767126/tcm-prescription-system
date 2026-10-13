// ============================================================================
//  phone-anchor-activation-test.mjs — P2「码+手机号」单锚点首激 端到端（mock KV）
//
//  验证 functions/api/license/validate.js：
//    T1 全新裸码(无 user/clinicName/phone 锚点)+仅手机号 → 200，手机号落 record.phone，
//       不 v3 绑定，identitySource=phone-anchor，user 兜底手机号
//    T2 裸码+手机号+诊所名 → 200 且 v3 三因子绑定
//    T3 裸码无手机号无身份 → 仍 400 needActivationInfo
//    T4 开关 config:activation-phone-anchor=off → 回退原行为(400)
//    T5 used 码换机核验不放松：错误手机号 403；正确手机号自动解绑 200(phone-verified)
//    T6 有占位 user 的码（备货码非预置/旧客户端带 user）→ existing 路径不回归
// ============================================================================
import { onRequest as claimOnRequest } from '../../functions/api/license/validate.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log('  PASS  ' + name); pass++; }
    else { console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); fail++; }
};

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

const MID = 'b'.repeat(32);
const MID_OLD = 'a'.repeat(32);
const MID_NEW = 'c'.repeat(32);
const PHONE = '13800138000';

function bareLicense(over = {}) {
    return Object.assign({
        code: 'BNZC-P2AA-AAAA-AAAA-AAAA',
        // 旧形态渠道码：无 productClass 锁端（否则会被判 preset 走淘宝自动开通）、
        // 无 user / clinicName / phone —— 这才是 P2 手机号单锚点要覆盖的真·裸码
        type: 'personal', status: 'unused', maxDevices: 1, devices: [],
        days: 365
    }, over);
}

async function claim(kv, body) {
    const ctx = {
        env: { KV: kv }, waitUntil: () => {},
        request: new Request('https://x/api/license/claim', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.9.9.9' },
            body: JSON.stringify(body)
        })
    };
    const resp = await claimOnRequest(ctx);
    return { status: resp.status, body: await resp.json() };
}
const baseBody = (over) => Object.assign(
    { code: 'BNZC-P2AA-AAAA-AAAA-AAAA', machineId: MID, productClass: 'offline', clientClass: 'app' }, over);
const seedKv = (rec) => {
    const kv = makeKV();
    kv._m.set('license:' + rec.code, JSON.stringify(rec));
    kv._m.set('system:license_index', JSON.stringify([rec.code]));
    return kv;
};

// ---- T1 裸码 + 仅手机号 → 单锚点首激 ----
console.log('--- T1 裸码+仅手机号：放行并固化手机号 ---');
{
    const rec = bareLicense();
    const kv = seedKv(rec);
    const r = await claim(kv, baseBody({ phone: PHONE }));
    ok('T1 claim 200', r.status === 200 && r.body.success === true, JSON.stringify(r.body).slice(0, 200));
    const after = JSON.parse(kv._m.get('license:' + rec.code));
    ok('T1 码置 used', after.status === 'used');
    ok('T1 record.phone 固化手机号', after.phone === PHONE, 'phone=' + after.phone);
    ok('T1 无诊所名不进 record.clinicName', !after.clinicName, 'clinicName=' + after.clinicName);
    ok('T1 user 兜底为手机号（不落 user 占位串）', after.user === PHONE, 'user=' + after.user);
    ok('T1 设备已绑且 device.clinicName=null', after.devices.length === 1 &&
        after.devices[0].machineId === MID && !after.devices[0].clinicName);
    ok('T1 identitySource=phone-anchor', r.body.identitySource === 'phone-anchor', r.body.identitySource);
    ok('T1 resolvedIdentity.phone 回带', r.body.resolvedIdentity && r.body.resolvedIdentity.phone === PHONE);
    ok('T1 未 v3 绑定', r.body.licenseInfo.licenseBinding === null,
        'binding=' + r.body.licenseInfo.licenseBinding);
}

// ---- T2 裸码 + 手机号 + 诊所名 → v3 三因子 ----
console.log('--- T2 裸码+手机号+诊所名：v3 三因子绑定 ---');
{
    const rec = bareLicense();
    const kv = seedKv(rec);
    const r = await claim(kv, baseBody({ phone: PHONE, clinicName: '惠康中医诊所' }));
    ok('T2 claim 200', r.status === 200 && r.body.success === true, JSON.stringify(r.body).slice(0, 200));
    const after = JSON.parse(kv._m.get('license:' + rec.code));
    ok('T2 record.clinicName 锚定客户端同名', after.clinicName === '惠康中医诊所', 'clinicName=' + after.clinicName);
    ok('T2 license v3 三因子绑定', r.body.licenseInfo.licenseBinding === 'clinic+user+machine');
    ok('T2 licenseInfo.clinicName 回带', r.body.licenseInfo.clinicName === '惠康中医诊所');
    ok('T2 identitySource=phone-anchor', r.body.identitySource === 'phone-anchor');
}

// ---- T3 裸码无手机号无身份 → 仍 400 ----
console.log('--- T3 裸码无任何身份：仍回 needActivationInfo ---');
{
    const rec = bareLicense();
    const kv = seedKv(rec);
    const r = await claim(kv, baseBody({}));
    ok('T3 400', r.status === 400, 'status=' + r.status);
    ok('T3 needActivationInfo=true', r.body.needActivationInfo === true);
    const after = JSON.parse(kv._m.get('license:' + rec.code));
    ok('T3 码仍 unused（未落库）', after.status === 'unused');
}

// ---- T4 开关 off 回退 ----
console.log('--- T4 开关 mode=off：手机号也不放行 ---');
{
    const rec = bareLicense();
    const kv = seedKv(rec);
    kv._m.set('config:activation-phone-anchor', JSON.stringify({ mode: 'off' }));
    const r = await claim(kv, baseBody({ phone: PHONE }));
    ok('T4 400 needActivationInfo', r.status === 400 && r.body.needActivationInfo === true,
        'status=' + r.status + ' body=' + JSON.stringify(r.body).slice(0, 120));
}

// ---- T5a 换机核验不放松：错误手机号 ----
console.log('--- T5a used 码新机+错误手机号：403（换机核验不变） ---');
{
    const rec = bareLicense({
        status: 'used', phone: PHONE, user: PHONE,
        activatedAt: '2026-09-01T00:00:00.000Z', firstActivatedAt: '2026-09-01T00:00:00.000Z',
        devices: [{ machineId: MID_OLD, activatedAt: '2026-09-01T00:00:00.000Z', clientClass: 'app' }]
    });
    const kv = seedKv(rec);
    kv._m.set('mid_owners:' + MID_OLD, JSON.stringify([rec.code]));
    const r = await claim(kv, baseBody({ machineId: MID_NEW, phone: '13900000000' }));
    ok('T5a 错误手机号换机被拒(403)', r.status === 403, 'status=' + r.status + ' ' + (r.body.error || '').slice(0, 60));
    const after = JSON.parse(kv._m.get('license:' + rec.code));
    ok('T5a 旧设备未被挤掉', after.devices.length === 1 && after.devices[0].machineId === MID_OLD);
}

// ---- T5b 换机正确手机号：自动解绑恢复 ----
console.log('--- T5b used 码新机+正确手机号：自动解绑 200(phone-verified) ---');
{
    const rec = bareLicense({
        status: 'used', phone: PHONE, user: PHONE,
        activatedAt: '2026-09-01T00:00:00.000Z', firstActivatedAt: '2026-09-01T00:00:00.000Z',
        devices: [{ machineId: MID_OLD, activatedAt: '2026-09-01T00:00:00.000Z', clientClass: 'app' }]
    });
    const kv = seedKv(rec);
    kv._m.set('mid_owners:' + MID_OLD, JSON.stringify([rec.code]));
    const r = await claim(kv, baseBody({ machineId: MID_NEW, phone: PHONE }));
    ok('T5b 正确手机号换机 200', r.status === 200 && r.body.success === true,
        JSON.stringify(r.body).slice(0, 160));
    const after = JSON.parse(kv._m.get('license:' + rec.code));
    ok('T5b 最旧设备被自动解绑、新机已绑', after.devices.length === 1 &&
        after.devices[0].machineId === MID_NEW, JSON.stringify(after.devices).slice(0, 120));
    ok('T5b identitySource=phone-verified', r.body.identitySource === 'phone-verified', r.body.identitySource);
}

// ---- T6 有占位/已有 user 的码走 existing，不误标 phone-anchor ----
console.log('--- T6 备货码（record.user 非空）+客户端带 user：existing 回归 ---');
{
    const rec = bareLicense({ user: '云端标准备货01' });
    const kv = seedKv(rec);
    const r = await claim(kv, baseBody({ user: 'X', phone: '13300000021' }));
    ok('T6 claim 200', r.status === 200 && r.body.success === true, JSON.stringify(r.body).slice(0, 160));
    ok('T6 identitySource=existing（不误标 phone-anchor）', r.body.identitySource === 'existing',
        r.body.identitySource);
}

console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL');
if (fail) process.exit(1);
