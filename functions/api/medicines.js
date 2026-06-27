// ============================================================================
// 药品库 API（多诊所分区版 + 优先使用标记）
// ============================================================================
// 端点契约：
//   GET    /api/medicines                      获取本诊所药品库（需登录 + clinicId）
//   POST   /api/medicines                      保存本诊所药品库（仅 clinic_admin）
//   POST   /api/medicines?medicine=priority    切换药材优先使用标记（仅 clinic_admin）
// ============================================================================
import {
    ROLE, clinicKey, parseAuthHeader,
    corsResponse, handleOptions, getKV
} from '../_lib/auth.js';

function getDefaultMedicines() {
    return [
        { id: 1, name: "麻黄", code: "mh", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0, priority_use: false },
        { id: 2, name: "桂枝", code: "gz", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0, priority_use: false },
        { id: 3, name: "杏仁", code: "xr", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0, priority_use: false },
        { id: 4, name: "甘草", code: "gc", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0, priority_use: false },
        { id: 5, name: "石膏", code: "sg", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0, priority_use: false },
        { id: 6, name: "知母", code: "zm", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0, priority_use: false },
        { id: 7, name: "黄连", code: "hl", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0, priority_use: false },
        { id: 8, name: "黄芩", code: "hq", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0, priority_use: false },
        { id: 9, name: "黄柏", code: "hb", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0, priority_use: false },
        { id: 10, name: "栀子", code: "zz", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0, priority_use: false }
    ];
}

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const method = request.method;
    const query = url.searchParams;

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

        // 平台总管理员不参与诊所药品库业务（仅通过平台管理后台统一下发）
        if (currentUser && currentUser.isPlatformAdmin) {
            return corsResponse({ success: false, error: '平台总管理员不参与诊所药品库业务' }, { status: 403 });
        }

        // 所有药品库操作都需要登录 + 属于某诊所
        if (!currentUser || !currentUser.clinicId) {
            return corsResponse({ success: false, error: '未授权访问，请先登录' }, { status: 401 });
        }

        const KV_MEDICINES_KEY = clinicKey(currentUser.clinicId, 'medicines');

        // ===== 优先使用标记切换 =====
        if (query.get('medicine') === 'priority') {
            // 仅 clinic_admin 可切换优先标记
            if (!currentUser.isClinicAdmin) {
                return corsResponse({ success: false, error: '权限不足，仅诊所管理员可切换优先标记' }, { status: 403 });
            }
            if (method !== 'POST' && method !== 'PUT') {
                return corsResponse({ success: false, error: 'Method not allowed' }, { status: 405 });
            }
            let body;
            try {
                body = await request.json();
            } catch (error) {
                return corsResponse({ success: false, error: '请求数据格式错误' }, { status: 400 });
            }
            if (body.medicineId === undefined || body.priorityUse === undefined) {
                return corsResponse({ success: false, error: '缺少 medicineId 或 priorityUse 参数' }, { status: 400 });
            }
            let medicines = await kv.get(KV_MEDICINES_KEY, 'json');
            if (!medicines || !Array.isArray(medicines)) {
                return corsResponse({ success: false, error: '药品库为空' }, { status: 404 });
            }
            const idx = medicines.findIndex(m => m.id === body.medicineId);
            if (idx < 0) {
                return corsResponse({ success: false, error: '未找到指定药材' }, { status: 404 });
            }
            medicines[idx].priority_use = !!body.priorityUse;
            await kv.put(KV_MEDICINES_KEY, JSON.stringify(medicines));
            return corsResponse({
                success: true,
                message: '优先使用标记已更新',
                medicine: medicines[idx]
            });
        }

        // ===== GET 获取药品库 =====
        if (method === 'GET') {
            let medicines = await kv.get(KV_MEDICINES_KEY, 'json');
            if (!medicines || !Array.isArray(medicines) || medicines.length === 0) {
                // 新诊所首次访问，初始化默认药品库
                medicines = getDefaultMedicines();
                await kv.put(KV_MEDICINES_KEY, JSON.stringify(medicines));
            }
            return corsResponse({ success: true, data: medicines, count: medicines.length });
        }

        // ===== POST/PUT 保存药品库（全量覆盖） =====
        if (method === 'POST' || method === 'PUT') {
            // 仅 clinic_admin 可写
            if (!currentUser.isClinicAdmin) {
                return corsResponse({ success: false, error: '权限不足，仅诊所管理员可管理药品库' }, { status: 403 });
            }
            let body;
            try {
                body = await request.json();
            } catch (error) {
                return corsResponse({ success: false, error: '请求数据格式错误' }, { status: 400 });
            }
            if (!body.medicines || !Array.isArray(body.medicines)) {
                return corsResponse({ success: false, error: '无效的药品数据' }, { status: 400 });
            }
            // 确保每条药材都有 priority_use 字段（兼容旧数据）
            const normalized = body.medicines.map(m => ({
                ...m,
                priority_use: m.priority_use === undefined ? false : !!m.priority_use
            }));
            await kv.put(KV_MEDICINES_KEY, JSON.stringify(normalized));
            return corsResponse({
                success: true,
                message: '药品库保存成功',
                count: normalized.length,
                clinicId: currentUser.clinicId
            });
        }

        return corsResponse({ success: false, error: 'Method not allowed' }, { status: 405 });
    } catch (error) {
        console.error('Medicines API error:', error);
        return corsResponse({
            success: false,
            error: error.message || 'Internal server error',
            stack: error.stack ? error.stack.split('\n').slice(0, 5).join('\n') : null
        }, { status: 500 });
    }
}
