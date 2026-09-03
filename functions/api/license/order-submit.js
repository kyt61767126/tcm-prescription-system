// ============================================================================
//  order-submit.js — 官网"购买激活码"订单提交 API
//
//  路由：POST /api/license/order-submit
//
//  无需登录认证（官网购买页），保护：速率限制 + 必填校验 + 设备版本校验
//
//  请求体：
//    {
//      "orderNo":    "BNZC-DZ-202608291234-ABC1XY",  // 必填（官网生成的订单号）
//      "productKey": "local",                        // 必填：local / cloud
//      "edition":    "personal",                     // 必填：personal(标准版) / pro(机构版)
//      "price":      "￥99/年",                       // 必填（订单金额文本）
//      "clinicName": "本能堂中医诊所",                  // 必填（姓名/诊所名称）
//      "adminName":  "张三",                          // 必填（取姓名部分，无则用诊所名）
//      "phone":      "13800138000",                  // 必填（11位手机号）
//      "wechat":     "wxid_xxx",                      // 可选
//      "machineId":  "abc123def456...",              // 必填（设备识别码）
//      "note":       "备注"                           // 可选
//    }
//
//  返回：{ success: true, orderNo, status: 'pending_payment' }
//
//  ★ 数据流（官网快速付费闭环）：
//    1. 官网 Step2 提交订单 → 本 API 写入 admin_req:{requestId}
//       （status='pending_payment'，不进后台待审列表，不写 admin_phone 索引）
//    2. 客户 Step3 扫支付宝/微信收款码付款
//    3. 官网 Step4 提交付款确认（order-paid）→ status='pending'，进后台待审列表
//    4. 后台核对付款信息（转账单号后6位 + 支付宝/微信账单）后一键审核通过
//    5. 客户在官网 Step4 轮询 order-status 自助领取激活码
//
//  KV 结构：
//    key: order:{orderNo} -> { requestId, phone }   // 订单号→请求映射（order-paid/status 查询用）
//    key: admin_req:{requestId} -> 与软件内激活申请同构 + 订单扩展字段
// ============================================================================

import { getKV, checkRateLimit, checkDeviceVersion } from './_lib/license-core.js';

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

// 生成请求 ID：REQ-XXXXXXXXX-XXXX（与 admin-submit 相同格式，admin-approve 正则兼容）
function generateRequestId() {
    const ts = Date.now().toString(36).toUpperCase().padStart(9, '0').slice(-9);
    const rand = Array.from(crypto.getRandomValues(new Uint8Array(2)))
        .map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
    return `REQ-${ts}-${rand}`;
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

        // 速率限制（每 IP 每小时 10 次，与 admin-submit 一致）
        const ip = getClientIP(context);
        const rateLimit = await checkRateLimit(kv, ip + ':order-submit', 10);
        if (!rateLimit.allowed) {
            return json({
                success: false,
                error: '提交过于频繁，请稍后再试（每小时限 10 次）'
            }, 429);
        }

        const body = await context.request.json().catch(() => ({}));
        const { orderNo, productKey, edition, price, clinicName, adminName,
                phone, wechat, machineId, note, dp } = body;

        // ===== 参数校验 =====
        if (!orderNo || typeof orderNo !== 'string' || !/^BNZC-[A-Z]{2}-\d{12}-[A-Z0-9]{4,8}$/i.test(orderNo.trim())) {
            return json({ success: false, error: '订单号格式错误' }, 400);
        }
        if (!productKey || !['local', 'cloud'].includes(productKey)) {
            return json({ success: false, error: '产品类型错误' }, 400);
        }
        if (!edition || !['personal', 'pro'].includes(edition)) {
            return json({ success: false, error: '版本类型错误' }, 400);
        }
        if (!clinicName || typeof clinicName !== 'string' || clinicName.trim().length === 0) {
            return json({ success: false, error: '请填写姓名/诊所名称' }, 400);
        }
        if (clinicName.length > 100 || String(clinicName).includes('|')) {
            return json({ success: false, error: '姓名/诊所名称含有非法字符' }, 400);
        }
        if (!phone || !/^1[3-9]\d{9}$/.test(String(phone).trim())) {
            return json({ success: false, error: '请填写正确的 11 位手机号' }, 400);
        }
        let finalMachineId = String(machineId || '').trim();
        if (!finalMachineId || finalMachineId.length < 8) {
            return json({ success: false, error: '请填写正确的设备识别码（在软件激活弹窗中复制）' }, 400);
        }
        if (note && String(note).length > 500) {
            return json({ success: false, error: '备注长度不能超过 500 字符' }, 400);
        }

        // 同一订单号重复提交：幂等返回
        const existing = await kv.get(KV_ORDER_PREFIX + orderNo.trim().toUpperCase(), 'json');
        if (existing && existing.requestId) {
            const rec = await kv.get(KV_ADMIN_REQ_PREFIX + existing.requestId, 'json');
            if (rec) {
                return json({ success: true, orderNo, requestId: rec.requestId, status: rec.status });
            }
        }

        // 同手机号已有"已付款待核对"申请：拦截重复下单（避免一单多付）
        // ★ 2026-09-02 配合支付前置校验调整：仅拦截已付款（paidAt）的 pending；
        //   历史遗留的"未付款"软件端申请不再阻止官网下单——客户正是要来付款的。
        {
            const idx = await kv.get('admin_phone:' + phone.trim(), 'json').catch(() => null);
            if (idx && idx.requestId) {
                const rec = await kv.get(KV_ADMIN_REQ_PREFIX + idx.requestId, 'json').catch(() => null);
                if (rec && rec.phone === phone.trim() && rec.status === 'pending' && rec.paidAt) {
                    return json({
                        success: false,
                        error: '该手机号已有激活申请正在审核中，请等待审核完成，勿重复下单'
                    }, 409);
                }
            }
        }

        // ★ 设备-版本绑定校验（与 admin-submit 同规则，browser- 前缀设备放行）
        const deviceCheck = await checkDeviceVersion(kv, finalMachineId, edition);
        if (!deviceCheck.ok) {
            return json({ success: false, error: deviceCheck.error }, 403);
        }

        // ===== 生成记录 =====
        const requestId = generateRequestId();
        const now = new Date().toISOString();
        const versionLabel = (productKey === 'local' ? '本地' : '云端') +
            (edition === 'pro' ? '机构版' : '标准版') + '（官网订单）';

        const remarkParts = [];
        if (wechat) remarkParts.push('微信号：' + String(wechat).slice(0, 50));
        if (note) remarkParts.push(String(note));
        if (remarkParts.length === 0) remarkParts.push('官网订单');

        const record = {
            requestId: requestId,
            clinicName: clinicName.trim(),
            adminName: (adminName || clinicName).trim().slice(0, 50),
            phone: phone.trim(),
            remark: remarkParts.join('；').slice(0, 500),
            machineId: finalMachineId,
            status: 'pending_payment',  // 官网订单：待付款 → 付款后转 pending
            submittedAt: now,
            submittedIp: ip,
            resolvedAt: null,
            resolvedBy: null,
            licenseCode: null,
            licenseBase64: null,
            rejectReason: null,
            // 版本信息
            productName: '惠康中医',
            edition: edition,            // personal / pro（后台审核弹窗按此自动预选类型）
            appMode: productKey,         // local / cloud
            // ★ 2026-09-03 载体标识（dp：desktop=离线桌面 / app=离线APP）：购买页 URL
            //   ?dp= 传入（客户端跳转时自动携带）；浏览器直接下单无此参数留空，
            //   客户端提交激活申请复用订单时由 admin-submit 补写
            appModeCarrier: (dp === 'desktop' || dp === 'app') ? dp : '',
            versionLabel: versionLabel,
            env: 'production',
            // ★ 官网订单扩展字段（后台核对付款信息用）
            orderSource: 'website',
            orderNo: orderNo.trim().toUpperCase(),
            orderPrice: String(price || '').slice(0, 50),
            payMethod: null,             // 付款确认时写入：alipay / wechat
            payTxnLast6: null,           // 付款确认时写入：转账单号后6位
            paidAt: null
        };

        await kv.put(KV_ADMIN_REQ_PREFIX + requestId, JSON.stringify(record));
        // 订单号映射（order-paid / order-status 查询入口）
        await kv.put(KV_ORDER_PREFIX + record.orderNo, JSON.stringify({
            requestId: requestId,
            phone: record.phone
        }));
        // ★ 不写 admin_phone 索引、不进 admin_req_index：
        //   待付款订单不应出现在后台待审列表；付款确认（order-paid）时再入列。

        console.log('[OrderSubmit] 官网订单已提交:', record.orderNo, 'requestId=', requestId,
            'clinic=', clinicName, 'edition=', edition, 'product=', productKey);

        return json({
            success: true,
            orderNo: record.orderNo,
            requestId: requestId,
            status: 'pending_payment',
            message: '订单已提交，请扫码付款'
        });

    } catch (error) {
        console.error('Order submit error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
