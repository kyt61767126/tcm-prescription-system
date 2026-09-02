// ============================================================================
//  admin-delete.js — 平台管理员删除"管理员激活"请求 API
//
//  路由：POST /api/license/admin-delete
//
//  认证：Bearer token（platform_admin）
//
//  请求体：{ "requestId": "REQ-XXXXXXXX-XXXX" }
//
//  返回：{ success: true, message: "已删除" } 或 { success: false, error: "..." }
//
//  说明：物理删除请求记录（从索引中移除 + 删除KV记录），不可恢复。
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from '../_lib/auth.js';
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
const KV_ADMIN_REQ_INDEX = 'admin_req_index';

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
        const currentUser = await parseAuthHeader(context.request, context.env);
        if (!currentUser || !isPlatformAdmin(currentUser)) {
            return json({ success: false, error: '仅平台总管理员可删除激活请求' }, 403, origin);
        }

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

        const recordKey = KV_ADMIN_REQ_PREFIX + requestId;
        const record = await kv.get(recordKey, 'json');

        if (!record) {
            return json({ success: false, error: '请求记录不存在' }, 404, origin);
        }

        const index = (await kv.get(KV_ADMIN_REQ_INDEX, 'json')) || [];
        const newIndex = index.filter(id => id !== requestId);
        await kv.put(KV_ADMIN_REQ_INDEX, JSON.stringify(newIndex));
        await kv.delete(recordKey);

        // ★ 2026-09-02 修复"删除激活审核后仍无法重新提交"（用户实测反馈）：
        //   原实现只删记录 + 请求索引，两项派生数据残留导致 findPhoneOccupancy 误判：
        //   ① admin_phone:{phone} 仍指向已删记录；
        //   ② 兜底扫描命中该手机号更早的历史 pending 申请（重复提交检查 2026-08-20 才
        //      上线，之前同一手机号可能积累多条 pending）。
        //   修复：删除时同步清理 ① order:{orderNo} 订单映射 ② 重建 admin_phone 索引
        //   为该手机号剩余最新一条申请（无则彻底删除索引）。
        try {
            if (record.orderNo) {
                await kv.delete('order:' + String(record.orderNo).trim().toUpperCase()).catch(e => {
                    console.warn('[AdminDelete] 订单映射删除失败:', e.message);
                });
            }
            if (record.phone) {
                let latest = null;
                for (const rid of newIndex.slice(0, 200)) {
                    const rec = await kv.get(KV_ADMIN_REQ_PREFIX + rid, 'json').catch(() => null);
                    if (rec && rec.phone === record.phone) { latest = rec; break; }
                }
                if (latest) {
                    await kv.put('admin_phone:' + record.phone, JSON.stringify({
                        requestId: latest.requestId,
                        status: latest.status
                    }));
                    console.log('[AdminDelete] 手机号索引已重建指向:', latest.requestId, '(', latest.status, ')');
                } else {
                    await kv.delete('admin_phone:' + record.phone);
                    console.log('[AdminDelete] 手机号索引已彻底清除:', record.phone);
                }
            }
        } catch (e) {
            console.warn('[AdminDelete] 手机号索引重建失败:', e.message);
        }

        console.log('[AdminDelete] 请求已删除:', requestId, '诊所:', record.clinicName);

        return json({
            success: true,
            message: '已删除',
            requestId,
            deletedAt: new Date().toISOString()
        }, 200, origin);

    } catch (error) {
        console.error('Admin delete error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500, origin);
    }
}