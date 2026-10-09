// ============================================================================
//  admin-cache.js — 后台/运维聚合端点的【短时结果缓存 + 运维一键开关】
//
//  动机（2026-10-10）：admin-data-audit / admin-risk / stats-funnel 这类后台聚合端点
//  本身就是"全量扫描"语义，单次调用可能吃掉多条 kv.list；而 KV 免费套餐每日 list 仅
//  1000 次（本次真机已因超限收到 Cloudflare 告警并降级）。后台页面轮询或被反复点击时，
//  这些端点会再次把配额打满。故加一层响应级短时缓存，把"重复点击"折叠成一次扫描。
//
//  设计要点：
//   · 运维一键开关：KV 键 config:admin-heavy-cache
//       {"mode":"off"}         → 全部绕过缓存（立即生效，无需重新部署）
//       {"ttl":600}            → 自定义缓存秒数（默认 300，clamp 到 30..3600）
//     配置读取失败按"启用缓存"处理（失败开放，绝不因配置读异常影响可用性）。
//   · 缓存键 = 端点名 + 调用方凭证 SHA-256 + 查询串/请求体摘要
//     → **不同身份绝不共享缓存体**（低权限者不可能读到高权限者的缓存结果）。
//   · 只缓存 2xx；403/401/5xx 一律不缓存，权限变更后最坏仅 1 个 TTL 的旧视图。
//   · 缓存内容含原响应头（保证 CORS 等头在命中时同样存在）。
//   · 缓存写入失败只 console.warn，绝不影响响应。
// ============================================================================

const CONFIG_KEY = 'admin-heavy-cache-config';
const CACHE_PREFIX = 'admin_cache:';
const DEFAULT_TTL_SECONDS = 300;
const MIN_TTL = 30, MAX_TTL = 3600;

async function sha256Hex(s) {
    try {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s || '')));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
    } catch (_) { return 'nohash'; }
}

async function readConfig(kv) {
    let enabled = true, ttl = DEFAULT_TTL_SECONDS;
    try {
        if (kv) {
            const cfg = await kv.get(CONFIG_KEY, 'json');
            if (cfg && typeof cfg === 'object') {
                if (String(cfg.mode || '').toLowerCase() === 'off') enabled = false;
                const t = Number(cfg.ttl);
                if (Number.isFinite(t) && t > 0) ttl = Math.min(MAX_TTL, Math.max(MIN_TTL, Math.floor(t)));
            }
        }
    } catch (_) { /* 配置读取失败按启用缓存处理 */ }
    return { enabled, ttl };
}

async function buildCacheKey(name, request, authHeader) {
    let bodyDigest = '';
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        try { bodyDigest = await sha256Hex(await request.clone().text()); } catch (_) { bodyDigest = 'nobody'; }
    }
    let qs = '';
    try { qs = new URL(request.url).search || ''; } catch (_) { qs = ''; }
    const idDigest = await sha256Hex(authHeader || 'anon');
    return CACHE_PREFIX + name + ':' + idDigest + ':' + (qs ? await sha256Hex(qs) : 'noq') + ':' + bodyDigest;
}

/**
 * 响应级缓存包装。命中直接返回缓存体；未命中执行 inner 并在 2xx 时写入缓存。
 * @param {object} kv        KV 绑定
 * @param {string} name      端点名（缓存命名空间）
 * @param {Request} request  原始请求
 * @param {string} authHeader Authorization 头（用于身份隔离）
 * @param {Function} inner   实际处理函数，返回 Response
 */
export async function withAdminResponseCache(kv, name, request, authHeader, inner) {
    if (!kv || !request || typeof inner !== 'function') return inner();
    const cfg = await readConfig(kv);
    if (!cfg.enabled) return inner();

    let key = null;
    try { key = await buildCacheKey(name, request, authHeader); } catch (_) { key = null; }

    if (key) {
        try {
            const hit = await kv.get(key, 'json');
            if (hit && typeof hit === 'object' && typeof hit.b === 'string') {
                const headers = new Headers();
                for (const pair of (Array.isArray(hit.h) ? hit.h : [])) {
                    if (Array.isArray(pair) && pair.length === 2) {
                        const lk = String(pair[0]).toLowerCase();
                        if (lk === 'content-length' || lk === 'transfer-encoding') continue;
                        try { headers.set(pair[0], pair[1]); } catch (_) {}
                    }
                }
                headers.set('X-Dsh-Cache', 'hit');
                return new Response(hit.b, { status: 200, headers });
            }
        } catch (_) { /* 缓存读失败按未命中处理 */ }
    }

    const res = await inner();
    if (res && res.status === 200 && key) {
        try {
            const text = await res.clone().text();
            if (text.length <= 900000) {
                const h = [];
                res.headers.forEach((v, k) => h.push([k, v]));
                kv.put(key, JSON.stringify({ b: text, h, at: new Date().toISOString() }),
                    { expirationTtl: cfg.ttl }).catch(() => {});
            }
        } catch (e) { console.warn('[AdminCache] 写入失败（仅告警，不影响响应）:', e && e.message); }
        try { res.headers.set('X-Dsh-Cache', 'miss'); } catch (_) {}
    }
    return res;
}

// 供测试/运维查看当前配置解析结果
export async function getAdminCacheConfig(kv) { return readConfig(kv); }
