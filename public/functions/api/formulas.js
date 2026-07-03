import { parseAuth } from './_auth.js';

export async function onRequest(context) {
    const url = new URL(context.request.url);
    const method = context.request.method;

    if (method === 'OPTIONS') {
        return new Response(null, {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
                'Access-Control-Max-Age': '86400'
            }
        });
    }

    try {
        const kv = context.env.KV ||
                   context.env.TCM_PRESCRIPTION_KV ||
                   context.env['tcm-prescription-kv'] ||
                   context.env['TCM-PRESCRIPTION-KV'] ||
                   context.env.TCM_KV ||
                   context.env.PRESCRIPTION_KV;

        if (!kv) {
            return new Response(JSON.stringify({
                success: false,
                error: 'KV存储未配置。请在Cloudflare Pages设置中配置KV binding',
                requireSetup: true
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
        }

        const KV_FORMULAS_KEY = 'formulas_all';
        const currentUser = await parseAuth(context.request, context.env);
        
        // GET - 获取方剂库（无需认证）
        if (method === 'GET') {
            let formulas = await kv.get(KV_FORMULAS_KEY, 'json');
            console.log('GET /formulas - Retrieved from KV:', formulas ? formulas.length : 0);
            
            if (!formulas || !Array.isArray(formulas)) {
                formulas = [];
                await kv.put(KV_FORMULAS_KEY, JSON.stringify(formulas));
            }
            
            return new Response(JSON.stringify({
                success: true,
                data: formulas,
                count: formulas.length
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
        
        // POST/PUT - 保存方剂库（需要认证）
        if (method === 'POST' || method === 'PUT') {
            if (!currentUser) {
                console.warn('POST /formulas - Unauthorized');
                return new Response(JSON.stringify({ 
                    success: false, 
                    error: '未授权访问，请先登录' 
                }), { 
                    status: 401, 
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } 
                });
            }
            
            let body;
            try {
                body = await context.request.json();
            } catch (error) {
                console.error('POST /formulas - Failed to parse body:', error);
                return new Response(JSON.stringify({ 
                    success: false, 
                    error: '请求数据格式错误' 
                }), { 
                    status: 400, 
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } 
                });
            }
            
            if (!body.formulas || !Array.isArray(body.formulas)) {
                return new Response(JSON.stringify({ 
                    success: false, 
                    error: '无效的方剂数据' 
                }), { 
                    status: 400, 
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } 
                });
            }
            
            const formulasWithOwner = body.formulas.map(f => ({
                ...f,
                createdBy: f.createdBy || currentUser.username,
                updatedAt: new Date().toISOString()
            }));
            
            let existingFormulas = await kv.get(KV_FORMULAS_KEY, 'json') || [];
            if (currentUser.role === 'admin') {
                existingFormulas = formulasWithOwner;
            } else {
                const userFormulas = existingFormulas.filter(f => f.createdBy === currentUser.username);
                const otherFormulas = existingFormulas.filter(f => f.createdBy !== currentUser.username);
                existingFormulas = [...otherFormulas, ...formulasWithOwner.filter(f => f.createdBy === currentUser.username)];
            }
            
            console.log('POST /formulas - Saving', existingFormulas.length, 'formulas');
            await kv.put(KV_FORMULAS_KEY, JSON.stringify(existingFormulas));
            console.log('POST /formulas - Saved successfully');
            
            return new Response(JSON.stringify({ 
                success: true, 
                message: '方剂库保存成功',
                count: existingFormulas.length,
                data: existingFormulas
            }), { 
                status: 200, 
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } 
            });
        }
        
        return new Response(JSON.stringify({
            success: false,
            error: 'Method not allowed'
        }), {
            status: 405,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
        
    } catch (error) {
        console.error('Formulas API error:', error);
        console.error('Error stack:', error.stack);
        return new Response(JSON.stringify({
            success: false,
            error: error.message || 'Internal server error',
            stack: error.stack ? error.stack.split('\n').slice(0, 5).join('\n') : null
        }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}