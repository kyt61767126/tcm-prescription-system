#!/usr/bin/env node
// API 响应缓存中间件回归：命中/未命中/透传/401 不缓存/手动刷新/鉴权隔离
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');
const modUrl = pathToFileURL(path.join(__dirname, '..', 'functions', 'api', '_middleware.js')).href;

function makeKV() {
    const store = new Map();
    const stat = { get: 0, put: 0 };
    return {
        stat, store,
        async get(k, type) {
            stat.get++;
            if (!store.has(k)) return null;
            const v = store.get(k);
            return type === 'json' ? JSON.parse(v) : v;
        },
        async put(k, v) { stat.put++; store.set(k, v); }
    };
}
function mkCtx(kv, { path: p = '/api/license/admin-list', method = 'GET', auth = 'Bearer t1', body = '', headers = {}, nextStatus = 200, nextBody = '{"success":true,"n":1}' } = {}) {
    const h = new Headers();
    if (auth) h.set('Authorization', auth);
    if (body) h.set('Content-Type', 'application/json');
    for (const [k, v] of Object.entries(headers)) h.set(k, v);
    const request = new Request('https://x.pages.dev' + p, { method, headers: h, body: method === 'POST' ? body : undefined });
    const calls = { next: 0 };
    return {
        calls,
        request,
        env: { KV: kv },
        waitUntil: (p) => { p.catch(() => {}); },
        next: async () => {
            calls.next++;
            return new Response(nextBody, { status: nextStatus, headers: { 'Content-Type': 'application/json' } });
        }
    };
}
(async () => {
    const { onRequest } = await import(modUrl);
    let pass = 0, fail = 0;
    const t = (n, c, x) => { if (c) { pass++; console.log('  [PASS] ' + n); } else { fail++; console.error('  [FAIL] ' + n + (x ? ' [' + x + ']' : '')); } };

    // 1) 首次 MISS 真执行 + 写入缓存；第二次 HIT 不再执行
    {
        const kv = makeKV();
        const c1 = mkCtx(kv);
        const r1 = await onRequest(c1);
        t('首次 MISS 真执行 next', c1.calls.next === 1 && r1.headers.get('X-Resp-Cache') === 'MISS');
        t('首次写入缓存', kv.stat.put === 1);
        const c2 = mkCtx(kv);
        const r2 = await onRequest(c2);
        const j = await r2.json();
        t('二次 HIT 不再执行 next', c2.calls.next === 0 && r2.headers.get('X-Resp-Cache') === 'HIT');
        t('HIT 返回缓存体', j.success === true && j.n === 1);
    }
    // 2) 未在白名单 → 透传不缓存
    {
        const kv = makeKV();
        const c = mkCtx(kv, { path: '/api/license/claim' });
        await onRequest(c);
        t('非白名单路径透传（不写缓存）', c.calls.next === 1 && kv.stat.put === 0);
    }
    // 3) 401 不缓存
    {
        const kv = makeKV();
        const c = mkCtx(kv, { nextStatus: 401, nextBody: '{"success":false}' });
        const r = await onRequest(c);
        t('401 不缓存', r.status === 401 && kv.stat.put === 0);
    }
    // 4) 手动刷新 x-no-cache 绕过缓存
    {
        const kv = makeKV();
        await onRequest(mkCtx(kv));
        const c = mkCtx(kv, { headers: { 'x-no-cache': '1' } });
        await onRequest(c);
        t('x-no-cache 强制真实执行', c.calls.next === 1);
    }
    // 5) 不同 Authorization 不串缓存
    {
        const kv = makeKV();
        await onRequest(mkCtx(kv, { auth: 'Bearer admin1' }));
        const c = mkCtx(kv, { auth: 'Bearer admin2' });
        await onRequest(c);
        t('不同管理员 token 缓存隔离', c.calls.next === 1);
    }
    // 6) POST 参数不同不串缓存
    {
        const kv = makeKV();
        await onRequest(mkCtx(kv, { method: 'POST', body: '{"page":1}' }));
        const c = mkCtx(kv, { method: 'POST', body: '{"page":2}' });
        await onRequest(c);
        t('POST 不同参数缓存隔离', c.calls.next === 1);
    }
    console.log('==============================');
    console.log('API 缓存中间件测试：' + pass + ' PASS / ' + fail + ' FAIL');
    if (fail) process.exit(1);
})().catch(e => { console.error('[FATAL]', e); process.exit(2); });
