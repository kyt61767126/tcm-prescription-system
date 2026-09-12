// ============================================================================
//  admin-risk.js — 心跳/验证日志集中风控分析 API（P2-1）
//
//  路由：POST /api/license/admin-risk
//
//  认证：Bearer token（platform_admin）
//
//  请求体：
//    { "action": "scan" }   → 扫描全部激活码 + 完整性标记，返回风控告警列表
//
// 识别的盗版特征（宁可漏检不可误报）：
//    1. multi_ip_concurrent（高）——同一激活码近 30 天 ≥2 个网络（IPv6 按 /48 前缀
//       归并），ABAB 往复切换且 ≥2 次落在 24h 窗口内、授权支持多设备（一码多卖的
//       典型特征；单设备授权/一次性换网/手机 WiFi↔蜂窝双栈切换不误报）
//    2. multi_ip_30d（中）——近 30 天 ≥2 个网络但无往复并发（合法换网/换机，仅提示）
//    3. offline_90d（中）——已激活且未过期，但距最后心跳/激活时间超 90 天无联网
//       （"激活即离线 90 天"，疑似破解后永久断网使用）
//    4. count_tamper（高）——近 30 天出现 count_rollback 日志（本地处方计数清零，
//       P2-3 计数上链对账发现，疑似绕过月度配额）
//    5. integrity（高）——integrity_flag:{machineId} 存在（客户端 native/Java 双路
//       签名校验分叉，疑似 hook/篡改，P1-1 遗留的设备级标记）
//
//  过滤规则（2026-09-12 IPv6 误报根治）：
//    - 已过期激活码整体跳过（服务已停无风控价值；expiresAt 为空按 issuedAt+days 推导）
//    - IP 时间线仅统计客户设备流量，管理端动作（generate/extend/update 等）的
//      管理员 IP 不参与多 IP 判定
//    - IPv6 地址按 /48 前缀归并（运营商分配单宽带的典型粒度），避免"IPv6 时代
//      每设备独立地址"造成海量误报
//
//  数据源（全部已有，无新增采集）：
//    - license:{code}        激活码记录（lastHeartbeat/activatedAt/status/devices）
//    - license_log:{code}    操作日志（action/time/ip，heartbeat/validate 等均带 IP）
//    - usage:{code}          P2-3 计数上链记录（lastReport/rollbackEvents）
//    - integrity_flag:{mid}  P1-1 完整性异常标记（90 天 TTL）
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from '../_lib/auth.js';
import {
    getKV, listLicenses, getUsage
} from './_lib/license-core.js';

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': 'https://tcm-prescription-system.pages.dev',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    };
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

const SCAN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;   // 日志观察窗口：30 天
const CONCURRENT_MS = 24 * 60 * 60 * 1000;          // 并发判定窗口：24 小时内跨 IP
const OFFLINE_DAYS_MS = 90 * 24 * 60 * 60 * 1000;   // 长期离线阈值：90 天

const TYPE_LABEL = {
    multi_ip_concurrent: '多 IP 并发使用',
    multi_ip_30d: '多 IP 使用（无并发）',
    offline_90d: '激活后长期离线',
    count_tamper: '处方计数回拨',
    integrity: '客户端完整性异常'
};

// 管理端/服务端动作：其 IP 来自管理员浏览器或服务端自愈，非客户设备流量，
// 不参与多 IP 判定（否则每个"办公室生成+家中激活"的码都会误报中危）
const ADMIN_ACTIONS = new Set([
    'generate', 'scan', 'extend', 'update', 'restore',
    'invite-reward', 'invite-reward-denied', 'resign-v7-selfheal'
]);

// --- 判定纯函数（export 供单测；Pages Functions 的额外命名导出不影响路由） ---

// IPv6 按 /48 前缀归并（前 3 组），IPv4 原样；支持 :: 压缩 / %zone / v4 映射形式
export function networkKey(ip) {
    let s = String(ip || '').trim().toLowerCase().split('%')[0];
    if (!s) return '';
    const v4 = s.match(/^(?:::ffff:)?((?:\d{1,3}\.){3}\d{1,3})$/);
    if (v4) return v4[1];
    if (!s.includes(':')) return s;
    try {
        const halves = s.split('::');
        if (halves.length > 2) return s;
        const head = halves[0] ? halves[0].split(':').filter(Boolean) : [];
        const tail = (halves.length === 2 && halves[1]) ? halves[1].split(':').filter(Boolean) : [];
        const fill = Math.max(0, 8 - head.length - tail.length);
        const groups = [...head, ...new Array(fill).fill('0'), ...tail];
        return groups.slice(0, 3).join(':') + '::/48';
    } catch (e) { return s; }
}

// 有效到期时间：expiresAt 优先，为空时按 issuedAt+days 推导，均无则视为未过期
export function effectiveExpiryMs(record) {
    const r = record || {};
    if (r.expiresAt) {
        const t = new Date(r.expiresAt).getTime();
        if (!isNaN(t)) return t;
    }
    if (r.issuedAt && r.days) {
        const t = new Date(r.issuedAt).getTime() + Number(r.days) * 86400000;
        if (!isNaN(t)) return t;
    }
    return Infinity;
}

// 多网络使用判定（entries 已按时间升序、含 {ip,t}）：
//   高危 = ABAB 往复（某网络 ≥2 个会话块）∧ ≥2 次相邻会话切换间隔 <24h ∧ 授权支持多设备
//   其余多网络情形一律中危（单次换网/双栈切换/单设备授权跨网，仅供参考）
export function classifyMultiIp(entries, multiDeviceCapable) {
    const nets = entries.map(e => networkKey(e.ip));
    const distinct = [...new Set(nets)];
    if (distinct.length < 2) return null;

    // 压缩连续同网络为会话块，统计每网络会话数与相邻会话切换间隔
    const sessions = [];
    for (let i = 0; i < entries.length; i++) {
        const last = sessions[sessions.length - 1];
        if (!last || last.net !== nets[i]) {
            sessions.push({ net: nets[i], start: entries[i].t, end: entries[i].t });
        } else if (entries[i].t > last.end) {
            last.end = entries[i].t;
        }
    }
    const sessionCount = {};
    for (const s of sessions) sessionCount[s.net] = (sessionCount[s.net] || 0) + 1;
    const abab = Object.values(sessionCount).some(n => n >= 2);
    let fastSwitches = 0;
    for (let i = 1; i < sessions.length; i++) {
        if (sessions[i].start - sessions[i - 1].end < CONCURRENT_MS) fastSwitches++;
    }

    const firstSeen = entries.length ? new Date(entries[0].t).toISOString() : null;
    const lastSeen = entries.length ? new Date(entries[entries.length - 1].t).toISOString() : null;
    const rawIps = [...new Set(entries.map(e => e.ip))];

    if (abab && fastSwitches >= 2 && multiDeviceCapable) {
        return {
            severity: 'high', nets: distinct, rawIps: rawIps, firstSeen: firstSeen, lastSeen: lastSeen,
            detail: '近30天 ' + distinct.length + ' 个网络（IPv6 已按 /48 归并），24 小时内跨网络往复使用（ABAB），一码多卖典型特征'
        };
    }
    const reason = abab
        ? '存在网络往复但切换间隔较久或授权仅单设备（可能为换网/双栈切换，仅供参考）'
        : '单次网络切换（可能为换网/换机，仅供参考）';
    return {
        severity: 'medium', nets: distinct, rawIps: rawIps, firstSeen: firstSeen, lastSeen: lastSeen,
        detail: '近30天 ' + distinct.length + ' 个网络（IPv6 已按 /48 归并，' + reason + '）'
    };
}

export async function onRequest(context) {
    const method = context.request.method;

    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders() });
    }

    if (method !== 'POST') {
        return json({ success: false, error: 'Method not allowed' }, 405);
    }

    try {
        const currentUser = await parseAuthHeader(context.request, context.env);
        if (!currentUser || !isPlatformAdmin(currentUser)) {
            return json({ success: false, error: '仅平台总管理员可查看风控告警' }, 403);
        }

        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        const body = await context.request.json().catch(() => ({}));
        if (body.action !== 'scan') {
            return json({ success: false, error: 'action 必须是 scan' }, 400);
        }

        const now = Date.now();
        const alerts = [];
        const stats = {
            licenses: 0,
            multiIpConcurrent: 0,
            multiIp30d: 0,
            offline90d: 0,
            countTamper: 0,
            integrityFlags: 0
        };

        // ---------- 第 1 步：逐激活码分析日志 ----------
        const records = await listLicenses(kv);
        stats.licenses = records.length;

        for (const record of records) {
            const code = record.code;
            if (!code) continue;

            // --- 已过期激活码整体跳过（服务已停无风控价值，避免历史告警噪音） ---
            if (effectiveExpiryMs(record) <= now) continue;

            let logs = [];
            try {
                logs = (await kv.get('license_log:' + code, 'json')) || [];
            } catch (e) { /* 单码日志读取失败不影响整体扫描 */ }

            // 近 30 天、带有效 IP 与时间的客户设备日志条目（排除管理端动作）
            const entries = [];
            for (const l of logs) {
                const t = l && l.time ? Date.parse(l.time) : NaN;
                if (isNaN(t) || now - t > SCAN_WINDOW_MS || now - t < -24 * 60 * 60 * 1000) continue;
                if (l.ip && l.ip !== 'unknown' && !ADMIN_ACTIONS.has(l.action)) {
                    entries.push({ ip: l.ip, t: t, action: l.action || '' });
                }
            }
            entries.sort((a, b) => a.t - b.t);

            const base = {
                code: code,
                clinicName: record.clinicName || null,
                user: record.user || record.username || null,
                type: record.type || null,
                status: record.status || null,
                expiresAt: record.expiresAt || null,
                lastHeartbeat: record.lastHeartbeat || null,
                activatedAt: record.activatedAt || null
            };

            let hasAlert = false;

            // --- 特征 1/2：多网络使用（IPv6 按 /48 归并；高危及中危判定见 classifyMultiIp） ---
            // 多设备能力：授权支持多设备（maxDevices≥2 或真实设备≥2，浏览器会话伪设备不算）
            const realDevices = (record.devices || []).filter(d =>
                d && d.machineId && !String(d.machineId).startsWith('browser-'));
            const multiCapable = ((record.maxDevices || 0) >= 2) || (realDevices.length >= 2);
            const cls = classifyMultiIp(entries, multiCapable);
            if (cls) {
                hasAlert = true;
                if (cls.severity === 'high') {
                    stats.multiIpConcurrent++;
                } else {
                    stats.multiIp30d++;
                }
                alerts.push({
                    ...base,
                    type: cls.severity === 'high' ? 'multi_ip_concurrent' : 'multi_ip_30d',
                    typeLabel: cls.severity === 'high' ? TYPE_LABEL.multi_ip_concurrent : TYPE_LABEL.multi_ip_30d,
                    severity: cls.severity,
                    ips: cls.nets,
                    ipsRaw: cls.rawIps,
                    firstSeen: cls.firstSeen,
                    lastSeen: cls.lastSeen,
                    detail: cls.detail
                });
            }

            // --- 特征 3：激活后长期离线（限定有效状态，过期/禁用码离线属正常） ---
            if (record.status === 'used' && record.activatedAt) {
                const notExpired = !record.expiresAt || new Date(record.expiresAt).getTime() > now;
                const anchor = record.lastHeartbeat
                    ? new Date(record.lastHeartbeat).getTime()
                    : new Date(record.activatedAt).getTime();
                if (notExpired && !isNaN(anchor) && now - anchor > OFFLINE_DAYS_MS) {
                    const days = Math.floor((now - anchor) / (24 * 60 * 60 * 1000));
                    stats.offline90d++;
                    hasAlert = true;
                    alerts.push({
                        ...base,
                        type: 'offline_90d',
                        typeLabel: TYPE_LABEL.offline_90d,
                        severity: 'medium',
                        ips: [],
                        lastSeen: record.lastHeartbeat || record.activatedAt,
                        detail: '已激活但已 ' + days + ' 天无心跳（' +
                            (record.lastHeartbeat ? '最后心跳' : '激活后从未心跳') + '）'
                    });
                }
            }

            // --- 特征 4：处方计数回拨（P2-3 对账结果） ---
            const rollbacks = logs.filter(l =>
                l && l.action === 'count_rollback' &&
                !isNaN(Date.parse(l.time)) && now - Date.parse(l.time) < SCAN_WINDOW_MS
            );
            if (rollbacks.length > 0) {
                stats.countTamper++;
                hasAlert = true;
                alerts.push({
                    ...base,
                    type: 'count_tamper',
                    typeLabel: TYPE_LABEL.count_tamper,
                    severity: 'high',
                    ips: [...new Set(rollbacks.map(l => l.ip).filter(Boolean))],
                    lastSeen: rollbacks.length ? rollbacks[rollbacks.length - 1].time : null,
                    detail: '近30天 ' + rollbacks.length + ' 次计数回拨（最近：' +
                        (rollbacks[rollbacks.length - 1].detail || '无详情') + '）'
                });
            }

            // --- 计数上链记录（附在告警详情；无告警的码不额外读 usage，省 KV 读） ---
            if (hasAlert) {
                try {
                    const usage = await getUsage(kv, code);
                    if (usage) {
                        const last = usage.lastReport || {};
                        alerts[alerts.length - 1].usage = {
                            rollbackEvents: usage.rollbackEvents || 0,
                            lastCount: (last.count !== undefined) ? last.count : null,
                            lastMonth: last.month || null,
                            lastTime: last.time || null,
                            lastSource: last.source || null
                        };
                    }
                } catch (e) { /* usage 读取失败不影响告警 */ }
            }
        }

        // ---------- 第 2 步：客户端完整性异常标记（P1-1 设备级） ----------
        try {
            const flagList = await kv.list({ prefix: 'integrity_flag:', limit: 200 });
            for (const k of flagList.keys) {
                const flag = await kv.get(k.name, 'json');
                if (!flag) continue;
                stats.integrityFlags++;
                alerts.push({
                    type: 'integrity',
                    typeLabel: TYPE_LABEL.integrity,
                    severity: 'high',
                    code: null,
                    machineId: flag.machineId || k.name.substring('integrity_flag:'.length),
                    clinicName: null,
                    user: flag.user || null,
                    status: null,
                    ips: flag.lastIp ? [flag.lastIp] : [],
                    lastSeen: flag.lastSeen || null,
                    detail: '完整性状态 ' + (flag.stateLabel || flag.state) + '，累计 ' +
                        (flag.count || 1) + ' 次（native/Java 双路校验分叉，疑似 hook）'
                });
            }
        } catch (e) {
            console.warn('[admin-risk] integrity_flag 扫描失败:', e.message);
        }

        // 高危在前，同级别按最近时间倒序
        const sevRank = { high: 0, medium: 1, low: 2 };
        alerts.sort((a, b) => {
            const r = (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9);
            if (r !== 0) return r;
            return (Date.parse(b.lastSeen) || 0) - (Date.parse(a.lastSeen) || 0);
        });

        return json({
            success: true,
            action: 'scan',
            scannedAt: new Date(now).toISOString(),
            stats: stats,
            count: alerts.length,
            alerts: alerts
        });

    } catch (e) {
        console.error('[admin-risk] error:', e);
        return json({ success: false, error: e.message || '服务器内部错误' }, 500);
    }
}
