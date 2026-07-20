// ============================================================================
//  license-manager.js — 授权管理模块（v2 支持版本分级）
//  功能：license 文件校验 + 试用模式 + 防时间回拨 + 版本分级
//  方案：HMAC-SHA256 签名 + XOR 混淆（简单高效，配合 asarmor 增加逆向难度）
//  v2 新增：type (trial/personal/pro) + maxPrescriptions + features
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

// ★ HMAC 密钥（混淆用，配合 asarmor 增加逆向难度）
const LICENSE_HMAC_KEY = 'bnzc_tcm_license_key_v1_2026';
const DEFAULT_TRIAL_DAYS = 7;                                 // 默认试用期 7 天（可通过 trial-config.json 修改，测试时设为 0）
const TIME_TAMPER_THRESHOLD = 24 * 60 * 60 * 1000;           // 时间回拨阈值：1 天

const TRIAL_KEY = 'bnzc_trial_key_v1';
const LASTRUN_KEY = 'bnzc_lastrun_key_v1';

// ★ v2: 版本类型默认配置（功能差异矩阵）
// trial: 试用版，限 30 张/月处方，无高级功能
// personal: 个人版，无限处方，支持数据备份
// pro: 专业版，无限处方，支持云端同步+多设备+优先支持
const LICENSE_TYPE_CONFIG = {
    trial: {
        maxPrescriptions: 30,
        features: []  // 试用版无高级功能
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

// ============================================================================
//  路径工具
// ============================================================================
function getExeDirectory() {
    try {
        if (process.env.PORTABLE_EXECUTABLE_DIR) {
            return process.env.PORTABLE_EXECUTABLE_DIR;
        }
        return path.dirname(app.getPath('exe'));
    } catch (e) {
        return app.getPath('userData');
    }
}

function getLicensePath() {
    try {
        return path.join(getExeDirectory(), 'license.dat');
    } catch (e) {
        return path.join(app.getPath('userData'), 'license.dat');
    }
}

function getTrialPath() {
    return path.join(app.getPath('userData'), 'trial.dat');
}

// ★ 试用期配置文件路径（与 license.dat 同目录，portable 友好）
function getTrialConfigPath() {
    try {
        return path.join(getExeDirectory(), 'trial-config.json');
    } catch (e) {
        return path.join(app.getPath('userData'), 'trial-config.json');
    }
}

// ★ 获取试用期天数（可配置，默认 7 天，测试时可设为 0 天立即触发激活）
function getTrialDays() {
    try {
        const configPath = getTrialConfigPath();
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (typeof config.trialDays === 'number' && config.trialDays >= 0 && config.trialDays <= 365) {
                return config.trialDays;
            }
        }
    } catch (e) { /* 忽略，使用默认值 */ }
    return DEFAULT_TRIAL_DAYS;
}

// ★ 设置试用期天数（持久化到 trial-config.json，重启后生效）
function setTrialDays(days) {
    try {
        const parsed = parseInt(days, 10);
        if (isNaN(parsed) || parsed < 0 || parsed > 365) {
            return { success: false, error: '试用期天数必须在 0-365 之间' };
        }
        const configPath = getTrialConfigPath();
        const config = { trialDays: parsed, updatedAt: new Date().toISOString() };
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
        return { success: true, trialDays: parsed, configPath: configPath };
    } catch (e) {
        return { success: false, error: String(e) };
    }
}

function getLastRunPath() {
    return path.join(app.getPath('userData'), 'last-run.dat');
}

// ============================================================================
//  XOR 混淆（用于 trial.dat 和 last-run.dat，防止用户直接查看/篡改）
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
//  HMAC 签名（用于 license.dat 完整性校验）
//  v2: 签名包含 type/maxPrescriptions/features，防篡改版本分级
//  向后兼容：旧版 license（无 maxPrescriptions/features）用 v1 签名逻辑验证
// ============================================================================
function generateSignature(data) {
    // 签名内容包含所有关键字段，任一字段被篡改都会导致签名不匹配
    const content = [
        data.user,
        data.type,
        data.issuedAt,
        data.expiresAt,
        String(data.maxPrescriptions !== undefined ? data.maxPrescriptions : 0),
        Array.isArray(data.features) ? data.features.join(',') : ''
    ].join('|');
    return crypto.createHmac('sha256', LICENSE_HMAC_KEY).update(content).digest('hex');
}

// v1 签名逻辑（向后兼容旧版 license）
function generateSignatureV1(data) {
    const content = [data.user, data.type, data.issuedAt, data.expiresAt].join('|');
    return crypto.createHmac('sha256', LICENSE_HMAC_KEY).update(content).digest('hex');
}

function verifySignature(data) {
    if (!data.signature) return false;
    // v2 签名校验
    const expectedV2 = generateSignature(data);
    try {
        if (crypto.timingSafeEqual(Buffer.from(data.signature, 'hex'), Buffer.from(expectedV2, 'hex'))) {
            return true;
        }
    } catch (e) { /* 长度不匹配，继续尝试 v1 */ }
    // v1 签名向后兼容（旧版 license 无 maxPrescriptions/features 字段）
    if (data.maxPrescriptions === undefined && !Array.isArray(data.features)) {
        const expectedV1 = generateSignatureV1(data);
        try {
            return crypto.timingSafeEqual(Buffer.from(data.signature, 'hex'), Buffer.from(expectedV1, 'hex'));
        } catch (e) {
            return data.signature === expectedV1;
        }
    }
    return data.signature === expectedV2;
}

// ============================================================================
//  文件读写
// ============================================================================
function readLicense() {
    try {
        const licensePath = getLicensePath();
        if (!fs.existsSync(licensePath)) return null;
        const content = fs.readFileSync(licensePath, 'utf8').trim();
        const json = Buffer.from(content, 'base64').toString('utf8');
        return JSON.parse(json);
    } catch (e) {
        console.error('[License] 读取 license 文件失败:', e.message);
        return null;
    }
}

function readTrial() {
    try {
        const trialPath = getTrialPath();
        if (!fs.existsSync(trialPath)) return null;
        const content = fs.readFileSync(trialPath, 'utf8').trim();
        const json = xorDecrypt(content, TRIAL_KEY);
        if (!json) return null;
        return JSON.parse(json);
    } catch (e) {
        return null;
    }
}

function writeTrial(data) {
    try {
        const trialPath = getTrialPath();
        const json = JSON.stringify(data);
        const encrypted = xorEncrypt(json, TRIAL_KEY);
        fs.writeFileSync(trialPath, encrypted, 'utf8');
    } catch (e) {
        console.error('[License] 写入 trial 文件失败:', e.message);
    }
}

function readLastRun() {
    try {
        const lastRunPath = getLastRunPath();
        if (!fs.existsSync(lastRunPath)) return null;
        const content = fs.readFileSync(lastRunPath, 'utf8').trim();
        const json = xorDecrypt(content, LASTRUN_KEY);
        if (!json) return null;
        return JSON.parse(json);
    } catch (e) {
        return null;
    }
}

function writeLastRun(data) {
    try {
        const lastRunPath = getLastRunPath();
        const json = JSON.stringify(data);
        const encrypted = xorEncrypt(json, LASTRUN_KEY);
        fs.writeFileSync(lastRunPath, encrypted, 'utf8');
    } catch (e) {
        console.error('[License] 写入 last-run 文件失败:', e.message);
    }
}

// ============================================================================
//  版本类型规范化（兼容旧版 license 无 type/maxPrescriptions/features 字段）
// ============================================================================
function normalizeLicense(license) {
    if (!license) return null;
    const config = LICENSE_TYPE_CONFIG[license.type] || LICENSE_TYPE_CONFIG.personal;
    return {
        user: license.user || '',
        type: license.type || 'personal',
        issuedAt: license.issuedAt,
        expiresAt: license.expiresAt,
        // v2 新字段（旧版 license 缺失时用默认值）
        maxPrescriptions: license.maxPrescriptions !== undefined ? license.maxPrescriptions : config.maxPrescriptions,
        features: Array.isArray(license.features) ? license.features : config.features,
        signature: license.signature
    };
}

// ============================================================================
//  校验主逻辑
// ============================================================================
function validateLicense() {
    const now = Date.now();

    // 1. 检查时间回拨（防止用户修改系统时间延长试用/授权）
    const lastRun = readLastRun();
    if (lastRun && lastRun.timestamp) {
        const diff = now - lastRun.timestamp;
        if (diff < -TIME_TAMPER_THRESHOLD) {
            return {
                valid: false,
                message: '检测到系统时间异常（时间回拨），软件已锁定。\n请恢复系统时间后重启，或联系客服重新激活。',
                type: 'tampered'
            };
        }
    }

    // 2. 尝试读取 license 文件（正式授权）
    const rawLicense = readLicense();
    if (rawLicense) {
        // 先用原始字段验证签名（保留向后兼容：旧版 license 走 v1 签名）
        if (!verifySignature(rawLicense)) {
            return {
                valid: false,
                message: '授权文件已损坏或被篡改，请联系客服重新激活。',
                type: 'tampered'
            };
        }

        // 签名验证通过后，规范化字段（补全 v2 新字段默认值）
        const license = normalizeLicense(rawLicense);

        // 校验到期时间
        const expiresAtMs = new Date(license.expiresAt).getTime();
        if (isNaN(expiresAtMs)) {
            return {
                valid: false,
                message: '授权文件格式错误，请联系客服。',
                type: 'invalid'
            };
        }

        if (now > expiresAtMs) {
            return {
                valid: false,
                message: `授权已过期。\n用户：${license.user}\n到期时间：${license.expiresAt}\n请联系客服续费。`,
                type: 'expired',
                license: license
            };
        }

        // license 有效
        writeLastRun({ timestamp: now });
        const remainingDays = Math.ceil((expiresAtMs - now) / (24 * 60 * 60 * 1000));
        return {
            valid: true,
            message: `授权有效\n用户：${license.user}\n类型：${license.type}\n到期：${license.expiresAt}\n剩余：${remainingDays} 天`,
            type: 'licensed',
            licenseType: license.type,           // v2: 版本类型
            maxPrescriptions: license.maxPrescriptions,  // v2: 处方数量限制
            features: license.features,          // v2: 功能列表
            license: license,
            remainingDays: remainingDays
        };
    }

    // 3. 没有 license 文件，进入试用模式
    let trial = readTrial();
    const currentTrialDays = getTrialDays();   // ★ 当前配置的试用期天数
    if (!trial) {
        trial = {
            startTime: now,
            expiresAt: now + currentTrialDays * 24 * 60 * 60 * 1000
        };
        writeTrial(trial);
    } else if (currentTrialDays === 0) {
        // ★ 配置为 0 天时，立即过期（测试用）
        trial.expiresAt = trial.startTime;
        writeTrial(trial);
    } else {
        // ★ 配置变化时，重新计算 expiresAt（保留 startTime）
        const expectedExpiresAt = trial.startTime + currentTrialDays * 24 * 60 * 60 * 1000;
        if (trial.expiresAt !== expectedExpiresAt) {
            trial.expiresAt = expectedExpiresAt;
            writeTrial(trial);
        }
    }

    // 校验试用到期
    const trialExpiresAtMs = trial.expiresAt || (trial.startTime + currentTrialDays * 24 * 60 * 60 * 1000);
    if (now > trialExpiresAtMs) {
        return {
            valid: false,
            message: `试用期已到期（${currentTrialDays} 天）。\n请联系客服购买正式授权。`,
            type: 'trial_expired',
            trial: trial
        };
    }

    // 试用有效（v2: 试用版也有处方数量限制）
    writeLastRun({ timestamp: now });
    const remainingDays = Math.ceil((trialExpiresAtMs - now) / (24 * 60 * 60 * 1000));
    return {
        valid: true,
        message: `试用模式（剩余 ${remainingDays} 天）\n请联系客服购买正式授权。`,
        type: 'trial',
        licenseType: 'trial',                   // v2: 试用版类型
        maxPrescriptions: LICENSE_TYPE_CONFIG.trial.maxPrescriptions,  // v2: 30 张/月
        features: LICENSE_TYPE_CONFIG.trial.features,
        trial: { ...trial, remainingDays },
        remainingDays: remainingDays
    };
}

// ============================================================================
//  生成 license（v2 支持版本分级字段）
// ============================================================================
function generateLicense(user, type, expiresAt, options) {
    options = options || {};
    const config = LICENSE_TYPE_CONFIG[type] || LICENSE_TYPE_CONFIG.personal;
    const data = {
        user: String(user || ''),
        type: String(type || 'personal'),   // trial / personal / pro
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
        // v2 新字段：允许 options 覆盖默认配置
        maxPrescriptions: options.maxPrescriptions !== undefined ? options.maxPrescriptions : config.maxPrescriptions,
        features: Array.isArray(options.features) ? options.features : config.features
    };
    data.signature = generateSignature(data);
    const json = JSON.stringify(data);
    return Buffer.from(json, 'utf8').toString('base64');
}

// 写入 license 文件（供激活码导入使用）
function writeLicenseContent(base64Content) {
    try {
        const licensePath = getLicensePath();
        fs.writeFileSync(licensePath, base64Content.trim(), 'utf8');
        return { success: true, path: licensePath };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// ★ v2: 检查功能权限（供 feature-guard.js 使用）
function hasFeature(featureName) {
    const license = readLicense();
    if (!license) return false;
    // 先用原始字段验证签名（向后兼容旧版 license）
    if (!verifySignature(license)) return false;
    const normalized = normalizeLicense(license);
    return Array.isArray(normalized.features) && normalized.features.indexOf(featureName) !== -1;
}

// ★ v2: 获取当前版本类型
function getLicenseType() {
    const license = readLicense();
    if (!license) return 'trial';  // 无 license 视为试用
    // 先用原始字段验证签名（向后兼容旧版 license）
    if (!verifySignature(license)) return 'trial';
    const normalized = normalizeLicense(license);
    return normalized.type || 'personal';
}

module.exports = {
    validateLicense,
    generateLicense,
    readLicense,
    writeLicenseContent,
    getLicensePath,
    hasFeature,           // v2 新增
    getLicenseType,       // v2 新增
    normalizeLicense,     // v2 新增
    LICENSE_TYPE_CONFIG,  // v2 新增
    DEFAULT_TRIAL_DAYS,   // 默认试用期 7 天
    getTrialDays,         // ★ 获取试用期天数（可配置）
    setTrialDays          // ★ 设置试用期天数（持久化）
};
