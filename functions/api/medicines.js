import { parseAuthHeader, isPlatformAdmin, isClinicAdmin, isAdmin, KV_SYSTEM_PLATFORM_MEDICINES } from './_lib/auth.js';

// P1-6 安全增强：CORS 白名单
function corsHeaders(request) {
    const origin = request?.headers?.get('Origin') || '';
    if (!origin) {
        return {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
            'Access-Control-Max-Age': '86400',
            'Content-Type': 'application/json'
        };
    }
    const allowed = ['https://tcm-prescription-system.pages.dev', 'https://hjkangtcm.pages.dev', 'http://localhost:3000', 'http://localhost:8080', 'http://127.0.0.1:3000', 'http://127.0.0.1:8080'];
    const isPagesDev = origin.endsWith('.pages.dev') && origin.startsWith('https://');
    return {
        'Access-Control-Allow-Origin': (allowed.includes(origin) || isPagesDev) ? origin : 'null',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
        'Content-Type': 'application/json'
    };
}

function json(data, status = 200, request = null) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders(request) });
}

function getKV(context) {
    return context.env.KV ||
           context.env.TCM_PRESCRIPTION_KV ||
           context.env['tcm-prescription-kv'] ||
           context.env['TCM-PRESCRIPTION-KV'] ||
           context.env.TCM_KV ||
           context.env.PRESCRIPTION_KV;
}

function getDefaultMedicines() {
    return [
        { id: 1, name: "麻黄", code: "mh", unit: "g", costPrice: null, price: 0, dosage: 10, stock: 0 },
        { id: 2, name: "桂枝", code: "gz", unit: "g", costPrice: null, price: 0, dosage: 10, stock: 0 },
        { id: 3, name: "杏仁", code: "xr", unit: "g", costPrice: null, price: 0, dosage: 10, stock: 0 },
        { id: 4, name: "甘草", code: "gc", unit: "g", costPrice: null, price: 0, dosage: 10, stock: 0 },
        { id: 5, name: "石膏", code: "sg", unit: "g", costPrice: null, price: 0, dosage: 10, stock: 0 },
        { id: 6, name: "知母", code: "zm", unit: "g", costPrice: null, price: 0, dosage: 10, stock: 0 },
        { id: 7, name: "黄连", code: "hl", unit: "g", costPrice: null, price: 0, dosage: 10, stock: 0 },
        { id: 8, name: "黄芩", code: "hq", unit: "g", costPrice: null, price: 0, dosage: 10, stock: 0 },
        { id: 9, name: "黄柏", code: "hb", unit: "g", costPrice: null, price: 0, dosage: 10, stock: 0 },
        { id: 10, name: "栀子", code: "zz", unit: "g", costPrice: null, price: 0, dosage: 10, stock: 0 }
    ];
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

        // 确定药品库的 KV key
        let medicinesKey;
        if (currentUser && isPlatformAdmin(currentUser)) {
            medicinesKey = KV_SYSTEM_PLATFORM_MEDICINES;
        } else if (currentUser && currentUser.clinicId) {
            medicinesKey = `clinic:${currentUser.clinicId}:medicines`;
        } else {
            // 未登录或无 clinicId，回退到平台兜底库
            medicinesKey = KV_SYSTEM_PLATFORM_MEDICINES;
        }

        // GET - 获取药品库
        if (method === 'GET') {
            let medicines = await kv.get(medicinesKey, 'json');
            // 如果诊所药品库为空，回退到平台兜底库
            if ((!medicines || !Array.isArray(medicines) || medicines.length === 0) && medicinesKey !== KV_SYSTEM_PLATFORM_MEDICINES) {
                medicines = await kv.get(KV_SYSTEM_PLATFORM_MEDICINES, 'json');
            }
            if (!medicines || !Array.isArray(medicines) || medicines.length === 0) {
                medicines = getDefaultMedicines();
                await kv.put(medicinesKey, JSON.stringify(medicines));
            }
            return json({ success: true, data: medicines, count: medicines.length });
        }

        // POST/PUT - 保存药品库（需要管理员认证）
        if (method === 'POST' || method === 'PUT') {
            if (!currentUser) {
                return json({ success: false, error: '未授权访问，请先登录' }, 401);
            }
            if (!isAdmin(currentUser)) {
                return json({ success: false, error: '仅管理员可管理药品库' }, 403);
            }

            let body;
            try {
                body = await context.request.json();
            } catch (error) {
                return json({ success: false, error: '请求数据格式错误' }, 400);
            }

            if (!body.medicines || !Array.isArray(body.medicines)) {
                return json({ success: false, error: '无效的药品数据' }, 400);
            }

            await kv.put(medicinesKey, JSON.stringify(body.medicines));
            return json({ success: true, message: '药品库保存成功', count: body.medicines.length });
        }

        return json({ success: false, error: 'Method not allowed' }, 405);

    } catch (error) {
        console.error('Medicines API error:', error);
        return json({ success: false, error: error.message || 'Internal server error' }, 500);
    }
}
