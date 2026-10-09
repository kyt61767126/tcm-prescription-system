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
//      downloads: { available, desktop, app, total, fetchedAt, stale? },  // GitHub Release 计数
//      siteDownloads: { available, desktop, app, total, trackedSince },   // ★P1 官网实际下载（D1 去重·估算）
//      installs:  { total, active7, active30, byEdition: { ed: {total, active7, active30} }, new14d: [...] },
//      activation:{ total, pending, activated, rejected, cancelled },
//      activatedMachines: n,
//      trialNotActivated: n,      // ★P2 心跳机器码集合 − 四端盐展开的激活机器码集合（估算）
//      trialCoverage: { withMid, missing },  // 老心跳记录缺 mid 的条数（35 天 TTL 内逐步补齐）
//      conversion: { downloadToInstall, installToRequest, installToActivated } }
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from '../_lib/auth.js';
import { getKV, listLicenses } from '../license/_lib/license-core.js';
import { getDB } from '../_lib/d1.js';

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
//   ★ 2026-09-28 P0 修复"0 故障"：
//     ① HTTP 非 2xx（403 限流等）/网络异常/返回非数组 → 一律视为抓取失败，
//       绝不把 0 当成功值写缓存（旧实现 403 不进 catch，0 被毒化缓存 1h）；
//     ② 失败时有旧值（哪怕已过期）沿用旧值并标 stale，从未成功过 → available:false；
//     ③ 配置 env.GITHUB_TOKEN（CF Pages secret）后带鉴权，限额 60/h → 5000/h。
// ---------------------------------------------------------------------------
async function getDownloadCounts(kv, env) {
    const cached = (await kv.get(GH_CACHE_KEY, 'json').catch(() => null));
    const cacheValid = cached && cached.fetchedAt && cached.total > 0;
    if (cacheValid && (Date.now() - cached.fetchedAt) < GH_CACHE_TTL) {
        return Object.assign({ available: true }, cached);
    }
    let desktop = 0, app = 0, fetched = false;
    try {
        const headers = { 'User-Agent': 'tcm-prescription-stats', 'Accept': 'application/vnd.github+json' };
        const token = env && env.GITHUB_TOKEN ? String(env.GITHUB_TOKEN).trim() : '';
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const res = await fetch(GITHUB_REPO_API, {
            headers,
            signal: AbortSignal.timeout(10000)
        });
        if (res.ok) {
            const releases = await res.json();
            if (Array.isArray(releases)) {
                for (const rel of releases) {
                    for (const a of (rel.assets || [])) {
                        const name = String(a.name || '').toLowerCase();
                        if (name.endsWith('.exe')) desktop += (a.download_count || 0);
                        else if (name.endsWith('.apk')) app += (a.download_count || 0);
                    }
                }
                fetched = true;
            }
        } else {
            console.warn('[funnel] GitHub API HTTP ' + res.status
                + (token ? '' : '（未配置 GITHUB_TOKEN，未鉴权限额仅 60/h）'));
        }
    } catch (e) {
        console.warn('[funnel] GitHub 获取失败，沿用旧缓存: ' + (e && e.message));
    }
    if (!fetched) {
        // 失败不写缓存：有旧值（含过期）沿用，从未成功过（或旧缓存是 0 毒值）→ 暂不可用
        if (cacheValid) return Object.assign({ available: true }, cached, { stale: true });
        return { available: false, desktop: 0, app: 0, total: 0, fetchedAt: cached && cached.fetchedAt ? cached.fetchedAt : 0 };
    }
    const out = { available: true, desktop, app, total: desktop + app, fetchedAt: Date.now() };
    await kv.put(GH_CACHE_KEY, JSON.stringify(out)).catch(() => null);
    return out;
}

// ---------------------------------------------------------------------------
// 官网实际下载量：D1 download_uniq 聚合（2026-09-28 P1 起积累）
//   口径：按 IP+文件+自然日去重的下载发起次数（估算），.exe=桌面 / .apk=APP
// ---------------------------------------------------------------------------
async function getSiteDownloadStats(env) {
    const empty = { available: false, desktop: 0, app: 0, total: 0, trackedSince: null };
    const db = getDB(env);
    if (!db) return empty;
    try {
        const result = await db.prepare(
            'SELECT file, COUNT(*) AS c FROM download_uniq GROUP BY file'
        ).all();
        let desktop = 0, app = 0;
        for (const r of result.results || []) {
            const name = String(r.file || '').toLowerCase();
            if (name.endsWith('.exe')) desktop += r.c;
            else if (name.endsWith('.apk')) app += r.c;
        }
        const minRow = await db.prepare('SELECT MIN(day) AS d FROM download_uniq').first();
        return { available: true, desktop, app, total: desktop + app, trackedSince: (minRow && minRow.d) || null };
    } catch (e) {
        // 表刚建/部署窗口期查询失败：标记不可用，不阻断漏斗其余指标
        console.warn('[funnel] 官网下载计数读取失败: ' + (e && e.message));
        return empty;
    }
}

// 北京时间（UTC+8）日期切片：趋势图按国内用户时区归日（旧实现按 UTC 切，晚 8 点后偏差一天）
function beijingDay(ts) {
    return new Date(ts + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// 与客户端/心跳端同款 sha256 hex（客户端 mid = sha256(ed + ':' + 原始机器码)）
async function sha256Hex(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// 安装设备：枚举 tl_dev:* 聚合（分页 list + 逐条 get）
// ---------------------------------------------------------------------------
async function getInstallStats(kv) {
    const byEdition = {};
    for (const ed of EDITIONS) byEdition[ed] = { total: 0, active7: 0, active30: 0 };
    const new14d = []; // 近14天每日首次见到的新设备（北京时间归日）
    const midSet = new Set(); // 心跳记录中的客户端加盐 mid（机器码集合差用）
    let midMissing = 0;       // 老记录无 mid 字段（2026-09-28 前写入），无法参与集合差
    const now = Date.now();
    const day7 = now - 7 * 24 * 60 * 60 * 1000;
    const day30 = now - 30 * 24 * 60 * 60 * 1000;
    const cut14 = beijingDay(now - 13 * 24 * 60 * 60 * 1000);

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
            // 首见日期（北京时间归日；days 修剪前可能丢早期数据——first 字段恒在）
            const firstDay = beijingDay(rec.first || 0);
            if (firstDay >= cut14) {
                const slot = new14d.find(x => x.date === firstDay);
                if (slot) slot.count++; else new14d.push({ date: firstDay, count: 1 });
            }
            if (typeof rec.mid === 'string' && rec.mid) midSet.add(rec.mid);
            else midMissing++;
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
    return { total, active7, active30, byEdition, new14d, midSet, midMissing };
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

// ★ 2026-10-10 短时结果缓存（默认 300s；运维开关 config:admin-heavy-cache {"mode":"off"}）
//   转化漏斗统计含 trial_dev 全前缀 list，看板轮询会持续吃 list 配额；缓存键绑定调用方
//   凭证哈希 → 跨权限不共享；只缓存 2xx。
import { withAdminResponseCache } from '../../_lib/admin-cache.js';

export async function onRequest(context) {
    return withAdminResponseCache(
        context.env && context.env.KV,
        'stats-funnel',
        context.request,
        (context.request.headers.get('Authorization') || ''),
        () => onRequestInner(context)
    );
}

async function onRequestInner(context) {
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

        const [downloads, installsRaw, activation, siteDownloads] = await Promise.all([
            getDownloadCounts(kv, context.env),
            getInstallStats(kv),
            getActivationStats(kv),
            getSiteDownloadStats(context.env)
        ]);
        // midSet 仅服务端集合差用，不随 JSON 输出（Set 会序列化成空对象）
        const { midSet, midMissing, ...installs } = installsRaw;

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

        // ★ 2026-09-28 P2 机器码集合差：心跳 mid=sha256(ed+':'+原始机器码)，
        //   授权库存原始机器码 → 展开四端盐后与心跳 mid 集合比对。
        //   同机装多端（mid 因端盐不同有多条）只要任一端激活即正确排除；
        //   旧口径 installs.total - activatedMachines 会把多端安装重复计数，已废弃。
        const activatedSalted = new Set();
        for (const m of machines) {
            for (const ed of EDITIONS) activatedSalted.add(await sha256Hex(ed + ':' + m));
        }
        let trialNotActivated = 0;
        for (const mid of midSet) {
            if (!activatedSalted.has(mid)) trialNotActivated++;
        }

        const requestsTotal = activation.counts.pending + activation.counts.activated
            + activation.counts.rejected + activation.counts.cancelled + activation.counts.other;

        const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

        return json({
            success: true,
            downloads,
            siteDownloads,
            installs,
            activation: { total: requestsTotal, ...activation.counts },
            activatedMachines,
            // 估算口径：机器码集合差；老心跳记录 35 天 TTL 内缺 mid（missing），随心跳逐步补齐
            trialNotActivated,
            trialCoverage: { withMid: midSet.size, missing: midMissing },
            conversion: {
                // GitHub 下载量不可用时该转化率无分母 → null（前端显示"—"），不能拿 0 当分母
                downloadToInstall: downloads.available ? pct(installs.total, downloads.total) : null,
                installToRequest: pct(requestsTotal, installs.total),
                installToActivated: pct(activatedMachines, installs.total)
            }
        });
    } catch (e) {
        return json({ success: false, error: 'Internal error: ' + (e.message || e) }, 500);
    }
}
