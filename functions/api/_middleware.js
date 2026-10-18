// ============================================================================
//  functions/api/_middleware.js — 管理端「只读重扫描」响应缓存中间件
//
//  ★ 2026-10-18 KV list 免费额度（1000/天）治理第二步：
//    管理后台的待办角标/审计/风险/统计页会做 KV list 全表扫描，轮询/切页
//    会反复消耗 list 额度（2026-10-18 已实测打满触发 429）。这里在 API 入口
//    对**白名单内的只读管理接口**做响应级缓存（默认 TTL 2~10 分钟）：
//      · 同一管理员 + 同一参数在 TTL 内只真正执行一次 → list 消耗大幅下降；
//      · 缓存存 KV 单键（get/put，不走 list；get 配额 10 万/天）；
//      · 只缓存 200 + JSON 响应；带 Set-Cookie / 非白名单 / 写操作一律透传；
//      · 支持 `x-no-cache: 1` 或 `?fresh=1` 强制刷新（管理员手动刷新时用）。
//    注意：这是"减少重复扫描"，不是替代授权/鉴权——缓存 key 含 Authorization
//    哈希，不同 token 不串数据；鉴权失败（401/403）永不缓存。
// ============================================================================

import { getKV } from './_lib/kv.js';

// 路径 → TTL 秒（仅这些只读接口做响应缓存；写接口/登录/激活绝不在内）
const CACHEABLE = new Map([
    ['/api/license/admin-list', 120],        // 待办角标（轮询最频繁）
    ['/api/license/admin-data-audit', 600],  // 全量数据审计（list 消耗大户）
    ['/api/license/admin-risk', 300],        // 风险扫描
    ['/api/license/admin-usage', 300],       // 用量统计
    ['/api/stats/funnel', 600]               // 漏斗统计
]);

const CACHE_PREFIX = 'resp_cache:';
const MAX_CACHE_BODY = 300 * 1024; // 300KB，超过不缓存

function hex(buf) {
    return Array.from(new Uint8Array(buf)).map(x => x.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return hex(digest);
}

export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);
    const ttl = CACHEABLE.get(url.pathname);
    const method = request.method;
    // 只处理白名单路径 + GET/POST；其余（含 OPTIONS 预检）原样透传
    if (!ttl || (method !== 'GET' && method !== 'POST')) return context.next();
    const noCache = request.headers.get('x-no-cache') === '1' || url.searchParams.get('fresh') === '1';
    if (noCache) return context.next();

    const kv = getKV(context);
    if (!kv) return context.next();

    const auth = request.headers.get('Authorization') || '';
    let bodyText = '';
    try {
        if (method === 'POST') bodyText = await request.clone().text();
    } catch (_) { return context.next(); }

    let cacheKey;
    try {
        const hash = await sha256Hex(url.pathname + '?' + url.search + '|' + auth + '|' + bodyText);
        cacheKey = CACHE_PREFIX + hash;
    } catch (_) { return context.next(); }

    try {
        const hit = await kv.get(cacheKey, 'json');
        if (hit && hit.body) {
            const headers = new Headers();
            headers.set('Content-Type', hit.ct || 'application/json; charset=utf-8');
            headers.set('X-Resp-Cache', 'HIT');
            if (hit.acao) headers.set('Access-Control-Allow-Origin', hit.acao);
            else headers.set('Access-Control-Allow-Origin', '*');
            if (hit.acao) headers.set('Vary', 'Origin');
            return new Response(hit.body, { status: hit.status || 200, headers });
        }
    } catch (_) { /* 缓存读失败 → 走真实请求 */ }

    const res = await context.next();
    try {
        if (res && res.status === 200) {
            const ct = res.headers.get('Content-Type') || '';
            const isJson = ct.includes('application/json');
            const hasCookie = res.headers.has('Set-Cookie');
            if (isJson && !hasCookie) {
                const text = await res.clone().text();
                if (text && text.length <= MAX_CACHE_BODY) {
                    const payload = {
                        body: text,
                        ct: ct,
                        status: res.status,
                        acao: res.headers.get('Access-Control-Allow-Origin') || ''
                    };
                    const p = kv.put(cacheKey, JSON.stringify(payload), { expirationTtl: ttl + 60 });
                    if (context.waitUntil) context.waitUntil(p.catch(() => {}));
                    else await p.catch(() => {});
                }
            }
        }
    } catch (_) { /* 写缓存失败不影响响应 */ }

    try { res.headers.set('X-Resp-Cache', 'MISS'); } catch (_) {}
    return res;
}
