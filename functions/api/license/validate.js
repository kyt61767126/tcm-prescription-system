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
//      "user": "张三",                        // 用户名（可选，覆盖激活码上的 user）
//      "clinicName": "本能堂中医诊所"          // ★ v3 新增：诊所名（激活码绑定时必填）
//    }
//
//  返回（成功）：
//    {
//      "success": true,
//      "license": "base64-encoded-license",   // 客户端写入 license.dat
//      "licenseInfo": {                        // license 元信息（不包含签名）
//        "user": "...", "type": "...", "expiresAt": "...",
//        "maxPrescriptions": 0, "features": [...],
//        "clinicName": "...", "licenseBinding": "clinic+user+machine"
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
        const { code, machineId, user, clinicName } = body;

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
        // ★ v3 新增：clinicName 长度/字符校验
        if (clinicName !== undefined && clinicName !== null && clinicName !== '') {
            if (typeof clinicName !== 'string') {
                return json({ success: false, error: 'clinicName 必须是字符串' }, 400);
            }
            if (clinicName.includes('|')) {
                return json({ success: false, error: 'clinicName 不能包含特殊字符 "|"' }, 400);
            }
            if (clinicName.length > 100) {
                return json({ success: false, error: 'clinicName 长度不能超过 100 字符' }, 400);
            }
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

        // ★ v3 新增：诊所名绑定校验
        // 仅当激活码生成时已绑定 clinicName 时才校验（向后兼容旧激活码）
        if (record.clinicName) {
            if (!clinicName || clinicName.trim() === '') {
                return json({
                    success: false,
                    error: '此激活码已绑定诊所，激活时必须提供 clinicName',
                    needClinicName: true
                }, 400);
            }
            if (clinicName !== record.clinicName) {
                return json({
                    success: false,
                    error: `诊所名与激活码绑定的诊所不一致（绑定：${record.clinicName}，输入：${clinicName}），请联系客服核对`
                }, 403);
            }
        }

        // 已使用：仅允许同一机器 + 同一诊所重激活
        if (record.status === 'used') {
            if (record.machineId !== machineId) {
                return json({
                    success: false,
                    error: '激活码已绑定其他设备，如需换机请联系管理员解绑'
                }, 403);
            }
            // ★ v3 新增：同机器重激活时，诊所名也必须一致
            if (record.clinicName && record.clinicName !== clinicName) {
                return json({
                    success: false,
                    error: '诊所名与已激活记录不一致，无法重新激活'
                }, 403);
            }
            // 同机器 + 同诊所重激活，允许重新生成 license
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
        // ★ v3 新增：将 clinicName + machineId + licenseBinding 传给 buildLicenseData
        // 仅当激活码已绑定诊所名时才启用 v3 签名（含绑定字段）
        const licenseRecord = { ...record, user: licenseUser };
        const licenseOptions = {};
        if (record.clinicName) {
            licenseOptions.clinicName = record.clinicName;
            licenseOptions.machineId = machineId;
            licenseOptions.licenseBinding = 'clinic+user+machine';
        }
        const licenseData = await buildLicenseData(licenseRecord, licenseOptions);

        // 更新激活码记录：标记为已使用，绑定机器 ID + 诊所名
        const updates = {
            status: 'used',
            machineId: machineId,
            activatedAt: getNowISO(),
            activatedIp: ip,
            user: licenseUser
        };
        // ★ v3 新增：首次激活时记录 clinicName（已使用重激活时不变更）
        if (record.clinicName && !record.activatedClinicName) {
            updates.activatedClinicName = record.clinicName;
        }
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
                features: licenseData.features,
                clinicName: licenseData.clinicName || null,           // ★ v3 新增
                licenseBinding: licenseData.licenseBinding || null    // ★ v3 新增
            }
        });

    } catch (error) {
        console.error('License validate error:', error);
        return json({ success: false, error: error.message || 'Internal server error' }, 500);
    }
}
