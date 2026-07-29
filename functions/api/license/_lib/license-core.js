// ============================================================================
//  license-core.js — 激活码系统核心库（云端 Pages Functions 使用）
//
//  功能：
//    - 生成激活码（BNZC-XXXX-XXXX-XXXX-XXXX 格式）
//    - HMAC-SHA256 签名（与客户端 license-manager.js v2 一致）
//    - KV 存储操作（save/get/list 激活码）
//    - license 数据组装（与客户端 license.dat 格式一致）
//
//  ★ 签名密钥和 LICENSE_TYPE_CONFIG 必须与客户端保持一致：
//    - app_project/db-geren/electron/license-manager.js
//    - app_project/cloud_desktop/electron/license-manager.js
// ============================================================================

// ★ 必须与客户端 license-manager.js 中的 LICENSE_HMAC_KEY 保持一致
// 优先从环境变量读取（Cloudflare Secrets），硬编码作为默认值（向后兼容）
// ★ P1-3 优化：如果配置了 LICENSE_MASTER_KEY，使用 masterKey 派生 HMAC 密钥
//   派生算法（与客户端 getEffectiveHmacKey 一致）：
//     effectiveHmacKey = SHA256(masterKey + ':license-hmac:v1')
//   优势：每个安装的 license 使用独立密钥，攻击者破解单一安装不会泄露其他安装密钥
async function getLicenseHmacKey(context) {
    // ★ P1-3: 优先使用 masterKey 派生密钥
    const masterKey = getLicenseMasterKey(context);
    if (masterKey) {
        const derived = await crypto.subtle.digest('SHA-256', strToBytes(masterKey + ':license-hmac:v1'));
        return bytesToHex(new Uint8Array(derived));
    }
    if (context && context.env && context.env.LICENSE_HMAC_KEY) {
        return context.env.LICENSE_HMAC_KEY;
    }
    // ★ typeof 保护：Cloudflare Workers/Pages runtime 无 process 全局，直接访问会抛 ReferenceError
    if (typeof process !== 'undefined' && process.env && process.env.LICENSE_HMAC_KEY) {
        return process.env.LICENSE_HMAC_KEY;
    }
    return 'bnzc_tcm_license_key_v1_2026';
}

const LICENSE_HMAC_KEY = 'bnzc_tcm_license_key_v1_2026';

// ★ P1 安全分发优化：从环境变量读取 masterKey（可选）
// 用途：写入 license.dat，客户端运行时派生 HMAC/CONFIG_SIGN 密钥，避免硬编码
// 未配置时 license 不含 masterKey 字段，客户端 fallback 到硬编码密钥（向后兼容）
// 配置方法：在 Cloudflare Pages 后台设置环境变量 LICENSE_MASTER_KEY（32+ 字符随机字符串）
function getLicenseMasterKey(context) {
    if (context && context.env && context.env.LICENSE_MASTER_KEY) {
        return context.env.LICENSE_MASTER_KEY;
    }
    if (typeof process !== 'undefined' && process.env && process.env.LICENSE_MASTER_KEY) {
        return process.env.LICENSE_MASTER_KEY;
    }
    return null;  // 未配置时不下发 masterKey，客户端用硬编码 fallback
}

// ★ v2: 版本类型默认配置（必须与 license-manager.js 中 LICENSE_TYPE_CONFIG 一致）
const LICENSE_TYPE_CONFIG = {
    trial: {
        maxPrescriptions: 30,
        features: []
    },
    personal: {
        maxPrescriptions: 0,  // 0 = 无限
        features: ['backup']
    },
    pro: {
        maxPrescriptions: 0,
        features: ['backup', 'sync', 'multi-device', 'priority-support']
    }
};

// 激活码字符集：去除易混淆字符 0/O/1/I
const ACTIVATION_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ACTIVATION_CODE_PREFIX = 'BNZC';
const ACTIVATION_CODE_GROUPS = 4;  // BNZC + 4 组，每组 4 字符
const ACTIVATION_CODE_GROUP_LENGTH = 4;

// KV key 前缀
const KV_LICENSE_PREFIX = 'license:';
const KV_LICENSE_INDEX = 'system:license_index';

// ============================================================================
//  工具函数
// ============================================================================
function strToBytes(str) {
    return new TextEncoder().encode(str);
}

function bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// HMAC-SHA256 签名（Web Crypto API）
// ★ 签名内容必须与客户端 license-manager.js 的 generateSignature 完全一致
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

// ============================================================================
//  ★ 任务2 新增：ECDSA P-256 非对称签名（v5）
//  - 私钥仅云端持有（Cloudflare Secrets: LICENSE_SIGN_PRIVATE_KEY）
//  - 公钥嵌入客户端（license-manager.js + LicenseManager.java）
//  - 现有 v1/v2/v3/v4 HMAC 签名继续工作（向后兼容）
//  - 新 license 同时包含 v4 HMAC + v5 ECDSA 双签名
//  - 客户端优先验 ECDSA，失败 fallback HMAC（兼容旧 license）
// ============================================================================
const ECDSA_CURVE = 'P-256';  // alias: 'prime256v1' / 'secp256r1'
const ECDSA_HASH = 'SHA-256';

// 从环境变量读取 ECDSA 私钥（PEM 格式 PKCS#8）
// 在 Cloudflare Pages 后台设置环境变量 LICENSE_SIGN_PRIVATE_KEY
function getEcdsaPrivateKeyPem(context) {
    if (context && context.env && context.env.LICENSE_SIGN_PRIVATE_KEY) {
        return context.env.LICENSE_SIGN_PRIVATE_KEY;
    }
    if (typeof process !== 'undefined' && process.env && process.env.LICENSE_SIGN_PRIVATE_KEY) {
        return process.env.LICENSE_SIGN_PRIVATE_KEY;
    }
    return null;  // 未配置 ECDSA 私钥时跳过 v5 签名
}

// 从 PEM 提取 base64 DER（去掉 BEGIN/END 头）
function pemToDer(pem) {
    return pem.replace(/-----BEGIN [A-Z ]+-----/g, '')
              .replace(/-----END [A-Z ]+-----/g, '')
              .replace(/\s+/g, '');
}

// base64 → Uint8Array
function base64ToBytes(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
}

// 用 ECDSA P-256 私钥签名消息，返回 hex
async function ecdsaSign(message, privateKeyPem) {
    if (!privateKeyPem) throw new Error('ECDSA 私钥未配置');
    const derB64 = pemToDer(privateKeyPem);
    const derBytes = base64ToBytes(derB64);

    const key = await crypto.subtle.importKey(
        'pkcs8',
        derBytes,
        { name: 'ECDSA', namedCurve: ECDSA_CURVE },
        false,
        ['sign']
    );
    const sig = await crypto.subtle.sign(
        { name: 'ECDSA', hash: ECDSA_HASH },
        key,
        strToBytes(message)
    );
    // ECDSA 签名输出为 raw r||s 格式（Web Crypto 默认），转 hex
    return bytesToHex(new Uint8Array(sig));
}

// ★ v5 签名内容：与 v3 相同的字段（user|type|issuedAt|expiresAt|maxPrescriptions|features|clinicName|machineId|licenseBinding）
// 但用 ECDSA P-256 而非 HMAC。验签时用同样的 content。
async function generateSignatureV5(data, privateKeyPem) {
    const content = [
        data.user,
        data.type,
        data.issuedAt,
        data.expiresAt,
        String(data.maxPrescriptions !== undefined ? data.maxPrescriptions : 0),
        Array.isArray(data.features) ? data.features.join(',') : '',
        data.clinicName || '',
        data.machineId || '',
        data.licenseBinding || ''
    ].join('|');
    return ecdsaSign(content, privateKeyPem);
}

// ★ v2 签名：与客户端 generateSignature 一致
// 内容：user|type|issuedAt|expiresAt|maxPrescriptions|features
async function generateSignature(data, secret) {
    const content = [
        data.user,
        data.type,
        data.issuedAt,
        data.expiresAt,
        String(data.maxPrescriptions !== undefined ? data.maxPrescriptions : 0),
        Array.isArray(data.features) ? data.features.join(',') : ''
    ].join('|');
    return hmacSign(content, secret || LICENSE_HMAC_KEY);
}

// ★ v3 签名：在 v2 基础上增加 clinicName/machineId/licenseBinding 三个绑定字段
// 内容：user|type|issuedAt|expiresAt|maxPrescriptions|features|clinicName|machineId|licenseBinding
// 仅当 clinicName/machineId/licenseBinding 同时存在时才使用 v3 签名
async function generateSignatureV3(data, secret) {
    const content = [
        data.user,
        data.type,
        data.issuedAt,
        data.expiresAt,
        String(data.maxPrescriptions !== undefined ? data.maxPrescriptions : 0),
        Array.isArray(data.features) ? data.features.join(',') : '',
        data.clinicName || '',
        data.machineId || '',
        data.licenseBinding || ''
    ].join('|');
    return hmacSign(content, secret || LICENSE_HMAC_KEY);
}

// ★ 统一签名生成入口：自动选择 v3 / v2
// 含 clinicName + machineId + licenseBinding → v3，否则 → v2
async function generateSignatureAuto(data, secret) {
    if (data.clinicName && data.machineId && data.licenseBinding) {
        return generateSignatureV3(data, secret);
    }
    return generateSignature(data, secret);
}

// ============================================================================
//  激活码生成
// ============================================================================
// 生成单个随机字符
function randomChar() {
    const bytes = crypto.getRandomValues(new Uint8Array(1));
    return ACTIVATION_CODE_CHARS[bytes[0] % ACTIVATION_CODE_CHARS.length];
}

// 生成一组 4 字符
function randomGroup() {
    let group = '';
    for (let i = 0; i < ACTIVATION_CODE_GROUP_LENGTH; i++) {
        group += randomChar();
    }
    return group;
}

// 生成完整激活码：BNZC-XXXX-XXXX-XXXX-XXXX
function generateActivationCode() {
    const groups = [ACTIVATION_CODE_PREFIX];
    for (let i = 0; i < ACTIVATION_CODE_GROUPS; i++) {
        groups.push(randomGroup());
    }
    return groups.join('-');
}

// ============================================================================
//  license 数据组装（与客户端 license.dat 格式一致）
// ============================================================================
// 根据激活码记录生成 license 数据（用于 validate API 返回给客户端）
// ★ v3 新增：options.clinicName + options.machineId + options.licenseBinding
// 三者同时存在时启用 v3 签名（含绑定字段），否则走 v2 签名（向后兼容）
// ★ v4 新增：options.maxDevices + options.devicesCount（多设备授权，仅显示用，不参与签名）
// ★ 新增：支持通过 options.secret 或 options.context 传入动态密钥（环境变量）
async function buildLicenseData(record, options = {}) {
    const config = LICENSE_TYPE_CONFIG[record.type] || LICENSE_TYPE_CONFIG.personal;
    const maxPrescriptions = record.maxPrescriptions !== undefined ? record.maxPrescriptions : config.maxPrescriptions;
    const features = record.features || config.features;

    // 计算到期时间
    let expiresAt;
    if (record.expiresAt) {
        // 已指定到期时间，直接使用
        expiresAt = new Date(record.expiresAt).toISOString();
    } else if (record.days && record.days > 0) {
        // 按天数计算（从激活时刻开始）
        expiresAt = new Date(Date.now() + record.days * 24 * 60 * 60 * 1000).toISOString();
    } else {
        // 默认 1 年
        expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    }

    const data = {
        user: record.user || record.username || 'user',
        type: record.type,
        issuedAt: new Date().toISOString(),
        expiresAt: expiresAt,
        maxPrescriptions: maxPrescriptions,
        features: features
    };

    // ★ v3 新增：绑定字段（clinicName/machineId/licenseBinding）
    // 由 validate API 从客户端请求中传入，写入 license 实现三因子绑定
    if (options.clinicName && options.machineId) {
        data.clinicName = options.clinicName;
        data.machineId = options.machineId;
        data.licenseBinding = options.licenseBinding || 'clinic+user+machine';
    }

    // ★ v4 新增：多设备授权信息（仅显示用，不参与签名）
    // 客户端激活成功后可显示"已绑定 X/N 台设备"
    if (options.maxDevices !== undefined) {
        data.maxDevices = options.maxDevices;
        data.devicesCount = options.devicesCount || 1;
    }

    // ★ 自动选择 v3 / v2 签名
    // 优先使用 options.secret，否则从 options.context 读取环境变量（含 masterKey 派生逻辑）
    const secret = options.secret || (options.context ? await getLicenseHmacKey(options.context) : undefined);
    data.signature = await generateSignatureAuto(data, secret);

    // ★ 任务2 新增：附加 v5 ECDSA 签名（如果配置了 ECDSA 私钥）
    // 仅在配置了 LICENSE_SIGN_PRIVATE_KEY 环境变量时启用
    // 客户端优先验 v5，失败 fallback v3/v4 HMAC（向后兼容）
    if (options.context) {
        const ecdsaPrivateKey = getEcdsaPrivateKeyPem(options.context);
        if (ecdsaPrivateKey) {
            try {
                data.signatureV5 = await generateSignatureV5(data, ecdsaPrivateKey);
                data.signatureVersion = 5;
                console.log('[License] 已附加 v5 ECDSA 签名');
            } catch (e) {
                console.warn('[License] v5 ECDSA 签名失败（降级为 HMAC）:', e.message);
            }
        }
    }

    // ★ P1 安全分发优化：附加 masterKey（如果云端配置了 LICENSE_MASTER_KEY）
    // 用途：客户端运行时派生 HMAC/CONFIG_SIGN 密钥，避免硬编码
    // 注意：masterKey 不参与签名内容（在签名计算后添加），不影响验签逻辑
    // 未配置时不下发，客户端 fallback 到硬编码 LICENSE_HMAC_KEY（向后兼容）
    if (options.context) {
        const masterKey = getLicenseMasterKey(options.context);
        if (masterKey) {
            data.masterKey = masterKey;
            console.log('[License] 已附加 masterKey（客户端将派生动态密钥）');
        }
    }
    return data;
}

// 将 license 数据编码为 base64（客户端写入 license.dat 的格式）
function encodeLicenseBase64(data) {
    const json = JSON.stringify(data, null, 2);
    return btoa(String.fromCharCode(...new Uint8Array(strToBytes(json))));
}

// ============================================================================
//  KV 存储操作
// ============================================================================
function getKV(context) {
    return context.env.KV ||
           context.env.TCM_PRESCRIPTION_KV ||
           context.env['tcm-prescription-kv'] ||
           context.env['TCM-PRESCRIPTION-KV'] ||
           context.env.TCM_KV ||
           context.env.PRESCRIPTION_KV;
}

// 保存激活码到 KV
async function saveLicense(kv, record) {
    const key = KV_LICENSE_PREFIX + record.code;
    await kv.put(key, JSON.stringify(record));

    // 更新索引
    const index = (await kv.get(KV_LICENSE_INDEX, 'json')) || [];
    if (!index.includes(record.code)) {
        index.push(record.code);
        await kv.put(KV_LICENSE_INDEX, JSON.stringify(index));
    }
}

// 从 KV 读取激活码
async function getLicense(kv, code) {
    const key = KV_LICENSE_PREFIX + code;
    return await kv.get(key, 'json');
}

// 更新激活码（部分字段）
async function updateLicense(kv, code, updates) {
    const record = await getLicense(kv, code);
    if (!record) return null;
    const updated = { ...record, ...updates };
    await saveLicense(kv, updated);
    return updated;
}

// 列出所有激活码
async function listLicenses(kv) {
    const index = (await kv.get(KV_LICENSE_INDEX, 'json')) || [];
    const records = [];
    for (const code of index) {
        const record = await getLicense(kv, code);
        if (record) records.push(record);
    }
    return records;
}

// 隐藏敏感字段，返回安全的记录对象
// ★ v4 新增：maxDevices + devices 数组（多设备授权）
function sanitizeRecord(record) {
    const devices = getDevices(record);
    return {
        code: record.code,
        user: record.user || record.username,
        type: record.type,
        days: record.days,
        issuedAt: record.issuedAt,
        activatedAt: record.activatedAt,
        expiresAt: record.expiresAt,
        clinicName: record.clinicName || null,  // ★ v3 新增：绑定诊所名
        machineId: record.machineId ? record.machineId.substring(0, 8) + '...' : null,  // 仅显示前 8 位
        status: record.status,
        maxPrescriptions: record.maxPrescriptions,
        features: record.features,
        note: record.note || '',
        // ★ v4 新增：多设备授权字段
        maxDevices: record.maxDevices !== undefined ? record.maxDevices : 1,  // 默认 1（向后兼容旧激活码）
        devicesCount: devices.length,                                           // 已绑定设备数
        devices: devices.map(d => ({                                           // 已绑定设备列表（脱敏）
            machineId: d.machineId ? d.machineId.substring(0, 8) + '...' : null,
            activatedAt: d.activatedAt || null,
            clinicName: d.clinicName || null
        }))
    };
}

// ★ v4 新增：获取激活码已绑定的设备数组（向后兼容旧 record.machineId 单值字段）
// 旧格式：record.machineId（单值）→ 返回 [{ machineId, activatedAt, clinicName }]
// 新格式：record.devices（数组）→ 直接返回
// 混合格式：优先 devices，若为空则从 machineId 转换
function getDevices(record) {
    if (!record) return [];
    // 新格式：devices 数组
    if (Array.isArray(record.devices) && record.devices.length > 0) {
        return record.devices;
    }
    // 旧格式：machineId 单值 → 转换为单元素数组
    if (record.machineId) {
        return [{
            machineId: record.machineId,
            activatedAt: record.activatedAt,
            clinicName: record.activatedClinicName || record.clinicName
        }];
    }
    return [];
}

// ★ v4 新增：获取激活码的最大设备数（默认 1，向后兼容）
function getMaxDevices(record) {
    if (!record) return 1;
    const n = parseInt(record.maxDevices, 10);
    if (isNaN(n) || n < 1) return 1;
    if (n > 10) return 10;  // 上限 10 台
    return n;
}

// ============================================================================
//  ★ 操作日志（任务5 新增）：记录每个激活码的所有操作历史
//  KV key: license_log:{code}，值为 JSON 数组
//  每条记录：{ action, time, ip, operator, detail }
//  最多保留 200 条（防止无限增长），FIFO 队列
// ============================================================================
const KV_LICENSE_LOG_PREFIX = 'license_log:';
const LICENSE_LOG_MAX_ENTRIES = 200;

// 追加操作日志（fire-and-forget，不阻塞主流程）
async function appendLicenseLog(kv, code, entry) {
    if (!kv || !code || !entry || !entry.action) return;
    try {
        const logKey = KV_LICENSE_LOG_PREFIX + code;
        const logs = (await kv.get(logKey, 'json')) || [];
        // 补全字段
        const logEntry = {
            action: entry.action,
            time: entry.time || new Date().toISOString(),
            ip: entry.ip || 'unknown',
            operator: entry.operator || 'system',
            detail: entry.detail || ''
        };
        logs.push(logEntry);
        // 超过上限时丢弃最旧的（FIFO）
        if (logs.length > LICENSE_LOG_MAX_ENTRIES) {
            logs.splice(0, logs.length - LICENSE_LOG_MAX_ENTRIES);
        }
        await kv.put(logKey, JSON.stringify(logs));
    } catch (e) {
        console.warn('[LicenseLog] 追加日志失败:', e.message);
    }
}

// 查询激活码操作日志
async function getLicenseLogs(kv, code) {
    if (!kv || !code) return [];
    try {
        const logKey = KV_LICENSE_LOG_PREFIX + code;
        const logs = (await kv.get(logKey, 'json')) || [];
        // 按时间倒序（最新的在前）
        return logs.slice().reverse();
    } catch (e) {
        console.warn('[LicenseLog] 查询日志失败:', e.message);
        return [];
    }
}

// 删除激活码日志（删除激活码时同步清理）
async function deleteLicenseLogs(kv, code) {
    if (!kv || !code) return;
    try {
        await kv.delete(KV_LICENSE_LOG_PREFIX + code);
    } catch (e) {
        console.warn('[LicenseLog] 删除日志失败:', e.message);
    }
}

// ============================================================================
//  速率限制（简单 KV 实现，防止暴力破解）
// ============================================================================
// 记录 IP 的校验请求次数
async function checkRateLimit(kv, ip, maxPerHour = 5) {
    const key = `ratelimit:license:${ip}:${Math.floor(Date.now() / (60 * 60 * 1000))}`;
    const current = parseInt(await kv.get(key) || '0', 10);
    if (current >= maxPerHour) {
        return { allowed: false, current, max: maxPerHour };
    }
    await kv.put(key, String(current + 1), { expirationTtl: 3600 });
    return { allowed: true, current: current + 1, max: maxPerHour };
}

// ============================================================================
//  导出
// ============================================================================
export {
    LICENSE_HMAC_KEY,
    LICENSE_TYPE_CONFIG,
    ACTIVATION_CODE_CHARS,
    KV_LICENSE_PREFIX,
    KV_LICENSE_INDEX,
    generateActivationCode,
    generateSignature,
    generateSignatureV3,
    generateSignatureAuto,
    buildLicenseData,
    encodeLicenseBase64,
    getKV,
    saveLicense,
    getLicense,
    updateLicense,
    listLicenses,
    sanitizeRecord,
    checkRateLimit,
    getDevices,        // ★ v4 新增：获取激活码已绑定的设备数组
    getMaxDevices,     // ★ v4 新增：获取激活码的最大设备数
    // ★ 任务5 新增：操作日志
    appendLicenseLog,  // 追加激活码操作日志
    getLicenseLogs,    // 查询激活码操作日志
    deleteLicenseLogs, // 删除激活码日志（删激活码时调用）
    // ★ 任务2 新增：ECDSA P-256 非对称签名
    ecdsaSign,              // 用 ECDSA 私钥签名消息
    generateSignatureV5,    // 生成 v5 签名（ECDSA P-256）
    getEcdsaPrivateKeyPem,    // 从环境变量读取 ECDSA 私钥（PEM 格式）
    // ★ P1 安全分发优化：masterKey 下发
    getLicenseMasterKey     // 从环境变量读取 LICENSE_MASTER_KEY（可选，未配置返回 null）
};
