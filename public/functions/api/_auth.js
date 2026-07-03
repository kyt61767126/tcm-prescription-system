// 共享认证模块 - Cloudflare Pages Functions 内部使用
// 文件名以 _ 开头不会被作为路由暴露
//
// 提供：
//   - hashPassword / verifyPassword: PBKDF2-SHA256 密码哈希
//   - signToken / verifyToken: HMAC-SHA256 无状态 token
//   - parseAuth: 兼容旧 Basic + 新 Bearer token
//   - safeBtoa / safeAtob: 与客户端对称的 UTF-8 安全 Base64
//
// 安全密钥来自环境变量 AUTH_SECRET，请在 Cloudflare Pages 后台配置。
// 若未配置则使用兜底默认值（不安全，仅用于本地开发），生产环境必须配置 AUTH_SECRET。

const DEFAULT_SECRET = 'tcm-dev-insecure-secret-replace-in-prod';

function getSecret(env) {
  return env?.AUTH_SECRET || DEFAULT_SECRET;
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

// PBKDF2 密码哈希 - 返回 "salt:hash" 字符串
export async function hashPassword(password, saltHex) {
  const salt = saltHex
    ? hexToBytes(saltHex)
    : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    strToBytes(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const hashHex = bytesToHex(new Uint8Array(bits));
  const saltStr = bytesToHex(salt);
  return `${saltStr}:${hashHex}`;
}

// 兼容明文（旧数据）与 "salt:hash" 格式
export async function verifyPassword(password, stored) {
  if (!stored) return false;
  if (!stored.includes(':')) return password === stored;
  const [salt, expectedHash] = stored.split(':');
  if (!salt || !expectedHash) return false;
  const computed = await hashPassword(password, salt);
  return computed.split(':')[1] === expectedHash;
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

// 签发 token: base64(JSON({u, r, e, s}))
//   u: username, r: role, e: expire timestamp(ms), s: HMAC signature
export async function signToken(username, role, env, ttlMs = 7 * 24 * 60 * 60 * 1000) {
  const secret = getSecret(env);
  const expireAt = Date.now() + ttlMs;
  const payload = { u: username, r: role, e: expireAt };
  const payloadStr = JSON.stringify(payload);
  const sig = await hmacSign(payloadStr, secret);
  const tokenPayload = { ...payload, s: sig };
  return btoa(String.fromCharCode(...new Uint8Array(strToBytes(JSON.stringify(tokenPayload)))));
}

// 验证 token，返回 { username, role, isAdmin } 或 null
export async function verifyToken(token, env) {
  try {
    const binary = atob(token);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const payload = JSON.parse(json);
    if (!payload.u || !payload.r || !payload.e || !payload.s) return null;

    if (Date.now() > payload.e) return null;

    const secret = getSecret(env);
    const expectedSig = await hmacSign(JSON.stringify({ u: payload.u, r: payload.r, e: payload.e }), secret);
    if (expectedSig !== payload.s) return null;

    return {
      username: payload.u,
      role: payload.r,
      isAdmin: payload.r === 'admin',
      allowSavePrescription: true
    };
  } catch (e) {
    return null;
  }
}

// 与客户端 safeBtoa 对称的解码函数
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
        } else {
          result += String.fromCharCode(byte);
          i++;
        }
      } else if (byte < 0xF0) {
        if (i + 2 < bytes.length) {
          const charCode = ((byte & 0x0F) << 12) | ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F);
          result += String.fromCharCode(charCode);
          i += 3;
        } else {
          result += String.fromCharCode(byte);
          i++;
        }
      } else if (byte < 0xF8) {
        if (i + 3 < bytes.length) {
          const charCode = ((byte & 0x07) << 18) | ((bytes[i + 1] & 0x3F) << 12) | ((bytes[i + 2] & 0x3F) << 6) | (bytes[i + 3] & 0x3F);
          result += String.fromCharCode(charCode);
          i += 4;
        } else {
          result += String.fromCharCode(byte);
          i++;
        }
      } else {
        result += String.fromCharCode(byte);
        i++;
      }
    }
    return result;
  } catch (e) {
    return atob(str);
  }
}

// 兼容多种 Authorization 头格式
// 1. Bearer <token>      - 新版 HMAC 签名 token（推荐）
// 2. Basic base64(u:r)    - 旧版格式（兼容过渡，仅返回身份，不强制验密）
// 3. Bearer base64(json)  - 老的 Bearer JSON 格式
export async function parseAuth(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return null;

  try {
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      // 优先尝试新 HMAC token 验证
      const verified = await verifyToken(token, env);
      if (verified) return verified;

      // 退回老的 Bearer JSON 格式（兼容）
      const decoded = safeAtob(token);
      const userInfo = JSON.parse(decoded);
      return {
        username: userInfo.username,
        role: userInfo.role || 'user',
        isAdmin: userInfo.role === 'admin',
        allowSavePrescription: true
      };
    } else if (authHeader.startsWith('Basic ')) {
      // 旧版兼容：仅解码身份，不验密（密码已在登录时验证）
      // TODO(安全): 计划在所有客户端迁移到 Bearer token 后删除此分支
      const base64Credentials = authHeader.substring(6);
      const credentials = safeAtob(base64Credentials);
      const [username, role] = credentials.split(':');
      if (!username) return null;
      return {
        username,
        role: role || 'user',
        isAdmin: role === 'admin',
        allowSavePrescription: true
      };
    }
    return null;
  } catch (error) {
    console.error('Auth parsing error:', error);
    return null;
  }
}
