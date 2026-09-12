import { parseAuthHeader, isPlatformAdmin, isClinicAdmin, isAdmin, isCashier } from './_lib/auth.js';
import { getKV, listAllKeys } from './_lib/kv.js';
import { getDB, isD1Enabled } from './_lib/d1.js';
import { writeAuditLog } from './_lib/audit-log.js';

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

    // 2) 扫描所有日期分 key，覆盖旧全量中同 id 的记录
    const prefix = getDayPrescriptionsPrefix(clinicId);
    const dayKeys = await listAllKeys(kv, prefix).catch(() => []);
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

    // 1) 先查日期分 key
    const prefix = getDayPrescriptionsPrefix(clinicId);
    const dayKeys = await listAllKeys(kv, prefix).catch(() => []);
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
// ★ 2026-09-10 D1 处方存储层（P0 迁移）
//
// 策略：USE_D1=true 时
//   - 读：D1 优先，D1 失败回退 KV
//   - 写：D1 + KV 双写（KV 作为备份，便于回滚）
//   - 编号：D1 prescription_seq 表事务原子递增（根治重号）
// ============================================================================

// 从 D1 读取全所处方（含软删除标记，调用方按需过滤）
async function d1LoadPrescriptions(db, clinicId, includeDeleted = false) {
    const sql = includeDeleted
        ? `SELECT * FROM prescriptions WHERE clinic_id = ? ORDER BY datetime(created_at) DESC`
        : `SELECT * FROM prescriptions WHERE clinic_id = ? AND deleted_at IS NULL ORDER BY datetime(created_at) DESC`;
    const result = await db.prepare(sql).bind(clinicId).all();
    if (!result || !result.success) return [];
    return result.results.map(row => d1RowToPrescription(row));
}

// D1 行 → 处方对象（恢复 items/media_files/extra 的 JSON 解析）
function d1RowToPrescription(row) {
    const p = { ...row };
    // ★ 2026-09-12 P0 修复「删除/加载按钮失效」：D1 id 列为 TEXT（upsert 时 String(p.id) 入库），
    // 原样透传会使客户端拿到字符串 id，而客户端全链路（deleteHistory/loadHistory/deleteCase 等）
    // 均按 KV 时代数字 id 做 === 严格匹配 → 字符串≠数字 → find 落空 → 按钮静默无反应。
    // 纯数字串（Date.now() 时间戳）恢复为 Number，与 KV 回退路径类型一致。
    p.id = (typeof row.id === 'string' && /^\d+$/.test(row.id)) ? Number(row.id) : row.id;
    // D1 列名转 camelCase（与 KV 存储的字段名保持一致）
    p.patientName = row.patient_name;
    p.doctorName = row.doctor_name;
    p.createdBy = row.created_by;
    p.prescriptionNo = row.prescription_no;
    p.outpatientNo = row.outpatient_no;
    p.totalAmount = row.total_amount;
    p.feeStatus = row.fee_status;
    p.paidAt = row.paid_at;
    p.paidBy = row.paid_by;
    p.payMethod = row.pay_method;
    p.mediaFiles = row.media_files ? safeJsonParse(row.media_files, []) : [];
    p.items = row.items ? safeJsonParse(row.items, []) : [];
    p.extra = row.extra ? safeJsonParse(row.extra, {}) : {};
    p.deletedAt = row.deleted_at;
    p.deletedBy = row.deleted_by;
    p.clinicId = row.clinic_id;
    // 清理 D1 原始列名
    delete p.patient_name; delete p.doctor_name; delete p.created_by;
    delete p.prescription_no; delete p.outpatient_no; delete p.total_amount;
    delete p.fee_status; delete p.paid_at; delete p.paid_by; delete p.pay_method;
    delete p.media_files; delete p.clinic_id; delete p.deleted_at; delete p.deleted_by;
    return p;
}

function safeJsonParse(str, fallback) {
    try { return JSON.parse(str); } catch (e) { return fallback; }
}

// 写入/更新单条处方到 D1（upsert by id）
async function d1UpsertPrescription(db, clinicId, p) {
    await db.prepare(`
        INSERT INTO prescriptions (id, clinic_id, patient_name, doctor_name, created_by, date,
            prescription_no, outpatient_no, diagnosis, items, total_amount, fee_status,
            paid_at, paid_by, pay_method, media_files, extra, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            patient_name=excluded.patient_name, doctor_name=excluded.doctor_name,
            date=excluded.date, prescription_no=excluded.prescription_no,
            outpatient_no=excluded.outpatient_no, diagnosis=excluded.diagnosis,
            items=excluded.items, total_amount=excluded.total_amount,
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
        p.feeStatus || 'unpaid',
        p.paidAt || null,
        p.paidBy || null,
        p.payMethod || null,
        p.mediaFiles ? JSON.stringify(p.mediaFiles) : null,
        p.extra ? JSON.stringify(p.extra) : null,
        p.createdAt || new Date().toISOString(),
        p.updatedAt || null
    ).run();
}

// D1 软删除（标记 deleted_at）
async function d1SoftDelete(db, clinicId, id, deletedBy) {
    const nowIso = new Date().toISOString();
    const r = await db.prepare(
        `UPDATE prescriptions SET deleted_at = ?, deleted_by = ? WHERE id = ? AND clinic_id = ?`
    ).bind(nowIso, deletedBy, String(id), clinicId).run();
    return r && r.meta && r.meta.changes > 0;
}

// D1 恢复处方（清除 deleted_at）
async function d1Restore(db, clinicId, id) {
    const r = await db.prepare(
        `UPDATE prescriptions SET deleted_at = NULL, deleted_by = NULL WHERE id = ? AND clinic_id = ?`
    ).bind(String(id), clinicId).run();
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
async function d1MarkPaid(db, clinicId, id, paidBy, paidByName, payMethod) {
    const nowIso = new Date().toISOString();
    const r = await db.prepare(`
        UPDATE prescriptions SET fee_status='paid', paid_at=?, paid_by=?, pay_method=?
        WHERE id=? AND clinic_id=? AND (fee_status IS NULL OR fee_status != 'paid')
    `).bind(nowIso, paidBy, payMethod, String(id), clinicId).run();
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

// 双写：D1 + KV（D1 失败时仅记日志，不阻断 KV 写入）
async function dualWritePrescription(kv, db, d1On, clinicId, prescription) {
    if (d1On && db) {
        try { await d1UpsertPrescription(db, clinicId, prescription); }
        catch (e) { console.error('[D1] upsert prescription failed:', e.message); }
    }
    await upsertToDayKey(kv, clinicId, prescription);
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
                    trash = trash.filter(p => p.createdBy === currentUser.username);
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
                filtered = prescriptions.filter(p => p.createdBy === currentUser.username);
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

                // ★ D1 双写：D1 UPDATE 收费 + KV 同步
                if (d1On && db) {
                    try { await d1MarkPaid(db, targetClinicId, pid, currentUser.username, body.paidByName, payMethod); }
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

                if (d1On && db) {
                    // ★ D1 恢复：UPDATE deleted_at=NULL
                    const existing = await d1GetById(db, targetClinicId, prescriptionId);
                    if (!existing || !existing.deletedAt) {
                        return json({ success: false, error: '回收站中未找到此处方' }, 404);
                    }
                    if (existing.createdBy !== currentUser.username && !isAdmin(currentUser)) {
                        return json({ success: false, error: '无权恢复此处方' }, 403);
                    }
                    await d1Restore(db, targetClinicId, prescriptionId);
                    // 同步 KV
                    const restored = { ...existing };
                    delete restored.deletedAt;
                    delete restored.deletedBy;
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
                if (prescription.createdBy !== currentUser.username && !isAdmin(currentUser)) {
                    return json({ success: false, error: '无权恢复此处方' }, 403);
                }

                trash.splice(idx, 1);
                await kv.put(KV_TRASH, JSON.stringify(trash));

                const { deletedAt, deletedBy, ...restored } = prescription;
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
            for (const p of savedPrescriptions) {
                await dualWritePrescription(kv, db, d1On, targetClinicId, p);
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
                userRole: currentUser.role
            });
        }

        // DELETE - 删除处方（软删除到回收站）
        if (method === 'DELETE') {
            const prescriptionId = url.searchParams.get('id');
            const isPermanent = url.searchParams.get('permanent') === 'true';

            if (!prescriptionId) {
                return json({ success: false, error: 'Missing prescription ID' }, 400, context.request);
            }

            const d1On = isD1Enabled(context.env);
            const db = getDB(context.env);

            // 永久删除：从回收站彻底删除
            if (isPermanent) {
                if (d1On && db) {
                    const existing = await d1GetById(db, targetClinicId, prescriptionId);
                    if (!existing || !existing.deletedAt) {
                        return json({ success: false, error: '回收站中未找到此处方' }, 404, context.request);
                    }
                    if (existing.createdBy !== currentUser.username && !isAdmin(currentUser)) {
                        return json({ success: false, error: '无权删除此处方' }, 403, context.request);
                    }
                    await d1PermanentDelete(db, targetClinicId, prescriptionId);
                    // 同步 KV 回收站
                    let trash = (await kv.get(KV_TRASH, 'json')) || [];
                    const tIdx = trash.findIndex(p => String(p.id) === String(prescriptionId));
                    if (tIdx >= 0) { trash.splice(tIdx, 1); await kv.put(KV_TRASH, JSON.stringify(trash)); }
                    await writeAuditLog(kv, targetClinicId, currentUser.username, currentUser.role, 'prescription_permanent_delete', prescriptionId, context, { patientName: existing.patientName });
                    return json({ success: true, message: '处方已永久删除' }, 200, context.request);
                }

                let trash = (await kv.get(KV_TRASH, 'json')) || [];
                const idx = trash.findIndex(p => p.id.toString() === prescriptionId.toString());
                if (idx === -1) {
                    return json({ success: false, error: '回收站中未找到此处方' }, 404, context.request);
                }

                const prescription = trash[idx];
                if (prescription.createdBy !== currentUser.username && !isAdmin(currentUser)) {
                    return json({ success: false, error: '无权删除此处方' }, 403, context.request);
                }

                trash.splice(idx, 1);
                await kv.put(KV_TRASH, JSON.stringify(trash));

                // P1-2：审计日志
                await writeAuditLog(kv, targetClinicId, currentUser.username, currentUser.role, 'prescription_permanent_delete', prescriptionId, context, { patientName: prescription.patientName });

                return json({ success: true, message: '处方已永久删除' }, 200, context.request);
            }

            // 软删除：移入回收站
            let prescription;
            if (d1On && db) {
                // ★ D1 软删除：UPDATE deleted_at
                const existing = await d1GetById(db, targetClinicId, prescriptionId);
                if (!existing || existing.deletedAt) {
                    return json({ success: false, error: 'Prescription not found' }, 404, context.request);
                }
                if (existing.createdBy !== currentUser.username && !isAdmin(currentUser)) {
                    return json({ success: false, error: '无权删除此处方' }, 403, context.request);
                }
                await d1SoftDelete(db, targetClinicId, prescriptionId, currentUser.username);
                prescription = existing;
                // 同步 KV：从日期 key 移除 + 加入回收站
                await deletePrescriptionById(kv, targetClinicId, prescriptionId);
            } else {
                // ★ 2026-09-10 按日期分 key：从所有日期 key 中查找并删除
                prescription = await deletePrescriptionById(kv, targetClinicId, prescriptionId);
                if (!prescription) {
                    return json({ success: false, error: 'Prescription not found' }, 404, context.request);
                }
                if (prescription.createdBy !== currentUser.username && !isAdmin(currentUser)) {
                    return json({ success: false, error: '无权删除此处方' }, 403, context.request);
                }
            }

            let trash = (await kv.get(KV_TRASH, 'json')) || [];
            trash.unshift({
                ...prescription,
                deletedAt: getBeijingTime().toISOString(),
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
