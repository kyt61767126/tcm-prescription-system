// ============================================================================
// 药品库 API（多诊所分区版）
// ============================================================================
// 端点契约：
//   GET    /api/medicines              获取本诊所药品库（无需登录）
//   POST   /api/medicines              保存本诊所药品库（仅 clinic_admin）
// ============================================================================
import {
    ROLE, clinicKey, parseAuthHeader,
    corsResponse, handleOptions, getKV
} from '../_lib/auth.js';

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

        // 平台总管理员不参与诊所药品库业务
        if (currentUser && currentUser.isPlatformAdmin) {
            return corsResponse({ success: false, error: '平台总管理员不参与诊所药品库业务' }, { status: 403 });
        }

        // GET 需要登录 + 属于某诊所
        if (method === 'GET') {
            if (!currentUser || !currentUser.clinicId) {
                return corsResponse({ success: false, error: '未授权访问，请先登录' }, { status: 401 });
            }
            const KV_MEDICINES_KEY = clinicKey(currentUser.clinicId, 'medicines');
            let medicines = await kv.get(KV_MEDICINES_KEY, 'json');
            if (!medicines || !Array.isArray(medicines) || medicines.length === 0) {
                // 新诊所首次访问，初始化默认药品库
                medicines = getDefaultMedicines();
                await kv.put(KV_MEDICINES_KEY, JSON.stringify(medicines));
            }
            return corsResponse({ success: true, data: medicines, count: medicines.length });
        }

        // POST/PUT 仅诊所管理员可写
        if (method === 'POST' || method === 'PUT') {
            if (!currentUser || !currentUser.clinicId) {
                return corsResponse({ success: false, error: '未授权访问，请先登录' }, { status: 401 });
            }
            if (!currentUser.isClinicAdmin) {
                return corsResponse({ success: false, error: '仅诊所管理员可管理药品库' }, { status: 403 });
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
            const KV_MEDICINES_KEY = clinicKey(currentUser.clinicId, 'medicines');
            await kv.put(KV_MEDICINES_KEY, JSON.stringify(body.medicines));
            return corsResponse({
                success: true,
                message: '药品库保存成功',
                count: body.medicines.length,
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
