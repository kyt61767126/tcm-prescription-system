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

const KV_FREE_PASS_PREFIX = 'free_pass:';
const KV_FREE_PASS_INDEX = 'free_pass_index';

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
            const phones = (await kv.get(KV_FREE_PASS_INDEX, 'json').catch(() => null)) || [];
            const list = [];
            for (const ph of phones.slice(0, 500)) {
                const rec = await kv.get(KV_FREE_PASS_PREFIX + ph, 'json').catch(() => null);
                if (rec && rec.phone) list.push(rec);
            }
            return json({ success: true, list }, 200, origin);
        }

        // ---- 添加 ----
        if (action === 'add') {
            const phone = String(body.phone || '').trim();
            const note = String(body.note || '').trim().slice(0, 100);
            if (!/^1[3-9]\d{9}$/.test(phone)) {
                return json({ success: false, error: '手机号格式错误（需 11 位）' }, 400, origin);
            }
            const exist = await kv.get(KV_FREE_PASS_PREFIX + phone, 'json').catch(() => null);
            const record = {
                phone,
                note: note || (exist ? exist.note : ''),
                addedAt: exist ? exist.addedAt : new Date().toISOString(),
                addedBy: exist ? exist.addedBy : operator,
                updatedAt: new Date().toISOString()
            };
            await kv.put(KV_FREE_PASS_PREFIX + phone, JSON.stringify(record));
            const index = (await kv.get(KV_FREE_PASS_INDEX, 'json').catch(() => null)) || [];
            if (!index.includes(phone)) {
                index.unshift(phone);
                await kv.put(KV_FREE_PASS_INDEX, JSON.stringify(index));
            }
            console.log('[FreePass] 白名单添加:', phone, '备注:', note, '操作人:', operator);
            return json({ success: true, message: exist ? '已更新白名单备注' : '已加入白名单', record }, 200, origin);
        }

        // ---- 删除 ----
        if (action === 'remove') {
            const phone = String(body.phone || '').trim();
            if (!/^1[3-9]\d{9}$/.test(phone)) {
                return json({ success: false, error: '手机号格式错误' }, 400, origin);
            }
            await kv.delete(KV_FREE_PASS_PREFIX + phone);
            const index = (await kv.get(KV_FREE_PASS_INDEX, 'json').catch(() => null)) || [];
            const newIndex = index.filter(p => p !== phone);
            if (newIndex.length !== index.length) {
                await kv.put(KV_FREE_PASS_INDEX, JSON.stringify(newIndex));
            }
            console.log('[FreePass] 白名单删除:', phone, '操作人:', operator);
            return json({ success: true, message: '已从白名单移除', phone }, 200, origin);
        }

        return json({ success: false, error: '未知 action，支持 list / add / remove' }, 400, origin);

    } catch (error) {
        console.error('FreePass error:', error);
        return json({ success: false, error: '服务器内部错误' }, 500, origin);
    }
}
