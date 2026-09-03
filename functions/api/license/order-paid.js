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
//      "txnLast6":  "A1B2C3" | "AUTO"              // 6位单号，或"AUTO"=免输走自动匹配(后台按下单时间+金额+店名+手机号核对)
//    }
//
//  返回：{ success: true, status: 'pending', autoMatch?: true }
//
//  ★ 数据流：
//    1. 校验 order:{orderNo} 映射存在，且记录 phone 与请求一致
//    2. AUTO 模式校验：客户量极少(目前<30单/天) + 金额固定(￥99/￥198) + 时间±15min
//       下的 4 维唯一识别 (提交时间+金额+版本+手机号) 基本可 1:1 对应到账记录，
//       写入 payTxnLast6="AUTO-MATCH" 标记，后台审核时核对侧显黄条提示
//       「此单为免填自动匹配，请按【下单时间+金额￥xx+店名+手机号后4位】查找到账
//       记录」，仍需人工按 4 维确认过账(安全双保险，不做自动通过)。
//    3. 普通模式按原 txnLast6 6 位写入校验不变
//    4. status: pending_payment → pending，并写入 admin_req_index
//       （进入后台「管理员激活审核」待审列表）
//    5. 后台管理员按 4 维(含转账单号或AUTO提示)核对到账金额后一键审核通过。
// ============================================================================

import { getKV, checkRateLimit } from './_lib/license-core.js';
import { markOrderPaid } from './_lib/license-write-service.js';

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
const KV_ORDER_PREFIX = 'order:';

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
        const txn = String(txnLast6 || '').trim().toUpperCase();
        // ★ 2026-09-04 AUTO 免输匹配：客户点「已付款·自动匹配」按钮即提交 txn=AUTO。
        //   格式校验: AUTO字面量跳过6位校验。订单必须是官网订单(4维在record里)——该项校验在
        //   record读取后执行(见下record.orderSource check)。
        //   安全双保险：后台永远人工按【下单时间+金额+店名+手机号后4位】4维核对，
        //   不自动审核通过，AUTO仅为客户免填+进待审的快捷通道。
        const isAutoMatch = (txn === 'AUTO');
        if (!isAutoMatch) {
            if (!txn || !/^[A-Za-z0-9]{6}$/.test(txn)) {
                return json({ success: false, error: '请填写转账单号后 6 位（数字或字母）' }, 400);
            }
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

        // ★ AUTO 模式仅官网订单可用(4维字段完整)
        if (isAutoMatch && record.orderSource !== 'website') {
            return json({ success: false, error: '当前订单不支持免填自动匹配，请手动填写转账单号后6位' }, 400);
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

        // ===== 2026-09-03 (架构统一 P2) 统一走 markOrderPaid：
        // 补 payMethod/payTxnLast6/paidAt + status→pending +
        // admin_phone: 索引 pending + admin_req_index 入队（4 处原子同步写入）
        // 原 L156-L169 内联写 + appendRequestIndex 内联副本 合并到 Service。
        const payInfo = {
            payMethod: payMethod,
            // AUTO-MATCH: 客户选择免填自动匹配，由后台按下单时间+金额+店名+手机号后4位人工核对
            payTxnLast6: isAutoMatch ? 'AUTO-MATCH' : txn.toUpperCase()
        };
        const mr = await markOrderPaid(kv, orderKey, payInfo);
        if (!mr || !mr.paid) {
            return json({ success: false, error: '付款确认失败: ' + (mr && mr.reason ? mr.reason : 'unknown') }, 500);
        }

        console.log('[OrderPaid] 通过 Service 付款确认(三索引同步):', orderKey,
            'payMethod=', payMethod, 'txnLast6=', mr.record && mr.record.payTxnLast6,
            isAutoMatch ? '(AUTO免填匹配)' : '');

        return json({
            success: true,
            status: 'pending',
            autoMatch: !!isAutoMatch,
            message: isAutoMatch
                ? '已提交自动匹配申请，管理员将按【下单时间+金额+店名+手机号】核对到账后激活（无需再填转账单号）'
                : '付款信息已提交，管理员核对到账后即可激活'
        });

    } catch (error) {
        console.error('Order paid error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
