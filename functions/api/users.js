import {
    parseAuthHeader, hashPassword, verifyPassword, signToken,
    isPlatformAdmin, isClinicAdmin, isAdmin, isLegacyPasswordHash,
    revokeAllUserTokens,
    ROLE_PLATFORM_ADMIN, ROLE_CLINIC_ADMIN, ROLE_DOCTOR,
    KV_SYSTEM_CLINICS, KV_SYSTEM_PLATFORM_ADMINS
} from './_lib/auth.js';

// P1-6 安全增强：CORS 白名单（替代通配符 '*'）
function getAllowedOrigins() {
    return [
        'https://tcm-prescription-system.pages.dev',
        'https://hjkangtcm.pages.dev',
        'http://localhost:3000',
        'http://localhost:8080',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:8080'
    ];
}

function corsHeaders(request) {
    const origin = request?.headers?.get('Origin') || '';
    // 无 Origin 头（同源请求或非浏览器请求）：保持 '*' 向后兼容
    if (!origin) {
        return {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
            'Access-Control-Max-Age': '86400',
            'Content-Type': 'application/json'
        };
    }
    const allowed = getAllowedOrigins();
    // 允许 pages.dev 子域（每个诊所可能有自己的子域）
    const isPagesDev = origin.endsWith('.pages.dev') && origin.startsWith('https://');
    const allowedOrigin = (allowed.includes(origin) || isPagesDev) ? origin : 'null';
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
        'Content-Type': 'application/json'
    };
}

function json(data, status = 200, request = null) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders(request) });
}

// P1-1 安全增强：登录失败锁定（5 次失败后锁定 15 分钟）
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_TTL = 15 * 60; // 15 分钟（秒）

async function recordLoginFailure(kv, username) {
    const key = 'login_fail:' + username;
    const count = parseInt(await kv.get(key) || '0', 10) + 1;
    await kv.put(key, String(count), { expirationTtl: LOGIN_LOCK_TTL });
    return count;
}

async function checkLoginLocked(kv, username) {
    const key = 'login_fail:' + username;
    const count = parseInt(await kv.get(key) || '0', 10);
    return count >= LOGIN_MAX_FAILURES;
}

async function clearLoginFailures(kv, username) {
    const key = 'login_fail:' + username;
    await kv.delete(key);
}

// P1-1 安全增强：IP 限流（10 次/分钟）
const IP_RATE_LIMIT_MAX = 10;
const IP_RATE_LIMIT_TTL = 60; // 60 秒

async function checkIpRateLimit(kv, request) {
    try {
        const cf = request.cf;
        const ip = request.headers.get('CF-Connecting-IP') ||
                   request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
                   'unknown';
        if (ip === 'unknown') return true; // 无法识别 IP 时放行
        const key = 'ip_rate:' + ip;
        const count = parseInt(await kv.get(key) || '0', 10) + 1;
        if (count === 1) {
            await kv.put(key, '1', { expirationTtl: IP_RATE_LIMIT_TTL });
        } else {
            await kv.put(key, String(count), { expirationTtl: IP_RATE_LIMIT_TTL });
        }
        return count <= IP_RATE_LIMIT_MAX;
    } catch (e) {
        return true; // 限流失败不阻塞业务
    }
}

// P1-2 安全增强：操作审计日志
async function writeAuditLog(kv, clinicId, username, role, action, target, request, extra = {}) {
    try {
        const date = new Date().toISOString().split('T')[0];
        const key = `audit_log:${clinicId || 'platform'}:${date}`;
        const logs = (await kv.get(key, 'json')) || [];
        logs.push({
            timestamp: new Date().toISOString(),
            username,
            role,
            action,
            target,
            ip: request?.headers?.get('CF-Connecting-IP') || 'unknown',
            userAgent: request?.headers?.get('User-Agent') || 'unknown',
            ...extra
        });
        // 保留最近 1000 条
        if (logs.length > 1000) logs.splice(0, logs.length - 1000);
        await kv.put(key, JSON.stringify(logs), { expirationTtl: 90 * 24 * 60 * 60 }); // 保留 90 天
    } catch (e) {
        console.error('writeAuditLog error:', e);
    }
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
        // P0-10 安全修复：原公开端点泄露用户元数据，现已改为需要 platform_admin 鉴权
        if (method === 'GET' && url.searchParams.get('check')) {
            const authUser = await parseAuthHeader(context.request, context.env);
            if (!authUser || !isPlatformAdmin(authUser)) {
                return json({ success: false, error: '未授权：仅平台总管理员可使用诊断端点' }, 401);
            }

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
        // P0-3 安全修复：原端点无认证，现改为需要 platform_admin 鉴权
        if (method === 'GET' && url.searchParams.get('platform-admins') === 'true') {
            const authUser = await parseAuthHeader(context.request, context.env);
            if (!authUser || !isPlatformAdmin(authUser)) {
                return json({ success: false, error: '未授权：仅平台总管理员可查看平台管理员列表' }, 401);
            }
            const admins = (await kv.get(KV_SYSTEM_PLATFORM_ADMINS, 'json')) || [];
            return json({ success: true, data: admins.map(a => ({ username: a.username, name: a.name, role: a.role })) });
        }

        // ===== 登录端点 POST /users?login=true =====
        if (method === 'POST' && url.searchParams.get('login') === 'true') {
            // P1-1：IP 限流（10 次/分钟）
            const allowedIp = await checkIpRateLimit(kv, context.request);
            if (!allowedIp) {
                return json({ success: false, error: '请求过于频繁，请稍后再试' }, 429, context.request);
            }

            const bodyText = await context.request.text();
            let body = {};
            try { body = JSON.parse(bodyText); } catch (e) {}
            const { username, password } = body;
            if (!username || !password) {
                return json({ success: false, error: '用户名或密码不能为空' }, 400, context.request);
            }

            // P1-1：检查账户是否被锁定
            const isLocked = await checkLoginLocked(kv, username);
            if (isLocked) {
                return json({ success: false, error: '账户已被锁定，请 15 分钟后再试', code: 'ACCOUNT_LOCKED' }, 423, context.request);
            }

            const found = await findUserForLogin(kv, username);
            if (!found) {
                console.error('[登录失败] 用户不存在:', username);
                const failCount = await recordLoginFailure(kv, username);
                await writeAuditLog(kv, null, username, 'unknown', 'login_failed', 'user_not_found', context.request, { failCount });
                return json({ success: false, error: '用户名或密码错误' }, 401, context.request);
            }

            const { user, clinicId, clinicName } = found;

            if (!user.passwordHash || !user.salt) {
                console.error('[登录失败] 用户数据不完整，缺少 passwordHash 或 salt:', username);
                return json({ success: false, error: '用户尚未设置密码，请联系管理员重置密码', code: 'NO_PASSWORD' }, 401, context.request);
            }

            const ok = await verifyPassword(password, user.passwordHash, user.salt);
            if (!ok) {
                console.error('[登录失败] 密码验证失败:', username);
                const failCount = await recordLoginFailure(kv, username);
                await writeAuditLog(kv, clinicId, username, user.role, 'login_failed', 'wrong_password', context.request, { failCount });
                const remaining = Math.max(0, LOGIN_MAX_FAILURES - failCount);
                const errorMsg = remaining > 0
                    ? `用户名或密码错误，剩余尝试次数：${remaining}`
                    : '账户已被锁定，请 15 分钟后再试';
                const status = remaining > 0 ? 401 : 423;
                return json({ success: false, error: errorMsg, code: remaining > 0 ? 'WRONG_PASSWORD' : 'ACCOUNT_LOCKED' }, status, context.request);
            }

            // P0-11 自动升级：检测旧 SHA-256 哈希，登录成功后自动升级为 PBKDF2
            if (isLegacyPasswordHash(user.passwordHash)) {
                try {
                    const { passwordHash: newHash, salt: newSalt } = await hashPassword(password);
                    user.passwordHash = newHash;
                    user.salt = newSalt;
                    user.updatedAt = getNowISO();
                    // 保存升级后的密码
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
                    console.log('[P0-11] 密码哈希已自动升级为 PBKDF2:', username);
                } catch (upgradeErr) {
                    console.error('[P0-11] 密码升级失败（不影响登录）:', upgradeErr);
                }
            }

            // P1-1：登录成功，清除失败计数
            await clearLoginFailures(kv, username);

            const token = await signToken({
                username: user.username,
                role: user.role,
                clinicId: clinicId
            }, context.env);

            // P1-2：记录登录成功审计日志
            await writeAuditLog(kv, clinicId, user.username, user.role, 'login_success', 'auth', context.request);

            return json({
                success: true,
                token,
                user: sanitizeUser(user, clinicId, clinicName)
            }, 200, context.request);
        }

        // ===== [P0-2 安全修复 已删除] 公开重置密码端点 POST /users?action=reset-public =====
        // 该端点无需认证即可重置任意用户密码，构成账号接管风险，已于 2026-07-18 移除。
        // 替代方案：使用 POST /users?action=change-password（需登录 + 校验旧密码），
        // 或由 clinic_admin/platform_admin 通过用户管理界面重置（已具备权限）。
        if (method === 'POST' && url.searchParams.get('action') === 'reset-public') {
            return json({ success: false, error: '该端点已废弃，请使用 change-password 或联系管理员重置' }, 410);
        }

        // ===== 修改密码端点 POST /users?action=change-password =====
        if (method === 'POST' && url.searchParams.get('action') === 'change-password') {
            const body = await context.request.json().catch(() => ({}));
            const { username, oldPassword, newPassword } = body;
            if (!username || !oldPassword || !newPassword) {
                return json({ success: false, error: '参数不完整' }, 400, context.request);
            }

            const currentUser = await parseAuthHeader(context.request, context.env);
            if (!currentUser || currentUser.username !== username) {
                return json({ success: false, error: '只能修改自己的密码' }, 403, context.request);
            }

            // 查找用户原始数据
            const found = await findUserForLogin(kv, username);
            if (!found) {
                return json({ success: false, error: '用户不存在' }, 404, context.request);
            }

            const ok = await verifyPassword(oldPassword, found.user.passwordHash, found.user.salt);
            if (!ok) {
                await writeAuditLog(kv, found.clinicId, username, found.user.role, 'change_password_failed', 'self', context.request);
                return json({ success: false, error: '原密码错误' }, 401, context.request);
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

            // P1-3：撤销该用户所有 Token，强制重新登录
            await revokeAllUserTokens(kv, username);
            await writeAuditLog(kv, found.clinicId, username, found.user.role, 'change_password_success', 'self', context.request);

            return json({ success: true, message: '密码修改成功，请使用新密码重新登录' }, 200, context.request);
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

        // ===== P1 安全分发优化：批量导出用户 GET /users?action=export =====
        // 用途：clinic_admin 导出本诊所用户 / platform_admin 导出指定诊所或全部诊所用户
        // 权限：clinic_admin（仅本诊所）/ platform_admin（任意诊所或全部）
        // 返回：不含 passwordHash/salt 的安全用户列表（CSV 友好格式）
        if (method === 'GET' && url.searchParams.get('action') === 'export') {
            const currentUser = await parseAuthHeader(context.request, context.env);
            if (!currentUser || !isAdmin(currentUser)) {
                return json({ success: false, error: '未授权：仅管理员可导出用户' }, 401, context.request);
            }

            const requestedClinicId = url.searchParams.get('clinicId');
            const exportData = [];
            const now = getNowISO();

            if (isPlatformAdmin(currentUser)) {
                // platform_admin：可导出任意诊所
                if (requestedClinicId) {
                    // 导出指定诊所
                    const clinics = await kv.get(KV_SYSTEM_CLINICS, 'json');
                    const clinic = clinics && clinics.find(c => c.id === requestedClinicId);
                    if (!clinic) {
                        return json({ success: false, error: '诊所不存在' }, 404, context.request);
                    }
                    const users = (await kv.get(`clinic:${requestedClinicId}:users`, 'json')) || [];
                    users.forEach(u => exportData.push({
                        clinicId: requestedClinicId,
                        clinicName: clinic.name,
                        ...sanitizeUser(u, requestedClinicId, clinic.name)
                    }));
                } else {
                    // 导出全部诊所用户
                    const clinics = (await kv.get(KV_SYSTEM_CLINICS, 'json')) || [];
                    for (const clinic of clinics) {
                        if (clinic.status !== 'active') continue;
                        const users = await kv.get(`clinic:${clinic.id}:users`, 'json');
                        if (users && Array.isArray(users)) {
                            users.forEach(u => exportData.push({
                                clinicId: clinic.id,
                                clinicName: clinic.name,
                                ...sanitizeUser(u, clinic.id, clinic.name)
                            }));
                        }
                    }
                }
            } else {
                // clinic_admin：仅导出本诊所
                const clinicId = currentUser.clinicId;
                if (!clinicId) {
                    return json({ success: false, error: '当前用户未绑定诊所' }, 400, context.request);
                }
                const clinics = await kv.get(KV_SYSTEM_CLINICS, 'json');
                const clinic = clinics && clinics.find(c => c.id === clinicId);
                const clinicName = clinic ? clinic.name : null;
                const users = (await kv.get(`clinic:${clinicId}:users`, 'json')) || [];
                users.forEach(u => exportData.push({
                    clinicId: clinicId,
                    clinicName: clinicName,
                    ...sanitizeUser(u, clinicId, clinicName)
                }));
            }

            await writeAuditLog(kv, currentUser.clinicId, currentUser.username, currentUser.role, 'export_users', `count=${exportData.length}`, context.request);

            return json({
                success: true,
                exportedAt: now,
                count: exportData.length,
                data: exportData
            }, 200, context.request);
        }

        // ===== P1 安全分发优化：批量导入用户 POST /users?action=import =====
        // 用途：clinic_admin 批量导入本诊所用户 / platform_admin 导入到指定诊所
        // 权限：clinic_admin（仅本诊所，不能导入 platform_admin）/ platform_admin（任意诊所）
        // 请求体：{ clinicId?: string, users: [{ username, password, name, role, allowedMode?, cloudEnabled?, allowSavePrescription? }] }
        // 限制：单次最多 100 条；username 重复则跳过（不覆盖）
        if (method === 'POST' && url.searchParams.get('action') === 'import') {
            const currentUser = await parseAuthHeader(context.request, context.env);
            if (!currentUser || !isAdmin(currentUser)) {
                return json({ success: false, error: '未授权：仅管理员可导入用户' }, 401, context.request);
            }

            const body = await context.request.json().catch(() => ({}));
            const { users: importUsers, clinicId: requestedClinicId } = body;

            if (!Array.isArray(importUsers) || importUsers.length === 0) {
                return json({ success: false, error: '请提供要导入的用户列表' }, 400, context.request);
            }
            if (importUsers.length > 100) {
                return json({ success: false, error: '单次最多导入 100 条用户，请分批导入' }, 400, context.request);
            }

            // 确定目标诊所
            let targetClinicId;
            if (isPlatformAdmin(currentUser)) {
                targetClinicId = requestedClinicId;
                if (!targetClinicId) {
                    return json({ success: false, error: 'platform_admin 导入时必须指定 clinicId' }, 400, context.request);
                }
            } else {
                // clinic_admin：仅能导入到自己的诊所
                targetClinicId = currentUser.clinicId;
                if (!targetClinicId) {
                    return json({ success: false, error: '当前用户未绑定诊所' }, 400, context.request);
                }
            }

            // 验证目标诊所存在
            const clinics = await kv.get(KV_SYSTEM_CLINICS, 'json');
            const clinic = clinics && clinics.find(c => c.id === targetClinicId);
            if (!clinic) {
                return json({ success: false, error: '目标诊所不存在' }, 404, context.request);
            }

            // 参数校验 + 权限校验
            for (const u of importUsers) {
                if (!u.username || !u.password) {
                    return json({ success: false, error: `用户数据不完整：username 和 password 必填` }, 400, context.request);
                }
                if (/[\u4e00-\u9fa5]/.test(u.username)) {
                    return json({ success: false, error: `登录账号不能使用中文: ${u.username}` }, 400, context.request);
                }
                // clinic_admin 不能导入 platform_admin
                if (!isPlatformAdmin(currentUser) && u.role === ROLE_PLATFORM_ADMIN) {
                    return json({ success: false, error: '权限不足：不能导入平台管理员' }, 403, context.request);
                }
            }

            // 检查用户名冲突（跨诊所 + 平台管理员）
            const existingAdmins = (await kv.get(KV_SYSTEM_PLATFORM_ADMINS, 'json')) || [];
            const existingClinicUsers = (await kv.get(`clinic:${targetClinicId}:users`, 'json')) || [];
            const allExistingUsernames = new Set([
                ...existingAdmins.map(u => u.username),
                ...existingClinicUsers.map(u => u.username)
            ]);
            // 检查所有诊所用户名冲突（用户名全局唯一）
            for (const c of (clinics || [])) {
                if (c.id === targetClinicId) continue;
                const otherUsers = await kv.get(`clinic:${c.id}:users`, 'json');
                if (otherUsers) {
                    otherUsers.forEach(u => allExistingUsernames.add(u.username));
                }
            }

            const skipped = [];
            const toImport = [];
            for (const u of importUsers) {
                if (allExistingUsernames.has(u.username)) {
                    skipped.push({ username: u.username, reason: '用户名已存在' });
                } else {
                    toImport.push(u);
                }
            }

            // 设置默认值 + 限制 role
            const normalizedUsers = toImport.map(u => ({
                username: u.username,
                name: u.name || u.username,
                password: u.password,
                role: u.role || ROLE_DOCTOR,  // 默认 doctor
                allowedMode: u.allowedMode || 'both',
                cloudEnabled: u.cloudEnabled !== undefined ? u.cloudEnabled : true,
                allowSavePrescription: u.allowSavePrescription !== undefined ? u.allowSavePrescription : true
            }));

            // 使用 processUsersForSave 哈希密码 + 合并
            const savedUsers = await processUsersForSave(normalizedUsers, existingClinicUsers);
            await kv.put(`clinic:${targetClinicId}:users`, JSON.stringify(savedUsers));

            await writeAuditLog(kv, targetClinicId, currentUser.username, currentUser.role, 'import_users', `clinic=${clinic.name}, imported=${normalizedUsers.length}, skipped=${skipped.length}`, context.request);

            return json({
                success: true,
                message: `导入完成：成功 ${normalizedUsers.length} 条，跳过 ${skipped.length} 条`,
                imported: normalizedUsers.length,
                skipped: skipped.length,
                skippedDetails: skipped,
                clinicId: targetClinicId,
                clinicName: clinic.name
            }, 200, context.request);
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
