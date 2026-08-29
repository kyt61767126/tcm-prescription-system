// ============================================================================
//  order-paid.js — 官网订单付款确认 API
//
//  路由：POST /api/license/order-paid
//
//  无需登录认证（官网购买页），保护：速率限制 + 订单号/手机号双因子校验
//
//  请求体：
//    {
//      "orderNo":   "BNZC-DZ-202608291234-ABC1XY",  // 必填
//      "phone":     "13800138000",                  // 必填（需与下单手机号一致）
//      "payMethod": "alipay",                       // 必填：alipay / wechat
//      "txnLast6":  "A1B2C3"                        // 必填（转账单号后6位）
//    }
//
//  返回：{ success: true, status: 'pending' }
//
//  ★ 数据流：
//    1. 校验 order:{orderNo} 映射存在，且记录 phone 与请求一致
//    2. 记录 payMethod / payTxnLast6 / paidAt
//    3. status: pending_payment → pending，并写入 admin_req_index
//       （进入后台「管理员激活审核」待审列表）
//    4. 后台管理员在支付宝/微信账单中核对转账单号后6位与到账金额，
//       一键审核通过（admin-approve 自动生成激活码并立即激活）
// ============================================================================

import { getKV, checkRateLimit } from './_lib/license-core.js';

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
let _currentRequest = null;

function corsHeaders() {
    const origin = _currentRequest ? (_currentRequest.headers.get('Origin') || '') : '';
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

function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

function getClientIP(context) {
    return context.request.headers.get('CF-Connecting-IP') ||
           context.request.headers.get('X-Forwarded-For') ||
           context.request.headers.get('X-Real-IP') ||
           'unknown';
}

const KV_ADMIN_REQ_PREFIX = 'admin_req:';
const KV_ADMIN_REQ_INDEX = 'admin_req_index';
const KV_ORDER_PREFIX = 'order:';

// 索引维护（与 admin-submit 相同：新请求放最前面，最大 1000 条）
async function appendRequestIndex(kv, requestId) {
    try {
        const index = (await kv.get(KV_ADMIN_REQ_INDEX, 'json')) || [];
        if (!index.includes(requestId)) {
            index.unshift(requestId);
            if (index.length > 1000) index.length = 1000;
            await kv.put(KV_ADMIN_REQ_INDEX, JSON.stringify(index));
        }
    } catch (e) {
        console.warn('[OrderPaid] 索引更新失败:', e.message);
    }
}

export async function onRequest(context) {
    _currentRequest = context.request;
    const method = context.request.method;

    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders() });
    }

    if (method !== 'POST') {
        return json({ success: false, error: 'Method not allowed' }, 405);
    }

    try {
        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        // 速率限制（防爆破订单号）
        const ip = getClientIP(context);
        const rateLimit = await checkRateLimit(kv, ip + ':order-paid', 20);
        if (!rateLimit.allowed) {
            return json({ success: false, error: '操作过于频繁，请稍后再试' }, 429);
        }

        const body = await context.request.json().catch(() => ({}));
        const { orderNo, phone, payMethod, txnLast6 } = body;

        // ===== 参数校验 =====
        if (!orderNo || typeof orderNo !== 'string' || orderNo.trim().length === 0) {
            return json({ success: false, error: '请填写订单号' }, 400);
        }
        if (!phone || !/^1[3-9]\d{9}$/.test(String(phone).trim())) {
            return json({ success: false, error: '请填写下单时的 11 位手机号' }, 400);
        }
        if (!payMethod || !['alipay', 'wechat'].includes(payMethod)) {
            return json({ success: false, error: '请选择支付方式（支付宝/微信）' }, 400);
        }
        const txn = String(txnLast6 || '').trim();
        if (!txn || !/^[A-Za-z0-9]{6}$/.test(txn)) {
            return json({ success: false, error: '请填写转账单号后 6 位（数字或字母）' }, 400);
        }

        // ===== 订单号映射校验 =====
        const orderKey = orderNo.trim().toUpperCase();
        const mapping = await kv.get(KV_ORDER_PREFIX + orderKey, 'json');
        if (!mapping || !mapping.requestId) {
            return json({ success: false, error: '订单不存在，请核对订单号或重新下单' }, 404);
        }

        const record = await kv.get(KV_ADMIN_REQ_PREFIX + mapping.requestId, 'json');
        if (!record) {
            return json({ success: false, error: '订单记录不存在或已失效' }, 404);
        }

        // ★ 双因子校验：手机号必须与下单时一致（防止他人凭订单号冒领）
        if (record.phone !== phone.trim()) {
            return json({ success: false, error: '手机号与订单不匹配，请输入下单时的手机号' }, 403);
        }

        // 状态检查
        if (record.status === 'pending') {
            return json({ success: true, status: 'pending', message: '付款信息已提交，等待管理员核对' });
        }
        if (record.status === 'activated') {
            return json({ success: true, status: 'activated', message: '订单已激活' });
        }
        if (record.status !== 'pending_payment') {
            return json({ success: false, error: '订单当前状态为 ' + record.status + '，无法提交付款信息' }, 400);
        }

        // ===== 写入付款信息，进入后台待审 =====
        record.payMethod = payMethod;
        record.payTxnLast6 = txn.toUpperCase();
        record.paidAt = new Date().toISOString();
        record.status = 'pending';

        await kv.put(KV_ADMIN_REQ_PREFIX + record.requestId, JSON.stringify(record));
        // 进入后台待审列表
        await appendRequestIndex(kv, record.requestId);
        // ★ 写手机号索引：后续该手机号在软件内重复提交时能被 pending_activation 拦截
        await kv.put('admin_phone:' + record.phone, JSON.stringify({
            requestId: record.requestId,
            status: 'pending'
        })).catch(e => {});

        console.log('[OrderPaid] 付款确认已提交:', orderKey,
            'payMethod=', payMethod, 'txnLast6=', record.payTxnLast6);

        return json({
            success: true,
            status: 'pending',
            message: '付款信息已提交，管理员核对到账后即可激活'
        });

    } catch (error) {
        console.error('Order paid error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
