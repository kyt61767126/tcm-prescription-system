// 新版认证模块 - 多诊所三级角色体系
// 文件名以 _ 开头不会被作为路由暴露
//
// 提供：
//   - hashPassword / verifyPassword: PBKDF2-SHA256 100000 iterations（向后兼容旧 SHA-256）
//   - signToken / verifyToken: HMAC-SHA256 无状态 token（支持黑名单撤销）
//   - parseAuthHeader: 仅支持 Bearer token（Basic 已于 2026-07-18 移除）
//   - 角色常量与判定函数
//   - isTokenRevoked / revokeToken: Token 黑名单管理（登出/改密时撤销）
//
// 安全密钥来自环境变量 AUTH_SECRET，请在 Cloudflare Pages 后台配置。

// ★ P2-B 统一：KV 绑定解析单一事实源（禁止内联解析链）
import { getKV } from './kv.js';

export const ROLE_PLATFORM_ADMIN = 'platform_admin';
export const ROLE_CLINIC_ADMIN = 'clinic_admin';
export const ROLE_DOCTOR = 'doctor';

export const KV_SYSTEM_CLINICS = 'system:clinics';
export const KV_SYSTEM_PLATFORM_ADMINS = 'system:platform_admins';
export const KV_SYSTEM_PLATFORM_MEDICINES = 'system:platform_medicines';

// Token 黑名单 KV key 前缀
export const KV_TOKEN_REVOKED_PREFIX = 'revoked_token:';

const DEFAULT_SECRET = 'tcm-dev-insecure-secret-replace-in-prod';

// ★ P1-A fail-closed 安全门禁（2026-08-19）：
//   AUTH_SECRET 未配置或等于默认不安全值时，getSecret 返回 null：
//   - signToken 拒绝签发（登录直接失败，不产生可用默认密钥签名的 token）
//   - verifyToken 拒绝验证（攻击者无法再用公开的默认密钥伪造任意角色 token）
//   设计依据：认证密钥缺失时宁可显式不可用，不可静默降级为可伪造签名。
//   处置：Cloudflare Pages 后台 Settings → Environment variables 配置
//   AUTH_SECRET（32 位以上随机串）后重新部署；本地开发在仓库根目录 .dev.vars 配置。
function getSecret(env) {
    const secret = env?.AUTH_SECRET || '';
    if (!secret || secret === DEFAULT_SECRET) {
        return null;
    }
    return secret;
}

// 供调用方预检密钥配置状态（如诊断端点/健康检查）
export function isAuthSecretConfigured(env) {
    return getSecret(env) !== null;
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

// P0-11 安全升级：PBKDF2-SHA256 100000 iterations（向后兼容旧 SHA-256 格式）
// 旧格式: passwordHash = SHA-256(salt + ':' + password)
// 新格式: passwordHash = 'pbkdf2$100000$' + PBKDF2-SHA256(salt + ':' + password)
const PBKDF2_ITERATIONS = 100000;

async function pbkdf2Hash(password, salt) {
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        strToBytes(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
    );
    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: strToBytes(salt + ':' + password),
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256'
        },
        keyMaterial,
        256
    );
    return 'pbkdf2$' + PBKDF2_ITERATIONS + '$' + bytesToHex(new Uint8Array(derivedBits));
}

// 密码哈希：默认使用 PBKDF2，向后兼容旧 SHA-256 调用方
// 返回 { passwordHash, salt }
export async function hashPassword(password, saltHex) {
    const salt = saltHex || generateSalt();
    const passwordHash = await pbkdf2Hash(password, salt);
    return { passwordHash, salt };
}

// 验证密码：自动识别 PBKDF2 新格式和 SHA-256 旧格式
export async function verifyPassword(password, passwordHash, salt) {
    if (!passwordHash || !salt) return false;

    // 新格式：pbkdf2$100000$hex
    if (passwordHash.startsWith('pbkdf2$')) {
        const parts = passwordHash.split('$');
        if (parts.length !== 3) return false;
        const iterations = parseInt(parts[1], 10);
        const expectedHash = parts[2];
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            strToBytes(password),
            { name: 'PBKDF2' },
            false,
            ['deriveBits']
        );
        const derivedBits = await crypto.subtle.deriveBits(
            {
                name: 'PBKDF2',
                salt: strToBytes(salt + ':' + password),
                iterations: iterations,
                hash: 'SHA-256'
            },
            keyMaterial,
            256
        );
        const computedHash = bytesToHex(new Uint8Array(derivedBits));
        // 常量时间比较，防止时序攻击
        return constantTimeEqual(computedHash, expectedHash);
    }

    // 旧格式：SHA-256(salt + ':' + password)
    const computed = await sha256(salt + ':' + password);
    return constantTimeEqual(computed, passwordHash);
}

// 常量时间字符串比较，防止时序攻击
export function constantTimeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
}

// 检查密码哈希是否为旧格式（SHA-256），用于登录时自动升级
export function isLegacyPasswordHash(passwordHash) {
    return passwordHash && !passwordHash.startsWith('pbkdf2$');
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
// P3-6：TTL 支持环境变量 AUTH_TOKEN_TTL_HOURS 配置（默认 168 小时 = 7 天）
export async function signToken(payload, env, ttlMs = null) {
    // ★ P1-A fail-closed：密钥未配置时拒绝签发（抛错由调用方转成可行动提示）
    const secret = getSecret(env);
    if (!secret) {
        throw new Error('AUTH_SECRET_NOT_CONFIGURED');
    }
    // P3-6：优先使用环境变量配置的 TTL
    const envTtlHours = env?.AUTH_TOKEN_TTL_HOURS ? parseFloat(env.AUTH_TOKEN_TTL_HOURS) : null;
    const effectiveTtl = ttlMs !== null ? ttlMs : (envTtlHours ? envTtlHours * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000);
    const expireAt = Date.now() + effectiveTtl;
    // P0-2 修复：签发时写入用户 token version（纳入签名），使 revokeAllUserTokens 真正生效
    // ★ P2-B 统一：KV 绑定解析改用 _lib/kv.js 单一事实源
    const kvForVer = getKV(env);
    let tokenVersion = 0;
    if (kvForVer) {
        try {
            tokenVersion = parseInt(await kvForVer.get('user_token_version:' + payload.username) || '0', 10) || 0;
        } catch (e) { /* KV 读取失败按 v=0 继续（不影响正常登录） */ }
    }
    const tokenPayload = { u: payload.username, r: payload.role, c: payload.clinicId || null, e: expireAt, v: tokenVersion };
    const payloadStr = JSON.stringify(tokenPayload);
    const sig = await hmacSign(payloadStr, secret);
    const fullPayload = { ...tokenPayload, s: sig };
    return btoa(String.fromCharCode(...new Uint8Array(strToBytes(JSON.stringify(fullPayload)))));
}

// 验证 token，返回 { username, role, clinicId, isAdmin } 或 null
// P1-3 安全增强：支持 Token 黑名单撤销检查
export async function verifyToken(token, env) {
    try {
        const binary = atob(token);
        const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        const json = new TextDecoder().decode(bytes);
        const payload = JSON.parse(json);
        if (!payload.u || !payload.r || !payload.e || !payload.s) return null;

        if (Date.now() > payload.e) return null;

        // ★ P1-A fail-closed：密钥未配置时拒绝验证（防默认密钥伪造 token）
        const secret = getSecret(env);
        if (!secret) {
            console.error('[安全] AUTH_SECRET 未配置，拒绝验证 Token（fail-closed，防默认密钥伪造）。请在 Cloudflare Pages 后台配置环境变量 AUTH_SECRET。');
            return null;
        }
        // P0-2 修复：新 token 签名覆盖 v 字段；旧 token（无 v）按旧算法校验以保持兼容
        const sigBody = payload.v !== undefined
            ? { u: payload.u, r: payload.r, c: payload.c, e: payload.e, v: payload.v }
            : { u: payload.u, r: payload.r, c: payload.c, e: payload.e };
        const expectedSig = await hmacSign(JSON.stringify(sigBody), secret);
        if (expectedSig !== payload.s) return null;

        // P1-3：检查 Token 黑名单（★ P2-B 统一：getKV 单一事实源）
        const kv = getKV(env);
        if (kv) {
            // P0-2 修复：检查用户 token version（revokeAllUserTokens 递增后，旧版本 token 全部失效）
            try {
                const tokenVersion = payload.v || 0;
                const currentVersion = parseInt(await kv.get('user_token_version:' + payload.u) || '0', 10) || 0;
                if (tokenVersion < currentVersion) {
                    console.warn('[安全] 已撤销版本(v' + tokenVersion + '<v' + currentVersion + ')的 Token 被拒绝:', payload.u);
                    return null;
                }
            } catch (e) { /* KV 读取失败放行（避免故障时全站不可用） */ }

            const tokenHash = await sha256(token);
            const revoked = await kv.get(KV_TOKEN_REVOKED_PREFIX + tokenHash);
            if (revoked) {
                console.warn('[安全] 已撤销的 Token 被拒绝:', payload.u);
                return null;
            }
        }

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

// P1-3：撤销 Token（登出/改密时调用）
export async function revokeToken(token, env) {
    try {
        const kv = getKV(env);  // ★ P2-B 统一：单一事实源
        if (!kv || !token) return false;
        const tokenHash = await sha256(token);
        // 黑名单保留 8 天（略长于 Token 7 天 TTL）
        await kv.put(KV_TOKEN_REVOKED_PREFIX + tokenHash, '1', { expirationTtl: 8 * 24 * 60 * 60 });
        return true;
    } catch (e) {
        console.error('revokeToken error:', e);
        return false;
    }
}

// P1-3：撤销用户所有 Token（改密/角色变更时调用）
// 通过递增 user_token_version 实现，旧 Token 携带的版本号不匹配即失效
export async function revokeAllUserTokens(kv, username) {
    try {
        const versionKey = 'user_token_version:' + username;
        const currentVersion = parseInt(await kv.get(versionKey) || '0', 10);
        await kv.put(versionKey, String(currentVersion + 1));
        return true;
    } catch (e) {
        console.error('revokeAllUserTokens error:', e);
        return false;
    }
}

// 解析 Authorization 头：
//   Bearer <token>  - HMAC 签名 token（唯一支持的认证方式）
//
// 安全说明：Basic auth 兼容分支已于 2026-07-18 移除（P0 安全修复）。
// 旧实现允许任意客户端通过 `Authorization: Basic base64("任意用户名:platform_admin")`
// 绕过密码验证并声明任意角色，构成认证绕过漏洞。所有前端均使用 Bearer token，
// 不再需要 Basic 兼容路径。
export async function parseAuthHeader(request, env) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) return null;

    try {
        if (authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            const verified = await verifyToken(token, env);
            if (verified) return verified;
            return null;
        }
        // 拒绝所有非 Bearer 认证方式（包括 Basic），防止认证绕过
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
