// ============================================================================
//  admin-status.js — 客户端"管理员激活"状态查询 API
//
//  路由：GET /api/license/admin-status?requestId=REQ-XXXXXXXX-XXXX
//
//  无需登录认证（客户端激活前尚未登录），但通过 requestId 查询。
//
//  返回：
//    pending:    { success: true, status: "pending" }
//    activated:  { success: true, status: "activated", license: "base64..." }
//    rejected:   { success: true, status: "rejected", reason: "拒绝原因" }
//    cancelled:  { success: true, status: "cancelled" }
//    不存在:     { success: false, error: "请求不存在或已失效" }
// ============================================================================

import { getKV, checkRateLimit } from './_lib/license-core.js';
import { provisionCloudAccount } from './_lib/admin-account.js';

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
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    };
}

function json(data, status, origin) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });
}

function getClientIP(context) {
    return context.request.headers.get('CF-Connecting-IP') ||
           context.request.headers.get('X-Forwarded-For') ||
           context.request.headers.get('X-Real-IP') ||
           'unknown';
}

const KV_ADMIN_REQ_PREFIX = 'admin_req:';

export async function onRequest(context) {
    const method = context.request.method;
    const origin = context.request.headers.get('Origin') || '';

    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders(origin) });
    }

    if (method !== 'GET') {
        return json({ success: false, error: 'Method not allowed' }, 405, origin);
    }

    try {
        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500, origin);
        }

        // 速率限制（每 IP 每小时 600 次，足够 5 秒轮询 5 分钟）
        const ip = getClientIP(context);
        const rateLimit = await checkRateLimit(kv, ip + ':admin-status', 600);
        if (!rateLimit.allowed) {
            return json({
                success: false,
                error: '查询过于频繁，请稍后再试',
                rateLimited: true
            }, 429, origin);
        }

        const url = new URL(context.request.url);
        const requestId = url.searchParams.get('requestId');

        if (!requestId) {
            return json({ success: false, error: '缺少 requestId 参数' }, 400, origin);
        }

        // 防止路径穿越：requestId 必须为字母数字+短横
        if (!/^REQ-[A-Z0-9]+-[A-F0-9]+$/i.test(requestId)) {
            return json({ success: false, error: 'requestId 格式错误' }, 400, origin);
        }

        const record = await kv.get(KV_ADMIN_REQ_PREFIX + requestId, 'json');
        if (!record) {
            return json({ success: false, error: '请求不存在或已失效' }, 404, origin);
        }

        // 根据状态返回不同结构
        const status = record.status;
        if (status === 'pending') {
            return json({ success: true, status: 'pending' }, 200, origin);
        }
        if (status === 'activated') {
            // ★ 2026-08-19 幂等补开：修复上线前已通过但未创建云端账号的历史激活请求
            // admin-approve 的自动开通仅在审核通过那一刻执行；若当时该修复尚未部署，
            // 该请求就没有云端账号，客户端用手机号登录会 401。这里每次轮询 activated
            // 时都尝试补开（幂等，已存在则跳过），让历史激活直接可登录。
            try {
                await provisionCloudAccount(kv, record);
            } catch (e) {
                console.warn('[AdminStatus] 云端账号补开失败（不影响license读取）:', e.message);
            }
            // ★ 关键：客户端检查 status === 'activated' 时会取 result.license 写入 license.dat
            return json({
                success: true,
                status: 'activated',
                license: record.licenseBase64,
                licenseInfo: {
                    user: record.adminName,
                    clinicName: record.clinicName,
                    licenseCode: record.licenseCode,
                    resolvedAt: record.resolvedAt
                }
            }, 200, origin);
        }
        if (status === 'rejected') {
            return json({
                success: true,
                status: 'rejected',
                reason: record.rejectReason || '管理员未填写拒绝原因'
            }, 200, origin);
        }
        if (status === 'cancelled') {
            return json({ success: true, status: 'cancelled' }, 200, origin);
        }

        // 未知状态兜底
        return json({ success: true, status: status || 'unknown' }, 200, origin);

    } catch (error) {
        console.error('Admin status error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500, origin);
    }
}
