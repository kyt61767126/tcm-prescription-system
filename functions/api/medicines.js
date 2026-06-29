// ============================================================================
// 药品库 API（多诊所分区版 + 平台兜底 + 优先使用标记）
// ============================================================================
// 架构说明（用户原话）：
//   "平台总管理员云端药物为兜底，各个诊所管理员可以编辑云端药物价格数量，
//    优先使用诊所自己编辑后的药物"
//
// 数据层级：
//   1) 平台兜底药材库  KV: system:platform_medicines
//      - 由 platform_admin 维护（GET/POST）
//      - 作为所有诊所的默认兜底库
//   2) 诊所药材库      KV: clinic:{clinicId}:medicines
//      - 由 clinic_admin 维护（GET/POST）
//      - 开方时优先使用诊所库（覆盖平台兜底库）
//      - 诊所首次访问且本地为空 → 从平台兜底库初始化
//      - 诊所可主动调用 sync_platform 同步平台兜底库（保留 priority_use 标记）
//
// 端点契约：
//   GET    /api/medicines                            获取药品库（platform=平台兜底, clinic=本诊所库）
//   POST   /api/medicines                            保存药品库（platform_admin=平台兜底, clinic_admin=本诊所库）
//   POST   /api/medicines?medicine=priority          切换药材优先使用标记（仅 clinic_admin）
//   POST   /api/medicines?medicine=sync_platform     诊所从平台兜底库同步覆盖本地（仅 clinic_admin）
// ============================================================================
import {
    ROLE, clinicKey, parseAuthHeader,
    corsResponse, handleOptions, getKV
} from '../_lib/auth.js';

// 平台兜底药材库 KV 键
const KV_PLATFORM_MEDICINES = 'system:platform_medicines';

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

// 标准化药材列表：确保每条都有 priority_use 字段
function normalizeMedicines(list) {
    if (!Array.isArray(list)) return [];
    return list.map(m => ({
        ...m,
        priority_use: m.priority_use === undefined ? false : !!m.priority_use
    }));
}

// 读取平台兜底库（若空则用 getDefaultMedicines 初始化）
async function getPlatformMedicines(kv) {
    let list = await kv.get(KV_PLATFORM_MEDICINES, 'json');
    if (!list || !Array.isArray(list) || list.length === 0) {
        list = getDefaultMedicines();
        await kv.put(KV_PLATFORM_MEDICINES, JSON.stringify(list));
    }
    return normalizeMedicines(list);
}

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const method = request.method;
    const query = url.searchParams;

    if (method === 'OPTIONS') return handleOptions(request);

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
        if (!currentUser) {
            return corsResponse({ success: false, error: '未授权访问，请先登录' }, { status: 401 });
        }

        // ============ 子端点：?medicine=priority 切换优先使用标记（仅诊所库） ============
        if (query.get('medicine') === 'priority') {
            if (!currentUser.isClinicAdmin) {
                return corsResponse({ success: false, error: '权限不足，仅诊所管理员可切换优先标记' }, { status: 403 });
            }
            if (method !== 'POST' && method !== 'PUT') {
                return corsResponse({ success: false, error: 'Method not allowed' }, { status: 405 });
            }
            let body;
            try { body = await request.json(); } catch (error) {
                return corsResponse({ success: false, error: '请求数据格式错误' }, { status: 400 });
            }
            if (body.medicineId === undefined || body.priorityUse === undefined) {
                return corsResponse({ success: false, error: '缺少 medicineId 或 priorityUse 参数' }, { status: 400 });
            }
            const KV_MEDICINES_KEY = clinicKey(currentUser.clinicId, 'medicines');
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

        // ============ 子端点：?medicine=sync_platform 诊所从平台兜底库同步 ============
        if (query.get('medicine') === 'sync_platform') {
            if (!currentUser.isClinicAdmin) {
                return corsResponse({ success: false, error: '权限不足，仅诊所管理员可同步平台兜底库' }, { status: 403 });
            }
            if (method !== 'POST' && method !== 'PUT') {
                return corsResponse({ success: false, error: 'Method not allowed' }, { status: 405 });
            }
            const KV_MEDICINES_KEY = clinicKey(currentUser.clinicId, 'medicines');
            // 读取平台兜底库
            const platformList = await getPlatformMedicines(kv);
            // 读取本诊所现有库（保留 priority_use 标记）
            const clinicList = await kv.get(KV_MEDICINES_KEY, 'json');
            const clinicArr = Array.isArray(clinicList) ? clinicList : [];
            // 按 id+name 建立索引，保留诊所已设置的 priority_use
            const clinicMap = new Map();
            clinicArr.forEach(m => {
                const key = (m.id !== undefined ? 'id:' + m.id : '') + '|name:' + (m.name || '');
                clinicMap.set(key, !!m.priority_use);
            });
            // 同步平台兜底库，保留 priority_use
            const synced = platformList.map(m => {
                const key = (m.id !== undefined ? 'id:' + m.id : '') + '|name:' + (m.name || '');
                const preserved = clinicMap.has(key) ? clinicMap.get(key) : !!m.priority_use;
                return { ...m, priority_use: preserved };
            });
            await kv.put(KV_MEDICINES_KEY, JSON.stringify(synced));
            return corsResponse({
                success: true,
                message: '已从平台兜底库同步至本诊所',
                data: synced,
                count: synced.length
            });
        }

        // ============ GET 获取药品库 ============
        if (method === 'GET') {
            // 平台总管理员：返回平台兜底库
            if (currentUser.isPlatformAdmin) {
                const list = await getPlatformMedicines(kv);
                return corsResponse({ success: true, data: list, count: list.length, scope: 'platform' });
            }
            // 诊所管理员/医师：返回本诊所库（若空则从平台兜底库初始化）
            if (!currentUser.clinicId) {
                return corsResponse({ success: false, error: '未绑定诊所' }, { status: 403 });
            }
            const KV_MEDICINES_KEY = clinicKey(currentUser.clinicId, 'medicines');
            let medicines = await kv.get(KV_MEDICINES_KEY, 'json');
            if (!medicines || !Array.isArray(medicines) || medicines.length === 0) {
                // 从平台兜底库初始化
                medicines = await getPlatformMedicines(kv);
                await kv.put(KV_MEDICINES_KEY, JSON.stringify(medicines));
            }
            return corsResponse({ success: true, data: medicines, count: medicines.length, scope: 'clinic' });
        }

        // ============ POST/PUT 保存药品库 ============
        if (method === 'POST' || method === 'PUT') {
            // 权限：platform_admin 可写平台兜底库；clinic_admin 可写本诊所库
            if (!currentUser.isPlatformAdmin && !currentUser.isClinicAdmin) {
                return corsResponse({ success: false, error: '权限不足，仅管理员可管理药品库' }, { status: 403 });
            }
            let body;
            try { body = await request.json(); } catch (error) {
                return corsResponse({ success: false, error: '请求数据格式错误' }, { status: 400 });
            }
            if (!body.medicines || !Array.isArray(body.medicines)) {
                return corsResponse({ success: false, error: '无效的药品数据' }, { status: 400 });
            }
            const normalized = normalizeMedicines(body.medicines);

            // 平台总管理员：保存到平台兜底库
            if (currentUser.isPlatformAdmin) {
                await kv.put(KV_PLATFORM_MEDICINES, JSON.stringify(normalized));
                return corsResponse({
                    success: true,
                    message: '平台兜底药材库保存成功',
                    count: normalized.length,
                    scope: 'platform'
                });
            }

            // 诊所管理员：保存到本诊所库
            const KV_MEDICINES_KEY = clinicKey(currentUser.clinicId, 'medicines');
            await kv.put(KV_MEDICINES_KEY, JSON.stringify(normalized));
            return corsResponse({
                success: true,
                message: '药品库保存成功',
                count: normalized.length,
                clinicId: currentUser.clinicId,
                scope: 'clinic'
            });
        }

        return corsResponse({ success: false, error: 'Method not allowed' }, { status: 405 });
    } catch (error) {
        console.error('Medicines API error:', error);
        // 安全加固：不向客户端泄露内部错误细节和 stack
        return corsResponse({
            success: false,
            error: 'Internal server error'
        }, { status: 500 });
    }
}
