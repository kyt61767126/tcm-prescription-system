// ============================================================================
//  heartbeat.js — 客户端匿名启动心跳 API（下载转化统计的数据源）
//
//  路由：POST /api/telemetry/heartbeat
//
//  用途：统计「官网下载安装（试用）未激活」的分母——安装且在用的设备数。
//        四端客户端（local-desktop / cloud-desktop / cloud-app / local-app）
//        每次启动检查更新时顺带上报一次匿名心跳（机器码哈希，无任何个人信息）。
//
//  请求体：{ ed: 'local-desktop', v: '1.0.221', mid: '<客户端sha256 hex>' }
//
//  隐私设计：
//    - 客户端先做 sha256（服务端永远见不到原始机器码）
//    - 服务端再哈希一次做 KV key 归一化（防伪造格式注入，长度恒定 64 hex）
//    - 不存 IP、不存手机号、不存任何可识别个人的信息
//    - KV 值仅含：首次见到时间 / 最近心跳时间 / 近30天每日启动次数 / 版本号
//
//  读取方：functions/api/stats/funnel.js（platform_admin 鉴权聚合）
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

// 四端类型白名单（与 stats/funnel.js 聚合口径一致）
const ALLOWED_EDITIONS = ['local-desktop', 'cloud-desktop', 'cloud-app', 'local-app'];

// KV 设备键前缀：tl_dev:{ed}:{midHash}
const TL_DEV_PREFIX = 'tl_dev:';

// 每日启动次数保留天数（修剪防 KV 值膨胀）
const DAYS_KEEP = 30;

function corsHeaders(origin) {
    // ★ 与 admin-status.js 同款：file:// 客户端（Origin: null，如离线APP WebView）放行
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
    return new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });
}

function getClientIP(context) {
    return context.request.headers.get('CF-Connecting-IP') ||
           context.request.headers.get('X-Forwarded-For') ||
           context.request.headers.get('X-Real-IP') ||
           'unknown';
}

// 服务端二次 sha256：key 归一化 + 防注入（无论客户端传什么，输出恒为 64 hex）
async function sha256Hex(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function todayKey(ts) {
    const d = new Date(ts);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

// 修剪 days：仅保留最近 DAYS_KEEP 天（按日期字符串字典序即可，格式统一 yyyy-MM-dd）
function pruneDays(days, now) {
    const cutoff = new Date(now - DAYS_KEEP * 24 * 60 * 60 * 1000);
    const cut = todayKey(cutoff.getTime());
    const out = {};
    for (const k of Object.keys(days || {})) {
        if (k >= cut) out[k] = days[k];
    }
    return out;
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

        // 限流：每 IP 每小时 240 次（多设备诊所正常启动绰绰有余）
        const ip = getClientIP(context);
        const rateLimit = await checkRateLimit(kv, ip + ':tl-hb', 240);
        if (!rateLimit.allowed) {
            return json({ success: false, error: 'Too many requests' }, 429, origin);
        }

        // 解析与校验（全部白名单，防注入）
        let body;
        try {
            body = await context.request.json();
        } catch (e) {
            return json({ success: false, error: 'Invalid JSON' }, 400, origin);
        }
        const ed = String(body.ed || '');
        const v = String(body.v || '');
        const mid = String(body.mid || '');
        if (!ALLOWED_EDITIONS.includes(ed)) {
            return json({ success: false, error: 'Invalid edition' }, 400, origin);
        }
        if (!/^[0-9A-Za-z.\-+ ]{1,40}$/.test(v)) {
            return json({ success: false, error: 'Invalid version' }, 400, origin);
        }
        if (!/^[0-9A-Za-z]{16,128}$/.test(mid)) {
            return json({ success: false, error: 'Invalid mid' }, 400, origin);
        }

        const midHash = await sha256Hex(ed + ':' + mid);
        const key = TL_DEV_PREFIX + ed + ':' + midHash;
        const now = Date.now();
        const today = todayKey(now);

        // 读-改-写（同设备并发心跳竞态可接受，统计用途）
        const prev = (await kv.get(key, 'json').catch(() => null)) || {};
        const days = pruneDays(prev.days, now);
        days[today] = (days[today] || 0) + 1;
        const record = {
            first: prev.first || now,
            last: now,
            days: days,
            v: v
        };
        await kv.put(key, JSON.stringify(record));

        return json({ success: true }, 200, origin);
    } catch (e) {
        return json({ success: false, error: 'Internal error' }, 500, origin);
    }
}
