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
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
                    {username: 'admin', password: 'admin', name: '管理员', role: 'admin', allowSavePrescription: true},
                    {username: 'doctor1', password: '123456', name: '张医生', role: 'user', allowSavePrescription: true},
                    {username: 'doctor2', password: '123456', name: '李医生', role: 'user', allowSavePrescription: true},
                    {username: 'wangguijie', password: '123456', name: '王桂杰', role: 'user', allowSavePrescription: true},
                    {username: 'wangyaoxie', password: '123456', name: '王耀燮', role: 'user', allowSavePrescription: true}
                ];
                console.log('Saving default users to KV');
                await kv.put(KV_USERS_KEY, JSON.stringify(users));
            } else {
                let needsUpdate = false;
                users = users.map(user => {
                    let updatedUser = { ...user };
                    
                    if (updatedUser.allowSavePrescription === undefined) {
                        needsUpdate = true;
                        updatedUser.allowSavePrescription = true;
                    }
                    
                    const chineseToPinyin = {
                        '王桂杰': 'wangguijie',
                        '王耀燮': 'wangyaoxie'
                    };
                    if (chineseToPinyin[updatedUser.username]) {
                        needsUpdate = true;
                        updatedUser.username = chineseToPinyin[updatedUser.username];
                    }
                    
                    return updatedUser;
                });
                if (needsUpdate) {
                    console.log('Updating existing users with migration');
                    await kv.put(KV_USERS_KEY, JSON.stringify(users));
                }
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

            // ===== 鉴权：解析 Authorization: Basic base64(username:role) =====
            // 管理员全权增删改用户；普通用户仅可修改自己的 password 字段；匿名/伪造一律 403
            const authHeader = context.request.headers.get('Authorization') || '';
            let authUser = null, authRole = null;
            if (authHeader.startsWith('Basic ')) {
                try {
                    const binary = atob(authHeader.slice(6));
                    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
                    const decoded = new TextDecoder().decode(bytes);
                    const idx = decoded.indexOf(':');
                    if (idx >= 0) { authUser = decoded.slice(0, idx); authRole = decoded.slice(idx + 1); }
                } catch(e) {}
            }
            // 与云端网页 getUsers 一致的兜底，确保 diff-check 基准一致
            const kvUsers = (await kv.get(KV_USERS_KEY, 'json') || []).map(u => ({
                ...u,
                allowSavePrescription: u.allowSavePrescription === undefined ? true : u.allowSavePrescription,
                allowedMode: u.allowedMode || (u.role === 'admin' ? 'both' : 'local')
            }));
            const matched = kvUsers.find(u => u.username === authUser);
            const isAdmin = authRole === 'admin' && matched && matched.role === 'admin';
            const isSelfRegular = !isAdmin && matched && matched.username === authUser;
            const forbiddenResp = (msg) => new Response(JSON.stringify({
                success: false,
                error: 'Forbidden: ' + msg
            }), {
                status: 403,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
            if (!isAdmin && !isSelfRegular) {
                return forbiddenResp('需管理员或本人身份');
            }
            // 普通用户：仅允许修改自己的 password 字段（防止增删用户、改 role/allowedMode、改他人信息）
            if (isSelfRegular) {
                if (body.users.length !== kvUsers.length) {
                    return forbiddenResp('仅可修改自己的密码，不可增删用户');
                }
                const keysEqualExcept = (a, b, except) => {
                    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
                    for (const k of keys) {
                        if (except.includes(k)) continue;
                        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
                    }
                    return true;
                };
                for (const bu of body.users) {
                    const ku = kvUsers.find(u => u.username === bu.username);
                    if (!ku) return forbiddenResp('用户列表不可变更');
                    if (bu.username !== authUser) {
                        if (!keysEqualExcept(bu, ku, [])) return forbiddenResp('不可修改他人信息');
                    } else {
                        if (!keysEqualExcept(bu, ku, ['password'])) return forbiddenResp('仅可修改密码字段');
                    }
                }
            }

            // 确保新增用户都有 allowSavePrescription 字段，默认为 true
            const usersWithPermission = body.users.map(user => {
                if (user.allowSavePrescription === undefined) {
                    return { ...user, allowSavePrescription: true };
                }
                return user;
            });
            
            console.log('Saving users to KV:', usersWithPermission.length);
            await kv.put(KV_USERS_KEY, JSON.stringify(usersWithPermission));
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
