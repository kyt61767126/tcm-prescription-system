// ============================================================================
//  order-status.js — 官网订单状态自助查询 API
//
//  路由：GET /api/license/order-status?orderNo=xxx&phone=13800138000
//
//  无需登录认证（官网购买页），保护：速率限制 + 订单号/手机号双因子校验
//
//  返回：
//    { success: true, status, orderNo, versionLabel, orderPrice,
//      payMethod, paidAt, licenseCode, rejectReason }
//
//  ★ status 状态机：
//    pending_payment — 已下单待付款
//    pending         — 已付款待管理员核对
//    activated       — 已激活（licenseCode 返回激活码，客户粘贴到软件激活）
//    rejected        — 已拒绝（rejectReason 返回原因）
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
    // ★ 2026-09-06 架构重构：file:// 客户端（Origin: null，离线APP/桌面 WebView）
    //   放行，对齐 admin-submit/admin-status/order-submit。
    const allowedOrigin = (origin && ALLOWED_ORIGINS.includes(origin)) ? origin : 'null';
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
const KV_ORDER_PREFIX = 'order:';

export async function onRequest(context) {
    _currentRequest = context.request;
    const method = context.request.method;

    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders() });
    }

    if (method !== 'GET') {
        return json({ success: false, error: 'Method not allowed' }, 405);
    }

    try {
        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        // 速率限制（防爆破订单号，每 IP 每小时 60 次）
        const ip = getClientIP(context);
        const rateLimit = await checkRateLimit(kv, ip + ':order-status', 60);
        if (!rateLimit.allowed) {
            return json({ success: false, error: '查询过于频繁，请稍后再试' }, 429);
        }

        const url = new URL(context.request.url);
        const orderNo = (url.searchParams.get('orderNo') || '').trim().toUpperCase();
        const phone = (url.searchParams.get('phone') || '').trim();

        if (!orderNo) {
            return json({ success: false, error: '请填写订单号' }, 400);
        }
        // ★ 2026-09-06 架构重构：手机号改为可选。
        //   订单恢复模式（客户端直建订单后跳 download.html?orderNo=，URL 不携带手机号）：
        //   不带手机号 → 返回状态/展示信息但**不返回激活码**（激活码仍需手机号双因子，
        //   防订单号被枚举泄露 license）；带手机号且匹配 → 完整返回（旧官网领码链路不变）。
        const hasPhone = !!phone && /^1[3-9]\d{9}$/.test(phone);

        // ===== 订单号映射校验 =====
        const mapping = await kv.get(KV_ORDER_PREFIX + orderNo, 'json');
        if (!mapping || !mapping.requestId) {
            return json({ success: false, error: '订单不存在，请核对订单号' }, 404);
        }

        const record = await kv.get(KV_ADMIN_REQ_PREFIX + mapping.requestId, 'json');
        if (!record) {
            return json({ success: false, error: '订单记录不存在或已失效' }, 404);
        }

        // ★ 双因子校验：带手机号查询时必须与下单时一致
        if (hasPhone && record.phone !== phone) {
            return json({ success: false, error: '手机号与订单不匹配，请输入下单时的手机号' }, 403);
        }

        // 手机号掩码（无手机号恢复模式下展示用，不暴露完整号码）
        const rawPhone = record.phone || '';
        const phoneMasked = /^1[3-9]\d{9}$/.test(rawPhone)
            ? rawPhone.slice(0, 3) + '****' + rawPhone.slice(7) : '';

        // activated 状态且手机号双因子通过才返回激活码（licenseCode 在 admin-approve 通过时写入）
        const result = {
            success: true,
            status: record.status,
            orderNo: record.orderNo || orderNo,
            // ★ 2026-09-03 回显手机号：领码成功面板提示"云端登录账号=手机号"用。
            //   仅在手机号双因子通过时回显完整手机号；否则只给掩码。
            phone: hasPhone ? (record.phone || phone) : phoneMasked,
            phoneVerified: hasPhone,
            // ★ 2026-09-06 恢复模式只读展示字段（订单号本身为高熵秘密，仅客户持有链接）
            clinicName: record.clinicName || '',
            adminName: record.adminName || '',
            versionLabel: record.versionLabel || '',
            orderPrice: record.orderPrice || '',
            payMethod: record.payMethod || null,
            payTxnLast6: record.payTxnLast6 || null,
            paidAt: record.paidAt || null,
            licenseCode: (record.status === 'activated' && hasPhone) ? (record.licenseCode || null) : null,
            rejectReason: record.status === 'rejected' ? (record.rejectReason || null) : null
        };

        return json(result);

    } catch (error) {
        console.error('Order status error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
