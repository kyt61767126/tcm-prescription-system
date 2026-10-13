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
    return env?.KV ||
           env?.TCM_PRESCRIPTION_KV ||
           env?.['tcm-prescription-kv'] ||
           env?.['TCM-PRESCRIPTION-KV'] ||
           env?.TCM_KV ||
           env?.PRESCRIPTION_KV ||
           env?.LICENSE_KV;
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
    const ttlMs = Number(o.ttlMs) > 0 ? Number(o.ttlMs) : 0;
    const cacheKey = ttlMs > 0 ? JSON.stringify(opts) : null;
    if (cacheKey) {
        const hit = __pageCache.get(cacheKey);
        if (hit && hit.until > Date.now()) return hit.page;
    }
    if (!o.critical && __listBlockedUntil > Date.now()) {
        const e = new Error('KV list blocked by local quota circuit breaker');
        e.status = 429;
        e.circuit = true;
        throw e;
    }
    let page;
    try {
        page = await kv.list(opts);
    } catch (e) {
        if (!o.critical && isKvListQuotaError(e)) {
            __listBlockedUntil = Date.now() + LIST_CIRCUIT_MS;
        }
        throw e;
    }
    if (cacheKey) {
        __pageCache.set(cacheKey, { until: Date.now() + ttlMs, page });
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
