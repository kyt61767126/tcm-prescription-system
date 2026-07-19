// ============================================================================
//  license-manager.js — 授权管理模块
//  功能：license 文件校验 + 试用模式 + 防时间回拨
//  方案：HMAC-SHA256 签名 + XOR 混淆（简单高效，配合 asarmor 增加逆向难度）
//  后续可升级为非对称签名（私钥生成，公钥验证）
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

// ★ HMAC 密钥（混淆用，配合 asarmor 增加逆向难度）
// 注意：此密钥会被打包到 asar 中，攻击者破解 asarmor 后可获取
// 这是"简单高效"方案的权衡，后续可升级为非对称签名
const LICENSE_HMAC_KEY = 'bnzc_tcm_license_key_v1_2026';
const TRIAL_DAYS = 7;                                        // 试用期 7 天
const TIME_TAMPER_THRESHOLD = 24 * 60 * 60 * 1000;           // 时间回拨阈值：1 天

const TRIAL_KEY = 'bnzc_trial_key_v1';
const LASTRUN_KEY = 'bnzc_lastrun_key_v1';

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

function getLastRunPath() {
    return path.join(app.getPath('userData'), 'last-run.dat');
}

// ============================================================================
//  XOR 混淆（用于 trial.dat 和 last-run.dat，防止用户直接查看/篡改）
//  注意：这不是安全加密，仅用于混淆。license.dat 用 HMAC 签名保证完整性。
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
// ============================================================================
function generateSignature(data) {
    const content = [data.user, data.type, data.issuedAt, data.expiresAt].join('|');
    return crypto.createHmac('sha256', LICENSE_HMAC_KEY).update(content).digest('hex');
}

function verifySignature(data) {
    if (!data.signature) return false;
    const expected = generateSignature(data);
    try {
        return crypto.timingSafeEqual(Buffer.from(data.signature, 'hex'), Buffer.from(expected, 'hex'));
    } catch (e) {
        return data.signature === expected;
    }
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
//  校验主逻辑
// ============================================================================
function validateLicense() {
    const now = Date.now();

    // 1. 检查时间回拨（防止用户修改系统时间延长试用/授权）
    const lastRun = readLastRun();
    if (lastRun && lastRun.timestamp) {
        const diff = now - lastRun.timestamp;
        if (diff < -TIME_TAMPER_THRESHOLD) {
            // 时间被回拨超过 1 天，判定为篡改
            return {
                valid: false,
                message: '检测到系统时间异常（时间回拨），软件已锁定。\n请恢复系统时间后重启，或联系客服重新激活。',
                type: 'tampered'
            };
        }
    }

    // 2. 尝试读取 license 文件（正式授权）
    const license = readLicense();
    if (license) {
        // 验证签名
        if (!verifySignature(license)) {
            return {
                valid: false,
                message: '授权文件已损坏或被篡改，请联系客服重新激活。',
                type: 'tampered'
            };
        }

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
            license: license,
            remainingDays: remainingDays
        };
    }

    // 3. 没有 license 文件，进入试用模式
    let trial = readTrial();
    if (!trial) {
        // 首次启动，记录试用开始时间
        trial = {
            startTime: now,
            expiresAt: now + TRIAL_DAYS * 24 * 60 * 60 * 1000
        };
        writeTrial(trial);
    }

    // 校验试用到期
    const trialExpiresAtMs = trial.expiresAt || (trial.startTime + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    if (now > trialExpiresAtMs) {
        return {
            valid: false,
            message: `试用期已到期（${TRIAL_DAYS} 天）。\n请联系客服购买正式授权。`,
            type: 'trial_expired',
            trial: trial
        };
    }

    // 试用有效
    writeLastRun({ timestamp: now });
    const remainingDays = Math.ceil((trialExpiresAtMs - now) / (24 * 60 * 60 * 1000));
    return {
        valid: true,
        message: `试用模式（剩余 ${remainingDays} 天）\n请联系客服购买正式授权。`,
        type: 'trial',
        trial: { ...trial, remainingDays },
        remainingDays: remainingDays
    };
}

// ============================================================================
//  生成 license（供 license-generator 工具使用）
// ============================================================================
function generateLicense(user, type, expiresAt) {
    const data = {
        user: String(user || ''),
        type: String(type || 'personal'),   // trial / personal / pro
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(expiresAt).toISOString()
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

module.exports = {
    validateLicense,
    generateLicense,
    readLicense,
    writeLicenseContent,
    getLicensePath,
    TRIAL_DAYS
};
