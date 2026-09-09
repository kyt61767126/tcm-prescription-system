// ============================================================================
//  funnel.js — 下载转化漏斗统计 API（管理后台首页「下载转化统计」数据源）
//
//  路由：GET /api/stats/funnel
//  认证：Bearer token（platform_admin）
//
//  漏斗四层：
//    下载量（GitHub Release 资产 download_count，KV 缓存 1 小时防 API 限流）
//      → 安装启动设备（tl_dev:* 心跳记录，近7/30天活跃）
//      → 提交激活申请（admin_req_index 各状态计数）
//      → 已激活设备（admin_req activated ∪ license 已绑定 devices 的 machineId 并集）
//
//  返回：
//    { success: true,
//      downloads: { desktop, app, total, fetchedAt },
//      installs:  { total, active7, active30, byEdition: { ed: {total, active7, active30} }, new14d: [...] },
//      activation:{ total, pending, activated, rejected, cancelled },
//      activatedMachines: n,
//      trialNotActivated: n,   // 安装设备 - 已激活设备（估算）
//      conversion: { downloadToInstall, installToRequest, installToActivated } }
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from '../_lib/auth.js';
import { getKV, listLicenses } from '../license/_lib/license-core.js';

const GITHUB_REPO_API = 'https://api.github.com/repos/kyt61767126/tcm-prescription-system/releases?per_page=100';
const GH_CACHE_KEY = 'tl_cache:gh_downloads';
const GH_CACHE_TTL = 60 * 60 * 1000; // 1 小时

const TL_DEV_PREFIX = 'tl_dev:';
const EDITIONS = ['local-desktop', 'cloud-desktop', 'cloud-app', 'local-app'];

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': 'https://tcm-prescription-system.pages.dev',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    };
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

// ---------------------------------------------------------------------------
// 下载量：GitHub Release 资产计数（.exe/.apk 分类），KV 缓存 1h
// ---------------------------------------------------------------------------
async function getDownloadCounts(kv) {
    const cached = (await kv.get(GH_CACHE_KEY, 'json').catch(() => null));
    if (cached && cached.fetchedAt && (Date.now() - cached.fetchedAt) < GH_CACHE_TTL) {
        return cached;
    }
    let desktop = 0, app = 0;
    try {
        const res = await fetch(GITHUB_REPO_API, {
            headers: { 'User-Agent': 'tcm-prescription-stats', 'Accept': 'application/vnd.github+json' },
            signal: AbortSignal.timeout(10000)
        });
        if (res.ok) {
            const releases = await res.json();
            for (const rel of releases) {
                for (const a of (rel.assets || [])) {
                    const name = String(a.name || '').toLowerCase();
                    if (name.endsWith('.exe')) desktop += (a.download_count || 0);
                    else if (name.endsWith('.apk')) app += (a.download_count || 0);
                }
            }
        }
    } catch (e) {
        // 网络失败：回退旧缓存（如有），否则返回 0
        if (cached) return cached;
    }
    const out = { desktop, app, total: desktop + app, fetchedAt: Date.now() };
    await kv.put(GH_CACHE_KEY, JSON.stringify(out)).catch(() => null);
    return out;
}

// ---------------------------------------------------------------------------
// 安装设备：枚举 tl_dev:* 聚合（分页 list + 逐条 get）
// ---------------------------------------------------------------------------
async function getInstallStats(kv) {
    const byEdition = {};
    for (const ed of EDITIONS) byEdition[ed] = { total: 0, active7: 0, active30: 0 };
    const new14d = []; // 近14天每日首次见到的新设备
    const now = Date.now();
    const day7 = now - 7 * 24 * 60 * 60 * 1000;
    const day30 = now - 30 * 24 * 60 * 60 * 1000;
    const cut14 = new Date(now - 13 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    let cursor;
    let complete = false;
    while (!complete) {
        const page = await kv.list({ prefix: TL_DEV_PREFIX, cursor }).catch(() => null);
        if (!page || !page.keys || !page.keys.length) break;
        for (const k of page.keys) {
            const rec = await kv.get(k.name, 'json').catch(() => null);
            if (!rec) continue;
            const parts = k.name.substring(TL_DEV_PREFIX.length).split(':');
            const ed = parts[0];
            if (!byEdition[ed]) continue;
            byEdition[ed].total++;
            if (rec.last >= day7) byEdition[ed].active7++;
            if (rec.last >= day30) byEdition[ed].active30++;
            // 首见日期（用于新设备趋势，days 修剪前可能丢早期数据——first 字段恒在）
            const firstDay = new Date(rec.first || 0).toISOString().slice(0, 10);
            if (firstDay >= cut14) {
                const slot = new14d.find(x => x.date === firstDay);
                if (slot) slot.count++; else new14d.push({ date: firstDay, count: 1 });
            }
        }
        cursor = page.cursor;
        complete = page.list_complete;
    }

    new14d.sort((a, b) => a.date < b.date ? -1 : 1);
    let total = 0, active7 = 0, active30 = 0;
    for (const ed of EDITIONS) {
        total += byEdition[ed].total;
        active7 += byEdition[ed].active7;
        active30 += byEdition[ed].active30;
    }
    return { total, active7, active30, byEdition, new14d };
}

// ---------------------------------------------------------------------------
// 激活申请：admin_req_index 各状态计数 + 已激活 machineId 集合
// ---------------------------------------------------------------------------
async function getActivationStats(kv) {
    const index = (await kv.get('admin_req_index', 'json').catch(() => null)) || [];
    const counts = { pending: 0, activated: 0, rejected: 0, cancelled: 0, other: 0 };
    const activatedMachines = new Set();
    for (const requestId of index) {
        const record = await kv.get('admin_req:' + requestId, 'json').catch(() => null);
        if (!record) continue;
        const s = record.status;
        if (s === 'pending' || s === 'pending_approval' || s === 'pending_payment') counts.pending++;
        else if (s === 'activated' || s === 'approved') {
            counts.activated++;
            if (record.machineId) activatedMachines.add(String(record.machineId));
        }
        else if (s === 'rejected') counts.rejected++;
        else if (s === 'cancelled') counts.cancelled++;
        else counts.other++;
    }
    return { counts, activatedMachines };
}

export async function onRequest(context) {
    const method = context.request.method;
    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders() });
    }
    if (method !== 'GET') {
        return json({ success: false, error: 'Method not allowed' }, 405);
    }

    try {
        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        // 鉴权：platform_admin（与 admin-list.js 同款调用）
        const currentUser = await parseAuthHeader(context.request, context.env);
        if (!currentUser || !isPlatformAdmin(currentUser)) {
            return json({ success: false, error: '仅平台总管理员可查看统计数据' }, 403);
        }

        const [downloads, installs, activation] = await Promise.all([
            getDownloadCounts(kv),
            getInstallStats(kv),
            getActivationStats(kv)
        ]);

        // 已激活设备：admin_req(activated) ∪ license 已绑定 devices 的 machineId
        const machines = new Set(activation.activatedMachines);
        try {
            const licenses = await listLicenses(kv);
            for (const lic of licenses) {
                if (Array.isArray(lic.devices)) {
                    for (const d of lic.devices) {
                        if (d && d.machineId) machines.add(String(d.machineId));
                    }
                } else if (lic.machineId) {
                    machines.add(String(lic.machineId));
                }
            }
        } catch (e) {
            // license 读取失败不阻断漏斗主体
        }
        const activatedMachines = machines.size;

        const requestsTotal = activation.counts.pending + activation.counts.activated
            + activation.counts.rejected + activation.counts.cancelled + activation.counts.other;

        const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

        return json({
            success: true,
            downloads,
            installs,
            activation: { total: requestsTotal, ...activation.counts },
            activatedMachines,
            trialNotActivated: Math.max(0, installs.total - activatedMachines),
            conversion: {
                downloadToInstall: pct(installs.total, downloads.total),
                installToRequest: pct(requestsTotal, installs.total),
                installToActivated: pct(activatedMachines, installs.total)
            }
        });
    } catch (e) {
        return json({ success: false, error: 'Internal error: ' + (e.message || e) }, 500);
    }
}
