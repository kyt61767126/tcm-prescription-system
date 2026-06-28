// ============================================================================
// 方剂库 API（多诊所分区版）
// ============================================================================
// 端点契约：
//   GET    /api/formulas              获取本诊所方剂库（需登录）
//   POST   /api/formulas              保存本诊所方剂库（clinic_admin 全量覆盖，doctor 仅自己创建的）
// ============================================================================
import {
    ROLE, clinicKey, parseAuthHeader,
    corsResponse, handleOptions, getKV
} from '../_lib/auth.js';

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

        if (currentUser && currentUser.isPlatformAdmin) {
            return corsResponse({ success: false, error: '平台总管理员不参与诊所方剂库业务' }, { status: 403 });
        }

        if (!currentUser || !currentUser.clinicId) {
            return corsResponse({ success: false, error: '未授权访问，请先登录' }, { status: 401 });
        }

        const KV_FORMULAS_KEY = clinicKey(currentUser.clinicId, 'formulas');

        // GET
        if (method === 'GET') {
            let formulas = await kv.get(KV_FORMULAS_KEY, 'json');
            if (!formulas || !Array.isArray(formulas)) {
                formulas = [];
                await kv.put(KV_FORMULAS_KEY, JSON.stringify(formulas));
            }
            // doctor 只看本诊所全部方剂（方剂是诊所共享资源，不做创建者过滤）
            return corsResponse({ success: true, data: formulas, count: formulas.length });
        }

        // POST/PUT
        if (method === 'POST' || method === 'PUT') {
            let body;
            try {
                body = await request.json();
            } catch (error) {
                return corsResponse({ success: false, error: '请求数据格式错误' }, { status: 400 });
            }
            if (!body.formulas || !Array.isArray(body.formulas)) {
                return corsResponse({ success: false, error: '无效的方剂数据' }, { status: 400 });
            }

            const formulasWithOwner = body.formulas.map(f => ({
                ...f,
                createdBy: f.createdBy || currentUser.username,
                updatedAt: new Date().toISOString()
            }));

            let existingFormulas = await kv.get(KV_FORMULAS_KEY, 'json') || [];
            if (currentUser.isClinicAdmin) {
                // 诊所管理员：全量覆盖
                existingFormulas = formulasWithOwner;
            } else {
                // 医师：仅覆盖自己创建的，保留他人创建的
                const userFormulas = existingFormulas.filter(f => f.createdBy === currentUser.username);
                const otherFormulas = existingFormulas.filter(f => f.createdBy !== currentUser.username);
                existingFormulas = [...otherFormulas, ...formulasWithOwner.filter(f => f.createdBy === currentUser.username)];
            }
            await kv.put(KV_FORMULAS_KEY, JSON.stringify(existingFormulas));
            return corsResponse({
                success: true,
                message: '方剂库保存成功',
                count: existingFormulas.length,
                data: existingFormulas,
                clinicId: currentUser.clinicId
            });
        }

        return corsResponse({ success: false, error: 'Method not allowed' }, { status: 405 });
    } catch (error) {
        console.error('Formulas API error:', error);
        // 安全加固：不向客户端泄露内部错误细节和 stack
        return corsResponse({
            success: false,
            error: 'Internal server error'
        }, { status: 500 });
    }
}
