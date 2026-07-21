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
//    - offline_project/db-geren/electron/license-manager.js
//    - cloud_project/cloud_desktop/electron/license-manager.js
// ============================================================================

// ★ 必须与客户端 license-manager.js 中的 LICENSE_HMAC_KEY 保持一致
const LICENSE_HMAC_KEY = 'bnzc_tcm_license_key_v1_2026';

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

// ★ v2 签名：与客户端 generateSignature 一致
// 内容：user|type|issuedAt|expiresAt|maxPrescriptions|features
async function generateSignature(data) {
    const content = [
        data.user,
        data.type,
        data.issuedAt,
        data.expiresAt,
        String(data.maxPrescriptions !== undefined ? data.maxPrescriptions : 0),
        Array.isArray(data.features) ? data.features.join(',') : ''
    ].join('|');
    return hmacSign(content, LICENSE_HMAC_KEY);
}

// ★ v3 签名：在 v2 基础上增加 clinicName/machineId/licenseBinding 三个绑定字段
// 内容：user|type|issuedAt|expiresAt|maxPrescriptions|features|clinicName|machineId|licenseBinding
// 仅当 clinicName/machineId/licenseBinding 同时存在时才使用 v3 签名
async function generateSignatureV3(data) {
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
    return hmacSign(content, LICENSE_HMAC_KEY);
}

// ★ 统一签名生成入口：自动选择 v3 / v2
// 含 clinicName + machineId + licenseBinding → v3，否则 → v2
async function generateSignatureAuto(data) {
    if (data.clinicName && data.machineId && data.licenseBinding) {
        return generateSignatureV3(data);
    }
    return generateSignature(data);
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
    data.signature = await generateSignatureAuto(data);
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
    getMaxDevices      // ★ v4 新增：获取激活码的最大设备数
};
