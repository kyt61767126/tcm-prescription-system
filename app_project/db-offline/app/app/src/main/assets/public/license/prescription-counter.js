// ============================================================================
//  prescription-counter.js — 处方数量计数器（v3 AES 加密版）
//  功能：按月统计处方数量，试用版限制 30 张/月，超过则拒绝保存
//  存储：userData/prescription-count.dat（AES-256-CBC + HMAC 签名）
//  调用：渲染进程通过 IPC 调用 canPrescribe()/increment()/getStatus()
//
//  ★ P0 修复：从 XOR 混淆升级到 AES-256-CBC + HMAC 签名
//    - 旧版 XOR 密钥硬编码，攻击者可直接篡改计数绕过试用限制
//    - 新版使用 machineId 派生密钥，HMAC 防篡改
//    - 自动迁移旧 XOR 格式（首次读取时升级）
//    - machineId 不可用时降级到 XOR（极端情况向后兼容）
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const licenseManager = require('./license-manager');

const COUNT_KEY = 'bnzc_prescription_count_v1';
const COUNT_FILE = 'prescription-count.dat';
const ENC2_PREFIX = 'ENC2:';

// ============================================================================
//  旧版 XOR 混淆（向后兼容，用于读取旧格式和极端降级）
// ============================================================================
function xorEncrypt(text, key) {
    const buf = Buffer.from(text, 'utf8');
    const keyBuf = Buffer.from(key, 'utf8');
    const result = Buffer.alloc(buf.length);
    for (let i = 0; i < buf.length; i++) {
        result[i] = buf[i] ^ keyBuf[i % keyBuf.length];
    }
    return result.toString('base64');
}

function xorDecrypt(base64, key) {
    try {
        const buf = Buffer.from(base64, 'base64');
        const keyBuf = Buffer.from(key, 'utf8');
        const result = Buffer.alloc(buf.length);
        for (let i = 0; i < buf.length; i++) {
            result[i] = buf[i] ^ keyBuf[i % keyBuf.length];
        }
        return result.toString('utf8');
    } catch (e) {
        return null;
    }
}

// ============================================================================
//  ★ v3 新版：AES-256-CBC + HMAC 签名
// ============================================================================
function getMachineId() {
    try {
        return licenseManager.getMachineId();
    } catch (e) {
        return null;
    }
}

function deriveKey(machineId, salt) {
    return crypto.createHash('sha256').update(machineId + ':' + COUNT_KEY + ':' + salt).digest();
}

function aesEncrypt(text, machineId) {
    const key = deriveKey(machineId, 'count:v2');
    const hmacKey = deriveKey(machineId, 'hmac:v2');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const ivHex = iv.toString('hex');
    const encHex = encrypted.toString('hex');
    const hmac = crypto.createHmac('sha256', hmacKey).update(ivHex + ':' + encHex).digest('hex');
    return ENC2_PREFIX + ivHex + ':' + encHex + ':' + hmac;
}

function aesDecrypt(data, machineId) {
    try {
        const parts = data.split(':');
        if (parts.length !== 4 || parts[0] !== 'ENC2') return null;
        const ivHex = parts[1];
        const encHex = parts[2];
        const hmac = parts[3];

        const key = deriveKey(machineId, 'count:v2');
        const hmacKey = deriveKey(machineId, 'hmac:v2');
        const expectedHmac = crypto.createHmac('sha256', hmacKey).update(ivHex + ':' + encHex).digest('hex');

        // 常量时间比较防时序攻击
        if (hmac.length !== expectedHmac.length) return null;
        let diff = 0;
        for (let i = 0; i < hmac.length; i++) {
            diff |= hmac.charCodeAt(i) ^ expectedHmac.charCodeAt(i);
        }
        if (diff !== 0) return null;  // HMAC 校验失败

        const iv = Buffer.from(ivHex, 'hex');
        const encrypted = Buffer.from(encHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        return decrypted.toString('utf8');
    } catch (e) {
        return null;
    }
}

// ============================================================================
//  路径与文件读写
// ============================================================================
function getCountPath() {
    return path.join(app.getPath('userData'), COUNT_FILE);
}

function readCounts() {
    try {
        const countPath = getCountPath();
        if (!fs.existsSync(countPath)) return {};
        const content = fs.readFileSync(countPath, 'utf8').trim();

        // ★ v3：优先尝试 AES 解密
        const machineId = getMachineId();
        if (machineId && content.startsWith(ENC2_PREFIX)) {
            const json = aesDecrypt(content, machineId);
            if (json) {
                const data = JSON.parse(json);
                return (data && typeof data === 'object') ? data : {};
            }
            // AES 解密失败（可能是 machineId 变化或文件损坏），返回空
            console.error('[PrescriptionCounter] AES 解密失败，计数文件可能被篡改');
            return {};
        }

        // ★ 迁移：旧 XOR 格式 → 新 AES 格式
        const oldJson = xorDecrypt(content, COUNT_KEY);
        if (oldJson) {
            try {
                const data = JSON.parse(oldJson);
                if (data && typeof data === 'object') {
                    console.log('[PrescriptionCounter] 检测到旧 XOR 格式，自动迁移到 AES');
                    // 用新格式重新保存
                    writeCounts(data);
                    return data;
                }
            } catch (e) { /* JSON 解析失败，继续 */ }
        }

        return {};
    } catch (e) {
        console.error('[PrescriptionCounter] 读取计数失败:', e.message);
        return {};
    }
}

function writeCounts(counts) {
    try {
        const countPath = getCountPath();
        const json = JSON.stringify(counts);

        // ★ v3：使用 AES 加密
        const machineId = getMachineId();
        if (machineId) {
            const encrypted = aesEncrypt(json, machineId);
            fs.writeFileSync(countPath, encrypted, 'utf8');
        } else {
            // 极端降级：machineId 不可用时使用 XOR（向后兼容）
            const encrypted = xorEncrypt(json, COUNT_KEY);
            fs.writeFileSync(countPath, encrypted, 'utf8');
        }
    } catch (e) {
        console.error('[PrescriptionCounter] 写入计数失败:', e.message);
    }
}

// ============================================================================
//  月份工具
// ============================================================================
function getCurrentMonthKey() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return year + '-' + month;  // 例：2026-07
}

// ============================================================================
//  核心逻辑
// ============================================================================

// 获取当前月份的处方数量
function getCount(monthKey) {
    const key = monthKey || getCurrentMonthKey();
    const counts = readCounts();
    return counts[key] || 0;
}

// 获取当前 license 的处方限制（0 = 无限）
// ★ 第三轮终检 P1 修复（2026-08-16）：readLicense 只解密不验签，maxPrescriptions
//   字段可被篡改（如改为 0=无限）。现使用前必须 verifySignature，验签失败
//   或无 license 一律按试用限制处理（fail-closed）。
function getMaxPrescriptions() {
    const license = licenseManager.readLicense();
    if (!license) {
        // 无 license，试用模式
        return licenseManager.LICENSE_TYPE_CONFIG.trial.maxPrescriptions;
    }
    try {
        if (typeof licenseManager.verifySignature === 'function' && !licenseManager.verifySignature(license)) {
            console.warn('[PrescriptionCounter] license 验签失败，按试用限制处理');
            return licenseManager.LICENSE_TYPE_CONFIG.trial.maxPrescriptions;
        }
    } catch (e) {
        console.warn('[PrescriptionCounter] license 验签异常，按试用限制处理:', e.message);
        return licenseManager.LICENSE_TYPE_CONFIG.trial.maxPrescriptions;
    }
    const normalized = licenseManager.normalizeLicense(license);
    return normalized.maxPrescriptions;
}

// 检查是否可以开处方（试用版超限则拒绝）
// 返回 { allowed: boolean, current: number, max: number, remaining: number }
function canPrescribe() {
    const current = getCount();
    const max = getMaxPrescriptions();
    if (max === 0) {
        // 0 = 无限
        return { allowed: true, current: current, max: 0, remaining: -1 };
    }
    const remaining = Math.max(0, max - current);
    return {
        allowed: current < max,
        current: current,
        max: max,
        remaining: remaining
    };
}

// 处方保存成功后自增计数
function increment() {
    const key = getCurrentMonthKey();
    const counts = readCounts();
    counts[key] = (counts[key] || 0) + 1;
    writeCounts(counts);
    return counts[key];
}

// 处方删除后自减计数（不跨月递减，仅当本月删除时才减）
function decrement() {
    const key = getCurrentMonthKey();
    const counts = readCounts();
    if (counts[key] && counts[key] > 0) {
        counts[key]--;
        writeCounts(counts);
    }
    return counts[key] || 0;
}

// 获取完整状态（供 UI 显示）
function getStatus() {
    const current = getCount();
    const max = getMaxPrescriptions();
    const licenseType = licenseManager.getLicenseType();
    return {
        current: current,
        max: max,
        remaining: max === 0 ? -1 : Math.max(0, max - current),
        licenseType: licenseType,
        month: getCurrentMonthKey()
    };
}

module.exports = {
    canPrescribe,
    increment,
    decrement,
    getCount,
    getMaxPrescriptions,
    getStatus,
    getCurrentMonthKey
};
