// ============================================================================
//  extend.js — 批量延期激活码 API（管理员专用）
//
//  路由：POST /api/license/extend
//
//  用途：批量延期激活码（统一延长到期时间）
//
//  认证：Bearer token（platform_admin）
//
//  请求体：
//    {
//      "codes": ["BNZC-XXXX-...", "BNZC-YYYY-..."],  // 激活码数组（必填，最多 100 个）
//      "addDays": 30,                                  // 延长天数（与 newExpiresAt 二选一）
//      "newExpiresAt": "2027-12-31"                    // 或新的到期日期 YYYY-MM-DD
//    }
//
//  返回：
//    {
//      "success": true,
//      "updated": [{ code, oldExpiresAt, newExpiresAt }, ...],
//      "failed": [{ code, error }, ...],
//      "count": 2
//    }
//
//  注意：只更新 record.expiresAt，不重新签发 license（用户重新激活时才会用新 expiresAt）
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from '../_lib/auth.js';
import {
    getKV, getLicense, updateLicense, appendLicenseLog
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

function getClientIP(context) {
    return context.request.headers.get('CF-Connecting-IP') ||
           context.request.headers.get('X-Forwarded-For') ||
           context.request.headers.get('X-Real-IP') ||
           'unknown';
}

// 激活码格式校验：BNZC-XXXX-XXXX-XXXX-XXXX
const CODE_REGEX = /^BNZC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

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
            return json({ success: false, error: '仅平台总管理员可批量延期激活码' }, 403);
        }

        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        const ip = getClientIP(context);
        const body = await context.request.json().catch(() => ({}));
        const { codes, addDays, newExpiresAt } = body;

        // 参数校验
        if (!Array.isArray(codes) || codes.length === 0) {
            return json({ success: false, error: '请提供 codes 数组（非空）' }, 400);
        }
        if (codes.length > 100) {
            return json({ success: false, error: '一次最多批量延期 100 个激活码' }, 400);
        }
        if (!addDays && !newExpiresAt) {
            return json({ success: false, error: '请提供 addDays 或 newExpiresAt' }, 400);
        }
        if (addDays && newExpiresAt) {
            return json({ success: false, error: 'addDays 与 newExpiresAt 只能二选一' }, 400);
        }

        let parsedAddDays = null;
        if (addDays) {
            parsedAddDays = parseInt(addDays, 10);
            if (isNaN(parsedAddDays) || parsedAddDays <= 0 || parsedAddDays > 3650) {
                return json({ success: false, error: 'addDays 必须是 1-3650 之间的整数' }, 400);
            }
        }

        let targetExpiresAt = null;
        if (newExpiresAt) {
            const d = new Date(newExpiresAt + 'T23:59:59+08:00');
            if (isNaN(d.getTime())) {
                return json({ success: false, error: 'newExpiresAt 格式错误，应为 YYYY-MM-DD' }, 400);
            }
            targetExpiresAt = d.toISOString();
        }

        const updated = [];
        const failed = [];

        for (let i = 0; i < codes.length; i++) {
            const rawCode = codes[i];
            const code = typeof rawCode === 'string' ? rawCode.trim() : '';
            if (!CODE_REGEX.test(code)) {
                failed.push({ code: rawCode, error: '激活码格式错误' });
                continue;
            }
            try {
                const record = await getLicense(kv, code);
                if (!record) {
                    failed.push({ code: code, error: '激活码不存在' });
                    continue;
                }

                const oldExpiresAt = record.expiresAt || null;
                let newExp = null;

                if (targetExpiresAt) {
                    // 直接使用新的到期日期
                    newExp = targetExpiresAt;
                } else {
                    // 在原到期时间基础上加天数
                    // 若原到期时间已过期或不存在，则从当前时间开始算
                    const baseTime = oldExpiresAt ? new Date(oldExpiresAt).getTime() : Date.now();
                    const baseDate = new Date(baseTime);
                    if (baseDate.getTime() < Date.now()) {
                        newExp = new Date(Date.now() + parsedAddDays * 24 * 60 * 60 * 1000).toISOString();
                    } else {
                        newExp = new Date(baseTime + parsedAddDays * 24 * 60 * 60 * 1000).toISOString();
                    }
                }

                // 只更新 record.expiresAt，不重新签发 license
                await updateLicense(kv, code, { expiresAt: newExp });
                // 写入操作日志
                await appendLicenseLog(kv, code, {
                    action: 'extend',
                    time: new Date().toISOString(),
                    ip: ip,
                    operator: currentUser.username,
                    detail: `batch extend: oldExpiresAt=${oldExpiresAt || 'null'}, newExpiresAt=${newExp}, addDays=${parsedAddDays || 0}`
                });

                updated.push({
                    code: code,
                    oldExpiresAt: oldExpiresAt,
                    newExpiresAt: newExp
                });
            } catch (e) {
                failed.push({ code: code, error: e.message || '延期失败' });
            }
        }

        return json({
            success: true,
            updated: updated,
            failed: failed,
            count: updated.length
        });

    } catch (error) {
        console.error('License extend error:', error);
        return json({ success: false, error: error.message || 'Internal server error' }, 500);
    }
}
