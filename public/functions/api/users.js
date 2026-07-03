import { hashPassword, verifyPassword, signToken, parseAuth } from './_auth.js';

const KV_USERS_KEY = 'system_users';

function getDefaultUsers() {
    // 仅用于首次初始化，密码会在写入时立即哈希
    // 首次登录后请立即修改默认密码
    return [
        {username: 'admin', password: 'Bnt@2026!', name: '管理员', role: 'admin', allowSavePrescription: true, allowedMode: 'both'}
    ];
}

// 自动迁移明文密码：如果发现明文，逐个哈希后整体写回
async function migratePlaintextPasswords(kv, users) {
    let changed = false;
    const migrated = [];
    for (const u of users) {
        if (u.password && !u.password.includes(':')) {
            const hashed = await hashPassword(u.password);
            migrated.push({ ...u, password: hashed });
            changed = true;
        } else {
            migrated.push(u);
        }
    }
    if (changed) {
        await kv.put(KV_USERS_KEY, JSON.stringify(migrated));
        console.log('Migrated plaintext passwords to hashed format, count:', migrated.length);
    }
    return migrated;
}

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    };
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

export async function onRequest(context) {
    const url = new URL(context.request.url);
    const method = context.request.method;

    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders() });
    }

    try {
        const kv = context.env.KV ||
                   context.env.TCM_PRESCRIPTION_KV ||
                   context.env['tcm-prescription-kv'] ||
                   context.env['TCM-PRESCRIPTION-KV'] ||
                   context.env.TCM_KV ||
                   context.env.PRESCRIPTION_KV;

        if (!kv) {
            return json({ success: false, error: 'KV binding not found. Please configure TCM_PRESCRIPTION_KV.' }, 500);
        }

        // ===== 登录端点 POST /users?action=login =====
        // 入参: { username, password }
        // 出参: { success, token, user } - token 用于后续 Bearer 鉴权
        if (method === 'POST' && url.searchParams.get('action') === 'login') {
            const body = await context.request.json().catch(() => ({}));
            const { username, password } = body;
            if (!username || !password) {
                return json({ success: false, error: '用户名或密码不能为空' }, 400);
            }

            let users = await kv.get(KV_USERS_KEY, 'json');
            if (!users || !Array.isArray(users) || users.length === 0) {
                users = getDefaultUsers();
                await kv.put(KV_USERS_KEY, JSON.stringify(users));
            }

            users = await migratePlaintextPasswords(kv, users);
            const found = users.find(u => u.username === username);
            if (!found) {
                return json({ success: false, error: '用户名或密码错误' }, 401);
            }

            const ok = await verifyPassword(password, found.password || '');
            if (!ok) {
                return json({ success: false, error: '用户名或密码错误' }, 401);
            }

            const isAdmin = found.role === 'admin';
            const allowCloud = isAdmin || (found.allowCloud === true || found.allowedMode === 'both' || found.allowedMode === 'cloud');

            const token = await signToken(found.username, found.role || 'user', context.env);

            return json({
                success: true,
                token,
                user: {
                    username: found.username,
                    role: isAdmin ? 'admin' : 'user',
                    name: found.name || found.username,
                    allowCloud,
                    allowedMode: found.allowedMode || (isAdmin ? 'both' : 'local')
                }
            });
        }

        // ===== 修改密码端点 POST /users?action=change-password =====
        // 入参: { username, oldPassword, newPassword }
        // 鉴权: Bearer token 或 Basic Auth
        if (method === 'POST' && url.searchParams.get('action') === 'change-password') {
            const body = await context.request.json().catch(() => ({}));
            const { username, oldPassword, newPassword } = body;
            if (!username || !oldPassword || !newPassword) {
                return json({ success: false, error: '参数不完整' }, 400);
            }

            const currentUser = await parseAuth(context.request, context.env);
            if (!currentUser || currentUser.username !== username) {
                return json({ success: false, error: '只能修改自己的密码' }, 403);
            }

            let users = await kv.get(KV_USERS_KEY, 'json');
            if (!users || !Array.isArray(users)) {
                users = getDefaultUsers();
                await kv.put(KV_USERS_KEY, JSON.stringify(users));
            }
            users = await migratePlaintextPasswords(kv, users);

            const found = users.find(u => u.username === username);
            if (!found) {
                return json({ success: false, error: '用户不存在' }, 404);
            }

            const ok = await verifyPassword(oldPassword, found.password || '');
            if (!ok) {
                return json({ success: false, error: '原密码错误' }, 401);
            }

            found.password = await hashPassword(newPassword);
            await kv.put(KV_USERS_KEY, JSON.stringify(users));

            return json({ success: true, message: '密码修改成功' });
        }

        if (method === 'GET') {
            let users = await kv.get(KV_USERS_KEY, 'json');
            if (!users || !Array.isArray(users) || users.length === 0) {
                users = getDefaultUsers();
                await kv.put(KV_USERS_KEY, JSON.stringify(users));
            }

            // 自动迁移明文密码到哈希
            users = await migratePlaintextPasswords(kv, users);

            // 字段补全
            let needsUpdate = false;
            users = users.map(user => {
                let updatedUser = { ...user };
                if (updatedUser.allowSavePrescription === undefined) {
                    needsUpdate = true;
                    updatedUser.allowSavePrescription = true;
                }
                if (updatedUser.allowedMode === undefined) {
                    needsUpdate = true;
                    updatedUser.allowedMode = (updatedUser.role === 'admin') ? 'both' : 'local';
                }
                return updatedUser;
            });
            if (needsUpdate) {
                await kv.put(KV_USERS_KEY, JSON.stringify(users));
            }

            // 返回时隐藏密码哈希
            const sanitized = users.map(u => ({
                username: u.username,
                name: u.name,
                role: u.role,
                allowSavePrescription: u.allowSavePrescription,
                allowedMode: u.allowedMode,
                allowCloud: u.role === 'admin' || u.allowedMode === 'both' || u.allowedMode === 'cloud',
                hasPassword: !!u.password
            }));

            return json({ success: true, data: sanitized, count: sanitized.length });
        }

        if (method === 'POST') {
            const body = await context.request.json().catch(() => ({}));

            if (!body.users || !Array.isArray(body.users)) {
                return json({ success: false, error: 'Missing or invalid users data' }, 400);
            }

            // 鉴权：支持新 Bearer token 与旧 Basic 兼容
            const currentUser = await parseAuth(context.request, context.env);
            if (!currentUser) {
                return json({ success: false, error: 'Forbidden: 需登录身份' }, 403);
            }

            const kvUsers = await migratePlaintextPasswords(kv, (await kv.get(KV_USERS_KEY, 'json') || []));
            const kvUsersNormalized = kvUsers.map(u => ({
                ...u,
                allowSavePrescription: u.allowSavePrescription === undefined ? true : u.allowSavePrescription,
                allowedMode: u.allowedMode || (u.role === 'admin' ? 'both' : 'local')
            }));

            const matched = kvUsersNormalized.find(u => u.username === currentUser.username);
            const isAdmin = currentUser.role === 'admin' && matched && matched.role === 'admin';
            const isSelfRegular = !isAdmin && matched && matched.username === currentUser.username;

            const forbiddenResp = (msg) => json({ success: false, error: 'Forbidden: ' + msg }, 403);

            if (!isAdmin && !isSelfRegular) {
                return forbiddenResp('需管理员或本人身份');
            }

            // 普通用户：仅可修改自己的 password 字段
            if (isSelfRegular) {
                if (body.users.length !== kvUsersNormalized.length) {
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
                    const ku = kvUsersNormalized.find(u => u.username === bu.username);
                    if (!ku) return forbiddenResp('用户列表不可变更');
                    if (bu.username !== currentUser.username) {
                        if (!keysEqualExcept(bu, ku, [])) return forbiddenResp('不可修改他人信息');
                    } else {
                        if (!keysEqualExcept(bu, ku, ['password'])) return forbiddenResp('仅可修改密码字段');
                    }
                }
            }

            // 处理密码：明文密码入库前哈希；已是 "salt:hash" 格式保留；空保留原值
            const usersWithPermission = [];
            for (const user of body.users) {
                let updatedUser = { ...user };
                if (updatedUser.allowSavePrescription === undefined) {
                    updatedUser.allowSavePrescription = true;
                }
                if (updatedUser.allowedMode === undefined) {
                    updatedUser.allowedMode = 'both';
                }
                // 密码处理：明文 → 哈希；保留旧哈希；空字符串保持
                if (updatedUser.password && !updatedUser.password.includes(':')) {
                    updatedUser.password = await hashPassword(updatedUser.password);
                }
                usersWithPermission.push(updatedUser);
            }

            await kv.put(KV_USERS_KEY, JSON.stringify(usersWithPermission));

            return json({
                success: true,
                message: 'Users saved successfully',
                count: body.users.length
            });
        }

        return json({ success: false, error: 'Method not allowed' }, 405);

    } catch (error) {
        console.error('Users API error:', error);
        return json({ success: false, error: error.message || 'Internal server error' }, 500);
    }
}

