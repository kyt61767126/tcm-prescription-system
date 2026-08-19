// ============================================================================
//  env-probe.js — 临时诊断端点（验证后立即删除）
//  用途：诊断 AUTH_SECRET 运行时注入情况（只返回存在性/长度，绝不返回值本身）
// ============================================================================
export async function onRequest(context) {
    const v = context.env?.AUTH_SECRET || '';
    return Response.json({
        ok: true,
        probe: 'env',
        authSecret: { present: v.length > 0, length: v.length },
        ttlConfigured: !!context.env?.AUTH_TOKEN_TTL_HOURS,
        kvBound: !!context.env?.KV
    });
}
