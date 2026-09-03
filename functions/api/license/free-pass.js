// ============================================================================
//  free-pass.js — 免费开通白名单管理 API（平台总管理员专用）
//
//  路由：POST /api/license/free-pass
//
//  认证：Bearer token（platform_admin）
//
//  请求体：
//    { "action": "list" }                          // 列出全部白名单
//    { "action": "add", "phone": "138...", "note": "老客户补偿" }
//    { "action": "remove", "phone": "138..." }
//
//  返回：{ success: true, ... } 或 { success: false, error: "..." }
//
//  KV 数据结构：
//    key: free_pass:{phone}   -> { phone, note, addedAt, addedBy }
//    key: free_pass_index     -> [phone1, phone2, ...]（最新在前）
//
//  说明：
//    白名单内的手机号在客户端提交"管理员激活"申请时跳过支付前置校验
//    （admin-submit 的 PAYMENT_REQUIRED 拦截），申请记录带 freePass 标记，
//    仍需管理员在激活审核队列中人工通过。白名单长期有效，建议用完删除。
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from '../_lib/auth.js';
import { getKV } from './_lib/license-core.js';
import {
    listFreePass, upsertFreePass, removeFreePass
} from './_lib/license-write-service.js';

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
            return json({ success: false, error: '仅平台总管理员可管理免费开通白名单' }, 403, origin);
        }

        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500, origin);
        }

        const body = await context.request.json().catch(() => ({}));
        const action = (body.action || 'list').trim();
        const operator = currentUser.username || currentUser.name || currentUser.sub || 'platform_admin';

        // ---- 列表 ----
        if (action === 'list') {
            // ★ 2026-09-03 (架构统一 P2 收官) 迁入 listFreePass：统一损坏索引兜底
            const list = await listFreePass(kv, 500);
            return json({ success: true, list }, 200, origin);
        }

        // ---- 添加 ----
        if (action === 'add') {
            const phone = String(body.phone || '').trim();
            const note = String(body.note || '').trim().slice(0, 100);
            // 格式校验前置：若手机号不合法，upsertFreePass 内部会抛并 500 兜底，
            // 这里保留外层 400 给客户友好提示
            if (!/^1[3-9]\d{9}$/.test(phone)) {
                return json({ success: false, error: '手机号格式错误（需 11 位）' }, 400, origin);
            }
            // ★ 2026-09-03 (架构统一 P2 收官) 迁入 upsertFreePass：记录+索引双写一致、
            //   损坏索引自动重建、首次新增自动补 addedAt/addedBy
            const { record, isNew } = await upsertFreePass(kv, phone, { note, operator });
            console.log('[FreePass] 通过 Service 白名单:', isNew ? '新增' : '更新备注', phone, '操作人:', operator);
            return json({
                success: true,
                message: isNew ? '已加入白名单' : '已更新白名单备注',
                record
            }, 200, origin);
        }

        // ---- 删除 ----
        if (action === 'remove') {
            const phone = String(body.phone || '').trim();
            if (!/^1[3-9]\d{9}$/.test(phone)) {
                return json({ success: false, error: '手机号格式错误' }, 400, origin);
            }
            // ★ 2026-09-03 (架构统一 P2 收官) 迁入 removeFreePass：记录 delete + 索引 filter 同步
            const rr = await removeFreePass(kv, phone);
            console.log('[FreePass] 通过 Service 白名单删除:', phone, '操作人:', operator,
                'indexRemoved=', rr.removedFromIndex);
            return json({ success: true, message: '已从白名单移除', phone }, 200, origin);
        }

        return json({ success: false, error: '未知 action，支持 list / add / remove' }, 400, origin);

    } catch (error) {
        console.error('FreePass error:', error);
        return json({ success: false, error: '服务器内部错误' }, 500, origin);
    }
}
