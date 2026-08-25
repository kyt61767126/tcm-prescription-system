import { parseAuthHeader, isPlatformAdmin, isClinicAdmin, isAdmin, isCashier } from './_lib/auth.js';
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
async function allocatePrescriptionNos(kv, clinicId, list, count, yymmddStr) {
    const now = getBeijingTime();
    const yymmdd = yymmddStr || formatBeijingDateYYMMDD(now);
    const seqKey = `clinic:${clinicId}:prescription_seq:${yymmdd}`;

    let seq = parseInt(await kv.get(seqKey) || '0', 10);
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

                let prescriptions = (await kv.get(KV_PRESCRIPTIONS, 'json')) || [];
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
                prescriptions[idx] = target;
                await kv.put(KV_PRESCRIPTIONS, JSON.stringify(prescriptions));

                await writeAuditLog(kv, targetClinicId, currentUser.username, currentUser.role,
                    'mark_paid', String(pid), context.request,
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
                const fresh = (await kv.get(KV_PRESCRIPTIONS, 'json')) || [];
                const nos = await allocatePrescriptionNos(kv, targetClinicId, fresh, newOnes.length);
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

            await kv.put(KV_PRESCRIPTIONS, JSON.stringify(prescriptions));

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
