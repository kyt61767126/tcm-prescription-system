// admin-tools.js — 临时管理工具：列出所有诊所/用户/激活申请，删除测试账户
// 需要平台管理员 Bearer token（Authorization: Bearer <token>）
// 安全：仅允许 platform_admin 角色调用；删除操作需传 confirm=true
import { parseAuthHeader, isPlatformAdmin, KV_SYSTEM_CLINICS, KV_SYSTEM_CONFIG } from './_lib/auth.js';
import { getKV, listAllKeys } from './_lib/kv.js';

export async function onRequest(context) {
    const { request } = context;
    const kv = getKV(context);
    if (!kv) return Response.json({ success: false, error: 'KV未绑定' }, { status: 500 });

    // ====== 鉴权：仅允许平台管理员 ======
    const auth = parseAuthHeader(request);
    if (!auth.success) return Response.json({ success: false, error: auth.error || '未登录' }, { status: 401 });
    if (!isPlatformAdmin(auth.user.role)) {
        return Response.json({ success: false, error: '无权限，仅平台管理员可操作' }, { status: 403 });
    }

    const url = new URL(request.url);
    const action = url.searchParams.get('action') || 'list';

    try {
        // ====== 1) LIST：列出诊所/用户/激活申请 ======
        if (action === 'list') {
            const clinics = (await kv.get(KV_SYSTEM_CLINICS, 'json')) || [];
            const reqIndex = (await kv.get('admin_req_index', 'json')) || [];

            const clinicsDetail = [];
            for (const c of clinics) {
                const users = (await kv.get(`clinic:${c.id}:users`, 'json')) || [];
                const prescCount = (await kv.get(`clinic:${c.id}:prescriptions`, 'json') || []).length;
                clinicsDetail.push({
                    id: c.id,
                    name: c.name,
                    edition: c.edition || '(empty)',
                    activationType: c.activationType || null,
                    status: c.status,
                    source: c.source || null,
                    createdAt: c.createdAt,
                    updatedAt: c.updatedAt,
                    userCount: users.length,
                    users: users.map(u => ({
                        username: u.username,
                        phone: u.phone,
                        name: u.name,
                        role: u.role,
                        cloudEnabled: u.cloudEnabled,
                        allowedMode: u.allowedMode,
                        createdAt: u.createdAt
                    })),
                    prescriptionCount: prescCount
                });
            }

            const reqsDetail = [];
            for (const rid of reqIndex.slice(0, 50)) {
                const r = await kv.get(`admin_req:${rid}`, 'json');
                if (r) reqsDetail.push({
                    id: rid,
                    phone: r.phone,
                    clinicName: r.clinicName,
                    adminName: r.adminName || null,
                    type: r.type || r.edition || null,
                    status: r.status,
                    createdAt: r.createdAt,
                    activatedAt: r.activatedAt || null
                });
            }

            const allKeys = await listAllKeys(kv);
            return Response.json({
                success: true,
                summary: {
                    totalClinics: clinics.length,
                    totalRequests: reqIndex.length,
                    totalKVKeys: allKeys.length
                },
                clinics: clinicsDetail,
                activationRequests: reqsDetail,
                kvKeyPrefixStats: groupKeyPrefixes(allKeys)
            });
        }

        // ====== 2) DELETE_CLINIC：删除指定诊所（及其用户/处方/药品等全部数据）======
        if (action === 'delete_clinic') {
            const clinicId = (url.searchParams.get('clinicId') || '').trim();
            const confirm = url.searchParams.get('confirm') === 'true';
            if (!clinicId) return Response.json({ success: false, error: '缺少clinicId参数' }, { status: 400 });

            const clinics = (await kv.get(KV_SYSTEM_CLINICS, 'json')) || [];
            const idx = clinics.findIndex(c => c.id === clinicId);
            if (idx === -1) return Response.json({ success: false, error: '诊所不存在' }, { status: 404 });
            const clinic = clinics[idx];

            // 找到该诊所下所有KV键
            const allKeys = await listAllKeys(kv);
            const clinicKeys = allKeys.filter(k => k.startsWith(`clinic:${clinicId}:`));
            const deleted = [];

            if (confirm) {
                // 1) 从clinics列表移除
                clinics.splice(idx, 1);
                await kv.put(KV_SYSTEM_CLINICS, JSON.stringify(clinics));
                deleted.push(KV_SYSTEM_CLINICS + ' 更新');

                // 2) 删除该诊所所有KV键
                for (const k of clinicKeys) {
                    await kv.delete(k);
                    deleted.push(k);
                }
            }

            return Response.json({
                success: true,
                confirmed: confirm,
                wouldDelete: {
                    clinic: { id: clinic.id, name: clinic.name, edition: clinic.edition },
                    clinicKVKeys: clinicKeys.length,
                    clinicKeysPreview: clinicKeys.slice(0, 20)
                },
                deletedKeys: deleted.length,
                deletedPreview: deleted.slice(0, 20)
            });
        }

        // ====== 3) DELETE_REQUEST：删除指定激活申请 ======
        if (action === 'delete_request') {
            const reqId = (url.searchParams.get('reqId') || '').trim();
            const confirm = url.searchParams.get('confirm') === 'true';
            if (!reqId) return Response.json({ success: false, error: '缺少reqId参数' }, { status: 400 });

            const reqIndex = (await kv.get('admin_req_index', 'json')) || [];
            const record = await kv.get(`admin_req:${reqId}`, 'json');
            if (!record) return Response.json({ success: false, error: '申请记录不存在' }, { status: 404 });

            const idx = reqIndex.indexOf(reqId);
            if (confirm) {
                if (idx !== -1) {
                    reqIndex.splice(idx, 1);
                    await kv.put('admin_req_index', JSON.stringify(reqIndex));
                }
                await kv.delete(`admin_req:${reqId}`);
            }

            return Response.json({
                success: true,
                confirmed: confirm,
                wouldDelete: {
                    id: reqId,
                    phone: record.phone,
                    clinicName: record.clinicName,
                    type: record.type || record.edition,
                    status: record.status
                }
            });
        }

        return Response.json({
            success: false,
            error: '未知action，支持：list / delete_clinic / delete_request'
        }, { status: 400 });

    } catch (e) {
        console.error('[admin-tools] error:', e);
        return Response.json({ success: false, error: e.message, stack: e.stack }, { status: 500 });
    }
}

function groupKeyPrefixes(keys) {
    const stats = {};
    for (const k of keys) {
        const prefix = k.split(':').slice(0, 2).join(':');
        stats[prefix] = (stats[prefix] || 0) + 1;
    }
    return stats;
}
