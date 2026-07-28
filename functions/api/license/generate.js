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
//      "features": ["backup","sync"],     // 覆盖默认功能列表（可选）
//      "clinicName": "本能堂中医诊所",      // ★ v3 新增：绑定诊所名（可选，激活时校验）
//      "maxDevices": 3                    // ★ v4 新增：最大设备数（可选，默认 1，最大 10）
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
    generateActivationCode, LICENSE_TYPE_CONFIG, appendLicenseLog
} from './_lib/license-core.js';

// P1-6 安全：CORS 收紧为固定域名（客服 PowerShell 调用不受 CORS 限制）
function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': 'https://tcm-prescription-system.pages.dev',
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

// 获取客户端 IP（用于日志记录）
function getClientIP(context) {
    return context.request.headers.get('CF-Connecting-IP') ||
           context.request.headers.get('X-Forwarded-For') ||
           context.request.headers.get('X-Real-IP') ||
           'unknown';
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

        const ip = getClientIP(context);
        const body = await context.request.json().catch(() => ({}));
        const { user, type, days, expiresAt, count, note, maxPrescriptions, features, clinicName, maxDevices } = body;

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
        // ★ v3 新增：如果提供 clinicName，必须非空字符串
        if (clinicName !== undefined && clinicName !== null) {
            if (typeof clinicName !== 'string' || clinicName.trim().length === 0) {
                return json({ success: false, error: 'clinicName 不能为空字符串' }, 400);
            }
            if (clinicName.includes('|')) {
                return json({ success: false, error: 'clinicName 不能包含特殊字符 "|"' }, 400);
            }
            if (clinicName.length > 100) {
                return json({ success: false, error: 'clinicName 长度不能超过 100 字符' }, 400);
            }
        }
        // ★ v4 新增：maxDevices 校验（默认 1，范围 1-10）
        let parsedMaxDevices = 1;
        if (maxDevices !== undefined && maxDevices !== null) {
            parsedMaxDevices = parseInt(maxDevices, 10);
            if (isNaN(parsedMaxDevices) || parsedMaxDevices < 1 || parsedMaxDevices > 10) {
                return json({ success: false, error: 'maxDevices 必须是 1-10 之间的整数' }, 400);
            }
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
                clinicName: clinicName || null,  // ★ v3 新增：绑定的诊所名（null 表示不绑定）
                maxDevices: parsedMaxDevices,    // ★ v4 新增：最大设备数（默认 1，最大 10）
                devices: [],                     // ★ v4 新增：已绑定设备数组（初始为空）
                status: 'unused',  // unused / used / expired / disabled
                maxPrescriptions: maxPrescriptions !== undefined ? maxPrescriptions : undefined,
                features: features || undefined,
                note: note || ''
            };

            await saveLicense(kv, record);
            // ★ 任务5：记录生成日志
            await appendLicenseLog(kv, code, {
                action: 'generate',
                time: record.issuedAt,
                ip: ip,
                operator: currentUser.username,
                detail: `type=${type}, days=${days || 0}, expiresAt=${recordExpiresAt || 'null'}, clinicName=${clinicName || ''}, maxDevices=${parsedMaxDevices}`
            });
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
