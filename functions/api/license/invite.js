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
    ensureInviteCode, findLicensesByMachine,
    INVITE_REWARD_DAYS_PER_PERSON, INVITE_MAX_INVITEES
} from './_lib/license-core.js';
import { isValidMachineId } from './_lib/schema-guard.js';

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

// ★ 2026-09-07 奖励到账自愈：凭手机号找属主云端诊所的 expiresAt。
//   匹配逻辑与 license-core.js extendClinicExpiryForReward 同构（clinic:{id}:users
//   里 username/phone 命中即属主），保证「发奖延长的诊所」与「查回的诊所」是同一家。
//   找不到（离线版 license / 无云端诊所）返回 null，客户端字段缺省不做刷新。
async function findClinicExpiresAtByPhone(kv, phone) {
    try {
        if (!kv || !phone) return null;
        const clinics = (await kv.get('system:clinics', 'json').catch(() => null)) || [];
        for (const clinic of clinics) {
            if (!clinic || !clinic.id || !clinic.expiresAt) continue;
            const users = (await kv.get('clinic:' + clinic.id + ':users', 'json').catch(() => null)) || [];
            if (users.some(u => u && (u.username === phone || u.phone === phone))) {
                return clinic.expiresAt || null;
            }
        }
    } catch (e) {
        console.warn('[invite] 云端诊所有效期查询失败（忽略）:', e && e.message);
    }
    return null;
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
        const midRaw = (body && body.machineId && typeof body.machineId === 'string') ? body.machineId.trim() : '';
        // 机器码只接受 schema-guard 白名单（防垃圾 mid 触发全扫；无效当作未提供）
        const mid = (midRaw && isValidMachineId(midRaw)) ? midRaw : '';
        let code = (body && body.code && typeof body.code === 'string') ? body.code.trim().toUpperCase() : '';
        let recoveredByMachine = false;

        // 本机 machineId → 权威激活码（device_version 优先；缺失/陈旧时用 mid_owners/索引 O(1) 反查，
        // ★ 2026-10-18：原实现逐条 getLicense 扫描 500 条 → 主进程 8s 超时 abort（"This operation was aborted"），
        //   改用 license-core.findLicensesByMachine（mid_owners 快路径 + 全扫批量并发回退））
        async function findMachineCode() {
            const binding = await getDeviceVersion(kv, mid).catch(() => null);
            let found = (binding && binding.licenseCode) ? String(binding.licenseCode).trim().toUpperCase() : '';
            if (!found) {
                let hits = [];
                try { hits = await findLicensesByMachine(kv, mid, { readOnly: true }); } catch (_) { hits = []; }
                let best = '', bestAt = -1;
                for (const rec of hits) {
                    if (!rec || !rec.code) continue;
                    const at = rec.activatedAt ? new Date(rec.activatedAt).getTime() : 0;
                    if (at >= bestAt) { bestAt = at; best = String(rec.code).trim().toUpperCase(); }
                }
                found = best;
            }
            return { code: found, binding };
        }

        let record = code ? await getLicense(kv, code) : null;

        // ★ 2026-10-18 修复（离线桌面实锤）：本地 license:code 在服务端不存在（残留旧码/记录被重置/换机错码）
        //   → 用 machineId 反查真实绑定码；找回后回填 device_version 并返回 resolvedLicenseCode，
        //   客户端据此自愈本地 license:code（不再显示"邀请码加载失败（激活码不存在）"）。
        if (!record && mid) {
            const got = await findMachineCode();
            if (got.code) {
                code = got.code;
                record = await getLicense(kv, code).catch(() => null);
                if (record) {
                    recoveredByMachine = true;
                    if (got.binding && !got.binding.licenseCode) {
                        try { await setDeviceVersion(kv, mid, got.binding.version || 'standard', { licenseCode: code }); } catch (_) { }
                    }
                }
            }
        }

        // 无码路径（管理员激活/旧版本激活，本地无激活码）
        if (!code && !record) {
            if (!mid) {
                return json(request, { success: false, error: '缺少激活码参数' }, 400);
            }
            const got = await findMachineCode();
            code = got.code;
            if (!code) {
                return json(request, { success: false, error: '本机未找到激活绑定记录' }, 404);
            }
            record = await getLicense(kv, code).catch(() => null);
            if (record && got.binding && !got.binding.licenseCode) {
                try { await setDeviceVersion(kv, mid, got.binding.version || 'standard', { licenseCode: code }); } catch (_) { }
            }
        }

        if (!record) {
            return json(request, {
                success: false,
                error: mid ? '本机授权记录未找到，请联系客服' : '激活码不存在'
            }, 404);
        }
        if (record.status === 'disabled') {
            return json(request, { success: false, error: '授权已被禁用' }, 403);
        }

        // 幂等补发邀请码（存量激活码首次查询时生成）
        const recordWithInvite = await ensureInviteCode(kv, record);

        const rewardLog = Array.isArray(recordWithInvite.inviteRewardLog) ? recordWithInvite.inviteRewardLog : [];
        return json(request, {
            success: true,
            // ★ 仅当本次由 machineId 反查找回真实码时返回，供客户端自愈本地 license:code（同机安全）
            resolvedLicenseCode: recoveredByMachine ? code : undefined,
            inviteCode: recordWithInvite.inviteCode,
            inviteCount: recordWithInvite.inviteCount || 0,
            maxInvitees: INVITE_MAX_INVITEES,
            rewardDays: recordWithInvite.rewardDays || 0,
            rewardDaysPerPerson: INVITE_REWARD_DAYS_PER_PERSON,
            // ★ 2026-09-07 奖励到账自愈：顺带返回云端诊所有效期（含已发放奖励的最新值，
            //   匹配逻辑与 extendClinicExpiryForReward 同构——clinic:{id}:users 里
            //   username/phone 命中即属主诊所）。客户端授权状态区的「剩余 X 天」读的是
            //   登录缓存 clinicExpiresAt（登录时快照），邀请人奖励到账后不重登录就
            //   看不到天数变化——凭此字段自动刷新缓存（离线版 license 无云端诊所则缺省）
            clinicExpiresAt: await findClinicExpiresAtByPhone(kv, recordWithInvite.phone),
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
