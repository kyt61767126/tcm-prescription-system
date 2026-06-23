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

// 获取默认药品库
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
        
        const KV_MEDICINES_KEY = 'medicines_all';
        const currentUser = parseAuthHeaderSimple(context.request);
        
        // GET - 获取药品库（无需认证）
        if (method === 'GET') {
            let medicines = await kv.get(KV_MEDICINES_KEY, 'json');
            console.log('GET /medicines - Retrieved from KV:', medicines ? medicines.length : 0);
            
            if (!medicines || !Array.isArray(medicines) || medicines.length === 0) {
                medicines = getDefaultMedicines();
                await kv.put(KV_MEDICINES_KEY, JSON.stringify(medicines));
                console.log('GET /medicines - Using default medicines');
            }
            
            return new Response(JSON.stringify({
                success: true,
                data: medicines,
                count: medicines.length
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
        
        // POST/PUT - 保存药品库（需要管理员认证）
        if (method === 'POST' || method === 'PUT') {
            if (!currentUser) {
                console.warn('POST /medicines - Unauthorized');
                return new Response(JSON.stringify({ 
                    success: false, 
                    error: '未授权访问，请先登录' 
                }), { 
                    status: 401, 
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } 
                });
            }
            
            if (currentUser.role !== 'admin') {
                console.warn('POST /medicines - Not admin:', currentUser.username);
                return new Response(JSON.stringify({ 
                    success: false, 
                    error: '仅管理员可管理药品库' 
                }), { 
                    status: 403, 
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } 
                });
            }
            
            let body;
            try {
                body = await context.request.json();
            } catch (error) {
                console.error('POST /medicines - Failed to parse body:', error);
                return new Response(JSON.stringify({ 
                    success: false, 
                    error: '请求数据格式错误' 
                }), { 
                    status: 400, 
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } 
                });
            }
            
            if (!body.medicines || !Array.isArray(body.medicines)) {
                return new Response(JSON.stringify({ 
                    success: false, 
                    error: '无效的药品数据' 
                }), { 
                    status: 400, 
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } 
                });
            }
            
            console.log('POST /medicines - Saving', body.medicines.length, 'medicines');
            await kv.put(KV_MEDICINES_KEY, JSON.stringify(body.medicines));
            console.log('POST /medicines - Saved successfully');
            
            return new Response(JSON.stringify({ 
                success: true, 
                message: '药品库保存成功',
                count: body.medicines.length
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
        console.error('Medicines API error:', error);
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