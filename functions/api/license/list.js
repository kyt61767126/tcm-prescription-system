// ============================================================================
//  list.js — 激活码列表查询 API（管理员专用）
//
//  路由：GET /api/license/list
//
//  查询参数：
//    status=unused|used|expired|disabled   按状态过滤（可选）
//    type=trial|personal|pro               按类型过滤（可选）
//    q=张三                                 按用户名/激活码搜索（可选）
//
//  认证：Bearer token（platform_admin）
//
//  返回：
//    {
//      "success": true,
//      "data": [ { code, user, type, status, ... } ],
//      "count": 10,
//      "stats": { total, unused, used, expired, disabled }
//    }
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from '../_lib/auth.js';
import { getKV, listLicenses, sanitizeRecord } from './_lib/license-core.js';

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
    const url = new URL(context.request.url);

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
            return json({ success: false, error: '仅平台总管理员可查看激活码列表' }, 403);
        }

        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        const statusFilter = url.searchParams.get('status');
        const typeFilter = url.searchParams.get('type');
        const q = url.searchParams.get('q');

        // 获取所有激活码
        let records = await listLicenses(kv);

        // 统计
        const stats = {
            total: records.length,
            unused: 0,
            used: 0,
            expired: 0,
            disabled: 0
        };
        for (const r of records) {
            if (stats[r.status] !== undefined) {
                stats[r.status]++;
            }
        }

        // 过滤
        if (statusFilter) {
            records = records.filter(r => r.status === statusFilter);
        }
        if (typeFilter) {
            records = records.filter(r => r.type === typeFilter);
        }
        if (q) {
            const lowerQ = q.toLowerCase();
            records = records.filter(r =>
                (r.code && r.code.toLowerCase().includes(lowerQ)) ||
                (r.user && r.user.toLowerCase().includes(lowerQ)) ||
                (r.username && r.username.toLowerCase().includes(lowerQ)) ||
                (r.note && r.note.toLowerCase().includes(lowerQ))
            );
        }

        // 按签发时间倒序
        records.sort((a, b) => {
            const ta = a.issuedAt ? new Date(a.issuedAt).getTime() : 0;
            const tb = b.issuedAt ? new Date(b.issuedAt).getTime() : 0;
            return tb - ta;
        });

        return json({
            success: true,
            data: records.map(sanitizeRecord),
            count: records.length,
            stats: stats
        });

    } catch (error) {
        console.error('License list error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
