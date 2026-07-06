import { parseAuthHeader, isPlatformAdmin, isClinicAdmin, isAdmin } from './_lib/auth.js';

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
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

        // 确定方剂库的 KV key
        let formulasKey;
        if (currentUser && currentUser.clinicId) {
            formulasKey = `clinic:${currentUser.clinicId}:formulas`;
        } else if (currentUser && isPlatformAdmin(currentUser)) {
            // platform_admin 无 clinicId，用平台兜底
            formulasKey = 'system:platform_formulas';
        } else {
            return json({ success: false, error: '未授权访问，请先登录' }, 401);
        }

        // GET - 获取方剂库
        if (method === 'GET') {
            let formulas = await kv.get(formulasKey, 'json');
            if (!formulas || !Array.isArray(formulas)) {
                formulas = [];
            }
            return json({ success: true, data: formulas, count: formulas.length });
        }

        // POST/PUT - 保存方剂库（需要认证）
        if (method === 'POST' || method === 'PUT') {
            if (!currentUser) {
                return json({ success: false, error: '未授权访问，请先登录' }, 401);
            }

            let body;
            try {
                body = await context.request.json();
            } catch (error) {
                return json({ success: false, error: '请求数据格式错误' }, 400);
            }

            if (!body.formulas || !Array.isArray(body.formulas)) {
                return json({ success: false, error: '无效的方剂数据' }, 400);
            }

            const nowIso = new Date().toISOString();
            const formulasWithOwner = body.formulas.map(f => ({
                ...f,
                createdBy: f.createdBy || currentUser.username,
                updatedAt: nowIso
            }));

            let existingFormulas = (await kv.get(formulasKey, 'json')) || [];
            if (isAdmin(currentUser)) {
                // 管理员：替换整个方剂库
                existingFormulas = formulasWithOwner;
            } else {
                // 普通医师：仅替换自己的方剂
                const otherFormulas = existingFormulas.filter(f => f.createdBy !== currentUser.username);
                existingFormulas = [...otherFormulas, ...formulasWithOwner.filter(f => f.createdBy === currentUser.username)];
            }

            await kv.put(formulasKey, JSON.stringify(existingFormulas));
            return json({ success: true, message: '方剂库保存成功', data: existingFormulas, count: existingFormulas.length });
        }

        return json({ success: false, error: 'Method not allowed' }, 405);

    } catch (error) {
        console.error('Formulas API error:', error);
        return json({ success: false, error: error.message || 'Internal server error' }, 500);
    }
}
