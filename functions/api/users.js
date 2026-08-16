import { getKV } from './_lib/kv.js';
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

// ★ P1-6 防登录枚举：哑验证参数（格式与真实 PBKDF2 哈希一致，SHA-256 输出 64 个十六进制字符）
//   用户不存在/数据不完整时用它执行一次等代价的 PBKDF2 验证，对齐响应时间，防时序攻击
const DUMMY_PASSWORD_HASH = 'pbkdf2$100000$' + '0'.repeat(64);
const DUMMY_SALT = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

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

// ★ P2-B 统一：getKV 改用 _lib/kv.js 单一事实源（顶部 import）

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
// ★ 优化：添加 clinicStatus 和 userType 字段，区分正式用户和测试用户
function sanitizeUser(user, clinicId, clinicName, clinicStatus) {
    const effectiveStatus = clinicStatus || 'active';
    const isTestUser = effectiveStatus === 'test';
    return {
        username: user.username,
        name: user.name || user.username,
        role: user.role,
        clinicId: clinicId || user.clinicId || null,
        clinicName: clinicName || null,
        clinicStatus: effectiveStatus,
        userType: isTestUser ? 'test' : 'production',
        allowedMode: user.allowedMode || 'both',
        cloudEnabled: user.cloudEnabled !== undefined ? user.cloudEnabled : computeCloudEnabled(user),
        allowSavePrescription: user.allowSavePrescription !== undefined ? user.allowSavePrescription : true,
        hasPassword: !!(user.passwordHash || user.password),
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
    };
}

// 登录：遍历 platform_admins + 所有诊所用户
// ★ 支持手机号/用户名双模式登录：username 参数可传手机号或用户名
// 搜索策略：先匹配 username 字段，再匹配 phone 字段
// 返回值：{ user, clinicId, clinicName, clinicStatus, error }
//   - 成功：返回 user 信息（诊所被禁用时 clinicStatus='disabled'，由登录分支在密码验证后再拒绝）
//   - 失败：返回 { user: null, error: { code: 'USER_NOT_FOUND', message } }
async function findUserForLogin(kv, username) {
    if (!username) return { user: null, error: { code: 'USER_NOT_FOUND', message: '用户不存在' } };
    const trimmed = String(username).trim();

    // 判断输入是否为纯手机号（11位数字），若是则优先按 phone 字段查找
    const isPhoneInput = /^1[3-9]\d{9}$/.test(trimmed);

    // 1. 先查 platform_admins
    const platformAdmins = await kv.get(KV_SYSTEM_PLATFORM_ADMINS, 'json');
    if (platformAdmins && Array.isArray(platformAdmins)) {
        // 优先 username 匹配
        let found = platformAdmins.find(u => u.username === trimmed);
        // 如果输入是手机号，额外匹配 phone 字段
        if (!found && isPhoneInput) {
            found = platformAdmins.find(u => u.phone === trimmed);
        }
        // 兜底：如果 username 匹配不到，尝试 phone 字段（兼容所有输入类型）
        if (!found) {
            found = platformAdmins.find(u => u.phone === trimmed);
        }
        if (found) {
            return { user: found, clinicId: null, clinicName: null, clinicStatus: 'active', error: null };
        }
    }

    // 2. 查所有诊所用户
    const clinics = await kv.get(KV_SYSTEM_CLINICS, 'json');
    if (!clinics || !Array.isArray(clinics)) {
        return { user: null, error: { code: 'USER_NOT_FOUND', message: '用户不存在' } };
    }

    // 先查找用户在哪个诊所（包括被禁用的诊所）
    let foundInDisabledClinic = null;
    let foundClinicInfo = null;

    for (const clinic of clinics) {
        const users = await kv.get(`clinic:${clinic.id}:users`, 'json');
        if (users && Array.isArray(users)) {
            // 优先 username 匹配
            let found = users.find(u => u.username === trimmed);
            // 如果输入是手机号，额外匹配 phone 字段
            if (!found && isPhoneInput) {
                found = users.find(u => u.phone === trimmed);
            }
            // 兜底：如果 username 匹配不到，尝试 phone 字段（兼容所有输入类型）
            if (!found) {
                found = users.find(u => u.phone === trimmed);
            }
            if (found) {
                foundClinicInfo = { 
                    user: found, 
                    clinicId: clinic.id, 
                    clinicName: clinic.name,
                    clinicStatus: clinic.status || 'active'
                };
                if (clinic.status === 'disabled') {
                    foundInDisabledClinic = foundClinicInfo;
                } else {
                    return foundClinicInfo;
                }
                break; // 找到用户即停止搜索
            }
        }
    }

    // 用户存在但所在诊所被禁用
    // ★ P1-6 修复：原实现返回 user:null + CLINIC_DISABLED error，登录分支在密码验证前
    //   即返回该错误，攻击者无需密码即可探测用户名是否存在。
    //   现返回完整用户结构（clinicStatus='disabled'），由登录分支在密码验证成功后再拒绝。
    if (foundInDisabledClinic) {
        return {
            user: foundInDisabledClinic.user,
            clinicId: foundInDisabledClinic.clinicId,
            clinicName: foundInDisabledClinic.clinicName,
            clinicStatus: 'disabled',
            error: null
        };
    }

    return { user: null, error: { code: 'USER_NOT_FOUND', message: '用户不存在' } };
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
            if (!found || !found.user) {
                return json({ 
                    success: false, 
                    error: found?.error?.message || '用户不存在', 
                    username: checkUsername,
                    errorCode: found?.error?.code || 'USER_NOT_FOUND'
                });
            }

            const { user, clinicId, clinicName, clinicStatus } = found;
            return json({
                success: true,
                username: user.username,
                name: user.name,
                role: user.role,
                clinicId: clinicId,
                clinicName: clinicName,
                clinicStatus: clinicStatus || 'active',
                hasPasswordHash: !!user.passwordHash,
                hasSalt: !!user.salt,
                hasPasswordField: !!user.password,
                allowedMode: user.allowedMode,
                cloudEnabled: user.cloudEnabled,
                userType: user.userType || (clinicStatus === 'test' ? 'test' : 'production'),
                createdAt: user.createdAt,
                updatedAt: user.updatedAt,
                userKeys: Object.keys(user)
            });
        }

        // ===== 公开诊断端点 GET /users?diagnose=username&key=xxx =====
        // 用于临时排查账号问题，需要 DIAGNOSE_KEY 环境变量验证
        if (method === 'GET' && url.searchParams.get('diagnose')) {
            const DIAGNOSE_KEY = context.env.DIAGNOSE_KEY || 'tcm_diagnose_2026';
            const providedKey = url.searchParams.get('key');
            
            if (providedKey !== DIAGNOSE_KEY) {
                return json({ success: false, error: '诊断密钥错误' }, 403);
            }

            const checkUsername = url.searchParams.get('diagnose');
            if (!checkUsername) {
                return json({ success: false, error: '请提供要诊断的用户名' }, 400);
            }

            const result = {
                timestamp: new Date().toISOString(),
                username: checkUsername,
                checks: {}
            };

            // 1. 检查 platform_admins
            const platformAdmins = await kv.get(KV_SYSTEM_PLATFORM_ADMINS, 'json');
            if (platformAdmins && Array.isArray(platformAdmins)) {
                const adminFound = platformAdmins.find(u => 
                    u.username === checkUsername || u.phone === checkUsername
                );
                if (adminFound) {
                    result.checks.platformAdmin = {
                        found: true,
                        role: adminFound.role,
                        name: adminFound.name,
                        hasPasswordHash: !!adminFound.passwordHash,
                        hasSalt: !!adminFound.salt,
                        allowedMode: adminFound.allowedMode,
                        createdAt: adminFound.createdAt,
                        updatedAt: adminFound.updatedAt
                    };
                } else {
                    result.checks.platformAdmin = { found: false, totalAdmins: platformAdmins.length };
                }
            } else {
                result.checks.platformAdmin = { found: false, reason: 'No platform admins or empty' };
            }

            // 2. 检查所有诊所用户
            const clinics = await kv.get(KV_SYSTEM_CLINICS, 'json');
            if (clinics && Array.isArray(clinics)) {
                result.checks.clinics = { totalClinics: clinics.length };
                
                let foundInClinic = false;
                for (const clinic of clinics) {
                    const users = await kv.get(`clinic:${clinic.id}:users`, 'json');
                    if (users && Array.isArray(users)) {
                        const userFound = users.find(u => 
                            u.username === checkUsername || u.phone === checkUsername
                        );
                        if (userFound) {
                            foundInClinic = true;
                            result.checks.userSearch = {
                                found: true,
                                location: 'clinic',
                                clinicId: clinic.id,
                                clinicName: clinic.name,
                                clinicStatus: clinic.status || 'active',
                                userInfo: {
                                    username: userFound.username,
                                    name: userFound.name,
                                    role: userFound.role,
                                    hasPasswordHash: !!userFound.passwordHash,
                                    hasSalt: !!userFound.salt,
                                    allowedMode: userFound.allowedMode,
                                    cloudEnabled: userFound.cloudEnabled,
                                    createdAt: userFound.createdAt,
                                    updatedAt: userFound.updatedAt
                                }
                            };
                            break;
                        }
                    }
                }
                
                if (!foundInClinic) {
                    result.checks.userSearch = { 
                        found: false, 
                        searchedClinics: clinics.length 
                    };
                }
            } else {
                result.checks.clinics = { totalClinics: 0 };
                result.checks.userSearch = { found: false, reason: 'No clinics' };
            }

            // 3. 检查登录失败次数
            const failKey = 'login_fail:' + checkUsername;
            const failCount = parseInt(await kv.get(failKey) || '0', 10);
            result.checks.loginFailures = {
                count: failCount,
                isLocked: failCount >= 5
            };

            // 4. 汇总
            result.summary = {
                exists: result.checks.platformAdmin?.found || result.checks.userSearch?.found || false,
                location: result.checks.platformAdmin?.found ? 'platform_admin' : 
                        (result.checks.userSearch?.found ? 'clinic_user' : 'not_found'),
                isLocked: result.checks.loginFailures?.isLocked || false,
                failCount: result.checks.loginFailures?.count || 0
            };

            return json(result);
        }

        // ===== 初始化平台管理员 POST /users?action=bootstrap =====
        // 仅当 system:platform_admins 为空时可用，用于创建第一个平台管理员
        if (method === 'POST' && url.searchParams.get('action') === 'bootstrap') {
            const body = await context.request.json().catch(() => ({}));
            const { username, password, name } = body;
            if (!username || !password) {
                return json({ success: false, error: '请提供用户名和密码' }, 400);
            }

            // P0-7 修复：IP 限流（3次/小时，与注册一致），防止部署窗口期被抢注/暴力探测
            const bootstrapKey = 'bootstrap_ip:' + (context.request.headers.get('CF-Connecting-IP') || 'unknown');
            const bootstrapCount = parseInt(await kv.get(bootstrapKey) || '0', 10) + 1;
            if (bootstrapCount === 1) {
                await kv.put(bootstrapKey, '1', { expirationTtl: 60 * 60 });
            } else {
                await kv.put(bootstrapKey, String(bootstrapCount), { expirationTtl: 60 * 60 });
            }
            if (bootstrapCount > 3) {
                await writeAuditLog(kv, null, 'anonymous', 'unknown', 'bootstrap_rate_limited', bootstrapKey, context.request);
                return json({ success: false, error: '请求过于频繁，请稍后再试' }, 429);
            }

            // P0-7 修复：密码强度校验（与注册一致：8-128位，含字母和数字）
            if (password.length < 8) {
                return json({ success: false, error: '密码至少8位' }, 400);
            }
            if (password.length > 128) {
                return json({ success: false, error: '密码过长（最多128位）' }, 400);
            }
            if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
                return json({ success: false, error: '密码必须同时包含字母和数字' }, 400);
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
        // ★ P0-1 修复：原实现无任何认证，任何人可直接重置平台管理员密码接管系统。
        //   现要求：必须由已认证的 platform_admin 发起（Bearer token），且新密码需满足强度要求。
        if (method === 'POST' && url.searchParams.get('action') === 'reset-platform-admin') {
            const body = await context.request.json().catch(() => ({}));
            const { username, password, name } = body;
            if (!username || !password) {
                return json({ success: false, error: '请提供用户名和新密码' }, 400);
            }

            // P0-1：认证——必须是已登录的 platform_admin
            const authUser = await parseAuthHeader(context.request, context.env);
            if (!authUser) {
                return json({ success: false, error: '未认证，请先以平台管理员身份登录' }, 401);
            }
            if (authUser.role !== ROLE_PLATFORM_ADMIN) {
                await writeAuditLog(kv, null, authUser.username, authUser.role, 'reset_platform_admin_denied', username, context.request);
                return json({ success: false, error: '无权限：仅平台管理员可重置管理员密码' }, 403);
            }

            // P0-1：新密码强度校验（与注册一致）
            if (password.length < 8 || password.length > 128) {
                return json({ success: false, error: '密码长度需在 8-128 位之间' }, 400);
            }
            if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
                return json({ success: false, error: '密码必须同时包含字母和数字' }, 400);
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
            // P0-1：审计日志 + 撤销该管理员的所有旧 token
            await writeAuditLog(kv, null, authUser.username, authUser.role, 'reset_platform_admin', username, context.request);
            try { await revokeAllUserTokens(kv, username); } catch (e) { console.error('revokeAllUserTokens error:', e); }
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
                return json({ success: false, error: '请求过于频繁，请稍后再试', code: 'IP_RATE_LIMITED' }, 429, context.request);
            }

            const bodyText = await context.request.text();
            let body = {};
            try { body = JSON.parse(bodyText); } catch (e) {}
            const { username, password } = body;
            if (!username || !password) {
                return json({ success: false, error: '手机号/用户名或密码不能为空', code: 'MISSING_CREDENTIALS' }, 400, context.request);
            }

            // P1-1：检查账户是否被锁定
            const isLocked = await checkLoginLocked(kv, username);
            if (isLocked) {
                return json({ success: false, error: '账户已被锁定，请 15 分钟后再试', code: 'ACCOUNT_LOCKED' }, 423, context.request);
            }

            const found = await findUserForLogin(kv, username);
            const { user, clinicId, clinicName, clinicStatus } = found || {};

            // ★ P1-6 防登录枚举：无论用户是否存在，统一走相同的密码验证流程并返回一致响应，
            //   防止攻击者通过错误码/错误消息/响应时间差异探测有效用户名。
            //   - 用户不存在或数据不完整：用哑哈希执行等代价 PBKDF2 验证后返回 WRONG_PASSWORD
            //   - CLINIC_DISABLED / INVALID_ROLE 检查后移至密码验证成功之后
            const userFound = !!(found && found.user);
            const hasPasswordData = !!(user && user.passwordHash && user.salt);
            const ok = await verifyPassword(
                password,
                hasPasswordData ? user.passwordHash : DUMMY_PASSWORD_HASH,
                hasPasswordData ? user.salt : DUMMY_SALT
            );

            if (!ok) {
                // 服务端日志与审计仍区分场景（便于安全追溯），但对客户端响应完全一致
                console.error('[登录失败]', userFound ? '密码错误:' : '用户不存在或凭据无效:', username);
                const failCount = await recordLoginFailure(kv, username);
                await writeAuditLog(
                    kv,
                    clinicId || null,
                    username,
                    userFound ? (user.role || 'unknown') : 'unknown',
                    'login_failed',
                    userFound ? 'wrong_password' : 'user_not_found',
                    context.request,
                    { failCount }
                );
                const remaining = Math.max(0, LOGIN_MAX_FAILURES - failCount);
                const errorMsg = remaining > 0
                    ? `密码错误，剩余尝试次数：${remaining} 次（${failCount}/${LOGIN_MAX_FAILURES}）`
                    : '密码错误次数过多，账户已被锁定 15 分钟，请稍后再试';
                const status = remaining > 0 ? 401 : 423;
                return json({
                    success: false,
                    error: errorMsg,
                    code: remaining > 0 ? 'WRONG_PASSWORD' : 'ACCOUNT_LOCKED',
                    remainingAttempts: remaining
                }, status, context.request);
            }

            // ===== 以下检查仅在密码验证成功后执行（P1-6：防止免密码探测用户名） =====

            // 诊所被禁用（原在密码验证前直接返回，构成用户名枚举向量）
            if (clinicStatus === 'disabled') {
                console.error('[登录失败] 诊所被禁用:', username, clinicName);
                await writeAuditLog(kv, clinicId, username, user.role, 'login_failed', 'clinic_disabled', context.request, { clinicName });
                return json({
                    success: false,
                    error: '诊所已被禁用，请联系平台管理员',
                    code: 'CLINIC_DISABLED',
                    clinicName: clinicName
                }, 403, context.request);
            }

            // 用户角色是否有效
            if (!user.role || !['platform_admin', 'clinic_admin', 'doctor'].includes(user.role)) {
                console.error('[登录失败] 用户角色无效:', username, user.role);
                return json({
                    success: false,
                    error: '用户角色无效，请联系管理员',
                    code: 'INVALID_ROLE'
                }, 401, context.request);
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
                user: sanitizeUser(user, clinicId, clinicName, clinicStatus)
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
            const { clinicName, adminUsername, adminPassword, adminName, clinicStatus } = body;
            if (!clinicName || !adminUsername || !adminPassword) {
                return json({ success: false, error: '请填写诊所名称、管理员账号和密码' }, 400);
            }
            if (!clinicName.trim()) {
                return json({ success: false, error: '诊所名称不能为空' }, 400);
            }
            if (clinicName.trim().length < 2 || clinicName.trim().length > 50) {
                return json({ success: false, error: '诊所名称长度需在 2-50 个字符之间' }, 400);
            }
            if (/[\u4e00-\u9fa5]/.test(adminUsername)) {
                return json({ success: false, error: '管理员登录账号不能使用中文' }, 400);
            }
            if (!/^admin_[a-z][a-z0-9]{1,11}$/.test(adminUsername)) {
                return json({ success: false, error: '管理员账号必须为 admin_诊所简码 格式（如 admin_hkt），仅小写字母和数字，2-12 位' }, 400);
            }
            // 密码强度校验（与自助注册保持一致）
            if (adminPassword.length < 8) {
                return json({ success: false, error: '密码至少8位' }, 400);
            }
            if (adminPassword.length > 128) {
                return json({ success: false, error: '密码过长（最多128位）' }, 400);
            }
            if (!/[a-zA-Z]/.test(adminPassword) || !/[0-9]/.test(adminPassword)) {
                return json({ success: false, error: '密码必须同时包含字母和数字' }, 400);
            }

            // 检查用户名是否已存在（全局唯一，跨诊所 + platform_admins）
            const existing = await findUserForLogin(kv, adminUsername);
            if (existing) {
                return json({ success: false, error: '登录账号已存在，请更换（admin_诊所简码 全局唯一）' }, 409);
            }

            // 检查诊所名称是否重复
            const clinics = (await kv.get(KV_SYSTEM_CLINICS, 'json')) || [];
            if (clinics.some(c => c.name === clinicName.trim())) {
                return json({ success: false, error: '该诊所名称已存在，请使用其他名称' }, 409);
            }

            const clinicId = generateId('clinic');
            const now = getNowISO();
            const { passwordHash, salt } = await hashPassword(adminPassword);

            const clinic = {
                id: clinicId,
                name: clinicName.trim(),
                status: 'active',
                createdAt: now,
                updatedAt: now
            };

            const adminUser = {
                username: adminUsername,
                name: (adminName || adminUsername).trim(),
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
            clinics.push(clinic);
            await kv.put(KV_SYSTEM_CLINICS, JSON.stringify(clinics));

            // 保存诊所用户
            await kv.put(`clinic:${clinicId}:users`, JSON.stringify([adminUser]));

            // 审计日志
            await writeAuditLog(kv, clinicId, currentUser.username, ROLE_PLATFORM_ADMIN, 'create_clinic', `clinic=${clinicName}`, context.request, {
                adminUsername,
                adminName: adminUser.name,
                source: 'platform-admin'
            });

            return json({
                success: true,
                clinic,
                admin: sanitizeUser(adminUser, clinicId, clinicName),
                message: '诊所创建成功'
            }, 201, context.request);
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
            const oldClinic = clinics[clinicIdx];
            const changes = [];

            // 更新诊所状态或名称
            if (status !== undefined && status !== oldClinic.status) {
                // ★ 优化：支持 active/test/disabled 三种状态
                if (!['active', 'test', 'disabled'].includes(status)) {
                    return json({ success: false, error: '状态值无效（active / test / disabled）' }, 400);
                }
                changes.push(`status: ${oldClinic.status} → ${status}`);
                clinics[clinicIdx].status = status;
            }
            if (name !== undefined && name !== oldClinic.name) {
                if (!name.trim() || name.trim().length < 2 || name.trim().length > 50) {
                    return json({ success: false, error: '诊所名称长度需在 2-50 个字符之间' }, 400);
                }
                // 检查新名称是否与其他诊所重复
                if (clinics.some((c, i) => i !== clinicIdx && c.name === name.trim())) {
                    return json({ success: false, error: '该诊所名称已存在' }, 409);
                }
                changes.push(`name: ${oldClinic.name} → ${name}`);
                clinics[clinicIdx].name = name.trim();
            }
            clinics[clinicIdx].updatedAt = now;
            await kv.put(KV_SYSTEM_CLINICS, JSON.stringify(clinics));

            // 更新管理员信息（如果有提供）
            if (adminUsername || adminName || adminPassword) {
                const users = (await kv.get(`clinic:${clinicId}:users`, 'json')) || [];
                const adminIdx = users.findIndex(u => u.role === ROLE_CLINIC_ADMIN);
                if (adminIdx !== -1) {
                    // 拒绝修改管理员用户名
                    if (adminUsername && adminUsername !== users[adminIdx].username) {
                        return json({ success: false, error: '管理员登录账号不可修改（确保全局唯一和数据安全），仅可修改姓名和密码' }, 403);
                    }
                    if (adminName && adminName !== users[adminIdx].name) {
                        changes.push(`adminName: ${users[adminIdx].name} → ${adminName}`);
                        users[adminIdx].name = adminName.trim();
                    }
                    if (adminPassword) {
                        if (adminPassword.length < 8) {
                            return json({ success: false, error: '密码至少8位' }, 400);
                        }
                        if (adminPassword.length > 128) {
                            return json({ success: false, error: '密码过长（最多128位）' }, 400);
                        }
                        if (!/[a-zA-Z]/.test(adminPassword) || !/[0-9]/.test(adminPassword)) {
                            return json({ success: false, error: '密码必须同时包含字母和数字' }, 400);
                        }
                        changes.push('password: updated');
                        const { passwordHash, salt } = await hashPassword(adminPassword);
                        users[adminIdx].passwordHash = passwordHash;
                        users[adminIdx].salt = salt;
                    }
                    users[adminIdx].updatedAt = now;
                    await kv.put(`clinic:${clinicId}:users`, JSON.stringify(users));
                }
            }

            // 审计日志
            if (changes.length > 0) {
                await writeAuditLog(kv, clinicId, currentUser.username, ROLE_PLATFORM_ADMIN, 'update_clinic', `clinic=${oldClinic.name}`, context.request, {
                    changes: changes.join('; '),
                    source: 'platform-admin'
                });
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
                        // ★安全规则：禁止修改 clinic_admin 用户的 username（确保全局唯一和数据安全）
                        const existingClinicAdmin = existingUsers.find(u => u.role === ROLE_CLINIC_ADMIN);
                        if (existingClinicAdmin) {
                            const newClinicAdminEntries = clinicUsers.filter(u => u.role === ROLE_CLINIC_ADMIN);
                            for (const newAdmin of newClinicAdminEntries) {
                                if (newAdmin.username !== existingClinicAdmin.username) {
                                    return json({ success: false, error: `管理员登录账号不可修改（诊所：${clinic.name}，账号：${existingClinicAdmin.username}），仅可修改姓名和密码` }, 403);
                                }
                            }
                        }
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

                // ★安全规则：禁止修改本诊所 clinic_admin 用户的 username（确保全局唯一和数据安全）
                const existingAdmin = existingUsers.find(u => u.role === ROLE_CLINIC_ADMIN);
                if (existingAdmin) {
                    const newAdminEntries = body.users.filter(u => u.role === ROLE_CLINIC_ADMIN);
                    for (const newAdmin of newAdminEntries) {
                        if (newAdmin.username !== existingAdmin.username) {
                            return json({ success: false, error: '管理员登录账号不可修改（确保全局唯一和数据安全），仅可修改姓名和密码' }, 403);
                        }
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

        // ===== 自助注册诊所用 POST /users?action=register-clinic =====
        // 新诊所自助注册：创建诊所 + 下发诊所管理员账号
        // 安全措施：IP限流(3次/小时) + 用户名全局唯一校验 + 密码强度校验
        if (method === 'POST' && url.searchParams.get('action') === 'register-clinic') {
            const body = await context.request.json().catch(() => ({}));
            const { clinicName, adminUsername, adminPassword, adminName, contactPhone, wechat, clinicStatus } = body;

            // 1. IP限流（注册更严格：3次/小时）
            const registerAllowed = await checkIpRateLimit(kv, context.request);
            if (!registerAllowed) {
                return json({ success: false, error: '注册请求过于频繁，请稍后再试' }, 429, context.request);
            }
            const registerKey = 'register_ip:' + (context.request.headers.get('CF-Connecting-IP') || 'unknown');
            const registerCount = parseInt(await kv.get(registerKey) || '0', 10) + 1;
            const REGISTER_MAX = 3;
            const REGISTER_TTL = 60 * 60; // 1小时
            if (registerCount === 1) {
                await kv.put(registerKey, '1', { expirationTtl: REGISTER_TTL });
            } else {
                await kv.put(registerKey, String(registerCount), { expirationTtl: REGISTER_TTL });
            }
            if (registerCount > REGISTER_MAX) {
                await writeAuditLog(kv, null, 'anonymous', 'unknown', 'register_rate_limited', registerKey, context.request);
                return json({ success: false, error: '本IP注册次数已达上限（3次/小时），请稍后再试或联系客服' }, 429, context.request);
            }

            // 2. 参数校验
            if (!clinicName || !adminUsername || !adminPassword) {
                return json({ success: false, error: '请填写诊所名称、管理员账号和密码' }, 400, context.request);
            }
            if (!clinicName.trim()) {
                return json({ success: false, error: '诊所名称不能为空' }, 400, context.request);
            }
            if (clinicName.trim().length < 2 || clinicName.trim().length > 50) {
                return json({ success: false, error: '诊所名称长度需在 2-50 个字符之间' }, 400, context.request);
            }
            if (/[\u4e00-\u9fa5]/.test(adminUsername)) {
                return json({ success: false, error: '管理员登录账号不能使用中文' }, 400, context.request);
            }
            if (!/^admin_[a-z][a-z0-9]{1,11}$/.test(adminUsername)) {
                return json({ success: false, error: '管理员账号必须为 admin_诊所简码 格式（如 admin_hkt），仅小写字母和数字，2-12位简码' }, 400, context.request);
            }
            // 密码强度校验（至少8位，含字母和数字）
            if (adminPassword.length < 8) {
                return json({ success: false, error: '密码至少8位' }, 400, context.request);
            }
            if (adminPassword.length > 128) {
                return json({ success: false, error: '密码过长（最多128位）' }, 400, context.request);
            }
            if (!/[a-zA-Z]/.test(adminPassword) || !/[0-9]/.test(adminPassword)) {
                return json({ success: false, error: '密码必须同时包含字母和数字' }, 400, context.request);
            }

            // 3. 用户名全局唯一校验（跨诊所 + platform_admins）
            const existing = await findUserForLogin(kv, adminUsername);
            if (existing) {
                return json({ success: false, error: '登录账号已存在，请更换（admin_诊所简码 全局唯一）' }, 409, context.request);
            }

            // 4. 诊所名称重名检查
            const clinics = await kv.get(KV_SYSTEM_CLINICS, 'json');
            const clinicList = clinics || [];
            if (clinicList.some(c => c.name === clinicName.trim())) {
                return json({ success: false, error: '该诊所名称已被注册，请使用其他名称或联系客服' }, 409, context.request);
            }

            // 5. 创建诊所和管理员用户
            const clinicId = generateId('clinic');
            const now = getNowISO();
            const { passwordHash, salt } = await hashPassword(adminPassword);

            // ★ 优化：支持创建时指定诊所状态（active/test/disabled），默认 active
            const validStatuses = ['active', 'test', 'disabled'];
            const finalStatus = validStatuses.includes(clinicStatus) ? clinicStatus : 'active';

            const clinic = {
                id: clinicId,
                name: clinicName.trim(),
                status: finalStatus,
                createdAt: now,
                updatedAt: now
            };

            const adminUser = {
                username: adminUsername,
                name: (adminName || adminUsername).trim(),
                role: ROLE_CLINIC_ADMIN,
                passwordHash,
                salt,
                allowedMode: 'both',
                cloudEnabled: true,
                allowSavePrescription: true,
                phone: contactPhone || '',
                createdAt: now,
                updatedAt: now
            };

            // 6. 保存到KV
            clinicList.push(clinic);
            await kv.put(KV_SYSTEM_CLINICS, JSON.stringify(clinicList));
            await kv.put(`clinic:${clinicId}:users`, JSON.stringify([adminUser]));

            // 7. 审计日志
            await writeAuditLog(kv, clinicId, adminUsername, ROLE_CLINIC_ADMIN, 'register_clinic', `clinic=${clinicName}`, context.request, {
                contactPhone: contactPhone || null,
                wechat: wechat || null,
                source: 'self-register'
            });

            return json({
                success: true,
                message: '诊所注册成功！请使用管理员账号登录',
                clinic: { id: clinicId, name: clinic.name, status: 'active' },
                admin: sanitizeUser(adminUser, clinicId, clinic.name),
                nextStep: '请使用 admin_' + adminUsername.replace('admin_', '') + ' 账号登录系统'
            }, 201, context.request);
        }

        // ===== 注册预检：检查用户名是否可用 GET /users?check-register=username =====
        if (method === 'GET' && url.searchParams.get('check-register')) {
            const username = url.searchParams.get('check-register');
            if (!username) {
                return json({ success: false, error: '请提供要检查的用户名' }, 400);
            }
            // 格式校验
            if (/[\u4e00-\u9fa5]/.test(username)) {
                return json({ available: false, reason: '用户名不能使用中文' });
            }
            if (!/^admin_[a-z][a-z0-9]{1,11}$/.test(username)) {
                return json({ available: false, reason: '管理员账号必须为 admin_诊所简码 格式（如 admin_hkt）' });
            }
            // 可用性检查
            const found = await findUserForLogin(kv, username);
            if (found) {
                return json({ available: false, reason: '该账号已被占用，请更换', username });
            }
            return json({ available: true, username });
        }

        // ===== 注册规范查询 GET /users?registration-info=true =====
        if (method === 'GET' && url.searchParams.get('registration-info') === 'true') {
            return json({
                success: true,
                rules: {
                    clinicName: { min: 2, max: 50, pattern: '中文/英文/数字' },
                    adminUsername: { pattern: 'admin_诊所简码', example: 'admin_hkt', minLength: 7, maxLength: 15 },
                    adminPassword: { minLength: 8, requirements: ['包含字母', '包含数字'] },
                    rateLimit: '3次/小时/IP'
                },
                endpoints: {
                    register: 'POST /api/users?action=register-clinic',
                    checkAvailable: 'GET /api/users?check-register={username}',
                    validateActivation: 'POST /api/license/validate'
                },
                support: {
                    wechat: 'hktzy1688',
                    note: '注册后立即获得云端管理员账号，可登录系统使用'
                }
            });
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
