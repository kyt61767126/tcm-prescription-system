// ============================================================================
//  export-license.js — 导出离线激活 license 文件（管理员/客服专用）
//
//  路由：POST /api/license/export-license
//
//  认证：Bearer token（platform_admin）
//        或 LICENSE_EXPORT_SECRET 环境变量（客服专用密钥，需在请求头 X-Export-Secret 传递）
//
//  用途：
//    当客户机器无法联网激活时，客服根据客户提供的机器ID和激活码，
//    调用此接口生成 license.dat 文件内容（base64），通过微信/邮件发给客户。
//    客户在激活窗口点击"导入离线激活文件"按钮选择该文件即可完成激活。
//
//  请求体：
//    {
//      "code": "BNZC-XXXX-XXXX-XXXX-XXXX",   // 激活码（必填）
//      "machineId": "客户提供的32位hex",       // 必填（离线激活的关键）
//      "clinicName": "本能堂中医诊所",          // 若激活码已绑定则必填
//      "user": "张三"                          // 可选，覆盖激活码 user
//    }
//
//  返回（成功）：
//    {
//      "success": true,
//      "license": "base64-encoded-license",   // 客户端写入 license.dat
//      "licenseInfo": { ... },                 // license 元信息
//      "fileName": "license.dat"               // 建议保存的文件名
//    }
//
//  与 validate.js 的区别：
//    - validate.js 是客户端直接调用（无认证 + IP 限速 20/h）
//    - export-license 是管理员/客服调用（Bearer 认证或独立密钥，无限速）
//    - 两者底层均调用 buildLicenseData + encodeLicenseBase64，license 内容完全等价
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from '../_lib/auth.js';
import {
    getKV, getLicense, updateLicense,
    buildLicenseData, encodeLicenseBase64,
    getDevices, getMaxDevices, appendLicenseLog
} from './_lib/license-core.js';

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID, X-Export-Secret',
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

function getClientIP(context) {
    return context.request.headers.get('CF-Connecting-IP') ||
           context.request.headers.get('X-Forwarded-For') ||
           context.request.headers.get('X-Real-IP') ||
           'unknown';
}

// 激活码格式校验
function isValidCodeFormat(code) {
    if (!code || typeof code !== 'string') return false;
    const pattern = /^BNZC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
    return pattern.test(code);
}

// 鉴权：平台管理员 Bearer token 或 LICENSE_EXPORT_SECRET 独立密钥
async function authenticate(context) {
    // 方式1：平台管理员 Bearer token
    try {
        const currentUser = await parseAuthHeader(context.request, context.env);
        if (currentUser && isPlatformAdmin(currentUser)) {
            return { ok: true, operator: currentUser.username || 'admin', method: 'bearer' };
        }
    } catch (e) { /* 继续尝试方式2 */ }

    // 方式2：LICENSE_EXPORT_SECRET 独立密钥（客服专用，无需登录管理后台）
    const exportSecret = context.env.LICENSE_EXPORT_SECRET;
    if (exportSecret) {
        const providedSecret = context.request.headers.get('X-Export-Secret');
        if (providedSecret && providedSecret === exportSecret) {
            return { ok: true, operator: 'export-secret', method: 'secret' };
        }
    }

    return { ok: false, error: '需要平台管理员权限或有效的 LICENSE_EXPORT_SECRET' };
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
        // 鉴权
        const auth = await authenticate(context);
        if (!auth.ok) {
            return json({ success: false, error: auth.error }, 403);
        }

        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        const ip = getClientIP(context);
        const body = await context.request.json().catch(() => ({}));
        const { code, machineId, user, clinicName } = body;

        // 参数校验
        if (!code) {
            return json({ success: false, error: '请提供激活码（code）' }, 400);
        }
        if (!machineId) {
            return json({ success: false, error: '请提供机器 ID（machineId，由客户提供）' }, 400);
        }
        if (typeof machineId !== 'string' || machineId.length < 8 || machineId.length > 128) {
            return json({ success: false, error: 'machineId 长度需在 8-128 之间' }, 400);
        }
        if (!isValidCodeFormat(code)) {
            return json({ success: false, error: '激活码格式错误，应为 BNZC-XXXX-XXXX-XXXX-XXXX' }, 400);
        }
        // clinicName 字符校验
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

        // 诊所名绑定校验（与 validate.js 一致）
        if (record.clinicName) {
            if (!clinicName || clinicName.trim() === '') {
                return json({
                    success: false,
                    error: '此激活码已绑定诊所，必须提供 clinicName',
                    needClinicName: true
                }, 400);
            }
            if (clinicName !== record.clinicName) {
                return json({
                    success: false,
                    error: `诊所名与激活码绑定的诊所不一致（绑定：${record.clinicName}，输入：${clinicName}）`
                }, 403);
            }
        }

        // 多设备授权校验（与 validate.js 一致，支持换机解绑）
        const devices = getDevices(record);
        const maxDevices = getMaxDevices(record);
        const existingDevice = devices.find(d => d.machineId === machineId);

        if (record.status === 'used' && !existingDevice) {
            if (devices.length >= maxDevices) {
                // 换机模式：自动解绑最旧设备
                const oldestDevice = devices[0];
                await appendLicenseLog(kv, code, {
                    action: 'auto-unbind',
                    time: new Date().toISOString(),
                    ip: ip,
                    operator: auth.operator,
                    detail: `[export] auto-unbind oldest device ${oldestDevice.machineId.substring(0, 8)}... for new device ${machineId.substring(0, 8)}..., remaining=${devices.length - 1}/${maxDevices}`
                });
                devices.shift();
            }
        }

        // 到期校验
        if (record.expiresAt) {
            const expireDate = new Date(record.expiresAt);
            if (Date.now() > expireDate.getTime()) {
                await updateLicense(kv, code, { status: 'expired' });
                return json({ success: false, error: '激活码已过期' }, 403);
            }
        }

        // 覆盖 user（如果提供了）
        const licenseUser = user || record.user || record.username || 'user';

        // 生成 license 数据（复用 buildLicenseData）
        const licenseRecord = { ...record, user: licenseUser };
        const licenseOptions = {};
        if (record.clinicName) {
            licenseOptions.clinicName = record.clinicName;
            licenseOptions.machineId = machineId;
            licenseOptions.licenseBinding = 'clinic+user+machine';
        }
        licenseOptions.maxDevices = maxDevices;
        licenseOptions.devicesCount = existingDevice ? devices.length : devices.length + 1;
        licenseOptions.context = context;
        const licenseData = await buildLicenseData(licenseRecord, licenseOptions);

        // 更新激活码记录（与 validate.js 一致）
        const isReactivation = !!existingDevice;
        const updates = {
            status: 'used',
            machineId: machineId,
            activatedAt: getNowISO(),
            activatedIp: ip,
            user: licenseUser
        };
        if (record.clinicName && !record.activatedClinicName) {
            updates.activatedClinicName = record.clinicName;
        }
        const newDevices = devices.slice();
        if (existingDevice) {
            existingDevice.activatedAt = getNowISO();
            existingDevice.clinicName = record.clinicName || existingDevice.clinicName;
        } else {
            newDevices.push({
                machineId: machineId,
                activatedAt: getNowISO(),
                clinicName: record.clinicName || clinicName || null,
                activatedIp: ip
            });
        }
        updates.devices = newDevices;
        updates.maxDevices = maxDevices;
        await updateLicense(kv, code, updates);

        // 记录日志（标记为离线导出）
        await appendLicenseLog(kv, code, {
            action: isReactivation ? 'export-offline-reactivate' : 'export-offline',
            time: updates.activatedAt,
            ip: ip,
            operator: auth.operator,
            detail: `[export-offline] machineId=${machineId.substring(0, 8)}..., clinicName=${record.clinicName || 'null'}, devicesCount=${newDevices.length}/${maxDevices}, authMethod=${auth.method}`
        });

        // 编码为 base64
        const licenseBase64 = encodeLicenseBase64(licenseData);

        // 生成建议的文件名（含诊所名/用户名/日期，便于客服管理）
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const safeName = (record.clinicName || licenseUser || 'user').replace(/[\\/:*?"<>|]/g, '_').substring(0, 20);
        const fileName = `license_${safeName}_${machineId.substring(0, 8)}_${dateStr}.dat`;

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
                clinicName: licenseData.clinicName || null,
                licenseBinding: licenseData.licenseBinding || null,
                maxDevices: licenseData.maxDevices || 1,
                devicesCount: licenseData.devicesCount || 1
            },
            fileName: fileName,
            message: 'license 已生成，请将文件安全发送给客户。客户在激活窗口点击"导入离线激活文件"按钮选择此文件即可完成激活。'
        });

    } catch (error) {
        console.error('License export error:', error);
        return json({ success: false, error: error.message || 'Internal server error' }, 500);
    }
}
