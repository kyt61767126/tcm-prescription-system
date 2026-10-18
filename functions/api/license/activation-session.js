// ============================================================================
//  activation-session.js — 激活会话（S1b-② MVP，2026-10-17）
//
//  路由：POST /api/license/activation-session
//
//  目标：把「令牌兑换 → claim → 账号/装码」串成一个可重试会话，令牌核销时点
//   从 redeem 后移到 **claim 成功之后**（activation-token linked→redeemed），
//   彻底消除 P40 暴露的「令牌已用、码未激活」双轨分裂；失败可重试、成功幂等。
//
//  动作（body.action）：
//    start    { token, machineId, productClass, clientClass, identity{...} }
//             → 令牌 linked（不核销、不泄露裸码给前端）+ 建 act_session:{sid}（30min TTL）
//             → { success, sid, clinic, user, productLock, expiresAt }
//    complete { sid, machineId }
//             → 内部调 claim（用会话内 identity+code）→ 成功后 activation-token consume
//             → { success, receipt:{license, licenseInfo, code, ...}, idempotent? }
//               失败 → { success:false, error, retry:true }（令牌保持 linked，可重试）
//    status   { sid, machineId } → { success, status, expiresAt, error? }
//
//  安全：
//    · sid = CSPRNG 16 字节 hex，与 machineId 绑定；跨机读取 403；
//    · 前端只拿 sid，不拿裸码（claim 在服务端完成）；receipt 才回 code（客户端存 license:code）
//    · 令牌异机 409、过期/作废/停用 fail-closed；claim 失败绝不允许核销令牌
//    · 不改变既有 redeem/claim 端点语义（旧客户端零回归）
// ============================================================================

import { getKV, checkRateLimit } from './_lib/license-core.js';
import { isValidMachineId } from './_lib/schema-guard.js';
import { onRequest as tokenOnRequest } from './activation-token.js';
import { onRequest as claimOnRequest } from './claim.js';

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
const SESSION_PREFIX = 'act_session:';
const SESSION_TTL_SEC = 1800;

function corsHeaders(request) {
    const origin = request ? (request.headers.get('Origin') || '') : '';
    let allowedOrigin;
    if (origin === 'null') allowedOrigin = 'null';
    else allowedOrigin = (origin && ALLOWED_ORIGINS.includes(origin)) ? origin : 'https://tcm-prescription-system.pages.dev';
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    };
}
function json(data, status = 200, request = null) {
    return new Response(JSON.stringify(data), { status: status, headers: corsHeaders(request) });
}
function getClientIP(request) {
    return (request && request.headers.get('CF-Connecting-IP')) || 'unknown';
}
function makeSid() {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

// 复用既有端点：构造等价 Request 调用（保持 Origin/IP 透传与既有 CORS/频控语义）
async function callHandler(handler, context, path, body) {
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    const origin = context.request.headers.get('Origin');
    if (origin) headers.set('Origin', origin);
    const ip = context.request.headers.get('CF-Connecting-IP');
    if (ip) headers.set('CF-Connecting-IP', ip);
    const url = new URL(path, context.request.url).toString();
    const req = new Request(url, { method: 'POST', headers: headers, body: JSON.stringify(body) });
    const res = await handler({ request: req, env: context.env });
    let j = null;
    try { j = await res.json(); } catch (e) { /* 非 JSON 按失败处理 */ }
    return { status: res.status, json: j };
}

function sanitizeIdentity(raw) {
    const i = (raw && typeof raw === 'object') ? raw : {};
    const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
    return {
        user: s(i.user, 64),
        clinicName: s(i.clinicName, 60),
        phone: s(i.phone, 20),
        password: (typeof i.password === 'string' && i.password) ? i.password.slice(0, 64) : '',
        inviteCode: s(i.inviteCode, 10).toUpperCase()
    };
}

async function handleStart(context, kv, body, origin, ip) {
    const token = String(body.token || '').trim();
    const machineId = String(body.machineId || '').trim();
    const productClass = String(body.productClass || '').trim().toLowerCase();
    const clientClass = String(body.clientClass || 'app').trim().toLowerCase();
    if (!token) return json({ success: false, error: '缺少激活链接' }, 400, context.request);
    if (!machineId || !isValidMachineId(machineId)) return json({ success: false, error: '缺少机器标识，请重启软件后重试' }, 400, context.request);
    if (productClass !== 'offline' && productClass !== 'cloud') return json({ success: false, error: '缺少端类型，请更新到最新版后重试' }, 400, context.request);

    const r = await callHandler(tokenOnRequest, context, '/api/license/activation-token', {
        action: 'redeem', token: token, machineId: machineId,
        productClass: productClass, deferConsume: true
    });
    if (!r.json || !r.json.success) {
        return json(Object.assign({ success: false }, (r.json || { error: '链接兑换失败' })), r.status || 400, context.request);
    }
    const sid = makeSid();
    const now = Date.now();
    const session = {
        sid: sid,
        token: token,
        code: String(r.json.code || '').trim().toUpperCase(),
        machineId: machineId,
        productClass: productClass,
        clientClass: (clientClass === 'desktop' ? 'desktop' : 'app'),
        identity: sanitizeIdentity(body.identity),
        clinic: r.json.clinic || '',
        user: r.json.user || '',
        productLock: r.json.productLock || null,
        status: 'code_issued',
        createdAt: now,
        expiresAt: now + SESSION_TTL_SEC * 1000
    };
    if (!session.code) return json({ success: false, error: '链接兑换异常（无激活码）' }, 500, context.request);
    await kv.put(SESSION_PREFIX + sid, JSON.stringify(session), { expirationTtl: SESSION_TTL_SEC });
    return json({
        success: true, sid: sid, clinic: session.clinic, user: session.user,
        productLock: session.productLock, expiresAt: new Date(session.expiresAt).toISOString()
    }, 200, context.request);
}

async function readSession(kv, sid) {
    if (!/^[a-f0-9]{32}$/.test(String(sid || ''))) return null;
    return await kv.get(SESSION_PREFIX + sid, 'json').catch(() => null);
}

async function handleComplete(context, kv, body, origin, ip) {
    const sid = String(body.sid || '').trim();
    const machineId = String(body.machineId || '').trim();
    if (!machineId || !isValidMachineId(machineId)) return json({ success: false, error: '缺少机器标识' }, 400, context.request);
    const session = await readSession(kv, sid);
    if (!session) return json({ success: false, error: '激活会话不存在或已过期，请重新打开激活链接' }, 404, context.request);
    if (session.machineId !== machineId) return json({ success: false, error: '激活会话与设备不匹配' }, 403, context.request);
    if (Date.now() > Number(session.expiresAt || 0)) {
        return json({ success: false, error: '激活会话已过期，请重新打开激活链接' }, 410, context.request);
    }
    // 幂等：已完成直接回执
    if (session.status === 'completed' && session.receipt) {
        return json({ success: true, idempotent: true, receipt: session.receipt }, 200, context.request);
    }
    // 上次 claim 成功但 consume 失败：只补核销，不重复 claim
    if (session.status === 'claim_succeeded_token_pending') {
        const c = await callHandler(tokenOnRequest, context, '/api/license/activation-token', {
            action: 'consume', token: session.token, machineId: machineId
        });
        if (c.json && c.json.success) {
            session.status = 'completed';
            session.completedAt = Date.now();
            await kv.put(SESSION_PREFIX + sid, JSON.stringify(session), { expirationTtl: SESSION_TTL_SEC });
            return json({ success: true, idempotent: true, receipt: session.receipt }, 200, context.request);
        }
        return json({ success: false, error: '激活已完成，令牌核销失败（稍后重试）', retry: true, receipt: session.receipt }, 502, context.request);
    }

    // claim（服务端完成，裸码不回前端）
    const claimBody = {
        code: session.code,
        machineId: machineId,
        user: session.identity.user || session.user || '',
        clinicName: session.identity.clinicName || '',
        phone: session.identity.phone || '',
        productClass: session.productClass,
        clientClass: session.clientClass,
        inviteCode: session.identity.inviteCode || ''
    };
    if (session.productClass === 'cloud') {
        claimBody.pwdCap = 'v2';
        if (session.identity.password) claimBody.password = session.identity.password;
    }
    const cr = await callHandler(claimOnRequest, context, '/api/license/claim', claimBody);
    if (!cr.json || !cr.json.success) {
        session.status = 'claim_failed';
        session.lastError = (cr.json && (cr.json.error || cr.json.message)) || ('激活失败（HTTP ' + (cr.status || 0) + '）');
        session.lastAttemptAt = Date.now();
        await kv.put(SESSION_PREFIX + sid, JSON.stringify(session), { expirationTtl: SESSION_TTL_SEC });
        return json(Object.assign({ success: false, retry: true }, (cr.json || { error: session.lastError })), cr.status || 400, context.request);
    }

    const receipt = {};
    ['license', 'licenseInfo', 'code', 'type', 'expiresAt', 'user', 'resolvedIdentity',
        'identitySource', 'inviteInfo', 'message', 'action'].forEach(function (k) {
        if (cr.json[k] !== undefined) receipt[k] = cr.json[k];
    });
    if (!receipt.code) receipt.code = session.code;
    session.receipt = receipt;
    session.status = 'claim_succeeded_token_pending';
    session.claimAt = Date.now();
    await kv.put(SESSION_PREFIX + sid, JSON.stringify(session), { expirationTtl: SESSION_TTL_SEC });

    // claim 成功 → 核销令牌（失败不回滚激活结果，会话可重试补核销）
    const c = await callHandler(tokenOnRequest, context, '/api/license/activation-token', {
        action: 'consume', token: session.token, machineId: machineId
    });
    if (c.json && c.json.success) {
        session.status = 'completed';
        session.completedAt = Date.now();
        await kv.put(SESSION_PREFIX + sid, JSON.stringify(session), { expirationTtl: SESSION_TTL_SEC });
        return json({ success: true, receipt: receipt }, 200, context.request);
    }
    session.lastError = (c.json && c.json.error) || '令牌核销失败';
    await kv.put(SESSION_PREFIX + sid, JSON.stringify(session), { expirationTtl: SESSION_TTL_SEC });
    return json({ success: true, receipt: receipt, consumePending: true }, 200, context.request);
}

async function handleStatus(kv, body, request) {
    const sid = String(body.sid || '').trim();
    const machineId = String(body.machineId || '').trim();
    const session = await readSession(kv, sid);
    if (!session) return json({ success: false, error: '激活会话不存在或已过期' }, 404, request);
    if (machineId && session.machineId !== machineId) return json({ success: false, error: '激活会话与设备不匹配' }, 403, request);
    return json({
        success: true, status: session.status,
        expiresAt: new Date(Number(session.expiresAt || 0)).toISOString(),
        lastError: session.lastError || null,
        completed: session.status === 'completed'
    }, 200, request);
}

export async function onRequest(context) {
    const request = context.request;
    const method = request.method;
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
    if (method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405, request);
    try {
        const kv = getKV(context);
        if (!kv) return json({ success: false, error: 'KV binding not found' }, 500, request);
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object') return json({ success: false, error: '请求体格式错误' }, 400, request);
        const action = String(body.action || '').trim();
        if (['start', 'complete', 'status'].indexOf(action) === -1) {
            return json({ success: false, error: '未知操作' }, 400, request);
        }
        const ip = getClientIP(request);
        const rateOk = await checkRateLimit(kv, `act_session_${action}_${ip}`, 30);
        if (!rateOk.allowed) return json({ success: false, error: '请求过于频繁，请稍后再试' }, 429, request);
        if (action === 'start') return handleStart(context, kv, body, '', ip);
        if (action === 'complete') return handleComplete(context, kv, body, '', ip);
        return handleStatus(kv, body, request);
    } catch (error) {
        console.error('[activation-session] error:', error);
        return json({ success: false, error: '服务器繁忙，请稍后再试' }, 500, request);
    }
}
