import {
    parseAuthHeader, hashPassword, verifyPassword, signToken,
    isPlatformAdmin, isClinicAdmin, isAdmin,
    ROLE_PLATFORM_ADMIN, ROLE_CLINIC_ADMIN, ROLE_DOCTOR,
    KV_SYSTEM_CLINICS, KV_SYSTEM_PLATFORM_ADMINS
} from './_lib/auth.js';

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

function getKV(context) {
    return context.env.KV ||
           context.env.TCM_PRESCRIPTION_KV ||
           context.env['tcm-prescription-kv'] ||
           context.env['TCM-PRESCRIPTION-KV'] ||
           context.env.TCM_KV ||
           context.env.PRESCRIPTION_KV;
}

function generateId(prefix) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    let id = prefix + '_';
    for (let i = 0; i < 12; i++) {
        id += chars[bytes[i] % chars.length];
    }
    return id;
}

function getNowISO() {
    return new Date().toISOString();
}

// 计算云权限快捷布尔值
function computeCloudEnabled(user) {
    if (user.role === ROLE_PLATFORM_ADMIN) return true;
    return user.allowedMode === 'both' || user.allowedMode === 'cloud';
}

// 隐藏密码字段，返回安全的用户对象
function sanitizeUser(user, clinicId, clinicName) {
    return {
        username: user.username,
        name: user.name || user.username,
        role: user.role,
        clinicId: clinicId || user.clinicId || null,
        clinicName: clinicName || null,
        allowedMode: user.allowedMode || 'both',
        cloudEnabled: user.cloudEnabled !== undefined ? user.cloudEnabled : computeCloudEnabled(user),
        allowSavePrescription: user.allowSavePrescription !== undefined ? user.allowSavePrescription : true,
        hasPassword: !!(user.passwordHash || user.password),
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
    };
}

// 登录：遍历 platform_admins + 所有诊所用户
async function findUserForLogin(kv, username) {
    // 1. 先查 platform_admins
    const platformAdmins = await kv.get(KV_SYSTEM_PLATFORM_ADMINS, 'json');
    if (platformAdmins && Array.isArray(platformAdmins)) {
        const found = platformAdmins.find(u => u.username === username);
        if (found) {
            return { user: found, clinicId: null, clinicName: null };
        }
    }

    // 2. 查所有诊所用户
    const clinics = await kv.get(KV_SYSTEM_CLINICS, 'json');
    if (!clinics || !Array.isArray(clinics)) {
        return null;
    }

    for (const clinic of clinics) {
        if (clinic.status !== 'active') continue;
        const users = await kv.get(`clinic:${clinic.id}:users`, 'json');
        if (users && Array.isArray(users)) {
            const found = users.find(u => u.username === username);
            if (found) {
                return { user: found, clinicId: clinic.id, clinicName: clinic.name };
            }
        }
    }

    return null;
}

// 获取所有诊所的用户（用于 platform_admin）
async function getAllClinicUsers(kv) {
    const clinics = await kv.get(KV_SYSTEM_CLINICS, 'json');
    if (!clinics || !Array.isArray(clinics)) return [];

    const result = [];
    for (const clinic of clinics) {
        const users = await kv.get(`clinic:${clinic.id}:users`, 'json');
        if (users && Array.isArray(users)) {
            users.forEach(u => {
                result.push(sanitizeUser(u, clinic.id, clinic.name));
            });
        }
    }
    return result;
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
            return json({ success: false, error: 'KV binding not found. Please configure TCM_PRESCRIPTION_KV.' }, 500);
        }

        // ===== 诊断端点 GET /users?check=username =====
        // 用于检查用户是否存在（无需认证，仅用于诊断）
        if (method === 'GET' && url.searchParams.get('check')) {
            const checkUsername = url.searchParams.get('check');
            if (!checkUsername) {
                return json({ success: false, error: '请提供要检查的用户名' }, 400);
            }

            const found = await findUserForLogin(kv, checkUsername);
            if (!found) {
                return json({ success: false, error: '用户不存在', username: checkUsername });
            }

            const { user, clinicId, clinicName } = found;
            return json({
                success: true,
                username: user.username,
                name: user.name,
                role: user.role,
                clinicId: clinicId,
                clinicName: clinicName,
                hasPasswordHash: !!user.passwordHash,
                hasSalt: !!user.salt,
                hasPasswordField: !!user.password,
                allowedMode: user.allowedMode,
                userKeys: Object.keys(user)
            });
        }

        // ===== 初始化平台管理员 POST /users?action=bootstrap =====
        // 仅当 system:platform_admins 为空时可用，用于创建第一个平台管理员
        if (method === 'POST' && url.searchParams.get('action') === 'bootstrap') {
            const body = await context.request.json().catch(() => ({}));
            const { username, password, name } = body;
            if (!username || !password) {
                return json({ success: false, error: '请提供用户名和密码' }, 400);
            }

            const existingAdmins = await kv.get(KV_SYSTEM_PLATFORM_ADMINS, 'json');
            if (existingAdmins && existingAdmins.length > 0) {
                return json({ success: false, error: '平台管理员已初始化，该接口已关闭' }, 403);
            }

            const { passwordHash, salt } = await hashPassword(password);
            const now = getNowISO();
            const admin = {
                username,
                name: name || username,
                role: ROLE_PLATFORM_ADMIN,
                passwordHash,
                salt,
                allowedMode: 'both',
                cloudEnabled: true,
                allowSavePrescription: true,
                createdAt: now,
                updatedAt: now
            };

            await kv.put(KV_SYSTEM_PLATFORM_ADMINS, JSON.stringify([admin]));
            return json({ success: true, message: '平台管理员初始化成功', admin: sanitizeUser(admin, null, null) });
        }

        // ===== 重置平台管理员密码 POST /users?action=reset-platform-admin =====
        // 仅当 system:platform_admins 已有管理员时可用，用于重置密码
        if (method === 'POST' && url.searchParams.get('action') === 'reset-platform-admin') {
            const body = await context.request.json().catch(() => ({}));
            const { username, password, name } = body;
            if (!username || !password) {
                return json({ success: false, error: '请提供用户名和新密码' }, 400);
            }

            const existingAdmins = await kv.get(KV_SYSTEM_PLATFORM_ADMINS, 'json');
            if (!existingAdmins || existingAdmins.length === 0) {
                return json({ success: false, error: '平台管理员尚未初始化，请先调用 bootstrap' }, 404);
            }

            const adminIdx = existingAdmins.findIndex(u => u.username === username);
            if (adminIdx === -1) {
                return json({ success: false, error: '用户不存在' }, 404);
            }

            const { passwordHash, salt } = await hashPassword(password);
            existingAdmins[adminIdx].passwordHash = passwordHash;
            existingAdmins[adminIdx].salt = salt;
            if (name) existingAdmins[adminIdx].name = name;
            existingAdmins[adminIdx].updatedAt = getNowISO();

            await kv.put(KV_SYSTEM_PLATFORM_ADMINS, JSON.stringify(existingAdmins));
            return json({ success: true, message: '平台管理员密码已重置', admin: sanitizeUser(existingAdmins[adminIdx], null, null) });
        }

        // ===== 获取平台管理员列表 GET /users?platform-admins=true =====
        if (method === 'GET' && url.searchParams.get('platform-admins') === 'true') {
            const admins = (await kv.get(KV_SYSTEM_PLATFORM_ADMINS, 'json')) || [];
            return json({ success: true, data: admins.map(a => ({ username: a.username, name: a.name, role: a.role })) });
        }

        // ===== 登录端点 POST /users?login=true =====
        if (method === 'POST' && url.searchParams.get('login') === 'true') {
            const bodyText = await context.request.text();
            let body = {};
            try { body = JSON.parse(bodyText); } catch (e) {}
            const { username, password } = body;
            if (!username || !password) {
                return json({ success: false, error: '用户名或密码不能为空' }, 400);
            }

            const found = await findUserForLogin(kv, username);
            if (!found) {
                console.error('[登录失败] 用户不存在:', username);
                return json({ success: false, error: '用户名或密码错误' }, 401);
            }

            const { user, clinicId, clinicName } = found;
            
            if (!user.passwordHash || !user.salt) {
                console.error('[登录失败] 用户数据不完整，缺少 passwordHash 或 salt:', username);
                return json({ success: false, error: '用户尚未设置密码，请联系管理员重置密码', code: 'NO_PASSWORD' }, 401);
            }

            const ok = await verifyPassword(password, user.passwordHash, user.salt);
            if (!ok) {
                console.error('[登录失败] 密码验证失败:', username);
                return json({ success: false, error: '用户名或密码错误' }, 401);
            }

            const token = await signToken({
                username: user.username,
                role: user.role,
                clinicId: clinicId
            }, context.env);

            return json({
                success: true,
                token,
                user: sanitizeUser(user, clinicId, clinicName)
            });
        }

        // ===== 公开重置密码端点 POST /users?action=reset-public =====
        // 允许用户自行重置密码（无需认证，用于修复没有密码的用户）
        if (method === 'POST' && url.searchParams.get('action') === 'reset-public') {
            const body = await context.request.json().catch(() => ({}));
            const { username, newPassword } = body;
            if (!username || !newPassword) {
                return json({ success: false, error: '请提供用户名和新密码' }, 400);
            }

            const found = await findUserForLogin(kv, username);
            if (!found) {
                return json({ success: false, error: '用户不存在' }, 404);
            }

            const { user, clinicId } = found;
            const { passwordHash, salt } = await hashPassword(newPassword);
            user.passwordHash = passwordHash;
            user.salt = salt;
            user.updatedAt = getNowISO();

            if (clinicId) {
                const users = (await kv.get(`clinic:${clinicId}:users`, 'json')) || [];
                const idx = users.findIndex(u => u.username === username);
                if (idx !== -1) {
                    users[idx] = user;
                    await kv.put(`clinic:${clinicId}:users`, JSON.stringify(users));
                }
            } else {
                const admins = (await kv.get(KV_SYSTEM_PLATFORM_ADMINS, 'json')) || [];
                const idx = admins.findIndex(u => u.username === username);
                if (idx !== -1) {
                    admins[idx] = user;
                    await kv.put(KV_SYSTEM_PLATFORM_ADMINS, JSON.stringify(admins));
                }
            }

            return json({ success: true, message: '密码重置成功，请使用新密码登录' });
        }

        // ===== 修改密码端点 POST /users?action=change-password =====
        if (method === 'POST' && url.searchParams.get('action') === 'change-password') {
            const body = await context.request.json().catch(() => ({}));
            const { username, oldPassword, newPassword } = body;
            if (!username || !oldPassword || !newPassword) {
                return json({ success: false, error: '参数不完整' }, 400);
            }

            const currentUser = await parseAuthHeader(context.request, context.env);
            if (!currentUser || currentUser.username !== username) {
                return json({ success: false, error: '只能修改自己的密码' }, 403);
            }

            // 查找用户原始数据
            const found = await findUserForLogin(kv, username);
            if (!found) {
                return json({ success: false, error: '用户不存在' }, 404);
            }

            const ok = await verifyPassword(oldPassword, found.user.passwordHash, found.user.salt);
            if (!ok) {
                return json({ success: false, error: '原密码错误' }, 401);
            }

            // 更新密码
            const { passwordHash, salt } = await hashPassword(newPassword);
            found.user.passwordHash = passwordHash;
            found.user.salt = salt;
            found.user.updatedAt = getNowISO();

            // 保存回 KV
            if (found.clinicId) {
                const users = await kv.get(`clinic:${found.clinicId}:users`, 'json');
                const idx = users.findIndex(u => u.username === username);
                if (idx !== -1) {
                    users[idx] = found.user;
                    await kv.put(`clinic:${found.clinicId}:users`, JSON.stringify(users));
                }
            } else {
                // platform_admin
                const admins = await kv.get(KV_SYSTEM_PLATFORM_ADMINS, 'json');
                const idx = admins.findIndex(u => u.username === username);
                if (idx !== -1) {
                    admins[idx] = found.user;
                    await kv.put(KV_SYSTEM_PLATFORM_ADMINS, JSON.stringify(admins));
                }
            }

            return json({ success: true, message: '密码修改成功' });
        }

        // ===== 诊所列表 GET /users?clinics=true =====
        if (method === 'GET' && url.searchParams.get('clinics') === 'true') {
            const currentUser = await parseAuthHeader(context.request, context.env);
            if (!currentUser || !isPlatformAdmin(currentUser)) {
                return json({ success: false, error: '仅平台总管理员可查看诊所列表' }, 403);
            }

            const clinics = await kv.get(KV_SYSTEM_CLINICS, 'json');
            if (!clinics || !Array.isArray(clinics)) {
                return json({ success: true, data: [] });
            }

            const result = [];
            for (const clinic of clinics) {
                const users = await kv.get(`clinic:${clinic.id}:users`, 'json');
                const admin = users && users.find(u => u.role === ROLE_CLINIC_ADMIN);
                const doctorCount = users ? users.filter(u => u.role === ROLE_DOCTOR).length : 0;
                result.push({
                    id: clinic.id,
                    name: clinic.name,
                    status: clinic.status,
                    adminUsername: admin ? admin.username : '-',
                    adminName: admin ? admin.name : '-',
                    doctorCount,
                    userCount: users ? users.length : 0,
                    createdAt: clinic.createdAt
                });
            }

            return json({ success: true, data: result });
        }

        // ===== 创建诊所 POST /users?clinic=create =====
        if (method === 'POST' && url.searchParams.get('clinic') === 'create') {
            const currentUser = await parseAuthHeader(context.request, context.env);
            if (!currentUser || !isPlatformAdmin(currentUser)) {
                return json({ success: false, error: '仅平台总管理员可创建诊所' }, 403);
            }

            const body = await context.request.json().catch(() => ({}));
            const { clinicName, adminUsername, adminPassword, adminName } = body;
            if (!clinicName || !adminUsername || !adminPassword) {
                return json({ success: false, error: '请填写诊所名称、管理员账号和密码' }, 400);
            }
            if (/[\u4e00-\u9fa5]/.test(adminUsername)) {
                return json({ success: false, error: '管理员登录账号不能使用中文' }, 400);
            }

            // 检查用户名是否已存在
            const existing = await findUserForLogin(kv, adminUsername);
            if (existing) {
                return json({ success: false, error: '登录账号已存在，请更换' }, 409);
            }

            const clinicId = generateId('clinic');
            const now = getNowISO();
            const { passwordHash, salt } = await hashPassword(adminPassword);

            const clinic = {
                id: clinicId,
                name: clinicName,
                status: 'active',
                createdAt: now,
                updatedAt: now
            };

            const adminUser = {
                username: adminUsername,
                name: adminName || adminUsername,
                role: ROLE_CLINIC_ADMIN,
                passwordHash,
                salt,
                allowedMode: 'both',
                cloudEnabled: true,
                allowSavePrescription: true,
                createdAt: now,
                updatedAt: now
            };

            // 保存诊所
            const clinics = (await kv.get(KV_SYSTEM_CLINICS, 'json')) || [];
            clinics.push(clinic);
            await kv.put(KV_SYSTEM_CLINICS, JSON.stringify(clinics));

            // 保存诊所用户
            await kv.put(`clinic:${clinicId}:users`, JSON.stringify([adminUser]));

            return json({
                success: true,
                clinic,
                admin: sanitizeUser(adminUser, clinicId, clinicName)
            });
        }

        // ===== 更新诊所 POST /users?clinic=update =====
        if (method === 'POST' && url.searchParams.get('clinic') === 'update') {
            const currentUser = await parseAuthHeader(context.request, context.env);
            if (!currentUser || !isPlatformAdmin(currentUser)) {
                return json({ success: false, error: '仅平台总管理员可更新诊所' }, 403);
            }

            const body = await context.request.json().catch(() => ({}));
            const { clinicId, status, name, adminUsername, adminName, adminPassword } = body;
            if (!clinicId) {
                return json({ success: false, error: '缺少诊所ID' }, 400);
            }

            const clinics = (await kv.get(KV_SYSTEM_CLINICS, 'json')) || [];
            const clinicIdx = clinics.findIndex(c => c.id === clinicId);
            if (clinicIdx === -1) {
                return json({ success: false, error: '诊所不存在' }, 404);
            }

            const now = getNowISO();

            // 更新诊所状态或名称
            if (status !== undefined) {
                clinics[clinicIdx].status = status;
            }
            if (name !== undefined) {
                clinics[clinicIdx].name = name;
            }
            clinics[clinicIdx].updatedAt = now;
            await kv.put(KV_SYSTEM_CLINICS, JSON.stringify(clinics));

            // 更新管理员信息（如果有提供）
            if (adminUsername || adminName || adminPassword) {
                const users = (await kv.get(`clinic:${clinicId}:users`, 'json')) || [];
                const adminIdx = users.findIndex(u => u.role === ROLE_CLINIC_ADMIN);
                if (adminIdx !== -1) {
                    if (adminUsername) users[adminIdx].username = adminUsername;
                    if (adminName) users[adminIdx].name = adminName;
                    if (adminPassword) {
                        const { passwordHash, salt } = await hashPassword(adminPassword);
                        users[adminIdx].passwordHash = passwordHash;
                        users[adminIdx].salt = salt;
                    }
                    users[adminIdx].updatedAt = now;
                    await kv.put(`clinic:${clinicId}:users`, JSON.stringify(users));
                }
            }

            return json({ success: true, clinic: clinics[clinicIdx] });
        }

        // ===== GET 用户列表 =====
        if (method === 'GET') {
            const currentUser = await parseAuthHeader(context.request, context.env);
            if (!currentUser) {
                return json({ success: false, error: '未授权访问' }, 401);
            }

            if (isPlatformAdmin(currentUser)) {
                // platform_admin 看所有用户
                const allUsers = await getAllClinicUsers(kv);
                const admins = (await kv.get(KV_SYSTEM_PLATFORM_ADMINS, 'json')) || [];
                const platformAdmins = admins.map(a => sanitizeUser(a, null, null));
                return json({ success: true, data: [...platformAdmins, ...allUsers], count: platformAdmins.length + allUsers.length });
            }

            if (isClinicAdmin(currentUser)) {
                // clinic_admin 看本诊所用户
                const users = (await kv.get(`clinic:${currentUser.clinicId}:users`, 'json')) || [];
                const clinics = (await kv.get(KV_SYSTEM_CLINICS, 'json')) || [];
                const clinic = clinics.find(c => c.id === currentUser.clinicId);
                const clinicName = clinic ? clinic.name : null;
                const data = users.map(u => sanitizeUser(u, currentUser.clinicId, clinicName));
                return json({ success: true, data, count: data.length });
            }

            // doctor 仅看自己
            const found = await findUserForLogin(kv, currentUser.username);
            if (!found) {
                return json({ success: true, data: [] });
            }
            return json({ success: true, data: [sanitizeUser(found.user, found.clinicId, found.clinicName)], count: 1 });
        }

        // ===== POST 保存用户列表 =====
        if (method === 'POST') {
            const body = await context.request.json().catch(() => ({}));
            if (!body.users || !Array.isArray(body.users)) {
                return json({ success: false, error: 'Missing or invalid users data' }, 400);
            }

            const currentUser = await parseAuthHeader(context.request, context.env);
            if (!currentUser) {
                return json({ success: false, error: 'Forbidden: 需登录身份' }, 403);
            }

            if (isPlatformAdmin(currentUser)) {
                // platform_admin：可管理所有诊所
                // 按诊所分组保存
                const clinics = (await kv.get(KV_SYSTEM_CLINICS, 'json')) || [];
                for (const clinic of clinics) {
                    const clinicUsers = body.users.filter(u => u.clinicId === clinic.id || (!u.clinicId && u.role !== ROLE_PLATFORM_ADMIN));
                    if (clinicUsers.length > 0) {
                        const existingUsers = (await kv.get(`clinic:${clinic.id}:users`, 'json')) || [];
                        const savedUsers = await processUsersForSave(clinicUsers, existingUsers);
                        await kv.put(`clinic:${clinic.id}:users`, JSON.stringify(savedUsers));
                    }
                }
                // 保存 platform_admins（如果有）
                const platformAdmins = body.users.filter(u => u.role === ROLE_PLATFORM_ADMIN);
                if (platformAdmins.length > 0) {
                    const existingAdmins = (await kv.get(KV_SYSTEM_PLATFORM_ADMINS, 'json')) || [];
                    const savedAdmins = await processUsersForSave(platformAdmins, existingAdmins);
                    await kv.put(KV_SYSTEM_PLATFORM_ADMINS, JSON.stringify(savedAdmins));
                }
                return json({ success: true, message: 'Users saved successfully', count: body.users.length });
            }

            if (isClinicAdmin(currentUser)) {
                // clinic_admin：仅管理本诊所
                const clinicId = currentUser.clinicId;
                const existingUsers = (await kv.get(`clinic:${clinicId}:users`, 'json')) || [];

                // 验证：不能修改为 platform_admin
                for (const u of body.users) {
                    if (u.role === ROLE_PLATFORM_ADMIN) {
                        return json({ success: false, error: 'Forbidden: 不能创建平台管理员' }, 403);
                    }
                    if (u.clinicId && u.clinicId !== clinicId) {
                        return json({ success: false, error: 'Forbidden: 不能修改其他诊所用户' }, 403);
                    }
                }

                const savedUsers = await processUsersForSave(body.users, existingUsers);
                await kv.put(`clinic:${clinicId}:users`, JSON.stringify(savedUsers));
                return json({ success: true, message: 'Users saved successfully', count: body.users.length });
            }

            // doctor：仅改自己密码
            const found = await findUserForLogin(kv, currentUser.username);
            if (!found) {
                return json({ success: false, error: '用户不存在' }, 404);
            }

            // 验证：只能修改自己的密码
            if (body.users.length !== 1 || body.users[0].username !== currentUser.username) {
                return json({ success: false, error: 'Forbidden: 仅可修改自己的密码' }, 403);
            }

            const userBody = body.users[0];
            if (userBody.password) {
                const { passwordHash, salt } = await hashPassword(userBody.password);
                found.user.passwordHash = passwordHash;
                found.user.salt = salt;
                found.user.updatedAt = getNowISO();

                if (found.clinicId) {
                    const users = (await kv.get(`clinic:${found.clinicId}:users`, 'json')) || [];
                    const idx = users.findIndex(u => u.username === currentUser.username);
                    if (idx !== -1) {
                        users[idx] = found.user;
                        await kv.put(`clinic:${found.clinicId}:users`, JSON.stringify(users));
                    }
                } else {
                    const admins = (await kv.get(KV_SYSTEM_PLATFORM_ADMINS, 'json')) || [];
                    const idx = admins.findIndex(u => u.username === currentUser.username);
                    if (idx !== -1) {
                        admins[idx] = found.user;
                        await kv.put(KV_SYSTEM_PLATFORM_ADMINS, JSON.stringify(admins));
                    }
                }
            }

            return json({ success: true, message: '密码修改成功' });
        }

        return json({ success: false, error: 'Method not allowed' }, 405);

    } catch (error) {
        console.error('Users API error:', error);
        return json({ success: false, error: error.message || 'Internal server error' }, 500);
    }
}

// 处理用户列表保存：明文密码哈希、保留原密码
async function processUsersForSave(newUsers, existingUsers) {
    const now = getNowISO();
    const result = [];

    for (const newUser of newUsers) {
        const existing = existingUsers.find(u => u.username === newUser.username);
        let saved;

        if (existing) {
            // 编辑已有用户
            saved = { ...existing };
            saved.name = newUser.name !== undefined ? newUser.name : existing.name;
            saved.role = newUser.role !== undefined ? newUser.role : existing.role;
            saved.allowedMode = newUser.allowedMode !== undefined ? newUser.allowedMode : (existing.allowedMode || 'both');
            saved.cloudEnabled = newUser.cloudEnabled !== undefined ? newUser.cloudEnabled : computeCloudEnabled(saved);
            saved.allowSavePrescription = newUser.allowSavePrescription !== undefined ? newUser.allowSavePrescription : (existing.allowSavePrescription !== undefined ? existing.allowSavePrescription : true);
            saved.updatedAt = now;

            // 密码处理
            if (newUser.password) {
                // 明文密码 → 哈希
                const { passwordHash, salt } = await hashPassword(newUser.password);
                saved.passwordHash = passwordHash;
                saved.salt = salt;
            } else if (newUser.passwordHash && newUser.salt) {
                // 已有哈希 → 保留
                saved.passwordHash = newUser.passwordHash;
                saved.salt = newUser.salt;
            }
            // 否则保留 existing 的 passwordHash 和 salt
        } else {
            // 新增用户
            saved = {
                username: newUser.username,
                name: newUser.name || newUser.username,
                role: newUser.role || ROLE_DOCTOR,
                allowedMode: newUser.allowedMode || 'both',
                cloudEnabled: newUser.cloudEnabled !== undefined ? newUser.cloudEnabled : false,
                allowSavePrescription: newUser.allowSavePrescription !== undefined ? newUser.allowSavePrescription : true,
                createdAt: now,
                updatedAt: now
            };

            if (newUser.password) {
                const { passwordHash, salt } = await hashPassword(newUser.password);
                saved.passwordHash = passwordHash;
                saved.salt = salt;
            } else if (newUser.passwordHash && newUser.salt) {
                saved.passwordHash = newUser.passwordHash;
                saved.salt = newUser.salt;
            }
        }

        result.push(saved);
    }

    return result;
}
