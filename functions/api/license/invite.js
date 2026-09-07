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
    getKV, getLicense, checkRateLimit, getDeviceVersion, setDeviceVersion,
    ensureInviteCode, KV_LICENSE_INDEX,
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

            // ★ 2026-09-07 fallback 遍历：device_version 无 licenseCode 的两类机器——
            //   ① 测试机（setDeviceVersion 对白名单机器 early return 刻意不落盘绑定，
            //     实证：桌面测试机 06eded70 机构版激活后 KV 无 device_version 键，但
            //     license: 记录 devices[0].machineId 已写入）；
            //   ② 旧绑定记录缺 licenseCode 字段。
            //   → 遍历 license 索引按 devices[].machineId 找回本机激活码（status.js
            //     heartbeat 同模式），多条命中取 activatedAt 最新（测试机反复换码场景）。
            if (!code) {
                const index = (await kv.get(KV_LICENSE_INDEX, 'json')) || [];
                const scanLimit = Math.min(Array.isArray(index) ? index.length : 0, 500);
                let best = '', bestAt = -1;
                for (let i = 0; i < scanLimit; i++) {
                    const c = index[i];
                    if (!c) continue;
                    let rec = null;
                    try { rec = await getLicense(kv, c); } catch (_) { }
                    if (!rec) continue;
                    const devices = Array.isArray(rec.devices) ? rec.devices : [];
                    if (devices.some(d => d && d.machineId === mid)) {
                        const at = rec.activatedAt ? new Date(rec.activatedAt).getTime() : 0;
                        if (at >= bestAt) { bestAt = at; best = String(c).trim().toUpperCase(); }
                    }
                }
                if (best) {
                    code = best;
                    // 自愈回填：仅"绑定存在但缺 licenseCode"时回填（version 取原值防误改）。
                    // 绑定不存在（测试机）不回填——避免为测试机新建 standard 版本绑定，
                    // 干扰"一设备一版本"校验语义。
                    if (binding && !binding.licenseCode) {
                        try {
                            await setDeviceVersion(kv, mid, binding.version || 'standard', { licenseCode: best });
                        } catch (_) { }
                    }
                }
            }

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
