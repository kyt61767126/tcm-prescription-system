// ============================================================================
// 用户与诊所账号管理 API（多诊所分区版）
// ============================================================================
// 端点契约：
//   GET    /api/users                      获取当前用户可见的用户列表
//   POST   /api/users                      保存用户列表（clinic_admin 管本诊所，doctor 仅改自己密码）
//   POST   /api/users?login=true           登录校验，返回用户信息（含 clinicId）
//   GET    /api/users?clinics=true         列出所有诊所（platform_admin 专用）
//   POST   /api/users?clinic=create        创建新诊所（platform_admin 专用）
//   POST   /api/users?clinic=update        更新诊所状态（platform_admin 专用）
// ============================================================================
import {
    ROLE, KV_NS, clinicKey, parseAuthHeader,
    hashPassword, generateSalt, verifyPassword,
    corsResponse, handleOptions, getKV
} from '../_lib/auth.js';

// ---------- 内部工具：从 KV 加载诊所列表 ----------
async function loadClinics(kv) {
    const list = await kv.get(KV_NS.CLINICS, 'json');
    return Array.isArray(list) ? list : [];
}

async function saveClinics(kv, list) {
    await kv.put(KV_NS.CLINICS, JSON.stringify(list));
}

// ---------- 内部工具：从 KV 加载诊所用户列表 ----------
async function loadClinicUsers(kv, clinicId) {
    const list = await kv.get(clinicKey(clinicId, 'users'), 'json');
    return Array.isArray(list) ? list : [];
}

async function saveClinicUsers(kv, clinicId, users) {
    await kv.put(clinicKey(clinicId, 'users'), JSON.stringify(users));
}

// ---------- 内部工具：加载平台管理员 ----------
async function loadPlatformAdmins(kv) {
    const list = await kv.get(KV_NS.PLATFORM_ADMINS, 'json');
    return Array.isArray(list) ? list : [];
}

// ---------- 内部工具：脱敏用户对象（去除密码与 salt） ----------
function sanitizeUser(u) {
    if (!u) return null;
    const { passwordHash, salt, ...rest } = u;
    return rest;
}

// ---------- 内部工具：在所有诊所中查找用户（登录用） ----------
async function findUserAcrossClinics(kv, username) {
    // 1) 先查平台管理员
    const admins = await loadPlatformAdmins(kv);
    const pa = admins.find(u => u.username === username);
    if (pa) {
        return {
            ...pa,
            role: ROLE.PLATFORM_ADMIN,
            clinicId: null,
            _source: 'platform_admins'
        };
    }
    // 2) 遍历所有诊所
    const clinics = await loadClinics(kv);
    for (const c of clinics) {
        if (c.status === 'disabled') continue;
        const users = await loadClinicUsers(kv, c.id);
        const u = users.find(x => x.username === username);
        if (u) {
            return {
                ...u,
                clinicId: c.id,
                clinicName: c.name,
                _source: 'clinic:' + c.id
            };
        }
    }
    return null;
}

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
                error: 'KV binding not found. 请在 Cloudflare Pages 设置中配置 KV binding。',
                requireSetup: true
            }, { status: 500 });
        }

        // ============ 登录端点：POST /api/users?login=true ============
        if (method === 'POST' && url.searchParams.get('login') === 'true') {
            const body = await request.json();
            if (!body.username || !body.password) {
                return corsResponse({ success: false, error: '用户名或密码不能为空' }, { status: 400 });
            }
            const user = await findUserAcrossClinics(kv, body.username);
            if (!user) {
                return corsResponse({ success: false, error: '用户名或密码错误' }, { status: 401 });
            }
            // 平台管理员可能未启用密码哈希（首次初始化时直接明文），双轨支持
            let passwordOk = false;
            if (user.passwordHash && user.salt) {
                passwordOk = await verifyPassword(body.password, user.salt, user.passwordHash);
            } else if (user.password) {
                // 兼容首次初始化或旧式明文（仅设计阶段，正式部署后应全部哈希）
                passwordOk = (user.password === body.password);
            }
            if (!passwordOk) {
                return corsResponse({ success: false, error: '用户名或密码错误' }, { status: 401 });
            }
            // 诊所停用检查
            if (user.role !== ROLE.PLATFORM_ADMIN) {
                const clinics = await loadClinics(kv);
                const c = clinics.find(x => x.id === user.clinicId);
                if (!c || c.status === 'disabled') {
                    return corsResponse({ success: false, error: '所属诊所已停用，请联系平台管理员' }, { status: 403 });
                }
                // 医师云端开关检查（登录本身不阻断，但前端需读 cloudEnabled）
            }
            return corsResponse({
                success: true,
                user: sanitizeUser(user)
            });
        }

        // ============ 诊所列表端点：GET /api/users?clinics=true ============
        if (method === 'GET' && url.searchParams.get('clinics') === 'true') {
            const currentUser = parseAuthHeader(request);
            if (!currentUser || !currentUser.isPlatformAdmin) {
                return corsResponse({ success: false, error: '仅平台总管理员可查看诊所列表' }, { status: 403 });
            }
            const clinics = await loadClinics(kv);
            // 附带每个诊所的医师数 + 管理员信息
            const enriched = [];
            for (const c of clinics) {
                const users = await loadClinicUsers(kv, c.id);
                const admin = users.find(u => u.role === ROLE.CLINIC_ADMIN);
                enriched.push({
                    ...c,
                    adminUsername: admin ? admin.username : null,
                    adminName: admin ? admin.name : null,
                    userCount: users.length,
                    adminCount: users.filter(u => u.role === ROLE.CLINIC_ADMIN).length,
                    doctorCount: users.filter(u => u.role === ROLE.DOCTOR).length
                });
            }
            return corsResponse({ success: true, data: enriched });
        }

        // ============ 创建/更新诊所：POST /api/users?clinic=create|update ============
        if (method === 'POST' && url.searchParams.get('clinic')) {
            const currentUser = parseAuthHeader(request);
            if (!currentUser || !currentUser.isPlatformAdmin) {
                return corsResponse({ success: false, error: '仅平台总管理员可管理诊所' }, { status: 403 });
            }
            const body = await request.json();
            const action = url.searchParams.get('clinic');

            if (action === 'create') {
                // 创建新诊所，同时下发首个诊所管理员账号
                if (!body.clinicName || !body.adminUsername || !body.adminPassword) {
                    return corsResponse({ success: false, error: '缺少诊所名称/管理员账号/管理员密码' }, { status: 400 });
                }
                const clinics = await loadClinics(kv);
                const clinicId = 'clinic_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
                // 检查用户名全局唯一
                const exists = await findUserAcrossClinics(kv, body.adminUsername);
                if (exists) {
                    return corsResponse({ success: false, error: '管理员用户名已被占用' }, { status: 400 });
                }
                clinics.push({
                    id: clinicId,
                    name: body.clinicName,
                    status: 'active',
                    createdAt: new Date().toISOString()
                });
                await saveClinics(kv, clinics);
                // 创建诊所管理员账号
                const salt = generateSalt();
                const passwordHash = await hashPassword(body.adminPassword, salt);
                const admin = {
                    username: body.adminUsername,
                    name: body.adminName || body.adminUsername,
                    role: ROLE.CLINIC_ADMIN,
                    passwordHash,
                    salt,
                    allowedMode: 'both',
                    cloudEnabled: true,
                    allowSavePrescription: true,
                    createdAt: new Date().toISOString()
                };
                await saveClinicUsers(kv, clinicId, [admin]);
                return corsResponse({
                    success: true,
                    message: '诊所创建成功',
                    clinic: { id: clinicId, name: body.clinicName },
                    admin: sanitizeUser(admin)
                });
            }

            if (action === 'update') {
                if (!body.clinicId) {
                    return corsResponse({ success: false, error: '缺少 clinicId' }, { status: 400 });
                }
                const clinics = await loadClinics(kv);
                const idx = clinics.findIndex(c => c.id === body.clinicId);
                if (idx === -1) {
                    return corsResponse({ success: false, error: '诊所不存在' }, { status: 404 });
                }
                // 权限细分：
                //   platform_admin 可改 name + status（停用/启用诊所）
                //   clinic_admin   仅可改自己诊所的 name（不能改 status）
                //   doctor         拒绝
                if (currentUser.isClinicAdmin) {
                    if (currentUser.clinicId !== body.clinicId) {
                        return corsResponse({ success: false, error: '仅可修改本诊所名称' }, { status: 403 });
                    }
                    if (body.status && body.status !== clinics[idx].status) {
                        return corsResponse({ success: false, error: '诊所状态仅平台总管理员可修改' }, { status: 403 });
                    }
                } else if (!currentUser.isPlatformAdmin) {
                    return corsResponse({ success: false, error: '无权修改诊所' }, { status: 403 });
                }
                if (body.name) clinics[idx].name = body.name;
                if (body.status) clinics[idx].status = body.status; // active | disabled
                clinics[idx].updatedAt = new Date().toISOString();
                await saveClinics(kv, clinics);

                // 平台总管理员可同时修改诊所管理员账号/姓名/密码
                if (currentUser.isPlatformAdmin && (body.adminUsername || body.adminPassword || body.adminName)) {
                    const users = await loadClinicUsers(kv, body.clinicId);
                    const adminIdx = users.findIndex(u => u.role === ROLE.CLINIC_ADMIN);
                    if (adminIdx >= 0) {
                        // 改用户名：先检查全局唯一（排除自己）
                        if (body.adminUsername && body.adminUsername !== users[adminIdx].username) {
                            const exists = await findUserAcrossClinics(kv, body.adminUsername);
                            if (exists) {
                                return corsResponse({ success: false, error: '管理员用户名已被占用' }, { status: 400 });
                            }
                            users[adminIdx].username = body.adminUsername;
                        }
                        if (body.adminName) {
                            users[adminIdx].name = body.adminName;
                        }
                        if (body.adminPassword) {
                            const salt = generateSalt();
                            users[adminIdx].passwordHash = await hashPassword(body.adminPassword, salt);
                            users[adminIdx].salt = salt;
                        }
                        users[adminIdx].updatedAt = new Date().toISOString();
                        await saveClinicUsers(kv, body.clinicId, users);
                    }
                }
                return corsResponse({ success: true, message: '诊所更新成功', clinic: clinics[idx] });
            }
        }

        // ============ GET /api/users — 用户列表 ============
        if (method === 'GET') {
            const currentUser = parseAuthHeader(request);
            if (!currentUser) {
                return corsResponse({ success: false, error: '未授权访问' }, { status: 401 });
            }

            // 平台总管理员：返回所有诊所所有用户
            if (currentUser.isPlatformAdmin) {
                const clinics = await loadClinics(kv);
                const allUsers = [];
                for (const c of clinics) {
                    const users = await loadClinicUsers(kv, c.id);
                    users.forEach(u => allUsers.push({
                        ...sanitizeUser(u),
                        clinicId: c.id,
                        clinicName: c.name
                    }));
                }
                return corsResponse({ success: true, data: allUsers, count: allUsers.length });
            }

            // 诊所管理员：返回本诊所全部用户
            if (currentUser.isClinicAdmin) {
                const users = await loadClinicUsers(kv, currentUser.clinicId);
                const clinics = await loadClinics(kv);
                const c = clinics.find(x => x.id === currentUser.clinicId);
                const enriched = users.map(u => ({
                    ...sanitizeUser(u),
                    clinicId: currentUser.clinicId,
                    clinicName: c ? c.name : ''
                }));
                return corsResponse({ success: true, data: enriched, count: enriched.length });
            }

            // 普通医师：仅返回自己
            const users = await loadClinicUsers(kv, currentUser.clinicId);
            const self = users.find(u => u.username === currentUser.username);
            return corsResponse({
                success: true,
                data: self ? [sanitizeUser({ ...self, clinicId: currentUser.clinicId })] : [],
                count: self ? 1 : 0
            });
        }

        // ============ POST /api/users — 保存用户列表 ============
        if (method === 'POST') {
            const currentUser = parseAuthHeader(request);
            if (!currentUser) {
                return corsResponse({ success: false, error: '未授权访问' }, { status: 401 });
            }
            const body = await request.json();
            if (!body.users || !Array.isArray(body.users)) {
                return corsResponse({ success: false, error: 'Missing or invalid users data' }, { status: 400 });
            }

            // ---------- 医师：仅可修改自己的密码 ----------
            if (currentUser.isDoctor) {
                const existing = await loadClinicUsers(kv, currentUser.clinicId);
                if (body.users.length !== existing.length) {
                    return corsResponse({ success: false, error: '仅可修改自己的密码，不可增删用户' }, { status: 403 });
                }
                // 校验：除自己外其他用户字段完全一致；自己仅 password 可变
                const keysEqualExcept = (a, b, except) => {
                    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
                    for (const k of keys) {
                        if (except.includes(k)) continue;
                        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
                    }
                    return true;
                };
                for (const bu of body.users) {
                    const ku = existing.find(u => u.username === bu.username);
                    if (!ku) return corsResponse({ success: false, error: '用户列表不可变更' }, { status: 403 });
                    if (bu.username !== currentUser.username) {
                        if (!keysEqualExcept(bu, ku, [])) {
                            return corsResponse({ success: false, error: '不可修改他人信息' }, { status: 403 });
                        }
                    } else {
                        // 仅允许改 password 字段
                        if (!keysEqualExcept(bu, ku, ['password'])) {
                            return corsResponse({ success: false, error: '仅可修改密码字段' }, { status: 403 });
                        }
                        // 若提供了新密码，更新哈希
                        if (bu.password && bu.password !== ku.password) {
                            const salt = generateSalt();
                            const passwordHash = await hashPassword(bu.password, salt);
                            ku.passwordHash = passwordHash;
                            ku.salt = salt;
                            ku.updatedAt = new Date().toISOString();
                        }
                    }
                }
                await saveClinicUsers(kv, currentUser.clinicId, existing);
                return corsResponse({ success: true, message: '密码修改成功' });
            }

            // ---------- 诊所管理员：可管理本诊所医师账号 ----------
            if (currentUser.isClinicAdmin) {
                const existing = await loadClinicUsers(kv, currentUser.clinicId);
                const existingMap = new Map(existing.map(u => [u.username, u]));

                // 校验：不能动其他诊所、不能改自己的 role/clinicId、不能创建 clinic_admin（仅 platform_admin 可建）
                const otherAdmins = existing.filter(u => u.role === ROLE.CLINIC_ADMIN && u.username !== currentUser.username);
                if (otherAdmins.length > 0) {
                    // 其他诊所管理员账号本诊所不该有，跳过
                }

                const newUsers = [];
                for (const bu of body.users) {
                    // 自己的记录：只允许改 name/password/allowedMode/cloudEnabled
                    if (bu.username === currentUser.username) {
                        const old = existingMap.get(bu.username);
                        if (!old) {
                            return corsResponse({ success: false, error: '当前账号不存在' }, { status: 400 });
                        }
                        const updated = {
                            ...old,
                            name: bu.name || old.name,
                            allowedMode: bu.allowedMode || old.allowedMode,
                            cloudEnabled: bu.cloudEnabled !== undefined ? bu.cloudEnabled : old.cloudEnabled,
                            allowSavePrescription: bu.allowSavePrescription !== undefined ? bu.allowSavePrescription : old.allowSavePrescription,
                            updatedAt: new Date().toISOString()
                        };
                        // 若改了密码
                        if (bu.password && bu.password !== old.password) {
                            const salt = generateSalt();
                            updated.passwordHash = await hashPassword(bu.password, salt);
                            updated.salt = salt;
                        }
                        newUsers.push(updated);
                        existingMap.delete(bu.username);
                        continue;
                    }

                    // 已存在的医师：更新非敏感字段
                    if (existingMap.has(bu.username)) {
                        const old = existingMap.get(bu.username);
                        // 不允许把 doctor 提升为 clinic_admin
                        if (bu.role === ROLE.CLINIC_ADMIN && old.role !== ROLE.CLINIC_ADMIN) {
                            return corsResponse({ success: false, error: '不可将医师提升为诊所管理员，请联系平台总管理员' }, { status: 403 });
                        }
                        const updated = {
                            ...old,
                            name: bu.name || old.name,
                            role: old.role, // 不允许通过此接口改角色
                            allowedMode: bu.allowedMode !== undefined ? bu.allowedMode : old.allowedMode,
                            cloudEnabled: bu.cloudEnabled !== undefined ? bu.cloudEnabled : old.cloudEnabled,
                            allowSavePrescription: bu.allowSavePrescription !== undefined ? bu.allowSavePrescription : old.allowSavePrescription,
                            updatedAt: new Date().toISOString()
                        };
                        if (bu.password && bu.password !== old.password) {
                            const salt = generateSalt();
                            updated.passwordHash = await hashPassword(bu.password, salt);
                            updated.salt = salt;
                        }
                        newUsers.push(updated);
                        existingMap.delete(bu.username);
                        continue;
                    }

                    // 新建医师：仅允许 doctor 角色
                    if (!bu.username || !bu.password) {
                        return corsResponse({ success: false, error: '新建用户必须提供 username 和 password' }, { status: 400 });
                    }
                    // 全局唯一性校验
                    const exists = await findUserAcrossClinics(kv, bu.username);
                    if (exists) {
                        return corsResponse({ success: false, error: `用户名 ${bu.username} 已被占用` }, { status: 400 });
                    }
                    if (bu.role && bu.role !== ROLE.DOCTOR) {
                        return corsResponse({ success: false, error: '诊所管理员仅可创建医师账号' }, { status: 403 });
                    }
                    const salt = generateSalt();
                    const passwordHash = await hashPassword(bu.password, salt);
                    newUsers.push({
                        username: bu.username,
                        name: bu.name || bu.username,
                        role: ROLE.DOCTOR,
                        passwordHash,
                        salt,
                        allowedMode: bu.allowedMode || 'local',
                        cloudEnabled: bu.cloudEnabled !== undefined ? bu.cloudEnabled : false,
                        allowSavePrescription: bu.allowSavePrescription !== undefined ? bu.allowSavePrescription : true,
                        createdAt: new Date().toISOString()
                    });
                }

                // existingMap 剩余的是被删除的用户
                // 诊所管理员不可删除其他诊所管理员，仅可删除本诊所 doctor
                const deleted = Array.from(existingMap.values()).filter(u => u.username !== currentUser.username);
                for (const d of deleted) {
                    if (d.role === ROLE.CLINIC_ADMIN) {
                        return corsResponse({ success: false, error: '不可删除诊所管理员账号' }, { status: 403 });
                    }
                }

                await saveClinicUsers(kv, currentUser.clinicId, newUsers);
                return corsResponse({
                    success: true,
                    message: '用户列表保存成功',
                    count: newUsers.length,
                    data: newUsers.map(sanitizeUser)
                });
            }

            // 平台管理员通过此接口保存用户列表的场景较少，建议走 ?clinic=create 单独建诊所
            return corsResponse({ success: false, error: '平台管理员请使用 ?clinic=create 创建诊所' }, { status: 400 });
        }

        return corsResponse({ success: false, error: 'Method not allowed' }, { status: 405 });
    } catch (error) {
        console.error('Users API error:', error);
        return corsResponse({
            success: false,
            error: error.message || 'Internal server error',
            stack: error.stack ? error.stack.split('\n').slice(0, 5).join('\n') : null
        }, { status: 500 });
    }
}
