// 新版认证模块 - 多诊所三级角色体系
// 文件名以 _ 开头不会被作为路由暴露
//
// 提供：
//   - hashPassword / verifyPassword: SHA-256(salt + ':' + password)
//   - signToken / verifyToken: HMAC-SHA256 无状态 token
//   - parseAuthHeader: 兼容新版 JSON Basic auth + Bearer token + 旧版 username:role
//   - 角色常量与判定函数
//
// 安全密钥来自环境变量 AUTH_SECRET，请在 Cloudflare Pages 后台配置。

export const ROLE_PLATFORM_ADMIN = 'platform_admin';
export const ROLE_CLINIC_ADMIN = 'clinic_admin';
export const ROLE_DOCTOR = 'doctor';

export const KV_SYSTEM_CLINICS = 'system:clinics';
export const KV_SYSTEM_PLATFORM_ADMINS = 'system:platform_admins';
export const KV_SYSTEM_PLATFORM_MEDICINES = 'system:platform_medicines';

const DEFAULT_SECRET = 'tcm-dev-insecure-secret-replace-in-prod';

function getSecret(env) {
    const secret = env?.AUTH_SECRET || DEFAULT_SECRET;
    if (secret === DEFAULT_SECRET) {
        console.warn('[安全警告] AUTH_SECRET 未配置，正在使用默认不安全密钥！请在 Cloudflare Pages 后台设置环境变量 AUTH_SECRET。');
    }
    return secret;
}

function strToBytes(str) {
    return new TextEncoder().encode(str);
}

function bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
    const arr = new Uint8Array(hex.length / 2);
    for (let i = 0; i < arr.length; i++) {
        arr[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return arr;
}

async function sha256(str) {
    const data = strToBytes(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return bytesToHex(new Uint8Array(hashBuffer));
}

// 生成随机 salt（16字节，32位hex字符串）
function generateSalt() {
    return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
}

// 密码哈希：SHA-256(salt + ':' + password)
// 返回 { passwordHash, salt }
export async function hashPassword(password, saltHex) {
    const salt = saltHex || generateSalt();
    const passwordHash = await sha256(salt + ':' + password);
    return { passwordHash, salt };
}

// 验证密码
export async function verifyPassword(password, passwordHash, salt) {
    if (!passwordHash || !salt) return false;
    const computed = await sha256(salt + ':' + password);
    return computed === passwordHash;
}

// HMAC-SHA256 签名
async function hmacSign(message, secret) {
    const key = await crypto.subtle.importKey(
        'raw',
        strToBytes(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, strToBytes(message));
    return bytesToHex(new Uint8Array(sig));
}

// 签发 token: base64(JSON({u, r, c, e, s}))
//   u: username, r: role, c: clinicId, e: expire timestamp(ms), s: HMAC signature
export async function signToken(payload, env, ttlMs = 7 * 24 * 60 * 60 * 1000) {
    const secret = getSecret(env);
    const expireAt = Date.now() + ttlMs;
    const tokenPayload = { u: payload.username, r: payload.role, c: payload.clinicId || null, e: expireAt };
    const payloadStr = JSON.stringify(tokenPayload);
    const sig = await hmacSign(payloadStr, secret);
    const fullPayload = { ...tokenPayload, s: sig };
    return btoa(String.fromCharCode(...new Uint8Array(strToBytes(JSON.stringify(fullPayload)))));
}

// 验证 token，返回 { username, role, clinicId, isAdmin } 或 null
export async function verifyToken(token, env) {
    try {
        const binary = atob(token);
        const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        const json = new TextDecoder().decode(bytes);
        const payload = JSON.parse(json);
        if (!payload.u || !payload.r || !payload.e || !payload.s) return null;

        if (Date.now() > payload.e) return null;

        const secret = getSecret(env);
        const expectedSig = await hmacSign(JSON.stringify({ u: payload.u, r: payload.r, c: payload.c, e: payload.e }), secret);
        if (expectedSig !== payload.s) return null;

        return {
            username: payload.u,
            role: payload.r,
            clinicId: payload.c || null,
            isAdmin: payload.r === ROLE_PLATFORM_ADMIN || payload.r === ROLE_CLINIC_ADMIN
        };
    } catch (e) {
        return null;
    }
}

// 解析 Authorization 头，兼容多种格式：
//   1. Bearer <token>      - HMAC 签名 token
//   2. Basic base64(JSON({username, role, clinicId}))  - 新版 JSON 格式
//   3. Basic base64(username:role)  - 旧版格式（兼容过渡）
export async function parseAuthHeader(request, env) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) return null;

    try {
        if (authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            const verified = await verifyToken(token, env);
            if (verified) return verified;
            return null;
        } else if (authHeader.startsWith('Basic ')) {
            const base64Credentials = authHeader.substring(6);
            const decoded = atob(base64Credentials);
            // 优先尝试 JSON 格式（新版）
            try {
                const payload = JSON.parse(decoded);
                if (payload && payload.username) {
                    return {
                        username: payload.username,
                        role: payload.role || ROLE_DOCTOR,
                        clinicId: payload.clinicId || null,
                        isAdmin: payload.role === ROLE_PLATFORM_ADMIN || payload.role === ROLE_CLINIC_ADMIN
                    };
                }
            } catch (e) {
                // 不是 JSON，尝试旧版 username:role 格式
                const [username, role] = decoded.split(':');
                if (username) {
                    return {
                        username,
                        role: role || 'user',
                        clinicId: null,
                        isAdmin: role === 'admin' || role === ROLE_PLATFORM_ADMIN || role === ROLE_CLINIC_ADMIN
                    };
                }
            }
        }
        return null;
    } catch (error) {
        console.error('Auth parsing error:', error);
        return null;
    }
}

// 角色判定函数
export function isPlatformAdmin(user) {
    return !!(user && user.role === ROLE_PLATFORM_ADMIN);
}

export function isClinicAdmin(user) {
    return !!(user && user.role === ROLE_CLINIC_ADMIN);
}

export function isDoctor(user) {
    return !!(user && user.role === ROLE_DOCTOR);
}

export function isAdmin(user) {
    return isPlatformAdmin(user) || isClinicAdmin(user);
}
