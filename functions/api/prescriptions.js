import { parseAuthHeader, isPlatformAdmin, isClinicAdmin, isAdmin, isCashier, userMustChangePassword, ownerAliasesOf } from './_lib/auth.js';
import { getKV } from './_lib/kv.js';
import { getDB, isD1Enabled } from './_lib/d1.js';
import { writeAuditLog } from './_lib/audit-log.js';
// ★ 2026-09-15 登录提速：D1 读取/行转换抽至 _lib/prescriptions-store.js（与 users.js 共享）
// ★ 2026-10-09 KV list 配额治理：日期分片改为显式索引，读路径不再 listAllKeys
import {
    d1LoadPrescriptions, d1RowToPrescription, safeJsonParse, ensurePrescriptionSchema,
    getPrescriptionDayKeys, ensurePrescriptionDayIndexed
} from './_lib/prescriptions-store.js';

// P1-6 安全增强：CORS 白名单（与 users.js 一致）
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
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
        'Content-Type': 'application/json'
    };
}

function json(data, status = 200, request = null) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders(request) });
}

// ★ 2026-09-10 审计日志统一走 _lib/audit-log.js（顶部 import），此处不再内联副本

// ★ P2-B 统一：getKV 改用 _lib/kv.js 单一事实源（顶部 import）

// 获取东八区当前时间
function getBeijingTime() {
    const now = new Date();
    return new Date(now.getTime() + (8 * 60 * 60 * 1000));
}

function formatBeijingDateYYMMDD(date) {
    const year = date.getUTCFullYear().toString().substring(2);
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return year + month + day;
}

// ★ 2026-08-25 编号重复修复：从编号提取当天序号（仅识别 yymmdd 前缀的合法编号）
function extractDaySeq(no, yymmdd) {
    if (!no || typeof no !== 'string' || !no.startsWith(yymmdd)) return 0;
    const tail = no.slice(yymmdd.length);
    if (!/^\d{1,6}$/.test(tail)) return 0;
    return parseInt(tail, 10);
}

// 当天列表最大序号（KV 计数器因最终一致性落后时兜底）
function maxDaySeqInList(list, yymmdd) {
    let max = 0;
    for (const p of list) {
        const s = Math.max(
            extractDaySeq(p && p.outpatientNo, yymmdd),
            extractDaySeq(p && p.prescriptionNo, yymmdd)
        );
        if (s > max) max = s;
    }
    return max;
}

// 生成处方编号（诊所全局每日统一，YYMMDD + 2位序号）
// ★ 2026-08-25 原子性强化：序号 = max(KV计数器, 当天列表最大序号) 后递增。
//   KV 为最终一致存储，跨边缘节点计数器可能落后（多设备同时在线时曾导致两处方同号 26082504），
//   列表扫描兜底保证计数器落后时不重号；批量保存循环内串行递增，单请求内天然不冲突。
// ★ 2026-09-10 并发加固：计数读取加「带重试」——重读计数器 2 次取较大值，配合列表扫描兜底，
//   进一步收窄多设备同时保存的重号窗口（KV 无 CAS，真正零风险需 DO/D1 根治档）。
async function allocatePrescriptionNos(kv, clinicId, list, count, yymmddStr) {
    const now = getBeijingTime();
    const yymmdd = yymmddStr || formatBeijingDateYYMMDD(now);
    const seqKey = `clinic:${clinicId}:prescription_seq:${yymmdd}`;

    let seq = parseInt(await kv.get(seqKey) || '0', 10);
    // 带重试：KV 最终一致，短时间内重读计数器，若已前进则取较大值
    for (let attempt = 0; attempt < 2; attempt++) {
        await new Promise(r => setTimeout(r, 20 * (attempt + 1)));
        const recheck = parseInt(await kv.get(seqKey) || '0', 10);
        if (recheck > seq) seq = recheck;
    }
    const listMax = maxDaySeqInList(list || [], yymmdd);
    if (listMax > seq) seq = listMax;

    const nos = [];
    for (let i = 0; i < count; i++) {
        seq += 1;
        nos.push(yymmdd + String(seq).padStart(2, '0'));
    }
    await kv.put(seqKey, String(seq));
    return nos;
}

// 预览下一个编号（不递增）★ 同样加列表兜底，保证预览与实际分配一致
async function peekNextPrescriptionNo(kv, clinicId, list, yymmddStr) {
    const now = getBeijingTime();
    const yymmdd = yymmddStr || formatBeijingDateYYMMDD(now);
    const seqKey = `clinic:${clinicId}:prescription_seq:${yymmdd}`;
    let seq = parseInt(await kv.get(seqKey) || '0', 10);
    const listMax = maxDaySeqInList(list || [], yymmdd);
    if (listMax > seq) seq = listMax;
    seq += 1;
    return yymmdd + String(seq).padStart(2, '0');
}

// ============================================================================
// ★ 2026-09-10 处方按日期分 key（替代单数组全量存储）
//
// 背景：clinic:{id}:prescriptions 单数组存全所处方，6个月左右超 KV 25MB 上限
//   导致保存失败；且全量读-改-写并发覆盖窗口大。
// 方案：按日期分 key —— clinic:{id}:prescriptions:{yymmdd}，每天一个数组。
//   - 单 key 体积 = 当天处方量（通常 <1MB），永不超限
//   - 并发冲突范围缩小到当天
//   - 旧全量 key 读取时兼容合并（迁移期），新数据不再写入旧 key
// ============================================================================

// 旧全量 key（兼容期读取，不再写入）
function getLegacyPrescriptionsKey(clinicId) {
    return `clinic:${clinicId}:prescriptions`;
}

// 单日处方 key
function getDayPrescriptionsKey(clinicId, yymmdd) {
    return `clinic:${clinicId}:prescriptions:${yymmdd}`;
}

// 日期 key 前缀（用于 listAllKeys 扫描所有日期分 key）
function getDayPrescriptionsPrefix(clinicId) {
    return `clinic:${clinicId}:prescriptions:`;
}

// 从处方对象提取 yymmdd（YYMMDD）
// 优先级：date 字段（YYYY-MM-DD）> createdAt/updatedAt（ISO）> 当前日期兜底
function extractYYMMDD(prescription) {
    const dateStr = prescription && prescription.date;
    if (dateStr && typeof dateStr === 'string') {
        // YYYY-MM-DD → YYMMDD
        const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return m[1].slice(2) + m[2] + m[3];
    }
    const ca = prescription && (prescription.createdAt || prescription.updatedAt);
    if (ca) {
        const d = new Date(ca);
        if (!isNaN(d.getTime())) {
            // createdAt 可能是时间戳数字或 ISO 字符串，统一转北京时区 yymmdd
            const utcMs = typeof ca === 'number' ? ca : d.getTime();
            const bj = new Date(utcMs + 8 * 3600 * 1000);
            return formatBeijingDateYYMMDD(bj);
        }
    }
    return formatBeijingDateYYMMDD(getBeijingTime());
}

// 读取单日处方（仅日期分 key）
async function loadDayPrescriptions(kv, clinicId, yymmdd) {
    const key = getDayPrescriptionsKey(clinicId, yymmdd);
    const arr = await kv.get(key, 'json').catch(() => null);
    return Array.isArray(arr) ? arr : [];
}

// 聚合读取全所处方：扫描所有日期分 key + 旧全量 key（兼容迁移期）
// 返回按 id 去重的合并数组（日期 key 优先于旧全量 key）
async function loadAllPrescriptions(kv, clinicId) {
    const byId = new Map();

    // 1) 旧全量 key（兼容期，迁移完成后可移除）
    const legacy = await kv.get(getLegacyPrescriptionsKey(clinicId), 'json').catch(() => null);
    if (Array.isArray(legacy)) {
        for (const p of legacy) {
            if (p && typeof p === 'object' && p.id != null) {
                byId.set(String(p.id), p);
            }
        }
    }

    // 2) 读取所有日期分 key，覆盖旧全量中同 id 的记录
    //    ★ 2026-10-09：改为显式索引读取（不再 listAllKeys —— 每次读取一条 list 是
    //      KV 每日 list 1000 配额被打满的根因；索引缺失时内部懒回填一次）
    const dayKeys = await getPrescriptionDayKeys(kv, clinicId);
    for (const k of dayKeys) {
        const arr = await kv.get(k, 'json').catch(() => null);
        if (Array.isArray(arr)) {
            for (const p of arr) {
                if (p && typeof p === 'object' && p.id != null) {
                    byId.set(String(p.id), p);
                }
            }
        }
    }

    return Array.from(byId.values());
}

// 按处方日期写入对应日期 key（新增或覆盖同 id 记录）
async function upsertToDayKey(kv, clinicId, prescription) {
    const yymmdd = extractYYMMDD(prescription);
    const key = getDayPrescriptionsKey(clinicId, yymmdd);
    // ★ 2026-10-09 顺序铁律：先登记索引、再写日期 key（详见 prescriptions-store.js）。
    //   中途失败最坏只留"索引有、数据没写"（读时 get 得 null 跳过、下次写入自愈），
    //   绝不出现"数据已写、索引没记"导致该日处方永久不可见。
    await ensurePrescriptionDayIndexed(kv, clinicId, yymmdd);
    const list = await kv.get(key, 'json').catch(() => null) || [];
    const idx = list.findIndex(p => String(p.id) === String(prescription.id));
    if (idx >= 0) {
        list[idx] = prescription;
    } else {
        list.push(prescription);
    }
    await kv.put(key, JSON.stringify(list));
    return { yymmdd, list };
}

// 从所有日期分 key + 旧全量 key 中按 id 查找并删除处方
// 返回被删除的处方对象（找不到返回 null）
async function deletePrescriptionById(kv, clinicId, id) {
    const strId = String(id);

    // 1) 先查日期分 key（★ 2026-10-09 显式索引，不再 listAllKeys）
    const dayKeys = await getPrescriptionDayKeys(kv, clinicId);
    for (const k of dayKeys) {
        const list = await kv.get(k, 'json').catch(() => null);
        if (!Array.isArray(list)) continue;
        const idx = list.findIndex(p => String(p.id) === strId);
        if (idx >= 0) {
            const removed = list[idx];
            list.splice(idx, 1);
            await kv.put(k, JSON.stringify(list));
            return removed;
        }
    }

    // 2) 兜底查旧全量 key
    const legacy = await kv.get(getLegacyPrescriptionsKey(clinicId), 'json').catch(() => null);
    if (Array.isArray(legacy)) {
        const idx = legacy.findIndex(p => String(p.id) === strId);
        if (idx >= 0) {
            const removed = legacy[idx];
            legacy.splice(idx, 1);
            await kv.put(getLegacyPrescriptionsKey(clinicId), JSON.stringify(legacy));
            return removed;
        }
    }

    return null;
}

// ============================================================================
// ★ 2026-10-19 云端版「断网可用 + 联网自动同步」一期：GET ?sync=1 增量拉取
//
//   契约：.trae/documents/cloud-offline-sync-mvp.md §2.1（唯一权威）。
//   · 认证/角色过滤与现有 GET 完全一致（管理员/前台收费读全所，普通用户按
//     ownerAliasesOf 归属别名集过滤）——复用同一份 currentUser / ownerNames。
//   · 数据源：D1 开启 → d1LoadPrescriptions(db, clinicId, true)（含墓碑，D1 为空
//     或读取异常回退 KV）；D1 未启用 → loadAllPrescriptions + 回收站
//     clinic:{id}:prescriptions_trash（同 id 以删除墓碑为准）。
//   · changedAt = deletedAt || updatedAt || createdAt || date；升序、同时间按 id 升序。
//   · since 非空只取 changedAt > since（严格大于）；limit 默认 200、上限 500。
//   · 删除记录只进 tombstones（不返回正文），未删除记录进 data。
//   · 时间戳基准统一为 getBeijingTime().toISOString()（伪北京 UTC，与 updatedAt 一致）。
//   不带 sync 的旧 GET 分支不做任何改动（零回归）。
// ============================================================================
const SYNC_DEFAULT_LIMIT = 200;
const SYNC_MAX_LIMIT = 500;

// 时间值 → 毫秒。兼容 ISO 字符串、纯数字毫秒时间戳（老客户端 updatedAt=Date.now()）、
// 纯日期串（date 兜底）；无法解析返回 NaN（调用方按"最旧"处理）。
function syncTimeMs(value) {
    if (value === undefined || value === null || value === '') return NaN;
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    const s = String(value).trim();
    if (!s) return NaN;
    if (/^\d{11,16}$/.test(s)) return Number(s);
    const t = Date.parse(s);
    return Number.isNaN(t) ? NaN : t;
}

// changedAt = deletedAt || updatedAt || createdAt || date（契约 §2.1，按字段真值级联）
function syncChangedAtOf(p) {
    if (!p || typeof p !== 'object') return '';
    return p.deletedAt || p.updatedAt || p.createdAt || p.date || '';
}

// changedAt 毫秒；无任何可用时间戳的记录视为最旧（全量快照仍可见）
function syncChangedAtMsOf(p) {
    const ms = syncTimeMs(syncChangedAtOf(p));
    return Number.isNaN(ms) ? 0 : ms;
}

// 同 changedAt 的次级排序键：id 升序（纯数字按数值/长度比较，其余按字符串）
function syncCompareIdAsc(a, b) {
    const sa = String(a === undefined || a === null ? '' : a);
    const sb = String(b === undefined || b === null ? '' : b);
    const isNumA = /^\d+$/.test(sa);
    const isNumB = /^\d+$/.test(sb);
    if (isNumA && isNumB && sa.length !== sb.length) return sa.length - sb.length;
    return sa < sb ? -1 : (sa > sb ? 1 : 0);
}

// D1 行经 d1RowToPrescription 后时间列仍是 snake_case（created_at/updated_at，见
// _lib/prescriptions-store.js），而增量契约要求 changedAt 基于 camelCase 字段。
// 仅同步路径归一（旧 GET 输出保持不变）；数值型时间戳原样保留，由 syncTimeMs 兼容。
function syncNormalizeRecord(p) {
    const out = { ...p };
    if (out.createdAt === undefined || out.createdAt === null) {
        if (out.created_at !== undefined && out.created_at !== null) out.createdAt = out.created_at;
    }
    if (out.updatedAt === undefined || out.updatedAt === null) {
        if (out.updated_at !== undefined && out.updated_at !== null) out.updatedAt = out.updated_at;
    }
    delete out.created_at;
    delete out.updated_at;
    return out;
}

// ★ 2026-10-19 永久删除墓碑（合规）：永久删除后 D1 行与 KV 回收站项都已删除，增量同步面
//   没有痕迹 → 离线设备未推送的旧 upsert 可能把"永久删除"的处方复活。这里在 KV 保留
//   仅含 {id, deletedAt} 的永久墓碑（不含患者信息），供增量下发给所有设备并阻止 POST 重建。
const PERMANENT_TOMBSTONE_CAP = 5000;
function permanentTombstoneKey(trashKey) {
    return String(trashKey || '').replace(/:prescriptions_trash$/, ':prescriptions_permanent');
}
async function loadPermanentTombstones(kv, key) {
    if (!kv || !key) return [];
    try {
        const arr = await kv.get(key, 'json');
        return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
}
async function addPermanentTombstone(kv, key, id, deletedAt) {
    try {
        if (!kv || !key || id === undefined || id === null) return;
        const arr = await loadPermanentTombstones(kv, key);
        const sid = String(id);
        const next = arr.filter(t => t && String(t.id) !== sid);
        next.unshift({ id: id, deletedAt: deletedAt || getBeijingTime().toISOString() });
        await kv.put(key, JSON.stringify(next.slice(0, PERMANENT_TOMBSTONE_CAP)));
    } catch (e) { console.warn('[prescriptions][sync] 永久墓碑写入失败(忽略):', e && e.message); }
}

// 读取同步候选集（含删除墓碑，按 id 去重）
async function loadSyncCandidates(kv, db, d1On, clinicId, trashKey, permanentKey) {
    let rows = [];
    if (d1On && db) {
        try {
            const d1Rows = await d1LoadPrescriptions(db, clinicId, true);
            rows = (Array.isArray(d1Rows) ? d1Rows : []).map(syncNormalizeRecord);
        } catch (e) {
            console.error('[prescriptions][sync] D1 读取失败，回退 KV:', e && e.message);
            rows = [];
        }
    }
    const byId = new Map();
    for (const p of rows) {
        if (p && typeof p === 'object' && p.id !== undefined && p.id !== null) byId.set(String(p.id), p);
    }

    // D1 未启用或为空：KV 回退（活跃记录 + 回收站墓碑；同 id 以墓碑为准）
    if (byId.size === 0) {
        const active = await loadAllPrescriptions(kv, clinicId);
        const trash = (await kv.get(trashKey, 'json').catch(() => null)) || [];
        for (const p of active) {
            if (p && typeof p === 'object' && p.id !== undefined && p.id !== null) {
                byId.set(String(p.id), syncNormalizeRecord(p));
            }
        }
        for (const t of trash) {
            if (t && typeof t === 'object' && t.id !== undefined && t.id !== null) {
                const tomb = syncNormalizeRecord(t);
                if (!tomb.deletedAt) tomb.deletedAt = tomb.updatedAt || tomb.createdAt || '';
                byId.set(String(tomb.id), tomb); // 删除墓碑覆盖活跃记录（去重口径）
            }
        }
    }

    // ★ 永久删除墓碑（KV，独立于 D1/回收站）：覆盖任何本地残留/回退数据，且带 permanent 标记
    const perms = await loadPermanentTombstones(kv, permanentKey || permanentTombstoneKey(trashKey));
    for (const t of perms) {
        if (!t || t.id === undefined || t.id === null) continue;
        byId.set(String(t.id), { id: t.id, deletedAt: t.deletedAt || '', permanent: true });
    }
    return Array.from(byId.values());
}

// GET ?sync=1 增量拉取主逻辑
async function handleIncrementalSync({ kv, db, d1On, clinicId, trashKey, permanentKey, currentUser, ownerNames, url, request }) {
    const rawSince = String(url.searchParams.get('since') || '').trim();
    let sinceMs = NaN;
    if (rawSince) {
        sinceMs = syncTimeMs(rawSince);
        if (Number.isNaN(sinceMs)) {
            // 游标损坏时显式报错，避免客户端把"全量"当增量、或静默卡住不同步
            return json({ success: false, error: 'since 参数格式无效（需 ISO 时间）' }, 400, request);
        }
    }

    let limit = parseInt(url.searchParams.get('limit') || '', 10);
    if (!Number.isInteger(limit) || limit < 1) limit = SYNC_DEFAULT_LIMIT;
    if (limit > SYNC_MAX_LIMIT) limit = SYNC_MAX_LIMIT;

    const serverTime = getBeijingTime().toISOString();

    let rows = await loadSyncCandidates(kv, db, d1On, clinicId, trashKey, permanentKey);

    // 角色过滤：与现有 GET 完全一致（管理员/前台收费读全所，其余按归属别名）
    if (!isAdmin(currentUser) && !isCashier(currentUser)) {
        rows = rows.filter(p => ownerNames.indexOf(p.createdBy) !== -1);
    }
    // since 增量（严格大于：客户端游标 = 上一页 nextSince）
    if (rawSince) {
        rows = rows.filter(p => syncChangedAtMsOf(p) > sinceMs);
    }

    // 排序：changedAt 升序、同时间按 id 升序
    rows.sort((a, b) => {
        const ta = syncChangedAtMsOf(a);
        const tb = syncChangedAtMsOf(b);
        if (ta !== tb) return ta - tb;
        return syncCompareIdAsc(a.id, b.id);
    });

    // 分页：常规切片 limit；若切片边界正好把「同一 changedAt 的一组记录」切开，
    // 严格 `>` 游标会漏掉同刻的剩余记录（医疗数据不可接受）。处理：
    //   · 组从页中间开始 → 本页收回该组之前（页可能略小于 limit）；
    //   · 整页都是同刻记录（组从页首开始）→ 扩到组尾（页可能略大于 limit），
    //     保证 nextSince 一定前进、客户端不会卡死。
    let page = rows.slice(0, limit);
    let hasMore = rows.length > page.length;
    if (hasMore && page.length > 0) {
        const boundaryMs = syncChangedAtMsOf(page[page.length - 1]);
        if (boundaryMs === syncChangedAtMsOf(rows[page.length])) {
            let tieStart = page.length - 1;
            while (tieStart > 0 && syncChangedAtMsOf(page[tieStart - 1]) === boundaryMs) tieStart--;
            if (tieStart > 0) {
                page = page.slice(0, tieStart);
            } else {
                let end = page.length;
                while (end < rows.length && syncChangedAtMsOf(rows[end]) === boundaryMs) end++;
                page = rows.slice(0, end);
            }
            hasMore = rows.length > page.length;
        }
    }

    const data = [];
    const tombstones = [];
    for (const p of page) {
        if (p.deletedAt) {
            const tomb = { id: p.id, deletedAt: p.deletedAt };
            if (p.permanent) tomb.permanent = true;
            tombstones.push(tomb);
        } else {
            data.push(p);
        }
    }

    let nextSince = serverTime;
    if (page.length > 0) {
        const last = page[page.length - 1];
        const lastAt = syncChangedAtOf(last);
        if (typeof lastAt === 'number') {
            // 数值时间戳归一为 ISO，保证 nextSince 恒为 ISO 字符串（契约示例）
            nextSince = new Date(syncChangedAtMsOf(last)).toISOString();
        } else {
            nextSince = String(lastAt || serverTime);
        }
    }

    return json({
        success: true,
        serverTime,
        nextSince,
        hasMore,
        count: page.length, // 本页返回条数 = data.length + tombstones.length
        data,
        tombstones
    }, 200, request);
}

// ============================================================================
// ★ 2026-09-10 D1 处方存储层（P0 迁移）
//
// 策略：USE_D1=true 时
//   - 读：D1 优先，D1 失败回退 KV
//   - 写：D1 + KV 双写（KV 作为备份，便于回滚）
//   - 编号：D1 prescription_seq 表事务原子递增（根治重号）
// ============================================================================

// 写入/更新单条处方到 D1（upsert by id）
async function d1UpsertPrescription(db, clinicId, p, __healed) {
    // ★ 2026-10-06 首次写入前确保新列就位（幂等单飞，见 prescriptions-store.js）
    await ensurePrescriptionSchema(db);
    const __run = () => db.prepare(`
        INSERT INTO prescriptions (id, clinic_id, patient_name, doctor_name, created_by, date,
            prescription_no, outpatient_no, diagnosis, items, total_amount, registration_fee, dose_count,
            fee_status, paid_at, paid_by, pay_method, media_files, extra, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            patient_name=excluded.patient_name, doctor_name=excluded.doctor_name,
            date=excluded.date, prescription_no=excluded.prescription_no,
            outpatient_no=excluded.outpatient_no, diagnosis=excluded.diagnosis,
            items=excluded.items, total_amount=excluded.total_amount,
            registration_fee=excluded.registration_fee, dose_count=excluded.dose_count,
            fee_status=excluded.fee_status, paid_at=excluded.paid_at,
            paid_by=excluded.paid_by, pay_method=excluded.pay_method,
            media_files=excluded.media_files, extra=excluded.extra,
            updated_at=excluded.updated_at
    `).bind(
        String(p.id), clinicId,
        p.patientName || null,
        p.doctorName || null,
        p.createdBy || '',
        p.date || '',
        p.prescriptionNo || null,
        p.outpatientNo || null,
        p.diagnosis || null,
        JSON.stringify(p.items || []),
        typeof p.totalAmount === 'number' ? p.totalAmount : 0,
        // ★ 2026-10-06 诊疗费/剂数入库（此前 D1 丢这两字段 → 云端月度报表诊疗费、剂数恒 0、成本按 1 剂少算）
        typeof p.registrationFee === 'number' ? p.registrationFee : (parseFloat(p.registrationFee) || 0),
        parseInt(p.doseCount, 10) || 0,
        p.feeStatus || 'unpaid',
        p.paidAt || null,
        p.paidBy || null,
        p.payMethod || null,
        p.mediaFiles ? JSON.stringify(p.mediaFiles) : null,
        p.extra ? JSON.stringify(p.extra) : null,
        p.createdAt || new Date().toISOString(),
        p.updatedAt || null
    ).run();
    try {
        await __run();
    } catch (e) {
        // ★ 2026-10-20 列缺失自愈重试：历史 D1 表为「增量补列」而来，缺任一写入列会让
        //   整条 INSERT 失败；旧实现被 dualWritePrescription 吞掉 → 该方只落 KV，
        //   而读路径 D1 优先 → 所有端永久读不到（客户端却显示"已同步"）。
        //   检测到缺列即强制重查列并重试一次，从根上消除"假成功"。
        if (!__healed && /no such column/i.test(String((e && e.message) || ''))) {
            await ensurePrescriptionSchema(db, true);
            return d1UpsertPrescription(db, clinicId, p, true);
        }
        throw e;
    }
}

// D1 软删除（标记 deleted_at）
// ★ 2026-10-19 时间戳归一（增量同步契约 §2.1）：deleted_at 必须与 updatedAt 同基准
//   （getBeijingTime() 伪 UTC），否则真 UTC 的 deleted_at 比 updatedAt 慢 8h，
//   客户端以 serverTime 为游标增量拉取时会永久漏掉这段墓碑。nowIso 由调用方传入，
//   与 KV 回收站 deletedAt 共用同一个时间戳，保证 D1/KV 两条回退路径看到同一变更时间。
async function d1SoftDelete(db, clinicId, id, deletedBy, nowIso) {
    const ts = nowIso || getBeijingTime().toISOString();
    const r = await db.prepare(
        `UPDATE prescriptions SET deleted_at = ?, deleted_by = ? WHERE id = ? AND clinic_id = ?`
    ).bind(ts, deletedBy, String(id), clinicId).run();
    return r && r.meta && r.meta.changes > 0;
}

// D1 恢复处方（清除 deleted_at）
// ★ 2026-10-19 时间戳归一：恢复也是「变更」，updated_at 同步前进（nowIso），
//   否则增量同步（changedAt=updatedAt）拉不到恢复动作。
async function d1Restore(db, clinicId, id, nowIso) {
    const ts = nowIso || getBeijingTime().toISOString();
    const r = await db.prepare(
        `UPDATE prescriptions SET deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE id = ? AND clinic_id = ?`
    ).bind(ts, String(id), clinicId).run();
    return r && r.meta && r.meta.changes > 0;
}

// D1 永久删除（从回收站彻底删除）
async function d1PermanentDelete(db, clinicId, id) {
    const r = await db.prepare(
        `DELETE FROM prescriptions WHERE id = ? AND clinic_id = ? AND deleted_at IS NOT NULL`
    ).bind(String(id), clinicId).run();
    return r && r.meta && r.meta.changes > 0;
}

// D1 收费
// ★ 2026-10-19 时间戳归一：收费改写 updated_at = nowIso（前端/增量同步都以 updatedAt 判变更）
async function d1MarkPaid(db, clinicId, id, paidBy, paidByName, payMethod, nowIso) {
    const ts = nowIso || getBeijingTime().toISOString();
    const r = await db.prepare(`
        UPDATE prescriptions SET fee_status='paid', paid_at=?, paid_by=?, pay_method=?, updated_at=?
        WHERE id=? AND clinic_id=? AND (fee_status IS NULL OR fee_status != 'paid')
    `).bind(ts, paidBy, payMethod, ts, String(id), clinicId).run();
    return r && r.meta && r.meta.changes > 0;
}

// D1 按 id 查询单条处方
async function d1GetById(db, clinicId, id) {
    const r = await db.prepare(
        `SELECT * FROM prescriptions WHERE id = ? AND clinic_id = ?`
    ).bind(String(id), clinicId).first();
    return r ? d1RowToPrescription(r) : null;
}

// D1 编号分配（事务原子递增，根治重号）
async function d1AllocateNos(db, clinicId, count, yymmddStr) {
    const yymmdd = yymmddStr || formatBeijingDateYYMMDD(getBeijingTime());
    // 用事务：INSERT OR IGNORE 初始化 → UPDATE 递增 → 读取最新值
    await db.prepare(
        `INSERT OR IGNORE INTO prescription_seq (clinic_id, yymmdd, seq) VALUES (?, ?, 0)`
    ).bind(clinicId, yymmdd).run();

    const nos = [];
    for (let i = 0; i < count; i++) {
        const r = await db.prepare(`
            UPDATE prescription_seq SET seq = seq + 1
            WHERE clinic_id = ? AND yymmdd = ?
            RETURNING seq
        `).bind(clinicId, yymmdd).first();
        const seq = r ? r.seq : (i + 1);
        nos.push(yymmdd + String(seq).padStart(2, '0'));
    }
    return nos;
}

// 双写：D1 + KV（D1 失败不阻断 KV 写入，但结果必须回传——见下）
// ★ 2026-10-20 不再静默：D1 写失败必须回传给调用方（POST 响应带 d1WriteFailed），
//   否则客户端仅凭 success:true 就删掉待同步记录、角标显示"已同步"，而读路径
//   D1 优先 → 该处方在所有端永久不可见（客户实报故障的成因之一）。
async function dualWritePrescription(kv, db, d1On, clinicId, prescription) {
    let d1Ok = true, d1Error = null;
    if (d1On && db) {
        try { await d1UpsertPrescription(db, clinicId, prescription); }
        catch (e) {
            d1Ok = false;
            d1Error = String((e && e.message) || e);
            console.error('[D1] upsert prescription failed:', d1Error);
            // 运维告警留痕（含 id，便于按 id 从 KV 回填 D1）
            await writeAuditLog(kv, clinicId, (prescription && prescription.createdBy) || 'system', 'system',
                'prescription_d1_write_failed', String((prescription && prescription.id) || ''), null,
                { error: d1Error });
        }
    }
    await upsertToDayKey(kv, clinicId, prescription);
    return { d1Ok, d1Error };
}

export async function onRequest(context) {
    const url = new URL(context.request.url);
    const method = context.request.method;

    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders() });
    }

    try {
        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV存储未配置', requireSetup: true }, 500);
        }

        const currentUser = await parseAuthHeader(context.request, context.env);

        // 处方 API 需要认证
        if (!currentUser) {
            return json({ success: false, error: '未授权访问，请先登录', requireAuth: true }, 401);
        }

        // 确定诊所 ID 和 KV key
        const clinicId = currentUser.clinicId;
        if (!clinicId && !isPlatformAdmin(currentUser)) {
            return json({ success: false, error: '缺少诊所信息' }, 400);
        }

        // ★★ 2026-10-15 本人处方归属别名集（当前用户名 + 手机号 + 历次曾用名，服务端 token
        //   签名下发）。改名后即便个别存储副本 createdBy 未迁净，本人读/改/删/恢复自己的
        //   历史处方不受影响；别名全部服务端签发，客户端无法构造他人别名（无水平越权面）。
        const ownerNames = ownerAliasesOf(currentUser);

        // platform_admin 无 clinicId，处方功能主要用于诊所用户
        const targetClinicId = clinicId || 'platform';
        // ★ 2026-09-10 处方按日期分 key：KV_PRESCRIPTIONS 为旧全量 key（兼容期仅读取，不再写入）
        //   新数据写入 clinic:{id}:prescriptions:{yymmdd}，读取由 loadAllPrescriptions 聚合
        const KV_PRESCRIPTIONS = `clinic:${targetClinicId}:prescriptions`;
        const KV_TRASH = `clinic:${targetClinicId}:prescriptions_trash`;

        // GET - 获取处方列表
        if (method === 'GET') {
            const d1On = isD1Enabled(context.env);
            const db = getDB(context.env);

            // ★ 2026-10-19 云端离线同步：GET ?sync=1 增量拉取（契约 §2.1）。
            //   放在 trash 分支之前；不带 sync 的旧 GET 走原路径、行为零变化。
            if (url.searchParams.get('sync') === '1') {
                // ★ 2026-10-19 运维总开关（KV config:cloud_offline_sync = {"mode":"off"}）：
                //   紧急停用离线同步无需发版；客户端收到 disabled 后停止本轮同步（outbox 保留）。
                try {
                    const __syncCfg = await kv.get('config:cloud_offline_sync', 'json').catch(() => null);
                    if (__syncCfg && String(__syncCfg.mode || '') === 'off') {
                        return json({ success: false, disabled: true, error: '离线同步暂未开放，请稍后再试' }, 200, context.request);
                    }
                } catch (e) { /* 配置读取失败不阻断（fail-open，便于回滚操作） */ }
                return await handleIncrementalSync({
                    kv,
                    db,
                    d1On,
                    clinicId: targetClinicId,
                    trashKey: KV_TRASH,
                    permanentKey: permanentTombstoneKey(KV_TRASH),
                    currentUser,
                    ownerNames,
                    url,
                    request: context.request
                });
            }

            // 回收站列表
            if (url.searchParams.get('trash') === 'true') {
                let trash;
                if (d1On && db) {
                    // D1：deleted_at IS NOT NULL
                    trash = (await d1LoadPrescriptions(db, targetClinicId, true)).filter(p => p.deletedAt);
                } else {
                    trash = (await kv.get(KV_TRASH, 'json')) || [];
                }
                if (!currentUser.isAdmin && !isPlatformAdmin(currentUser)) {
                    trash = trash.filter(p => ownerNames.indexOf(p.createdBy) !== -1);
                }
                trash.sort((a, b) => {
                    const timeA = new Date(a.deletedAt || 0).getTime();
                    const timeB = new Date(b.deletedAt || 0).getTime();
                    return timeB - timeA;
                });
                return json({ success: true, data: trash, count: trash.length, currentUsername: currentUser.username });
            }

            let prescriptions;
            if (d1On && db) {
                // ★ D1 优先读取（含 deleted_at IS NULL 过滤）
                prescriptions = await d1LoadPrescriptions(db, targetClinicId, false);
            }
            if (!prescriptions || prescriptions.length === 0) {
                // D1 为空或未启用：回退 KV
                prescriptions = await loadAllPrescriptions(kv, targetClinicId);
            }

            // 按角色筛选
            let filtered = prescriptions;
            // ★ 2026-08-25 前台收费：cashier 与管理员一样可读全所处方（收费工作台数据源）
            if (!isAdmin(currentUser) && !isCashier(currentUser)) {
                filtered = prescriptions.filter(p => ownerNames.indexOf(p.createdBy) !== -1);
            }

            // P1-4 排序一致性：改为按 createdAt 时间戳倒序排序（与前端 sortPrescriptionsByTimeDesc 对齐）
            filtered.sort((a, b) => {
                const timeA = new Date(a.createdAt || a.date || 0).getTime();
                const timeB = new Date(b.createdAt || b.date || 0).getTime();
                if (timeB !== timeA) return timeB - timeA;
                // 时间相同时按编号倒序（次级排序键）
                const noA = a.outpatientNo || a.prescriptionNo || '';
                const noB = b.outpatientNo || b.prescriptionNo || '';
                return noB.localeCompare(noA);
            });

            const now = getBeijingTime();
            const year = now.getUTCFullYear().toString().substring(2);
            const totalCount = year + prescriptions.length.toString().padStart(6, '0');

            return json({
                success: true,
                data: filtered,
                count: filtered.length,
                totalCount,
                currentUsername: currentUser.username,
                isAdmin: currentUser.isAdmin,
                userRole: currentUser.role
            });
        }

        // POST - 保存处方或恢复处方
        if (method === 'POST') {
            // ★ 二期：随机初始密码/客服重置密码账户首登强制改密——所有写动作（
            //   开方/收费/删除/恢复）统一 403，只读放行；平台管理员不受影响。
            if (await userMustChangePassword(context.env, currentUser)) {
                return json({
                    success: false,
                    code: 'MUST_CHANGE_PASSWORD',
                    error: '首次登录请先修改密码后再操作'
                }, 403, context.request);
            }
            // ★ 2026-08-25 前台收费动作：POST ?action=mark-paid  body: { id, payMethod }
            //   仅 cashier/admin 可调；状态单向 unpaid→paid（退款走管理员后续流程）；
            //   幂等：已收费直接返回成功，重复点击不报错。
            if (url.searchParams.get('action') === 'mark-paid') {
                if (!isAdmin(currentUser) && !isCashier(currentUser)) {
                    return json({ success: false, error: '无收费权限：仅管理员或前台收费账号可执行收费' }, 403, context.request);
                }
                const body = await context.request.json().catch(() => ({}));
                const pid = body.id;
                if (pid === undefined || pid === null || pid === '') {
                    return json({ success: false, error: '缺少处方ID' }, 400, context.request);
                }
                const PAY_METHODS = ['现金', '微信', '支付宝', '刷卡', '其他'];
                let payMethod = String(body.payMethod || '').trim();
                if (!PAY_METHODS.includes(payMethod)) payMethod = '其他';

                const d1On = isD1Enabled(context.env);
                const db = getDB(context.env);

                let prescriptions = await loadAllPrescriptions(kv, targetClinicId);
                const idx = prescriptions.findIndex(p => String(p.id) === String(pid));
                if (idx === -1) {
                    return json({ success: false, error: '处方不存在' }, 404, context.request);
                }
                const target = prescriptions[idx];
                if (target.feeStatus === 'paid') {
                    return json({ success: true, data: target, message: '该处方已收费，无需重复操作' });
                }
                const nowIso = getBeijingTime().toISOString();
                target.feeStatus = 'paid';
                target.paidAt = nowIso;
                target.paidBy = currentUser.username;
                target.paidByName = (body.paidByName || currentUser.username);
                target.payMethod = payMethod;
                // ★ 2026-10-19 时间戳归一：收费也是「变更」，updatedAt 同步前进，
                //   增量同步（changedAt=updatedAt）才能把收费动作拉到其他端。
                target.updatedAt = nowIso;

                // ★ D1 双写：D1 UPDATE 收费 + KV 同步（同一个 nowIso，两条路径同基准）
                if (d1On && db) {
                    try { await d1MarkPaid(db, targetClinicId, pid, currentUser.username, body.paidByName, payMethod, nowIso); }
                    catch (e) { console.error('[D1] mark-paid failed:', e.message); }
                }
                await upsertToDayKey(kv, targetClinicId, target);

                await writeAuditLog(kv, targetClinicId, currentUser.username, currentUser.role,
                    'mark_paid', String(pid), context,
                    { payMethod, amount: target.totalAmount, patientName: target.patientName || '' });

                return json({ success: true, data: target, message: '收费成功' });
            }

            // ★ 2026-08-25 前台收费角色禁开方：cashier 不能保存/恢复处方（防绕过前端界面）
            if (isCashier(currentUser)) {
                return json({ success: false, error: '前台收费账号无开方权限，请使用医师账号登录' }, 403, context.request);
            }

            // 恢复处方：POST ?restore=true&id=xxx
            if (url.searchParams.get('restore') === 'true') {
                const prescriptionId = url.searchParams.get('id');
                if (!prescriptionId) {
                    return json({ success: false, error: 'Missing prescription ID' }, 400);
                }

                const d1On = isD1Enabled(context.env);
                const db = getDB(context.env);
                // ★ 2026-10-19 时间戳归一：恢复 = 变更，updatedAt/deleted_at 同基准（伪北京 UTC）
                const nowIso = getBeijingTime().toISOString();

                if (d1On && db) {
                    // ★ D1 恢复：UPDATE deleted_at=NULL, updated_at=nowIso
                    const existing = await d1GetById(db, targetClinicId, prescriptionId);
                    if (!existing || !existing.deletedAt) {
                        return json({ success: false, error: '回收站中未找到此处方' }, 404);
                    }
                    if (ownerNames.indexOf(existing.createdBy) === -1 && !isAdmin(currentUser)) {
                        return json({ success: false, error: '无权恢复此处方' }, 403);
                    }
                    await d1Restore(db, targetClinicId, prescriptionId, nowIso);
                    // 同步 KV
                    const restored = { ...existing };
                    delete restored.deletedAt;
                    delete restored.deletedBy;
                    restored.updatedAt = nowIso;
                    await upsertToDayKey(kv, targetClinicId, restored);
                    // 从 KV 回收站移除
                    let trash = (await kv.get(KV_TRASH, 'json')) || [];
                    const tIdx = trash.findIndex(p => String(p.id) === String(prescriptionId));
                    if (tIdx >= 0) { trash.splice(tIdx, 1); await kv.put(KV_TRASH, JSON.stringify(trash)); }
                    return json({ success: true, message: '处方已恢复', data: restored });
                }

                let trash = (await kv.get(KV_TRASH, 'json')) || [];
                const idx = trash.findIndex(p => p.id.toString() === prescriptionId.toString());
                if (idx === -1) {
                    return json({ success: false, error: '回收站中未找到此处方' }, 404);
                }

                const prescription = trash[idx];
                if (ownerNames.indexOf(prescription.createdBy) === -1 && !isAdmin(currentUser)) {
                    return json({ success: false, error: '无权恢复此处方' }, 403);
                }

                trash.splice(idx, 1);
                await kv.put(KV_TRASH, JSON.stringify(trash));

                const { deletedAt, deletedBy, ...restored } = prescription;
                // ★ 2026-10-19 时间戳归一：KV 恢复分支写 updatedAt = nowIso，
                //   否则增量同步（changedAt=updatedAt）拉不到"从回收站恢复"这一变更。
                restored.updatedAt = nowIso;
                // ★ 2026-09-10 按日期分 key：恢复时按处方日期写入对应日期 key
                await upsertToDayKey(kv, targetClinicId, restored);

                return json({ success: true, message: '处方已恢复', data: restored });
            }

            // 保存处方
            let body;
            try {
                body = await context.request.json();
            } catch (error) {
                // ★ P2-D 修复：解析错误详情仅记服务端日志，客户端返回通用提示
                console.error('[prescriptions] 请求体解析失败:', error && error.message);
                return json({ success: false, error: '请求数据格式错误，请稍后再试' }, 400, context.request);
            }

            if (!body.prescription) {
                return json({ success: false, error: 'Missing prescription data' }, 400);
            }

            // ★ 2026-10-19 永久删除不可复活：离线设备恢复后可能重放旧 upsert，若 id 已在
            //   永久墓碑中则拒绝重建（合规：客户看到的"彻底删除"必须真正不可恢复）。
            try {
                const __permKey = permanentTombstoneKey(KV_TRASH);
                const __perms = await loadPermanentTombstones(kv, __permKey);
                if (__perms.length) {
                    const __permSet = new Set(__perms.map(t => String(t && t.id)));
                    const __list0 = Array.isArray(body.prescription) ? body.prescription : [body.prescription];
                    const __blocked = __list0.some(p => p && p.id != null && __permSet.has(String(p.id)));
                    if (__blocked) {
                        return json({ success: false, code: 'PERMANENTLY_DELETED', error: '该处方已永久删除，不可恢复' }, 409, context.request);
                    }
                }
            } catch (e) { /* 墓碑读取失败不阻断正常保存 */ }

            let prescriptions = await loadAllPrescriptions(kv, targetClinicId);
            const now = getBeijingTime();
            const nowIso = now.toISOString();

            let prescriptionList = Array.isArray(body.prescription) ? body.prescription : [body.prescription];
            const savedPrescriptions = [];

            // ★ 2026-08-25 多设备同时在线修复：先拆分"更新已有/新建"两批，新建统一在
            //   写回前基于重读的最新列表分配编号，杜绝并发覆盖与重号（原实现整列表读改写，
            //   两设备同时保存时后写覆盖先写，且编号计数器落后导致两处方同号 26082504）
            const updatedExisting = [];
            const newOnes = [];

            for (const p of prescriptionList) {
                const existingIdx = prescriptions.findIndex(x => x.id.toString() === (p.id || '').toString());
                if (existingIdx >= 0) {
                    // 已存在：保留原编号和创建者，合并新字段（如mediaFiles）
                    const existing = prescriptions[existingIdx];
                    const newPrescription = {
                        ...existing,
                        ...p,
                        id: existing.id,
                        prescriptionNo: existing.prescriptionNo,
                        outpatientNo: existing.outpatientNo,
                        createdAt: existing.createdAt,
                        createdBy: existing.createdBy,
                        userId: existing.userId || existing.createdBy,
                        userRole: existing.userRole,
                        isAdmin: existing.isAdmin,
                        updatedAt: nowIso
                    };
                    updatedExisting.push(newPrescription);
                    savedPrescriptions.push(newPrescription);
                } else {
                    newOnes.push(p);
                }
            }

            // 新建：写回前重读最新列表（捕捉窗口期其他设备保存的处方），
            // 基于最新列表分配编号，并与最新列表按 id 合并写回（他人新增不丢）
            if (newOnes.length > 0) {
                const d1On = isD1Enabled(context.env);
                const db = getDB(context.env);
                const fresh = await loadAllPrescriptions(kv, targetClinicId);
                // ★ D1 编号分配（事务原子递增，根治重号），KV 兜底用计数器
                const nos = d1On && db
                    ? await d1AllocateNos(db, targetClinicId, newOnes.length)
                    : await allocatePrescriptionNos(kv, targetClinicId, fresh, newOnes.length);
                const newSaved = [];

                newOnes.forEach((p, i) => {
                    const outpatientNo = nos[i];
                    const newPrescription = {
                        ...p,
                        // 兜底 id：时间戳+序号+随机后缀，防多设备同毫秒保存 id 撞车互相覆盖
                        id: p.id || (Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2, 8)),
                        prescriptionNo: outpatientNo,
                        outpatientNo: outpatientNo,
                        createdAt: p.createdAt || nowIso,
                        updatedAt: nowIso,
                        createdBy: p.createdBy || currentUser.username,
                        userId: p.createdBy || currentUser.username,
                        userRole: p.userRole || currentUser.role,
                        isAdmin: p.isAdmin !== undefined ? p.isAdmin : currentUser.isAdmin
                    };
                    newSaved.push(newPrescription);
                    savedPrescriptions.push(newPrescription);
                });

                // ★ 按 id 合并：以最新列表为底，本请求的更新与新增覆盖同 id 项，
                //   其他设备窗口期新增的处方（不在本请求集合内）原样保留
                const idMap = new Map();
                fresh.forEach(p => idMap.set(String(p.id), p));
                for (const p of updatedExisting) idMap.set(String(p.id), p);
                for (const p of newSaved) idMap.set(String(p.id), p);
                prescriptions = Array.from(idMap.values());
            } else {
                for (const p of updatedExisting) {
                    const idx = prescriptions.findIndex(x => x.id.toString() === String(p.id));
                    if (idx >= 0) prescriptions[idx] = p;
                }
            }

            // P1-4 排序一致性：保存后按 createdAt 倒序排序
            prescriptions.sort((a, b) => {
                const timeA = new Date(a.createdAt || a.date || 0).getTime();
                const timeB = new Date(b.createdAt || b.date || 0).getTime();
                if (timeB !== timeA) return timeB - timeA;
                const noA = a.outpatientNo || a.prescriptionNo || '';
                const noB = b.outpatientNo || b.prescriptionNo || '';
                return noB.localeCompare(noA);
            });

            // ★ D1 双写：逐条写入 D1 + KV（按日期分 key）
            const d1On = isD1Enabled(context.env);
            const db = getDB(context.env);
            let d1WriteFailed = false;
            let d1Error = null;
            for (const p of savedPrescriptions) {
                const r = await dualWritePrescription(kv, db, d1On, targetClinicId, p);
                if (r && r.d1Ok === false) { d1WriteFailed = true; d1Error = r.d1Error || d1Error; }
            }

            const nextPrescriptionNo = await peekNextPrescriptionNo(kv, targetClinicId, prescriptions);

            return json({
                success: true,
                data: prescriptions,
                savedPrescription: savedPrescriptions[0],
                count: prescriptions.length,
                nextPrescriptionNo,
                nextClinicNo: nextPrescriptionNo,
                currentUsername: currentUser.username,
                isAdmin: currentUser.isAdmin,
                userRole: currentUser.role,
                // ★ 2026-10-20 存储实况回传：D1 写入失败时客户端**不得**把该 op 当成功删除
                //   （否则角标显示"已同步"，而读路径 D1 优先 → 其它端看不到该方）。
                storedIn: d1WriteFailed ? 'kv' : (d1On && db ? 'd1+kv' : 'kv'),
                d1WriteFailed: d1WriteFailed || undefined,
                d1Error: d1WriteFailed ? d1Error : undefined
            });
        }

        // DELETE - 删除处方（软删除到回收站）
        if (method === 'DELETE') {
            const prescriptionId = url.searchParams.get('id');
            const isPermanent = url.searchParams.get('permanent') === 'true';

            if (!prescriptionId) {
                return json({ success: false, error: 'Missing prescription ID' }, 400, context.request);
            }

            // ★ 二期：首登强制改密写闸——DELETE（软删/永久删）与 POST 写动作同闸，
            //   只读 GET 放行；平台管理员不受影响。
            if (await userMustChangePassword(context.env, currentUser)) {
                return json({
                    success: false,
                    code: 'MUST_CHANGE_PASSWORD',
                    error: '首次登录请先修改密码后再操作'
                }, 403, context.request);
            }

            const d1On = isD1Enabled(context.env);
            const db = getDB(context.env);

            // 永久删除：从回收站彻底删除
            if (isPermanent) {
                // ★ 2026-10-19 永久删除墓碑：D1 行/回收站项删除后仍留 KV 墓碑（仅 id+时间），
                //   供增量同步下发、并阻止离线设备重放旧 upsert 复活。
                const permanentNowIso = getBeijingTime().toISOString();
                const permanentKey = permanentTombstoneKey(KV_TRASH);
                if (d1On && db) {
                    const existing = await d1GetById(db, targetClinicId, prescriptionId);
                    if (!existing || !existing.deletedAt) {
                        return json({ success: false, error: '回收站中未找到此处方' }, 404, context.request);
                    }
                    if (ownerNames.indexOf(existing.createdBy) === -1 && !isAdmin(currentUser)) {
                        return json({ success: false, error: '无权删除此处方' }, 403, context.request);
                    }
                    await d1PermanentDelete(db, targetClinicId, prescriptionId);
                    // 同步 KV 回收站
                    let trash = (await kv.get(KV_TRASH, 'json')) || [];
                    const tIdx = trash.findIndex(p => String(p.id) === String(prescriptionId));
                    if (tIdx >= 0) { trash.splice(tIdx, 1); await kv.put(KV_TRASH, JSON.stringify(trash)); }
                    await addPermanentTombstone(kv, permanentKey, prescriptionId, permanentNowIso);
                    await writeAuditLog(kv, targetClinicId, currentUser.username, currentUser.role, 'prescription_permanent_delete', prescriptionId, context, { patientName: existing.patientName });
                    return json({ success: true, message: '处方已永久删除' }, 200, context.request);
                }

                let trash = (await kv.get(KV_TRASH, 'json')) || [];
                const idx = trash.findIndex(p => p.id.toString() === prescriptionId.toString());
                if (idx === -1) {
                    return json({ success: false, error: '回收站中未找到此处方' }, 404, context.request);
                }

                const prescription = trash[idx];
                if (ownerNames.indexOf(prescription.createdBy) === -1 && !isAdmin(currentUser)) {
                    return json({ success: false, error: '无权删除此处方' }, 403, context.request);
                }

                trash.splice(idx, 1);
                await kv.put(KV_TRASH, JSON.stringify(trash));
                await addPermanentTombstone(kv, permanentKey, prescriptionId, permanentNowIso);

                // P1-2：审计日志
                await writeAuditLog(kv, targetClinicId, currentUser.username, currentUser.role, 'prescription_permanent_delete', prescriptionId, context, { patientName: prescription.patientName });

                return json({ success: true, message: '处方已永久删除' }, 200, context.request);
            }

            // 软删除：移入回收站
            // ★ 2026-10-19 时间戳归一：本次软删的 D1 deleted_at 与 KV 回收站 deletedAt
            //   共用同一个 nowIso（伪北京 UTC），避免两边差 8h 导致增量同步漏墓碑。
            const softDeleteNowIso = getBeijingTime().toISOString();
            let prescription;
            if (d1On && db) {
                // ★ D1 软删除：UPDATE deleted_at = nowIso
                const existing = await d1GetById(db, targetClinicId, prescriptionId);
                if (!existing || existing.deletedAt) {
                    return json({ success: false, error: 'Prescription not found' }, 404, context.request);
                }
                if (ownerNames.indexOf(existing.createdBy) === -1 && !isAdmin(currentUser)) {
                    return json({ success: false, error: '无权删除此处方' }, 403, context.request);
                }
                await d1SoftDelete(db, targetClinicId, prescriptionId, currentUser.username, softDeleteNowIso);
                prescription = existing;
                // 同步 KV：从日期 key 移除 + 加入回收站
                await deletePrescriptionById(kv, targetClinicId, prescriptionId);
            } else {
                // ★ 2026-09-10 按日期分 key：从所有日期 key 中查找并删除
                prescription = await deletePrescriptionById(kv, targetClinicId, prescriptionId);
                if (!prescription) {
                    return json({ success: false, error: 'Prescription not found' }, 404, context.request);
                }
                if (ownerNames.indexOf(prescription.createdBy) === -1 && !isAdmin(currentUser)) {
                    return json({ success: false, error: '无权删除此处方' }, 403, context.request);
                }
            }

            let trash = (await kv.get(KV_TRASH, 'json')) || [];
            trash.unshift({
                ...prescription,
                deletedAt: softDeleteNowIso,
                deletedBy: currentUser.username
            });
            if (trash.length > 10000) {
                trash = trash.slice(0, 10000);
            }
            await kv.put(KV_TRASH, JSON.stringify(trash));

            // P1-2：审计日志
            await writeAuditLog(kv, targetClinicId, currentUser.username, currentUser.role, 'prescription_soft_delete', prescriptionId, context, { patientName: prescription.patientName });

            return json({ success: true, message: '处方已移入回收站，可恢复', softDeleted: true }, 200, context.request);
        }

        return json({ success: false, error: 'Method not allowed' }, 405);

    } catch (error) {
        console.error('Prescriptions API error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
