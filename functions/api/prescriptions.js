// ============================================================================
// 处方 API（多诊所分区版）
// ============================================================================
// 端点契约：
//   GET    /api/prescriptions                    获取处方列表（按角色过滤）
//   GET    /api/prescriptions?trash=true         获取回收站处方
//   POST   /api/prescriptions                    保存处方（单条或批量）
//   DELETE /api/prescriptions?id=xxx             软删除到处方回收站
//   DELETE /api/prescriptions?id=xxx&permanent=true  永久删除（仅回收站中）
//   POST   /api/prescriptions?restore=true&id=xxx  从回收站恢复
// ============================================================================
import {
    ROLE, clinicKey, parseAuthHeader,
    corsResponse, handleOptions, getKV,
    getBeijingTime, formatBeijingDateYYMMDD
} from '../_lib/auth.js';

// ---------- 历史编号清洗（保留原逻辑） ----------
function cleanHistoricalPrescriptionNo(prescription, index, dateGroups) {
    // 优先使用云端全局编号（cloudSeq 字段，诊所全局自增）
    if (prescription.cloudSeq && /^\d{4,8}$/.test(prescription.cloudSeq)) {
        return prescription.cloudSeq;
    }
    let no = prescription.outpatientNo || prescription.prescriptionNo || '';
    // 已经是合法数字编号（6-8位）直接返回
    if (/^\d{6,8}$/.test(no)) return no;
    // 本地临时号（LOCAL-前缀）不做清洗，保持原样由前端显示"待同步"标记
    if (no.startsWith('LOCAL-')) return no;

    let timestamp = null;
    if (/^\d{10}$/.test(no)) timestamp = parseInt(no) * 1000;
    else if (/^\d{13}$/.test(no)) timestamp = parseInt(no);
    else if (prescription.id && /^\d{10,13}$/.test(prescription.id.toString())) {
        const idStr = prescription.id.toString();
        timestamp = idStr.length === 10 ? parseInt(idStr) * 1000 : parseInt(idStr);
    } else if (prescription.createdAt) {
        timestamp = new Date(prescription.createdAt).getTime();
    }

    if (timestamp) {
        const date = new Date(timestamp);
        const beijingDate = new Date(date.getTime() + (8 * 60 * 60 * 1000));
        const yymmdd = formatBeijingDateYYMMDD(beijingDate);
        if (!dateGroups[yymmdd]) dateGroups[yymmdd] = 0;
        dateGroups[yymmdd]++;
        return yymmdd + String(dateGroups[yymmdd]).padStart(2, '0');
    }

    const now = getBeijingTime();
    const yymmdd = formatBeijingDateYYMMDD(now);
    if (!dateGroups[yymmdd]) dateGroups[yymmdd] = 0;
    dateGroups[yymmdd]++;
    return yymmdd + String(dateGroups[yymmdd]).padStart(2, '0');
}

// ---------- 编号序列生成（按诊所分区） ----------
// 旧版：每医师每日独立编号（保留向后兼容，新处方不再使用）
async function generatePrescriptionNo(kv, clinicId, username, type) {
    const now = getBeijingTime();
    const year = now.getUTCFullYear().toString().substring(2);
    const yymmdd = formatBeijingDateYYMMDD(now);

    let storageKey, seq, prescriptionNo;
    if (type === 'yearly') {
        storageKey = clinicKey(clinicId, `seq:${username}:yearly:${year}`);
        const stored = await kv.get(storageKey);
        seq = stored ? parseInt(stored, 10) : 0;
        seq += 1;
        await kv.put(storageKey, seq.toString());
        prescriptionNo = year + seq.toString().padStart(6, '0');
    } else {
        storageKey = clinicKey(clinicId, `seq:${username}:daily:${yymmdd}`);
        const stored = await kv.get(storageKey);
        seq = stored ? parseInt(stored, 10) : 0;
        seq += 1;
        await kv.put(storageKey, seq.toString());
        prescriptionNo = yymmdd + seq.toString().padStart(2, '0');
    }
    return prescriptionNo;
}

// ---------- 新版：诊所全局唯一自增编号 ----------
// KV 键：clinic:{clinicId}:prescription_seq（整数自增）
// 返回格式：6位填充序号，如 "000001"、"000002"
// 同一诊所所有医师共用一套连续递增编号，不同诊所完全隔离
async function generateClinicGlobalSeq(kv, clinicId) {
    const seqKey = clinicKey(clinicId, 'prescription_seq');
    const stored = await kv.get(seqKey);
    let seq = stored ? parseInt(stored, 10) : 0;
    seq += 1;
    await kv.put(seqKey, seq.toString());
    return String(seq).padStart(6, '0');
}

// 预览下一编号（不自增）
async function peekNextClinicGlobalSeq(kv, clinicId) {
    const seqKey = clinicKey(clinicId, 'prescription_seq');
    const stored = await kv.get(seqKey);
    let seq = stored ? parseInt(stored, 10) : 0;
    seq += 1;
    return String(seq).padStart(6, '0');
}

// ---------- 处方去重指纹管理 ----------
// KV 键：clinic:{clinicId}:prescription_hashes
// 存储：{ [hash]: prescriptionId } 映射
// 用途：离线处方重复上传时去重，避免生成重复编号
async function getPrescriptionHashes(kv, clinicId) {
    const key = clinicKey(clinicId, 'prescription_hashes');
    const stored = await kv.get(key, 'json');
    return (stored && typeof stored === 'object') ? stored : {};
}

async function savePrescriptionHash(kv, clinicId, hash, prescriptionId) {
    const key = clinicKey(clinicId, 'prescription_hashes');
    const hashes = await getPrescriptionHashes(kv, clinicId);
    hashes[hash] = prescriptionId;
    await kv.put(key, JSON.stringify(hashes));
}

async function peekNextPrescriptionNo(kv, clinicId, username, type) {
    const now = getBeijingTime();
    const year = now.getUTCFullYear().toString().substring(2);
    const yymmdd = formatBeijingDateYYMMDD(now);

    let storageKey, seq, prescriptionNo;
    if (type === 'yearly') {
        storageKey = clinicKey(clinicId, `seq:${username}:yearly:${year}`);
        const stored = await kv.get(storageKey);
        seq = stored ? parseInt(stored, 10) : 0;
        seq += 1;
        prescriptionNo = year + seq.toString().padStart(6, '0');
    } else {
        storageKey = clinicKey(clinicId, `seq:${username}:daily:${yymmdd}`);
        const stored = await kv.get(storageKey);
        seq = stored ? parseInt(stored, 10) : 0;
        seq += 1;
        prescriptionNo = yymmdd + seq.toString().padStart(2, '0');
    }
    return prescriptionNo;
}

// ---------- 默认药品库（保留） ----------
function getDefaultMedicines() {
    return [
        { id: 1, name: "麻黄", code: "mh", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0 },
        { id: 2, name: "桂枝", code: "gz", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0 },
        { id: 3, name: "杏仁", code: "xr", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0 },
        { id: 4, name: "甘草", code: "gc", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0 },
        { id: 5, name: "石膏", code: "sg", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0 },
        { id: 6, name: "知母", code: "zm", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0 },
        { id: 7, name: "黄连", code: "hl", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0 },
        { id: 8, name: "黄芩", code: "hq", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0 },
        { id: 9, name: "黄柏", code: "hb", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0 },
        { id: 10, name: "栀子", code: "zz", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0 }
    ];
}

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const method = request.method;

    if (method === 'OPTIONS') return handleOptions();

    try {
        const kv = getKV(env);
        if (!kv) {
            return corsResponse({
                success: false,
                error: 'KV存储未配置。请在Cloudflare Pages设置中配置KV binding',
                requireSetup: true
            }, { status: 500 });
        }

        const currentUser = parseAuthHeader(request);
        // 平台总管理员不归处方业务管，直接拒绝
        if (currentUser && currentUser.isPlatformAdmin) {
            return corsResponse({ success: false, error: '平台总管理员不参与处方业务' }, { status: 403 });
        }

        // 处方相关所有端点必须登录且属于某诊所
        if (!currentUser || !currentUser.clinicId) {
            return corsResponse({
                success: false,
                error: '未授权访问，请先登录',
                requireAuth: true
            }, { status: 401 });
        }

        const clinicId = currentUser.clinicId;
        const KV_PRESCRIPTIONS_KEY = clinicKey(clinicId, 'prescriptions');
        const KV_TRASH_KEY = clinicKey(clinicId, 'prescriptions_trash');

        // ============ GET ============
        if (method === 'GET') {
            // 兼容旧编号端点
            if (url.pathname.includes('/current-prescription-no') || url.pathname.includes('/next-prescription-no')) {
                const type = url.searchParams.get('type') || 'daily';
                const now = new Date();
                const year = String(now.getFullYear()).slice(-2);
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const day = String(now.getDate()).padStart(2, '0');
                let prescriptionNo;
                if (type === 'yearly') prescriptionNo = year + '000001';
                else prescriptionNo = year + month + day + '01';
                return corsResponse({ success: true, prescriptionNo, message: 'Using fallback number (old API)' });
            }

            // 统计看板端点（管理员专用）
            if (url.searchParams.get('stats') === 'true') {
                if (!currentUser.isClinicAdmin && !currentUser.isPlatformAdmin) {
                    return corsResponse({ success: false, error: '仅管理员可查看统计' }, { status: 403 });
                }
                let prescriptions = await kv.get(KV_PRESCRIPTIONS_KEY, 'json');
                if (!prescriptions) prescriptions = [];
                // 统一用 cloudSeq 或 prescriptionNo 排序
                prescriptions.sort((a, b) => {
                    const noA = a.cloudSeq || a.prescriptionNo || '';
                    const noB = b.cloudSeq || b.prescriptionNo || '';
                    return noB.localeCompare(noA);
                });
                const now = getBeijingTime();
                const todayStr = now.toISOString().slice(0, 10);
                const monthStr = todayStr.slice(0, 7);
                const doctorStats = {};
                let todayCount = 0, monthCount = 0;
                for (const p of prescriptions) {
                    const pDate = (p.date || p.createdAt || '').slice(0, 10);
                    const doctor = p.createdBy || p.doctorName || '未知';
                    if (!doctorStats[doctor]) doctorStats[doctor] = { count: 0, todayCount: 0, monthCount: 0 };
                    doctorStats[doctor].count++;
                    if (pDate === todayStr) { todayCount++; doctorStats[doctor].todayCount++; }
                    if (pDate.startsWith(monthStr)) { monthCount++; doctorStats[doctor].monthCount++; }
                }
                return corsResponse({
                    success: true,
                    stats: {
                        total: prescriptions.length,
                        todayCount,
                        monthCount,
                        doctorStats: Object.entries(doctorStats).map(([doctor, s]) => ({ doctor, ...s }))
                    }
                });
            }

            // 回收站列表
            if (url.searchParams.get('trash') === 'true') {
                let trash = await kv.get(KV_TRASH_KEY, 'json');
                if (!trash || !Array.isArray(trash)) trash = [];
                let filteredTrash = trash;
                if (currentUser.isDoctor) {
                    filteredTrash = trash.filter(p => p.createdBy === currentUser.username);
                }
                filteredTrash.sort((a, b) => new Date(b.deletedAt || 0).getTime() - new Date(a.deletedAt || 0).getTime());
                return corsResponse({
                    success: true,
                    data: filteredTrash,
                    count: filteredTrash.length,
                    userRole: currentUser.role,
                    isAdmin: currentUser.isAdmin,
                    currentUsername: currentUser.username
                });
            }

            let prescriptions = await kv.get(KV_PRESCRIPTIONS_KEY, 'json');
            if (!prescriptions) prescriptions = [];

            // 按角色筛选：doctor 只看自己的，clinic_admin 看本诊所全部
            let filteredPrescriptions = prescriptions;
            if (currentUser.isDoctor) {
                filteredPrescriptions = prescriptions.filter(p => p.createdBy === currentUser.username);
            }

            // 编号清洗
            const sortedForSeq = [...filteredPrescriptions].sort((a, b) => {
                const idA = typeof a.id === 'number' ? a.id : 0;
                const idB = typeof b.id === 'number' ? b.id : 0;
                return idA - idB;
            });
            const dateCounter = {};
            let needsUpdate = false;
            filteredPrescriptions = sortedForSeq.map((p, index) => {
                const cleanNo = cleanHistoricalPrescriptionNo(p, index, dateCounter);
                const currentNo = p.outpatientNo || p.prescriptionNo || '';
                if (cleanNo !== currentNo) {
                    needsUpdate = true;
                    return { ...p, prescriptionNo: cleanNo, outpatientNo: cleanNo };
                }
                return p;
            });
            filteredPrescriptions.sort((a, b) => {
                const noA = a.outpatientNo || a.prescriptionNo || '';
                const noB = b.outpatientNo || b.prescriptionNo || '';
                return noB.localeCompare(noA);
            });

            if (needsUpdate) {
                const updatedPrescriptions = [...prescriptions];
                filteredPrescriptions.forEach(p => {
                    const index = updatedPrescriptions.findIndex(item => item.id === p.id);
                    if (index !== -1) updatedPrescriptions[index] = p;
                });
                await kv.put(KV_PRESCRIPTIONS_KEY, JSON.stringify(updatedPrescriptions));
            }

            const now = getBeijingTime();
            const year = now.getUTCFullYear().toString().substring(2);
            const formattedTotalCount = year + prescriptions.length.toString().padStart(6, '0');

            return corsResponse({
                success: true,
                data: filteredPrescriptions,
                count: filteredPrescriptions.length,
                totalCount: formattedTotalCount,
                userRole: currentUser.role,
                isAdmin: currentUser.isAdmin,
                currentUsername: currentUser.username,
                clinicId,
                debug: {
                    totalInKV: prescriptions.length,
                    filteredCount: filteredPrescriptions.length
                }
            });
        }

        // ============ POST（保存） ============
        if (method === 'POST' && url.searchParams.get('restore') !== 'true') {
            let body;
            try {
                body = await request.json();
            } catch (error) {
                return corsResponse({ success: false, error: 'Failed to parse request body: ' + error.message }, { status: 400 });
            }
            if (!body.prescription) {
                return corsResponse({ success: false, error: 'Missing prescription data' }, { status: 400 });
            }

            let prescriptions = await kv.get(KV_PRESCRIPTIONS_KEY, 'json');
            if (!prescriptions) prescriptions = [];

            const now = getBeijingTime();
            const nowIso = now.toISOString();
            const prescriptionList = Array.isArray(body.prescription) ? body.prescription : [body.prescription];
            const savedPrescriptions = [];

            for (const p of prescriptionList) {
                // clinic_admin 可代他人保存处方（批量上传场景），但 createdBy 默认还是 currentUser.username
                // 如果 p.createdBy 已存在且 currentUser 是 clinic_admin，允许保留（批量同步场景）
                let createdBy = currentUser.username;
                if (currentUser.isClinicAdmin && p.createdBy) {
                    createdBy = p.createdBy;
                }

                // 去重检查：前端传 prescriptionHash（离线处方指纹），已存在则跳过
                const hash = p.prescriptionHash || '';
                if (hash) {
                    const hashes = await getPrescriptionHashes(kv, clinicId);
                    if (hashes[hash]) {
                        // 重复上传，返回已有处方（不分配新编号）
                        const existing = prescriptions.find(x => x.id.toString() === hashes[hash].toString());
                        if (existing) {
                            savedPrescriptions.push(existing);
                            continue;
                        }
                    }
                }

                // 分配诊所全局唯一编号（同一诊所所有医师共用连续递增编号）
                const globalSeq = await generateClinicGlobalSeq(kv, clinicId);
                const newId = p.id || Date.now();
                const newPrescription = {
                    ...p,
                    id: newId,
                    prescriptionNo: globalSeq,
                    outpatientNo: globalSeq,
                    cloudSeq: globalSeq,
                    createdAt: p.createdAt || nowIso,
                    updatedAt: nowIso,
                    createdBy: createdBy,
                    userId: createdBy,
                    userRole: currentUser.role,
                    clinicId: clinicId
                };

                // 保存处方指纹（用于后续去重）
                if (hash) {
                    await savePrescriptionHash(kv, clinicId, hash, newId);
                }

                savedPrescriptions.push(newPrescription);
            }

            // 合并去重
            const idMap = new Map();
            [...prescriptions, ...savedPrescriptions].forEach(p => idMap.set(p.id, p));
            prescriptions = Array.from(idMap.values());
            prescriptions.sort((a, b) => {
                const noA = a.outpatientNo || a.prescriptionNo || '';
                const noB = b.outpatientNo || b.prescriptionNo || '';
                return noB.localeCompare(noA);
            });

            const nextPrescriptionNo = await peekNextClinicGlobalSeq(kv, clinicId);
            const nextClinicNo = nextPrescriptionNo; // 兼容前端字段

            await kv.put(KV_PRESCRIPTIONS_KEY, JSON.stringify(prescriptions));

            return corsResponse({
                success: true,
                data: prescriptions,
                savedPrescription: savedPrescriptions[0],
                count: prescriptions.length,
                message: 'Prescriptions saved successfully',
                nextPrescriptionNo,
                nextClinicNo,
                userRole: currentUser.role,
                isAdmin: currentUser.isAdmin,
                clinicId
            });
        }

        // ============ DELETE ============
        if (method === 'DELETE') {
            const prescriptionId = url.searchParams.get('id');
            const isPermanent = url.searchParams.get('permanent') === 'true';
            if (!prescriptionId) {
                return corsResponse({ success: false, error: 'Missing prescription ID' }, { status: 400 });
            }

            // 永久删除（从回收站）
            if (isPermanent) {
                let trash = await kv.get(KV_TRASH_KEY, 'json');
                if (!trash || !Array.isArray(trash)) trash = [];
                const prescriptionToDelete = trash.find(p => p.id.toString() === prescriptionId.toString());
                if (!prescriptionToDelete) {
                    return corsResponse({ success: false, error: '回收站中未找到此处方' }, { status: 404 });
                }
                if (prescriptionToDelete.createdBy !== currentUser.username && !currentUser.isAdmin) {
                    return corsResponse({ success: false, error: '无权删除此处方' }, { status: 403 });
                }
                trash = trash.filter(p => p.id.toString() !== prescriptionId.toString());
                await kv.put(KV_TRASH_KEY, JSON.stringify(trash));
                return corsResponse({ success: true, message: '处方已永久删除', deletedBy: currentUser.username });
            }

            // 软删除
            let prescriptions = await kv.get(KV_PRESCRIPTIONS_KEY, 'json');
            if (!prescriptions) prescriptions = [];
            const prescriptionToDelete = prescriptions.find(p => p.id.toString() === prescriptionId.toString());
            if (!prescriptionToDelete) {
                return corsResponse({ success: false, error: 'Prescription not found' }, { status: 404 });
            }
            if (prescriptionToDelete.createdBy !== currentUser.username && !currentUser.isAdmin) {
                return corsResponse({ success: false, error: '无权删除此处方' }, { status: 403 });
            }
            prescriptions = prescriptions.filter(p => p.id.toString() !== prescriptionId.toString());
            await kv.put(KV_PRESCRIPTIONS_KEY, JSON.stringify(prescriptions));

            let trash = await kv.get(KV_TRASH_KEY, 'json');
            if (!trash || !Array.isArray(trash)) trash = [];
            const nowIso = getBeijingTime().toISOString();
            trash.unshift({ ...prescriptionToDelete, deletedAt: nowIso, deletedBy: currentUser.username });
            if (trash.length > 10000) trash = trash.slice(0, 10000);
            await kv.put(KV_TRASH_KEY, JSON.stringify(trash));

            return corsResponse({
                success: true,
                message: '处方已移入回收站，可恢复',
                deletedBy: currentUser.username,
                softDeleted: true
            });
        }

        // ============ POST ?restore=true（恢复） ============
        if (method === 'POST' && url.searchParams.get('restore') === 'true') {
            const prescriptionId = url.searchParams.get('id');
            if (!prescriptionId) {
                return corsResponse({ success: false, error: 'Missing prescription ID' }, { status: 400 });
            }
            let trash = await kv.get(KV_TRASH_KEY, 'json');
            if (!trash || !Array.isArray(trash)) trash = [];
            const prescriptionToRestore = trash.find(p => p.id.toString() === prescriptionId.toString());
            if (!prescriptionToRestore) {
                return corsResponse({ success: false, error: '回收站中未找到此处方' }, { status: 404 });
            }
            if (prescriptionToRestore.createdBy !== currentUser.username && !currentUser.isAdmin) {
                return corsResponse({ success: false, error: '无权恢复此处方' }, { status: 403 });
            }
            trash = trash.filter(p => p.id.toString() !== prescriptionId.toString());
            await kv.put(KV_TRASH_KEY, JSON.stringify(trash));

            let prescriptions = await kv.get(KV_PRESCRIPTIONS_KEY, 'json');
            if (!prescriptions) prescriptions = [];
            const { deletedAt, deletedBy, ...restoredPrescription } = prescriptionToRestore;
            const exists = prescriptions.some(p => p.id.toString() === prescriptionId.toString());
            if (!exists) prescriptions.push(restoredPrescription);
            await kv.put(KV_PRESCRIPTIONS_KEY, JSON.stringify(prescriptions));

            return corsResponse({
                success: true,
                message: '处方已恢复',
                restoredBy: currentUser.username,
                data: restoredPrescription
            });
        }

        return corsResponse({ success: false, error: 'Method not allowed' }, { status: 405 });
    } catch (error) {
        console.error('Prescriptions API error:', error);
        return corsResponse({
            success: false,
            error: error.message || 'Internal server error'
        }, { status: 500 });
    }
}
