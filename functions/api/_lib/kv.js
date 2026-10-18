// ============================================================================
//  kv.js — KV 绑定解析单一事实源（P2-B 统一修复）
//
//  背景：verify.js / backup-kv.js / restore-kv.js 曾因绑定名与 wrangler.toml
//  不一致（LICENSE_KV / TCM_PRESCRIPTION_KV）导致功能失效（500），
//  根因是 getKV 解析链存在 8+ 份副本且链长度不一。
//  规则：★ 所有云函数获取 KV 一律 import 本文件，禁止再写内联解析链 ★
//
//  wrangler.toml 实际绑定名：KV（其余为兼容别名，按防御顺序解析）
// ============================================================================

// 兼容两种入参：
//   - Pages Functions 完整 context（含 .env）
//   - 直接传 env 对象（或已解构的 { request, env }）
export function getKV(envOrContext) {
    const env = envOrContext?.env || envOrContext;
    const raw = env?.KV ||
           env?.TCM_PRESCRIPTION_KV ||
           env?.['tcm-prescription-kv'] ||
           env?.['TCM-PRESCRIPTION-KV'] ||
           env?.TCM_KV ||
           env?.PRESCRIPTION_KV ||
           env?.LICENSE_KV;
    return wrapKV(raw);
}

// ============================================================================
// ★ 2026-10-18 KV list 429 免费额度治理（用户线上实锤：免费版 1000 list/天 用尽，
//   控制台 429「KV 请求已被暂时阻止」）。免费额度 UTC 0 点重置（北京时间 08:00）。
//   在不升级付费套餐的前提下：
//     · 给所有经 getKV() 拿到的绑定加一层 Proxy：kv.list 自动走 safeListPage
//       并默认 60s isolate 内存缓存（管理端轮询/切 tab 不再反复消耗 list）；
//     · 429 后把熔断标记**写进 KV 自身**（sys:kv_list_blocked_until，TTL 到 UTC 重置），
//       避免多 isolate 各自撞墙（每个 isolate 只 read 一次标记，get 配额 10万/天）；
//     · 熔断期间优先返回**上一次成功缓存**（旧数据兜底），没有缓存才抛错，
//       让后台页面从"整页报错"变成"显示上次数据"。
//   list 已全面索引化的热路径（登录/激活/心跳/开方）不经过这里。
// ============================================================================
const LIST_BLOCK_MARKER_KEY = 'sys:kv_list_blocked_until';
let __markerCheckedAt = 0;
let __markerBlockedUntil = 0;

function nextUtcMidnightPlus(graceSec) {
    const now = new Date();
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
    return next + (graceSec || 120) * 1000;
}

async function readPersistedBlockedUntil(kv) {
    const now = Date.now();
    if (now - __markerCheckedAt < 30 * 1000) return __markerBlockedUntil;
    __markerCheckedAt = now;
    try {
        const raw = await kv.get(LIST_BLOCK_MARKER_KEY);
        __markerBlockedUntil = Number(raw) || 0;
    } catch (_) { /* get 失败不影响主流程 */ }
    return __markerBlockedUntil;
}

async function persistBlockedUntil(kv, until) {
    __markerBlockedUntil = until;
    __markerCheckedAt = Date.now();
    const ttl = Math.max(60, Math.ceil((until - Date.now()) / 1000));
    try { await kv.put(LIST_BLOCK_MARKER_KEY, String(until), { expirationTtl: ttl }); } catch (_) {}
}

const __kvProxyCache = new WeakMap();
function wrapKV(raw) {
    if (!raw || typeof raw.list !== 'function') return raw;
    if (__kvProxyCache.has(raw)) return __kvProxyCache.get(raw);
    const proxy = new Proxy(raw, {
        get(target, prop) {
            if (prop === '__rawKV') return target;
            if (prop === 'list') {
                return (opts) => safeListPage(target, opts, { ttlMs: 60 * 1000 });
            }
            const v = Reflect.get(target, prop, target);
            return typeof v === 'function' ? v.bind(target) : v;
        }
    });
    __kvProxyCache.set(raw, proxy);
    return proxy;
}

// ============================================================================
//  ★ 2026-10-13 KV list 配额保险丝（免费版 list 仅 1000 次/天，2026-10-09
//    曾超限触发 Cloudflare 警报并在 UTC 重置前持续 429）
//
//  两道防护（均只作用于经本文件收口的调用）：
//   ① 配额熔断：某 isolate 内一次 list 返回 429/quota 类错误 → 本 isolate
//      熔断 30 分钟，期间非 critical 的 list 直接抛同类错（由调用方既有
//      catch 兜底为"空结果"），不再把后续请求打向注定失败的 API；
//      critical 调用（备份/迁移，必须拿全量）不受熔断影响。
//   ② isolate 内存短缓存：同一进程存活期内，相同 opts 的只读扫描在 ttlMs
//      内复用结果（管理端切 tab/连点/轮询的主要消耗来源）。KV 跨 isolate
//      最终一致，管理端统计秒级延迟完全可接受；写后需强一致的调用不要传 ttlMs。
//
//  业务热路径（登录/激活/心跳/开方）已全面索引化（system:license_index /
//  user_session_index / license_clinic_index / mid_owners / invite_idx /
//  order_index / prescriptions_index），正常情况下零 kv.list——list 只剩
//  管理端只读扫描与索引缺失时的一次性懒回填。
// ============================================================================

const LIST_CIRCUIT_MS = 30 * 60 * 1000;   // 配额熔断 30 分钟
const LIST_CACHE_MAX = 300;               // isolate 内存缓存条目上限
let __listBlockedUntil = 0;               // 本 isolate 熔断截止时间戳
const __pageCache = new Map();            // 单页结果缓存：key -> { until, page }
const __fullCache = new Map();            // 全遍历结果缓存：prefix -> { until, names }

function isKvListQuotaError(e) {
    if (!e) return false;
    if (e.status === 429 || e.code === 10048 || e.code === 10028) return true;
    const m = String(e.message || e.error || '');
    return /429|rate\s*limit|quota|limit exceeded|too many requests|temporarily blocked/i.test(m);
}

function gcListCache() {
    if (__pageCache.size < LIST_CACHE_MAX) return;
    const now = Date.now();
    for (const [k, v] of __pageCache) {
        if (v.until <= now) __pageCache.delete(k);
    }
    // 仍超上限：删最老的一半（Map 保持插入序）
    if (__pageCache.size >= LIST_CACHE_MAX) {
        let n = Math.floor(LIST_CACHE_MAX / 2);
        for (const k of __pageCache.keys()) {
            if (n-- <= 0) break;
            __pageCache.delete(k);
        }
    }
}

/**
 * 带配额熔断 + 可选内存缓存的单页 kv.list
 * @param {object} opts 透传 KV list 参数（prefix/cursor/limit）
 * @param {object} [o]
 * @param {number} [o.ttlMs] 结果在 isolate 内存缓存毫秒数（0=不缓存，保强一致）
 * @param {boolean} [o.critical] true=备份/迁移等必须拿全量的调用，熔断期也真实请求
 * @returns {Promise<object|null>} KV list 页对象；熔断/非 critical 时抛错（交调用方 catch）
 */
export async function safeListPage(kv, opts = {}, o = {}) {
    if (!kv) return null;
    if (kv.__rawKV) kv = kv.__rawKV;
    const ttlMs = Number(o.ttlMs) > 0 ? Number(o.ttlMs) : 0;
    const cacheKey = ttlMs > 0 ? JSON.stringify(opts) : null;
    const cached = cacheKey ? __pageCache.get(cacheKey) : null;
    if (cached && cached.until > Date.now()) return cached.page;

    const staleOrThrow = () => {
        if (cached && cached.page) {
            cached.stale = true;
            return cached.page;
        }
        const e = new Error('KV list blocked by quota circuit breaker');
        e.status = 429;
        e.circuit = true;
        throw e;
    };

    if (!o.critical) {
        if (__listBlockedUntil > Date.now()) return staleOrThrow();
        const persisted = await readPersistedBlockedUntil(kv);
        if (persisted > Date.now()) {
            __listBlockedUntil = persisted;
            return staleOrThrow();
        }
    }

    let page;
    try {
        page = await kv.list(opts);
    } catch (e) {
        if (!o.critical && isKvListQuotaError(e)) {
            // 免费 list 额度按 UTC 自然日重置 → 熔断到下一个 UTC 0 点（+2min 缓冲）；
            // 同时写 KV 标记，所有 isolate 共享，不再各自撞 429。
            const until = Math.max(nextUtcMidnightPlus(120), Date.now() + LIST_CIRCUIT_MS);
            __listBlockedUntil = until;
            await persistBlockedUntil(kv, until);
            if (cached && cached.page) { cached.stale = true; return cached.page; }
        }
        throw e;
    }
    if (cacheKey) {
        __pageCache.set(cacheKey, { until: Date.now() + ttlMs, page, stale: false });
        gcListCache();
    }
    return page;
}

// KV list 分页遍历（P2-C：kv.list() 每页最多 1000 个 key，不翻页会静默截断）
// 返回全部 key 名数组；可传 prefix 过滤
// @param {object} [opts] { ttlMs: 全量结果内存缓存毫秒(默认0实时), critical: 备份/迁移 true }
export async function listAllKeys(kv, prefix, opts = {}) {
    const ttlMs = Number(opts.ttlMs) > 0 ? Number(opts.ttlMs) : 0;
    const cacheKey = ttlMs > 0 ? (prefix || '\0') : null;
    if (cacheKey) {
        const hit = __fullCache.get(cacheKey);
        if (hit && hit.until > Date.now()) return hit.names.slice();
    }
    const names = [];
    let cursor;
    while (true) {
        const o = {};
        if (prefix) o.prefix = prefix;
        if (cursor) o.cursor = cursor;
        const page = await safeListPage(kv, o, { critical: !!opts.critical });
        for (const k of page.keys) names.push(k.name);
        if (page.list_complete) break;
        cursor = page.cursor;
    }
    if (cacheKey) __fullCache.set(cacheKey, { until: Date.now() + ttlMs, names: names.slice() });
    return names;
}
