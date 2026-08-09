// ============================================================================
//  admin-list.js — 平台管理员列出"管理员激活"请求 API
//
//  路由：GET /api/license/admin-list?status=pending&limit=100
//
//  认证：Bearer token（platform_admin）
//
//  查询参数：
//    status: pending / activated / rejected / cancelled / all（默认 pending）
//    limit:  1-500，默认 100
//
//  返回：{ success: true, requests: [...] }
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from '../_lib/auth.js';
import { getKV } from './_lib/license-core.js';

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

const KV_ADMIN_REQ_PREFIX = 'admin_req:';
const KV_ADMIN_REQ_INDEX = 'admin_req_index';

// 脱敏：对外返回时隐藏 machineId 中间部分、电话中间 4 位
function maskRecord(record) {
    if (!record) return null;
    const mid = record.machineId || '';
    const maskedMid = mid.length > 12 ? mid.substring(0, 8) + '****' + mid.substring(mid.length - 4) : mid;
    const phone = record.phone || '';
    const maskedPhone = phone.length === 11 ? phone.substring(0, 3) + '****' + phone.substring(7) : phone;
    return {
        requestId: record.requestId,
        clinicName: record.clinicName,
        adminName: record.adminName,
        phone: maskedPhone,
        remark: record.remark || '',
        machineId: maskedMid,
        status: record.status,
        submittedAt: record.submittedAt,
        submittedIp: record.submittedIp || '',
        resolvedAt: record.resolvedAt || null,
        resolvedBy: record.resolvedBy || null,
        licenseCode: record.licenseCode || null,
        rejectReason: record.rejectReason || null
    };
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
            return json({ success: false, error: '仅平台总管理员可查看激活请求列表' }, 403);
        }

        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        const url = new URL(context.request.url);
        const statusFilter = url.searchParams.get('status') || 'pending';
        const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit'), 10) || 100, 1), 500);

        // 读取索引
        const index = (await kv.get(KV_ADMIN_REQ_INDEX, 'json')) || [];

        // 逐个读取请求记录
        const records = [];
        for (const requestId of index) {
            if (records.length >= limit) break;
            const record = await kv.get(KV_ADMIN_REQ_PREFIX + requestId, 'json');
            if (!record) continue;
            if (statusFilter === 'all' || record.status === statusFilter) {
                records.push(maskRecord(record));
            }
        }

        return json({
            success: true,
            requests: records,
            count: records.length,
            filter: statusFilter
        });

    } catch (error) {
        console.error('Admin list error:', error);
        return json({ success: false, error: error.message || 'Internal server error' }, 500);
    }
}
