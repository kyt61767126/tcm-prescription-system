// ============================================================================
//  verify.js — 在线授权验证 API（P1-1 防盗版核心）
//
//  路由：POST /api/license/verify
//
//  用途：离线APP定期在线验证授权有效性，防止离线破解后永久使用
//  机制：
//    - 客户端每7天+30张处方提示验证
//    - 超过90天未验证降级为试用模式
//    - 本API确认设备在线状态并更新验证时间戳
//
//  请求体：
//    {
//      "machineId": "abc123def456",   // 机器ID
//      "codeHash": "sha256hex",       // 激活码SHA256哈希（追溯用 + 反查用）
//      "code": "BNZC-XXXX-...",       // 激活码（可选，优先用于直接查询）
//      "user": "张三",                // 用户名
//      "expiresAt": "2026-12-31...",  // 授权到期时间
//      "integrityState": 0            // ★ P1-1 客户端完整性状态（可选，仅审计）
//                                     //   0=双路一致通过 1=native不可用仅Java通过
//                                     //   2=native/Java分叉(疑似hook) 3=双路一致失败(真篡改)
//    }
//
//  返回（成功）：
//    { "success": true, "message": "验证成功", "verifyTime": 1234567890 }
//
//  返回（失败）：
//    { "success": false, "error": "错误原因" }
//
//  安全：
//    - 速率限制：每IP每分钟10次
//    - 验证日志记录到KV（追溯盗版泄露源）
//    - ★ P0 修复：真实查询 KV 验证 license 是否存在/有效（不再假验证）
// ============================================================================

import { getDevices, reportUsage } from './_lib/license-core.js';
import { getKV } from '../_lib/kv.js';

const VERIFY_RATE_LIMIT_PER_MIN = 10;

// ★ P1-1：客户端完整性状态语义表（与离线APP LicenseManager.java 常量对齐）
const INTEGRITY_LABELS = {
    0: 'ok',
    1: 'native_unavailable',
    2: 'inconsistent_suspect_hook',
    3: 'fail_tampered'
};

// ★ P1-1：完整性异常（state>=2，疑似 hook/篡改）按设备聚合落安全标记，便于人工审查盗版线索。
//   只审计不阻断（宁可漏检不可误报）：验证结果仍以 license 记录 + 设备绑定为准。
async function recordIntegrityAnomaly(kv, { machineId, codeHash, user, integrityState, ip, now }) {
    try {
        const key = `integrity_flag:${machineId || 'unknown'}`;
        const prev = await kv.get(key, 'json') || {};
        const entry = {
            machineId: machineId || '',
            user: user || '',
            codeHash: codeHash || '',
            state: integrityState,
            stateLabel: INTEGRITY_LABELS[integrityState] || 'unknown',
            count: (prev.count || 0) + 1,
            firstSeen: prev.firstSeen || new Date(now).toISOString(),
            lastSeen: new Date(now).toISOString(),
            lastIp: ip || ''
        };
        await kv.put(key, JSON.stringify(entry), { expirationTtl: 90 * 24 * 60 * 60 });
        console.warn('[verify] 完整性异常标记:', JSON.stringify(entry));
    } catch (e) {
        // 标记失败不影响验证主流程
        console.warn('[verify] integrity flag 记录失败:', e && e.message);
    }
}

// ★ P2 安全修复：收紧 CORS，仅允许合法 Origin（防止任意网站跨域调用 license API）
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

function corsHeaders(request) {
    const origin = request ? (request.headers.get('Origin') || '') : '';
    const allowedOrigin = (origin && ALLOWED_ORIGINS.includes(origin)) ? origin : 'https://tcm-prescription-system.pages.dev';
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json; charset=UTF-8'
    };
}

export async function onRequestPost({ request, env }) {
    try {
        // ★ P1-1 修复 + P2-B 统一：KV 绑定解析改用 _lib/kv.js 单一事实源
        //   （原 env.LICENSE_KV 未绑定导致 500，见 kv.js 头注释）
        const kv = getKV(env);
        if (!kv) {
            console.error('[verify] 无可用 KV 绑定（KV/TCM_PRESCRIPTION_KV/LICENSE_KV 均缺失）');
            return new Response(JSON.stringify({
                success: false,
                error: '服务暂不可用，请稍后再试'
            }), { status: 503, headers: corsHeaders(request) });
        }

        // 速率限制
        const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
        const rateLimitKey = `verify_rate:${clientIP}`;
        const rateLimitCount = parseInt(await kv.get(rateLimitKey) || '0', 10);
        if (rateLimitCount >= VERIFY_RATE_LIMIT_PER_MIN) {
            return new Response(JSON.stringify({
                success: false,
                error: '请求过于频繁，请稍后再试'
            }), { status: 429, headers: corsHeaders(request) });
        }
        // 更新速率限制计数（60秒过期）
        await kv.put(rateLimitKey, String(rateLimitCount + 1), { expirationTtl: 60 });

        // 解析请求体
        const body = await request.json();
        const { machineId, codeHash, code, user, expiresAt } = body;

        // ★ P1-1：解析客户端完整性状态（可选字段，非法值按未上报处理）
        const integrityState = (
            typeof body.integrityState === 'number' &&
            Number.isInteger(body.integrityState) &&
            body.integrityState >= 0 && body.integrityState <= 3
        ) ? body.integrityState : null;
        const integrityLabel = integrityState === null
            ? 'not_reported'
            : (INTEGRITY_LABELS[integrityState] || 'unknown');

        // 基本参数校验
        if (!machineId || typeof machineId !== 'string') {
            return new Response(JSON.stringify({
                success: false,
                error: '缺少 machineId 参数'
            }), { status: 400, headers: corsHeaders(request) });
        }

        const now = Date.now();
        const verifyTime = now;

        // ★ P1-1：完整性异常（疑似 hook/篡改）单独落设备级安全标记（只审计不阻断）
        if (integrityState !== null && integrityState >= 2) {
            await recordIntegrityAnomaly(kv, { machineId, codeHash, user, integrityState, ip: clientIP, now });
        }

        // ★ P0 修复：真实查询 KV 验证 license 是否存在/有效
        // 之前仅记录日志即返回 success，攻击者 hook verify 调用即可绕过90天降级
        let licenseRecord = null;
        let resolvedCode = code || null;

        // 方式1：直接用 code 查询（新客户端优先传 code）
        if (code && typeof code === 'string') {
            licenseRecord = await kv.get(`license:${code}`, 'json');
        }

        // 方式2：用 codeHash 反查 code（validate.js 激活时存储映射）
        if (!licenseRecord && codeHash && codeHash.length === 64) {
            resolvedCode = await kv.get(`codehash:${codeHash}`);
            if (resolvedCode) {
                licenseRecord = await kv.get(`license:${resolvedCode}`, 'json');
            }
        }

        // 向后兼容：旧激活码可能没有 codeHash 映射
        // 此时无法真实校验，返回 success 但记录警告日志（避免影响现有用户）
        if (!licenseRecord) {
            // 记录验证日志（追溯用）
            if (codeHash && codeHash.length === 64) {
                const logKey = `verify_log:${codeHash}`;
                const logData = {
                    machineId: machineId || '',
                    user: user || '',
                    verifyTime: verifyTime,
                    expiresAt: expiresAt || '',
                    ip: clientIP,
                    timestamp: new Date(now).toISOString(),
                    integrityState: integrityState,
                    integrityLabel: integrityLabel,
                    warning: 'license_not_found_in_kv'  // 标记无法真实校验
                };
                await kv.put(logKey, JSON.stringify(logData), { expirationTtl: 30 * 24 * 60 * 60 });
            }

            // 向后兼容：返回 success（旧激活码无映射时不阻断）
            return new Response(JSON.stringify({
                success: true,
                message: '在线验证成功（兼容模式）',
                verifyTime: verifyTime
            }), { status: 200, headers: corsHeaders(request) });
        }

        // ★ 真实校验：license 状态检查
        if (licenseRecord.status === 'disabled') {
            return new Response(JSON.stringify({
                success: false,
                error: '授权已被禁用，请联系客服'
            }), { status: 403, headers: corsHeaders(request) });
        }
        if (licenseRecord.status === 'expired') {
            return new Response(JSON.stringify({
                success: false,
                error: '授权已过期'
            }), { status: 403, headers: corsHeaders(request) });
        }

        // ★ 真实校验：设备绑定检查（machineId 必须在 devices 数组中）
        const devices = getDevices(licenseRecord);
        const deviceMatch = devices.find(d => d.machineId === machineId);
        if (!deviceMatch) {
            // 设备未授权，记录安全日志
            if (codeHash && codeHash.length === 64) {
                const logKey = `verify_log:${codeHash}`;
                const logData = {
                    machineId: machineId || '',
                    user: user || '',
                    verifyTime: verifyTime,
                    expiresAt: expiresAt || '',
                    ip: clientIP,
                    timestamp: new Date(now).toISOString(),
                    integrityState: integrityState,
                    integrityLabel: integrityLabel,
                    security: 'device_mismatch'  // 标记设备不匹配（潜在盗版）
                };
                await kv.put(logKey, JSON.stringify(logData), { expirationTtl: 30 * 24 * 60 * 60 });
            }
            return new Response(JSON.stringify({
                success: false,
                error: '设备未授权，请使用已激活的设备'
            }), { status: 403, headers: corsHeaders(request) });
        }

        // ★ 记录验证日志到KV（追溯盗版泄露源）
        if (codeHash && codeHash.length === 64) {
            const logKey = `verify_log:${codeHash}`;
            const logData = {
                machineId: machineId || '',
                user: user || '',
                verifyTime: verifyTime,
                expiresAt: expiresAt || '',
                ip: clientIP,
                timestamp: new Date(now).toISOString(),
                integrityState: integrityState,
                integrityLabel: integrityLabel,
                verifiedCode: resolvedCode ? resolvedCode.substring(0, 12) + '...' : 'unknown'  // 记录已验证的激活码前缀
            };
            // 保留最近30天的验证日志
            await kv.put(logKey, JSON.stringify(logData), { expirationTtl: 30 * 24 * 60 * 60 });
        }

        // ★ P2-3 计数上链对账：在线验证时核对本地处方计数与云端高水位
        //   本地计数 < 云端高水位 → 疑似本地清零/篡改（reportUsage 内落 count_rollback 审计日志）
        //   字段可选（旧客户端不带 → 不对账，宁可漏检不可误报）
        let usageInfo = null;
        if (body.rxCount !== undefined && body.rxCount !== null && resolvedCode) {
            try {
                usageInfo = await reportUsage(kv, resolvedCode, {
                    rxCount: body.rxCount,
                    rxMonth: body.rxMonth,
                    machineId: machineId,
                    ip: clientIP,
                    source: 'verify'
                });
            } catch (e) { console.warn('[verify] 计数对账失败:', e.message); }
        }

        // 返回验证成功（已通过真实校验）
        return new Response(JSON.stringify({
            success: true,
            message: '在线验证成功，授权有效',
            verifyTime: verifyTime,
            usage: usageInfo ? { month: usageInfo.month, cloudCount: usageInfo.high } : undefined
        }), { status: 200, headers: corsHeaders(request) });

    } catch (e) {
        // P2 修复：错误详情仅记服务端日志，不向客户端泄露内部实现
        console.error('[verify] 服务器错误:', e && e.message, e);
        return new Response(JSON.stringify({
            success: false,
            error: '服务器内部错误，请稍后再试'
        }), { status: 500, headers: corsHeaders(request) });
    }
}

export async function onRequestOptions({ request }) {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
}
