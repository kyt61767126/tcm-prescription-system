import { getKV, listAllKeys } from './_lib/kv.js';
import {
    parseAuthHeader, hashPassword, verifyPassword, signToken,
    isPlatformAdmin, isClinicAdmin, isAdmin, isLegacyPasswordHash,
    revokeAllUserTokens, writeUserSession, clearUserSession, getUserSession,
    ROLE_PLATFORM_ADMIN, ROLE_CLINIC_ADMIN, ROLE_DOCTOR, ROLE_CASHIER,
    KV_SYSTEM_CLINICS, KV_SYSTEM_PLATFORM_ADMINS,
    findPhoneOccupancy
} from './_lib/auth.js';
import { provisionCloudAccount } from './license/_lib/admin-account.js';

// ============================================================================
// ★★★ 2026-08-21 账号级设备授权（一个云端管理员最多绑定 2 台设备：桌面/APP）
//   KV key: user_devices:{username} -> { maxDevices, devices: [{machineId, clientClass, boundAt, lastSeenAt}] }
//   规则：
//     - 仅 clientClass = desktop / app 的真实设备指纹计入绑定（网页版数据全在云端，
//       不占设备名额，可随时从任意浏览器登录管理）
//     - 未绑定新设备且已满 2 台 → 拒绝登录（DEVICE_LIMIT），提示解绑后重试
//     - 解绑：本人在任意已登录设备调用 action=unbind-device 自助解绑
// ============================================================================
const KV_USER_DEVICES_PREFIX = 'user_devices:';
const MAX_DEVICES_PER_ACCOUNT = 2;
// 豁免账户的设备配额（99 = 实际不限，避免前端对 -1 显示异常）
const DEVICE_EXEMPT_MAX = 99;
// ★ 2026-08-22 特殊账户设备豁免名单：名单内账号不受"每账号 2 台设备"限制（可无限绑定）。
//   适用：wgj（惠康堂中医诊所早期测试/管理账户，多设备使用）。普通用户仍需遵守 2 台上限。
const DEVICE_LIMIT_EXEMPT_ACCOUNTS = ['wgj'];

function sanitizeDevices(record) {
    const max = record && record.maxDevices ? record.maxDevices : MAX_DEVICES_PER_ACCOUNT;
    const devices = (record && Array.isArray(record.devices)) ? record.devices : [];
    return {
        maxDevices: max,
        devicesCount: devices.length,
        devices: devices.map(d => ({
            machineId: d.machineId ? String(d.machineId).substring(0, 8) + '...' : null, // 脱敏：仅前 8 位
            clientClass: d.clientClass || null,
            boundAt: d.boundAt || null,
            lastSeenAt: d.lastSeenAt || null
        }))
    };
}

// 绑定/更新设备（返回 { ok, record } 或 { ok:false, code:'DEVICE_LIMIT', record }）
async function bindUserDevice(kv, username, machineId, clientClass, nowIso) {
    // ★ 2026-08-22 特殊账户豁免：名单内账号不限制设备数量
    // ★★ 2026-08-22 配额来源：优先保留 KV 中已有 maxDevices（平台管理员后台可调整）；
    //    仅当记录无配额字段时，按豁免名单给默认值（豁免=99 实际不限，普通=2）
    const exempt = DEVICE_LIMIT_EXEMPT_ACCOUNTS.includes(username);
    const record = (await kv.get(KV_USER_DEVICES_PREFIX + username, 'json')) || {
        devices: []
    };
    if (!Array.isArray(record.devices)) record.devices = [];
    if (typeof record.maxDevices !== 'number' || !Number.isInteger(record.maxDevices) || record.maxDevices <= 0) {
        record.maxDevices = exempt ? DEVICE_EXEMPT_MAX : MAX_DEVICES_PER_ACCOUNT;
    }

    const mid = String(machineId || '').trim();
    if (!mid || mid.length < 8 || mid === 'unknown') {
        // 无有效设备指纹（旧客户端/网页未升级）：放行不绑定，仅做在线互斥
        return { ok: true, record };
    }

    const existing = record.devices.find(d => d.machineId === mid);
    if (existing) {
        existing.lastSeenAt = nowIso;
        if (clientClass) existing.clientClass = clientClass;
    } else {
        if (!exempt && record.devices.length >= record.maxDevices) {
            return { ok: false, code: 'DEVICE_LIMIT', record };
        }
        record.devices.push({
            machineId: mid,
            clientClass: clientClass || 'desktop',
            boundAt: nowIso,
            lastSeenAt: nowIso
        });
    }
    await kv.put(KV_USER_DEVICES_PREFIX + username, JSON.stringify(record));
    return { ok: true, record };
}
// （end 设备授权）

// ★ 2026-08-20 登录自愈：手机号存在"管理员已审核通过"的激活申请但云端账号尚未开通时，
//   自动补开账号（用户名=手机号、默认密码 admin）。仅在用户不存在且申请已通过时触发，
//   幂等（provisionCloudAccount 已存在则跳过），不会覆盖已有账号密码，不构成枚举向量。
async function maybeProvisionFromActivation(kv, username) {
    try {
        if (!/^1[3-9]\d{9}$/.test(username)) return false; // 仅手机号账号自愈
        // 冷却：15 分钟内不重复探测（避免对未知手机号反复扫描 KV）
        const cooled = await kv.get('admin_selfheal_cool:' + username, 'json');
        const now = Date.now();
        if (cooled && cooled.t > now) return false;

        let requestId = null;
        let st = '';
        // 1) 优先用手机号索引（新激活申请走此路径，O(1)）
        const idx = await kv.get('admin_phone:' + username, 'json');
        if (idx && idx.requestId) {
            requestId = idx.requestId;
            st = idx.status || '';
        } else {
            // 2) 兜底：扫描请求索引（最新优先，找到即停），兼容索引上线前的历史激活申请
            const list = (await kv.get('admin_req_index', 'json')) || [];
            for (const rid of list.slice(0, SCAN_LIMIT)) {
                const rec = await kv.get('admin_req:' + rid, 'json');
                if (rec && rec.phone === username) { requestId = rid; st = rec.status || ''; break; }
            }
        }
        // 无论是否命中都写冷却标记，避免下一次失败登录再次全量扫描
        await kv.put('admin_selfheal_cool:' + username, JSON.stringify({ t: now + 15 * 60 * 1000 })).catch(() => {});
        if (!requestId) return false;
        if (st !== 'activated' && st !== 'approved') return false; // 仅已通过
        const record = await kv.get('admin_req:' + requestId, 'json');
        if (!record) return false;
        await provisionCloudAccount(kv, record);
        return true;
    } catch (e) {
        console.warn('[Login] 激活自愈补开账号失败:', e.message);
        return false;
    }
}
const SCAN_LIMIT = 300;

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

// P1-1 安全增强：登录失败渐进式锁定（阶梯递增，防爆破且不误伤正式用户）
//   前 4 次失败不锁定（友好），第 5 次起按失败次数指数递增锁定时长，
//   暴力破解代价高、正常手误可自然恢复。
const LOGIN_MAX_FAILURES = 5;    // 达到该次数起进入锁定
const LOGIN_LOCK_STEP = 5 * 60;         // 基础阶梯 5 分钟（秒）
const LOGIN_LOCK_STEP_COUNT = 5;        // 每累计多少失败递增一档
const LOGIN_LOCK_MAX = 60 * 60;         // 单次锁定最长 60 分钟

// 渐进式锁定：根据失败次数计算应锁定的时长（秒）
//   [0,4]   不锁定
//   [5,9]   5 分钟
//   [10,14] 10 分钟
//   ...     封顶 1 小时
function lockTtlForFailures(count) {
    if (count < LOGIN_MAX_FAILURES) return 0;
    const step = Math.floor((count - LOGIN_MAX_FAILURES) / LOGIN_LOCK_STEP_COUNT) + 1;
    return Math.min(LOGIN_LOCK_STEP * step, LOGIN_LOCK_MAX);
}

async function recordLoginFailure(kv, username) {
    const key = 'login_fail:' + username;
    const count = parseInt(await kv.get(key) || '0', 10) + 1;
    const ttl = lockTtlForFailures(count) > 0 ? lockTtlForFailures(count) : 24 * 3600;
    await kv.put(key, String(count), { expirationTtl: ttl });
    return count;
}

async function checkLoginLocked(kv, username) {
    const key = 'login_fail:' + username;
    const count = parseInt(await kv.get(key) || '0', 10);
    return lockTtlForFailures(count) > 0;
}

async function clearLoginFailures(kv, username) {
    const key = 'login_fail:' + username;
    await kv.delete(key);
}

// ★ P1-6 防登录枚举：哑验证参数（格式与真实 PBKDF2 哈希一致，SHA-256 输出 64 个十六进制字符）
//   用户不存在/数据不完整时用它执行一次等代价的 PBKDF2 验证，对齐响应时间，防时序攻击
const DUMMY_PASSWORD_HASH = 'pbkdf2$100000$' + '0'.repeat(64);
const DUMMY_SALT = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

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

// ★ 2026-08-22 后端 edition 归一化（与前端 permission.js _normalizeEdition 同规则，
//   确保前后端判定一致；早期遗留用户（无 edition 字段）兜底为 cloud_clinic 机构版）
function normalizeClinicEdition(rawEdition, clinicStatus) {
    var s = String(rawEdition || '').trim();
    // 无 edition 字段 = 早期平台注册用户，全部视为机构版（历史事实：早期不分版本都是机构版）
    if (!s) {
        // test 状态的自助注册诊所不给默认机构版，留空由转正流程设置
        if (clinicStatus === 'test') return '';
        return 'cloud_clinic';
    }
    var x = s.toLowerCase();
    if (x === 'institution' || x === 'institutional' || x === 'jigou') return 'cloud_clinic';
    if (x === 'standard') return 'cloud_personal';
    if (x === 'yj') return 'cloud_clinic';
    if (x === 'yb') return 'cloud_personal';
    if (x === 'lj') return 'offline_clinic';
    if (x === 'lb') return 'offline_personal';
    if (x.indexOf('云端机构') >= 0) return 'cloud_clinic';
    if (x.indexOf('云端标准') >= 0) return 'cloud_personal';
    if (x.indexOf('离线机构') >= 0) return 'offline_clinic';
    if (x.indexOf('离线标准') >= 0) return 'offline_personal';
    if (x.indexOf('机构版') >= 0) return 'cloud_clinic';
    if (x.indexOf('标准版') >= 0) return 'cloud_personal';
    if (x.indexOf('clinic') >= 0 && x.indexOf('personal') < 0) return 'cloud_clinic';
    if (x.indexOf('institution') >= 0) return 'cloud_clinic';
    if (x.indexOf('personal') >= 0) return 'cloud_personal';
    return s;
}

// 隐藏密码字段，返回安全的用户对象
// ★ 优化：添加 clinicStatus、userType、edition 字段，区分正式用户/测试用户/版本类型
function sanitizeUser(user, clinicId, clinicName, clinicStatus, clinicEdition) {
    const effectiveStatus = clinicStatus || 'active';
    const isTestUser = effectiveStatus === 'test';
    const effectiveEdition = normalizeClinicEdition(clinicEdition, effectiveStatus);
    return {
        username: user.username,
        name: user.name || user.username,
        role: user.role,
        phone: user.phone || '',
        disabled: user.disabled === true,
        clinicId: clinicId || user.clinicId || null,
        clinicName: clinicName || null,
        clinicStatus: effectiveStatus,
        clinicEdition: effectiveEdition,  // ★ 2026-08-22 统一：返回云端 clinic 的版本类型
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
// 返回值：{ user, clinicId, clinicName, clinicStatus, clinicEdition, clinicExpiresAt, error }
//   - 成功：返回 user 信息（诊所被禁用时 clinicStatus='disabled'，由登录分支在密码验证后再拒绝）
//   - 失败：返回 { user: null, error: { code: 'USER_NOT_FOUND', message } }
// ★ 2026-08-22：新增返回 clinicEdition，用于前端统一设置 CONFIG.edition
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
            // 平台总管理员视为最高权限=机构版（云端机构版）
            return { user: found, clinicId: null, clinicName: null, clinicStatus: 'active', clinicEdition: 'cloud_clinic', error: null };
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
                    clinicStatus: clinic.status || 'active',
                    clinicEdition: clinic.edition || null,  // ★ 2026-08-22 取 clinic.edition
                    clinicExpiresAt: clinic.expiresAt || null
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
            clinicEdition: foundInDisabledClinic.clinicEdition,
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
                // ★ 2026-08-23 修复：补传 clinic.status / clinic.edition，用户管理列表才能显示
                //   真实版本类型（云端机构版/云端标准版）与诊所待审核徽章（原漏传导致全部兜底 active/cloud_clinic）
                result.push(sanitizeUser(u, clinic.id, clinic.name, clinic.status, clinic.edition));
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

        // ===== 诊所管理员云端建号 POST /users?action=add-clinic-user =====
        // ★ 2026-08-25 新增（前台收费一期配套）：机构版诊所管理员在客户端"用户管理"添加
        //   医师/前台账号时同步建到云端 KV——此前新账号只落本机 localStorage，
        //   其他设备（尤其前台收费机）无法登录该账号。
        //   仅允许 doctor/cashier 两种角色（禁止借本接口创建管理员）；
        //   用户名全局唯一校验 + 审计日志。
        if (method === 'POST' && url.searchParams.get('action') === 'add-clinic-user') {
            const authUser = await parseAuthHeader(context.request, context.env);
            if (!authUser || !isClinicAdmin(authUser)) {
                return json({ success: false, error: '未授权：仅诊所管理员可添加账号' }, 401, context.request);
            }
            if (!authUser.clinicId) {
                return json({ success: false, error: '缺少诊所信息' }, 400, context.request);
            }

            const body = await context.request.json().catch(() => ({}));
            const username = String(body.username || '').trim();
            const password = String(body.password || '');
            const name = String(body.name || '').trim();
            const role = (body.role === ROLE_CASHIER) ? ROLE_CASHIER : ROLE_DOCTOR;

            if (!username || !password || !name) {
                return json({ success: false, error: '请填写登录账号、密码和姓名' }, 400, context.request);
            }
            if (/[\u4e00-\u9fa5]/.test(username)) {
                return json({ success: false, error: '登录账号不能使用中文' }, 400, context.request);
            }
            if (username.length < 2 || username.length > 30) {
                return json({ success: false, error: '登录账号长度需 2-30 字符' }, 400, context.request);
            }
            if (password.length < 6) {
                return json({ success: false, error: '密码至少 6 位' }, 400, context.request);
            }
            if (!/^[\u4e00-\u9fa5]{2,}$/.test(name)) {
                return json({ success: false, error: '姓名必须为中文（至少2个汉字）' }, 400, context.request);
            }

            // 全局唯一：跨诊所 username/phone + platform_admins 全查
            const existing = await findUserForLogin(kv, username);
            if (existing && existing.user) {
                return json({ success: false, error: '该登录账号已被占用' }, 409, context.request);
            }
            const phoneOccupancy = await findPhoneOccupancy(kv, username);
            if (phoneOccupancy && phoneOccupancy.user) {
                return json({ success: false, error: '该账号与已有手机号冲突' }, 409, context.request);
            }

            const { passwordHash, salt } = await hashPassword(password);
            const now = getNowISO();
            const clinicUsers = (await kv.get(`clinic:${authUser.clinicId}:users`, 'json')) || [];
            clinicUsers.push({
                username: username,
                name: name,
                role: role,
                passwordHash: passwordHash,
                salt: salt,
                allowedMode: 'both',
                cloudEnabled: true,
                allowSavePrescription: (role !== ROLE_CASHIER),
                userType: 'production',
                createdAt: now,
                updatedAt: now
            });
            await kv.put(`clinic:${authUser.clinicId}:users`, JSON.stringify(clinicUsers));

            await writeAuditLog(kv, authUser.clinicId, authUser.username, authUser.role,
                'add_clinic_user', username, context.request,
                { newRole: role, newName: name });

            return json({ success: true, username: username, role: role, message: '云端账号创建成功' });
        }

        // ===== 统一账号救援：解锁 / 重置密码 POST /users?action=reset-password =====
        // ★ 2026-08-20 合并：原 action=unlock 与 action=reset-password 两个接口合并为一个统一操作。
        //   body.password 留空 = 仅解锁（清除登录失败计数/锁定，无需等 TTL）；
        //   body.password 提供且合法 = 重置密码（重置后自动解锁）。
        //   按 username 精确定位（username 或 phone 匹配），平台管理员/诊所用户均适用。
        // 鉴权：仅 platform_admin；写审计日志（unlock_account / reset_password）。
        if (method === 'POST' && url.searchParams.get('action') === 'reset-password') {
            const authUser = await parseAuthHeader(context.request, context.env);
            if (!authUser || !isPlatformAdmin(authUser)) {
                return json({ success: false, error: '未授权：仅平台总管理员可执行此操作' }, 401, context.request);
            }

            const body = await context.request.json().catch(() => ({}));
            const targetUsername = (body.username || '').trim();
            const newPassword = (body.password || '');
            if (!targetUsername) {
                return json({ success: false, error: '请提供目标用户名' }, 400, context.request);
            }
            // 仅在提供了密码时校验格式（留空 = 仅解锁）
            if (newPassword) {
                if (newPassword.length < 8) {
                    return json({ success: false, error: '密码至少8位' }, 400, context.request);
                }
                if (newPassword.length > 128) {
                    return json({ success: false, error: '密码过长（最多128位）' }, 400, context.request);
                }
                if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
                    return json({ success: false, error: '密码必须同时包含字母和数字' }, 400, context.request);
                }
            }

            // 精确定位目标用户（平台管理员或任一诊所用户）
            const found = await findUserForLogin(kv, targetUsername);
            if (!found || !found.user) {
                return json({ success: false, error: '用户不存在', errorCode: 'USER_NOT_FOUND' }, 404, context.request);
            }

            let didReset = false;
            if (newPassword) {
                const { passwordHash, salt } = await hashPassword(newPassword);
                found.user.passwordHash = passwordHash;
                found.user.salt = salt;
                found.user.updatedAt = getNowISO();

                if (found.clinicId) {
                    const users = (await kv.get(`clinic:${found.clinicId}:users`, 'json')) || [];
                    const idx = users.findIndex(u => u.username === found.user.username);
                    if (idx !== -1) {
                        users[idx] = found.user;
                        await kv.put(`clinic:${found.clinicId}:users`, JSON.stringify(users));
                    } else {
                        return json({ success: false, error: '诊所用户数据异常，未写入' }, 500, context.request);
                    }
                } else {
                    const admins = (await kv.get(KV_SYSTEM_PLATFORM_ADMINS, 'json')) || [];
                    const idx = admins.findIndex(u => u.username === found.user.username);
                    if (idx !== -1) {
                        admins[idx] = found.user;
                        await kv.put(KV_SYSTEM_PLATFORM_ADMINS, JSON.stringify(admins));
                    } else {
                        return json({ success: false, error: '平台管理员数据异常，未写入' }, 500, context.request);
                    }
                }
                didReset = true;
            }

            // 统一收尾：清除失败计数（重置密码后不再被锁定拦截；仅解锁模式即本操作本身）
            const lockCount = parseInt(await kv.get('login_fail:' + found.user.username) || '0', 10);
            const wasLocked = lockCount >= LOGIN_MAX_FAILURES;
            await clearLoginFailures(kv, found.user.username);

            // 审计：按实际动作分别记录
            await writeAuditLog(kv, found.clinicId || null, authUser.username, authUser.role,
                didReset ? 'reset_password' : 'unlock_account', found.user.username, context.request,
                { targetClinicId: found.clinicId || null, targetClinicName: found.clinicName || null, wasLocked, lockCount });

            return json({
                success: true,
                username: found.user.username,
                clinicName: found.clinicName || null,
                reset: didReset,
                wasLocked,
                message: didReset
                    ? '密码已重置并解锁，可立即登录'
                    : (wasLocked ? '账号已解锁' : '账号本就未锁定（已清除失败计数）')
            });
        }

        // ===== 平台管理员更新用户（启停/角色/姓名）POST /users?action=update-user =====
        // ★ P0 2026-08-20 新增：后台"用户管理"从只读升级为可操作。
        //   仅诊所用户可操作（platform_admin 拒绝，防止把自己锁死）；停用立即撤销全部 token；
        //   角色仅允许 clinic_admin ↔ doctor 互转；全部写审计日志。
        if (method === 'POST' && url.searchParams.get('action') === 'update-user') {
            const authUser = await parseAuthHeader(context.request, context.env);
            if (!authUser || !isPlatformAdmin(authUser)) {
                return json({ success: false, error: '未授权：仅平台总管理员可更新用户' }, 401, context.request);
            }

            const body = await context.request.json().catch(() => ({}));
            const targetUsername = (body.username || '').trim();
            const { disabled, role, name } = body;
            if (!targetUsername) {
                return json({ success: false, error: '请提供要更新的用户名' }, 400, context.request);
            }
            if (disabled !== undefined && typeof disabled !== 'boolean') {
                return json({ success: false, error: 'disabled 参数无效（须为布尔值）' }, 400, context.request);
            }
            if (role !== undefined && ![ROLE_CLINIC_ADMIN, ROLE_DOCTOR, ROLE_CASHIER].includes(role)) {
                return json({ success: false, error: '角色仅允许设置为 诊所管理员/医师/前台收费' }, 400, context.request);
            }

            const found = await findUserForLogin(kv, targetUsername);
            if (!found || !found.user) {
                return json({ success: false, error: '用户不存在', errorCode: 'USER_NOT_FOUND' }, 404, context.request);
            }
            const target = found.user;
            if (target.role === ROLE_PLATFORM_ADMIN) {
                return json({ success: false, error: '平台总管理员不支持在此启停/调整角色（防止锁死管理入口）' }, 403, context.request);
            }
            if (!found.clinicId) {
                return json({ success: false, error: '目标用户数据异常（无所属诊所）' }, 500, context.request);
            }

            const clinicUsers = (await kv.get(`clinic:${found.clinicId}:users`, 'json')) || [];
            const tIdx = clinicUsers.findIndex(u => u.username === target.username);
            if (tIdx === -1) {
                return json({ success: false, error: '诊所用户数据异常，未找到该账号' }, 500, context.request);
            }

            const changes = [];
            if (disabled !== undefined && disabled !== (target.disabled === true)) {
                target.disabled = disabled;
                changes.push(disabled ? '停用账号' : '启用账号');
            }
            if (role !== undefined && role !== target.role) {
                // 降级保护：该诊所最后一个 clinic_admin 不允许降为 doctor（诊所将无人可管）
                if (target.role === ROLE_CLINIC_ADMIN && role === ROLE_DOCTOR) {
                    const adminCount = clinicUsers.filter(u => u.role === ROLE_CLINIC_ADMIN).length;
                    if (adminCount <= 1) {
                        return json({ success: false, error: '该诊所仅此一名管理员，不允许降级为医师（诊所将无人可管理）' }, 400, context.request);
                    }
                }
                changes.push(`role: ${target.role} → ${role}`);
                target.role = role;
            }
            if (name !== undefined && String(name).trim() && String(name).trim() !== target.name) {
                target.name = String(name).trim();
                changes.push('name: → ' + target.name);
            }
            if (changes.length === 0) {
                return json({ success: true, message: '无变更', user: sanitizeUser(target, found.clinicId, found.clinicName) }, 200, context.request);
            }

            target.updatedAt = getNowISO();
            clinicUsers[tIdx] = target;
            await kv.put(`clinic:${found.clinicId}:users`, JSON.stringify(clinicUsers));

            // 停用立即生效：撤销该用户全部已签发 token（已登录的会话下次请求即 401）
            if (disabled === true) {
                try { await revokeAllUserTokens(kv, target.username); } catch (e) { console.error('revokeAllUserTokens error:', e); }
            }

            await writeAuditLog(kv, found.clinicId, authUser.username, authUser.role,
                'update_user', target.username, context.request,
                { changes: changes.join('; '), targetClinicName: found.clinicName || null });

            return json({
                success: true,
                message: '已更新：' + changes.join('；'),
                user: sanitizeUser(target, found.clinicId, found.clinicName)
            });
        }

        // ===== 删除用户 POST /users?action=delete-user =====
        // ★ 2026-08-23 新增（KNOWLEDGE 2.51）：此前三端用户管理"删除"只删本地表，
        //   云端账户仍在——被删账户下次云端登录又会落地本地表（"删不干净"架构缺陷）。
        //   权限：platform_admin（任意诊所用户）或 clinic_admin（仅本诊所用户）。
        //   保护：禁止删自己 / 禁止删 platform_admin / 该诊所最后一个 clinic_admin
        //   不允许删（与 update-user 降级保护同口径，防诊所无人可管）。
        //   动作：移除诊所用户记录 + 撤销其全部 token（立即下线）+ 审计日志。
        //   注意：云端处方数据保留（数据安全优先，不做级联删除）。
        if (method === 'POST' && url.searchParams.get('action') === 'delete-user') {
            const authUser = await parseAuthHeader(context.request, context.env);
            if (!authUser || !(isPlatformAdmin(authUser) || isClinicAdmin(authUser))) {
                return json({ success: false, error: '未授权：仅管理员可删除用户' }, 401, context.request);
            }

            const body = await context.request.json().catch(() => ({}));
            const targetUsername = (body.username || '').trim();
            if (!targetUsername) {
                return json({ success: false, error: '请提供要删除的用户名' }, 400, context.request);
            }
            if (targetUsername === authUser.username) {
                return json({ success: false, error: '无法删除当前登录用户' }, 400, context.request);
            }

            const found = await findUserForLogin(kv, targetUsername);
            if (!found || !found.user) {
                return json({ success: false, error: '用户不存在', errorCode: 'USER_NOT_FOUND' }, 404, context.request);
            }
            const target = found.user;
            if (target.role === ROLE_PLATFORM_ADMIN) {
                return json({ success: false, error: '平台总管理员不支持删除（防止锁死管理入口）' }, 403, context.request);
            }
            if (!found.clinicId) {
                return json({ success: false, error: '目标用户数据异常（无所属诊所）' }, 500, context.request);
            }
            // clinic_admin 只能删本诊所用户
            if (isClinicAdmin(authUser) && !isPlatformAdmin(authUser) && authUser.clinicId !== found.clinicId) {
                return json({ success: false, error: '无权删除其他诊所的用户' }, 403, context.request);
            }

            const clinicUsers = (await kv.get(`clinic:${found.clinicId}:users`, 'json')) || [];
            const tIdx = clinicUsers.findIndex(u => u.username === target.username);
            if (tIdx === -1) {
                return json({ success: false, error: '诊所用户数据异常，未找到该账号' }, 500, context.request);
            }
            // 最后一个 clinic_admin 保护：删除后该诊所将无人可管理
            if (target.role === ROLE_CLINIC_ADMIN) {
                const adminCount = clinicUsers.filter(u => u.role === ROLE_CLINIC_ADMIN).length;
                if (adminCount <= 1) {
                    return json({ success: false, error: '该诊所仅此一名管理员，不允许删除（诊所将无人可管理）' }, 400, context.request);
                }
            }

            clinicUsers.splice(tIdx, 1);
            await kv.put(`clinic:${found.clinicId}:users`, JSON.stringify(clinicUsers));

            // 立即下线：撤销该用户全部已签发 token
            try { await revokeAllUserTokens(kv, target.username); } catch (e) { console.error('revokeAllUserTokens error:', e); }

            await writeAuditLog(kv, found.clinicId, authUser.username, authUser.role,
                'delete_user', target.username, context.request,
                { targetClinicName: found.clinicName || null, targetRole: target.role });

            return json({
                success: true,
                message: '用户已删除（云端处方数据保留）',
                username: target.username
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
                            // ★ 诊断辅助：列出该诊所全部用户（角色/是否第一clinic_admin），定位改密码误伤目标
                            const clinicUsers = users.map(u => ({
                                username: u.username,
                                name: u.name || '',
                                role: u.role || '',
                                isFirstClinicAdmin: users.findIndex(x => x.role === ROLE_CLINIC_ADMIN) === users.indexOf(u),
                                hasPasswordHash: !!u.passwordHash
                            }));
                            result.checks.userSearch = {
                                found: true,
                                location: 'clinic',
                                clinicId: clinic.id,
                                clinicName: clinic.name,
                                clinicStatus: clinic.status || 'active',
                                clinicUsers,
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
            const { username, password, machineId, clientClass } = body;
            if (!username || !password) {
                return json({ success: false, error: '手机号/用户名或密码不能为空', code: 'MISSING_CREDENTIALS' }, 400, context.request);
            }

            // P1-1：检查账户是否被锁定
            const isLocked = await checkLoginLocked(kv, username);
            if (isLocked) {
                return json({ success: false, error: '尝试次数过多，账户暂时锁定，请稍后再试', code: 'ACCOUNT_LOCKED' }, 423, context.request);
            }

            let found = await findUserForLogin(kv, username);
            // ★ 2026-08-20 登录自愈：账号未找到时，若该手机号存在管理员已通过的激活申请，
            //   自动补开云端账号并重试一次查找（解决激活通过后用户却无法登录的遗留问题）
            if (!(found && found.user)) {
                const selfHealed = await maybeProvisionFromActivation(kv, username);
                if (selfHealed) {
                    found = await findUserForLogin(kv, username);
                }
            }
            // ★ 2026-08-25 clinicExpiresAt 用 let：授权自愈（下方）可能补写默认365天后赋新值
            let { user, clinicId, clinicName, clinicStatus, clinicEdition, clinicExpiresAt } = found || {};

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
                    ? `密码错误，剩余尝试次数：${remaining} 次`
                    : '密码错误次数过多，账户已暂时锁定，请稍后再试';
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

            // ★ P0 2026-08-20 用户级停用闸门：管理后台"用户管理"可停用单个账号（user.disabled=true）。
            //   仅识别显式 true（undefined/缺省一律视为正常），宁漏检不可误报；停用即撤销其所有 token。
            if (user.disabled === true) {
                console.error('[登录失败] 账号已被停用:', username, clinicName);
                await writeAuditLog(kv, clinicId, username, user.role, 'login_failed', 'user_disabled', context.request, { clinicName });
                return json({
                    success: false,
                    error: '该账号已被平台管理员停用，如有需要请联系管理员启用',
                    code: 'USER_DISABLED',
                    clinicName: clinicName
                }, 403, context.request);
            }

            // ★ 2026-08-20 注册审核闸门：自助注册的诊所（status=test）在管理员审核通过前禁止登录
            //   检查位于密码验证成功之后（P1-6：不构成用户名枚举向量）
            if (clinicStatus === 'test') {
                console.error('[登录失败] 诊所待审核:', username, clinicName);
                await writeAuditLog(kv, clinicId, username, user.role, 'login_failed', 'clinic_pending_approval', context.request, { clinicName });
                return json({
                    success: false,
                    error: '账号已创建，管理员审核通过后即可登录使用（如有疑问请联系客服）',
                    code: 'PENDING_APPROVAL',
                    clinicName: clinicName
                }, 403, context.request);
            }

            // ★ 2026-08-20 有效期闸门：诊所授权到期后禁止登录，续费（管理员重新设置有效期）即恢复
            if (clinicExpiresAt && new Date(clinicExpiresAt).getTime() < Date.now()) {
                const expiredAt = new Date(clinicExpiresAt).toISOString().slice(0, 10);
                console.error('[登录失败] 诊所已到期:', username, clinicName, expiredAt);
                await writeAuditLog(kv, clinicId, username, user.role, 'login_failed', 'clinic_expired', context.request, { clinicName, expiredAt });
                return json({
                    success: false,
                    error: '使用授权已于 ' + expiredAt + ' 到期，请联系管理员续费后登录',
                    code: 'CLINIC_EXPIRED',
                    clinicName: clinicName
                }, 403, context.request);
            }

            // 用户角色是否有效
            if (!user.role || !['platform_admin', 'clinic_admin', 'doctor', 'cashier'].includes(user.role)) {
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

            // ★★★ 2026-08-25 授权状态存量自愈：诊所从未设置有效期（早期平台管理员
            //   直接创建的诊所缺 expiresAt 字段）→ 登录时补写默认 365 天并回写 KV。
            //   仅补"从未设置"（null/空），已过期不自动续（过期=管理员停权手段，
            //   由有效期闸门拦截，语义不变）。补写后本次登录响应即带正确的
            //   clinicExpiresAt，三端授权状态显示"剩余 X 天"。
            if (clinicId && !clinicExpiresAt) {
                try {
                    const clinics = (await kv.get(KV_SYSTEM_CLINICS, 'json')) || [];
                    const idx = clinics.findIndex(c => c && c.id === clinicId);
                    if (idx >= 0 && !clinics[idx].expiresAt) {
                        const newExp = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
                        clinics[idx].expiresAt = newExp;
                        clinics[idx].updatedAt = getNowISO();
                        await kv.put(KV_SYSTEM_CLINICS, JSON.stringify(clinics));
                        clinicExpiresAt = newExp;
                        console.log('[授权自愈] 诊所无有效期，已补写默认365天:', clinicName, newExp.slice(0, 10));
                        await writeAuditLog(kv, clinicId, user.username, user.role, 'license_autofix_365d', 'auth', context.request, { expiresAt: newExp });
                    }
                } catch (healErr) {
                    console.error('[授权自愈] 补写有效期失败（不影响登录）:', healErr.message);
                }
            }

            // ★ P1-A fail-closed：AUTH_SECRET 未配置时 signToken 抛错，转成可行动提示
            let token;
            try {
                token = await signToken({
                    username: user.username,
                    role: user.role,
                    clinicId: clinicId
                }, context.env);
            } catch (signErr) {
                console.error('[P1-A] 登录 Token 签发失败:', signErr.message);
                return json({
                    success: false,
                    error: '服务端安全配置缺失（AUTH_SECRET 未配置），登录暂不可用。请联系管理员：在 Cloudflare Pages 后台配置环境变量 AUTH_SECRET 后重新部署。'
                }, 503, context.request);
            }

            // P1-2：记录登录成功审计日志
            await writeAuditLog(kv, clinicId, user.username, user.role, 'login_success', 'auth', context.request);

            // ★★★ 2026-08-21 账号级设备授权：桌面/APP 设备指纹计入 2 台上限
            //   （网页版 clientClass=web 不占名额；旧客户端无 machineId 放行仅互斥）
            const nowIso = getNowISO();
            const effClientClass = ['desktop', 'app', 'web'].includes(clientClass) ? clientClass : 'web';
            let deviceSummary = null;
            if (effClientClass === 'desktop' || effClientClass === 'app') {
                const bind = await bindUserDevice(kv, user.username, machineId, effClientClass, nowIso);
                if (!bind.ok && bind.code === 'DEVICE_LIMIT') {
                    await writeAuditLog(kv, clinicId, user.username, user.role, 'login_failed', 'device_limit', context.request, {
                        machineId: String(machineId || '').substring(0, 8) + '...',
                        clientClass: effClientClass,
                        bound: bind.record.devices.length
                    });
                    return json({
                        success: false,
                        error: '设备数已达上限（每个账号最多授权 2 台设备：桌面/APP）。请先在已绑定设备上解绑，或联系管理员处理',
                        code: 'DEVICE_LIMIT',
                        devices: sanitizeDevices(bind.record)
                    }, 403, context.request);
                }
                deviceSummary = sanitizeDevices(bind.record);
            }

            // ★★★ 2026-08-21 单设备在线互斥：写入当前唯一有效 session（顶掉旧设备）
            //   旧设备持有的 token 在下一次任意 API 调用时被 verifyToken 拒绝（401）
            await writeUserSession(kv, user.username, token, {
                machineId: machineId || null,
                clientClass: effClientClass
            });

            return json({
                success: true,
                token,
                user: sanitizeUser(user, clinicId, clinicName, clinicStatus, clinicEdition),
                device: deviceSummary,
                // ★ 2026-08-23 云端APP F1基础设置-授权状态：返回诊所到期时间（前端显示"已激活（版本）剩余X天"）
                clinicExpiresAt: clinicExpiresAt || null
            }, 200, context.request);
        }

        // ===== [P0-2 安全修复 已删除] 公开重置密码端点 POST /users?action=reset-public =====
        // 该端点无需认证即可重置任意用户密码，构成账号接管风险，已于 2026-07-18 移除。
        // 替代方案：使用 POST /users?action=change-password（需登录 + 校验旧密码），
        // 或由 clinic_admin/platform_admin 通过用户管理界面重置（已具备权限）。
        if (method === 'POST' && url.searchParams.get('action') === 'reset-public') {
            return json({ success: false, error: '该端点已废弃，请使用 change-password 或联系管理员重置' }, 410);
        }

        // ===== 获取当前登录用户资料 GET /users?action=get-profile =====
        // ★ 2026-08-25 全局统一授权状态：Bearer token 鉴权（免密），返回 user + clinicExpiresAt。
        //   供前端基础设置-授权状态静默刷新：登录缓存缺 clinicExpiresAt 的旧客户端自愈
        //   （网页版会话恢复不重新登录也能显示"剩余 X 天"）；管理员调整诊所授权时长后
        //   前端缓存过期可重新拉取，无需用户重新登录。
        if (method === 'GET' && url.searchParams.get('action') === 'get-profile') {
            const authUser = await parseAuthHeader(context.request, context.env);
            if (!authUser) {
                return json({ success: false, error: '未登录或登录已失效' }, 401, context.request);
            }
            const found = await findUserForLogin(kv, authUser.username);
            if (!found || !found.user) {
                return json({ success: false, error: '用户不存在' }, 404, context.request);
            }
            return json({
                success: true,
                user: sanitizeUser(found.user, found.clinicId, found.clinicName, found.clinicStatus, found.clinicEdition),
                clinicExpiresAt: found.clinicExpiresAt || null
            }, 200, context.request);
        }

        // ===== 设备管理：查看本人已绑定设备 GET /users?action=list-devices =====
        // ★ 2026-08-21 账号级设备授权配套：管理员自助查看 2 台授权设备（脱敏展示）
        if (method === 'GET' && url.searchParams.get('action') === 'list-devices') {
            const authUser = await parseAuthHeader(context.request, context.env);
            if (!authUser) {
                return json({ success: false, error: '未登录或登录已失效' }, 401, context.request);
            }
            const record = (await kv.get(KV_USER_DEVICES_PREFIX + authUser.username, 'json')) || null;
            const session = await getUserSession(kv, authUser.username);
            return json({
                success: true,
                devices: sanitizeDevices(record),
                onlineSession: session ? {
                    clientClass: session.clientClass,
                    machineId: session.machineId ? String(session.machineId).substring(0, 8) + '...' : null,
                    loginAt: session.loginAt
                } : null
            }, 200, context.request);
        }

        // ===== 设备管理：解绑本人设备 POST /users?action=unbind-device =====
        // body: { machineId }（解绑指定设备；换新手机/电脑时自助释放名额）
        // 安全：仅能解绑自己账号名下的设备（token 鉴权）；解绑后该设备下次登录需重新占名额
        if (method === 'POST' && url.searchParams.get('action') === 'unbind-device') {
            const authUser = await parseAuthHeader(context.request, context.env);
            if (!authUser) {
                return json({ success: false, error: '未登录或登录已失效' }, 401, context.request);
            }
            const body = await context.request.json().catch(() => ({}));
            const machineId = String(body.machineId || '').trim();
            if (!machineId) {
                return json({ success: false, error: '缺少 machineId 参数' }, 400, context.request);
            }
            const record = (await kv.get(KV_USER_DEVICES_PREFIX + authUser.username, 'json')) || { devices: [] };
            if (!Array.isArray(record.devices)) record.devices = [];
            const idx = record.devices.findIndex(d => d.machineId === machineId);
            if (idx === -1) {
                return json({ success: false, error: '该设备未绑定在当前账号下' }, 404, context.request);
            }
            const removed = record.devices.splice(idx, 1)[0];
            await kv.put(KV_USER_DEVICES_PREFIX + authUser.username, JSON.stringify(record));
            await writeAuditLog(kv, authUser.clinicId, authUser.username, authUser.role, 'device_unbind', 'auth', context.request, {
                machineId: machineId.substring(0, 8) + '...',
                clientClass: removed.clientClass || null
            });
            return json({
                success: true,
                message: '设备已解绑',
                devices: sanitizeDevices(record)
            }, 200, context.request);
        }

        // ===== 平台管理员：查询账号设备配额 GET /users?action=admin-get-device-quota =====
        // 用途：后台【用户管理】→「设备配额」弹窗打开时查询当前配额与已绑定设备数
        // 权限：仅平台总管理员
        if (method === 'GET' && url.searchParams.get('action') === 'admin-get-device-quota') {
            const authUser = await parseAuthHeader(context.request, context.env);
            if (!authUser || !isPlatformAdmin(authUser)) {
                return json({ success: false, error: '未授权：仅平台总管理员可查询设备配额' }, 401, context.request);
            }
            const targetUsername = String(url.searchParams.get('username') || '').trim();
            if (!targetUsername) {
                return json({ success: false, error: '请提供要查询的用户名' }, 400, context.request);
            }
            const record = (await kv.get(KV_USER_DEVICES_PREFIX + targetUsername, 'json')) || { devices: [] };
            if (typeof record.maxDevices !== 'number' || !Number.isInteger(record.maxDevices) || record.maxDevices <= 0) {
                record.maxDevices = DEVICE_LIMIT_EXEMPT_ACCOUNTS.includes(targetUsername)
                    ? DEVICE_EXEMPT_MAX : MAX_DEVICES_PER_ACCOUNT;
            }
            const devices = Array.isArray(record.devices) ? record.devices : [];
            return json({
                success: true,
                username: targetUsername,
                maxDevices: record.maxDevices,
                devicesCount: devices.length,
                isExempt: DEVICE_LIMIT_EXEMPT_ACCOUNTS.includes(targetUsername),
                devices: sanitizeDevices(record)
            }, 200, context.request);
        }

        // ===== 平台管理员：设置账号设备配额 POST /users?action=admin-set-device-quota =====
        // body: { username, maxDevices }（1~100，99 = 不限；普通账号默认 2，豁免账号默认 99）
        // 权限：仅平台总管理员；写审计日志
        if (method === 'POST' && url.searchParams.get('action') === 'admin-set-device-quota') {
            const authUser = await parseAuthHeader(context.request, context.env);
            if (!authUser || !isPlatformAdmin(authUser)) {
                return json({ success: false, error: '未授权：仅平台总管理员可调整设备配额' }, 401, context.request);
            }
            const body = await context.request.json().catch(() => ({}));
            const targetUsername = String(body.username || '').trim();
            const maxDevices = Number(body.maxDevices);
            if (!targetUsername) {
                return json({ success: false, error: '请提供要调整的用户名' }, 400, context.request);
            }
            if (!Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 100) {
                return json({ success: false, error: '设备配额须为 1~100 的整数（99 = 不限）' }, 400, context.request);
            }
            const record = (await kv.get(KV_USER_DEVICES_PREFIX + targetUsername, 'json')) || { devices: [] };
            if (!Array.isArray(record.devices)) record.devices = [];
            record.maxDevices = maxDevices;
            await kv.put(KV_USER_DEVICES_PREFIX + targetUsername, JSON.stringify(record));

            const found = await findUserForLogin(kv, targetUsername).catch(() => null);
            await writeAuditLog(kv, (found && found.clinicId) || null, authUser.username, authUser.role,
                'set_device_quota', targetUsername, context.request,
                { maxDevices, devicesCount: record.devices.length });

            return json({
                success: true,
                message: '设备配额已更新：' + targetUsername + ' → ' + maxDevices + ' 台' + (maxDevices >= 99 ? '（不限）' : ''),
                username: targetUsername,
                maxDevices,
                devicesCount: record.devices.length
            }, 200, context.request);
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
                    expiresAt: clinic.expiresAt || null,
                    source: clinic.source || null,
                    adminUsername: admin ? admin.username : '-',
                    adminName: admin ? admin.name : '-',
                    adminPhone: admin ? (admin.phone || '') : '',
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
            const { clinicName, adminUsername, adminPassword, adminName, clinicStatus, edition } = body;
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
            // ★ 2026-08-22 统一 edition：平台管理员手动创建默认机构版（cloud_clinic），支持传参覆盖
            const targetEdition = normalizeClinicEdition(edition || 'cloud_clinic', 'active');

            const clinic = {
                id: clinicId,
                name: clinicName.trim(),
                status: 'active',
                createdAt: now,
                updatedAt: now,
                edition: targetEdition,   // ★ 显式写入版本类型
                source: 'platform-admin',
                // ★ 2026-08-25 授权状态全局统一：创建即写入默认 365 天有效期（与管理台
                //   审核 test→active 转正策略一致，见 update-clinic 分支）——
                //   缺 expiresAt 会导致登录接口返回 null，前端授权状态无"剩余 X 天"
                expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
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
            const { clinicId, status, name, adminUsername, adminName, adminPassword, adminPhone, renewDays, edition } = body;
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
            let expiresSetByApproval = false;

            // ★ P0 2026-08-20 收费动作复核：待审核转正（test→active）与续费（renewDays>0）是收费动作，
            //   必须携带管理员密码复核（confirmPassword）+ 收款备注（payNote，≥4字符），
            //   防误操作、留痕审计。停用/设为待审核（非收费）必填 reason 说明原因。
            const isFeeAction = (status === 'active' && oldClinic.status === 'test') ||
                (typeof renewDays === 'number' && renewDays > 0);
            if (isFeeAction) {
                const payNote = String(body.payNote || '').trim();
                const confirmPassword = String(body.confirmPassword || '');
                if (payNote.length < 4) {
                    return json({ success: false, error: '请填写收款备注（金额/支付单号，至少4个字符），用于收费留痕' }, 400);
                }
                if (!confirmPassword) {
                    return json({ success: false, error: '收费操作需输入管理员密码复核' }, 401);
                }
                // 验证当前操作平台管理员的密码（verifyPassword 与登录同一校验链路）
                const adminsArr = (await kv.get(KV_SYSTEM_PLATFORM_ADMINS, 'json')) || [];
                const me = adminsArr.find(a => a.username === currentUser.username);
                const meOk = me && me.passwordHash && me.salt &&
                    (await verifyPassword(confirmPassword, me.passwordHash, me.salt));
                if (!meOk) {
                    await writeAuditLog(kv, clinicId, currentUser.username, ROLE_PLATFORM_ADMIN,
                        'fee_confirm_failed', `clinic=${oldClinic.name}`, context.request, { payNote });
                    return json({ success: false, error: '管理员密码复核失败，请重新输入' }, 403);
                }
                changes.push('payNote: ' + payNote);
            } else if ((status === 'disabled') || (status === 'test' && oldClinic.status !== 'test')) {
                // 停用 / 退回待审核：必填原因（留痕，防误操作）
                const reason = String(body.reason || '').trim();
                if (reason.length < 2) {
                    return json({ success: false, error: '请填写操作原因（至少2个字符），将记入操作日志' }, 400);
                }
                changes.push('reason: ' + reason);
            }

            // 更新诊所状态或名称
            if (status !== undefined && status !== oldClinic.status) {
                // ★ 优化：支持 active/test/disabled 三种状态
                if (!['active', 'test', 'disabled'].includes(status)) {
                    return json({ success: false, error: '状态值无效（active / test / disabled）' }, 400);
                }
                changes.push(`status: ${oldClinic.status} → ${status}`);
                clinics[clinicIdx].status = status;

                // ★ 2026-08-22 统一 edition：test → active 自助注册转正时，必须补 edition
                //   优先级：管理员显式传参 > 注册时用户意向（requestedEdition）> 默认机构版
                if (status === 'active' && oldClinic.status === 'test' && !clinics[clinicIdx].edition) {
                    const fallbackEd = (oldClinic.requestedEdition === 'personal') ? 'cloud_personal'
                        : (oldClinic.requestedEdition === 'institution') ? 'cloud_clinic'
                        : 'cloud_clinic';
                    const edVal = edition || fallbackEd;
                    const edNorm = normalizeClinicEdition(edVal, 'active');
                    clinics[clinicIdx].edition = edNorm;
                    changes.push(`edition: → ${edNorm}` + (oldClinic.requestedEdition ? `（注册意向: ${oldClinic.requestedEdition}）` : ''));
                }

                // ★ 2026-08-20 审核通过即收费开通：test → active 首次转正时自动写入 365 天有效期
                //   （未设置或已过期的有效期才写入，避免"停用→启用"误续期）
                if (status === 'active') {
                    const cur = clinics[clinicIdx].expiresAt ? new Date(clinics[clinicIdx].expiresAt).getTime() : 0;
                    if (!cur || cur < Date.now()) {
                        const days = (typeof renewDays === 'number' && renewDays > 0 && renewDays <= 3650) ? renewDays : 365;
                        clinics[clinicIdx].expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
                        changes.push(`expiresAt: → ${clinics[clinicIdx].expiresAt.slice(0, 10)}（+${days}天）`);
                        expiresSetByApproval = true;
                    }
                }
            }

            // ★ 2026-08-22 支持管理员手动调整 edition（已有 edition 时也允许覆盖，如"标准版升机构版"）
            if (edition !== undefined && edition !== null) {
                const edNorm = normalizeClinicEdition(String(edition), clinics[clinicIdx].status || 'active');
                if (edNorm && edNorm !== clinics[clinicIdx].edition) {
                    changes.push(`edition: ${clinics[clinicIdx].edition || '(空)'} → ${edNorm}`);
                    clinics[clinicIdx].edition = edNorm;
                }
            }

            // ★ 2026-08-20 续费：对已生效诊所叠加有效期（从当前到期日或今天起 +renewDays 天，默认365）
            //   （转正时已写入有效期的不再叠加，避免同请求重复计算）
            if (typeof renewDays === 'number' && renewDays > 0 && renewDays <= 3650 && !expiresSetByApproval) {
                const cur = clinics[clinicIdx].expiresAt ? new Date(clinics[clinicIdx].expiresAt).getTime() : 0;
                const base = (cur > Date.now()) ? cur : Date.now();
                const newExp = new Date(base + renewDays * 24 * 60 * 60 * 1000).toISOString();
                if (newExp !== clinics[clinicIdx].expiresAt) {
                    changes.push(`expiresAt: ${(clinics[clinicIdx].expiresAt || '-').slice(0, 10)} → ${newExp.slice(0, 10)}（续费+${renewDays}天）`);
                    clinics[clinicIdx].expiresAt = newExp;
                }
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
            // ★ 2026-08-20 修复：必须按登录账号（adminUsername）精确定位，不能按"第一个 clinic_admin"
            //   否则多管理员诊所会误改其他账号密码（用户 13398628212 因此反复改密码仍 401）
            if (adminUsername || adminName || adminPassword || adminPhone) {
                const users = (await kv.get(`clinic:${clinicId}:users`, 'json')) || [];

                // 1) 优先按 adminUsername 精确定位（username 或 phone 匹配）
                let adminIdx = -1;
                if (adminUsername) {
                    const t = String(adminUsername).trim();
                    adminIdx = users.findIndex(u =>
                        u.username === t || u.phone === t
                    );
                }
                // 2) 未指定或未命中 → 回退到第一个 clinic_admin（兼容旧调用）
                if (adminIdx === -1) {
                    adminIdx = users.findIndex(u => u.role === ROLE_CLINIC_ADMIN);
                }

                if (adminIdx !== -1) {
                    // 拒绝修改用户名（登录账号不可改，确保全局唯一）
                    if (adminUsername && users[adminIdx].username !== String(adminUsername).trim()
                        && !users.find(u => u.username === String(adminUsername).trim() || u.phone === String(adminUsername).trim())) {
                        return json({ success: false, error: '管理员登录账号不可修改（确保全局唯一和数据安全），仅可修改姓名和密码' }, 403);
                    }
                    if (adminName && adminName !== users[adminIdx].name) {
                        changes.push(`adminName: ${users[adminIdx].name} → ${adminName}`);
                        users[adminIdx].name = adminName.trim();
                    }
                    // ★ 2026-08-23 修改管理员手机号（平台后台诊所列表）
                    //   - 11位手机号格式校验 + 全局唯一校验（username/phone 双匹配 + 激活占位）
                    //   - 同步迁移激活占位键 admin_phone:{old} → admin_phone:{new}
                    if (adminPhone !== undefined) {
                        const newPhone = String(adminPhone).trim();
                        const oldPhone = users[adminIdx].phone || '';
                        if (newPhone !== oldPhone) {
                            if (!/^1[3-9]\d{9}$/.test(newPhone)) {
                                return json({ success: false, error: '请输入正确的11位手机号' }, 400);
                            }
                            const taker = await findUserForLogin(kv, newPhone);
                            if (taker && taker.user && taker.user.username !== users[adminIdx].username) {
                                return json({ success: false, error: '该手机号已被其他账号使用（' + taker.user.username + '），请更换' }, 409);
                            }
                            // 激活申请占位检查：新手机号已有占用（进行中/已激活）则拒绝，
                            //   除非占位申请本身属于当前这位管理员（改回自己的号）
                            const occ = await findPhoneOccupancy(kv, newPhone);
                            if (occ && occ.occupied && occ.detail) {
                                const occUsername = occ.detail.username || occ.detail.adminUsername || '';
                                if (occUsername !== users[adminIdx].username) {
                                    const occHint = occ.kind === 'pending_activation'
                                        ? '存在进行中的激活申请，请先处理'
                                        : '已通过激活开通（账号 ' + (occUsername || '未知') + '），请直接使用该账号';
                                    return json({ success: false, error: '该手机号' + occHint }, 409);
                                }
                            }
                            // 迁移激活占位键（旧手机号占位 → 新手机号），保持激活索引一致
                            if (oldPhone) {
                                const occOld = await kv.get('admin_phone:' + oldPhone, 'json').catch(() => null);
                                if (occOld) {
                                    await kv.put('admin_phone:' + newPhone, JSON.stringify(occOld));
                                    await kv.delete('admin_phone:' + oldPhone);
                                }
                            }
                            changes.push(`adminPhone: ${oldPhone || '(空)'} → ${newPhone}`);
                            users[adminIdx].phone = newPhone;
                        }
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
                        changes.push(`password: updated (${users[adminIdx].username})`);
                        const { passwordHash, salt } = await hashPassword(adminPassword);
                        users[adminIdx].passwordHash = passwordHash;
                        users[adminIdx].salt = salt;
                    }
                    users[adminIdx].updatedAt = now;
                    await kv.put(`clinic:${clinicId}:users`, JSON.stringify(users));
                } else {
                    return json({ success: false, error: '未找到可更新的管理员账号' }, 404);
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

        // ===== 删除诊所 POST /users?clinic=delete =====
        // ★ 2026-08-23 平台后台诊所列表新增"删除诊所"（高危操作）：
        //   安全闸门（三级防误删）：
        //     1) 仅 platform_admin 可调用
        //     2) confirmName 必须与诊所名称完全一致（防点错行）
        //     3) confirmPassword 管理员密码复核（与收费动作同一校验链路）+ reason 必填留痕
        //   删除范围（物理删除，不可恢复）：
        //     - system:clinics 数组中的诊所条目
        //     - clinic:{id}:users（全部账号）
        //     - clinic:{id}:prescriptions / prescriptions_trash（处方与回收站）
        //     - clinic:{id}:medicines / formulas（药材库/验方）
        //     - clinic:{id}:prescription_seq:* / clinic:{id}:seq:*（处方序号，前缀扫描）
        //     - user_devices:{username}（各账号设备绑定）
        //     - admin_phone:{phone}（各账号手机号激活占位，释放号码允许重新注册）
        //   保留：audit_log:{clinicId}:*（审计日志合规留痕，删除动作本身另行记录）
        if (method === 'POST' && url.searchParams.get('clinic') === 'delete') {
            const currentUser = await parseAuthHeader(context.request, context.env);
            if (!currentUser || !isPlatformAdmin(currentUser)) {
                return json({ success: false, error: '仅平台总管理员可删除诊所' }, 403);
            }

            const body = await context.request.json().catch(() => ({}));
            const { clinicId, confirmName, confirmPassword, reason } = body;
            if (!clinicId) {
                return json({ success: false, error: '缺少诊所ID' }, 400);
            }
            const reasonText = String(reason || '').trim();
            if (reasonText.length < 2) {
                return json({ success: false, error: '请填写删除原因（至少2个字符），将记入操作日志' }, 400);
            }
            if (!confirmPassword) {
                return json({ success: false, error: '删除操作需输入管理员密码复核' }, 401);
            }

            const clinics = (await kv.get(KV_SYSTEM_CLINICS, 'json')) || [];
            const clinicIdx = clinics.findIndex(c => c.id === clinicId);
            if (clinicIdx === -1) {
                return json({ success: false, error: '诊所不存在' }, 404);
            }
            const clinic = clinics[clinicIdx];

            // 名称复核：必须与诊所名称完全一致
            if (String(confirmName || '').trim() !== clinic.name) {
                return json({ success: false, error: '诊所名称复核不一致，请输入完整诊所名称「' + clinic.name + '」以确认' }, 400);
            }

            // 管理员密码复核（与收费动作同一校验链路）
            const adminsArr = (await kv.get(KV_SYSTEM_PLATFORM_ADMINS, 'json')) || [];
            const me = adminsArr.find(a => a.username === currentUser.username);
            const meOk = me && me.passwordHash && me.salt &&
                (await verifyPassword(String(confirmPassword), me.passwordHash, me.salt));
            if (!meOk) {
                await writeAuditLog(kv, clinicId, currentUser.username, ROLE_PLATFORM_ADMIN,
                    'delete_clinic_confirm_failed', `clinic=${clinic.name}`, context.request, { reason: reasonText });
                return json({ success: false, error: '管理员密码复核失败，请重新输入' }, 403);
            }

            // ---- 执行删除 ----
            const deletedKeys = [];
            const users = (await kv.get(`clinic:${clinicId}:users`, 'json')) || [];

            // 1) 诊所业务数据
            const businessKeys = [
                `clinic:${clinicId}:users`,
                `clinic:${clinicId}:prescriptions`,
                `clinic:${clinicId}:prescriptions_trash`,
                `clinic:${clinicId}:medicines`,
                `clinic:${clinicId}:formulas`
            ];
            // 处方序号键（按前缀扫描，含每日序号）
            const seqKeys = await listAllKeys(kv, `clinic:${clinicId}:prescription_seq`);
            const userSeqKeys = await listAllKeys(kv, `clinic:${clinicId}:seq`);
            // 2) 账号衍生数据：设备绑定 + 手机号激活占位
            const accountKeys = [];
            for (const u of users) {
                if (u.username) accountKeys.push('user_devices:' + u.username);
                if (u.phone) accountKeys.push('admin_phone:' + u.phone);
            }

            for (const k of [...businessKeys, ...seqKeys, ...userSeqKeys, ...accountKeys]) {
                try {
                    await kv.delete(k);
                    deletedKeys.push(k);
                } catch (e) { /* 单键删除失败不阻断整体，最终留痕 */ }
            }

            // 3) system:clinics 移除条目（最后移除，前面失败可重试且诊所仍可登录管理）
            clinics.splice(clinicIdx, 1);
            await kv.put(KV_SYSTEM_CLINICS, JSON.stringify(clinics));

            // 审计日志（删除留痕，含删除原因与清理键清单）
            await writeAuditLog(kv, clinicId, currentUser.username, ROLE_PLATFORM_ADMIN, 'delete_clinic', `clinic=${clinic.name}`, context.request, {
                reason: reasonText,
                deletedUserCount: users.length,
                deletedKeys: deletedKeys.length,
                deletedKeyList: deletedKeys.slice(0, 50),
                source: 'platform-admin'
            });

            return json({
                success: true,
                message: `诊所「${clinic.name}」已删除（账号 ${users.length} 个，清理数据键 ${deletedKeys.length} 个）`,
                deletedClinic: { id: clinic.id, name: clinic.name },
                deletedUserCount: users.length,
                deletedKeyCount: deletedKeys.length
            });
        }

        // ===== GET 用户列表 =====
        // （排除 check-register 注册预检，避免带该参数的 GET 被此登录态分支拦截）
        if (method === 'GET' && !url.searchParams.get('check-register')) {
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
        // ★ 2026-08-20 修复：排除所有带 action 参数的特殊分支（register-clinic/unlock/bootstrap/
        //   reset-platform-admin/reset-public/change-password/import/xxx），这些分支在下方按
        //   url.searchParams.get('action') 分别处理；若不排除，注册等请求会被本分支拦截并因
        //   缺少 body.users 返回 400 "Missing or invalid users data"，导致注册开通失效
        if (method === 'POST' && !url.searchParams.get('action')) {
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

        // ===== 自助注册诊所 POST /users?action=register-clinic =====
        // ★ 2026-08-20 注册审核制：手机号即账号 + 自设密码，注册即时建号但诊所状态为 test（待审核），
        //   管理员在平台后台"审核通过"（转正）后才能登录（登录闸门见 PENDING_APPROVAL 分支）
        // 安全措施：IP限流(3次/小时) + 手机号全局唯一校验 + 密码强度校验
        if (method === 'POST' && url.searchParams.get('action') === 'register-clinic') {
            const body = await context.request.json().catch(() => ({}));
            const { clinicName, phone, password, adminName, edition, username } = body;

            // ★ 2026-08-21 版本意向：注册时用户自选标准版/机构版（枚举白名单，其余一律按标准版）
            const requestedEdition = (edition === 'institution') ? 'institution' : 'personal';

            // ★ 2026-08-21 用户名（选填）：填写后作为登录账号，未填则默认用手机号
            const regUsername = String(username || '').trim();

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
            if (!clinicName || !phone || !password) {
                return json({ success: false, error: '请填写诊所名称、手机号和密码' }, 400, context.request);
            }
            if (!clinicName.trim()) {
                return json({ success: false, error: '诊所名称不能为空' }, 400, context.request);
            }
            if (clinicName.trim().length < 2 || clinicName.trim().length > 50) {
                return json({ success: false, error: '诊所名称长度需在 2-50 个字符之间' }, 400, context.request);
            }
            if (!/^1[3-9]\d{9}$/.test(phone)) {
                return json({ success: false, error: '请输入正确的11位手机号（用于管理员审核联系）' }, 400, context.request);
            }
            // 密码强度校验（至少8位，含字母和数字）
            if (password.length < 8) {
                return json({ success: false, error: '密码至少8位' }, 400, context.request);
            }
            if (password.length > 128) {
                return json({ success: false, error: '密码过长（最多128位）' }, 400, context.request);
            }
            if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
                return json({ success: false, error: '密码必须同时包含字母和数字' }, 400, context.request);
            }
            // 用户名（选填）格式校验：2-30 字符，仅允许中文/字母/数字/下划线/连字符
            if (regUsername) {
                if (regUsername.length < 2 || regUsername.length > 30) {
                    return json({ success: false, error: '用户名长度需 2-30 个字符' }, 400, context.request);
                }
                if (!/^[\u4e00-\u9fa5a-zA-Z0-9_-]+$/.test(regUsername)) {
                    return json({ success: false, error: '用户名仅允许中文、字母、数字、下划线或连字符' }, 400, context.request);
                }
            }

            // 3. 手机号全局唯一校验（跨诊所 username/phone + platform_admins）
            const existing = await findUserForLogin(kv, phone);
            if (existing && existing.user) {
                return json({ success: false, error: '该手机号已注册，请直接登录；忘记密码请联系客服重置' }, 409, context.request);
            }

            // ★ 2026-08-21 用户名唯一校验：填写了用户名时，不能与其他用户的 username/phone 冲突
            if (regUsername) {
                const unameTaken = await findUserForLogin(kv, regUsername);
                if (unameTaken && unameTaken.user) {
                    return json({ success: false, error: '该用户名已被使用，请更换或留空使用手机号登录' }, 409, context.request);
                }
            }

            // ★ 2026-08-20 手机号激活申请占位拦截（一个号码只能注册一次，避免与激活流程冲突）：
            //   手机号已有进行中/已通过的激活申请时，禁止再次自助注册，及时提醒用户。
            const occ = await findPhoneOccupancy(kv, phone);
            if (occ && occ.kind === 'pending_activation') {
                return json({ success: false, error: '该手机号已有激活申请正在审核中，请耐心等待管理员审核' }, 409, context.request);
            }
            if (occ && occ.kind === 'activated') {
                return json({ success: false, error: '该手机号已激活开通，请直接登录（登录账号=手机号）' }, 409, context.request);
            }

            // 4. 诊所名称重名检查
            const clinics = await kv.get(KV_SYSTEM_CLINICS, 'json');
            const clinicList = clinics || [];
            if (clinicList.some(c => c.name === clinicName.trim())) {
                return json({ success: false, error: '该诊所名称已被注册，请使用其他名称或联系客服' }, 409, context.request);
            }

            // 5. 创建诊所（status=test 待审核）和管理员用户（账号=手机号，密码=自设密码）
            const clinicId = generateId('clinic');
            const now = getNowISO();
            const { passwordHash, salt } = await hashPassword(password);

            const clinic = {
                id: clinicId,
                name: clinicName.trim(),
                status: 'test',
                source: 'self-register',
                requestedEdition: requestedEdition,   // ★ 2026-08-21 注册时的版本意向（转正时优先采用）
                createdAt: now,
                updatedAt: now
            };

            const adminUser = {
                username: regUsername || phone,   // ★ 2026-08-21 用户名选填：填了用户名则以用户名为登录账号，否则默认手机号
                phone: phone,
                name: (adminName || regUsername || phone).trim(),
                role: ROLE_CLINIC_ADMIN,
                passwordHash,
                salt,
                allowedMode: 'both',
                cloudEnabled: true,
                allowSavePrescription: true,
                createdAt: now,
                updatedAt: now
            };

            // 6. 保存到KV
            clinicList.push(clinic);
            await kv.put(KV_SYSTEM_CLINICS, JSON.stringify(clinicList));
            await kv.put(`clinic:${clinicId}:users`, JSON.stringify([adminUser]));

            // 7. 审计日志
            await writeAuditLog(kv, clinicId, phone, ROLE_CLINIC_ADMIN, 'register_clinic', `clinic=${clinicName}`, context.request, {
                phone: phone,
                source: 'self-register',
                requestedEdition: requestedEdition
            });

            return json({
                success: true,
                message: '注册成功！管理员审核通过后即可登录使用',
                clinic: { id: clinicId, name: clinic.name, status: 'test' },
                admin: sanitizeUser(adminUser, clinicId, clinic.name),
                nextStep: '请牢记登录账号（用户名或手机号）和密码，管理员审核通过后即可登录'
            }, 201, context.request);
        }

        // ===== 注册预检：检查手机号是否可用 GET /users?check-register=phone =====
        if (method === 'GET' && url.searchParams.get('check-register')) {
            const phone = url.searchParams.get('check-register');
            if (!phone) {
                return json({ success: false, error: '请提供要检查的手机号' }, 400);
            }
            // 格式校验
            if (!/^1[3-9]\d{9}$/.test(phone)) {
                return json({ available: false, reason: '请输入正确的11位手机号' });
            }
            // 可用性检查
            const found = await findUserForLogin(kv, phone);
            if (found && found.user) {
                return json({ available: false, reason: '该手机号已注册，请直接登录', error: '该手机号已注册，请直接登录', phone });
            }
            // ★ 2026-08-20 激活申请占位检查：手机号已被激活流程占用时，预检即提示不可注册
            const occ = await findPhoneOccupancy(kv, phone);
            if (occ && occ.kind === 'pending_activation') {
                return json({ available: false, reason: '该手机号已有激活申请正在审核中，请耐心等待', error: '该手机号已有激活申请正在审核中，请耐心等待', phone });
            }
            if (occ && occ.kind === 'activated') {
                return json({ available: false, reason: '该手机号已激活开通，请直接登录', error: '该手机号已激活开通，请直接登录', phone });
            }
            return json({ available: true, phone });
        }

        // ===== 注册规范查询 GET /users?registration-info=true =====
        if (method === 'GET' && url.searchParams.get('registration-info') === 'true') {
            return json({
                success: true,
                rules: {
                    clinicName: { min: 2, max: 50, pattern: '中文/英文/数字' },
                    phone: { pattern: '11位手机号，登录账号即手机号' },
                    password: { minLength: 8, requirements: ['包含字母', '包含数字'] },
                    rateLimit: '3次/小时/IP'
                },
                endpoints: {
                    register: 'POST /api/users?action=register-clinic',
                    checkAvailable: 'GET /api/users?check-register={phone}',
                    validateActivation: 'POST /api/license/validate'
                },
                support: {
                    wechat: 'hktzy1688',
                    note: '注册即时建号，管理员审核通过后即可登录使用'
                }
            });
        }

        return json({ success: false, error: 'Method not allowed' }, 405);

    } catch (error) {
        console.error('Users API error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
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
