// ============================================================================
//  logs.js — 激活码操作日志查询 API（管理员专用）
//
//  路由：GET /api/license/logs?code=BNZC-XXXX-XXXX-XXXX-XXXX
//
//  认证：Bearer token（platform_admin）
//
//  返回：
//    {
//      "success": true,
//      "code": "BNZC-XXXX-XXXX-XXXX-XXXX",
//      "logs": [
//        { "action": "generate", "time": "...", "ip": "...", "operator": "...", "detail": "..." },
//        { "action": "activate", "time": "...", "ip": "...", "operator": "...", "detail": "..." },
//        { "action": "unbind",   "time": "...", "ip": "...", "operator": "...", "detail": "..." }
//      ],
//      "count": 3
//    }
//
//  日志 action 取值：
//    generate   - 生成激活码（管理员）
//    activate   - 首次激活（用户客户端）
//    reactivate - 同设备重激活（用户客户端）
//    unbind     - 解绑机器（管理员）
//    disable    - 禁用激活码（管理员）
//    enable     - 启用激活码（管理员）
//    delete     - 删除激活码（管理员，仅控制台日志，KV 日志已随之删除）
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from '../_lib/auth.js';
import { getKV, getLicenseLogs } from './_lib/license-core.js';

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': 'https://tcm-prescription-system.pages.dev',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    };
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

export async function onRequest(context) {
    const method = context.request.method;

    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders() });
    }

    if (method !== 'GET') {
        return json({ success: false, error: 'Method not allowed' }, 405);
    }

    try {
        // 管理员认证
        const currentUser = await parseAuthHeader(context.request, context.env);
        if (!currentUser || !isPlatformAdmin(currentUser)) {
            return json({ success: false, error: '仅平台总管理员可查看操作日志' }, 403);
        }

        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        const url = new URL(context.request.url);
        const code = url.searchParams.get('code');
        if (!code) {
            return json({ success: false, error: '请提供 code 参数' }, 400);
        }

        // 激活码格式校验：BNZC-XXXX-XXXX-XXXX-XXXX
        if (!/^BNZC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code)) {
            return json({ success: false, error: '激活码格式错误' }, 400);
        }

        const logs = await getLicenseLogs(kv, code);

        return json({
            success: true,
            code: code,
            logs: logs,
            count: logs.length
        });

    } catch (error) {
        console.error('License logs query error:', error);
        return json({ success: false, error: error.message || 'Internal server error' }, 500);
    }
}
