// ============================================================================
//  ticket/submit.js — 客户端"激活工单"提交 API（对接规则3）
//
//  路由：POST /api/license/ticket/submit
//
//  无需登录认证（客户端激活前尚未登录），保护措施：
//    - 速率限制：每 IP 每小时 10 次
//    - 必填字段校验 + 长度截断（防注入）
//    - 手机号格式校验（填写时）
//
//  调用方：license-manager.js submitActivationTicket()
//  请求体（safePayload）：
//    {
//      "machineId": "abc123def456...",     // 必填（哈希串，规则3不上原始硬件）
//      "edition": "institution|personal",  // 版本意向（可选）
//      "clinicName": "惠康中医诊所",         // 必填
//      "contactName": "张医生",             // 必填
//      "contactPhone": "13800138000",       // contactPhone/contactWechat 至少一个
//      "contactWechat": "wxid_xxx",        // 可选
//      "remark": "备注",                    // 可选
//      "submittedAt": "客户端时间ISO"        // 可选（服务端以自己的时间为准）
//    }
//
//  返回：{ success: true, ticketNo: "TK-XXXXXXXX-XXXXXX" }
//
//  KV 数据结构（与 admin_req 模式对齐，独立前缀）：
//    key: ticket:{ticketNo}
//    value: { ticketNo, machineId, edition, clinicName, contactName, contactPhone,
//             contactWechat, remark, submittedAt, submittedIp, status,
//             resolvedAt, resolvedBy, licenseCode, rejectReason, type }
//    key: ticket_index -> [ticketNo1, ticketNo2, ...]（最新在前，上限500）
// ============================================================================

import { getKV, checkRateLimit } from '../_lib/license-core.js';

// Electron file:// 加载时 Origin 为 "null" 字符串，需放行
const ALLOWED_ORIGINS = [
    'https://tcm-prescription-system.pages.dev',
    'https://admin.huikangzy.com',
    'capacitor://localhost',
    'ionic://localhost',
    'http://localhost',
    'https://localhost',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:8080',
    'http://127.0.0.1',
    'https://127.0.0.1',
    'null'
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

const KV_TICKET_PREFIX = 'ticket:';
const KV_TICKET_INDEX = 'ticket_index';
const TICKET_INDEX_MAX = 500;

function genTicketNo() {
    const d = new Date();
    const ymd = String(d.getUTCFullYear()) +
        String(d.getUTCMonth() + 1).padStart(2, '0') +
        String(d.getUTCDate()).padStart(2, '0');
    const rnd = Array.from(crypto.getRandomValues(new Uint8Array(6)))
        .map(b => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join('');
    return `TK-${ymd}-${rnd}`;
}

export async function onRequest(context) {
    const method = context.request.method;
    _currentRequest = context.request;

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

        // IP 限流：每 IP 每小时 10 次提交
        const ip = getClientIP(context);
        const rl = await checkRateLimit(kv, 'ticket-' + ip, 10);
        if (!rl.allowed) {
            return json({ success: false, error: '提交过于频繁，请 1 小时后再试' }, 429);
        }

        const body = await context.request.json().catch(() => ({}));

        // 输入清洗（长度截断防注入，与客户端 safePayload 口径一致）
        const machineId = String(body.machineId || '').trim().slice(0, 128);
        const clinicName = String(body.clinicName || '').trim().slice(0, 100);
        const contactName = String(body.contactName || '').trim().slice(0, 50);
        const contactPhone = String(body.contactPhone || '').trim().slice(0, 20);
        const contactWechat = String(body.contactWechat || '').trim().slice(0, 50);
        const edition = String(body.edition || '').trim().slice(0, 32);
        const remark = String(body.remark || '').trim().slice(0, 500);

        // 必填校验
        if (!machineId || machineId.length < 8 || machineId === 'unknown') {
            return json({ success: false, error: '设备标识无效，请稍后重试' }, 400);
        }
        if (!clinicName) {
            return json({ success: false, error: '请填写诊所名称' }, 400);
        }
        if (!contactName) {
            return json({ success: false, error: '请填写联系人姓名' }, 400);
        }
        if (!contactPhone && !contactWechat) {
            return json({ success: false, error: '请至少填写一种联系方式（手机号/微信号）' }, 400);
        }
        if (contactPhone && !/^[0-9+\-\s]{5,20}$/.test(contactPhone)) {
            return json({ success: false, error: '手机号格式不正确' }, 400);
        }

        // 生成工单
        const nowIso = new Date().toISOString();
        const ticketNo = genTicketNo();
        const ticket = {
            ticketNo,
            machineId,
            edition,
            clinicName,
            contactName,
            contactPhone,
            contactWechat,
            remark,
            submittedAt: nowIso,           // 以服务端时间为准（客户端 submittedAt 不可信）
            submittedIp: ip,
            status: 'pending',
            resolvedAt: null,
            resolvedBy: null,
            licenseCode: null,
            rejectReason: null,
            type: null                     // 审批时管理员最终确认的激活类型（pro/personal）
        };

        await kv.put(KV_TICKET_PREFIX + ticketNo, JSON.stringify(ticket));

        // 更新索引（最新在前，上限截断防膨胀）
        const index = (await kv.get(KV_TICKET_INDEX, 'json')) || [];
        index.unshift(ticketNo);
        if (index.length > TICKET_INDEX_MAX) index.length = TICKET_INDEX_MAX;
        await kv.put(KV_TICKET_INDEX, JSON.stringify(index));

        console.log('[TicketSubmit] 新工单:', ticketNo, 'clinic=', clinicName,
            'machineId=', machineId.substring(0, 8) + '...', 'ip=', ip);

        return json({ success: true, ticketNo });

    } catch (error) {
        console.error('Ticket submit error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
