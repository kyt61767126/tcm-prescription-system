#!/usr/bin/env node
// KV list 429 治理回归：safeListPage 熔断 / 旧缓存兜底 / 跨 isolate 标记 / Proxy 自动缓存
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');
const kvModUrl = pathToFileURL(path.join(__dirname, '..', 'functions', 'api', '_lib', 'kv.js')).href;

function makeKV() {
    const store = new Map();
    const stat = { list: 0, get: 0, put: 0, failList: false };
    return {
        stat, store,
        async get(k) { stat.get++; return store.has(k) ? store.get(k) : null; },
        async put(k, v) { stat.put++; store.set(k, v); },
        async list(opts) {
            stat.list++;
            if (stat.failList) { const e = new Error('KV list: 429 temporarily blocked'); e.status = 429; throw e; }
            return { keys: [{ name: 'k1' }], list_complete: true, cursor: '' };
        }
    };
}

(async () => {
    const fresh = (q) => import(kvModUrl + '?' + q);
    const { safeListPage } = await fresh('m1');
    let pass = 0, fail = 0;
    const t = (n, c, x) => { if (c) { pass++; console.log('  [PASS] ' + n); } else { fail++; console.error('  [FAIL] ' + n + (x ? ' [' + x + ']' : '')); } };

    // 1) ttl 缓存：同 opts 只打一次 list
    {
        const kv = makeKV();
        const p1 = await safeListPage(kv, { prefix: 'a' }, { ttlMs: 60000 });
        const p2 = await safeListPage(kv, { prefix: 'a' }, { ttlMs: 60000 });
        t('ttl 缓存命中（list 只调用 1 次）', kv.stat.list === 1 && p1.keys[0].name === 'k1', 'list=' + kv.stat.list);
        t('同实例返回同一页对象', p1 === p2);
    }

    // 2) 429 且已有缓存 → 返回旧数据，不抛错，并写熔断标记
    {
        const kv = makeKV();
        await safeListPage(kv, { prefix: 'b' }, { ttlMs: 60000 });
        kv.stat.failList = true;
        // 清掉过期：直接推进时间不可行，改为新 opts 先失败但无缓存 → 抛错 + 标记
        let threw = false;
        try { await safeListPage(kv, { prefix: 'c' }, { ttlMs: 60000 }); } catch (e) { threw = true; t('429 无缓存 → 抛 429 熔断错误', e.status === 429, e.status); }
        t('429 无缓存确实抛出', threw === true);
        t('429 后写入 KV 熔断标记', kv.store.has('sys:kv_list_blocked_until') && kv.stat.put >= 1, 'put=' + kv.stat.put);
        // 3) 标记生效后，同 isolate 新 opts 直接走熔断（不再调用 list）
        const before = kv.stat.list;
        let threw2 = false;
        try { await safeListPage(kv, { prefix: 'd' }, { ttlMs: 60000 }); } catch (e) { threw2 = true; }
        t('熔断期内不再请求 list（list 计数不变）', threw2 && kv.stat.list === before, 'list=' + kv.stat.list);
    }

    // 4) 有缓存时 429 → 旧数据兜底（独立模块实例，避免前序熔断状态污染）
    {
        const { safeListPage } = await fresh('m4');
        const kv = makeKV();
        await safeListPage(kv, { prefix: 'e' }, { ttlMs: 1 });
        await new Promise(r => setTimeout(r, 5));
        kv.stat.failList = true;
        const p = await safeListPage(kv, { prefix: 'e' }, { ttlMs: 1 });
        t('缓存过期后 429 → 返回上次成功页（stale 兜底）', p && p.keys[0].name === 'k1');
    }

    // 5) getKV() 返回的绑定，kv.list 自动缓存（Proxy）
    {
        const { getKV } = await fresh('m5');
        const env = { KV: makeKV() };
        const kv = getKV(env);
        await kv.list({ prefix: 'p' });
        await kv.list({ prefix: 'p' });
        t('getKV Proxy：list 自动 60s 缓存（底层只调 1 次）', env.KV.stat.list === 1, 'list=' + env.KV.stat.list);
        t('getKV Proxy：同一绑定返回同一代理', getKV(env) === kv);
        t('getKV Proxy：get 正常透传', (await kv.get('none')) === null);
    }

    console.log('==============================');
    console.log('KV list 治理测试：' + pass + ' PASS / ' + fail + ' FAIL');
    if (fail) process.exit(1);
})().catch(e => { console.error('[FATAL]', e); process.exit(2); });
