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
import { cancelAdminRequest } from './_lib/license-write-service.js';

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

        // ★ 2026-09-03 P0 根治：通过 license-write-service.cancelAdminRequest 统一写入
        //   原实现只改 admin_req.status = 'cancelled'，不维护 admin_phone 索引 +
        //   不重建 → 同手机号重新提交永远被短路到 cancelled 旧记录 → 永登不上
        const result = await cancelAdminRequest(kv, requestId);
        if (result && result.cancelled) {
            console.log('[AdminCancel] 通过 Service 取消(三索引同步):', requestId, 'rebuildPhoneIndex=true');
        } else if (result && result.reason && result.reason.startsWith('status_not_cancellable')) {
            console.log('[AdminCancel] 状态不可取消, 直接返回当前状态(幂等):', requestId, record.status);
        } else if (result) {
            console.log('[AdminCancel] Service 返回:', requestId, JSON.stringify(result));
        }

        return json({ success: true, status: (result && result.record ? result.record.status : record.status) }, 200, origin);

    } catch (error) {
        console.error('Admin cancel error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500, origin);
    }
}
