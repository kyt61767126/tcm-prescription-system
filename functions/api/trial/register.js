// ============================================================================
//  trial/register.js — 试用注册 API（防重复试用）
//
//  路由：POST /api/trial/register
//
//  无需登录认证（客户端首次启动未激活时调用），但有以下保护：
//    - 速率限制：每 IP 每小时 10 次
//    - 硬件指纹必填校验
//
//  请求体：
//    {
//      "hwFp": "sha256-hex",        // 硬件指纹（客户端计算，防卸载重装重置试用）
//      "machineId": "abc123def456",  // 机器 ID（辅助记录，不用于判重）
//      "productName": "惠康中医",     // 版本信息（可选）
//      "edition": "personal/pro",    // 版本类型（可选）
//      "appMode": "offline/cloud"    // 平台模式（可选）
//    }
//
//  返回：
//    {
//      "success": true,
//      "allowed": true/false,        // 是否允许试用
//      "trialCount": 2,              // 该硬件指纹已试用次数
//      "maxTrials": 1,               // 允许的最大试用次数
//      "trialDays": 7,               // 试用天数
//      "serverTime": "2026-01-01T00:00:00Z"
//    }
//
//  KV 数据结构：
//    key: trial_fp:{hwFp}
//    value: { hwFp, trialCount, firstTrialAt, lastTrialAt, activeTrialStart,
//             activeTrialExpiresAt, machineId, productName, edition, appMode }
//
//  防重复策略：
//    - 同一 hwFp 在有效试用期内重复调用 → 视为同一用户，不增加次数（幂等）
//    - 试用期已结束后的再次调用 → 视为新的试用尝试，次数 +1
//    - 次数 >= maxTrials → 拒绝
// ============================================================================

import { getKV, checkRateLimit } from '../license/_lib/license-core.js';

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

// ★ 试用次数阈值（可调）
// 2026-08-16：调整为 1 → 一个设备只有一次试用机会（防卸载重装刷试用）
const MAX_TRIALS = 1;
// ★ 试用天数（与客户端 LICENSE_TYPE_CONFIG.trial 一致）
const TRIAL_DAYS = 7;

function corsHeaders() {
    const origin = _currentRequest ? (_currentRequest.headers.get('Origin') || '') : '';
    const allowedOrigin = (origin && ALLOWED_ORIGINS.includes(origin)) ? origin : 'https://tcm-prescription-system.pages.dev';
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Request-ID',
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

// 硬件指纹格式校验（64 位 hex，即 SHA256）
function isValidHwFp(hwFp) {
    if (!hwFp || typeof hwFp !== 'string') return false;
    return /^[a-f0-9]{64}$/i.test(hwFp);
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

        // 速率限制：每 IP 每小时 10 次
        const ip = getClientIP(context);
        const rateOk = await checkRateLimit(kv, `trialreg_${ip}`, 10);
        if (!rateOk.allowed) {
            return json({ success: false, error: '请求过于频繁，请稍后再试' }, 429);
        }

        const body = await context.request.json().catch(() => ({}));
        const { hwFp, machineId, productName, edition, appMode } = body;

        // 参数校验
        if (!isValidHwFp(hwFp)) {
            return json({ success: false, error: '硬件指纹无效' }, 400);
        }

        const now = Date.now();
        const serverTime = new Date(now).toISOString();
        const KV_KEY = `trial_fp:${hwFp.toLowerCase()}`;

        // 读取已有记录
        let record = await kv.get(KV_KEY, 'json');

        if (!record) {
            // 全新指纹：首次试用，允许
            record = {
                hwFp: hwFp.toLowerCase(),
                trialCount: 1,
                firstTrialAt: serverTime,
                lastTrialAt: serverTime,
                activeTrialStart: serverTime,
                activeTrialExpiresAt: new Date(now + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
                machineId: machineId || '',
                productName: productName || '',
                edition: edition || '',
                appMode: appMode || ''
            };
            await kv.put(KV_KEY, JSON.stringify(record));
            return json({
                success: true, allowed: true,
                trialCount: 1, maxTrials: MAX_TRIALS, trialDays: TRIAL_DAYS,
                serverTime
            });
        }

        // 已有记录：检查是否在有效试用期内（幂等）
        const activeExpires = record.activeTrialExpiresAt ? new Date(record.activeTrialExpiresAt) : null;
        const inActiveTrial = activeExpires && now <= activeExpires.getTime();

        if (inActiveTrial) {
            // 有效试用期内重复调用 → 同一用户，不增加次数
            await kv.put(KV_KEY, JSON.stringify({ ...record, lastTrialAt: serverTime }));
            return json({
                success: true, allowed: true,
                trialCount: record.trialCount || 1, maxTrials: MAX_TRIALS, trialDays: TRIAL_DAYS,
                serverTime
            });
        }

        // 试用期已结束：新的试用尝试
        const trialCount = (record.trialCount || 0) + 1;
        if (trialCount > MAX_TRIALS) {
            return json({
                success: true, allowed: false,
                trialCount: record.trialCount || 0, maxTrials: MAX_TRIALS, trialDays: TRIAL_DAYS,
                message: `该设备试用次数已达上限（${MAX_TRIALS} 次），请激活正式版`,
                serverTime
            });
        }

        // 允许，更新记录
        const updated = {
            ...record,
            trialCount,
            lastTrialAt: serverTime,
            activeTrialStart: serverTime,
            activeTrialExpiresAt: new Date(now + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
            machineId: machineId || record.machineId || '',
            productName: productName || record.productName || '',
            edition: edition || record.edition || '',
            appMode: appMode || record.appMode || ''
        };
        await kv.put(KV_KEY, JSON.stringify(updated));

        return json({
            success: true, allowed: true,
            trialCount, maxTrials: MAX_TRIALS, trialDays: TRIAL_DAYS,
            serverTime
        });

    } catch (error) {
        console.error('[TrialRegister] error:', error);
        return json({ success: false, error: '服务器内部错误' }, 500);
    }
}