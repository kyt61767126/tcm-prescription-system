// ============================================================================
//  ticket/reject.js — 平台管理员拒绝"激活工单" API
//
//  路由：POST /api/license/ticket/reject
//
//  认证：Bearer token（platform_admin）
//
//  请求体：{ "ticketNo": "TK-XXXXXXXX-XXXXXX", "reason": "拒绝原因（客户可见）" }
//
//  返回：{ success: true, status: 'rejected' }
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from '../../_lib/auth.js';
import { getKV } from '../_lib/license-core.js';

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': 'https://tcm-prescription-system.pages.dev',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    };
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

const KV_TICKET_PREFIX = 'ticket:';

export async function onRequest(context) {
    const method = context.request.method;

    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders() });
    }

    if (method !== 'POST') {
        return json({ success: false, error: 'Method not allowed' }, 405);
    }

    try {
        // 管理员认证
        const currentUser = await parseAuthHeader(context.request, context.env);
        if (!currentUser || !isPlatformAdmin(currentUser)) {
            return json({ success: false, error: '仅平台总管理员可拒绝工单' }, 403);
        }

        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        const body = await context.request.json().catch(() => ({}));
        const ticketNo = String(body.ticketNo || '').trim();
        const reason = String(body.reason || '').trim().slice(0, 300);

        if (!ticketNo || !/^TK-[A-Z0-9]+-[A-Z0-9]+$/i.test(ticketNo)) {
            return json({ success: false, error: 'ticketNo 格式错误' }, 400);
        }

        const ticket = await kv.get(KV_TICKET_PREFIX + ticketNo, 'json');
        if (!ticket) {
            return json({ success: false, error: '工单不存在或已失效' }, 404);
        }

        if (ticket.status !== 'pending') {
            return json({
                success: false,
                error: `工单当前状态为 ${ticket.status}，无法拒绝（仅待审批状态可操作）`
            }, 400);
        }

        // 拒绝：写状态 + 拒绝原因（客户可见）
        ticket.status = 'rejected';
        ticket.rejectReason = reason || '管理员未填写拒绝原因';
        ticket.resolvedAt = new Date().toISOString();
        ticket.resolvedBy = currentUser.username;
        await kv.put(KV_TICKET_PREFIX + ticketNo, JSON.stringify(ticket));

        console.log('[TicketReject] 工单已拒绝:', ticketNo,
            'reason=', ticket.rejectReason, 'by=', currentUser.username);

        return json({ success: true, status: 'rejected' });

    } catch (error) {
        console.error('Ticket reject error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
