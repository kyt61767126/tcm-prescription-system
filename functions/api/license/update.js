// ============================================================================
//  update.js — 更新激活码字段 API（管理员专用）
//
//  路由：POST /api/license/update
//
//  用途：修改已生成激活码的可变字段（maxDevices / clinicName / user / note）
//        典型场景：用户升级套餐（maxDevices 1→5）、修改诊所名、修正备注等。
//
//  认证：Bearer token（platform_admin）
//
//  请求体：
//    {
//      "code": "BNZC-XXXX-XXXX-XXXX-XXXX",   // 必填
//      "maxDevices": 5,                       // 可选，1-10
//      "clinicName": "本能堂中医诊所",          // 可选
//      "user": "张三",                         // 可选
//      "note": "客户A"                         // 可选
//    }
//
//  返回：
//    {
//      "success": true,
//      "message": "已更新 N 个字段",
//      "changes": ["maxDevices 1→5", ...],
//      "data": { ...sanitizeRecord }
//    }
//
//  注意：
//    - 修改 maxDevices 时，若新配额 < 已绑定设备数，自动 FIFO 解绑最旧设备
//    - 修改 clinicName 不会影响已激活设备的 clinicName 字段（仅修改激活码绑定诊所名）
//    - 不允许修改 code / type / status / expiresAt / signature 等关键字段
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from '../_lib/auth.js';
import {
    getKV, getLicense, saveLicense, sanitizeRecord,
    KV_LICENSE_PREFIX,
    getDevices, getMaxDevices, appendLicenseLog
} from './_lib/license-core.js';

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': 'https://tcm-prescription-system.pages.dev',
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
            return json({ success: false, error: '仅平台总管理员可修改激活码' }, 403);
        }

        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        const ip = getClientIP(context);
        const body = await context.request.json().catch(() => ({}));
        const { code, maxDevices, clinicName, user, note } = body;

        // 参数校验
        if (!code || typeof code !== 'string') {
            return json({ success: false, error: '缺少 code 参数' }, 400);
        }

        const record = await getLicense(kv, code);
        if (!record) {
            return json({ success: false, error: '激活码不存在' }, 404);
        }

        const changes = [];

        // ===== 修改 maxDevices =====
        if (maxDevices !== undefined && maxDevices !== null && maxDevices !== '') {
            const newMax = parseInt(maxDevices, 10);
            if (isNaN(newMax) || newMax < 1 || newMax > 10) {
                return json({ success: false, error: 'maxDevices 必须在 1-10 之间' }, 400);
            }
            const oldMax = getMaxDevices(record);
            if (newMax !== oldMax) {
                // 若新配额小于已绑定设备数，需先解绑多余的设备（FIFO）
                const devices = getDevices(record);
                if (devices.length > newMax) {
                    const removed = devices.splice(0, devices.length - newMax);
                    for (const d of removed) {
                        await appendLicenseLog(kv, code, {
                            action: 'auto-unbind',
                            time: new Date().toISOString(),
                            ip: ip,
                            operator: currentUser.username,
                            detail: '修改配额自动解绑多余设备：' + (d.machineId || '').substring(0, 8) + '...'
                        });
                    }
                    changes.push('maxDevices ' + oldMax + '→' + newMax + '（自动解绑 ' + removed.length + ' 台多余设备）');
                } else {
                    changes.push('maxDevices ' + oldMax + '→' + newMax);
                }
                record.maxDevices = newMax;
                // 更新 devices 字段（可能已被 splice 修改）
                record.devices = devices;
                // 更新 machineId 字段（向后兼容，取剩余首台）
                record.machineId = devices.length > 0 ? devices[0].machineId : '';
                if (devices.length === 0 && record.status === 'used') {
                    record.status = 'unused';
                    record.activatedAt = null;
                    record.activatedIp = null;
                }
            }
        }

        // ===== 修改 clinicName =====
        if (clinicName !== undefined && clinicName !== null) {
            const newName = String(clinicName).trim();
            if (newName.includes('|')) {
                return json({ success: false, error: '诊所名不能包含 | 字符' }, 400);
            }
            if (newName.length > 100) {
                return json({ success: false, error: '诊所名长度不能超过 100' }, 400);
            }
            const oldName = record.clinicName || '';
            if (newName !== oldName) {
                changes.push('clinicName "' + oldName + '"→"' + newName + '"');
                record.clinicName = newName;
            }
        }

        // ===== 修改 user =====
        if (user !== undefined && user !== null) {
            const newUser = String(user).trim();
            if (newUser.length > 100) {
                return json({ success: false, error: '用户名长度不能超过 100' }, 400);
            }
            const oldUser = record.user || record.username || '';
            if (newUser !== oldUser) {
                changes.push('user "' + oldUser + '"→"' + newUser + '"');
                record.user = newUser;
            }
        }

        // ===== 修改 note =====
        if (note !== undefined && note !== null) {
            const newNote = String(note).trim();
            if (newNote.length > 200) {
                return json({ success: false, error: '备注长度不能超过 200' }, 400);
            }
            const oldNote = record.note || '';
            if (newNote !== oldNote) {
                changes.push('note "' + oldNote + '"→"' + newNote + '"');
                record.note = newNote;
            }
        }

        if (changes.length === 0) {
            return json({
                success: true,
                message: '无字段变化',
                changes: [],
                data: sanitizeRecord(record)
            });
        }

        record.updatedAt = new Date().toISOString();
        await saveLicense(kv, record);
        await appendLicenseLog(kv, code, {
            action: 'update',
            time: new Date().toISOString(),
            ip: ip,
            operator: currentUser.username,
            detail: '修改字段：' + changes.join('; ')
        });

        return json({
            success: true,
            message: '已更新 ' + changes.length + ' 个字段',
            changes: changes,
            data: sanitizeRecord(record)
        });

    } catch (error) {
        console.error('License update error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
