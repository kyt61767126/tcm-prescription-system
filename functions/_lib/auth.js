// ============================================================================
// 共享认证与多诊所分区工具模块（前后端 API 共用）
// ============================================================================
// 设计说明：
// - Basic auth payload 升级为 JSON：base64(JSON.stringify({username, role, clinicId}))
// - 不再支持旧格式 `username:role`（设计阶段无过渡期）
// - KV 键全部加 `clinic:{clinicId}:` 前缀实现多诊所分区
// - 密码使用 SHA-256 + per-user salt 存储
// - 三级角色：platform_admin / clinic_admin / doctor
// ============================================================================

// ---------- 角色常量 ----------
export const ROLE = {
    PLATFORM_ADMIN: 'platform_admin',
    CLINIC_ADMIN: 'clinic_admin',
    DOCTOR: 'doctor'
};

// ---------- KV 键命名空间 ----------
export const KV_NS = {
    PLATFORM_ADMINS: 'system:platform_admins',
    CLINICS: 'system:clinics',
    // 诊所分区键（前缀）：
    // clinic:{clinicId}:users
    // clinic:{clinicId}:prescriptions
    // clinic:{clinicId}:medicines
    // clinic:{clinicId}:formulas
    // clinic:{clinicId}:prescriptions_trash
    // clinic:{clinicId}:seq:{username}:daily:{yymmdd}
};

// 生成诊所分区 KV 键
export function clinicKey(clinicId, name) {
    return `clinic:${clinicId}:${name}`;
}

// ---------- base64 UTF-8 安全编解码（与前端 safeBtoa/safeAtob 对称） ----------
export function safeAtob(str) {
    try {
        const decoded = atob(str);
        const bytes = [];
        for (let i = 0; i < decoded.length; i++) {
            bytes.push(decoded.charCodeAt(i));
        }
        let result = '';
        let i = 0;
        while (i < bytes.length) {
            const byte = bytes[i];
            if (byte < 0x80) {
                result += String.fromCharCode(byte);
                i++;
            } else if (byte < 0xC0) {
                result += String.fromCharCode(byte);
                i++;
            } else if (byte < 0xE0) {
                if (i + 1 < bytes.length) {
                    const charCode = ((byte & 0x1F) << 6) | (bytes[i + 1] & 0x3F);
                    result += String.fromCharCode(charCode);
                    i += 2;
                } else { result += String.fromCharCode(byte); i++; }
            } else if (byte < 0xF0) {
                if (i + 2 < bytes.length) {
                    const charCode = ((byte & 0x0F) << 12) | ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F);
                    result += String.fromCharCode(charCode);
                    i += 3;
                } else { result += String.fromCharCode(byte); i++; }
            } else if (byte < 0xF8) {
                if (i + 3 < bytes.length) {
                    const charCode = ((byte & 0x07) << 18) | ((bytes[i + 1] & 0x3F) << 12) | ((bytes[i + 2] & 0x3F) << 6) | (bytes[i + 3] & 0x3F);
                    result += String.fromCharCode(charCode);
                    i += 4;
                } else { result += String.fromCharCode(byte); i++; }
            } else {
                result += String.fromCharCode(byte);
                i++;
            }
        }
        return result;
    } catch (e) {
        console.error('safeAtob error:', e);
        return atob(str);
    }
}

// ---------- 解析 Authorization 头（仅支持新 JSON 格式） ----------
// 前端发送：Authorization: Basic base64(JSON.stringify({username, role, clinicId}))
// 返回：{ username, role, clinicId, isPlatformAdmin, isClinicAdmin, isDoctor }
export function parseAuthHeader(request) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) return null;

    try {
        let payload = null;
        if (authHeader.startsWith('Basic ')) {
            const decoded = safeAtob(authHeader.slice(6));
            // 新格式：JSON 字符串
            if (decoded.startsWith('{')) {
                payload = JSON.parse(decoded);
            } else {
                // 旧格式 `username:role` 已废弃，直接拒绝
                return null;
            }
        }
        if (!payload || !payload.username || !payload.role) return null;

        return {
            username: payload.username,
            role: payload.role,
            clinicId: payload.clinicId || null,
            isPlatformAdmin: payload.role === ROLE.PLATFORM_ADMIN,
            isClinicAdmin: payload.role === ROLE.CLINIC_ADMIN,
            isDoctor: payload.role === ROLE.DOCTOR,
            // 兼容旧代码的 isAdmin 字段：clinic_admin 与 platform_admin 在诊所内均视为管理员
            isAdmin: payload.role === ROLE.PLATFORM_ADMIN || payload.role === ROLE.CLINIC_ADMIN,
            allowSavePrescription: true
        };
    } catch (e) {
        console.error('Auth parsing error:', e);
        return null;
    }
}

// ---------- 密码哈希（SHA-256 + salt） ----------
// 使用 Web Crypto API（Cloudflare Workers 内置支持）
export async function hashPassword(password, salt) {
    const encoder = new TextEncoder();
    const data = encoder.encode(salt + ':' + password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function generateSalt() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// 验证密码
export async function verifyPassword(password, salt, expectedHash) {
    const actualHash = await hashPassword(password, salt);
    return actualHash === expectedHash;
}

// ---------- 统一 CORS 响应头 ----------
export const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
};

export function corsResponse(body, init = {}) {
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS,
            ...(init.headers || {})
        }
    });
}

export function handleOptions() {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
}

// ---------- KV 绑定解析（兼容多种命名） ----------
export function getKV(env) {
    return env.KV ||
           env.TCM_PRESCRIPTION_KV ||
           env['tcm-prescription-kv'] ||
           env['TCM-PRESCRIPTION-KV'] ||
           env.TCM_KV ||
           env.PRESCRIPTION_KV ||
           null;
}

// ---------- 时间工具 ----------
export function getBeijingTime() {
    const now = new Date();
    return new Date(now.getTime() + (8 * 60 * 60 * 1000));
}

export function formatBeijingDateYYMMDD(date) {
    const year = date.getUTCFullYear().toString().substring(2);
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return year + month + day;
}
