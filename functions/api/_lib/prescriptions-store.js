// ============================================================================
//  prescriptions-store.js — D1 处方读取共享库
//
//  背景：★ 2026-09-15 登录提速——登录响应携带首屏处方（省登录后
//   /prescriptions GET 一次完整网络往返 ~1s），users.js 需要复用
//   prescriptions.js 的 D1 读取与行转换逻辑，抽为共享模块。
//   与 prescriptions.js 内部实现逐字符一致（同源抽取，行为不变）。
// ============================================================================

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
