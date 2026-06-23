// 用户身份验证辅助函数 - 与客户端safeBtoa对称
function safeAtob(str) {
    try {
        const decoded = atob(str);
        const bytes = [];
        for (let i = 0; i < decoded.length; i++) {
            bytes.push(decoded.charCodeAt(i));
        }
        let result = '';
        let i = 0;
        while (i < bytes.length) {
            const byte = bytes[i];
            if (byte < 0x80) {
                result += String.fromCharCode(byte);
                i++;
            } else if (byte < 0xC0) {
                result += String.fromCharCode(byte);
                i++;
            } else if (byte < 0xE0) {
                if (i + 1 < bytes.length) {
                    const charCode = ((byte & 0x1F) << 6) | (bytes[i + 1] & 0x3F);
                    result += String.fromCharCode(charCode);
                    i += 2;
                } else {
                    result += String.fromCharCode(byte);
                    i++;
                }
            } else if (byte < 0xF0) {
                if (i + 2 < bytes.length) {
                    const charCode = ((byte & 0x0F) << 12) | ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F);
                    result += String.fromCharCode(charCode);
                    i += 3;
                } else {
                    result += String.fromCharCode(byte);
                    i++;
                }
            } else if (byte < 0xF8) {
                if (i + 3 < bytes.length) {
                    const charCode = ((byte & 0x07) << 18) | ((bytes[i + 1] & 0x3F) << 12) | ((bytes[i + 2] & 0x3F) << 6) | (bytes[i + 3] & 0x3F);
                    result += String.fromCharCode(charCode);
                    i += 4;
                } else {
                    result += String.fromCharCode(byte);
                    i++;
                }
            } else {
                result += String.fromCharCode(byte);
                i++;
            }
        }
        return result;
    } catch (e) {
        console.error('safeAtob error:', e);
        return atob(str);
    }
}

// 用户身份验证辅助函数
function parseAuthHeaderSimple(request) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
        return null;
    }
    
    try {
        if (authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            const decodedToken = safeAtob(token);
            const userInfo = JSON.parse(decodedToken);
            return {
                username: userInfo.username,
                role: userInfo.role || 'user',
                isAdmin: userInfo.role === 'admin',
                allowSavePrescription: true
            };
        } else if (authHeader.startsWith('Basic ')) {
            const base64Credentials = authHeader.substring(6);
            const credentials = safeAtob(base64Credentials);
            const [username, role] = credentials.split(':');
            return { 
                username, 
                role, 
                isAdmin: role === 'admin',
                allowSavePrescription: true
            };
        }
        return null;
    } catch (error) {
        console.error('Auth parsing error:', error);
        return null;
    }
}

export async function onRequest(context) {
    const url = new URL(context.request.url);
    const method = context.request.method;
    
    if (method === 'OPTIONS') {
        return new Response(null, {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Max-Age': '86400'
            }
        });
    }
    
    try {
        const envKeys = Object.keys(context.env || {});
        const kv = context.env.KV || 
                   context.env.TCM_PRESCRIPTION_KV || 
                   context.env['tcm-prescription-kv'] || 
                   context.env['TCM-PRESCRIPTION-KV'] ||
                   context.env.TCM_KV || 
                   context.env.PRESCRIPTION_KV;
        
        if (!kv) {
            console.error('KV binding not found. Available env keys:', envKeys);
            return new Response(JSON.stringify({
                success: false,
                error: 'KV存储未配置。请在Cloudflare Pages设置中配置KV binding',
                availableKeys: envKeys,
                requireSetup: true
            }), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
        
        const KV_FORMULAS_KEY = 'formulas_all';
        const currentUser = parseAuthHeaderSimple(context.request);
        
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