// ============================================================================
//  ticket/list.js — 平台管理员查看"激活工单"列表 API
//
//  路由：GET /api/license/ticket/list?status=pending|approved|rejected|all&limit=100
//
//  认证：Bearer token（platform_admin）
//
//  返回：{ success: true, list: [...] }
//
//  ★ 服务端脱敏（规则3）：machineId 只回显前后 6 位 + 中间打码，
//    完整哈希仅用于审批时写入激活校验，绝不回显给操作员。
//    与前端 mask() 双保险——即使前端被篡改，服务端也不泄露完整哈希。
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from '../../_lib/auth.js';
import { getKV } from '../_lib/license-core.js';

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': 'https://tcm-prescription-system.pages.dev',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    };
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

const KV_TICKET_PREFIX = 'ticket:';
const KV_TICKET_INDEX = 'ticket_index';

// 规则3脱敏：前后各6位 + 中间打码（≤12位长度不足以脱敏时全打码）
function maskMachineId(id) {
    if (!id) return '';
    if (id.length <= 12) return id.replace(/./g, '•');
    return id.slice(0, 6) + '••••' + id.slice(-6);
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
            return json({ success: false, error: '仅平台总管理员可查看工单列表' }, 403);
        }

        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        const url = new URL(context.request.url);
        const statusFilter = url.searchParams.get('status') || 'all';
        const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit'), 10) || 100, 1), 500);

        // 读取索引（最新在前），逐条读记录
        const index = (await kv.get(KV_TICKET_INDEX, 'json')) || [];
        const list = [];
        for (const ticketNo of index) {
            if (list.length >= limit) break;
            const t = await kv.get(KV_TICKET_PREFIX + ticketNo, 'json');
            if (!t) continue;
            if (statusFilter === 'all' || t.status === statusFilter) {
                list.push({
                    ticketNo: t.ticketNo,
                    machineId: maskMachineId(t.machineId),  // ★ 服务端脱敏
                    edition: t.edition || '',
                    clinicName: t.clinicName || '',
                    contactName: t.contactName || '',
                    contactPhone: t.contactPhone || '',
                    contactWechat: t.contactWechat || '',
                    remark: t.remark || '',
                    submittedAt: t.submittedAt,
                    status: t.status,
                    resolvedAt: t.resolvedAt || null,
                    resolvedBy: t.resolvedBy || null,
                    licenseCode: t.licenseCode || null,
                    rejectReason: t.rejectReason || null,
                    type: t.type || null
                });
            }
        }

        return json({ success: true, list, total: list.length });

    } catch (error) {
        console.error('Ticket list error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
