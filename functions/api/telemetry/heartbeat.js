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
//    - KV 值仅含：首次见到时间 / 最近心跳时间 / 近30天每日活跃标志(0/1) / 版本号
//
//  读取方：functions/api/stats/funnel.js（platform_admin 鉴权聚合）
// ============================================================================

import { getKV } from '../license/_lib/license-core.js';

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

// 每日活跃标志保留天数（修剪防 KV 值膨胀；2026-09-22 起同设备当天重复心跳不累计，仅置 1）
const DAYS_KEEP = 30;

// ★ 2026-09-22 KV 免费套餐配额治理（每日 10万读 / 1000写）：
//   原实现每次启动 = ratelimit get+put + 设备记录 get+put = 4 次 KV 操作，
//   约 500 次启动即打满 1000 写。三档降载（统计端点可容忍粗化，授权安全判断不在此端点）：
//   ① 边缘缓存 caches.default：同设备当天重复心跳在边缘节点直接 200，0 KV 操作；
//   ② KV 当天去重：设备记录 last 已是今天（UTC）→ 不写 KV，仅回填边缘缓存；
//   ③ IP 限流计数器抽样持久化（每 SAMPLE_N 个放行请求写 1 次），阈值粗化到约 1.2 倍，
//      心跳限流目的只是压刷量，非安全门（validate/claim-free 仍用 license-core 精确限流）。
const SAMPLE_N = 5;
const edgeCache = (typeof caches !== 'undefined' && caches.default) ? caches.default : null;

function hbCacheKey(ed, midHash, today) {
    return new Request('https://hb-internal.local/' + ed + '/' + midHash + '/' + today, { method: 'GET' });
}

// 距 UTC 次日 00:00 的秒数（边缘缓存活到当日结束，自然跨天失效）
function secondsToUTCDayEnd(now) {
    return Math.max(60, Math.floor((Math.floor(now / 86400000) + 1) * 86400000 - now) / 1000);
}

async function markSeenToday(ed, midHash, today, ttlSec) {
    if (!edgeCache) return;
    try {
        await edgeCache.put(
            hbCacheKey(ed, midHash, today),
            new Response('1', { headers: { 'Cache-Control': 'public, max-age=' + ttlSec } })
        );
    } catch (e) { /* 边缘缓存不可用不阻断主链路 */ }
}

// 抽样持久化的 IP 小时窗口限流（仅用于心跳统计端点）
async function sampledIpRateLimit(kv, ip, maxPerHour) {
    const hour = Math.floor(Date.now() / (60 * 60 * 1000));
    const key = `ratelimit:license:${ip}:tl-hb:${hour}`;
    let current = 0;
    try { current = parseInt((await kv.get(key)) || '0', 10) || 0; } catch (e) { /* KV 读失败 fail-open */ }
    if (current >= maxPerHour) return { allowed: false, current: current, max: maxPerHour };
    const next = current + 1;
    // 纯抽样持久化（每 SAMPLE_N 个放行请求写 1 次）：不设"窗口首请求必写锚点"——
    // 整点翻窗并发突发时各请求都读到 0，锚点条件会触发 N 次重复写（写配额杀手）。
    // 代价仅为窗口前 SAMPLE_N-1 个请求无计数（本就全部放行），阈值粗化可接受。
    if (next % SAMPLE_N === 0) {
        try { await kv.put(key, String(next), { expirationTtl: 3600 }); } catch (e) { /* 写失败 fail-open */ }
    }
    return { allowed: true, current: next, max: maxPerHour };
}

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

        // 限流已下沉到「当日首次心跳」分支（sampledIpRateLimit），
        // 边缘缓存/KV 当天去重命中的重复心跳不消耗任何 KV 操作。
        const ip = getClientIP(context);

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
        const ttlSec = secondsToUTCDayEnd(now);

        // ① 边缘缓存命中：该设备今日已在本边缘节点见过 → 0 KV 操作直接返回
        if (edgeCache) {
            try {
                const hit = await edgeCache.match(hbCacheKey(ed, midHash, today));
                if (hit) return json({ success: true, cached: true }, 200, origin);
            } catch (e) { /* 缓存查询异常降级走 KV */ }
        }

        // 读-改-写（同设备并发心跳竞态可接受，统计用途）
        const prev = (await kv.get(key, 'json').catch(() => null)) || {};

        // ② KV 当天去重：设备记录已是今天 → 仅回填边缘缓存，不产生写操作
        if (prev.last && todayKey(prev.last) === today) {
            await markSeenToday(ed, midHash, today, ttlSec);
            return json({ success: true, deduped: true }, 200, origin);
        }

        // 当日首次心跳才做 IP 限流（抽样持久化）+ 设备记录写入
        const rateLimit = await sampledIpRateLimit(kv, ip, 240);
        if (!rateLimit.allowed) {
            return json({ success: false, error: 'Too many requests' }, 429, origin);
        }

        const days = pruneDays(prev.days, now);
        days[today] = (days[today] || 0) + 1;
        const record = {
            first: prev.first || now,
            last: now,
            days: days,
            v: v
        };
        // TTL 35 天：与 DAYS_KEEP=30 匹配，过期设备（含随机 mid 刷量垃圾键）自动回收，
        // 不依赖 funnel 清理；first/new14d 等指标窗口均 ≤30 天，到期无统计损失
        await kv.put(key, JSON.stringify(record), { expirationTtl: 35 * 24 * 3600 });
        await markSeenToday(ed, midHash, today, ttlSec);

        return json({ success: true }, 200, origin);
    } catch (e) {
        return json({ success: false, error: 'Internal error' }, 500, origin);
    }
}
