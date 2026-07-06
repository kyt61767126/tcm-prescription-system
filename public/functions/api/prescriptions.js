import { parseAuthHeader, isPlatformAdmin, isClinicAdmin, isAdmin } from './_lib/auth.js';

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    };
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

function getKV(context) {
    return context.env.KV ||
           context.env.TCM_PRESCRIPTION_KV ||
           context.env['tcm-prescription-kv'] ||
           context.env['TCM-PRESCRIPTION-KV'] ||
           context.env.TCM_KV ||
           context.env.PRESCRIPTION_KV;
}

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

// 生成处方编号（诊所全局每日统一，YYMMDD + 2位序号）
async function generatePrescriptionNo(kv, clinicId, username) {
    const now = getBeijingTime();
    const yymmdd = formatBeijingDateYYMMDD(now);
    const seqKey = `clinic:${clinicId}:prescription_seq:${yymmdd}`;
    const userSeqKey = `clinic:${clinicId}:seq:${username}:daily:${yymmdd}`;

    let seq = parseInt(await kv.get(seqKey) || '0', 10);
    seq += 1;
    await kv.put(seqKey, seq.toString());
    await kv.put(userSeqKey, seq.toString());

    return yymmdd + String(seq).padStart(2, '0');
}

// 预览下一个编号（不递增）
async function peekNextPrescriptionNo(kv, clinicId) {
    const now = getBeijingTime();
    const yymmdd = formatBeijingDateYYMMDD(now);
    const seqKey = `clinic:${clinicId}:prescription_seq:${yymmdd}`;
    let seq = parseInt(await kv.get(seqKey) || '0', 10);
    seq += 1;
    return yymmdd + String(seq).padStart(2, '0');
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
        const KV_PRESCRIPTIONS = `clinic:${targetClinicId}:prescriptions`;
        const KV_TRASH = `clinic:${targetClinicId}:prescriptions_trash`;

        // GET - 获取处方列表
        if (method === 'GET') {
            // 回收站列表
            if (url.searchParams.get('trash') === 'true') {
                let trash = (await kv.get(KV_TRASH, 'json')) || [];
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

            let prescriptions = (await kv.get(KV_PRESCRIPTIONS, 'json')) || [];

            // 按角色筛选
            let filtered = prescriptions;
            if (!isAdmin(currentUser)) {
                filtered = prescriptions.filter(p => p.createdBy === currentUser.username);
            }

            // 按编号倒序排序
            filtered.sort((a, b) => {
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
            // 恢复处方：POST ?restore=true&id=xxx
            if (url.searchParams.get('restore') === 'true') {
                const prescriptionId = url.searchParams.get('id');
                if (!prescriptionId) {
                    return json({ success: false, error: 'Missing prescription ID' }, 400);
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
                let prescriptions = (await kv.get(KV_PRESCRIPTIONS, 'json')) || [];
                const exists = prescriptions.some(p => p.id.toString() === prescriptionId.toString());
                if (!exists) {
                    prescriptions.push(restored);
                }
                await kv.put(KV_PRESCRIPTIONS, JSON.stringify(prescriptions));

                return json({ success: true, message: '处方已恢复', data: restored });
            }

            // 保存处方
            let body;
            try {
                body = await context.request.json();
            } catch (error) {
                return json({ success: false, error: 'Failed to parse request body: ' + error.message }, 400);
            }

            if (!body.prescription) {
                return json({ success: false, error: 'Missing prescription data' }, 400);
            }

            let prescriptions = (await kv.get(KV_PRESCRIPTIONS, 'json')) || [];
            const now = getBeijingTime();
            const nowIso = now.toISOString();

            let prescriptionList = Array.isArray(body.prescription) ? body.prescription : [body.prescription];
            const savedPrescriptions = [];

            for (const p of prescriptionList) {
                const outpatientNo = await generatePrescriptionNo(kv, targetClinicId, currentUser.username);
                const newPrescription = {
                    ...p,
                    id: p.id || Date.now(),
                    prescriptionNo: outpatientNo,
                    outpatientNo: outpatientNo,
                    createdAt: p.createdAt || nowIso,
                    updatedAt: nowIso,
                    createdBy: currentUser.username,
                    userId: currentUser.username,
                    userRole: currentUser.role,
                    isAdmin: currentUser.isAdmin
                };
                savedPrescriptions.push(newPrescription);
            }

            // 合并并去重
            const idMap = new Map();
            [...prescriptions, ...savedPrescriptions].forEach(p => {
                idMap.set(p.id, p);
            });
            prescriptions = Array.from(idMap.values());

            // 按编号倒序排序
            prescriptions.sort((a, b) => {
                const noA = a.outpatientNo || a.prescriptionNo || '';
                const noB = b.outpatientNo || b.prescriptionNo || '';
                return noB.localeCompare(noA);
            });

            await kv.put(KV_PRESCRIPTIONS, JSON.stringify(prescriptions));

            const nextPrescriptionNo = await peekNextPrescriptionNo(kv, targetClinicId);

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
                return json({ success: false, error: 'Missing prescription ID' }, 400);
            }

            // 永久删除：从回收站彻底删除
            if (isPermanent) {
                let trash = (await kv.get(KV_TRASH, 'json')) || [];
                const idx = trash.findIndex(p => p.id.toString() === prescriptionId.toString());
                if (idx === -1) {
                    return json({ success: false, error: '回收站中未找到此处方' }, 404);
                }

                const prescription = trash[idx];
                if (prescription.createdBy !== currentUser.username && !isAdmin(currentUser)) {
                    return json({ success: false, error: '无权删除此处方' }, 403);
                }

                trash.splice(idx, 1);
                await kv.put(KV_TRASH, JSON.stringify(trash));

                return json({ success: true, message: '处方已永久删除' });
            }

            // 软删除：移入回收站
            let prescriptions = (await kv.get(KV_PRESCRIPTIONS, 'json')) || [];
            const idx = prescriptions.findIndex(p => p.id.toString() === prescriptionId.toString());
            if (idx === -1) {
                return json({ success: false, error: 'Prescription not found' }, 404);
            }

            const prescription = prescriptions[idx];
            if (prescription.createdBy !== currentUser.username && !isAdmin(currentUser)) {
                return json({ success: false, error: '无权删除此处方' }, 403);
            }

            prescriptions.splice(idx, 1);
            await kv.put(KV_PRESCRIPTIONS, JSON.stringify(prescriptions));

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

            return json({ success: true, message: '处方已移入回收站，可恢复', softDeleted: true });
        }

        return json({ success: false, error: 'Method not allowed' }, 405);

    } catch (error) {
        console.error('Prescriptions API error:', error);
        return json({ success: false, error: error.message || 'Internal server error' }, 500);
    }
}
