// ============================================================================
//  tb-ratelimit-test.mjs — validate.js 两项修复的回归测试（mock KV，零网络）
//
//  A) 同机同码幂等重放（status=used 且 machineId 已在 devices）**不消耗** 5/h 额度
//  B) 换机试探防护不降级：新 machineId 第 6 次仍被 429 拦截
//  C) 全新未使用码：首次激活计 1 次额度，其后同机重放豁免
//  D) 出厂占位诊所名 "XXX中医诊所"/"XXX" 不被采信 → 走服务端唯名兜底；
//     真实客户名（张氏中医诊所）仍按 nameSource=client 采信（对照组）
//
//  用法: node e2e/.tmp/tb-ratelimit-test.mjs   （退出码 0=全过）
// ============================================================================
import { onRequest } from '../../functions/api/license/validate.js';

const HOUR = Math.floor(Date.now() / (60 * 60 * 1000));
const LIMIT_MSG = '该激活码校验过于频繁';
const rlKey = (code) => `ratelimit:code:${code}:${HOUR}`;

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
            if (type === 'json') return typeof v === 'string' ? JSON.parse(v) : v;
            return v;
        },
        async put(k, v) { m.set(k, v); },
        async delete(k) { m.delete(k); },
        async list(opts = {}) {
            const p = opts.prefix || '';
            return { keys: [...m.keys()].filter(k => k.startsWith(p)).map(name => ({ name })), list_complete: true };
        }
    };
}

function record(code, over = {}) {
    return Object.assign({
        code, user: '13398000000', phone: '13398000000', type: 'pro',
        status: 'used', days: 365, expiresAt: '2027-10-09T12:00:00.000Z',
        issuedAt: '2026-10-09T12:00:00.000Z', activatedAt: '2026-10-09T12:00:00.000Z',
        maxDevices: 5, productClass: 'offline', clinicName: '测试诊所', devices: []
    }, over);
}

function call(kv, { code, machineId, ip, body = {} }) {
    const req = new Request('https://tcm-prescription-system.pages.dev/api/license/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
        body: JSON.stringify(Object.assign({
            code, machineId, phone: '13398000000',
            productClass: 'offline', clientClass: 'desktop'
        }, body))
    });
    return onRequest({ env: { KV: kv }, waitUntil: () => {}, request: req })
        .then(async (res) => {
            let b = null; try { b = await res.json(); } catch (_) {}
            return { status: res.status, body: b || {} };
        });
}
const brief = (r) => r.status + ':' + (r.body.error || r.body.success);

// ---------------- A) 同机同码幂等重放不受限流 ----------------
console.log('--- A) 同机同码幂等重放（status=used 且设备已在本码 devices）---');
{
    const CODE = 'BNZC-AAAA-AAAA-AAAA-AAAA';
    const MID = '7f5e4f79f30967666d9137b51c3b8217';
    const kv = makeKV({
        [`license:${CODE}`]: JSON.stringify(record(CODE, {
            devices: [{ machineId: MID, activatedAt: '2026-10-09T12:00:00.000Z', clientClass: 'desktop', productClass: 'offline' }]
        }))
    });
    const seen = [];
    for (let i = 1; i <= 7; i++) seen.push(brief(await call(kv, { code: CODE, machineId: MID, ip: '10.0.0.1' })));
    console.log('     7 次响应: ' + seen.join(' | '));
    ok('连打 7 次同机重放，未出现限流 429', !seen.some(s => s.includes('429') || s.includes(LIMIT_MSG)), seen.join(' | '));
    ok('限流计数器从未被创建（额度零消耗）', !kv._m.has(rlKey(CODE)), '键已存在 = ' + kv._m.get(rlKey(CODE)));
}

// ---------------- B) 换机试探防护不降级 ----------------
console.log('\n--- B) 换机试探（每次新 machineId）防护不降级 ---');
{
    const CODE = 'BNZC-BBBB-BBBB-BBBB-BBBB';
    const kv = makeKV({
        [`license:${CODE}`]: JSON.stringify(record(CODE, {
            devices: [{ machineId: 'owner-machine', activatedAt: '2026-10-09T12:00:00.000Z' }]
        }))
    });
    const seen = [];
    for (let i = 1; i <= 7; i++) seen.push(brief(await call(kv, { code: CODE, machineId: 'attacker-' + i, ip: '10.0.0.2' })));
    console.log('     7 次响应: ' + seen.join(' | '));
    const idx = seen.findIndex(s => s.includes('429') || s.includes(LIMIT_MSG));
    ok('第 6 次起被 429 限流拦截', idx === 5, '首次限流出现在第 ' + (idx + 1) + ' 次');
    ok('限流计数器累加到 5', kv._m.get(rlKey(CODE)) === '5', '实际=' + kv._m.get(rlKey(CODE)));
}

// ---------------- C) 未使用码：首激计 1 次，其后同机重放豁免 ----------------
console.log('\n--- C) 全新未使用码：首激计额度，其后同机重放豁免 ---');
{
    const CODE = 'BNZC-CCCC-CCCC-CCCC-CCCC';
    const MID = 'fresh-machine';
    const kv = makeKV({ [`license:${CODE}`]: JSON.stringify(record(CODE, { status: 'unused', devices: [] })) });
    const seen = [];
    for (let i = 1; i <= 5; i++) seen.push(brief(await call(kv, { code: CODE, machineId: MID, ip: '10.0.0.3' })));
    console.log('     5 次响应: ' + seen.join(' | '));
    ok('首激成功（第 1 次 200）', seen[0] === '200:true', seen[0]);
    ok('5 次请求只计 1 次额度', kv._m.get(rlKey(CODE)) === '1', '实际=' + kv._m.get(rlKey(CODE)));
    ok('全程未被限流（客户重试不被锁）', !seen.some(s => s.includes('429')), seen.join(' | '));
}

// ---------------- D) 出厂占位诊所名不被采信 ----------------
console.log('\n--- D) 出厂占位诊所名 vs 真实客户名 ---');
async function provisionName(code, submitted, phone) {
    const kv = makeKV({ [`license:${code}`]: JSON.stringify(record(code, { status: 'unused', devices: [], phone, user: phone })) });
    const r = await call(kv, { code, machineId: 'mid-' + code.slice(5, 9), ip: '10.0.0.9', body: { phone, clinicName: submitted } });
    let clinics = [];
    try { clinics = JSON.parse(kv._m.get('system:clinics') || '[]'); } catch (_) {}
    const mine = clinics.find(c => c && (c.phone === phone || c.adminPhone === phone)) || clinics[clinics.length - 1];
    return { r, name: mine ? mine.name : '(未找到诊所)', clinics };
}
{
    const a = await provisionName('BNZC-DDDD-DDDD-DDDD-DDDD', 'XXX中医诊所', '13390000001');
    console.log('     提交 "XXX中医诊所" -> 实际诊所名: ' + a.name);
    ok('出厂占位名未被采信', a.name !== 'XXX中医诊所', '实际=' + a.name);
    ok('落到服务端唯名兜底（中医诊所·…）', /^中医诊所·/.test(a.name), '实际=' + a.name);

    const b = await provisionName('BNZC-EEEE-EEEE-EEEE-EEEE', '张氏中医诊所', '13390000002');
    console.log('     提交 "张氏中医诊所" -> 实际诊所名: ' + b.name);
    ok('真实客户名仍被采信（对照组，无回归）', b.name === '张氏中医诊所', '实际=' + b.name);

    const c = await provisionName('BNZC-FFFF-FFFF-FFFF-FFFF', 'XXX', '13390000003');
    console.log('     提交 "XXX" -> 实际诊所名: ' + c.name);
    ok('纯 "XXX" 占位名未被采信', c.name !== 'XXX', '实际=' + c.name);
}

console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
process.exit(fail === 0 ? 0 : 1);
