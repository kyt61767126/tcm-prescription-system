// ============================================================================
//  validate.js — 激活码校验 API（客户端激活时调用）
//
//  路由：POST /api/license/validate
//
//  无需登录认证（客户端激活前尚未登录），但有以下保护：
//    - 速率限制：每 IP 每小时 5 次校验请求
//    - 激活码格式校验
//    - 状态校验（unused 或 同机器重激活）
//
//  请求体：
//    {
//      "code": "BNZC-XXXX-XXXX-XXXX-XXXX",   // 激活码
//      "machineId": "abc123def456",           // 客户端机器 ID
//      "user": "张三"                          // 用户名（可选，覆盖激活码上的 user）
//    }
//
//  返回（成功）：
//    {
//      "success": true,
//      "license": "base64-encoded-license",   // 客户端写入 license.dat
//      "licenseInfo": {                        // license 元信息（不包含签名）
//        "user": "...", "type": "...", "expiresAt": "...",
//        "maxPrescriptions": 0, "features": [...]
//      }
//    }
//
//  返回（失败）：
//    { "success": false, "error": "错误原因" }
// ============================================================================

import {
    getKV, getLicense, updateLicense, saveLicense,
    buildLicenseData, encodeLicenseBase64, checkRateLimit
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

// 获取客户端 IP（用于速率限制）
function getClientIP(context) {
    return context.request.headers.get('CF-Connecting-IP') ||
           context.request.headers.get('X-Forwarded-For') ||
           context.request.headers.get('X-Real-IP') ||
           'unknown';
}

// 激活码格式校验：BNZC-XXXX-XXXX-XXXX-XXXX
function isValidCodeFormat(code) {
    if (!code || typeof code !== 'string') return false;
    const pattern = /^BNZC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
    return pattern.test(code);
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
        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        // 速率限制
        const ip = getClientIP(context);
        const rateLimit = await checkRateLimit(kv, ip, 5);
        if (!rateLimit.allowed) {
            return json({
                success: false,
                error: '校验请求过于频繁，请稍后再试（每小时限 5 次）',
                rateLimited: true
            }, 429);
        }

        const body = await context.request.json().catch(() => ({}));
        const { code, machineId, user } = body;

        // 参数校验
        if (!code) {
            return json({ success: false, error: '请提供激活码' }, 400);
        }
        if (!machineId) {
            return json({ success: false, error: '请提供机器 ID' }, 400);
        }
        if (!isValidCodeFormat(code)) {
            return json({ success: false, error: '激活码格式错误' }, 400);
        }

        // 查询激活码
        const record = await getLicense(kv, code);
        if (!record) {
            return json({ success: false, error: '激活码不存在' }, 404);
        }

        // 状态校验
        if (record.status === 'disabled') {
            return json({ success: false, error: '激活码已被禁用，请联系管理员' }, 403);
        }
        if (record.status === 'expired') {
            return json({ success: false, error: '激活码已过期' }, 403);
        }

        // 已使用：仅允许同一机器重激活（换机需管理员解绑）
        if (record.status === 'used') {
            if (record.machineId !== machineId) {
                return json({
                    success: false,
                    error: '激活码已绑定其他设备，如需换机请联系管理员解绑'
                }, 403);
            }
            // 同机器重激活，允许重新生成 license
        }

        // 到期校验（如果激活码本身有 expiresAt）
        if (record.expiresAt) {
            const expireDate = new Date(record.expiresAt);
            if (Date.now() > expireDate.getTime()) {
                await updateLicense(kv, code, { status: 'expired' });
                return json({ success: false, error: '激活码已过期' }, 403);
            }
        }

        // 覆盖 user（如果客户端提供了）
        const licenseUser = user || record.user || record.username || 'user';

        // 生成 license 数据
        const licenseRecord = { ...record, user: licenseUser };
        const licenseData = await buildLicenseData(licenseRecord);

        // 更新激活码记录：标记为已使用，绑定机器 ID
        const updates = {
            status: 'used',
            machineId: machineId,
            activatedAt: getNowISO(),
            activatedIp: ip,
            user: licenseUser
        };
        await updateLicense(kv, code, updates);

        // 编码为 base64（客户端写入 license.dat 的格式）
        const licenseBase64 = encodeLicenseBase64(licenseData);

        return json({
            success: true,
            license: licenseBase64,
            licenseInfo: {
                user: licenseData.user,
                type: licenseData.type,
                issuedAt: licenseData.issuedAt,
                expiresAt: licenseData.expiresAt,
                maxPrescriptions: licenseData.maxPrescriptions,
                features: licenseData.features
            }
        });

    } catch (error) {
        console.error('License validate error:', error);
        return json({ success: false, error: error.message || 'Internal server error' }, 500);
    }
}
