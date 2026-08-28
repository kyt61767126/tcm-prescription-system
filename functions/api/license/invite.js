// ============================================================================
//  invite.js — 推广奖励：邀请进度查询 API
//
//  路由：POST /api/license/invite
//
//  用途：已激活用户查询自己的专属邀请码、邀请进度、累计奖励天数
//        （客户端激活成功页 / 授权状态区展示）
//
//  请求体（二选一）：
//    {
//      "code": "BNZC-XXXX-XXXX-XXXX-XXXX"   // 激活码（激活后客户端本地持有）
//    }
//    {
//      "machineId": "abc123..."              // ★ 兜底：管理员激活/旧版本激活本地无码，
//    }                                        //   凭本机 machineId 查 device_version 绑定
//                                            //   记录找回 licenseCode（不泄露码本身，
//                                            //   返回体不含 code 字段）
//
//  返回（成功）：
//    {
//      "success": true,
//      "inviteCode": "7K3F9Q",              // 专属邀请码（发给好友激活时填）
//      "inviteCount": 2,                     // 已成功邀请人数
//      "maxInvitees": 4,                     // 封顶 4 人
//      "rewardDays": 180,                    // 累计奖励天数（每人+90）
//      "nextRewardDays": 90,                 // 下次邀请成功奖励天数
//      "history": [                          // 邀请记录（machineId 脱敏）
//        { "time": "...", "rewardDays": 90, "machineId": "abc12345..." }
//      ]
//    }
//
//  安全：
//    - 速率限制：每 IP 每分钟 10 次
//    - 仅凭激活码查询（激活码本身即凭证，不泄露签名密钥）
// ============================================================================

import {
    getKV, getLicense, checkRateLimit, getDeviceVersion,
    ensureInviteCode,
    INVITE_REWARD_DAYS_PER_PERSON, INVITE_MAX_INVITEES
} from './_lib/license-core.js';

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

function json(request, data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders(request) });
}

export async function onRequestPost({ request, env }) {
    try {
        const kv = getKV(env);
        if (!kv) {
            return json(request, { success: false, error: '服务暂不可用，请稍后再试' }, 503);
        }

        // 速率限制：每 IP 每小时 20 次（与 validate 一致）
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const rateLimit = await checkRateLimit(kv, ip, 20);
        if (!rateLimit.allowed) {
            return json(request, { success: false, error: '请求过于频繁，请稍后再试' }, 429);
        }

        const body = await request.json().catch(() => ({}));
        let code = (body && body.code && typeof body.code === 'string') ? body.code.trim().toUpperCase() : '';

        // ★ 兜底：无本地激活码（管理员激活/旧版本激活），凭 machineId 找回绑定记录的 licenseCode。
        //   安全边界：machineId 为设备指纹（激活/心跳时上报），device_version 记录仅本机绑定时才存在；
        //   返回体不含 code 字段，不泄露激活码本身。
        if (!code) {
            const mid = (body && body.machineId && typeof body.machineId === 'string') ? body.machineId.trim() : '';
            if (!mid) {
                return json(request, { success: false, error: '缺少激活码参数' }, 400);
            }
            const binding = await getDeviceVersion(kv, mid);
            code = (binding && binding.licenseCode) ? String(binding.licenseCode).trim().toUpperCase() : '';
            if (!code) {
                return json(request, { success: false, error: '本机未找到激活绑定记录' }, 404);
            }
        }

        const record = await getLicense(kv, code);
        if (!record) {
            return json(request, { success: false, error: '激活码不存在' }, 404);
        }
        if (record.status === 'disabled') {
            return json(request, { success: false, error: '授权已被禁用' }, 403);
        }

        // 幂等补发邀请码（存量激活码首次查询时生成）
        const recordWithInvite = await ensureInviteCode(kv, record);

        const rewardLog = Array.isArray(recordWithInvite.inviteRewardLog) ? recordWithInvite.inviteRewardLog : [];
        return json(request, {
            success: true,
            inviteCode: recordWithInvite.inviteCode,
            inviteCount: recordWithInvite.inviteCount || 0,
            maxInvitees: INVITE_MAX_INVITEES,
            rewardDays: recordWithInvite.rewardDays || 0,
            rewardDaysPerPerson: INVITE_REWARD_DAYS_PER_PERSON,
            history: rewardLog.map(e => ({
                time: e.time || '',
                rewardDays: e.rewardDays || INVITE_REWARD_DAYS_PER_PERSON,
                machineId: (e.machineId || '').substring(0, 8) + '...',
                phone: e.phone ? (String(e.phone).replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2')) : ''
            }))
        });

    } catch (e) {
        console.error('[invite] 服务器错误:', e && e.message, e);
        return json(request, { success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}

export async function onRequestOptions({ request }) {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
}
