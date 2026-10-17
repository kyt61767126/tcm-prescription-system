// ============================================================================
//  tb-audit-reliability-test.mjs — 自动开通审计可靠性回归（mock KV，零网络）
//
//  验证 2026-10-09「审计单一事实源」改动：
//   A) appendLicenseLog 读改写带重试：前 2 次 KV put 瞬时失败 → 最终成功，
//      日志落库、无缺口标记、返回 true
//   B) 重试仍失败（仅 license_log 键写不进）→ 返回 false，且写入
//      license_log_gap:{code} 缺口标记（不可观测 → 可见）
//   C) GET /license/logs 读侧：
//      · 即使 license_log 缺 taobao-*-auto-provisioned 成功行，
//        也能从 admin_req 反查出「自动开通台账」并叠加进 logs（admin_req 为事实源）
//      · 存在缺口标记时叠加 audit-gap 条目、auditReconciled=false、auditGaps 非空
//   D) 鉴权闸不回归：无 token → 403
//
//  用法: node e2e/.tmp/tb-audit-reliability-test.mjs   （退出码 0=全过）
// ============================================================================
import {
    appendLicenseLog, getLicenseLogs, getLicenseLogGaps, KV_LICENSE_LOG_GAP_PREFIX
} from '../../functions/api/license/_lib/license-core.js';
import { signToken } from '../../functions/api/_lib/auth.js';
import { onRequest as logsOnRequest } from '../../functions/api/license/logs.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log('  PASS  ' + name); pass++; }
    else { console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); fail++; }
};

// ---- mock KV：支持「前 N 次 put 失败」与「按 key 持续失败」两种注入 ----
function makeKV(seed = {}, opts = {}) {
    const m = new Map(Object.entries(seed));
    let transientLeft = opts.failPutTimes || 0;
    const failIf = opts.failPutIf || (() => false);
    const stats = { put: 0, get: 0, putKeys: [] };
    return {
        _m: m, _stats: stats,
        async get(k, type) {
            stats.get++;
            if (!m.has(k)) return null;
            const v = m.get(k);
            return type === 'json' ? (typeof v === 'string' ? JSON.parse(v) : v) : v;
        },
        async put(k, v) {
            stats.put++;
            stats.putKeys.push(k);
            if (failIf(k)) throw new Error('KV put failed (injected, persistent)');
            if (transientLeft > 0) { transientLeft--; throw new Error('KV put failed (injected, transient)'); }
            m.set(k, v);
        },
        async delete(k) { m.delete(k); },
        async list(o = {}) {
            const p = o.prefix || '';
            return { keys: [...m.keys()].filter(k => k.startsWith(p)).map(name => ({ name })), list_complete: true };
        }
    };
}

const SECRET = 'unit-test-auth-secret-' + 'x'.repeat(40);

// ---------------- A) 瞬时失败重试 ----------------
console.log('--- A) appendLicenseLog 瞬时失败重试 ---');
{
    const CODE = 'BNZC-AAAA-BBBB-CCCC-DDDD';
    const kv = makeKV({}, { failPutTimes: 2 });
    const r = await appendLicenseLog(kv, CODE, {
        action: 'taobao-cloud-auto-provisioned', operator: '13398000000', ip: '1.2.3.4', detail: '开通成功'
    });
    ok('返回 true（重试后成功）', r === true, '实际=' + r);
    ok('日志键共尝试 3 次 put（2 失败 + 1 成功）',
        kv._stats.putKeys.filter(k => k.startsWith('license_log:')).length === 3,
        JSON.stringify(kv._stats.putKeys));
    const logs = await getLicenseLogs(kv, CODE);
    ok('日志已落库且内容正确', logs.length === 1 && logs[0].action === 'taobao-cloud-auto-provisioned',
        JSON.stringify(logs));
    ok('未遗留缺口标记', !kv._m.has(KV_LICENSE_LOG_GAP_PREFIX + CODE));
}

// ---------------- B) 持续失败 → 缺口标记 ----------------
console.log('\n--- B) 重试仍失败 → 写缺口标记（不再静默） ---');
{
    const CODE = 'BNZC-BBBB-CCCC-DDDD-EEEE';
    const kv = makeKV({}, {
        failPutIf: (k) => k.startsWith('license_log:')   // 注意：不含 license_log_gap:
    });
    // 捕获 console.error：既要断言"确实报错了"（不再静默），又保持测试输出干净
    const errs = [];
    const origErr = console.error;
    console.error = (...a) => { errs.push(a.map(String).join(' ')); };
    let r;
    try {
        r = await appendLicenseLog(kv, CODE, {
            action: 'taobao-local-auto-provisioned', operator: '13398111111', detail: '开通成功'
        });
    } finally { console.error = origErr; }

    const logKeyPuts = kv._stats.putKeys.filter(k => k.startsWith('license_log:')).length;
    const gapKeyPuts = kv._stats.putKeys.filter(k => k.startsWith(KV_LICENSE_LOG_GAP_PREFIX)).length;
    ok('返回 false（如实报告）', r === false, '实际=' + r);
    ok('日志键重试 3 次', logKeyPuts === 3, '实际=' + logKeyPuts);
    ok('缺口标记写 1 次（独立单键，不与日志键共享失败面）', gapKeyPuts === 1, '实际=' + gapKeyPuts);
    ok('日志本体确实没写进', !kv._m.has('license_log:' + CODE));
    ok('★ 不再静默：console.error 已报出', errs.some(l => /LicenseLog|审计/.test(l)), JSON.stringify(errs));
    const gaps = await getLicenseLogGaps(kv, CODE);
    ok('缺口标记已写入', gaps.length === 1, JSON.stringify(gaps));
    ok('缺口标记含原 action 与错误原因',
        gaps.length === 1 && gaps[0].action === 'taobao-local-auto-provisioned' && /injected/.test(gaps[0].error || ''),
        JSON.stringify(gaps[0] || {}));
}

// ---------------- C) 读侧：admin_req 作单一事实源 + 缺口可见 ----------------
console.log('\n--- C) GET /license/logs 读侧叠加 ---');
const CODE3 = 'BNZC-CCCC-DDDD-EEEE-FFFF';
const RID = 'REQ-0MTESTABC-1234';
function seedKV(withGap) {
    const seed = {
        ['license_log:' + CODE3]: JSON.stringify([
            { action: 'generate', time: '2026-10-09T12:16:57.000Z', ip: '1.1.1.1', operator: 'hkt_root', detail: 'batch' },
            { action: 'cross-code-detach', time: '2026-10-09T12:26:38.000Z', ip: '2.2.2.2', operator: '13398000000', detail: 'x' }
            // ★ 故意不放 taobao-cloud-auto-provisioned —— 复现真机「台账有、日志缺」
        ]),
        ['taobao_auto_code:' + CODE3]: JSON.stringify({ requestId: RID, phone: '13398000000', at: '2026-10-09T12:26:38.000Z' }),
        ['admin_req:' + RID]: JSON.stringify({
            requestId: RID, status: 'activated', orderSource: 'taobao-cloud-auto',
            resolvedBy: 'system:taobao-cloud-auto', autoSource: 'taobao-cloud-code',
            autoNameSource: 'fallback-collision', appMode: 'cloud', appModeCarrier: '',
            clinicName: '中医诊所·0000', phone: '13398000000', licenseCode: CODE3,
            createdAt: '2026-10-09T12:26:38.739Z', resolvedAt: '2026-10-09T12:26:38.739Z'
        })
    };
    if (withGap) {
        seed[KV_LICENSE_LOG_GAP_PREFIX + CODE3] = JSON.stringify({
            action: 'taobao-cloud-auto-provisioned', time: '2026-10-09T12:26:38.739Z',
            operator: '13398000000', ip: '2.2.2.2', detail: 'x',
            error: 'KV put failed (injected)', attempts: 3, gapAt: '2026-10-09T12:27:00.000Z'
        });
    }
    return makeKV(seed);
}
async function callLogs(kv, token) {
    const env = { KV: kv, AUTH_SECRET: SECRET };
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    const req = new Request('https://tcm-prescription-system.pages.dev/api/license/logs?code=' + CODE3, { headers });
    const res = await logsOnRequest({ env, request: req, waitUntil: () => {} });
    let body = null; try { body = await res.json(); } catch (_) {}
    return { status: res.status, body: body || {} };
}
{
    const kv = seedKV(false);
    const env = { KV: kv, AUTH_SECRET: SECRET };
    const token = await signToken({ username: 'root', role: 'platform_admin' }, env, 3600 * 1000);
    const { status, body } = await callLogs(kv, token);
    ok('HTTP 200', status === 200, 'status=' + status + ' ' + JSON.stringify(body).slice(0, 120));
    ok('license_log 原始条数 = 2（模拟成功行丢失）', body.rawLogCount === 2, '实际=' + body.rawLogCount);
    ok('★ 叠加了 admin_req 台账条目（事实源可见）',
        Array.isArray(body.logs) && body.logs.some(l => l.action === 'taobao-cloud-auto-ledger'),
        JSON.stringify((body.logs || []).map(l => l.action)));
    ok('台账字段解析正确（requestId/来源/诊所/名源）',
        body.auditLedger && body.auditLedger.requestId === RID
        && body.auditLedger.orderSource === 'taobao-cloud-auto'
        && body.auditLedger.clinicName === '中医诊所·0000'
        && body.auditLedger.nameSource === 'fallback-collision',
        JSON.stringify(body.auditLedger || {}));
    ok('无缺口时 auditReconciled = true', body.auditReconciled === true, '实际=' + body.auditReconciled);
    ok('无缺口时 auditGaps 为空数组', Array.isArray(body.auditGaps) && body.auditGaps.length === 0);
    ok('台账条目排在最前（客服第一眼可见）', body.logs[0] && body.logs[0].action === 'taobao-cloud-auto-ledger',
        body.logs[0] && body.logs[0].action);
}
{
    const kv = seedKV(true);
    const env = { KV: kv, AUTH_SECRET: SECRET };
    const token = await signToken({ username: 'root', role: 'platform_admin' }, env, 3600 * 1000);
    const { body } = await callLogs(kv, token);
    ok('★ 缺口被显式叠加为 audit-gap 条目',
        Array.isArray(body.logs) && body.logs.some(l => l.action === 'audit-gap'),
        JSON.stringify((body.logs || []).map(l => l.action)));
    ok('gap 条目文案含"以台账为准"的指引',
        (body.logs || []).some(l => l.action === 'audit-gap' && /台账为准/.test(l.detail || '')),
        JSON.stringify((body.logs || []).filter(l => l.action === 'audit-gap').map(l => l.detail)));
    ok('auditGaps 非空（供前端告警）', Array.isArray(body.auditGaps) && body.auditGaps.length === 1);
    ok('auditReconciled = false（审计不自洽，必须可被程序判定）', body.auditReconciled === false);
}

// ---------------- D) 鉴权闸不回归 ----------------
console.log('\n--- D) 鉴权闸 ---');
{
    const kv = seedKV(false);
    const { status } = await callLogs(kv, '');
    ok('无 token → 403', status === 403, 'status=' + status);
}

console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
process.exit(fail === 0 ? 0 : 1);
