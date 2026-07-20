// ============================================================================
//  license-manager.js — 授权管理模块（v2 支持版本分级）
//  功能：license 文件校验 + 试用模式 + 防时间回拨 + 版本分级
//  方案：HMAC-SHA256 签名 + AES-256-CBC 加密存储（配合 asarmor 增加逆向难度）
//  v2 新增：type (trial/personal/pro) + maxPrescriptions + features
//  P2 优化：trial.dat / last-run.dat 从 XOR 升级为 AES-256-CBC 加密
//          不同文件使用不同盐派生密钥（防止一文件破解后所有文件被破解）
//          向后兼容：读取时若为旧 XOR 格式自动解密并迁移为 AES 格式
// ============================================================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

// ★ HMAC 密钥（混淆用，配合 asarmor 增加逆向难度）
const LICENSE_HMAC_KEY = 'bnzc_tcm_license_key_v1_2026';
const DEFAULT_TRIAL_DAYS = 7;                                 // 默认试用期 7 天（可通过 trial-config.json 修改，测试时设为 0）
const TIME_TAMPER_THRESHOLD = 24 * 60 * 60 * 1000;           // 时间回拨阈值：1 天

const TRIAL_KEY = 'bnzc_trial_key_v1';
const LASTRUN_KEY = 'bnzc_lastrun_key_v1';

// ★ v3 新增：config.json 完整性签名密钥（与 edit-config.ps1 中 $CONFIG_SIGN_KEY 保持一致）
// 用于校验 config.json 中的 clinicName/doctorName 未被篡改
const CONFIG_SIGN_KEY = 'bnzc_config_sign_key_v1_2026';

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

// ★ 设置试用期天数（持久化到 trial-config.json，并自动覆盖 trial.dat 即时生效）
// 修改配置后无需重启，trial.dat 立即按新配置更新 expiresAt（保留 startTime）
// 测试时设为 0 天 → trial.dat 立即过期，下次校验触发激活
function setTrialDays(days) {
    try {
        const parsed = parseInt(days, 10);
        if (isNaN(parsed) || parsed < 0 || parsed > 365) {
            return { success: false, error: '试用期天数必须在 0-365 之间' };
        }
        const configPath = getTrialConfigPath();
        const config = { trialDays: parsed, updatedAt: new Date().toISOString() };
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

        // ★ 同步覆盖更新 trial.dat，修改配置即时生效（无需重启）
        // 保留原 trial.startTime，按新配置重算 expiresAt
        // 若 trial.dat 不存在则按新配置创建
        // 若配置为 0 天，expiresAt = startTime 立即过期
        let trialSyncMsg = '';
        try {
            let trial = readTrial();
            const now = Date.now();
            if (!trial) {
                // 首次创建 trial.dat
                trial = {
                    startTime: now,
                    expiresAt: now + parsed * 24 * 60 * 60 * 1000
                };
                if (parsed === 0) trial.expiresAt = trial.startTime;
                trialSyncMsg = 'trial.dat 已创建';
            } else {
                // 保留 startTime，按新配置重算 expiresAt
                trial.expiresAt = trial.startTime + parsed * 24 * 60 * 60 * 1000;
                if (parsed === 0) trial.expiresAt = trial.startTime;
                trialSyncMsg = 'trial.dat 已同步更新';
            }
            writeTrial(trial);
            console.log('[License] setTrialDays:', trialSyncMsg, JSON.stringify(trial));
        } catch (e2) {
            console.warn('[License] setTrialDays 同步更新 trial.dat 失败:', e2.message);
            trialSyncMsg = 'trial.dat 同步失败：' + e2.message;
        }

        return { success: true, trialDays: parsed, configPath: configPath, trialSync: trialSyncMsg };
    } catch (e) {
        return { success: false, error: String(e) };
    }
}

function getLastRunPath() {
    return path.join(app.getPath('userData'), 'last-run.dat');
}

// ============================================================================
//  XOR 混淆（仅用于读取旧格式 trial.dat / last-run.dat，向后兼容）
//  ★ P2 优化后新文件不再使用 XOR，写入时改用 AES-256-CBC 加密
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
//  ★ P1-A 新增：AES-256-CBC 加密（用于 license.dat 存储加密）
//  方案：密钥从 machineId 派生，不同机器无法解密
//  文件格式：ENC1:base64(iv(16) + ciphertext)
//  旧格式：base64(JSON)（向后兼容，读取后自动迁移为加密格式）
//  ★ P3-A 增强：密钥派生追加硬件指纹（MachineGuid + 主板序列号 + CPU ID）
//              防止通过克隆虚拟机/复制镜像绕过 machineId 校验
//              旧 license.dat 仍可用（解密时双密钥尝试，新密钥失败回退旧密钥）
// ============================================================================

// 生成机器 ID（与 activate.js 中 getMachineId 逻辑完全一致）
// 复制到本文件是因为 license-manager.js 不能 require activate.js（循环依赖）
function getMachineId() {
    try {
        const exePath = process.execPath || app.getPath('exe');
        const hostname = os.hostname();
        const userInfo = os.userInfo();
        const username = userInfo.username;
        const platform = os.platform();
        const content = [exePath, hostname, username, platform].join('|');
        return crypto.createHash('sha256').update(content).digest('hex').substring(0, 32);
    } catch (e) {
        console.error('[License] 生成机器 ID 失败:', e);
        return '';
    }
}

// ★ P3-A 新增：获取硬件指纹（Windows MachineGuid + 主板序列号 + CPU ID）
// 缓存结果避免重复执行 WMIC 命令（执行约 100-500ms）
// 任一特征获取失败时跳过该特征，不影响其他特征
// 全部失败时返回空字符串（密钥派生降级为不含硬件指纹，兼容旧版）
let _hardwareFingerprintCache = null;
function getHardwareFingerprint() {
    if (_hardwareFingerprintCache !== null) return _hardwareFingerprintCache;
    try {
        const parts = [];
        const { execSync } = require('child_process');
        // 1. Windows MachineGuid（注册表，系统安装后不变，VM 克隆时变化）
        try {
            const out = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
                { timeout: 2000, windowsHide: true }).toString();
            const m = out.match(/MachineGuid\s+REG_SZ\s+([A-Fa-f0-9-]+)/i);
            if (m) parts.push('mg=' + m[1].toLowerCase());
        } catch (e) { /* 忽略 */ }
        // 2. 主板序列号（硬件固定，VM 克隆时可能为空或默认值）
        try {
            const out = execSync('wmic baseboard get serialnumber',
                { timeout: 2000, windowsHide: true }).toString();
            const lines = out.split('\n').map(s => s.trim())
                .filter(s => s && s.toLowerCase() !== 'serialnumber');
            if (lines.length > 0 && lines[0]) parts.push('bb=' + lines[0]);
        } catch (e) { /* 忽略 */ }
        // 3. CPU ID（硬件固定，VM 克隆时可能变化）
        try {
            const out = execSync('wmic cpu get processorid',
                { timeout: 2000, windowsHide: true }).toString();
            const lines = out.split('\n').map(s => s.trim())
                .filter(s => s && s.toLowerCase() !== 'processorid');
            if (lines.length > 0 && lines[0]) parts.push('cpu=' + lines[0]);
        } catch (e) { /* 忽略 */ }
        _hardwareFingerprintCache = parts.length === 0 ? '' :
            crypto.createHash('sha256').update(parts.join('|')).digest('hex');
    } catch (e) {
        _hardwareFingerprintCache = '';
    }
    return _hardwareFingerprintCache;
}

// ★ P3-A 新增：派生 AES-256 密钥（含硬件指纹）
// 新密钥 = SHA256(machineId + hardwareFingerprint + LICENSE_HMAC_KEY)
function deriveLicenseKey(machineId) {
    const hwFp = getHardwareFingerprint();
    const combined = (machineId || '') + (hwFp || '') + LICENSE_HMAC_KEY;
    return crypto.createHash('sha256').update(combined).digest();
}

// ★ P3-A 新增：旧密钥派生（不含硬件指纹，向后兼容旧 license.dat）
// 旧密钥 = SHA256(machineId + LICENSE_HMAC_KEY)
function deriveLicenseKeyLegacy(machineId) {
    const combined = (machineId || '') + LICENSE_HMAC_KEY;
    return crypto.createHash('sha256').update(combined).digest();
}

// ★ P3-A 新增：通用 AES 解密尝试（用于双密钥回退）
function tryDecryptAes(base64Data, key) {
    try {
        const data = Buffer.from(base64Data, 'base64');
        if (data.length < 32) return null;
        const iv = data.slice(0, 16);
        const ciphertext = data.slice(16);
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return plaintext.toString('utf8');
    } catch (e) {
        return null;
    }
}

// 加密 license JSON 字符串
function encryptLicenseContent(jsonStr, machineId) {
    const key = deriveLicenseKey(machineId);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const plaintext = Buffer.from(jsonStr, 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return 'ENC1:' + Buffer.concat([iv, ciphertext]).toString('base64');
}

// 解密 license 字符串（返回 JSON 字符串，失败返回 null）
// ★ P3-A 新增：双密钥尝试 - 优先新密钥（含硬件指纹），失败回退旧密钥（向后兼容）
function decryptLicenseContent(encryptedStr, machineId) {
    if (!encryptedStr || !encryptedStr.startsWith('ENC1:')) return null;
    const base64Data = encryptedStr.substring(5);
    // 优先尝试新密钥（含硬件指纹）
    let plaintext = tryDecryptAes(base64Data, deriveLicenseKey(machineId));
    if (plaintext) return plaintext;
    // 回退到旧密钥（向后兼容旧 license.dat）
    return tryDecryptAes(base64Data, deriveLicenseKeyLegacy(machineId));
}

// ============================================================================
//  ★ P2 新增：trial.dat / last-run.dat AES-256-CBC 加密
//  方案：与 license.dat 一致使用 AES-256-CBC，但派生不同密钥（不同盐）
//       防止 license.dat 密钥被破解后 trial.dat / last-run.dat 同时失守
//  文件格式：TRIAL1:base64(iv(16) + ciphertext) / LASTRUN1:base64(iv(16) + ciphertext)
//  旧格式：Base64(XOR(plaintext, key))（向后兼容，读取后自动迁移为 AES 格式）
//  ★ P3-A 增强：密钥派生追加硬件指纹，解密时双密钥尝试（新密钥优先，旧密钥回退）
// ============================================================================
const TRIAL_ENC_PREFIX = 'TRIAL1:';
const LASTRUN_ENC_PREFIX = 'LASTRUN1:';

// ★ P3-A 新增：派生 trial 加密密钥（含硬件指纹）
function deriveTrialKey(machineId) {
    const hwFp = getHardwareFingerprint();
    const combined = (machineId || '') + (hwFp || '') + LICENSE_HMAC_KEY + ':trial';
    return crypto.createHash('sha256').update(combined).digest();
}

// ★ P3-A 新增：旧 trial 密钥派生（不含硬件指纹，向后兼容）
function deriveTrialKeyLegacy(machineId) {
    const combined = (machineId || '') + LICENSE_HMAC_KEY + ':trial';
    return crypto.createHash('sha256').update(combined).digest();
}

// ★ P3-A 新增：派生 last-run 加密密钥（含硬件指纹）
function deriveLastRunKey(machineId) {
    const hwFp = getHardwareFingerprint();
    const combined = (machineId || '') + (hwFp || '') + LICENSE_HMAC_KEY + ':lastrun';
    return crypto.createHash('sha256').update(combined).digest();
}

// ★ P3-A 新增：旧 last-run 密钥派生（不含硬件指纹，向后兼容）
function deriveLastRunKeyLegacy(machineId) {
    const combined = (machineId || '') + LICENSE_HMAC_KEY + ':lastrun';
    return crypto.createHash('sha256').update(combined).digest();
}

// 加密 trial JSON 字符串
function encryptTrialContent(jsonStr, machineId) {
    const key = deriveTrialKey(machineId);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const plaintext = Buffer.from(jsonStr, 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return TRIAL_ENC_PREFIX + Buffer.concat([iv, ciphertext]).toString('base64');
}

// 解密 trial 字符串（仅处理 TRIAL1: 前缀，失败返回 null）
// ★ P3-A 新增：双密钥尝试 - 优先新密钥（含硬件指纹），失败回退旧密钥
function decryptTrialContent(encryptedStr, machineId) {
    if (!encryptedStr || !encryptedStr.startsWith(TRIAL_ENC_PREFIX)) return null;
    const base64Data = encryptedStr.substring(TRIAL_ENC_PREFIX.length);
    let plaintext = tryDecryptAes(base64Data, deriveTrialKey(machineId));
    if (plaintext) return plaintext;
    return tryDecryptAes(base64Data, deriveTrialKeyLegacy(machineId));
}

// 加密 last-run JSON 字符串
function encryptLastRunContent(jsonStr, machineId) {
    const key = deriveLastRunKey(machineId);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const plaintext = Buffer.from(jsonStr, 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return LASTRUN_ENC_PREFIX + Buffer.concat([iv, ciphertext]).toString('base64');
}

// 解密 last-run 字符串（仅处理 LASTRUN1: 前缀，失败返回 null）
// ★ P3-A 新增：双密钥尝试 - 优先新密钥（含硬件指纹），失败回退旧密钥
function decryptLastRunContent(encryptedStr, machineId) {
    if (!encryptedStr || !encryptedStr.startsWith(LASTRUN_ENC_PREFIX)) return null;
    const base64Data = encryptedStr.substring(LASTRUN_ENC_PREFIX.length);
    let plaintext = tryDecryptAes(base64Data, deriveLastRunKey(machineId));
    if (plaintext) return plaintext;
    return tryDecryptAes(base64Data, deriveLastRunKeyLegacy(machineId));
}

// ============================================================================
//  HMAC 签名（用于 license.dat 完整性校验）
//  v2: 签名包含 type/maxPrescriptions/features，防篡改版本分级
//  v3: 签名包含 clinicName/machineId/licenseBinding，实现三因子绑定
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

// ★ v3 签名：在 v2 基础上增加 clinicName/machineId/licenseBinding 三个绑定字段
function generateSignatureV3(data) {
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
    return crypto.createHmac('sha256', LICENSE_HMAC_KEY).update(content).digest('hex');
}

// v1 签名逻辑（向后兼容旧版 license）
function generateSignatureV1(data) {
    const content = [data.user, data.type, data.issuedAt, data.expiresAt].join('|');
    return crypto.createHmac('sha256', LICENSE_HMAC_KEY).update(content).digest('hex');
}

function verifySignature(data) {
    if (!data.signature) return false;
    // ★ v3 签名优先校验（含 clinicName/machineId/licenseBinding 时使用）
    if (data.clinicName !== undefined && data.machineId !== undefined && data.licenseBinding) {
        const expectedV3 = generateSignatureV3(data);
        try {
            if (crypto.timingSafeEqual(Buffer.from(data.signature, 'hex'), Buffer.from(expectedV3, 'hex'))) {
                return true;
            }
        } catch (e) { /* 长度不匹配，继续尝试 v2/v1 */ }
    }
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
function readLicense(machineId) {
    try {
        const licensePath = getLicensePath();
        if (!fs.existsSync(licensePath)) return null;
        const content = fs.readFileSync(licensePath, 'utf8').trim();

        // ★ P1-A 新增：优先尝试新加密格式（ENC1:）
        if (content.startsWith('ENC1:')) {
            const actualMachineId = machineId || getMachineId();
            if (!actualMachineId) {
                console.error('[License] 无法获取 machineId 解密 license');
                return null;
            }
            const json = decryptLicenseContent(content, actualMachineId);
            if (!json) {
                console.error('[License] 解密失败（machineId 不匹配或文件损坏）');
                return null;
            }
            return JSON.parse(json);
        }

        // 旧格式（Base64）- 向后兼容
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
        // ★ P2 新增：优先尝试新 AES 加密格式（TRIAL1:）
        if (content.startsWith(TRIAL_ENC_PREFIX)) {
            const actualMachineId = getMachineId();
            if (!actualMachineId) {
                console.error('[License] 无法获取 machineId 解密 trial');
                return null;
            }
            const json = decryptTrialContent(content, actualMachineId);
            if (!json) {
                console.error('[License] trial 解密失败（machineId 不匹配或文件损坏）');
                return null;
            }
            return JSON.parse(json);
        }
        // 旧格式（XOR + Base64）- 向后兼容
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
        // ★ P2 新增：使用 AES-256-CBC 加密写入（密钥从 machineId 派生）
        const actualMachineId = getMachineId();
        if (actualMachineId) {
            const encrypted = encryptTrialContent(json, actualMachineId);
            if (encrypted) {
                fs.writeFileSync(trialPath, encrypted, 'utf8');
                return;
            }
        }
        // 回退到 XOR 加密（仅当 machineId 不可用时）
        console.warn('[License] machineId 不可用，trial 回退到 XOR 加密');
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
        // ★ P2 新增：优先尝试新 AES 加密格式（LASTRUN1:）
        if (content.startsWith(LASTRUN_ENC_PREFIX)) {
            const actualMachineId = getMachineId();
            if (!actualMachineId) {
                console.error('[License] 无法获取 machineId 解密 last-run');
                return null;
            }
            const json = decryptLastRunContent(content, actualMachineId);
            if (!json) {
                console.error('[License] last-run 解密失败（machineId 不匹配或文件损坏）');
                return null;
            }
            return JSON.parse(json);
        }
        // 旧格式（XOR + Base64）- 向后兼容
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
        // ★ P2 新增：使用 AES-256-CBC 加密写入（密钥从 machineId 派生）
        const actualMachineId = getMachineId();
        if (actualMachineId) {
            const encrypted = encryptLastRunContent(json, actualMachineId);
            if (encrypted) {
                fs.writeFileSync(lastRunPath, encrypted, 'utf8');
                return;
            }
        }
        // 回退到 XOR 加密（仅当 machineId 不可用时）
        console.warn('[License] machineId 不可用，last-run 回退到 XOR 加密');
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
    const normalized = {
        user: license.user || '',
        type: license.type || 'personal',
        issuedAt: license.issuedAt,
        expiresAt: license.expiresAt,
        // v2 新字段（旧版 license 缺失时用默认值）
        maxPrescriptions: license.maxPrescriptions !== undefined ? license.maxPrescriptions : config.maxPrescriptions,
        features: Array.isArray(license.features) ? license.features : config.features,
        signature: license.signature
    };
    // ★ v3 新增：绑定字段透传（旧版 license 无此字段时不设置）
    if (license.clinicName !== undefined) normalized.clinicName = license.clinicName || '';
    if (license.machineId !== undefined) normalized.machineId = license.machineId || '';
    if (license.licenseBinding !== undefined) normalized.licenseBinding = license.licenseBinding || '';
    return normalized;
}

// ============================================================================
//  v3 新增：本地诊所名/机器 ID 读取 + 三因子绑定校验
// ============================================================================
// 从 config.json 读取本地诊所名（exe 同目录，由 edit-config.ps1 写入）
// 注意：config.json 必须配合 configSignature 完整性校验使用，防止被篡改绕过绑定
function getLocalClinicName() {
    try {
        const configPath = path.join(getExeDirectory(), 'config.json');
        if (fs.existsSync(configPath)) {
            const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            return cfg.clinicName || '';
        }
    } catch (e) { /* 忽略 */ }
    return '';
}

// 从 config.json 读取本地用户名（doctorName，作为绑定辅助字段）
function getLocalDoctorName() {
    try {
        const configPath = path.join(getExeDirectory(), 'config.json');
        if (fs.existsSync(configPath)) {
            const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            return cfg.doctorName || '';
        }
    } catch (e) { /* 忽略 */ }
    return '';
}

// ★ v3 核心：校验 license 三因子绑定（clinicName + machineId + 用户名）
// 仅当 license 含 licenseBinding 字段时才校验（向后兼容旧版 license）
// 返回 { valid: true } 或 { valid: false, message, type }
function checkLicenseBinding(license, localMachineId) {
    // 无 licenseBinding 字段 → 旧版 license，跳过绑定校验（兼容性优先）
    if (!license || !license.licenseBinding) return { valid: true };

    const mismatches = [];

    // 机器 ID 校验（核心：防 license.dat 复制到其他机器）
    if (license.machineId && localMachineId && license.machineId !== localMachineId) {
        mismatches.push('机器标识不匹配（授权可能从其他电脑复制）');
    }

    // 诊所名校验（核心：防 license.dat 跨诊所复制）
    const localClinicName = getLocalClinicName();
    if (license.clinicName && localClinicName && license.clinicName !== localClinicName) {
        mismatches.push(`诊所名不匹配（本地：${localClinicName}，授权：${license.clinicName}）`);
    }

    if (mismatches.length > 0) {
        return {
            valid: false,
            message: '授权绑定校验失败：\n' + mismatches.join('\n') +
                     '\n\n请联系客服重新激活或检查 config.json 配置。',
            type: 'binding_mismatch'
        };
    }
    return { valid: true };
}

// ★ v3 新增：校验 config.json 完整性签名
// 防止用户修改 config.json 中的 clinicName 绕过 license 绑定校验
// 返回 true=完整 / false=被篡改或无签名
function verifyConfigIntegrity() {
    try {
        const configPath = path.join(getExeDirectory(), 'config.json');
        if (!fs.existsSync(configPath)) return true;  // 无 config.json 跳过校验（兜底放行）
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        // 无 configSignature 字段 → 旧版 config.json，跳过校验（兼容性优先）
        if (!cfg.configSignature) return true;
        // 必须有 configIssuedAt 才能验签
        if (!cfg.configIssuedAt) return false;
        // 签名内容：clinicName|doctorName|edition|configIssuedAt
        const signContent = [cfg.clinicName || '', cfg.doctorName || '', cfg.edition || '', cfg.configIssuedAt].join('|');
        const expected = crypto.createHmac('sha256', CONFIG_SIGN_KEY).update(signContent).digest('hex');
        try {
            return crypto.timingSafeEqual(Buffer.from(cfg.configSignature, 'hex'), Buffer.from(expected, 'hex'));
        } catch (e) {
            return false;
        }
    } catch (e) {
        console.warn('[License] config.json 完整性校验异常:', e.message);
        return false;
    }
}

// ============================================================================
//  ★ P1-B 新增：安全检测（调试器检测，防 hook/调试绕过 license）
// ============================================================================
function isDebuggerAttached() {
    try {
        // 仅在打包后启用检测（开发模式下跳过，避免误报）
        if (!app.isPackaged) return false;

        // 1. 检测 --inspect / --inspect-brk / --remote-debugging-port 命令行参数
        const argv = process.argv.join(' ');
        if (argv.includes('--inspect') || argv.includes('--inspect-brk') ||
            argv.includes('--remote-debugging-port')) {
            console.warn('[License] 检测到调试参数:', argv);
            return true;
        }

        // 2. 检测 NODE_OPTIONS 环境变量中的 --inspect
        if (process.env.NODE_OPTIONS && process.env.NODE_OPTIONS.includes('--inspect')) {
            console.warn('[License] NODE_OPTIONS 含调试参数:', process.env.NODE_OPTIONS);
            return true;
        }

        // 3. 检测 ELECTRON_ENABLE_LOGGING（非正常生产环境配置）
        if (process.env.ELECTRON_ENABLE_LOGGING) {
            console.warn('[License] ELECTRON_ENABLE_LOGGING 已启用');
            return true;
        }

        return false;
    } catch (e) {
        // 检测异常时放行，避免误判阻塞用户
        return false;
    }
}

// ============================================================================
//  校验主逻辑
// ============================================================================
function validateLicense(options) {
    options = options || {};
    const now = Date.now();
    // ★ v3 新增：允许传入 localMachineId（避免循环依赖 activate.js）
    // 如未传入则置空字符串，机器 ID 校验自动跳过（仅靠诊所名校验）
    const localMachineId = options.localMachineId || '';

    // ★ P1-B 新增：调试器检测（防 hook/调试绕过 license）
    // 仅在打包后启用（开发模式下跳过，避免误报）
    if (isDebuggerAttached()) {
        return {
            valid: false,
            message: '检测到调试器已连接，软件无法运行。\n请关闭调试模式后重启应用。',
            type: 'debugger'
        };
    }

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
    const rawLicense = readLicense(localMachineId || getMachineId());
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

        // ★ v3 新增：config.json 完整性校验（仅对绑定型 license 生效）
        // 防止用户修改 config.json 中的 clinicName 绕过 license 绑定校验
        if (license.licenseBinding && !verifyConfigIntegrity()) {
            return {
                valid: false,
                message: '配置文件 config.json 已被篡改或损坏，请重新打包或联系客服。\n（诊所名/医师名等关键字段签名校验失败）',
                type: 'config_tampered',
                license: license
            };
        }

        // ★ v3 新增：三因子绑定校验（clinicName + machineId）
        // 仅当 license 含 licenseBinding 字段时才校验，旧版 license 自动跳过
        const bindingCheck = checkLicenseBinding(license, localMachineId);
        if (!bindingCheck.valid) {
            return {
                valid: false,
                message: bindingCheck.message,
                type: bindingCheck.type || 'binding_mismatch',
                license: license
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
// ★ P1-A 新增：写入前先加密（AES-256-CBC，密钥从 machineId 派生）
function writeLicenseContent(base64Content, machineId) {
    try {
        const licensePath = getLicensePath();
        const actualMachineId = machineId || getMachineId();
        if (!actualMachineId) {
            return { success: false, error: '无法获取机器 ID，无法加密 license' };
        }

        // 解码 Base64 得到 JSON 字符串
        const jsonStr = Buffer.from(base64Content.trim(), 'base64').toString('utf8');

        // 验证是有效的 JSON（防止写入损坏数据）
        JSON.parse(jsonStr);

        // 加密并写入
        const encrypted = encryptLicenseContent(jsonStr, actualMachineId);
        fs.writeFileSync(licensePath, encrypted, 'utf8');
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
    setTrialDays,         // ★ 设置试用期天数（持久化）
    // ★ v3 新增：绑定校验相关
    generateSignatureV3,  // v3 签名生成（含绑定字段）
    checkLicenseBinding,  // 三因子绑定校验
    getLocalClinicName,   // 从 config.json 读取本地诊所名
    getLocalDoctorName,   // 从 config.json 读取本地医师名
    verifyConfigIntegrity, // config.json 完整性校验
    // ★ P1-A 新增：加密相关
    getMachineId,         // 获取机器 ID（供 main.js 调用）
    encryptLicenseContent, // 加密 license（供测试用）
    decryptLicenseContent, // 解密 license（供测试用）
    // ★ P2 新增：trial / last-run 加密相关
    encryptTrialContent,   // 加密 trial（供测试用）
    decryptTrialContent,   // 解密 trial（供测试用）
    encryptLastRunContent, // 加密 last-run（供测试用）
    decryptLastRunContent, // 解密 last-run（供测试用）
    // ★ P3-A 新增：硬件指纹相关
    getHardwareFingerprint, // 获取硬件指纹（供测试用）
    // ★ P1-B 新增：安全检测
    isDebuggerAttached    // 调试器检测（供 main.js 调用）
};
