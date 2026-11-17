// ============================================================================
//  login-punch.js（端点）— 登录即上报（2026-11-17）
//
//  路由：POST /api/license/login-punch
//
//  背景：离线端「今日登录」此前只认 D1 license_heartbeats.last_heartbeat
//       （10 分钟心跳）与 KV devices[].lastHeartbeat，导致登录后最长 10 分钟
//       才出现，APP 定时器被挂起时永远为 0。
//
//  语义（严格复用既有统计，不新造第二套计数）：
//    - 只写 lp:{yyyy-mm-dd}:{encClinic}:{t}:{encUid} 一个键（与 heartbeat 同源），
//      同一设备同一北京自然日重复调用 → KV GET 命中即跳过（1 写/端/天）。
//    - 不写 D1 license_heartbeats、不刷新 lastHeartbeat、不参与在线判定
//      （在线口径仍只看心跳，本端点零影响）。
//    - uid = machineId；t 由设备归属决定（d=桌面 / a=APP），未知兜底桌面。
//
//  请求体：
//    { "machineId": "...", "code": "BNZC-...", "clientClass": "desktop|app" }
//    code 可缺省（丢码设备按 mid_idx 反查属主记录）。
//
//  返回：{ success: true, punched: true|false, clinicName?, clientClass? }
//        无需上报时也返回 200（客户端不重试、不弹窗）。
// ============================================================================

import { getKV, getLicense, findLicensesByMachine, checkRateLimit } from './_lib/license-core.js';
import { punchLogin } from '../_lib/login-punch.js';
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
let _currentRequest = null;

function corsHeaders() {
    const origin = _currentRequest ? (_currentRequest.headers.get('Origin') || '') : '';
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
    const method = context.request.method;

    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders() });
    }
    if (method !== 'POST') {
        return json({ success: false, error: 'Method not allowed' }, 405);
    }

    try {
        const kv = getKV(context);
        if (!kv) return json({ success: false, error: 'KV binding not found' }, 500);

        // 每 IP 每小时 120 次（单设备 1 次/天；诊所多设备共用出口 IP 亦充裕）
        const ip = getClientIP(context);
        const rateOk = await checkRateLimit(kv, `lpunch_${ip}`, 120);
        if (!rateOk.allowed) {
            return json({ success: false, error: 'rate limited' }, 429);
        }

        const body = await context.request.json().catch(() => ({}));
        const machineId = String((body && body.machineId) || '').trim();
        if (!isValidMachineId(machineId)) {
            return json({ success: false, error: 'invalid machineId' }, 400);
        }

        // 授权记录：优先客户端带的码，缺失/无效按 mid_idx 反查属主
        let record = null;
        const code = String((body && body.code) || '').trim();
        if (code) {
            try {
                const r = await getLicense(kv, code);
                if (r && r.code) record = r;
            } catch (_) {}
        }
        if (!record) {
            try {
                const hits = await findLicensesByMachine(kv, machineId);
                if (Array.isArray(hits) && hits.length) record = hits[0];
            } catch (_) {}
        }
        if (!record || !record.clinicName) {
            // 无授权归属（试用/未激活/码已删）→ 静默成功，不写任何统计
            return json({ success: true, punched: false });
        }

        // 端类型：以设备绑定记录为准，其次请求声明（离线端只有 desktop/app）
        const devices = Array.isArray(record.devices) ? record.devices : [];
        const dev = devices.find(d => d && d.machineId === machineId);
        let clientClass = (dev && dev.clientClass) || '';
        if (clientClass !== 'desktop' && clientClass !== 'app') {
            const decl = String((body && body.clientClass) || '').toLowerCase();
            clientClass = decl === 'app' ? 'app' : 'desktop';
        }

        await punchLogin(kv, { clinicName: record.clinicName, clientClass, uid: machineId });

        return json({
            success: true,
            punched: true,
            clinicName: record.clinicName,
            clientClass
        });
    } catch (e) {
        return json({ success: false, error: 'server error' }, 500);
    }
}
