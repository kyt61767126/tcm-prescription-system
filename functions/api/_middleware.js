// ============================================================================
//  functions/api/_middleware.js — 管理端「只读重扫描」响应缓存中间件（D1 主存）
//
//  ★ 2026-10-18 KV list 免费额度（1000/天）治理：
//    管理后台待办角标/审计/风险/统计页会做 KV list 全表扫描，轮询/切页反复
//    消耗 list 额度（当日实锤 429）。这里对白名单只读管理接口做响应缓存：
//      · 缓存主存 = **D1**（免费 5M 读/10万写/天；本表只存 JSON 快照），
//        避免把缓存写也压到 KV 的 1000 写/天 上；KV 仅作旧缓存兼容读；
//      · 同一路径+查询+Authorization 哈希+body 在 TTL 内只真执行一次；
//      · 只缓存 200 + JSON；401/403/带 Set-Cookie/写操作一律透传；
//      · `x-no-cache: 1` 或 `?fresh=1` 强制刷新（管理员手动刷新用）。
//    说明：这是"减少重复扫描"层面，不改变任何授权/鉴权语义。
// ============================================================================

import { getKV } from './_lib/kv.js';

const CACHEABLE = new Map([
    ['/api/license/admin-list', 120],        // 待办角标（轮询最频繁）
    ['/api/license/admin-data-audit', 600],  // 全量数据审计（list 消耗大户）
    ['/api/license/admin-risk', 300],        // 风险扫描
    ['/api/license/admin-usage', 300],       // 用量统计
    ['/api/stats/funnel', 600]               // 漏斗统计
]);

const CACHE_PREFIX = 'resp_cache:';
const MAX_CACHE_BODY = 300 * 1024; // 300KB，超过不缓存
const D1_CLEAN_EVERY = 20;         // 每 N 次写缓存顺手清一次过期行（D1 写免费额度充足）

let __d1WriteCount = 0;

function hex(buf) {
    return Array.from(new Uint8Array(buf)).map(x => x.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return hex(digest);
}

function replay(hit) {
    const headers = new Headers();
    headers.set('Content-Type', hit.ct || 'application/json; charset=utf-8');
    headers.set('X-Resp-Cache', 'HIT');
    if (hit.acao) { headers.set('Access-Control-Allow-Origin', hit.acao); headers.set('Vary', 'Origin'); }
    else headers.set('Access-Control-Allow-Origin', '*');
    return new Response(hit.body, { status: hit.status || 200, headers });
}

function getDB(env) {
    return (env && env.DB) || null;
}

async function d1CacheGet(env, key) {
    const db = getDB(env);
    if (!db) return null;
    try {
        const row = await db.prepare(
            'SELECT status, ct, acao, body, expires_at FROM admin_resp_cache WHERE cache_key = ?'
        ).bind(key).first();
        if (row && Number(row.expires_at) > Date.now() && row.body) {
            return { status: row.status || 200, ct: row.ct || '', acao: row.acao || '', body: row.body };
        }
    } catch (_) { /* D1 不可用 → 走 KV 兼容读 */ }
    return null;
}

async function d1CachePut(env, key, payload, ttlSec) {
    const db = getDB(env);
    if (!db) return false;
    try {
        await db.prepare(
            'INSERT INTO admin_resp_cache (cache_key, status, ct, acao, body, expires_at) VALUES (?, ?, ?, ?, ?, ?) ' +
            'ON CONFLICT(cache_key) DO UPDATE SET status=excluded.status, ct=excluded.ct, acao=excluded.acao, body=excluded.body, expires_at=excluded.expires_at'
        ).bind(key, payload.status || 200, payload.ct || '', payload.acao || '', payload.body, Date.now() + ttlSec * 1000).run();
        if (++__d1WriteCount % D1_CLEAN_EVERY === 0) {
            db.prepare('DELETE FROM admin_resp_cache WHERE expires_at < ?').bind(Date.now() - 86400 * 1000).run().catch(() => {});
        }
        return true;
    } catch (_) { return false; }
}

export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);
    const ttl = CACHEABLE.get(url.pathname);
    const method = request.method;
    if (!ttl || (method !== 'GET' && method !== 'POST')) return context.next();
    const noCache = request.headers.get('x-no-cache') === '1' || url.searchParams.get('fresh') === '1';
    if (noCache) return context.next();

    const env = context.env || {};
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

    // 1) D1 主缓存
    try {
        const hit = await d1CacheGet(env, cacheKey);
        if (hit) return replay(hit);
    } catch (_) {}

    // 2) KV 旧缓存兼容读（历史版本写入的 resp_cache:*，自然过期后不再产生）
    const kv = getKV(context);
    if (kv) {
        try {
            const hit = await kv.get(cacheKey, 'json');
            if (hit && hit.body) return replay(hit);
        } catch (_) {}
    }

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
                    const ttlSec = ttl + 60;
                    const write = (async () => {
                        const ok = await d1CachePut(env, cacheKey, payload, ttlSec);
                        // D1 不可用（本地/未绑定）才退回 KV 单键缓存
                        if (!ok && kv) {
                            try { await kv.put(cacheKey, JSON.stringify(payload), { expirationTtl: ttlSec }); } catch (_) {}
                        }
                    })();
                    if (context.waitUntil) context.waitUntil(write.catch(() => {}));
                    else await write.catch(() => {});
                }
            }
        }
    } catch (_) {}

    try { res.headers.set('X-Resp-Cache', 'MISS'); } catch (_) {}
    return res;
}
