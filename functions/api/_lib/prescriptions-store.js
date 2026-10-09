// ============================================================================
//  prescriptions-store.js — D1 处方读取共享库
//
//  背景：★ 2026-09-15 登录提速——登录响应携带首屏处方（省登录后
//   /prescriptions GET 一次完整网络往返 ~1s），users.js 需要复用
//   prescriptions.js 的 D1 读取与行转换逻辑，抽为共享模块。
//   与 prescriptions.js 内部实现逐字符一致（同源抽取，行为不变）。
//
//  ★ 2026-10-09 扩充：同时承载处方日期分片【显式索引】助手（KV list 配额治理），
//    prescriptions.js 与 users.js 共用（见文件末尾说明）。
// ============================================================================

import { listAllKeys } from './kv.js';

// D1 行 → 处方对象（恢复 items/media_files/extra 的 JSON 解析）
export function d1RowToPrescription(row) {
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
    // ★ 2026-10-06 诊疗费/剂数映射回 camelCase（与客户端处方对象、KV 字段名一致）；
    //   缺失列（旧库未迁移）兜底 0，绝不返回 undefined 污染统计累加
    p.registrationFee = row.registration_fee != null ? row.registration_fee : 0;
    p.doseCount = row.dose_count != null ? row.dose_count : 0;
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
    delete p.registration_fee; delete p.dose_count;
    delete p.fee_status; delete p.paid_at; delete p.paid_by; delete p.pay_method;
    delete p.media_files; delete p.clinic_id; delete p.deleted_at; delete p.deleted_by;
    return p;
}

export function safeJsonParse(str, fallback) {
    try { return JSON.parse(str); } catch (e) { return fallback; }
}

export async function d1LoadPrescriptions(db, clinicId, includeDeleted = false) {
    const sql = includeDeleted
        ? `SELECT * FROM prescriptions WHERE clinic_id = ? ORDER BY datetime(created_at) DESC`
        : `SELECT * FROM prescriptions WHERE clinic_id = ? AND deleted_at IS NULL ORDER BY datetime(created_at) DESC`;
    const result = await db.prepare(sql).bind(clinicId).all();
    if (!result || !result.success) return [];
    return result.results.map(row => d1RowToPrescription(row));
}

// ============================================================================
// ★ 2026-10-06 在线轻量迁移：确保 prescriptions 具备 registration_fee / dose_count
//
// 背景：本机 wrangler/workerd 无法启动（Windows 环境崩溃），不能走本地
// `wrangler d1 execute --file` 加列；且应用层自迁移更稳——部署后任何写请求或
// /api/migrate 调用即自动补齐，天然幂等、全区域收敛，无需人工登录控制台。
//
// 单飞：模块级 Promise 缓存，同一 isolate 只检测/执行一次；D1 ALTER ADD COLUMN
// 对存量行填 DEFAULT 0，不锁表、不丢数据。历史真值随后由 /api/migrate 从 KV 回填。
// ============================================================================
let _ensureSchemaPromise = null;

export function ensurePrescriptionSchema(db) {
    if (_ensureSchemaPromise) return _ensureSchemaPromise;
    _ensureSchemaPromise = (async () => {
        const cols = await db.prepare(`PRAGMA table_info(prescriptions)`).all();
        const names = new Set((cols.results || []).map(r => r.name));
        if (!names.has('registration_fee')) {
            await db.prepare(
                `ALTER TABLE prescriptions ADD COLUMN registration_fee REAL DEFAULT 0`
            ).run();
        }
        if (!names.has('dose_count')) {
            await db.prepare(
                `ALTER TABLE prescriptions ADD COLUMN dose_count INTEGER DEFAULT 0`
            ).run();
        }
        return true;
    })().catch(e => {
        // 失败允许下次请求重试（不清缓存会永久放弃迁移）
        _ensureSchemaPromise = null;
        throw e;
    });
    return _ensureSchemaPromise;
}

// ============================================================================
//  ★ 2026-10-09 KV list 配额治理：处方日期分片的【显式索引】
//
//  触发：Cloudflare 告警「已超过每日操作限制 —— Workers KV 免费套餐每日 list 1000 次」
//  （2026-10-09 20:38，list 操作返回 429，直到 00:00 UTC 重置）。
//
//  根因（读放大）：处方按 clinic:{id}:prescriptions:{YYMMDD} 分片存放，而读取路径用
//  listAllKeys 扫全部日期 key —— **每读一次处方 = 1 条 list**。云桌面/APP 轮询、
//  users.js 首屏处方、admin-usage 逐诊所统计各打一条，几小时即可吃光日配额。
//
//  修复：维护显式索引键 clinic:{id}:prescriptions_index = ["260101","260102",...]
//    · 读路径 = 1 次 get 索引 + 每日期 1 次 get（list 归零）；
//    · 索引缺失（首次上线 / 被清理）→ 懒回填：list 一次并写回，此后不再 list；
//    · ★ 写入顺序铁律：**先写索引、后写日期 key**。崩溃/异常最坏只留「索引里有、
//      数据还没写」——读时 get 得 null 直接跳过，下次写入自愈；绝不出现
//      「数据已写、索引没记」导致该日处方永久不可见（医疗数据不可接受）。
// ============================================================================
export function prescriptionsDayPrefix(clinicId) {
    return `clinic:${clinicId}:prescriptions:`;
}
export function prescriptionsDayKey(clinicId, yymmdd) {
    return prescriptionsDayPrefix(clinicId) + yymmdd;
}
export function prescriptionsDayIndexKey(clinicId) {
    return `clinic:${clinicId}:prescriptions_index`;
}

// 取某诊所全部日期分片 key（索引优先；索引缺失才 list 一次并回填）
export async function getPrescriptionDayKeys(kv, clinicId) {
    const prefix = prescriptionsDayPrefix(clinicId);
    const idxKey = prescriptionsDayIndexKey(clinicId);
    if (kv) {
        const idx = await kv.get(idxKey, 'json').catch(() => null);
        if (Array.isArray(idx)) {
            return idx.filter(d => typeof d === 'string' && d).map(d => prefix + d);
        }
    }
    const keys = await listAllKeys(kv, prefix).catch(() => []);
    const days = keys.map(k => k.slice(prefix.length)).filter(d => /^\d{6}$/.test(d));
    if (days.length) {
        await kv.put(idxKey, JSON.stringify(days.slice().sort())).catch(() => {});
    }
    return keys;
}

// 确保某日期已登记进索引 —— 必须在写入该日期 key【之前】调用（顺序铁律见上）
export async function ensurePrescriptionDayIndexed(kv, clinicId, yymmdd) {
    const day = String(yymmdd || '');
    if (!kv || !/^\d{6}$/.test(day)) return false;
    const prefix = prescriptionsDayPrefix(clinicId);
    const idxKey = prescriptionsDayIndexKey(clinicId);
    const idx = await kv.get(idxKey, 'json').catch(() => null);
    if (Array.isArray(idx)) {
        if (idx.includes(day)) return true;
        idx.push(day);
        idx.sort();
        try {
            await kv.put(idxKey, JSON.stringify(idx));
            return true;
        } catch (e) {
            // ★ 索引写失败 ⇒ 主动删掉索引键，让下次读取走"索引缺失 → list 完整回填"，
            //   宁可多花一条 list，也绝不留"数据已写、索引没记"的不可见窗口。
            await kv.delete(idxKey).catch(() => {});
            return false;
        }
    }
    // 索引尚不存在：懒回填（含本日期），避免"只登记本日期、漏掉历史日期"
    const keys = await listAllKeys(kv, prefix).catch(() => []);
    const days = keys.map(k => k.slice(prefix.length)).filter(d => /^\d{6}$/.test(d));
    if (!days.includes(day)) days.push(day);
    days.sort();
    try {
        await kv.put(idxKey, JSON.stringify(days));
        return true;
    } catch (e) {
        await kv.delete(idxKey).catch(() => {});
        return false;
    }
}
