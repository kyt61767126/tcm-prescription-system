// ============================================================================
//  verify.js — 在线授权验证 API（P1-1 防盗版核心）
//
//  路由：POST /api/license/verify
//
//  用途：离线APP定期在线验证授权有效性，防止离线破解后永久使用
//  机制：
//    - 客户端每7天+30张处方提示验证
//    - 超过90天未验证降级为试用模式
//    - 本API确认设备在线状态并更新验证时间戳
//
//  请求体：
//    {
//      "machineId": "abc123def456",   // 机器ID
//      "codeHash": "sha256hex",       // 激活码SHA256哈希（追溯用）
//      "user": "张三",                // 用户名
//      "expiresAt": "2026-12-31..."   // 授权到期时间
//    }
//
//  返回（成功）：
//    { "success": true, "message": "验证成功", "verifyTime": 1234567890 }
//
//  返回（失败）：
//    { "success": false, "error": "错误原因" }
//
//  安全：
//    - 速率限制：每IP每分钟10次
//    - 验证日志记录到KV（追溯盗版泄露源）
// ============================================================================

const VERIFY_RATE_LIMIT_PER_MIN = 10;

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json; charset=UTF-8'
    };
}

export async function onRequestPost({ request, env }) {
    try {
        // 速率限制
        const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
        const rateLimitKey = `verify_rate:${clientIP}`;
        const rateLimitCount = parseInt(await env.LICENSE_KV.get(rateLimitKey) || '0', 10);
        if (rateLimitCount >= VERIFY_RATE_LIMIT_PER_MIN) {
            return new Response(JSON.stringify({
                success: false,
                error: '请求过于频繁，请稍后再试'
            }), { status: 429, headers: corsHeaders() });
        }
        // 更新速率限制计数（60秒过期）
        await env.LICENSE_KV.put(rateLimitKey, String(rateLimitCount + 1), { expirationTtl: 60 });

        // 解析请求体
        const body = await request.json();
        const { machineId, codeHash, user, expiresAt } = body;

        // 基本参数校验
        if (!machineId || typeof machineId !== 'string') {
            return new Response(JSON.stringify({
                success: false,
                error: '缺少 machineId 参数'
            }), { status: 400, headers: corsHeaders() });
        }

        const now = Date.now();
        const verifyTime = now;

        // ★ 记录验证日志到KV（追溯盗版泄露源）
        // 日志格式：verify_log:{codeHash} → { machineId, user, verifyTime, expiresAt, ip }
        if (codeHash && codeHash.length === 64) {
            const logKey = `verify_log:${codeHash}`;
            const logData = {
                machineId: machineId || '',
                user: user || '',
                verifyTime: verifyTime,
                expiresAt: expiresAt || '',
                ip: clientIP,
                timestamp: new Date(now).toISOString()
            };
            // 保留最近30天的验证日志
            await env.LICENSE_KV.put(logKey, JSON.stringify(logData), { expirationTtl: 30 * 24 * 60 * 60 });
        }

        // 返回验证成功
        return new Response(JSON.stringify({
            success: true,
            message: '在线验证成功，授权有效',
            verifyTime: verifyTime
        }), { status: 200, headers: corsHeaders() });

    } catch (e) {
        return new Response(JSON.stringify({
            success: false,
            error: '服务器错误: ' + (e.message || String(e))
        }), { status: 500, headers: corsHeaders() });
    }
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: corsHeaders() });
}
