export async function onRequest(context) {
    const url = new URL(context.request.url);
    const method = context.request.method;
    
    // 处理 CORS 预检请求
    if (method === 'OPTIONS') {
        return new Response(null, {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Max-Age': '86400'
            }
        });
    }
    
    try {
        const envKeys = Object.keys(context.env || {});
        console.log('Available environment keys:', envKeys);
        
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
                error: 'KV binding not found. Please configure TCM_PRESCRIPTION_KV in Cloudflare Pages settings.',
                availableKeys: envKeys
            }), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
        
        console.log('KV binding found:', !!kv);
        
        const KV_USERS_KEY = 'system_users';
        
        if (method === 'GET') {
            let users = await kv.get(KV_USERS_KEY, 'json');
            console.log('Retrieved users from KV:', users ? users.length : 0);
            
            if (!users || !Array.isArray(users) || users.length === 0) {
                users = [
                    {username: 'admin', password: 'admin', name: '管理员', role: 'admin'},
                    {username: 'doctor1', password: '123456', name: '张医生', role: 'user'},
                    {username: 'doctor2', password: '123456', name: '李医生', role: 'user'}
                ];
                console.log('Saving default users to KV');
                await kv.put(KV_USERS_KEY, JSON.stringify(users));
            }
            
            return new Response(JSON.stringify({
                success: true,
                data: users,
                count: users.length
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
        
        if (method === 'POST') {
            const body = await context.request.json();
            console.log('Received POST body:', body);
            
            if (!body.users || !Array.isArray(body.users)) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Missing or invalid users data'
                }), {
                    status: 400,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }
            
            console.log('Saving users to KV:', body.users.length);
            await kv.put(KV_USERS_KEY, JSON.stringify(body.users));
            console.log('Users saved successfully');
            
            return new Response(JSON.stringify({
                success: true,
                message: 'Users saved successfully',
                count: body.users.length
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
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
        console.error('Users API error:', error);
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
