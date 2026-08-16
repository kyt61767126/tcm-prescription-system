// ============================================================================
//  batch.js — 批量生成激活码 API（管理员专用）
//
//  路由：POST /api/license/batch
//
//  用途：批量生成激活码（支持 CSV 文本批量创建不同用户的激活码）
//
//  认证：Bearer token（platform_admin）
//
//  请求体：
//    {
//      "users": ["张三", "李四", "王五"],     // 用户名数组（必填，最多 100 个）
//      "type": "personal",                   // trial/personal/pro（必填）
//      "days": 365,                           // 有效天数（与 expiresAt 二选一）
//      "expiresAt": "2027-12-31",             // 到期日期 YYYY-MM-DD（与 days 二选一）
//      "note": "批量生成",                    // 备注（可选）
//      "clinicName": "本能堂中医诊所",         // 绑定诊所名（可选）
//      "maxDevices": 1                         // 最大设备数（可选，默认 1，最大 10）
//    }
//
//  返回：
//    {
//      "success": true,
//      "codes": [{ code, user, type, ... }, ...],
//      "count": 3,
//      "failed": [{ user, error }, ...],
//      "csv": "\uFEFFcode,user,type,expiresAt,clinicName\nBNZC-...,张三,..."
//    }
//
//  ★ CSV 带 BOM（\uFEFF），方便 Excel 直接打开不乱码
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from '../_lib/auth.js';
import {
    getKV, saveLicense, sanitizeRecord,
    generateActivationCode, appendLicenseLog
} from './_lib/license-core.js';

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

// CSV 字段转义（含逗号/引号/换行 → 用双引号包裹，内部双引号变两个）
function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const s = String(value);
    if (/[",\n\r]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

// 格式化到期日期为 YYYY-MM-DD（用于 CSV 展示）
function formatDate(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
    } catch (e) {
        return '';
    }
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
            return json({ success: false, error: '仅平台总管理员可批量生成激活码' }, 403);
        }

        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        const ip = getClientIP(context);
        const body = await context.request.json().catch(() => ({}));
        const { users, type, days, expiresAt, note, clinicName, maxDevices } = body;

        // 参数校验：users 必须是非空数组
        if (!Array.isArray(users) || users.length === 0) {
            return json({ success: false, error: '请提供 users 数组（非空）' }, 400);
        }
        if (users.length > 100) {
            return json({ success: false, error: '一次最多批量生成 100 个激活码' }, 400);
        }
        // 校验每个用户名长度 1-50
        const trimmedUsers = [];
        for (let i = 0; i < users.length; i++) {
            const u = typeof users[i] === 'string' ? users[i].trim() : '';
            if (u.length < 1 || u.length > 50) {
                return json({ success: false, error: '第 ' + (i + 1) + ' 个用户名长度必须在 1-50 之间' }, 400);
            }
            trimmedUsers.push(u);
        }

        // type 校验
        if (!type || !['trial', 'personal', 'pro'].includes(type)) {
            return json({ success: false, error: 'type 必须是 trial / personal / pro' }, 400);
        }
        // days 或 expiresAt 二选一
        if (!days && !expiresAt) {
            return json({ success: false, error: '请提供 days 或 expiresAt' }, 400);
        }
        // clinicName 校验
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
        // maxDevices 校验（默认 1，范围 1-10）
        let parsedMaxDevices = 1;
        if (maxDevices !== undefined && maxDevices !== null) {
            parsedMaxDevices = parseInt(maxDevices, 10);
            if (isNaN(parsedMaxDevices) || parsedMaxDevices < 1 || parsedMaxDevices > 10) {
                return json({ success: false, error: 'maxDevices 必须是 1-10 之间的整数' }, 400);
            }
        }

        // 计算到期时间（用于记录，非 license.issuedAt）
        let recordExpiresAt = null;
        if (expiresAt) {
            recordExpiresAt = new Date(expiresAt + 'T23:59:59+08:00').toISOString();
        }

        // 批量生成：每个用户生成一个独立激活码（独立 KV 记录 + 索引）
        const codes = [];
        const failed = [];
        for (let i = 0; i < trimmedUsers.length; i++) {
            const userName = trimmedUsers[i];
            try {
                const code = generateActivationCode();
                const record = {
                    code: code,
                    user: userName,
                    type: type,
                    days: days || null,
                    expiresAt: recordExpiresAt,
                    issuedAt: getNowISO(),
                    issuedBy: currentUser.username,
                    activatedAt: null,
                    machineId: null,
                    clinicName: clinicName || null,
                    maxDevices: parsedMaxDevices,
                    devices: [],
                    status: 'unused',
                    note: note || ''
                };
                await saveLicense(kv, record);
                // 写入操作日志
                await appendLicenseLog(kv, code, {
                    action: 'generate',
                    time: record.issuedAt,
                    ip: ip,
                    operator: currentUser.username,
                    detail: `batch: type=${type}, days=${days || 0}, expiresAt=${recordExpiresAt || 'null'}, clinicName=${clinicName || ''}, maxDevices=${parsedMaxDevices}`
                });
                codes.push(sanitizeRecord(record));
            } catch (e) {
                failed.push({ user: userName, error: e.message || '生成失败' });
            }
        }

        // 生成 CSV 文本（带 BOM），列：code, user, type, expiresAt, clinicName
        const csvHeader = 'code,user,type,expiresAt,clinicName';
        const csvLines = codes.map(c => {
            return [
                csvEscape(c.code),
                csvEscape(c.user),
                csvEscape(c.type),
                csvEscape(formatDate(c.expiresAt)),
                csvEscape(c.clinicName)
            ].join(',');
        });
        const csv = '\uFEFF' + csvHeader + '\n' + csvLines.join('\n');

        return json({
            success: true,
            codes: codes,
            count: codes.length,
            failed: failed,
            csv: csv
        });

    } catch (error) {
        console.error('License batch error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
