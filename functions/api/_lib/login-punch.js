// ============================================================================
//  login-punch.js — 历史登录打卡（"登录一次代表一天"的持久化去重统计）
//
//  配套：KNOWLEDGE §53。2026-10-05 起记录，无法回填此前历史。
//
//  口径与诊所管理「今日登录」严格一致：同一账号(云端)/设备(离线端)在同一
//  北京自然日、同一端类型(桌面/APP/网页)只计 1 次。
//
//  纯服务端统计，五端零改动——两个既有触点：
//    ① 云端登录成功 users.js writeUserSession 后（uid=username）
//    ② 离线端 heartbeat.js 设备匹配路径（uid=machineId，心跳 10min 周期）
//
//  KV 设计（Cloudflare KV 最终一致、无 CAS，故用"每端每天一个独立 key"
//  天然去重，杜绝读-改-写计数器的并发丢更新）：
//    lp:{yyyy-mm-dd}:{encClinic}:{t}:{encUid}  当天去重凭证，TTL 400 天
//        t = d(桌面)/a(APP)/w(网页)；get 命中跳过，miss 才 put（稳态 1 写/端/天）
//    lp_start                                   统计起始日（首个打卡的北京日期，永久）
//    lpcur:{yyyy-mm}                            当月聚合缓存 {builtAt,c:{enc:{d,a,w}}}
//    lparch:{yyyy-mm}                           月归档完成标志
//    lpmon:{yyyy-mm}:{encClinic}                历史月桶 {d,a,w}（绝对值计数，永久）
//
//  月归档（懒触发，幂等）：管理员打开诊所列表时，若发现已结束月份无归档
//  标志，则 list 该月全部 lp: 原始 key 聚合出每诊所计数写月桶，再置标志。
//  月桶是绝对值而非增量，重复归档写同值无害。
// ============================================================================

import { listAllKeys } from './kv.js';

const PUNCH_TTL_SECONDS = 400 * 24 * 60 * 60; // 原始凭证保留 400 天
const MONTH_CACHE_TTL_SECONDS = 20 * 60;      // 当月聚合缓存 20 分钟
const MONTH_CACHE_FRESH_MS = 20 * 60 * 1000;

const TYPE_MAP = { desktop: 'd', d: 'd', app: 'a', a: 'a', web: 'w', w: 'w' };

function normType(clientClass) {
    return TYPE_MAP[String(clientClass || '').toLowerCase()] || 'w'; // 未知兜底网页（与今日登录一致）
}

function enc(s) {
    return encodeURIComponent(String(s));
}

// 北京时间(UTC+8)日期工具：返回 {day:'yyyy-mm-dd', month:'yyyy-mm'}
function beijingParts(ms) {
    const d = new Date(ms + 8 * 3600 * 1000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return { day: `${y}-${m}-${day}`, month: `${y}-${m}` };
}

// 枚举两个北京月份之间的全部 'yyyy-mm'（含两端；安全上限 24 个月）
// 起点晚于终点（如起始月就是当月，尚无已结束月份）返回空数组
function enumerateMonths(fromYm, toYm) {
    const out = [];
    if (fromYm > toYm) return out; // 'yyyy-mm' 字典序即时间序
    let [y, m] = fromYm.split('-').map(Number);
    const [ey, em] = toYm.split('-').map(Number);
    for (let i = 0; i < 24; i++) {
        const ym = `${y}-${String(m).padStart(2, '0')}`;
        out.push(ym);
        if (y === ey && m === em) break;
        m++;
        if (m > 12) { m = 1; y++; }
    }
    return out;
}

// 上一个北京月份
function prevMonth(ym) {
    let [y, m] = ym.split('-').map(Number);
    m--;
    if (m < 1) { m = 12; y--; }
    return `${y}-${String(m).padStart(2, '0')}`;
}

// listAllKeys 批量 get JSON
async function batchGetJson(kv, keys, batchSize = 20) {
    const out = [];
    for (let i = 0; i < keys.length; i += batchSize) {
        const vals = await Promise.all(keys.slice(i, i + batchSize).map(k => kv.get(k, 'json').catch(() => null)));
        out.push(...vals);
    }
    return out;
}

// list 某月全部原始打卡 key，聚合出 encClinic -> {d,a,w}（key 本身即去重凭证，数 key 即可）
async function aggregateMonthRawKeys(kv, monthPrefix) {
    const agg = new Map();
    const keys = await listAllKeys(kv, monthPrefix);
    for (const k of keys) {
        const parts = k.split(':'); // lp:date:encClinic:t:encUid
        if (parts.length !== 5) continue;
        const clinic = parts[2];
        const t = parts[3];
        if (t !== 'd' && t !== 'a' && t !== 'w') continue;
        if (!agg.has(clinic)) agg.set(clinic, { d: 0, a: 0, w: 0 });
        agg.get(clinic)[t]++;
    }
    return agg;
}

/**
 * 登录打卡（失败只 warn，绝不阻断登录/心跳主流程）
 * @param kv KV 绑定
 * @param p.clinicName 诊所名（云端登录点/离线 license 记录中的权威名）
 * @param p.clientClass 'desktop'|'app'|'web'（或 d/a/w）
 * @param p.uid 云端=username；离线=machineId
 */
export async function punchLogin(kv, { clinicName, clientClass, uid } = {}) {
    if (!kv || !clinicName || !uid) return;
    try {
        const t = normType(clientClass);
        const { day, month } = beijingParts(Date.now());
        const key = `lp:${day}:${enc(clinicName)}:${t}:${enc(uid)}`;
        const existed = await kv.get(key);
        if (existed !== null && existed !== undefined) return; // 今日已打卡（边缘收敛期的重复 put 为同值覆盖，无害）
        await kv.put(key, new Date().toISOString(), { expirationTtl: PUNCH_TTL_SECONDS });
        // 统计起始日（仅写一次；并发首日重复写同值，幂等）
        try {
            const start = await kv.get('lp_start');
            if (start === null || start === undefined) await kv.put('lp_start', day);
        } catch (_) {}
        // ★ 2026-10-10 列表配额治理：原 `delete(lpcur:{month})` 会作废当月聚合缓存 →
        //   管理员下次打开诊所列表必触发 aggregateMonthRawKeys('lp:{month}-') 对**全月原始打卡键**
        //   做 listAllKeys（list 配额 1000/天 被打满的隐藏消耗源，见 Cloudflare 降级告警）。
        //   改为【增量更新缓存里本诊所的计数】：仅 1 get + 1 put，且打卡链路已随登录整条后台化。
        //   缓存不存在/结构异常时不新建（交由列表侧按既有逻辑与 TTL 自建，避免半成品缓存）。
        try {
            const curKey = `lpcur:${month}`;
            const cache = await kv.get(curKey, 'json');
            if (cache && cache.c && typeof cache.c === 'object' && cache.builtAt) {
                const ec = enc(clinicName);
                const bucket = cache.c[ec] || { d: 0, a: 0, w: 0 };
                bucket[t] = (Number(bucket[t]) || 0) + 1;
                cache.c[ec] = bucket;
                await kv.put(curKey, JSON.stringify(cache), { expirationTtl: MONTH_CACHE_TTL_SECONDS });
            }
        } catch (_) { /* 缓存更新失败不影响打卡与登录 */ }
    } catch (e) {
        console.warn('[login-punch] 打卡失败（不影响主流程）:', e && e.message);
    }
}

// 归档单个已结束月份（幂等；调用方已判标志缺失）
async function archiveMonth(kv, ym) {
    // monthPrefix 'lp:2026-09-' 精确覆盖该月 01..31 全部日 key
    const agg = await aggregateMonthRawKeys(kv, `lp:${ym}-`);
    for (const [clinic, counts] of agg) {
        // KV 无批量 API，逐写；诊所数量级 ≤ 数百，每月仅一轮
        await kv.put(`lpmon:${ym}:${clinic}`, JSON.stringify(counts)).catch(() => {});
    }
    await kv.put(`lparch:${ym}`, '1');
    return agg.size;
}

/**
 * 取全部诊所的历史累计登录（历史月桶 + 当月实时）。
 * @returns {Promise<{startDate:string|null, totals:Map<string,{d:number,a:number,w:number}>}>}
 *          totals 的 key 为 encodeURIComponent(clinicName)，与前端取用方式一致。
 */
export async function getClinicLoginHistory(kv, clinicNames) {
    const empty = { startDate: null, totals: new Map() };
    if (!kv) return empty;
    try {
        const now = Date.now();
        const { month: curMonth } = beijingParts(now);

        // ① 懒归档：从起始月到上月，补齐所有缺标志的月份（顺带记录已归档月份供 ② 推导）
        let startDate = null;
        const archivedMonths = [];
        try { startDate = await kv.get('lp_start'); } catch (_) {}
        if (startDate) {
            const startMonth = String(startDate).slice(0, 7);
            const lastMonth = prevMonth(curMonth);
            for (const ym of enumerateMonths(startMonth, lastMonth)) {
                const done = await kv.get(`lparch:${ym}`).catch(() => null);
                if (done) { archivedMonths.push(ym); continue; }
                try { await archiveMonth(kv, ym); archivedMonths.push(ym); } catch (_) {}
            }
        }

        // ② 历史月桶求和
        //   ★ 2026-10-10 KV list 配额治理：原先每次调用都 `listAllKeys(kv,'lpmon:')` 全站扫描，
        //     与 users.js 的 license/session 全扫叠加，是每日 1000 次 list 被打满的主因之一。
        //     桶 key = lpmon:{ym}:{encClinic}，其中月份集合（已归档）与诊所集合均可推导，
        //     故改为派生 key 直读：get 次数 = 已归档月数 × 诊所数，**零 list**。
        //     未传诊所集合时回退旧行为（兼容其他调用方）。
        const totals = new Map();
        const encClinics = Array.isArray(clinicNames)
            ? [...new Set(clinicNames.filter(n => typeof n === 'string' && n).map(n => encodeURIComponent(n)))]
            : null;
        let monKeys = null;
        if (encClinics && encClinics.length) {
            monKeys = [];
            for (const ym of archivedMonths) {
                for (const ec of encClinics) monKeys.push(`lpmon:${ym}:${ec}`);
            }
        } else {
            monKeys = await listAllKeys(kv, 'lpmon:');
        }
        const monVals = await batchGetJson(kv, monKeys);
        monKeys.forEach((k, i) => {
            const v = monVals[i];
            if (!v) return;
            const clinic = k.slice('lpmon:'.length).split(':')[1]; // lpmon:yyyy-mm:encClinic
            if (!totals.has(clinic)) totals.set(clinic, { d: 0, a: 0, w: 0 });
            const t = totals.get(clinic);
            t.d += v.d || 0; t.a += v.a || 0; t.w += v.w || 0;
        });

        // ③ 当月：缓存 miss/过期则 list 当月原始 key 重建
        let curCache = await kv.get(`lpcur:${curMonth}`, 'json').catch(() => null);
        if (!curCache || !curCache.builtAt || (now - Date.parse(curCache.builtAt)) > MONTH_CACHE_FRESH_MS) {
            const agg = await aggregateMonthRawKeys(kv, `lp:${curMonth}-`);
            curCache = { builtAt: new Date(now).toISOString(), c: {} };
            for (const [clinic, counts] of agg) curCache.c[clinic] = counts;
            await kv.put(`lpcur:${curMonth}`, JSON.stringify(curCache), { expirationTtl: MONTH_CACHE_TTL_SECONDS }).catch(() => {});
        }
        for (const [clinic, v] of Object.entries(curCache.c || {})) {
            if (!totals.has(clinic)) totals.set(clinic, { d: 0, a: 0, w: 0 });
            const t = totals.get(clinic);
            t.d += v.d || 0; t.a += v.a || 0; t.w += v.w || 0;
        }

        return { startDate, totals };
    } catch (e) {
        console.warn('[login-punch] 历史聚合失败（按无历史处理）:', e && e.message);
        return empty;
    }
}
