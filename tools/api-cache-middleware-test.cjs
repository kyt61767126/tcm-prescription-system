#!/usr/bin/env node
// API 响应缓存中间件（D1 主存 + KV 兼容回退）回归
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');
const modUrl = pathToFileURL(path.join(__dirname, '..', 'functions', 'api', '_middleware.js')).href;

function makeKV() {
    const store = new Map();
    const stat = { get: 0, put: 0 };
    return {
        stat, store,
        async get(k, type) { stat.get++; if (!store.has(k)) return null; const v = store.get(k); return type === 'json' ? JSON.parse(v) : v; },
        async put(k, v) { stat.put++; store.set(k, v); }
    };
}
function makeDB() {
    const rows = new Map();
    const stat = { select: 0, insert: 0, delete: 0 };
    return {
        stat, rows,
        prepare(sql) {
            const s = sql.trim();
            const api = {
                bind(...args) {
                    return {
                        async first() {
                            stat.select++;
                            const r = rows.get(args[0]);
                            return r ? { ...r } : null;
                        },
                        async run() {
                            if (/^INSERT/i.test(s)) {
                                stat.insert++;
                                rows.set(args[0], { status: args[1], ct: args[2], acao: args[3], body: args[4], expires_at: args[5] });
                            } else if (/^DELETE/i.test(s)) {
                                stat.delete++;
                            }
                            return { success: true };
                        }
                    };
                }
            };
            return api;
        }
    };
}
function mkCtx({ kv, db, path: p = '/api/license/admin-list', method = 'GET', auth = 'Bearer t1', body = '', headers = {}, nextStatus = 200, nextBody = '{"success":true,"n":1}' } = {}) {
    const h = new Headers();
    if (auth) h.set('Authorization', auth);
    if (body) h.set('Content-Type', 'application/json');
    for (const [k, v] of Object.entries(headers)) h.set(k, v);
    const request = new Request('https://x.pages.dev' + p, { method, headers: h, body: method === 'POST' ? body : undefined });
    const calls = { next: 0 };
    return {
        calls, request,
        env: { KV: kv, DB: db },
        waitUntil: (pr) => { pr.catch(() => {}); },
        next: async () => { calls.next++; return new Response(nextBody, { status: nextStatus, headers: { 'Content-Type': 'application/json' } }); }
    };
}
(async () => {
    const { onRequest } = await import(modUrl);
    let pass = 0, fail = 0;
    const t = (n, c, x) => { if (c) { pass++; console.log('  [PASS] ' + n); } else { fail++; console.error('  [FAIL] ' + n + (x ? ' [' + x + ']' : '')); } };

    // 1) MISS → D1 写入；二次 HIT 走 D1 不执行 next
    {
        const kv = makeKV(), db = makeDB();
        const c1 = mkCtx({ kv, db });
        const r1 = await onRequest(c1);
        await new Promise(r => setTimeout(r, 10));
        t('首次 MISS 真执行', c1.calls.next === 1 && r1.headers.get('X-Resp-Cache') === 'MISS');
        t('首次写入 D1（不再写 KV）', db.stat.insert === 1 && kv.stat.put === 0, 'insert=' + db.stat.insert + ' kvput=' + kv.stat.put);
        const c2 = mkCtx({ kv, db });
        const r2 = await onRequest(c2);
        const j = await r2.json();
        t('二次 HIT 来自 D1（不执行 next）', c2.calls.next === 0 && r2.headers.get('X-Resp-Cache') === 'HIT');
        t('HIT 返回缓存体', j.success === true && j.n === 1);
    }
    // 2) 非白名单透传
    {
        const kv = makeKV(), db = makeDB();
        const c = mkCtx({ kv, db, path: '/api/license/claim' });
        await onRequest(c);
        t('非白名单透传，不写 D1', c.calls.next === 1 && db.stat.insert === 0);
    }
    // 3) 401 不缓存
    {
        const kv = makeKV(), db = makeDB();
        const r = await onRequest(mkCtx({ kv, db, nextStatus: 401, nextBody: '{"success":false}' }));
        t('401 不缓存', r.status === 401 && db.stat.insert === 0);
    }
    // 4) x-no-cache 绕过
    {
        const kv = makeKV(), db = makeDB();
        await onRequest(mkCtx({ kv, db }));
        const c = mkCtx({ kv, db, headers: { 'x-no-cache': '1' } });
        await onRequest(c);
        t('x-no-cache 强制真实执行', c.calls.next === 1);
    }
    // 5) token 隔离
    {
        const kv = makeKV(), db = makeDB();
        await onRequest(mkCtx({ kv, db, auth: 'Bearer admin1' }));
        const c = mkCtx({ kv, db, auth: 'Bearer admin2' });
        await onRequest(c);
        t('不同管理员 token 缓存隔离', c.calls.next === 1);
    }
    // 6) POST body 隔离
    {
        const kv = makeKV(), db = makeDB();
        await onRequest(mkCtx({ kv, db, method: 'POST', body: '{"page":1}' }));
        const c = mkCtx({ kv, db, method: 'POST', body: '{"page":2}' });
        await onRequest(c);
        t('POST 不同参数缓存隔离', c.calls.next === 1);
    }
    // 7) D1 不可用 → KV 回退写 + 回退读
    {
        const kv = makeKV();
        const c1 = mkCtx({ kv, db: null });
        await onRequest(c1);
        t('D1 不可用 → 写 KV 兼容缓存', kv.stat.put === 1);
        const c2 = mkCtx({ kv, db: null });
        await onRequest(c2);
        t('D1 不可用 → KV 命中', c2.calls.next === 0 && kv.stat.get >= 1);
    }
    // 8) D1 里缓存已过期 → 重新执行
    {
        const kv = makeKV(), db = makeDB();
        await onRequest(mkCtx({ kv, db }));
        for (const row of db.rows.values()) row.expires_at = Date.now() - 1000;
        const c = mkCtx({ kv, db });
        await onRequest(c);
        t('D1 缓存过期 → 重新执行 next', c.calls.next === 1);
    }
    console.log('==============================');
    console.log('API 缓存中间件（D1）测试：' + pass + ' PASS / ' + fail + ' FAIL');
    if (fail) process.exit(1);
})().catch(e => { console.error('[FATAL]', e); process.exit(2); });
