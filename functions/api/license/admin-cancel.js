// ============================================================================
//  admin-cancel.js — 客户端取消"管理员激活"请求 API
//
//  路由：POST /api/license/admin-cancel
//
//  请求体：{ "requestId": "REQ-XXXXXXXX-XXXX" }
//
//  返回：{ success: true } 或 { success: false, error: "..." }
//
//  仅当请求状态为 pending 时允许取消，其他状态直接返回成功（幂等）。
// ============================================================================

import { getKV } from './_lib/license-core.js';

const ALLOWED_ORIGINS = [
    'https://tcm-prescription-system.pages.dev',
    'capacitor://localhost',
    'ionic://localhost',
    'http://localhost',
    'https://localhost',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:8080',
    'http://127.0.0.1',
    'https://127.0.0.1'
];

function corsHeaders(origin) {
    const allowedOrigin = (origin && ALLOWED_ORIGINS.includes(origin)) ? origin : 'https://tcm-prescription-system.pages.dev';
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    };
}

function json(data, status, origin) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });
}

const KV_ADMIN_REQ_PREFIX = 'admin_req:';

export async function onRequest(context) {
    const method = context.request.method;
    const origin = context.request.headers.get('Origin') || '';

    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders(origin) });
    }

    if (method !== 'POST') {
        return json({ success: false, error: 'Method not allowed' }, 405, origin);
    }

    try {
        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500, origin);
        }

        const body = await context.request.json().catch(() => ({}));
        const { requestId } = body;

        if (!requestId) {
            return json({ success: false, error: '缺少 requestId' }, 400, origin);
        }
        if (!/^REQ-[A-Z0-9]+-[A-F0-9]+$/i.test(requestId)) {
            return json({ success: false, error: 'requestId 格式错误' }, 400, origin);
        }

        const record = await kv.get(KV_ADMIN_REQ_PREFIX + requestId, 'json');
        if (!record) {
            // 请求不存在视为已取消（幂等）
            return json({ success: true, message: '请求不存在或已清除' }, 200, origin);
        }

        // 仅 pending 状态允许取消，其他状态直接返回成功（幂等）
        if (record.status === 'pending') {
            record.status = 'cancelled';
            record.resolvedAt = new Date().toISOString();
            record.resolvedBy = 'client';
            await kv.put(KV_ADMIN_REQ_PREFIX + requestId, JSON.stringify(record));
            console.log('[AdminCancel] 请求已取消:', requestId);
        }

        return json({ success: true, status: record.status }, 200, origin);

    } catch (error) {
        console.error('Admin cancel error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500, origin);
    }
}
