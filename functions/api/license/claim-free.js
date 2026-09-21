// ============================================================================
//  claim-free.js — 离线免费版授权领取端点（2026-09-21）
//
//  路由：POST /api/license/claim-free
//
//  定位：与 /api/license/claim（付费激活码认领）平行的免费授权发放入口。
//    同一个安装包、激活窗【免费使用】按钮调用；服务端用现有签名私钥签发
//    type=free 的正式 license（客户端必须走验签正式 license，否则会被
//    "无 license 强制 personal/功能墙失效"铁律击穿——见 KNOWLEDGE 授权章）。
//
//  权益（与 shared/license/license-manager.js LICENSE_TYPE_CONFIG.free 一致）：
//    maxPrescriptions=0（开方不限量）、features=[]（备份/数据导出/拍照录像/
//    无水印打印全部为付费功能位）、expiresAt=2099-12-31（永久，复用到期
//    判定，无 perpetual 字段）。
//
//  风控：
//    ① machineId 进门过 schema-guard 白名单（与 claim 同款）
//    ② 每机一份 KV 记录 free:device:{machineId}，可重领（重装/丢码自愈，
//       身份首次领取时锁定，重领不变），不写付费激活码索引/不消耗库存
//    ③ IP 频控 20 次/小时
//    ④ 手机号选填（留资找回/营销用，不填凭 machineId 也可领）
//
//  请求：{ machineId: string, phone?: string, productClass?: string, clientClass?: string }
//  响应：与 validate/claim 成功同构 { success, license(base64), licenseInfo }
// ============================================================================

import {
    getKV, buildLicenseData, encodeLicenseBase64, checkRateLimit
} from './_lib/license-core.js';
import { isValidMachineId } from './_lib/schema-guard.js';

// 免费授权永久有效期（客户端到期判定 now > expiresAt，2099 年足够"永久"）
const FREE_LICENSE_EXPIRES_AT = '2099-12-31T23:59:59.999Z';
// 免费授权共用的 serial 序列（KV: license_serial:FREE，单调递增仅供审计）
const FREE_SERIAL_CODE = 'FREE';
// KV 每机一份记录前缀
const KV_FREE_DEVICE_PREFIX = 'free:device:';
// 免费版默认用户名（未留手机号时写入 license.user，仅显示用途）
const FREE_DEFAULT_USER = '免费用户';

// 与 validate.js / claim.js 同款 CORS（主进程 fetch 不依赖，留作兼容）
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

function corsHeaders() {
    const origin = _currentRequest ? (_currentRequest.headers.get('Origin') || '') : '';
    const allowedOrigin = (origin && ALLOWED_ORIGINS.includes(origin)) ? origin : 'https://tcm-prescription-system.pages.dev';
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
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
    _currentRequest = context.request;

    if (context.request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (context.request.method !== 'POST') {
        return json({ success: false, error: 'Method not allowed' }, 405);
    }

    try {
        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        // ② IP 频控（每小时 20 次，远宽于正常"一次领取+偶尔重领"）
        const ip = getClientIP(context);
        const rateOk = await checkRateLimit(kv, `free_claim_${ip}`, 20);
        if (!rateOk.allowed) {
            return json({ success: false, error: '请求过于频繁，请稍后再试' }, 429);
        }

        const body = await context.request.json().catch(() => ({}));
        const machineId = String(body.machineId || '').trim();
        let phone = String(body.phone || '').trim();

        // ① machineId 必填 + schema-guard 白名单（与 claim 同款门口）
        if (!machineId) {
            return json({ success: false, error: '缺少机器标识，请重启软件后重试' }, 400);
        }
        if (!isValidMachineId(machineId)) {
            return json({ success: false, error: '机器标识格式错误，请重启软件后重试' }, 400);
        }
        // 手机号选填；填了必须是 11 位大陆手机号
        if (phone && !/^1[3-9]\d{9}$/.test(phone)) {
            return json({ success: false, error: '联系电话格式不正确（11 位手机号），或清空后直接领取' }, 400);
        }

        // ③ 每机一份：首次领取建记录，重领沿用首次身份（幂等、可丢码自愈）
        const recordKey = KV_FREE_DEVICE_PREFIX + machineId;
        let devRecord = null;
        try {
            devRecord = await kv.get(recordKey, 'json');
        } catch (e) {
            console.warn('[claim-free] 设备记录读取失败（按首次领取处理）:', e && e.message);
        }

        const nowIso = new Date().toISOString();
        if (devRecord && devRecord.machineId === machineId) {
            // 重领：身份以首次为准（忽略本次传入的不同手机号），计数+1
            phone = devRecord.phone || '';
            devRecord.lastClaimedAt = nowIso;
            devRecord.claimCount = (devRecord.claimCount || 1) + 1;
        } else {
            devRecord = {
                machineId,
                phone: phone || '',
                user: phone || FREE_DEFAULT_USER,
                productClass: String(body.productClass || 'offline'),
                clientClass: String(body.clientClass || 'desktop'),
                firstClaimedAt: nowIso,
                lastClaimedAt: nowIso,
                claimCount: 1
            };
        }
        try {
            await kv.put(recordKey, JSON.stringify(devRecord));
        } catch (e) {
            // 记录写入失败不阻断签发（领取是主路径，审计是次要路径）
            console.warn('[claim-free] 设备记录写入失败（不阻断领取）:', e && e.message);
        }

        // ④ 签发 type=free 正式 license（v7/v6/v5 签名 + masterKey 由 buildLicenseData
        //    依 options.context 自动附加；expiresAt=2099 晚于 anchor+365 保底逻辑，
        //    buildLicenseData 会取 record.expiresAt；features=[]、max=0 显式传入）
        const licenseData = await buildLicenseData(
            {
                code: FREE_SERIAL_CODE,
                type: 'free',
                user: devRecord.user,
                phone: phone || '',
                maxPrescriptions: 0,
                features: [],
                expiresAt: FREE_LICENSE_EXPIRES_AT
            },
            { context: context, kv: kv, machineId: machineId }
        );

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
        console.error('[claim-free] error:', error);
        return json({ success: false, error: '服务器繁忙，请稍后再试' }, 500);
    }
}
