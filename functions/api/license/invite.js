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
//  ★ 2026-10-19 可选账号态（云端登录用户，基础设置「授权状态」显示激活码+邀请码）：
//    请求头 Authorization: Bearer <token>，或请求体 { "authToken": "<token>" }（云桌面
//    走主进程 IPC 代理时无法改 header，token 由客户端放 body）。服务端 verifyToken 后按
//    token 内 clinicId 取本所有效授权码；命中时返回 licenseCode（仅已登录本人可见）
//    并在无 code/machineId 时直接完成邀请码查询。匿名请求行为与此前完全一致。
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
    ensureInviteCode, findLicensesByMachine, getLicenseCodesByClinic, listLicenses,
    putLicenseClinicIndex,
    INVITE_REWARD_DAYS_PER_PERSON, INVITE_MAX_INVITEES
} from './_lib/license-core.js';
import { isValidMachineId } from './_lib/schema-guard.js';
import { verifyToken } from '../_lib/auth.js';

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
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Content-Type': 'application/json; charset=UTF-8'
    };
}

function json(request, data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders(request) });
}

// ============================================================================
// ★ 2026-10-19 账号态兜底辅助（B1/B3/B2 审查修复）
// ============================================================================

// 在册诊所名集合 + 归属判定：只返回「当前登录诊所」或「已不在册的旧名」的码；
// 属于其他在册诊所的码绝不返回（防一号多诊所/历史手机号串码，reviewer L5 实证）。
function registeredClinicNames(clinics) {
    const set = new Set();
    for (const c of (clinics || [])) {
        const n = c && typeof c.name === 'string' ? c.name.trim() : '';
        if (n) set.add(n);
    }
    return set;
}
function isOwnLicenseForClinic(rec, clinicName, registered) {
    if (!rec) return false;
    const cn = String(rec.clinicName || '').trim();
    if (!cn) return true;                       // 无诊所名（旧数据）不据此拦截
    if (clinicName && cn === clinicName) return true;
    return !registered.has(cn);                 // 改名前的旧名/未登记名 → 视为本人
}
// 可展示的授权码：排除停用/过期，以及同诊所「预生成未使用」的库存码
// （否则店铺有 unused 备货码时会把它当客户激活码展示——auditor 探针实测）。
function isDisplayableLicense(rec) {
    if (!rec) return false;
    if (rec.status === 'disabled' || rec.status === 'unused') return false;
    if (rec.expiresAt && new Date(rec.expiresAt).getTime() < Date.now()) return false;
    return true;
}

// 账号态结果缓存：③全扫是重操作（~340 get），命中/阴性都缓存，避免设置页反复全扫。
// 阳性 TTL 1h（每次取用前 getLicense 复验，过期/停用即失效重查）；阴性 TTL 10min。
const ACCT_GRANT_TTL = 3600;
const ACCT_GRANT_MISS_TTL = 600;
function acctCacheKey(clinicId) { return clinicId ? ('acct_grant:' + clinicId) : ''; }
function acctMissKey(clinicId) { return clinicId ? ('acct_grant_miss:' + clinicId) : ''; }

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

// ★ 2026-10-19 账号态解析（云端登录用户）：本地无激活码 / 机码不匹配时，按登录 token 的
//   clinicId 取该诊所有效授权码。用于基础设置「授权状态」显示激活码 + 邀请码
//   （客户电脑实锤：云端 1.2.269 授权区只显示已激活/剩余天数，不显示激活码/邀请码）。
//   安全：只认服务端验签 token 内的 clinicId，不接受客户端自报诊所名；返回码仅给已登录本所用户。
async function findAccountLicenseCode(kv, authUser) {
    try {
        if (!kv || !authUser) return '';
        const clinicId = authUser.clinicId || null;
        const acctKey = acctCacheKey(clinicId);
        const missKey = acctMissKey(clinicId);
        // 账号态结果缓存（阳性先 getLicense 复验；阴性避免反复全扫）——见 B2 审查
        if (acctKey) {
            try {
                const cached = await kv.get(acctKey, 'json');
                if (cached && cached.code) {
                    const lic = await getLicense(kv, cached.code).catch(() => null);
                    if (isDisplayableLicense(lic)) {
                        return String(cached.code).trim().toUpperCase();
                    }
                    try { await kv.delete(acctKey); } catch (_) { }
                }
            } catch (_) { }
        }
        if (missKey) {
            try { if (await kv.get(missKey)) return ''; } catch (_) { }
        }

        const clinics = (await kv.get('system:clinics', 'json').catch(() => null)) || [];
        const registered = registeredClinicNames(clinics);
        const clinic = clinicId ? (clinics || []).find(c => c && c.id === clinicId) || null : null;
        const clinicName = clinic && clinic.name ? String(clinic.name).trim() : '';

        // ① 诊所名 → license_clinic_index（缺失/未命中回退全扫；全扫有结果且索引存在时安全回填）
        if (clinicName) {
            let map = null;
            let codes = [];
            try {
                map = await getLicenseCodesByClinic(kv);
                if (map && map.get(clinicName)) codes = map.get(clinicName).slice();
            } catch (_) { }
            if (!codes.length) {
                try {
                    const all = await listLicenses(kv);
                    codes = (all || [])
                        .filter(r => r && r.code && String(r.clinicName || '').trim() === clinicName &&
                            isOwnLicenseForClinic(r, clinicName, registered))
                        .map(r => String(r.code).trim().toUpperCase());
                    // ★ B2：仅在索引本身可读（非 null）时合并回填，避免用单条覆盖全索引丢数据
                    if (codes.length && map) {
                        try { map.set(clinicName, codes); await putLicenseClinicIndex(kv, map); } catch (_) { }
                    }
                } catch (_) { codes = []; }
            }
            let best = '', bestAt = -Infinity;
            for (const c of codes) {
                const rec = await getLicense(kv, c).catch(() => null);
                if (!isDisplayableLicense(rec)) continue;
                if (!isOwnLicenseForClinic(rec, clinicName, registered)) continue;
                const at = rec.expiresAt ? new Date(rec.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
                if (at >= bestAt) { bestAt = at; best = String(rec.code || c).trim().toUpperCase(); }
            }
            if (best) {
                if (acctKey) { try { await kv.put(acctKey, JSON.stringify({ code: best, at: Date.now() }), { expirationTtl: ACCT_GRANT_TTL }); } catch (_) { } }
                return best;
            }
        }

        // ② 手机号/签名别名 → admin_phone 索引（生产值为 JSON {requestId,status}）→
        //    申请记录 licenseCode。校验手机号归属 + 状态 + 码的诊所归属，防串码（B1/B3）。
        const candidates = [authUser.username]
            .concat(Array.isArray(authUser.aliases) ? authUser.aliases : []);
        const phones = [];
        const seen = Object.create(null);
        for (const raw of candidates) {
            const ph = String(raw == null ? '' : raw).trim();
            if (!/^1[3-9]\d{9}$/.test(ph) || seen[ph]) continue;
            seen[ph] = 1;
            phones.push(ph);
            let recId = '';
            try {
                const idx = await kv.get('admin_phone:' + ph, 'json');
                recId = idx ? String((idx && (idx.requestId || idx.id)) || '').trim() : '';
                // 兼容极旧裸字符串值（防御性，不影响生产 JSON 主路径）
                if (!recId) {
                    const rawIdx = await kv.get('admin_phone:' + ph);
                    if (rawIdx && !/^[\{\[]/.test(rawIdx)) recId = String(rawIdx).trim();
                }
            } catch (_) { recId = ''; }
            if (!recId) continue;
            const req = await kv.get('admin_req:' + recId, 'json').catch(() => null);
            if (!req) continue;
            // 归属：申请记录手机号必须与本次凭据一致（旧记录无 phone 字段时放行）
            if (req.phone && String(req.phone).trim() !== ph) continue;
            const st = String(req.status || '');
            if (st && st !== 'activated' && st !== 'approved') continue;
            const code = req.licenseCode ? String(req.licenseCode).trim().toUpperCase() : '';
            if (!code) continue;
            const lic = await getLicense(kv, code).catch(() => null);
            if (!isDisplayableLicense(lic)) continue;
            if (!isOwnLicenseForClinic(lic, clinicName, registered)) continue;
            if (acctKey) { try { await kv.put(acctKey, JSON.stringify({ code, at: Date.now() }), { expirationTtl: ACCT_GRANT_TTL }); } catch (_) { } }
            return code;
        }

        // ③ 存量老客户兜底：旧记录可能无 admin_phone 索引 / clinicName 已改名，但 license
        //    记录带 phone。仅 ①② 未命中且 token 含手机号时全扫一次；命中/阴性均缓存，
        //    客户端下次优先带本地码请求，避免设置页反复全扫（B2）。
        if (phones.length) {
            try {
                const all = await listLicenses(kv);
                let pick = null, pickAt = -Infinity, pickScore = -1;
                for (const rec of (all || [])) {
                    if (!rec || !rec.code || !isDisplayableLicense(rec)) continue;
                    // ★ B3 归属校验：其他在册诊所的码绝不返回（改名前的旧名允许）
                    if (!isOwnLicenseForClinic(rec, clinicName, registered)) continue;
                    const rPhone = String(rec.phone || '').trim();
                    const rUser = String(rec.user || '');
                    const hit = phones.indexOf(rPhone) >= 0 ||
                        phones.some(ph => rUser.indexOf(ph) >= 0);
                    if (!hit) continue;
                    // 云桌面/云 APP 优先云端码（同手机号可能还有离线码）
                    const score = String(rec.productClass || '') === 'cloud' ? 1 : 0;
                    const at = rec.expiresAt ? new Date(rec.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
                    if (score > pickScore || (score === pickScore && at >= pickAt)) {
                        pickScore = score; pickAt = at; pick = rec;
                    }
                }
                if (pick) {
                    const code = String(pick.code).trim().toUpperCase();
                    if (acctKey) { try { await kv.put(acctKey, JSON.stringify({ code, at: Date.now() }), { expirationTtl: ACCT_GRANT_TTL }); } catch (_) { } }
                    return code;
                }
            } catch (_) { }
            if (missKey) { try { await kv.put(missKey, '1', { expirationTtl: ACCT_GRANT_MISS_TTL }); } catch (_) { } }
        }
        return '';
    } catch (_) { return ''; }
}

export async function onRequestPost({ request, env }) {
    try {
        const kv = getKV(env);
        if (!kv) {
            return json(request, { success: false, error: '服务暂不可用，请稍后再试' }, 503);
        }

        // 速率限制：每 IP 每小时 60 次（2026-10-18：20→60——邀请码卡会在打开授权区时查询，
        //   多设备/NAT 共用 IP + 客户重试容易触顶；端点读多写少，60/h 足够防滥用）
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const rateLimit = await checkRateLimit(kv, ip, 60);
        if (!rateLimit.allowed) {
            return json(request, { success: false, error: '请求过于频繁，请稍后再试' }, 429);
        }

        const body = await request.json().catch(() => ({}));
        // ★ 2026-10-19 账号态鉴权（可选）：Authorization Bearer（网页/APP 直连）或
        //   body.authToken（云桌面走主进程 IPC 代理，无法改 header 时由客户端放 body）。
        //   仅用于「授权状态」显示本人诊所的激活码/邀请码；匿名查询行为完全不变。
        let authUser = null;
        try {
            const authHeader = request.headers.get('Authorization') || '';
            let authToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';
            if (!authToken && body && typeof body.authToken === 'string') authToken = body.authToken.trim();
            if (authToken) authUser = await verifyToken(authToken, env);
        } catch (_) { authUser = null; }
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

        // ★ 2026-10-19 账号态兜底（云端登录用户）：本地无码/机码不匹配（管理员激活换机、
        //   重装、旧版设备等）时，按 token 的 clinicId 取本所有效授权码；命中即用于邀请码
        //   查询与「授权状态」激活码显示。匿名请求 authUser=null，此段零影响。
        let accountResolved = false;
        if (!record) {
            const accountCode = await findAccountLicenseCode(kv, authUser);
            if (accountCode && accountCode !== code) {
                const recByAccount = await getLicense(kv, accountCode).catch(() => null);
                if (recByAccount) {
                    code = accountCode;
                    record = recByAccount;
                    accountResolved = true;
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
            // ★ 2026-10-19 已登录本人：回传本所激活码，供「基础设置→授权状态」显示/复制；
            //   匿名请求（authUser=null）不返回，安全面不扩大。
            licenseCode: authUser ? String(recordWithInvite.code || code || '').trim().toUpperCase() : undefined,
            resolvedByAccount: accountResolved || undefined,
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
