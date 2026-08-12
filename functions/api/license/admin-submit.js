// ============================================================================
//  admin-submit.js — 客户端"管理员激活"请求提交 API
//
//  路由：POST /api/license/admin-submit
//
//  无需登录认证（客户端激活前尚未登录），但有以下保护：
//    - 速率限制：每 IP 每小时 10 次提交
//    - 手机号格式校验
//    - 必填字段校验
//
//  请求体：
//    {
//      "clinicName": "惠康中医诊所",     // 必填
//      "adminName": "张医生",            // 必填
//      "phone": "13800138000",           // 必填（11位手机号）
//      "remark": "备注说明",             // 可选
//      "machineId": "abc123def456"       // 必填
//    }
//
//  返回：
//    { "success": true, "requestId": "REQ-XXXXXXXX-XXXX" }
//    { "success": false, "error": "错误原因" }
//
//  KV 数据结构：
//    key: admin_req:{requestId}
//    value: { requestId, clinicName, adminName, phone, remark, machineId,
//             status, submittedAt, resolvedAt, licenseCode, licenseBase64,
//             rejectReason, resolvedBy }
//    key: admin_req_index  -> [requestId1, requestId2, ...]
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
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

// 生成请求 ID：REQ-XXXXXXXXXXXX-XXXX（12位时间戳后缀 + 4位随机）
function generateRequestId() {
    const ts = Date.now().toString(36).toUpperCase().padStart(9, '0').slice(-9);
    const rand = Array.from(crypto.getRandomValues(new Uint8Array(2)))
        .map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
    return `REQ-${ts}-${rand}`;
}

const KV_ADMIN_REQ_PREFIX = 'admin_req:';
const KV_ADMIN_REQ_INDEX = 'admin_req_index';

// 索引维护（追加 requestId，限制最大 1000 条防止无限增长）
async function appendRequestIndex(kv, requestId) {
    try {
        const index = (await kv.get(KV_ADMIN_REQ_INDEX, 'json')) || [];
        if (!index.includes(requestId)) {
            index.unshift(requestId);  // 新请求放最前面
            if (index.length > 1000) index.length = 1000;
            await kv.put(KV_ADMIN_REQ_INDEX, JSON.stringify(index));
        }
    } catch (e) {
        console.warn('[AdminSubmit] 索引更新失败:', e.message);
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

        // 速率限制（防滥用，每 IP 每小时 10 次）
        const ip = getClientIP(context);
        const rateLimit = await checkRateLimit(kv, ip + ':admin-submit', 10);
        if (!rateLimit.allowed) {
            return json({
                success: false,
                error: '提交请求过于频繁，请稍后再试（每小时限 10 次）',
                rateLimited: true
            }, 429);
        }

        const body = await context.request.json().catch(() => ({}));
        const { clinicName, adminName, phone, remark, machineId, 
                productName, edition, appMode, versionLabel, env } = body;

        // 参数校验
        if (!clinicName || typeof clinicName !== 'string' || clinicName.trim().length === 0) {
            return json({ success: false, error: '请填写诊所名称' }, 400);
        }
        if (clinicName.length > 100) {
            return json({ success: false, error: '诊所名称长度不能超过 100 字符' }, 400);
        }
        if (clinicName.includes('|')) {
            return json({ success: false, error: '诊所名称不能包含特殊字符 |' }, 400);
        }
        if (!adminName || typeof adminName !== 'string' || adminName.trim().length === 0) {
            return json({ success: false, error: '请填写管理员姓名' }, 400);
        }
        if (adminName.length > 50) {
            return json({ success: false, error: '管理员姓名长度不能超过 50 字符' }, 400);
        }
        if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
            return json({ success: false, error: '请填写正确的 11 位手机号' }, 400);
        }
        if (!machineId || typeof machineId !== 'string' || machineId.length < 8) {
            return json({ success: false, error: '机器 ID 无效，请重启软件后重试' }, 400);
        }
        if (remark && typeof remark !== 'string' && remark.length > 500) {
            return json({ success: false, error: '备注长度不能超过 500 字符' }, 400);
        }

        // 生成请求 ID 并存储
        const requestId = generateRequestId();
        const record = {
            requestId: requestId,
            clinicName: clinicName.trim(),
            adminName: adminName.trim(),
            phone: phone.trim(),
            remark: (remark || '').trim(),
            machineId: machineId,
            status: 'pending',  // pending / activated / rejected / cancelled
            submittedAt: new Date().toISOString(),
            submittedIp: ip,
            resolvedAt: null,
            resolvedBy: null,
            licenseCode: null,      // 审核通过时关联的激活码
            licenseBase64: null,    // 审核通过时下发的 license（base64）
            rejectReason: null,
            // ★ 版本信息：区分离线/云端、机构版/标准版
            productName: (productName || '').trim(),
            edition: (edition || '').trim(),
            appMode: (appMode || '').trim(),
            versionLabel: (versionLabel || '').trim(),
            // ★ 环境标记：test=测试环境，production=正式环境
            env: (env || 'production').trim()
        };

        await kv.put(KV_ADMIN_REQ_PREFIX + requestId, JSON.stringify(record));
        await appendRequestIndex(kv, requestId);

        console.log('[AdminSubmit] 新激活请求:', requestId, 'clinic=', clinicName, 'machineId=', machineId.substring(0, 8) + '...');

        return json({
            success: true,
            requestId: requestId,
            message: '激活请求已提交，请耐心等待管理员审核'
        });

    } catch (error) {
        console.error('Admin submit error:', error);
        return json({ success: false, error: error.message || 'Internal server error' }, 500);
    }
}
