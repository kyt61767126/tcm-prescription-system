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

// KV list 分页遍历（P2-C：kv.list() 每页最多 1000 个 key，不翻页会静默截断）
// 返回全部 key 名数组；可传 prefix 过滤
export async function listAllKeys(kv, prefix) {
    const names = [];
    let cursor;
    while (true) {
        const opts = {};
        if (prefix) opts.prefix = prefix;
        if (cursor) opts.cursor = cursor;
        const page = await kv.list(opts);
        for (const k of page.keys) names.push(k.name);
        if (page.list_complete) break;
        cursor = page.cursor;
    }
    return names;
}
