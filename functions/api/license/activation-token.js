// ============================================================================
//  activation-token.js — 一次性激活令牌端点（2026-10-15 一键激活全端打通 P0）
//
//  路由：POST /api/license/activation-token
//
//  定位：替代客服微信里直发的「裸激活码 bnzc:// 链接」。管理员为一张激活码
//    签发短时效（默认 24h，上限 72h）一次性不透明令牌；客户点 https 落地页
//    （public/activate.html）或 App 深链（bnzc://activate?t=...）兑换，兑换
//    成功后才在响应中拿回激活码明文，随后立即进入既有 validate/claim 流程。
//
//  安全边界（务必与授权链铁律同水位）：
//    ① 不透明令牌：32 字节 CSPRNG base64url（256 位不可猜），不做自包含 JWT，
//       服务端 KV 为唯一权威，可即时作废；不签发即无法探测。
//    ② 一次性 + 首兑机绑：redeem 成功即 status=redeemed 并记录 machineId；
//       同机重试幂等返码，异机再兑 409 拒绝（防链接转发他人消耗）。
//    ③ 兑换不发新码、不做任何账号写操作：只把「管理员原本就会发给客户的那张
//       码」交还给持令牌者，激活消耗仍只发生在 validate/claim 的设备绑定处；
//       不构成账户接管面（匿名端点账户写操作 P0 铁律）。
//    ④ 兑换时重读码记录：签发后码被置 disabled / 端锁变化一律 fail-closed；
//       端锁定口径与 validate.js 完全一致（preset 硬拦、device/null 放行）。
//    ⑤ 频控：匿名 preview 60 次/h、redeem 30 次/h（按 IP）；管理员操作 60/h。
//
//  actions：
//    issue   （管理员）{ code, ttlHours? }
//            → { token, activateUrl, bnzcUrl, expiresAt, edition, clinic, user }
//    preview （匿名）  { token }
//            → { status, edition, clinic, user, productLock, expiresAt }（永不返码）
//    redeem  （匿名）  { token, machineId, productClass }
//            → { code, clinic, user, productLock }（同机重试幂等）
//    revoke  （管理员）{ token? } 或 { code? }（作废该码全部未兑换令牌）
//
//  KV：
//    act_token:{tid}       → 令牌记录（put 带 expirationTtl 自动清理）
//    act_token_idx:{code}  → [tid,...]（按码批量作废用；issue 低频读后写可接受）
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from '../_lib/auth.js';
import {
    getKV, getLicense, appendLicenseLog, checkRateLimit,
    evaluateProductClassGate, KV_LICENSE_PREFIX
} from './_lib/license-core.js';
import { isValidMachineId } from './_lib/schema-guard.js';

const KV_TOKEN_PREFIX = 'act_token:';
const KV_INDEX_PREFIX = 'act_token_idx:';
const TOKEN_VERSION = 1;
const DEFAULT_TTL_HOURS = 24;
const MAX_TTL_HOURS = 72;
// KV 记录存活宽限：过期/兑换后多留 7 天，供审计与同机幂等重试
const KV_TTL_GRACE_SECONDS = 7 * 86400;

// 与 free-pass.js / claim-free.js 同款 CORS（安卓 Capacitor 与落地页同源均在内）
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

const ACTIVATE_PAGE_PATH = '/activate.html';
const BNZC_BASE = 'bnzc://activate';

function corsHeaders(origin) {
    const allowedOrigin = (origin && ALLOWED_ORIGINS.includes(origin)) ? origin : 'https://tcm-prescription-system.pages.dev';
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    };
}

function json(data, status, origin) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });
}

function getClientIP(request) {
    return request.headers.get('CF-Connecting-IP') ||
           request.headers.get('X-Forwarded-For') ||
           request.headers.get('X-Real-IP') ||
           'unknown';
}

// 激活码格式校验：BNZC-XXXX-XXXX-XXXX-XXXX（与 validate.js 同正则）
function isValidCodeFormat(code) {
    if (!code || typeof code !== 'string') return false;
    return /^BNZC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code);
}

// 32 字节 CSPRNG → 43 字符 base64url（[A-Za-z0-9_-]，URL 安全、无填充）
function generateToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function isValidTokenFormat(t) {
    return typeof t === 'string' && /^[A-Za-z0-9_-]{32,64}$/.test(t);
}

function editionLabelOf(record) {
    // 与客户端 license-manager LICENSE_TYPE_CONFIG 文案对齐（仅用于落地页展示）
    const type = String((record && record.type) || '').toLowerCase();
    const productClass = String((record && record.productClass) || '').toLowerCase();
    const parts = [];
    parts.push(type === 'pro' ? '专业版' : (type === 'personal' ? '个人版' : (type === 'free' ? '免费版' : '授权版')));
    parts.push(productClass === 'cloud' ? '云端账号' : '离线软件');
    return parts.join('·');
}

async function readTokenRecord(kv, token) {
    try {
        return await kv.get(KV_TOKEN_PREFIX + token, 'json');
    } catch (e) {
        console.warn('[activation-token] 令牌记录读取失败:', e && e.message);
        return null;
    }
}

// 当前状态的实时评估（KV 记录状态 + exp 时间窗）
function tokenLiveStatus(rec, nowMs) {
    if (!rec) return 'not_found';
    if (rec.status === 'redeemed') return 'redeemed';
    if (rec.status === 'revoked') return 'revoked';
    if (rec.exp && rec.exp < nowMs) return 'expired';
    return 'active';
}

// ---------------------------------------------------------------------------
//  action 处理
// ---------------------------------------------------------------------------

async function handleIssue(context, kv, body, origin, ip, operator) {
    const code = String(body.code || '').trim().toUpperCase();
    const ttlHoursRaw = Number(body.ttlHours);
    const ttlHours = Number.isFinite(ttlHoursRaw) && ttlHoursRaw > 0
        ? Math.min(MAX_TTL_HOURS, Math.floor(ttlHoursRaw))
        : DEFAULT_TTL_HOURS;

    if (!isValidCodeFormat(code)) {
        return json({ success: false, error: '激活码格式错误（应为 BNZC-XXXX-XXXX-XXXX-XXXX）' }, 400, origin);
    }

    const licRecord = await getLicense(kv, code).catch(() => null);
    if (!licRecord) {
        return json({ success: false, error: '激活码不存在，请核对后重试' }, 404, origin);
    }
    // 已废码禁止签发（used/expired 等状态不拦——换机/多设备激活仍由 validate 闸把关）
    if (String(licRecord.status) === 'disabled') {
        return json({ success: false, error: '该激活码已停用，无法生成激活链接' }, 400, origin);
    }

    const nowMs = Date.now();
    const token = generateToken();
    const productLock = (typeof licRecord.productClass === 'string' && licRecord.productClass)
        ? String(licRecord.productClass).toLowerCase() : null;
    const record = {
        v: TOKEN_VERSION,
        code,
        productLock,
        edition: editionLabelOf(licRecord),
        clinic: String(licRecord.clinicName || ''),
        user: String(licRecord.user || ''),
        iat: nowMs,
        exp: nowMs + ttlHours * 3600 * 1000,
        status: 'active',
        issuedBy: operator,
        issuedIp: ip,
        redeemedAt: null,
        machineId: null,
        redeemIp: null
    };

    // 索引（按码批量作废用）。issue 为客服低频操作，读后写无 CAS 可接受；
    // 失败仅审计告警、不阻断签发（单令牌 revoke 不依赖索引）。
    try {
        await kv.put(KV_TOKEN_PREFIX + token, JSON.stringify(record),
            { expirationTtl: ttlHours * 3600 + KV_TTL_GRACE_SECONDS });
        const idxKey = KV_INDEX_PREFIX + code;
        const idx = (await kv.get(idxKey, 'json')) || [];
        idx.unshift(token);
        await kv.put(idxKey, JSON.stringify(idx.slice(0, 50)),
            { expirationTtl: MAX_TTL_HOURS * 3600 + KV_TTL_GRACE_SECONDS });
    } catch (e) {
        console.error('[activation-token] 令牌写入失败:', e && e.message);
        return json({ success: false, error: '令牌写入失败，请稍后重试' }, 500, origin);
    }

    appendLicenseLog(kv, code, {
        action: 'activation-token-issue',
        ip, operator,
        detail: `ttl=${ttlHours}h token=${token.slice(0, 8)}…`
    }).catch(() => {});

    const q = `token=${encodeURIComponent(token)}`;
    return json({
        success: true,
        token,
        activateUrl: `${ACTIVATE_PAGE_PATH}?${q}`,
        bnzcUrl: `${BNZC_BASE}?t=${encodeURIComponent(token)}`,
        status: 'active',
        edition: record.edition,
        clinic: record.clinic,
        user: record.user,
        productLock,
        issuedAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(record.exp).toISOString(),
        ttlHours
    }, 200, origin);
}

async function handlePreview(context, kv, body, origin) {
    const token = String(body.token || '').trim();
    if (!isValidTokenFormat(token)) {
        return json({ success: false, status: 'invalid', error: '链接格式不正确' }, 400, origin);
    }
    const rec = await readTokenRecord(kv, token);
    const status = tokenLiveStatus(rec, Date.now());

    if (status === 'not_found') {
        return json({ success: false, status: 'not_found', error: '链接不存在或已失效' }, 404, origin);
    }
    return json({
        success: status === 'active',
        status,
        edition: rec.edition || '',
        clinic: rec.clinic || '',
        user: rec.user || '',
        productLock: rec.productLock || null,
        expiresAt: rec.exp ? new Date(rec.exp).toISOString() : null,
        redeemedAt: rec.redeemedAt ? new Date(rec.redeemedAt).toISOString() : null,
        // 永不返回 code 字段
    }, status === 'active' ? 200 : 410, origin);
}

async function handleRedeem(context, kv, body, origin, ip) {
    const token = String(body.token || '').trim();
    const machineId = String(body.machineId || '').trim();
    const productClassRaw = String(body.productClass || '').trim();

    if (!isValidTokenFormat(token)) {
        return json({ success: false, error: '链接格式不正确' }, 400, origin);
    }
    if (!machineId || !isValidMachineId(machineId)) {
        return json({ success: false, error: '缺少机器标识，请重启软件后重试' }, 400, origin);
    }
    if (!productClassRaw) {
        return json({ success: false, error: '缺少端类型，请更新到最新版后重试' }, 400, origin);
    }

    const rec = await readTokenRecord(kv, token);
    const status = tokenLiveStatus(rec, Date.now());

    if (status === 'not_found') {
        return json({ success: false, error: '链接不存在或已失效，请联系客服重新获取' }, 404, origin);
    }
    if (status === 'expired') {
        return json({ success: false, error: '激活链接已过期，请联系客服重新获取', reason: 'expired' }, 410, origin);
    }
    if (status === 'revoked') {
        return json({ success: false, error: '激活链接已作废，请联系客服重新获取', reason: 'revoked' }, 410, origin);
    }
    if (status === 'redeemed') {
        // 幂等：同一设备网络重试/重启恢复 → 原样返码；异机 → 拒绝（一次性）
        if (rec.machineId === machineId) {
            const lic0 = await getLicense(kv, rec.code).catch(() => null);
            if (!lic0 || String(lic0.status) === 'disabled') {
                return json({ success: false, error: '激活码已停用，请联系客服' }, 410, origin);
            }
            return json({
                success: true, code: rec.code, clinic: rec.clinic || '',
                user: rec.user || '', productLock: rec.productLock || null,
                idempotent: true
            }, 200, origin);
        }
        return json({ success: false, error: '该链接已在其他设备使用，不可转发激活；如需多台设备请联系客服', reason: 'redeemed_other' }, 409, origin);
    }

    // active：兑换前重读码记录（签发后可能被停用/端锁变化），fail-closed
    const licRecord = await getLicense(kv, rec.code).catch(() => null);
    if (!licRecord) {
        return json({ success: false, error: '激活码不存在，请联系客服' }, 410, origin);
    }
    if (String(licRecord.status) === 'disabled') {
        return json({ success: false, error: '激活码已停用，请联系客服' }, 410, origin);
    }
    // 端锁定闸：口径与 validate.js 一致——preset（预置库存码）不匹配硬拦；
    // device（历史码派生，观察期）/ null（无锁）放行，最终仍由 validate 复核。
    const gate = evaluateProductClassGate(licRecord, productClassRaw);
    if (gate.source === 'preset' && !gate.check.ok) {
        appendLicenseLog(kv, rec.code, {
            action: 'activation-token-redeem-denied',
            ip, operator: 'anonymous',
            detail: `端不符 locked=${gate.locked} got=${gate.requestEnd || productClassRaw} mid=${String(machineId).slice(0, 12)}`
        }).catch(() => {});
        return json({
            success: false,
            error: gate.locked === 'cloud'
                ? '该链接为云端版授权，请在云端版软件中打开'
                : '该链接为离线版授权，请在离线版软件中打开',
            reason: 'product_mismatch',
            productLock: gate.locked
        }, 403, origin);
    }

    // 标记兑换（KV 无 CAS：双机同刻极端并发下后写覆盖，最终消耗仍由
    // validate/claim 的 maxDevices + 端锁闸兜底；首兑机绑拒绝转发为主防线）
    const nowMs = Date.now();
    rec.status = 'redeemed';
    rec.redeemedAt = nowMs;
    rec.machineId = machineId;
    rec.redeemIp = ip;
    try {
        await kv.put(KV_TOKEN_PREFIX + token, JSON.stringify(rec),
            { expirationTtl: KV_TTL_GRACE_SECONDS });
    } catch (e) {
        console.error('[activation-token] 兑换落盘失败:', e && e.message);
        return json({ success: false, error: '服务器繁忙，请稍后重试' }, 500, origin);
    }

    appendLicenseLog(kv, rec.code, {
        action: 'activation-token-redeem',
        ip, operator: 'anonymous',
        detail: `mid=${String(machineId).slice(0, 12)} end=${gate.requestEnd || productClassRaw} token=${token.slice(0, 8)}…`
    }).catch(() => {});

    // ★ 2026-10-17 P40 真机实证：兑换设备台账（诊所预置码 App 端死锁根治）。
    //   App 端 activateLicense 桥 clinicName 硬编码空串（MainActivity.java L3474），
    //   诊所预置码的深链/手动/令牌三条激活路径全被 validate.js 诊所名闸 400 拦死，
    //   存量 APK 无诊所名输入通道。兑换者已持管理员签发的一次性令牌（首兑机绑），
    //   信任级等同 phoneVerified——把兑换设备 machineId 记入码记录 redeemedDevices
    //   台账，validate.js 据此豁免诊所名校验（服务端单点修复，老客户端零重打包）。
    //   台账封顶 10 台防 KV 记录膨胀；写失败不阻断兑换（码明文已交还，兜底仍由
    //   validate 既有闸把关，仅损失本次豁免资格）。
    try {
        const __rdList = Array.isArray(licRecord.redeemedDevices) ? licRecord.redeemedDevices : [];
        if (machineId && __rdList.indexOf(String(machineId)) === -1) {
            __rdList.push(String(machineId));
            licRecord.redeemedDevices = __rdList.slice(-10);
            await kv.put(KV_LICENSE_PREFIX + rec.code, JSON.stringify(licRecord));
        }
    } catch (e) {
        console.error('[activation-token] 兑换设备台账落盘失败(不阻断):', e && e.message);
    }

    return json({
        success: true,
        code: rec.code,
        clinic: rec.clinic || '',
        user: rec.user || '',
        productLock: rec.productLock || null
    }, 200, origin);
}

async function handleRevoke(context, kv, body, origin, ip, operator) {
    const token = String(body.token || '').trim();
    const code = String(body.code || '').trim().toUpperCase();

    if (token) {
        if (!isValidTokenFormat(token)) {
            return json({ success: false, error: '令牌格式不正确' }, 400, origin);
        }
        const rec = await readTokenRecord(kv, token);
        if (!rec) return json({ success: false, error: '令牌不存在（可能已过期清理）' }, 404, origin);
        if (rec.status === 'active') {
            rec.status = 'revoked';
            rec.revokedAt = Date.now();
            rec.revokedBy = operator;
            await kv.put(KV_TOKEN_PREFIX + token, JSON.stringify(rec),
                { expirationTtl: KV_TTL_GRACE_SECONDS });
            appendLicenseLog(kv, rec.code, {
                action: 'activation-token-revoke', ip, operator,
                detail: `token=${token.slice(0, 8)}…`
            }).catch(() => {});
        }
        return json({ success: true, status: rec.status }, 200, origin);
    }

    if (code) {
        if (!isValidCodeFormat(code)) {
            return json({ success: false, error: '激活码格式错误' }, 400, origin);
        }
        const idxKey = KV_INDEX_PREFIX + code;
        const idx = (await kv.get(idxKey, 'json')) || [];
        let revoked = 0;
        for (const tid of idx.slice(0, 50)) {
            const r = await readTokenRecord(kv, tid);
            if (r && r.status === 'active') {
                r.status = 'revoked';
                r.revokedAt = Date.now();
                r.revokedBy = operator;
                await kv.put(KV_TOKEN_PREFIX + tid, JSON.stringify(r),
                    { expirationTtl: KV_TTL_GRACE_SECONDS });
                revoked++;
            }
        }
        appendLicenseLog(kv, code, {
            action: 'activation-token-revoke-batch', ip, operator,
            detail: `revoked=${revoked}`
        }).catch(() => {});
        return json({ success: true, revoked, scanned: idx.length }, 200, origin);
    }

    return json({ success: false, error: '请提供 token 或 code' }, 400, origin);
}

// ---------------------------------------------------------------------------

export async function onRequest(context) {
    const request = context.request;
    const method = request.method;
    const origin = request.headers.get('Origin') || '';

    if (method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (method !== 'POST') {
        return json({ success: false, error: 'Method not allowed' }, 405, origin);
    }

    const ip = getClientIP(request);
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '').trim();
    const ANON = action === 'preview' || action === 'redeem';

    if (!['issue', 'preview', 'redeem', 'revoke'].includes(action)) {
        return json({ success: false, error: '未知操作' }, 400, origin);
    }

    try {
        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500, origin);
        }

        // 匿名动作的 IP 频控（令牌空间 256 位不可扫，频控为防滥用/爬落地页）
        if (ANON) {
            const limit = action === 'redeem' ? 30 : 60;
            const rateOk = await checkRateLimit(kv, `act_token_${action}_${ip}`, limit);
            if (!rateOk.allowed) {
                return json({ success: false, error: '请求过于频繁，请稍后再试' }, 429, origin);
            }
            if (action === 'preview') return handlePreview(context, kv, body, origin);
            return handleRedeem(context, kv, body, origin, ip);
        }

        // 管理员动作
        const currentUser = await parseAuthHeader(request, context.env);
        if (!currentUser || !isPlatformAdmin(currentUser)) {
            return json({ success: false, error: '仅平台总管理员可签发/作废激活链接' }, 403, origin);
        }
        const adminRate = await checkRateLimit(kv, `act_token_admin_${ip}`, 60);
        if (!adminRate.allowed) {
            return json({ success: false, error: '操作过于频繁，请稍后再试' }, 429, origin);
        }
        const operator = currentUser.username || currentUser.name || currentUser.sub || 'platform_admin';

        if (action === 'issue') return handleIssue(context, kv, body, origin, ip, operator);
        return handleRevoke(context, kv, body, origin, ip, operator);
    } catch (error) {
        console.error('[activation-token] error:', error);
        return json({ success: false, error: '服务器繁忙，请稍后再试' }, 500, origin);
    }
}
