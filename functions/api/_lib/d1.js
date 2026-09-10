// ============================================================================
//  d1.js — D1 数据库绑定解析单一事实源
//
//  背景：处方表从 KV 迁移到 D1（P0），统一 D1 绑定解析入口。
//  规则：★ 所有云函数获取 D1 一律 import 本文件，禁止内联解析 ★
//
//  wrangler.toml 绑定名：DB
//  环境变量 USE_D1=true 时启用 D1（D1 优先 + KV 双写兼容）
// ============================================================================

// 获取 D1 数据库绑定（可能为 null，表示未配置或未启用）
export function getDB(envOrContext) {
    const env = envOrContext?.env || envOrContext;
    return env?.DB || env?.TCM_DB || env?.D1 || null;
}

// 是否启用 D1 存储（环境变量 USE_D1 === 'true'）
export function isD1Enabled(envOrContext) {
    const env = envOrContext?.env || envOrContext;
    return env?.USE_D1 === 'true';
}

// 获取 D1 绑定（若已启用且绑定存在），否则返回 null
export function getDBChecked(envOrContext) {
    if (!isD1Enabled(envOrContext)) return null;
    return getDB(envOrContext);
}
