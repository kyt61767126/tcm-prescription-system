// ============================================================================
//  order-confirm-paid.js — 平台管理员确认"官网订单已收款" API
//
//  路由：POST /api/license/order-confirm-paid
//
//  认证：Bearer token（platform_admin）
//
//  请求体：{ "requestId": "REQ-XXXXXXXX-XXXX" }
//
//  返回：{ success: true, status: 'pending', message: '已标记为已付款，进入待审核' }
//
//  ★ 2026-09-05 场景：客户在官网下单（pending_payment）→ 扫码真实付款 →
//    未点官网「已付款·自动匹配」直接关页面回客户端 → 后台记录停在「待付款」。
//    管理员在微信/支付宝收款账单核对到账后，点后台「✅已付款」按钮调本 API：
//    统一走 markOrderPaid（status→pending + paidAt + admin_phone 索引 +
//    admin_req_index 入列，四处原子同步）→ 客户端 admin-status 轮询 /
//    PAYMENT_REQUIRED 断点重试立即命中 pending，进入正常激活审核闭环。
//    payMethod='admin-confirm' / payTxnLast6='ADMIN-CONFIRM' 留痕，
//    审核弹窗显示绿色「管理员已确认收款」提示（区别于客户自助 AUTO-MATCH）。
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from '../_lib/auth.js';
import { getKV } from './_lib/license-core.js';
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
        // 管理员认证
        const currentUser = await parseAuthHeader(context.request, context.env);
        if (!currentUser || !isPlatformAdmin(currentUser)) {
            return json({ success: false, error: '仅平台总管理员可确认收款' }, 403, origin);
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

        // 读取申请记录，校验状态
        const record = await kv.get(KV_ADMIN_REQ_PREFIX + requestId, 'json').catch(() => null);
        if (!record) {
            return json({ success: false, error: '申请记录不存在' }, 404, origin);
        }
        if (record.status !== 'pending_payment') {
            return json({
                success: false,
                error: '当前状态为 ' + record.status + '（仅「待付款」订单可确认收款），请刷新列表'
            }, 409, origin);
        }
        if (!record.orderNo) {
            return json({ success: false, error: '该申请无官网订单号，非官网订单不可用此通道' }, 400, origin);
        }

        // ★ 统一写入口 markOrderPaid（与客户自助 order-paid 同一条路径）：
        //   status→pending + paidAt + admin_phone 索引 + admin_req_index 入列
        const mr = await markOrderPaid(kv, record.orderNo, {
            payMethod: 'admin-confirm',
            payTxnLast6: 'ADMIN-CONFIRM'
        });
        if (!mr || !mr.paid) {
            return json({ success: false, error: '确认收款失败: ' + (mr && mr.reason ? mr.reason : 'unknown') }, 500, origin);
        }

        console.log('[OrderConfirmPaid] 管理员确认收款(四索引同步):', record.orderNo,
            'requestId=', requestId, 'clinic=', record.clinicName, 'phone=', record.phone);

        return json({
            success: true,
            status: 'pending',
            requestId: requestId,
            message: '已标记为已付款，进入待审核列表'
        });

    } catch (error) {
        console.error('Order confirm paid error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500, origin);
    }
}
