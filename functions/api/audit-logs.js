// ============================================================================
//  audit-logs.js — 审计日志查询端点（P2-C 审计日志可视化 + P2-D 用户操作历史）
//
//  背景：users.js / prescriptions.js 的 writeAuditLog 已把操作审计按
//        `audit_log:{clinicId|platform}:{YYYY-MM-DD}` 写入 KV（每键最多 1000 条，
//        TTL 90 天），但一直缺少读取入口，管理员无法回溯"谁在什么时候做了什么"。
//
//  能力：
//    GET /api/audit-logs?dateFrom=&dateTo=&clinicId=&username=&action=&limit=
//      - clinicId=all      → 扫描全部 audit_log:* 键中日期命中的分片
//      - clinicId=platform → 仅平台级操作（登录/重置管理员/解锁等）
//      - clinicId=<id>     → 仅指定诊所
//      - username          → 用户操作历史查询（P2-D，不区分大小写包含匹配）
//      - action            → 动作类型过滤（不区分大小写包含匹配）
//      - dateFrom/dateTo   → 日期范围，跨度上限 31 天，默认当天
//    返回按 timestamp 降序（最新在前），limit 默认 500、上限 2000
//
//  权限：仅 platform_admin（parseAuthHeader + isPlatformAdmin）
//
//  设计约束（宁漏检不可误报）：
//    - 读取失败的单个键静默跳过（.catch(null)），不影响其余结果
//    - 分批并发读（每批 20 键），避免一次性打满 Workers 子请求上限
//    - userAgent 截断 120 字符，防止超长 UA 撑爆响应体
// ============================================================================

import { getKV, listAllKeys } from './_lib/kv.js';
import { getDB, isD1Enabled } from './_lib/d1.js';
import { parseAuthHeader, isPlatformAdmin } from './_lib/auth.js';

// CORS（与 users.js 保持一致的白名单策略）
function getAllowedOrigins() {
    return [
        'https://tcm-prescription-system.pages.dev',
        'https://hjkangtcm.pages.dev',
        'http://localhost:3000',
        'http://localhost:8080',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:8080'
    ];
}

function corsHeaders(request) {
    const origin = request?.headers?.get('Origin') || '';
    if (!origin) {
        return {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
            'Access-Control-Max-Age': '86400',
            'Content-Type': 'application/json'
        };
    }
    const allowed = getAllowedOrigins();
    const isPagesDev = origin.endsWith('.pages.dev') && origin.startsWith('https://');
    const allowedOrigin = (allowed.includes(origin) || isPagesDev) ? origin : 'null';
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
        'Content-Type': 'application/json'
    };
}

function json(data, status = 200, request = null) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders(request) });
}

// 日期参数规范化：仅接受 YYYY-MM-DD，非法/缺失返回 null
function sanitizeDate(v) {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    return v;
}

// 枚举闭区间日期串数组（UTC，与 writeAuditLog 的 toISOString 分片口径一致）
function enumerateDates(from, to) {
    const out = [];
    const start = Date.parse(from + 'T00:00:00Z');
    const end = Date.parse(to + 'T00:00:00Z');
    for (let t = start; t <= end && out.length < 366; t += 86400000) {
        out.push(new Date(t).toISOString().split('T')[0]);
    }
    return out;
}

// 条目规范化：核心字段 + 其余并入 extra，UA 截断
function normalizeEntry(e, clinicId) {
    const core = {
        timestamp: e.timestamp || '',
        username: e.username || 'unknown',
        role: e.role || 'unknown',
        action: e.action || 'unknown',
        target: e.target || '',
        ip: e.ip || 'unknown',
        userAgent: (e.userAgent || 'unknown').slice(0, 120)
    };
    const extra = {};
    for (const k of Object.keys(e)) {
        if (k in core) continue;
        extra[k] = e[k];
    }
    return { clinicId, ...core, extra };
}

export async function onRequest(context) {
    const { request } = context;

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (request.method !== 'GET') {
        return json({ success: false, error: 'Method Not Allowed' }, 405, request);
    }

    // ===== 权限门禁：仅平台总管理员 =====
    const authUser = await parseAuthHeader(request, context.env);
    if (!authUser || !isPlatformAdmin(authUser)) {
        return json({ success: false, error: '仅平台总管理员可查询审计日志' }, 403, request);
    }

    const kv = getKV(context);
    if (!kv) {
        return json({ success: false, error: 'KV 存储未绑定（请检查 Pages 的 KV 绑定配置）' }, 500, request);
    }

    // ===== 参数解析与校验 =====
    const url = new URL(request.url);
    const today = new Date().toISOString().split('T')[0];
    const dateFrom = sanitizeDate(url.searchParams.get('dateFrom')) || today;
    const dateTo = sanitizeDate(url.searchParams.get('dateTo')) || dateFrom;
    const clinicId = (url.searchParams.get('clinicId') || 'all').trim() || 'all';
    const username = (url.searchParams.get('username') || '').trim().toLowerCase();
    const action = (url.searchParams.get('action') || '').trim().toLowerCase();
    const limitRaw = parseInt(url.searchParams.get('limit') || '500', 10);
    const limit = Math.min(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 500, 2000);

    if (dateTo < dateFrom) {
        return json({ success: false, error: '结束日期不能早于开始日期' }, 400, request);
    }
    const days = Math.round((Date.parse(dateTo + 'T00:00:00Z') - Date.parse(dateFrom + 'T00:00:00Z')) / 86400000) + 1;
    if (days > 31) {
        return json({ success: false, error: '日期跨度不能超过 31 天（审计日志保留 90 天，请分段查询）' }, 400, request);
    }

    // ★ P1：D1 优先读取（USE_D1=true 时走 SQL 查询，性能远优于 KV 全量扫描）
    const db = getDB(context.env);
    if (isD1Enabled(context.env) && db) {
        try {
            const conditions = ['created_at >= ? AND created_at <= ?'];
            const params = [dateFrom + 'T00:00:00.000Z', dateTo + 'T23:59:59.999Z'];
            if (clinicId !== 'all') {
                conditions.push('clinic_id = ?');
                params.push(clinicId);
            }
            if (username) {
                conditions.push('LOWER(username) LIKE ?');
                params.push('%' + username + '%');
            }
            if (action) {
                conditions.push('LOWER(action) LIKE ?');
                params.push('%' + action + '%');
            }
            const sql = `SELECT * FROM audit_logs WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ?`;
            params.push(limit);
            const result = await db.prepare(sql).bind(...params).all();
            const logs = (result?.results || []).map(row => normalizeEntry({
                timestamp: row.created_at,
                username: row.username,
                role: row.role,
                action: row.action,
                target: row.target,
                ip: row.ip,
                userAgent: row.user_agent,
                ...(row.extra ? JSON.parse(row.extra) : {})
            }, row.clinic_id));
            return json({
                success: true,
                dateFrom, dateTo, clinicId,
                source: 'd1',
                total: logs.length,
                shown: logs.length,
                logs
            }, 200, request);
        } catch (e) {
            console.error('[audit-logs] D1 query failed, fallback to KV:', e.message);
            // 回退到 KV
        }
    }

    // ===== 构造目标键集合 =====
    const dates = enumerateDates(dateFrom, dateTo);
    const dateSet = new Set(dates);
    // ★ 2026-09-10 并发加固：审计日志改为独立记录 key 后，旧「按日数组 key」与新「单条 key」
    //   两种格式并存，这里统一前缀扫描 + 按日期命中过滤。
    //   key 格式：
    //     audit_log:{cid}:{YYYY-MM-DD}              → 旧数组 key（parts 长度 3）
    //     audit_log:{cid}:{YYYY-MM-DD}:{ts}-{rand}   → 新单条 key（parts 长度 4）
    const prefix = clinicId === 'all' ? 'audit_log:' : `audit_log:${clinicId}:`;
    const allKeys = await listAllKeys(kv, prefix);
    const keys = allKeys.filter(k => {
        const parts = k.split(':');
        return parts.length >= 3 && dateSet.has(parts[2]);
    });

    // ===== 分批并发读取（每批 20 键）=====
    const logs = [];
    for (let i = 0; i < keys.length; i += 20) {
        const batch = keys.slice(i, i + 20);
        const results = await Promise.all(batch.map(k => kv.get(k, 'json').catch(() => null)));
        results.forEach((val, idx) => {
            const parts = batch[idx].split(':');
            const cid = parts[1] || 'platform';
            if (Array.isArray(val)) {
                // 旧数组格式：逐条摊平
                for (const e of val) {
                    if (e && typeof e === 'object') logs.push(normalizeEntry(e, cid));
                }
            } else if (val && typeof val === 'object') {
                // 新单条格式
                logs.push(normalizeEntry(val, cid));
            }
            // 单键缺失/损坏（val 为 null / 非对象）静默跳过
        });
    }

    // ===== 内存过滤 + 降序排序 + 截断 =====
    let filtered = logs;
    if (username) {
        filtered = filtered.filter(e => (e.username || '').toLowerCase().includes(username));
    }
    if (action) {
        filtered = filtered.filter(e => (e.action || '').toLowerCase().includes(action));
    }
    filtered.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

    return json({
        success: true,
        dateFrom,
        dateTo,
        clinicId,
        scannedKeys: keys.length,
        total: filtered.length,
        shown: Math.min(filtered.length, limit),
        logs: filtered.slice(0, limit)
    }, 200, request);
}
