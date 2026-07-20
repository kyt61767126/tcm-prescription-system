// ============================================================================
//  generate.js — 激活码生成 API（管理员专用）
//
//  路由：POST /api/license/generate
//
//  认证：Bearer token（platform_admin）
//
//  请求体：
//    {
//      "user": "张三",                    // 用户名（必填）
//      "type": "pro",                     // trial / personal / pro（必填）
//      "days": 365,                       // 有效天数（与 expiresAt 二选一）
//      "expiresAt": "2027-12-31",         // 到期日期 YYYY-MM-DD（与 days 二选一）
//      "count": 1,                        // 生成数量，默认 1，最大 100
//      "note": "客户备注",                // 备注（可选）
//      "maxPrescriptions": 0,             // 覆盖默认处方限制（可选）
//      "features": ["backup","sync"]      // 覆盖默认功能列表（可选）
//    }
//
//  返回：
//    {
//      "success": true,
//      "codes": [
//        { "code": "BNZC-XXXX-XXXX-XXXX-XXXX", "user": "...", "type": "...", ... }
//      ],
//      "count": 1
//    }
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from '../_lib/auth.js';
import {
    getKV, saveLicense, sanitizeRecord,
    generateActivationCode, LICENSE_TYPE_CONFIG
} from './_lib/license-core.js';

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    };
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

function getNowISO() {
    return new Date().toISOString();
}

export async function onRequest(context) {
    const method = context.request.method;

    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders() });
    }

    if (method !== 'POST') {
        return json({ success: false, error: 'Method not allowed' }, 405);
    }

    try {
        // 管理员认证
        const currentUser = await parseAuthHeader(context.request, context.env);
        if (!currentUser || !isPlatformAdmin(currentUser)) {
            return json({ success: false, error: '仅平台总管理员可生成激活码' }, 403);
        }

        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        const body = await context.request.json().catch(() => ({}));
        const { user, type, days, expiresAt, count, note, maxPrescriptions, features } = body;

        // 参数校验
        if (!user) {
            return json({ success: false, error: '请提供用户名（user）' }, 400);
        }
        if (!type || !['trial', 'personal', 'pro'].includes(type)) {
            return json({ success: false, error: 'type 必须是 trial / personal / pro' }, 400);
        }
        if (!days && !expiresAt) {
            return json({ success: false, error: '请提供 days 或 expiresAt' }, 400);
        }

        const generateCount = Math.min(Math.max(parseInt(count, 10) || 1, 1), 100);

        // 计算到期时间（用于记录，非 license.issuedAt）
        let recordExpiresAt = null;
        if (expiresAt) {
            recordExpiresAt = new Date(expiresAt + 'T23:59:59+08:00').toISOString();
        }

        // 生成激活码
        const codes = [];
        for (let i = 0; i < generateCount; i++) {
            const code = generateActivationCode();
            const record = {
                code: code,
                user: user,
                type: type,
                days: days || null,
                expiresAt: recordExpiresAt,
                issuedAt: getNowISO(),
                issuedBy: currentUser.username,
                activatedAt: null,
                machineId: null,
                status: 'unused',  // unused / used / expired / disabled
                maxPrescriptions: maxPrescriptions !== undefined ? maxPrescriptions : undefined,
                features: features || undefined,
                note: note || ''
            };

            await saveLicense(kv, record);
            codes.push(sanitizeRecord(record));
        }

        return json({
            success: true,
            codes: codes,
            count: codes.length
        });

    } catch (error) {
        console.error('License generate error:', error);
        return json({ success: false, error: error.message || 'Internal server error' }, 500);
    }
}
