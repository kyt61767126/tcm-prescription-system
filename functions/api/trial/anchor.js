// ============================================================================
//  trial/anchor.js — 试用起点远端锚点（防「断网 + 删本地痕迹」无限重开试用）
//
//  路由：POST /api/trial/anchor
//
//  背景：本地已写入 trial.dat + .trial-anchor（双位置）+ 统一态 trialStartAt，
//        但把全部本地痕迹一起删掉后仍可重新起算 7 天。本端点把首次在线启动的
//        试用起点落到服务端；客户端每次启动只在「从未成功上报过」时调用一次。
//
//  请求体（全部为白名单字段，无患者/诊所业务数据）：
//    {
//      "mid": "32hex",              // 客户端 machineId（本身已是 SHA256 派生值，非明文机器码）
//      "ts":  1762900000000,        // 客户端本地最早试用起点（epoch ms，可缺省）
//      "v":   "1.0.235",            // 应用版本
//      "ed":  "local-desktop"       // 端类型（白名单）
//    }
//
//  返回：
//    { "success": true, "trialStartAt": 1762900000000, "serverTime": "..." }
//
//  KV 值结构（key = trial_anchor:{sha256(mid)}，永不过期）：
//    {
//      trialStartAt: 1762900000000,   // 服务端认定的试用起点（只允许变小，不允许变大）
//      firstSeenAt:  "ISO",           // 服务端首次见到该机器的时刻
//      lastReportedAt: "ISO",         // 最近一次上报（仅当起点被收紧时才更新）
//      v: "1.0.235",                  // 最近上报的应用版本
//      ed: "local-desktop",           // 端类型
//      reportCount: 1                 // 有效写入次数
//    }
//
//  安全与限流：
//    · 不信任客户端时间：ts 只接受 [now-30d, now+5min] 区间，越界按 now 处理；
//      且记录一旦存在只允许 Math.min 收紧，伪造「未来时间」无法延长试用。
//    · 客户端 machineId 只是 32 位十六进制哈希，服务端再用 sha256 归一化为 key，
//      不存原始机器码、不存 IP、不存任何可识别个人/诊所的信息。
//    · 限流：每 IP 每小时 20 次（isolate 内存桶，零 KV 写，与 trial/register 同口径）。
//    · 失败一律返回标准 JSON，客户端按 fail-open 静默处理，不阻塞启动。
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

// 端类型白名单（与 telemetry/heartbeat 对齐；多端共用同一 mid 锚点）
const ALLOWED_EDITIONS = ['local-desktop', 'cloud-desktop', 'cloud-app', 'local-app'];

const KV_PREFIX = 'trial_anchor:';
const MAX_REPORTS_PER_HOUR = 20;
const MAX_CLIENT_TS_AGE_MS = 30 * 24 * 60 * 60 * 1000;   // 最多回溯 30 天（试用期仅 7 天）
const MAX_CLIENT_TS_FUTURE_MS = 5 * 60 * 1000;           // 容忍 5 分钟时钟漂移

function corsHeaders(origin) {
    // 与 admin-status/heartbeat 同款：Electron/命令行无 Origin 时回退 'null'
    const allowedOrigin = (origin && ALLOWED_ORIGINS.includes(origin)) ? origin : 'null';
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    };
}

function json(data, status, origin) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders(origin || '') });
}

function getClientIP(context) {
    return context.request.headers.get('CF-Connecting-IP') ||
           context.request.headers.get('X-Forwarded-For') ||
           context.request.headers.get('X-Real-IP') ||
           'unknown';
}

// 服务端二次 sha256：key 归一化 + 防注入（输出恒为 64 hex）
async function sha256Hex(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// 客户端试用起点：越界/非法一律返回 0（由调用方回退到服务端 now）
function sanitizeClientTs(raw, now) {
    const ts = Number(raw) || 0;
    if (!(ts > 0)) return 0;
    if (ts > now + MAX_CLIENT_TS_FUTURE_MS) return 0;
    if (ts < now - MAX_CLIENT_TS_AGE_MS) return 0;
    return Math.floor(ts);
}

export async function onRequest(context) {
    const method = context.request.method;
    const origin = context.request.headers.get('Origin') || '';

    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders(origin) });
    }
    if (method !== 'POST') {
        return json({ success: false, error: 'Method not allowed' }, 405, origin);
    }

    try {
        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500, origin);
        }

        const rate = await checkRateLimit(kv, getClientIP(context), MAX_REPORTS_PER_HOUR, 'ratelimit:trial-anchor');
        if (!rate.allowed) {
            return json({ success: false, error: 'Too many requests' }, 429, origin);
        }

        let body;
        try {
            body = await context.request.json();
        } catch (e) {
            return json({ success: false, error: 'Invalid JSON' }, 400, origin);
        }

        const mid = String(body.mid || '');
        const ed = String(body.ed || '');
        const v = String(body.v || '');
        if (!/^[0-9A-Za-z]{16,128}$/.test(mid)) {
            return json({ success: false, error: 'Invalid mid' }, 400, origin);
        }
        if (!ALLOWED_EDITIONS.includes(ed)) {
            return json({ success: false, error: 'Invalid edition' }, 400, origin);
        }
        if (!/^[0-9A-Za-z.\-+ ]{1,40}$/.test(v)) {
            return json({ success: false, error: 'Invalid version' }, 400, origin);
        }

        const now = Date.now();
        const serverTime = new Date(now).toISOString();
        const midHash = await sha256Hex(KV_PREFIX + mid);
        const key = KV_PREFIX + midHash;

        // 客户端起点仅作「更早」候选；缺失/非法时用服务端 now 作为首次起点。
        const clientStart = sanitizeClientTs(body.ts, now);
        const candidate = clientStart > 0 ? clientStart : now;

        const prev = await (async () => {
            try { return await kv.get(key, 'json'); }
            catch (e) {
                // 读失败不能当成「无记录」继续写（会把更早的远端起点覆盖成 now），
                // 直接返回 503 让客户端静默重试。
                const err = new Error('Storage read failed');
                err.__storage = true;
                throw err;
            }
        })();

        if (prev && Number(prev.trialStartAt) > 0) {
            const prevStart = Number(prev.trialStartAt);
            const start = Math.min(prevStart, candidate);
            // 单调收紧：只有客户端给出了更早的合法起点才写一次
            if (start < prevStart) {
                const record = {
                    ...prev,
                    trialStartAt: start,
                    lastReportedAt: serverTime,
                    v: v || prev.v || '',
                    ed: ed || prev.ed || '',
                    reportCount: (Number(prev.reportCount) || 1) + 1
                };
                try { await kv.put(key, JSON.stringify(record)); } catch (e) { /* 写失败不影响返回值 */ }
            }
            return json({ success: true, trialStartAt: start, serverTime }, 200, origin);
        }

        const record = {
            trialStartAt: candidate,
            firstSeenAt: serverTime,
            lastReportedAt: serverTime,
            v: v,
            ed: ed,
            reportCount: 1
        };
        await kv.put(key, JSON.stringify(record));
        return json({ success: true, trialStartAt: candidate, serverTime }, 200, origin);
    } catch (e) {
        if (e && e.__storage) {
            return json({ success: false, error: 'Storage unavailable' }, 503, origin);
        }
        return json({ success: false, error: 'Internal error' }, 500, origin);
    }
}
