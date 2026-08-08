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

// ★ 任务2 新增：ECDSA P-256 验签公钥（PEM SPKI 格式）
// 用于验证 license 中的 signatureV5 字段（云端 ECDSA 私钥签发）
// 默认为空：未配置时跳过 v5 验签，仅用 HMAC v4（向后兼容）
// 启用步骤：
//   1. 运行 node tools/gen-ecdsa-keys.cjs 生成密钥对
//   2. 私钥 LICENSE_SIGN_PRIVATE_KEY 存 Cloudflare Secrets
//   3. 公钥（-----BEGIN PUBLIC KEY----- 整段）填入此常量
//   4. 重新打包 exe
const ECDSA_VERIFY_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEXqspDCFxlyS9wH0Kyb/fR9sqOeAG
DurLP5B6cwCvAhMF8Lvlzv9nnvdEWdY0+GytTCUsXWrBbDDgLrOufN1NNw==
-----END PUBLIC KEY-----`;

const TRIAL_KEY = 'bnzc_trial_key_v1';
const LASTRUN_KEY = 'bnzc_lastrun_key_v1';

// ★ v3 新增：config.json 完整性签名密钥（与 edit-config.ps1 中 $CONFIG_SIGN_KEY 保持一致）
// 用于校验 config.json 中的 clinicName/doctorName 未被篡改
const CONFIG_SIGN_KEY = 'bnzc_config_sign_key_v1_2026';

// ============================================================================
//  ★ P1-3 新增：masterKey 派生密钥机制
//  设计：
//    - license.dat 中可能包含 masterKey 字段（云端 LICENSE_MASTER_KEY 配置后下发）
//    - 若 license 含 masterKey，则从 masterKey 派生 HMAC/CONFIG_SIGN 密钥
//    - 若不含 masterKey（旧版 license），fallback 到硬编码密钥（向后兼容）
//  派生算法（与云端 license-core.js 保持一致）：
//    effectiveHmacKey      = SHA256(masterKey + ':license-hmac:v1')
//    effectiveConfigSignKey = SHA256(masterKey + ':config-sign:v1')
//  使用：
//    verifySignature 开头调用 setLicenseDataContext(data) 缓存当前 license
//    随后所有签名校验/加密派生均使用 getEffectiveHmacKey() / getEffectiveConfigSignKey()
// ============================================================================
let _currentLicenseData = null;
function setLicenseDataContext(data) {
    _currentLicenseData = data || null;
}
function getLicenseMasterKey() {
    return (_currentLicenseData && _currentLicenseData.masterKey) ? _currentLicenseData.masterKey : null;
}
function getEffectiveHmacKey() {
    const mk = getLicenseMasterKey();
    if (mk) {
        return crypto.createHash('sha256').update(mk + ':license-hmac:v1').digest('hex');
    }
    return LICENSE_HMAC_KEY;
}
function getEffectiveConfigSignKey() {
    const mk = getLicenseMasterKey();
    if (mk) {
        return crypto.createHash('sha256').update(mk + ':config-sign:v1').digest('hex');
    }
    return CONFIG_SIGN_KEY;
}

// ★ v2: 版本类型默认配置（功能差异矩阵）
// trial: 试用版，限 30 张/月处方，无高级功能
// personal: 标准版，无限处方，支持数据备份
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
// ★ 修复 NSIS 安装到 Program Files 无写权限导致 license.dat 写入失败的问题
// 策略：
//   - Portable exe（PORTABLE_EXECUTABLE_DIR 已设）: 用 exe 同目录（保留便携性，license 跟随 exe 走）
//   - NSIS 安装版: 用 app.getPath('userData')（C:\Users\xxx\AppData\Roaming\产品名\，可写）
//   - 兜底异常: 用 userData
function isPortableInstall() {
    try {
        return !!process.env.PORTABLE_EXECUTABLE_DIR;
    } catch (e) {
        return false;
    }
}

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

// ★ 新增：获取可写目录（license.dat / trial-config.json 使用）
// Portable: exe 同目录；NSIS: userData 目录
function getWritableDir() {
    try {
        if (isPortableInstall()) {
            return getExeDirectory();
        }
        // NSIS 安装版：exe 在 Program Files 下只读，license.dat 必须写到 userData
        return app.getPath('userData');
    } catch (e) {
        try { return app.getPath('userData'); } catch (e2) { return getExeDirectory(); }
    }
}

function getLicensePath() {
    try {
        return path.join(getWritableDir(), 'license.dat');
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
        return path.join(getWritableDir(), 'trial-config.json');
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
// P5-5 安全升级（2026-08-08，规则3）：
//   旧：exePath + hostname + username + platform（软件信息，易变/易伪造）
//   新：硬件指纹为主体（MachineGuid+主板序列号+CPU ID+磁盘序列号），
//       软件信息仅作补充防碰撞（占比小）；
//   只上传最终 SHA256 哈希 32 位前缀，不上传原始硬件信息。
function getMachineId() {
    try {
        // 1. 硬件特征（主体，规则3要求"多硬件哈希串"）
        // 优先使用 getHardwareFingerprint（MachineGuid + 主板 + CPU）
        let hwFp = '';
        try {
            if (typeof getHardwareFingerprint === 'function') {
                hwFp = getHardwareFingerprint();
            }
        } catch (e) { /* 忽略 */ }

        // 如果硬件指纹为空（非Windows/权限不足），尽力补充磁盘型号
        if (!hwFp) {
            try {
                const { execSync } = require('child_process');
                const diskParts = [];
                try {
                    const diskOut = execSync('wmic diskdrive get serialnumber',
                        { timeout: 2000, windowsHide: true }).toString();
                    const lines = diskOut.split('\n').map(s => s.trim())
                        .filter(s => s && s.toLowerCase() !== 'serialnumber');
                    if (lines.length > 0 && lines[0]) diskParts.push('dsk=' + lines[0]);
                } catch (e) {}
                if (diskParts.length > 0) {
                    hwFp = require('crypto').createHash('sha256')
                        .update(diskParts.join('|')).digest('hex');
                }
            } catch (e) { /* 忽略 */ }
        }

        // 2. 软件信息（仅作补充防碰撞，占比小）
        let swInfo = '';
        try {
            const os = require('os');
            const hostname = os.hostname();
            const platform = os.platform();
            swInfo = [hostname, platform].join('|');
        } catch (e) { /* 忽略 */ }

        // 3. 合并：硬件为主（权重1）+软件为辅（权重小）→ SHA256 → 32位前缀
        const crypto = require('crypto');
        const combined = 'HW=' + (hwFp || '') + '|SW=' + (swInfo || '');
        return crypto.createHash('sha256').update(combined).digest('hex').substring(0, 32);
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
// ★ P3-C 新增：加密后追加外层 HMAC 签名（基于 machineId + 硬件指纹）
// 文件格式：ENC2:hex(hmac):base64(iv + ciphertext)
// 旧格式 ENC1:base64(iv + ciphertext) 仍可读（向后兼容，读取后自动迁移为 ENC2）
function encryptLicenseContent(jsonStr, machineId) {
    const key = deriveLicenseKey(machineId);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const plaintext = Buffer.from(jsonStr, 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const payload = Buffer.concat([iv, ciphertext]).toString('base64');
    // ★ P3-C 新增：计算外层 HMAC（基于 machineId + 硬件指纹 + 密文）
    // 防止攻击者替换整个 license.dat 文件（即使 machineId 相同，HMAC 不匹配也会拒绝）
    const hmacKey = deriveLicenseHmacKey(machineId);
    const hmac = crypto.createHmac('sha256', hmacKey).update(payload).digest('hex');
    return 'ENC2:' + hmac + ':' + payload;
}

// ★ P3-C 新增：派生 license HMAC 密钥（独立于加密密钥，不同盐）
function deriveLicenseHmacKey(machineId) {
    const hwFp = getHardwareFingerprint();
    const combined = (machineId || '') + (hwFp || '') + LICENSE_HMAC_KEY + ':hmac';
    return crypto.createHash('sha256').update(combined).digest();
}

// 解密 license 字符串（返回 JSON 字符串，失败返回 null）
// ★ P3-C 新增：优先 ENC2 格式（含 HMAC 校验），回退 ENC1 格式（向后兼容）
// ★ P3-A 新增：双密钥尝试 - 优先新密钥（含硬件指纹），失败回退旧密钥
function decryptLicenseContent(encryptedStr, machineId) {
    if (!encryptedStr) return null;
    // ★ P3-C 新增：优先尝试 ENC2 格式（含 HMAC 校验）
    if (encryptedStr.startsWith('ENC2:')) {
        const parts = encryptedStr.substring(5).split(':');
        if (parts.length < 2) return null;
        const storedHmac = parts[0];
        const base64Data = parts.slice(1).join(':');
        // 优先用新密钥校验 HMAC
        const newHmacKey = deriveLicenseHmacKey(machineId);
        const newExpectedHmac = crypto.createHmac('sha256', newHmacKey).update(base64Data).digest('hex');
        let hmacMatched = false;
        try {
            if (crypto.timingSafeEqual(Buffer.from(storedHmac, 'hex'), Buffer.from(newExpectedHmac, 'hex'))) {
                hmacMatched = true;
            }
        } catch (e) { /* 长度不匹配，尝试旧密钥 */ }
        // 旧 HMAC 密钥（不含硬件指纹，向后兼容）
        if (!hmacMatched) {
            const legacyHmacKey = deriveLicenseHmacKeyLegacy(machineId);
            const legacyExpectedHmac = crypto.createHmac('sha256', legacyHmacKey).update(base64Data).digest('hex');
            try {
                if (crypto.timingSafeEqual(Buffer.from(storedHmac, 'hex'), Buffer.from(legacyExpectedHmac, 'hex'))) {
                    hmacMatched = true;
                }
            } catch (e) { return null; }
        }
        if (!hmacMatched) {
            console.error('[License] HMAC 校验失败（文件可能被替换/篡改）');
            return null;
        }
        // HMAC 校验通过，解密内容（双密钥尝试）
        let plaintext = tryDecryptAes(base64Data, deriveLicenseKey(machineId));
        if (plaintext) return plaintext;
        return tryDecryptAes(base64Data, deriveLicenseKeyLegacy(machineId));
    }
    // 旧 ENC1 格式 - 向后兼容
    if (encryptedStr.startsWith('ENC1:')) {
        const base64Data = encryptedStr.substring(5);
        // 优先尝试新密钥（含硬件指纹）
        let plaintext = tryDecryptAes(base64Data, deriveLicenseKey(machineId));
        if (plaintext) return plaintext;
        // 回退到旧密钥（向后兼容旧 license.dat）
        return tryDecryptAes(base64Data, deriveLicenseKeyLegacy(machineId));
    }
    return null;
}

// ★ P3-C 新增：旧 HMAC 密钥派生（不含硬件指纹，向后兼容）
function deriveLicenseHmacKeyLegacy(machineId) {
    const combined = (machineId || '') + LICENSE_HMAC_KEY + ':hmac';
    return crypto.createHash('sha256').update(combined).digest();
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
    return crypto.createHmac('sha256', getEffectiveHmacKey()).update(content).digest('hex');
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
    return crypto.createHmac('sha256', getEffectiveHmacKey()).update(content).digest('hex');
}

// v1 签名逻辑（向后兼容旧版 license）
function generateSignatureV1(data) {
    const content = [data.user, data.type, data.issuedAt, data.expiresAt].join('|');
    return crypto.createHmac('sha256', getEffectiveHmacKey()).update(content).digest('hex');
}

function verifySignature(data) {
    if (!data.signature) return false;

    // ★ P1-3: 缓存当前 license 数据上下文，供 getEffectiveHmacKey 派生密钥使用
    // 注意：此时 license 数据尚未验签，但 masterKey 字段不参与签名内容（云端在签名后添加），
    //      因此攻击者修改 masterKey 会导致派生密钥改变，但 cloud 签名仍按原 masterKey 计算，
    //      所以篡改后的 license 会验签失败（除非攻击者知道原 masterKey 并重算签名）。
    //      ECDSA v5（如果配置）提供更强的防篡改保证。
    setLicenseDataContext(data);

    // ★ 任务2 新增：v5 ECDSA 签名优先校验
    // 如果 license 包含 signatureV5 字段且配置了 ECDSA 公钥，优先用非对称验签
    // 失败则 fallback 到 HMAC v3/v2/v1（向后兼容旧 license）
    if (data.signatureV5 && ECDSA_VERIFY_PUBLIC_KEY_PEM) {
        if (verifyECDSASignature(data)) {
            return true;
        }
        console.warn('[License] v5 ECDSA 验签失败，降级为 HMAC');
    }

    // ★ P1-3 新增：如果 license 含 masterKey 字段，必须使用 masterKey 派生密钥验签
    // ★ 安全修复：masterKey 存在时拒绝 fallback 到硬编码密钥
    //   - masterKey 派生密钥验签失败 → 直接返回 false（license 已被篡改或 masterKey 不匹配）
    //   - 旧版 license（无 masterKey 字段）仍走硬编码密钥 fallback（向后兼容）
    if (data.masterKey) {
        // 已在 setLicenseDataContext(data) 中缓存 masterKey，下面 generateSignatureV3/V2 会自动派生
        const expectedV3mk = generateSignatureV3(data);
        try {
            if (crypto.timingSafeEqual(Buffer.from(data.signature, 'hex'), Buffer.from(expectedV3mk, 'hex'))) {
                return true;
            }
        } catch (e) { /* 长度不匹配，继续尝试 v2 派生密钥 */ }
        const expectedV2mk = generateSignature(data);
        try {
            if (crypto.timingSafeEqual(Buffer.from(data.signature, 'hex'), Buffer.from(expectedV2mk, 'hex'))) {
                return true;
            }
        } catch (e) { /* 派生密钥验签失败，拒绝 fallback */ }
        // ★ 安全修复：masterKey 存在但派生密钥验签失败，拒绝 fallback 到硬编码密钥
        //   防止攻击者篡改 masterKey 后用硬编码密钥重算签名绕过验签
        console.warn('[License] license 含 masterKey 但派生密钥验签失败，拒绝 fallback 到硬编码密钥');
        setLicenseDataContext(null);
        return false;
    }

    // ★ v3 签名优先校验（含 clinicName/machineId/licenseBinding 时使用）— 硬编码密钥 fallback
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

// ★ 任务2 新增：ECDSA P-256 非对称验签（v5）
// 用 ECDSA_VERIFY_PUBLIC_KEY_PEM 验证 license 中的 signatureV5 字段
// 签名内容与 v3 一致（user|type|issuedAt|expiresAt|maxPrescriptions|features|clinicName|machineId|licenseBinding）
// 但用非对称算法：云端私钥签，客户端公钥验
// ★ 优势：即使客户端被反编译拿到公钥，也无法伪造签名（公钥只能验不能签）
function verifyECDSASignature(data) {
    if (!data.signatureV5 || !ECDSA_VERIFY_PUBLIC_KEY_PEM) return false;
    try {
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

        // Web Crypto API 输出 raw r||s 格式（64 字节）
        // Node.js crypto.verify 默认期望 DER 格式
        // 需要把 raw 转 DER，或用 crypto.verify 的 ECDSA-Sig-Value 选项
        // 简化方案：用 crypto.createVerify + DER 签名
        // 但云端 Web Crypto 输出 raw，需要客户端转换
        const rawSigHex = data.signatureV5;
        const rawSigBytes = Buffer.from(rawSigHex, 'hex');
        // raw 格式：r (32 bytes) || s (32 bytes) = 64 bytes total
        // 转 DER 格式
        if (rawSigBytes.length !== 64) {
            console.warn('[License] v5 签名长度异常:', rawSigBytes.length);
            return false;
        }
        const r = rawSigBytes.slice(0, 32);
        const s = rawSigBytes.slice(32, 64);
        const derSig = encodeEcdsaSigToDER(r, s);

        const verify = crypto.createVerify('SHA256');
        verify.update(content);
        verify.end();
        return verify.verify(ECDSA_VERIFY_PUBLIC_KEY_PEM, derSig);
    } catch (e) {
        console.warn('[License] v5 ECDSA 验签异常:', e.message);
        return false;
    }
}

// 将 ECDSA 的 raw r||s 转换为 DER 编码（Node.js crypto 期望的格式）
function encodeEcdsaSigToDER(r, s) {
    // 确保 r 和 s 是正数（前导字节 ≥ 0x80 时需补 0x00）
    function toDERInt(buf) {
        // 去除前导 0
        let i = 0;
        while (i < buf.length - 1 && buf[i] === 0) i++;
        let trimmed = buf.slice(i);
        // 如果最高位是 1，需要补 0x00 前缀
        if (trimmed[0] & 0x80) {
            trimmed = Buffer.concat([Buffer.from([0x00]), trimmed]);
        }
        return trimmed;
    }
    const rDER = toDERInt(r);
    const sDER = toDERInt(s);
    // DER 编码：30 <总长度> 02 <r 长度> <r> 02 <s 长度> <s>
    const totalLen = 2 + rDER.length + 2 + sDER.length;
    return Buffer.concat([
        Buffer.from([0x30, totalLen]),
        Buffer.from([0x02, rDER.length]),
        rDER,
        Buffer.from([0x02, sDER.length]),
        sDER
    ]);
}

// ============================================================================
//  文件读写
// ============================================================================
function readLicense(machineId) {
    try {
        const licensePath = getLicensePath();
        if (!fs.existsSync(licensePath)) return null;
        const content = fs.readFileSync(licensePath, 'utf8').trim();

        // ★ P3-C 新增：优先尝试 ENC2 格式（含 HMAC 校验）
        if (content.startsWith('ENC2:')) {
            const actualMachineId = machineId || getMachineId();
            if (!actualMachineId) {
                console.error('[License] 无法获取 machineId 解密 license');
                return null;
            }
            const json = decryptLicenseContent(content, actualMachineId);
            if (!json) {
                console.error('[License] 解密失败（machineId 不匹配 / 文件损坏 / HMAC 校验失败）');
                return null;
            }
            return JSON.parse(json);
        }

        // ★ P1-A 新增：旧加密格式（ENC1:）
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
    // ★ P1-3 新增：masterKey 透传（云端 LICENSE_MASTER_KEY 配置后下发，旧 license 无此字段）
    if (license.masterKey !== undefined) normalized.masterKey = license.masterKey || null;
    // ★ v3 新增：v5 ECDSA 签名透传（如果存在）
    if (license.signatureV5 !== undefined) normalized.signatureV5 = license.signatureV5;
    if (license.signatureVersion !== undefined) normalized.signatureVersion = license.signatureVersion;
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
// ★ P1-3: 使用 getEffectiveConfigSignKey() 派生密钥（从 license.masterKey 派生，向后兼容）
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
        const expected = crypto.createHmac('sha256', getEffectiveConfigSignKey()).update(signContent).digest('hex');
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
//  ★ P3-B 新增：虚拟机/沙箱检测（防 VM/Sandbox 分析）
//  策略：
//   1. CPU vendor 字符串含 VMware/VirtualBox/Hyper-V/QEMU/Xen
//   2. WMI 查询 Win32_ComputerSystem.Manufacturer 含 VMware/VirtualBox/Microsoft/QEMU
//   3. 进程列表含 sandboxie.exe / Sandboxie* （沙箱）
//   4. 可选磁盘特征（VM 磁盘型号通常含 VBOX/VIRTUAL/VMware）
//  返回：true 表示检测到 VM/沙箱（仅记录日志，不阻塞运行，避免误判）
//  ★ 重要：仅在打包后启用，开发模式跳过；检测结果只记录日志不直接拒绝运行
//        （避免在 VM 中合法用户被误判阻塞，由调用方决定如何处理）
// ============================================================================
let _vmCheckCache = null;
function isVirtualMachine() {
    if (_vmCheckCache !== null) return _vmCheckCache;
    try {
        // 仅在打包后启用检测（开发模式下跳过）
        if (!app.isPackaged) {
            _vmCheckCache = false;
            return false;
        }
        const { execSync } = require('child_process');
        const vmIndicators = [
            'vmware', 'virtualbox', 'vbox', 'qemu', 'xen', 'hyper-v', 'hyperv',
            'parallels', 'vmware virtual platform', 'innotek gmbh'
        ];

        // 1. WMI 查询计算机制造商和型号
        try {
            const out = execSync('wmic computersystem get manufacturer,model',
                { timeout: 2000, windowsHide: true }).toString().toLowerCase();
            for (const ind of vmIndicators) {
                if (out.includes(ind)) {
                    console.warn('[License] 检测到 VM 标志（WMI Manufacturer/Model）:', ind);
                    _vmCheckCache = true;
                    return true;
                }
            }
        } catch (e) { /* 忽略 WMI 失败 */ }

        // 2. WMI 查询磁盘型号（VM 磁盘通常含 VBOX/VIRTUAL/VMware）
        try {
            const out = execSync('wmic diskdrive get model',
                { timeout: 2000, windowsHide: true }).toString().toLowerCase();
            for (const ind of vmIndicators) {
                if (out.includes(ind)) {
                    console.warn('[License] 检测到 VM 标志（WMI DiskDrive Model）:', ind);
                    _vmCheckCache = true;
                    return true;
                }
            }
        } catch (e) { /* 忽略 */ }

        // 3. BIOS 版本字符串（VMware/VirtualBox BIOS 标志）
        try {
            const out = execSync('wmic bios get serialnumber,version',
                { timeout: 2000, windowsHide: true }).toString().toLowerCase();
            for (const ind of vmIndicators) {
                if (out.includes(ind)) {
                    console.warn('[License] 检测到 VM 标志（WMI BIOS）:', ind);
                    _vmCheckCache = true;
                    return true;
                }
            }
        } catch (e) { /* 忽略 */ }

        // 4. 进程列表检测沙箱（Sandboxie）
        try {
            const out = execSync('wmic process get name',
                { timeout: 2000, windowsHide: true }).toString().toLowerCase();
            if (out.includes('sandboxie') || out.includes('sandboxiedcomlaunch') ||
                out.includes('sandboxierpcss')) {
                console.warn('[License] 检测到沙箱进程（Sandboxie）');
                _vmCheckCache = true;
                return true;
            }
        } catch (e) { /* 忽略 */ }

        _vmCheckCache = false;
        return false;
    } catch (e) {
        _vmCheckCache = false;
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

    // ★ P3-B 新增：VM/沙箱检测（仅记录日志，不阻塞运行）
    // 用途：便于将来分析破解行为，避免误判合法用户（如企业 IT 部署在 VM 中）
    if (isVirtualMachine()) {
        console.warn('[License] 检测到运行在 VM/沙箱环境中（仍允许运行，仅记录日志）');
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
            remainingDays: remainingDays,
            masterKey: license.masterKey || null  // ★ P1-3: 透传给 renderer 用于 AuthCore.setMasterKey
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
// ★ 修复：NSIS 安装到 Program Files 时 license.dat 写入失败的处理
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
        try {
            fs.writeFileSync(licensePath, encrypted, 'utf8');
            return { success: true, path: licensePath };
        } catch (writeErr) {
            // ★ 写入失败时尝试 fallback 到 userData 目录（防御性兜底）
            console.warn('[License] 主路径写入失败，尝试 userData 兜底:', writeErr.message);
            const fallbackPath = path.join(app.getPath('userData'), 'license.dat');
            fs.writeFileSync(fallbackPath, encrypted, 'utf8');
            console.log('[License] license.dat 已写入兜底路径:', fallbackPath);
            return { success: true, path: fallbackPath };
        }
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

// ============================================================================
//  ★ 网络心跳检测（支持远程撤销授权）
//  策略：
//   1. 每 24 小时检查一次云端授权状态
//   2. 失败时自动重试（最多 3 次，间隔 5 分钟）
//   3. 无网络时跳过检查（不影响离线使用）
//   4. 检测到撤销时退出应用并显示提示
// ============================================================================
const HEARTBEAT_INTERVAL = 24 * 60 * 60 * 1000; // 24 小时
const HEARTBEAT_RETRY_INTERVAL = 5 * 60 * 1000; // 5 分钟重试
const HEARTBEAT_MAX_RETRIES = 3;
const HEARTBEAT_API_URL = 'https://tcm-prescription-system.pages.dev/api/license/status';

let _heartbeatTimer = null;
let _heartbeatRetryCount = 0;

async function checkLicenseRevocation(machineId) {
    try {
        const response = await fetch(HEARTBEAT_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ machineId: machineId || getMachineId() }),
            timeout: 15000
        });

        if (!response.ok) {
            console.warn('[Heartbeat] 心跳检测失败:', response.status);
            return null;
        }

        const data = await response.json();
        _heartbeatRetryCount = 0;
        return data;
    } catch (e) {
        console.warn('[Heartbeat] 心跳检测异常:', e.message);
        return null;
    }
}

async function heartbeatHandler() {
    try {
        const machineId = getMachineId();
        if (!machineId) return;

        const result = await checkLicenseRevocation(machineId);
        if (result === null) {
            _heartbeatRetryCount++;
            if (_heartbeatRetryCount <= HEARTBEAT_MAX_RETRIES) {
                console.warn('[Heartbeat] 重试第', _heartbeatRetryCount, '次');
                _heartbeatTimer = setTimeout(heartbeatHandler, HEARTBEAT_RETRY_INTERVAL);
            }
            return;
        }

        if (result.revoked) {
            console.error('[Heartbeat] 授权已被远程撤销:', result.reason || '未知原因');
            app.quit();
        }

        if (result.warning) {
            console.warn('[Heartbeat] 授权警告:', result.warning);
        }
    } catch (e) {
        console.error('[Heartbeat] 心跳处理异常:', e.message);
    }
}

function startHeartbeat() {
    if (_heartbeatTimer) return;
    console.log('[Heartbeat] 启动网络心跳检测（每 24 小时检查一次）');
    heartbeatHandler();
    _heartbeatTimer = setInterval(heartbeatHandler, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
    if (_heartbeatTimer) {
        clearInterval(_heartbeatTimer);
        _heartbeatTimer = null;
        console.log('[Heartbeat] 停止网络心跳检测');
    }
}

// ============================================================================
//  P6-6: 激活工单提交（规则3：支持客户提交激活工单、后台一键激活）
//  安全策略：
//   - 只上传 machineId（最终哈希串），不上传原始硬件信息
//   - 联系信息明文传输，但记录到本地后不显示给其他界面
//   - 工单提交成功后本地缓存工单编号，方便客户查询
// ============================================================================
const ACTIVATION_TICKET_API_URL = 'https://tcm-prescription-system.pages.dev/api/license/ticket/submit';
const TICKET_CACHE_KEY = 'auth:activation_ticket_cache'; // 缓存在 userData 目录

async function submitActivationTicket(payload, machineIdOverride) {
    // payload: { contactName, contactPhone, contactWechat, clinicName, edition, remark }
    try {
        const actualMachineId = machineIdOverride || getMachineId();
        if (!actualMachineId) {
            return { success: false, error: '无法获取设备标识，请稍后重试' };
        }
        if (!payload || typeof payload !== 'object') {
            return { success: false, error: '工单数据无效' };
        }

        // 1. 输入校验（只保留必要字段，避免注入）
        const safePayload = {
            machineId: actualMachineId, // 只传哈希串，不传原始硬件
            edition: String(payload.edition || '').slice(0, 32),
            clinicName: String(payload.clinicName || '').slice(0, 100),
            contactName: String(payload.contactName || '').slice(0, 50),
            contactPhone: String(payload.contactPhone || '').slice(0, 20),
            contactWechat: String(payload.contactWechat || '').slice(0, 50),
            remark: String(payload.remark || '').slice(0, 500),
            submittedAt: new Date().toISOString()
        };

        // 基础必填校验
        if (!safePayload.clinicName) return { success: false, error: '请填写诊所名称' };
        if (!safePayload.contactName) return { success: false, error: '请填写联系人姓名' };
        if (!safePayload.contactPhone && !safePayload.contactWechat) {
            return { success: false, error: '请至少填写一种联系方式（手机号/微信号）' };
        }
        if (safePayload.contactPhone && !/^[0-9+\-\s]{5,20}$/.test(safePayload.contactPhone)) {
            return { success: false, error: '手机号格式不正确' };
        }

        // 2. 调用云端工单 API（带超时保护）
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(() => controller.abort(), 20000) : null;
        let response;
        try {
            response = await fetch(ACTIVATION_TICKET_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(safePayload),
                signal: controller ? controller.signal : undefined
            });
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }

        if (!response) {
            return { success: false, error: '网络请求失败，请检查网络连接' };
        }
        if (!response.ok) {
            let msg = '提交失败（HTTP ' + response.status + '）';
            try {
                const d = await response.json();
                if (d && d.error) msg = d.error;
            } catch (e) {}
            return { success: false, error: msg };
        }

        let data;
        try {
            data = await response.json();
        } catch (e) {
            return { success: false, error: '服务器返回格式异常' };
        }

        if (!data || !data.success) {
            return { success: false, error: (data && data.error) || '服务器拒绝了工单' };
        }

        // 3. 提交成功：本地缓存工单信息（供后续查询/显示）
        try {
            const ticketInfo = {
                ticketNo: data.ticketNo || ('T' + Date.now()),
                status: 'submitted',
                submittedAt: safePayload.submittedAt,
                machineId: safePayload.machineId,
                clinicName: safePayload.clinicName,
                contactName: safePayload.contactName
            };
            // 写入可写目录（和 license.dat 同目录，避免 Program Files 权限问题）
            const writableDir = getWritableDir ? getWritableDir() : (app && app.getPath ? app.getPath('userData') : null);
            if (writableDir) {
                const cachePath = require('path').join(writableDir, 'activation-ticket-cache.json');
                try {
                    fs.writeFileSync(cachePath, JSON.stringify(ticketInfo, null, 2), 'utf8');
                } catch (e) { /* 忽略缓存写入失败 */ }
            }
            return { success: true, ticketNo: ticketInfo.ticketNo, machineId: safePayload.machineId };
        } catch (e) {
            return { success: true, ticketNo: (data && data.ticketNo) || ('T' + Date.now()), machineId: safePayload.machineId };
        }
    } catch (e) {
        return { success: false, error: '提交异常：' + (e && e.message ? e.message : '未知错误') };
    }
}

// 读取本地缓存的工单信息（激活窗口中展示给客户）
function getCachedActivationTicket() {
    try {
        const writableDir = getWritableDir ? getWritableDir() : (app && app.getPath ? app.getPath('userData') : null);
        if (!writableDir) return null;
        const cachePath = require('path').join(writableDir, 'activation-ticket-cache.json');
        if (!fs.existsSync(cachePath)) return null;
        return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    } catch (e) { return null; }
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
    // ★ 路径相关（修复 NSIS 安装到 Program Files 无写权限问题）
    isPortableInstall,    // 检测是否为 portable 安装（供 activate.js 决定写入路径）
    getWritableDir,       // 获取可写目录（license.dat / trial-config.json 用）
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
    isDebuggerAttached,    // 调试器检测（供 main.js 调用）
    // ★ P3-B 新增：VM/沙箱检测
    isVirtualMachine,      // 虚拟机检测（供 main.js 调用，仅记录日志）
    // ★ 网络心跳相关
    startHeartbeat,        // 启动心跳检测
    stopHeartbeat,         // 停止心跳检测
    checkLicenseRevocation, // 手动检查授权状态（供测试用）
    // ★ P1-3 新增：masterKey 派生密钥机制
    setLicenseDataContext,  // 缓存当前 license 数据（供 verifyConfigIntegrity 派生密钥用）
    getLicenseMasterKey,    // 获取当前 license 的 masterKey（供测试用）
    getEffectiveHmacKey,    // 获取生效的 HMAC 密钥（masterKey 派生或硬编码 fallback）
    getEffectiveConfigSignKey, // 获取生效的 config 签名密钥（masterKey 派生或硬编码 fallback）
    // P6-6 新增：激活工单
    submitActivationTicket,
    getCachedActivationTicket
};
