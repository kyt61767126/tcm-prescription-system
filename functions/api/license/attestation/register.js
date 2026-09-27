// ============================================================================
//  register.js — P3-B 设备证明注册端点
//
//  路由：POST /api/license/attestation/register
//  限流：每 IP 每小时 20 次
//
//  action：
//    ① challenge {action:'challenge', mid}
//       → KV att_ch:{mid}={challenge,exp}（10min），返 {challenge}
//    ② register  {action:'register', mid, certChain:[b64...], resetAuth?, apiLevel?}
//       → 验链到 Google 根 + TEE/StrongBox + challenge + 包名 + 发布指纹 +
//         boot（soft-fail 可配）；登记 device_att:{mid}：
//           无记录=首次登记；公钥同=幂等；公钥变=重置裁决（见下）。
//
//  重置裁决（公钥变更 = pm clear 后新密钥）：
//    · 免费 free（且无付费码）  → 放行轮换（rotationCount+1）
//    · 付费码 + resetAuth 有效   → 放行轮换（verifyToken + 设备归属一致）
//        resetAuth = POST /api/users?login=true 的 sessionToken；
//        归属 = 激活码 user 为该登录用户，或登录用户所在诊所与该码 clinicName 一致。
//    · trial / 无凭证 / resetAuth 缺失或不符 → device_reset_denied
//
//  ★ 铁律：业务裁决一律 HTTP 200 + {allowed:false, reason}，绝不返 403
//    （403=边缘 WAF/封锁，客户端映射为可重试网络错误）。
// ============================================================================

import {
    getKV, checkRateLimit, findLicensesByMachine
} from '../_lib/license-core.js';
import { isValidMachineId } from '../_lib/schema-guard.js';
import { verifyToken, KV_SYSTEM_CLINICS } from '../../_lib/auth.js';
import {
    getAttestationConfig,
    randomChallengeB64,
    attChallengeKey,
    deviceAttKey,
    CHALLENGE_TTL_SEC,
    TRUSTED_GOOGLE_ROOT_FINGERPRINTS,
    verifyAndParseRegistration
} from '../_lib/attestation-core.js';

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
    // file:// 渲染端兜底 Origin 恒为 "null"，与 entitlement 同口径放行
    let allowedOrigin;
    if (origin === 'null') allowedOrigin = 'null';
    else allowedOrigin = (origin && ALLOWED_ORIGINS.includes(origin))
        ? origin : 'https://tcm-prescription-system.pages.dev';
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Vary': 'Origin',
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

/** 是否付费档（free/trial 之外）。 */
function isPaidType(type) {
    return !!type && type !== 'free' && type !== 'trial';
}

/**
 * 付费记录是否当前有效（可参与重置归属阻断）：
 * status 非 revoked/disabled/expired，且 expiresAt/licExp 未过期。
 * 与 entitlement.adjudicate 的撤销/过期裁决同口径。
 */
function isPaidRecordActive(rec, nowMs) {
    const st = String((rec && rec.status) || '').toLowerCase();
    if (st === 'revoked' || st === 'disabled' || st === 'expired') return false;
    const expRaw = rec && (rec.expiresAt || rec.licExp);
    if (expRaw) {
        const t = typeof expRaw === 'number' ? expRaw : Date.parse(expRaw);
        if (Number.isFinite(t) && t < nowMs) return false;
    }
    return true;
}

/**
 * 紧急根迁移开关：env ATTEST_EXTRA_TRUSTED_ROOTS 配置【追加】信任根指纹
 * （逗号/空白分隔的 64 位小写 hex SHA-256）。
 * 用途：Google 新增 attestation 根而内建锚尚未随代码部署时，零代码追加信任；
 * 只追加不替换，内建 4 根永远在集合内，配错也无法缩窄/架空既有信任。
 * 非法条目（非 64 hex）整条忽略并告警，绝不抛错阻断注册。
 */
function buildExtraChainOpts(env) {
    const raw = env && env.ATTEST_EXTRA_TRUSTED_ROOTS;
    if (!raw || typeof raw !== 'string') return null;
    const extras = raw.split(/[\s,;]+/)
        .map(s => s.trim().toLowerCase())
        .filter(s => /^[0-9a-f]{64}$/.test(s));
    if (!extras.length) return null;
    const trustedRoots = Array.from(
        new Set(TRUSTED_GOOGLE_ROOT_FINGERPRINTS.concat(extras)));
    console.warn('[attestation-register] ATTEST_EXTRA_TRUSTED_ROOTS 生效，'
        + '追加根:', extras.join(','));
    return { trustedRoots };
}

// ============================================================================
//  action ① challenge
// ============================================================================
async function handleChallenge(kv, mid) {
    const challenge = randomChallengeB64();
    const expSec = Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SEC;
    await kv.put(attChallengeKey(mid), JSON.stringify({ challenge, exp: expSec }),
        { expirationTtl: CHALLENGE_TTL_SEC });
    return json({
        success: true,
        challenge,
        serverTime: new Date().toISOString()
    });
}

// ============================================================================
//  action ② register
// ============================================================================
async function handleRegister(context, kv, body, mid, config) {
    const certChain = Array.isArray(body.certChain) ? body.certChain : null;
    if (!certChain || certChain.length === 0) {
        return json({ success: false, allowed: false,
                      reason: 'missing_cert_chain' });
    }

    // 读取本次注册应匹配的 challenge（必须存在且未过期）
    const chRec = await kv.get(attChallengeKey(mid), 'json').catch(() => null);
    if (!chRec || !chRec.challenge
        || (chRec.exp && chRec.exp < Math.floor(Date.now() / 1000))) {
        return json({ success: false, allowed: false,
                      reason: 'challenge_expired',
                      code: 'CHALLENGE_REQUIRED' });
    }

    // ① 链 + 扩展 + challenge + app/boot 全量验证
    //   紧急根迁移开关（env 追加信任锚；默认 null 用内建 4 根）
    const chainOpts = buildExtraChainOpts(context.env);
    const verified = await verifyAndParseRegistration({
        kv, mid,
        certChainB64: certChain,
        expectedChallengeB64: chRec.challenge,
        config,
        chainOpts
    });
    if (!verified.ok) {
        return json({ success: false, allowed: false,
                      reason: verified.reason });
    }
    const info = verified.info;

    // ② 查既有登记
    const existing = await kv.get(deviceAttKey(mid), 'json').catch(() => null);

    let registered;
    if (!existing || !existing.pub) {
        // ③ 首次登记
        registered = 'first';
        const record = buildRecord(info, body, {
            pub: info.spkiB64, kid: info.kid, rotationCount: 0, history: []
        });
        await kv.put(deviceAttKey(mid), JSON.stringify(record));
    } else if (existing.pub === info.spkiB64) {
        // ④ 公钥相同：幂等成功（不写 KV，天然重试安全）
        registered = 'idempotent';
    } else {
        // ⑤ 公钥变更：重置裁决
        return adjudicateReset(context, kv, body, mid, config, existing, info);
    }

    // 成功后删除 challenge（防窗口内重复使用；删除失败无害，TTL 自到期）
    await kv.delete(attChallengeKey(mid)).catch(() => {});

    return json({
        success: true,
        allowed: true,
        registered,
        bootWarn: verified.bootWarn || null,
        kid: info.kid,
        secLevel: info.secLevel,
        serverTime: new Date().toISOString()
    });
}

/** 组装登记记录。 */
function buildRecord(info, body, extra = {}) {
    const apiLevel = Number(body.apiLevel);
    return {
        v: 1,
        pub: info.spkiB64,
        kid: info.kid,
        secLevel: info.secLevel,
        boot: info.boot,
        osVersion: info.osVersion,
        osPatch: info.osPatch,
        apiLevel: Number.isFinite(apiLevel) && apiLevel > 0 ? apiLevel : null,
        registeredAt: extra.registeredAt || new Date().toISOString(),
        rotationCount: extra.rotationCount || 0,
        history: extra.history || []
    };
}

// ============================================================================
//  重置裁决（公钥变更）
// ============================================================================
async function adjudicateReset(context, kv, body, mid, config, existing, info) {
    void config;
    const resetAuth = typeof body.resetAuth === 'string' ? body.resetAuth : '';

    // 该设备当前名下授权码（始终取最新，不用快照）。
    // forceScan：跨码残留（detach best-effort 失败的真实状态）时索引快路径只返
    // 单码，会令重置裁决取决于索引恰好指向哪条——全扫保证穷尽；只读不修复。
    const hits = await findLicensesByMachine(kv, mid,
        { forceScan: true, readOnly: true }).catch(() => []);
    const nowMs = Date.now();
    const paidRec = hits.find(r => isPaidType(r.type)
        && isPaidRecordActive(r, nowMs));
    const hasFree = hits.some(r => r.type === 'free');

    // ① 免费（且无付费码）→ 放行轮换
    if (!paidRec && hasFree) {
        return finalizeRotation(kv, mid, body, existing, info, 'free');
    }

    // ② 付费码 → 必须 resetAuth 有效 + 设备归属一致
    if (paidRec) {
        let owned = false;
        try {
            const tok = resetAuth ? await verifyToken(resetAuth, context.env) : null;
            if (tok) {
                const ownerName = paidRec.user || paidRec.username || '';
                if (ownerName && ownerName === tok.username) {
                    owned = true;
                } else {
                    // 用登录用户 clinicId 反查诊所名，与激活码诊所名比对
                    const codeClinicName = paidRec.clinicName
                        || paidRec.activatedClinicName || '';
                    try {
                        const clinics = await kv.get(KV_SYSTEM_CLINICS, 'json')
                            .catch(() => null);
                        const clinic = Array.isArray(clinics)
                            ? clinics.find(c => c && c.id === tok.clinicId) : null;
                        if (clinic && clinic.name
                            && codeClinicName === clinic.name) {
                            owned = true;
                        }
                    } catch (_) { /* 归属按不匹配处理 */ }
                }
            }
        } catch (e) {
            console.warn('[attestation-register] resetAuth 校验异常（按拒绝）:',
                e && e.message);
        }

        if (owned) {
            return finalizeRotation(kv, mid, body, existing, info, 'paid');
        }
        return json({
            success: true,
            allowed: false,
            reason: 'device_reset_denied',
            code: 'RESET_AUTH_REQUIRED',
            message: '设备密钥已重置，请登录该设备已绑定的账号完成恢复，或联系客服处理'
        });
    }

    // ③ trial / 无任何凭证（走到这里必为 !paidRec && !hasFree）→ 拒绝
    const hasTrial = hits.some(r => r.type === 'trial');
    return json({
        success: true,
        allowed: false,
        reason: 'device_reset_denied',
        code: hasTrial ? 'RESET_AUTH_REQUIRED' : 'NO_ENTITLEMENT',
        message: hasTrial
            ? '设备密钥已重置，请联网登录已注册账号或联系客服处理'
            : '当前设备无有效授权，请先激活或联系客服处理'
    });
}

/** 落盘轮换：旧公钥入 history、rotationCount+1、登记新公钥。 */
async function finalizeRotation(kv, mid, body, existing, info, reason) {
    const nowIso = new Date().toISOString();
    const history = Array.isArray(existing.history) ? existing.history : [];
    history.push({
        pub: existing.pub,
        kid: existing.kid || '',
        rotatedAt: nowIso
    });
    if (history.length > 10) history.shift();   // 上限防无限增长
    const rotationCount = (existing.rotationCount || 0) + 1;

    const record = buildRecord(info, body, {
        registeredAt: existing.registeredAt || nowIso,
        rotationCount, history
    });
    await kv.put(deviceAttKey(mid), JSON.stringify(record));
    await kv.delete(attChallengeKey(mid)).catch(() => {});

    console.log('[attestation-register] 密钥轮换放行:', mid.slice(0, 8) + '...',
        'identity=' + reason, 'rotationCount=' + rotationCount);

    return json({
        success: true,
        allowed: true,
        registered: 'rotated',
        rotationReason: reason,
        rotationCount,
        kid: info.kid,
        secLevel: info.secLevel,
        serverTime: nowIso
    });
}

// ============================================================================
//  入口
// ============================================================================
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

        // 限流：每 IP 每小时 20 次
        const ip = getClientIP(context);
        const rateOk = await checkRateLimit(kv, ip, 20, 'ratelimit:attreg');
        if (!rateOk.allowed) {
            return json({ success: false, error: '请求过于频繁，请稍后再试' }, 429);
        }

        const body = await context.request.json().catch(() => ({}));
        const action = String(body.action || '').trim();
        const mid = String(body.mid || '').trim();

        if (!mid) {
            return json({ success: false, error: '缺少 mid' }, 400);
        }
        if (!isValidMachineId(mid)) {
            return json({ success: false, error: '机器 ID 格式错误' }, 400);
        }

        const config = await getAttestationConfig(kv);

        if (action === 'challenge') {
            return await handleChallenge(kv, mid);
        }
        if (action === 'register') {
            return await handleRegister(context, kv, body, mid, config);
        }
        return json({ success: false, error: '未知 action' }, 400);

    } catch (error) {
        console.error('[attestation-register] error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
