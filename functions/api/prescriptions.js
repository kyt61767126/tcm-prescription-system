import { parseAuthHeader, isPlatformAdmin, isClinicAdmin, isAdmin } from './_lib/auth.js';
import { getKV } from './_lib/kv.js';

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

// P1-2 安全增强：操作审计日志（与 users.js 一致）
async function writeAuditLog(kv, clinicId, username, role, action, target, request, extra = {}) {
    try {
        const date = new Date().toISOString().split('T')[0];
        const key = `audit_log:${clinicId || 'platform'}:${date}`;
        const logs = (await kv.get(key, 'json')) || [];
        logs.push({
            timestamp: new Date().toISOString(),
            username,
            role,
            action,
            target,
            ip: request?.headers?.get('CF-Connecting-IP') || 'unknown',
            userAgent: request?.headers?.get('User-Agent') || 'unknown',
            ...extra
        });
        if (logs.length > 1000) logs.splice(0, logs.length - 1000);
        await kv.put(key, JSON.stringify(logs), { expirationTtl: 90 * 24 * 60 * 60 });
    } catch (e) {
        console.error('writeAuditLog error:', e);
    }
}

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
                // ★ P2-D 修复：解析错误详情仅记服务端日志，客户端返回通用提示
                console.error('[prescriptions] 请求体解析失败:', error && error.message);
                return json({ success: false, error: '请求数据格式错误，请稍后再试' }, 400, context.request);
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
                // 检查处方是否已存在（按id匹配）
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
                    savedPrescriptions.push(newPrescription);
                } else {
                    // 不存在：生成新编号
                    const outpatientNo = await generatePrescriptionNo(kv, targetClinicId, currentUser.username);
                    const newPrescription = {
                        ...p,
                        id: p.id || Date.now(),
                        prescriptionNo: outpatientNo,
                        outpatientNo: outpatientNo,
                        createdAt: p.createdAt || nowIso,
                        updatedAt: nowIso,
                        createdBy: p.createdBy || currentUser.username,
                        userId: p.createdBy || currentUser.username,
                        userRole: p.userRole || currentUser.role,
                        isAdmin: p.isAdmin !== undefined ? p.isAdmin : currentUser.isAdmin
                    };
                    savedPrescriptions.push(newPrescription);
                }
            }

            // 合并并去重
            const idMap = new Map();
            [...prescriptions, ...savedPrescriptions].forEach(p => {
                idMap.set(p.id, p);
            });
            prescriptions = Array.from(idMap.values());

            // P1-4 排序一致性：保存后按 createdAt 倒序排序
            prescriptions.sort((a, b) => {
                const timeA = new Date(a.createdAt || a.date || 0).getTime();
                const timeB = new Date(b.createdAt || b.date || 0).getTime();
                if (timeB !== timeA) return timeB - timeA;
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
                return json({ success: false, error: 'Missing prescription ID' }, 400, context.request);
            }

            // 永久删除：从回收站彻底删除
            if (isPermanent) {
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
                await writeAuditLog(kv, targetClinicId, currentUser.username, currentUser.role, 'prescription_permanent_delete', prescriptionId, context.request, { patientName: prescription.patientName });

                return json({ success: true, message: '处方已永久删除' }, 200, context.request);
            }

            // 软删除：移入回收站
            let prescriptions = (await kv.get(KV_PRESCRIPTIONS, 'json')) || [];
            const idx = prescriptions.findIndex(p => p.id.toString() === prescriptionId.toString());
            if (idx === -1) {
                return json({ success: false, error: 'Prescription not found' }, 404, context.request);
            }

            const prescription = prescriptions[idx];
            if (prescription.createdBy !== currentUser.username && !isAdmin(currentUser)) {
                return json({ success: false, error: '无权删除此处方' }, 403, context.request);
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

            // P1-2：审计日志
            await writeAuditLog(kv, targetClinicId, currentUser.username, currentUser.role, 'prescription_soft_delete', prescriptionId, context.request, { patientName: prescription.patientName });

            return json({ success: true, message: '处方已移入回收站，可恢复', softDeleted: true }, 200, context.request);
        }

        return json({ success: false, error: 'Method not allowed' }, 405);

    } catch (error) {
        console.error('Prescriptions API error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
