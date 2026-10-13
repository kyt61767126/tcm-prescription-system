// kv-list-quota-test.mjs — 2026-10-13 KV list 免费额度治理回归
//   ① kv.js safeListPage/listAllKeys：缓存 + 429 熔断（critical 豁免）
//   ② order_index：写侧建索引/删侧移除/脏值重建/空结果不固化
//   ③ admin-list onRequest：pending/pending_payment 全链路 kv.list 调用 = 0
import assert from 'node:assert';
import { safeListPage, listAllKeys } from '../../functions/api/_lib/kv.js';
import {
    bindOrderToRequest, deleteAdminRequest, listOrderKeys
} from '../../functions/api/license/_lib/license-write-service.js';
import { onRequest as adminListHandler } from '../../functions/api/license/admin-list.js';

let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); console.log('PASS', name); pass++; };

// ----------------------------------------------------------------------------
// Mock KV：Map 存储 + prefix/cursor/limit list + 调用计数 + 429 注入
// ----------------------------------------------------------------------------
function makeMockKv(opts = {}) {
    const m = new Map();
    return {
        _m: m,
        listCalls: 0,
        getCalls: 0,
        putCalls: 0,
        failListWith: opts.failListWith || null,   // () => throw
        async get(key, type) {
            this.getCalls++;
            if (!m.has(key)) return null;
            const v = m.get(key);
            if (type === 'json') { try { return JSON.parse(v); } catch (_) { return null; } }
            return v;
        },
        async put(key, val) { this.putCalls++; m.set(key, String(val)); },
        async delete(key) { this.putCalls++; m.delete(key); },
        async list(o = {}) {
            this.listCalls++;
            if (this.failListWith) this.failListWith();
            const limit = o.limit || 1000;
            let names = [...m.keys()];
            if (o.prefix) names = names.filter(n => n.startsWith(o.prefix));
            names.sort();
            let start = 0;
            if (o.cursor) start = names.indexOf(o.cursor) + 1;
            const slice = names.slice(start, start + limit);
            return {
                keys: slice.map(name => ({ name })),
                list_complete: start + limit >= names.length,
                cursor: start + limit < names.length ? slice[slice.length - 1] : undefined
            };
        },
        seed(obj) { for (const [k, v] of Object.entries(obj)) m.set(k, typeof v === 'string' ? v : JSON.stringify(v)); }
    };
}

const quotaErr = () => { const e = new Error('KV list exceeded free quota'); e.status = 429; throw e; };

// ============================================================================
// A. kv.js 保险丝
// ============================================================================
{
    const kv = makeMockKv();
    kv.seed({ 'a:1': '1', 'a:2': '2', 'b:1': '3' });
    const p1 = await safeListPage(kv, { prefix: 'a:' }, { ttlMs: 60000 });
    const p2 = await safeListPage(kv, { prefix: 'a:' }, { ttlMs: 60000 });
    ok('A1 同参数 ttl 内只打 1 次 list', p1.keys.length === 2 && p2.keys.length === 2 && kv.listCalls === 1);

    const p3 = await safeListPage(kv, { prefix: 'b:' }, { ttlMs: 60000 });
    ok('A1b 不同 prefix 各自缓存', p3.keys.length === 1 && kv.listCalls === 2);
}

{
    // 注意：熔断是 isolate 模块级状态，故非配额用例/分页用例必须排在熔断用例之前
    const kv = makeMockKv({ failListWith: () => { throw new Error('boom 500'); } });
    await assert.rejects(() => safeListPage(kv, { prefix: 'x:' }), /boom/);
    await assert.rejects(() => safeListPage(kv, { prefix: 'x:' }), /boom/);
    ok('A3 非配额错误不触发熔断（两次都真实请求）', kv.listCalls === 2);
}

{
    // 分页：1500 键 → 2 页
    const kv = makeMockKv();
    const seed = {};
    for (let i = 0; i < 1500; i++) seed['k:' + String(i).padStart(4, '0')] = '1';
    kv.seed(seed);
    const all = await listAllKeys(kv, 'k:', { ttlMs: 60000 });
    ok('A4 listAllKeys 自动翻页拼全量', all.length === 1500 && kv.listCalls === 2);
    const all2 = await listAllKeys(kv, 'k:', { ttlMs: 60000 });
    const all3 = await listAllKeys(kv, 'k:', { ttlMs: 60000 });
    ok('A4b 全量结果 ttl 缓存零追加 list', all2.length === 1500 && all3.length === 1500 && kv.listCalls === 2);
}

// ============================================================================
// B. order_index（熔断用例 A2 统一放文件末尾，避免模块级熔断污染本组）
// ============================================================================
{
    const O1 = 'BNZC-TB-202601010001-AAA1';
    const O2 = 'BNZC-TB-202601010002-BBB2';
    const O3 = 'BNZC-TB-202601030003-CCC3';
    const O4 = 'BNZC-TB-202601040004-DDD4';
    const kv = makeMockKv();
    kv.seed({ ['order:' + O1]: { requestId: 'r-old1' }, ['order:' + O2]: { requestId: 'r-old2' } });
    // 首次写订单：索引缺失 → 全扫一次建立（含存量 2 + 新 1）
    await bindOrderToRequest(kv, O3, 'r-new', '13300000001');
    ok('B1 首写触发 1 次全扫', kv.listCalls === 1);
    const idx1 = JSON.parse(kv._m.get('order_index'));
    ok('B1b 索引含存量+新键', idx1.length === 3 && idx1.includes('order:' + O3));

    // 再写一单：索引直读直写，零 list
    await bindOrderToRequest(kv, O4, 'r-new2', '13300000002');
    ok('B2 索引存在后写单零 list', kv.listCalls === 1);
    const keys = await listOrderKeys(kv);
    ok('B2b listOrderKeys 索引直读零 list', keys.length === 4 && kv.listCalls === 1);
}

{
    const O1 = 'BNZC-TB-202601010001-AAA1';
    const O2 = 'BNZC-TB-202601020002-BBB2';
    // 脏索引（含非法元素）→ 写侧全扫重建
    const kv = makeMockKv();
    kv.seed({
        'order_index': ['order:' + O1, 'evil-key'],
        ['order:' + O1]: { requestId: 'r1' }
    });
    await bindOrderToRequest(kv, O2, 'r2', '13300000003');
    const idx = JSON.parse(kv._m.get('order_index'));
    ok('B3 脏索引触发重建', kv.listCalls === 1 && idx.includes('order:' + O2) && !idx.includes('evil-key'));

    // 读侧脏索引同样重建（脏键 order:ZZ9 非法格式但前缀扫描仍应捞出）
    const kv2 = makeMockKv();
    kv2.seed({ 'order_index': ['junk'], 'order:ZZ9': { requestId: 'r' } });
    const got = await listOrderKeys(kv2);
    ok('B3b 读侧脏索引全扫重建', got.includes('order:ZZ9') && kv2.listCalls === 1);
}

{
    // 全扫空结果不写索引（list 失败与真空不可区分）
    const kv = makeMockKv();
    const got = await listOrderKeys(kv);
    ok('B4 空结果不固化索引', got.length === 0 && kv._m.has('order_index') === false && kv.listCalls === 1);
    const got2 = await listOrderKeys(kv);
    ok('B4b 下次仍全扫（不自锁为空）', got2.length === 0 && kv.listCalls === 2);
}

{
    // deleteAdminRequest：有 orderNo → 直删 + 索引移除，零 list
    const kv = makeMockKv();
    kv.seed({
        'admin_req:r1': { requestId: 'r1', status: 'cancelled', orderNo: 'AAA111' },
        'order_index': ['order:AAA111', 'order:BBB222'],
        'order:AAA111': { requestId: 'r1' },
        'order:BBB222': { requestId: 'r2' }
    });
    await deleteAdminRequest(kv, 'r1');
    const idx = JSON.parse(kv._m.get('order_index'));
    ok('B5 直删订单并移出索引', !kv._m.has('order:AAA111') && !idx.includes('order:AAA111') && idx.includes('order:BBB222'));
    ok('B5b 零 list', kv.listCalls === 0);
}

{
    // deleteAdminRequest：无 orderNo → 经索引枚举找匹配 requestId（零 list）
    const kv = makeMockKv();
    kv.seed({
        'admin_req:rX': { requestId: 'rX', status: 'cancelled' },
        'order_index': ['order:AAA111', 'order:BBB222'],
        'order:AAA111': { requestId: 'rOTHER' },
        'order:BBB222': { requestId: 'rX' }
    });
    await deleteAdminRequest(kv, 'rX');
    ok('B6 兜底经索引删匹配订单', !kv._m.has('order:BBB222') && kv._m.has('order:AAA111'));
    const idx = JSON.parse(kv._m.get('order_index'));
    ok('B6b 索引同步移除', !idx.includes('order:BBB222') && idx.includes('order:AAA111'));
    ok('B6c 零 list', kv.listCalls === 0);
}

// ============================================================================
// C. admin-list onRequest 端到端（自签 platform_admin token）
// ============================================================================
async function signToken(env, u) {
    const body = { u, r: 'platform_admin', c: null, e: Date.now() + 3600000, v: 1, k: 'web' };
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.AUTH_SECRET),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key,
        new TextEncoder().encode(JSON.stringify({ u: body.u, r: body.r, c: body.c, e: body.e, v: body.v, k: body.k }))));
    body.s = [...sig].map(b => b.toString(16).padStart(2, '0')).join('');
    return btoa(JSON.stringify(body));
}

async function callAdminList(kv, token, qs) {
    const env = { KV: kv, AUTH_SECRET: 'unit-test-secret-20261013' };
    const req = new Request('https://tcm-prescription-system.pages.dev/api/license/admin-list?' + qs, {
        headers: { Authorization: 'Bearer ' + token }
    });
    const res = await adminListHandler({ request: req, env });
    return { status: res.status, body: await res.json() };
}

{
    const kv = makeMockKv();
    const now = Date.now();
    const fresh = { requestId: 'r-pay', status: 'pending_payment', orderNo: 'PAY001', submittedAt: new Date(now - 3600e3).toISOString(), clinicName: '测试诊所' };
    const expired = { requestId: 'r-oldpay', status: 'pending_payment', orderNo: 'OLD001', submittedAt: new Date(now - 9 * 86400e3).toISOString() };
    kv.seed({
        'order_index': ['order:PAY001', 'order:OLD001'],
        'order:PAY001': { requestId: 'r-pay', phone: '' },
        'order:OLD001': { requestId: 'r-oldpay', phone: '' },
        'admin_req:r-pay': fresh,
        'admin_req:r-oldpay': expired,
        'admin_req_index': []
    });
    const env = { AUTH_SECRET: 'unit-test-secret-20261013' };
    const token = await signToken(env, 'hkt_tcm_root2026');

    const r = await callAdminList(kv, token, 'status=pending_payment&limit=50');
    ok('C1 pending_payment 200', r.status === 200 && r.body.success === true);
    ok('C1b 只返回有效待付款单（过期单被惰性清理）', r.body.count === 1 && r.body.requests[0].requestId === 'r-pay');
    ok('C1c 过期单三键清理（admin_req/order）', !kv._m.has('admin_req:r-oldpay') && !kv._m.has('order:OLD001'));
    const idxAfter = JSON.parse(kv._m.get('order_index'));
    ok('C1d 过期单同步移出 order_index', !idxAfter.includes('order:OLD001') && idxAfter.includes('order:PAY001'));
    ok('C1e ★全程零 kv.list', kv.listCalls === 0);
}

{
    const kv = makeMockKv();
    const now = Date.now();
    kv.seed({
        'admin_req_index': ['r-main'],
        'admin_req:r-main': { requestId: 'r-main', status: 'pending', submittedAt: new Date(now).toISOString() },
        'order_index': ['order:MAIN01', 'order:ORPHAN'],
        'order:MAIN01': { requestId: 'r-main' },
        // 孤儿单：req_index 漏登记，但 order 映射在，真实 P0 场景
        'order:ORPHAN': { requestId: 'r-orphan' },
        'admin_req:r-orphan': { requestId: 'r-orphan', status: 'pending', submittedAt: new Date(now - 1000).toISOString() }
    });
    const token = await signToken({ AUTH_SECRET: 'unit-test-secret-20261013' }, 'hkt_tcm_root2026');
    const r = await callAdminList(kv, token, 'status=pending&limit=500');
    const ids = (r.body.requests || []).map(x => x.requestId).sort();
    ok('C2 pending 主路径+孤儿兜底合并', r.status === 200 && ids.length === 2 && ids.includes('r-orphan') && ids.includes('r-main'));
    ok('C2b ★零 kv.list', kv.listCalls === 0);

    // 模拟管理台角标 5 轮（pending + pending_payment 各 5 次）
    for (let i = 0; i < 5; i++) {
        await callAdminList(kv, token, 'status=pending&limit=500');
        await callAdminList(kv, token, 'status=pending_payment&limit=50');
    }
    ok('C3 ★10 次角标轮询后 list 调用仍为 0', kv.listCalls === 0);
}

// ============================================================================
// A2. 配额熔断（必须最后执行：模块级熔断会持续 30 分钟）
// ============================================================================
{
    const kv = makeMockKv({ failListWith: quotaErr });
    await assert.rejects(() => safeListPage(kv, { prefix: 'x:' }), /quota/);
    // 熔断后：非 critical 不再真实请求，直接抛 circuit
    let threw = null;
    try { await safeListPage(kv, { prefix: 'x:' }); } catch (e) { threw = e; }
    ok('A2 429 后非 critical 熔断不打 API', threw && threw.circuit === true && kv.listCalls === 1);
    // critical 豁免：继续真实请求（继续失败，但确实打了）
    await assert.rejects(() => safeListPage(kv, { prefix: 'x:' }, { critical: true }), /quota/);
    ok('A2b critical 熔断期仍真实请求', kv.listCalls === 2);
}

console.log(`\n==== kv-list-quota-test: ${pass} 断言全部通过 ====`);
