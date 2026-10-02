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
const childProcess = require('child_process');
const { app } = require('electron');

// ★ 2026-09-11 阶段2 对称密钥轮换：V1 已随历史 APK/exe 泄露（可伪造本地加密文件/试用签名
//   /HMAC license）。[0] = V2 当前生效（所有写路径默认使用）；其余 = 兼容回退（读路径遍历，
//   读到旧密钥派生的文件后重存即自动迁移 V2）。license 验签按档位应用不同日落截断。
//   轮换此数组需四端（shared 权威源+4 副本+Java）+ KNOWLEDGE 同步。
const LICENSE_HMAC_KEYS = [
    'bnzc_tcm_license_v2_94b85c319098763ecd2797ece7995ecf82aada407fce7fe4',  // V2（2026-09-11 轮换）
    'bnzc_tcm_license_key_v1_2026'                                           // V1 legacy（已泄露，只读兼容）
];
// 写路径（加密/签名）默认取最新密钥；读路径遍历全部档位
const LICENSE_HMAC_KEY = LICENSE_HMAC_KEYS[0];
const DEFAULT_TRIAL_DAYS = 7;                                 // 默认试用期 7 天（可通过 trial-config.json 修改，测试时设为 0）
const TIME_TAMPER_THRESHOLD = 24 * 60 * 60 * 1000;           // 时间回拨阈值：1 天

// ★ 2026-09-11 阶段1b：HMAC 对称验签日落截断（与安卓 LicenseManager.java 统一，改动必须四端同步）
//   背景：硬编码 HMAC 密钥已随历史包泄露，攻击者可删 V5/V6/V7 字段走 HMAC 伪造 license。
//   规则：签发时间（issuedAt）≥ 此日期 且 无任何非对称签名字段的 license 一律拒绝。
//   服务端自 2026-08 起签发必带 V5/V6/V7，且 ensureLicenseV7 让存量联网一次即自愈升级，
//   截断日之后"合法却只有 HMAC"的 license 不存在（除伪造）。存量旧 license（issuedAt
//   早于截断日）照旧 HMAC 放行，180 天宽限不误伤。轮换此值需四端 + KNOWLEDGE 同步。
//   ★ 阶段2 语义：此值为 V2 档（最新密钥）截断日；V1 档见 LEGACY_HMAC_SUNSET_DATE。
const HMAC_SUNSET_DATE = '2027-03-31';

// ★ 2026-09-11 阶段2：V1（泄露密钥）档专用日落——V5 非对称签名 2026-07-21 上线后，服务端
//   再无合法 HMAC-only 签发；2026-08-01（上线+10 天部署缓冲）起仍"仅 V1 HMAC"的 license
//   唯一来源是用泄露密钥伪造。将 V1 档截断从 2027-03-31 收紧至此日，伪造窗口缩短 8 个月，
//   存量真文件（issuedAt 必然更早）零误伤。masterKey 分支同样应用此截断（masterKey 明文随
//   license 下发可被提取，不截断则成为绕过硬编码密钥档位的前门）。
const LEGACY_HMAC_SUNSET_DATE = '2026-08-01';

// ★ 任务2 新增：ECDSA P-256 验签公钥（PEM SPKI 格式）
// 用于验证 license 中的 signatureV5 字段（云端 ECDSA 私钥签发）
// 默认为空：未配置时跳过 v5 验签，仅用 HMAC v4（向后兼容）
// 启用步骤：
//   1. 运行 node tools/gen-ecdsa-keys.cjs 生成密钥对
//   2. 私钥 LICENSE_SIGN_PRIVATE_KEY 存 Cloudflare Secrets
//   3. 公钥（-----BEGIN PUBLIC KEY----- 整段）填入此常量
//   4. 重新打包 exe
const ECDSA_VERIFY_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEq+n38Pe0t0cDjNyoXTgXAyofbl01
sbaJBMVtUy6+MGwbFCo+YBY+mrmyRBweSL/e1bj9qsUHawEsR9B7PzYSBA==
-----END PUBLIC KEY-----`;

// ★ P1-[5.1][5.3] 新增：Ed25519 验签公钥（PEM SPKI 格式）
// 用于验证 license 中的 signatureV7 字段（云端 Ed25519 私钥签发）
// 与 ECDSA 公钥一样：公钥只能验签不能签发，即使被反编译提取也无法伪造 license
// 启用步骤：
//   1. 运行 node tools/gen-ed25519-keys.cjs 生成密钥对
//   2. 私钥 LICENSE_SIGN_ED25519_PRIVATE_KEY 存 Cloudflare Secrets
//   3. 公钥（-----BEGIN PUBLIC KEY----- 整段）填入此常量
//   4. 重新打包 exe
const ED25519_VERIFY_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAIsLN/+7riDHGQj8GAJBeU9kuSGXgVEiUYqvTlrbP2rw=
-----END PUBLIC KEY-----`;

// ★ 密钥轮换兼容（2026-08-26 修复）：轮换前的旧公钥（P0-2 于 2026-08-26 轮换全部非对称密钥对）
// 背景：轮换密钥后，客户端若只内置新公钥，存量用户 license（轮换前旧私钥签发的
//      signatureV5/V6/V7）在新版 exe 上验签必然失败 → fail-closed → 误报
//      "授权文件已损坏或被篡改"，把所有存量激活用户挡在门外（违反"宁可漏检不可误报"红线）。
// 修复：v5/v6/v7 验签按【新公钥 → 旧公钥】顺序尝试，任一通过即放行：
//   - 轮换后签发的 license → 新公钥验过 ✓
//   - 轮换前签发的存量 license → 旧公钥验过 ✓
//   - 篡改的 license → 两个公钥都验不过 → 仍 fail-closed 拒绝（非对称保护不降级）
// ⚠️ 下次密钥轮换时：把当前 ECDSA_VERIFY_PUBLIC_KEY_PEM / ED25519_VERIFY_PUBLIC_KEY_PEM
//    的值挪到这两个 legacy 常量，再生成新密钥对填入主常量（三公钥以内可依次追加）。
// ⚠️ 移除时机：存量 license 全部过期/重新激活后（建议保留 ≥1 个授权周期）。
const LEGACY_ECDSA_VERIFY_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEXqspDCFxlyS9wH0Kyb/fR9sqOeAG
DurLP5B6cwCvAhMF8Lvlzv9nnvdEWdY0+GytTCUsXWrBbDDgLrOufN1NNw==
-----END PUBLIC KEY-----`;

const LEGACY_ED25519_VERIFY_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA8bWOHTBevbhWdD//fkAOYOyWygIH97QUqlKEZzoiHzM=
-----END PUBLIC KEY-----`;

// ECDSA 验签公钥列表（新→旧依次尝试）
const ECDSA_VERIFY_PUBLIC_KEYS = [
    ECDSA_VERIFY_PUBLIC_KEY_PEM,
    LEGACY_ECDSA_VERIFY_PUBLIC_KEY_PEM
].filter(Boolean);

// Ed25519 验签公钥列表（新→旧依次尝试）
const ED25519_VERIFY_PUBLIC_KEYS = [
    ED25519_VERIFY_PUBLIC_KEY_PEM,
    LEGACY_ED25519_VERIFY_PUBLIC_KEY_PEM
].filter(Boolean);

const TRIAL_KEY = 'bnzc_trial_key_v1';
const LASTRUN_KEY = 'bnzc_lastrun_key_v1';

// ★ v3 新增：config.json 完整性签名密钥（与 edit-config.ps1 中 $CONFIG_SIGN_KEY 保持一致）
// 用于校验 config.json 中的 clinicName/doctorName 未被篡改。
// ★ 第四轮口径：静态密钥仅用于 v1 历史存量头验签；v2 usersSignature 一律机器绑定
// 密钥（getUsersSignKey），静态签名件不再具备 v2 采信资格（防跨机移植洗白）。
const CONFIG_SIGN_KEY = 'bnzc_config_sign_key_v1_2026';

// ★ 2026-09-26 I2：users-backup.json 独立签名密钥基（域分离，禁止与 config 签名互串）。
// 备份是 selfHeal/装码恢复账号时的权威来源，必须自带 HMAC，防备份投毒。
// ★ 第四轮：实际签名密钥=HKDF(本机指纹,'users-backup-sign',本基)（getUsersBackupSignKey），
// 机器绑定，攻击者自有安装产出的备份移植到他人机器验签必失败。
const USERS_BACKUP_SIGN_KEY = 'bnzc_users_backup_key_v1_2026';

// ★ 2026-09-26 备份采信收口（双重独立审查阻断项）：
// 无签名 legacy 备份只在该日期前写入的件、且仅在 v1 合法件上才允许采信；
// missing/unsigned 状态一律不接受 legacy（攻击者可自行制造这两种状态）。
// backupAt 可被回写，真正的硬防线是 gate.dat 内 usersBackupGen 单调锚点：
// 锚点一旦建立（新 exe 成功写过 v2 备份），legacy 永久退出采信。
const USERS_LEGACY_BACKUP_SUNSET = '2027-03-31';

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

// ★ 2026-09-26 第四轮（跨机移植阻断）：
//   usersSignature / users-backup 签名密钥【机器绑定】——HKDF 以本机
//   machineId+硬件指纹派生用途密钥。旧静态密钥下，攻击者可在自己合法安装上
//   伪造签名件（users+usersSignature 双字段替换 / 植入外来 users-backup.json）
//   后移植受害者机器洗白；机器绑定后无法为他人机器预签任何签名件。
//   换机/改硬件 → 签名失效 → 走既有客服恢复流程（与 license.dat 机器绑定同口径）。
//   注意：hkdfPurposeKey 为函数声明（提升），此处运行时可用。
function getUsersSignKey() {
    return hkdfPurposeKey(getMachineId(), 'users-sign', CONFIG_SIGN_KEY);
}
function getUsersBackupSignKey() {
    return hkdfPurposeKey(getMachineId(), 'users-backup-sign', USERS_BACKUP_SIGN_KEY);
}

// ★ 2026-09-26 阻断修复：旧全局盐 SHA256 快哈希（installLicense 激活建号、
// ensureLocalActivationUser 免费版补绑共用）。原声明在 installLicense 的
// if(phone) 块内为块级 const，ensureLocalActivationUser 引用必抛 ReferenceError，
// 免费版用户补绑手机号 100% 失败。现提升为模块级。
const PASSWORD_SALT = 'bnzc_prescription_salt_v1';
function hashOf(p) {
    return crypto.createHash('sha256').update(Buffer.from(PASSWORD_SALT + String(p), 'utf8')).digest('hex');
}

// ★ v2: 版本类型默认配置（功能差异矩阵）
// free: 离线免费版（2026-09-21 同包授权分档），永久授权、无限开方、无付费功能位
// trial: 试用版，限 30 张/月处方，无高级功能
// personal: 个人版，无限处方，支持数据备份
// pro: 专业版，无限处方，支持云端同步+多设备+优先支持
// voice: 语音版（2026-09-17 第一期），权益=个人版全部+语音输入，1年/1设备
// ★ free 设计：服务端签名下发、机器绑定、永久有效（expiresAt=2099-12-31，
//   复用到期判定，无需 perpetual 字段）；备份/数据导出/拍照录像/无水印打印
//   均为付费功能位（feature-guard + 主进程 IPC fail-closed 拦截）；edition
//   仍校正为 personal（单用户形态不变），版本标签按 licenseType=free 细分。
const LICENSE_TYPE_CONFIG = {
    free: {
        maxPrescriptions: 0,  // 0 = 无限（免费版开方不限量）
        features: []          // 不带任何付费功能位
    },
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
    },
    voice: {
        maxPrescriptions: 0,  // 0 = 无限
        features: ['backup', 'voice']
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

// ============================================================================
// ★ P3-预防重装：账号独立持久化备份
// 账号（users）当前存在 config.json 内，而 config 签名仅覆盖
// clinicName|doctorName|edition|configIssuedAt（users 不在签名范围内）。
// 为防止重装/清除 config.json 导致原账号密码丢失，
// 将 users 独立备份到 users-backup.json（与 config.json 同目录，随 userData 存活），
// 供 selfHeal 与 get-app-config 在 config 缺失/被清空时回填恢复账号。
// ============================================================================
function getUsersBackupPath() {
    try {
        return path.join(getWritableDir(), 'users-backup.json');
    } catch (e) {
        return path.join(app.getPath('userData'), 'users-backup.json');
    }
}

// ★ 2026-09-23 P0 登录闸门锚点：gate.dat（与 license.dat 同体系
//   AES-256 + HMAC 签名，密钥由 machineId+硬件指纹派生）。渲染端拿不到密钥，
//   只能通过 IPC 让主进程读写——防攻击者删键/改时间戳无限重置离线宽限。
function getGatePath() {
    try {
        return path.join(getWritableDir(), 'gate.dat');
    } catch (e) {
        return path.join(app.getPath('userData'), 'gate.dat');
    }
}
function readGateState(machineIdArg) {
    try {
        const p = getGatePath();
        if (!fs.existsSync(p)) return null;
        const enc = fs.readFileSync(p, 'utf8');
        const json = decryptLicenseContent(enc, machineIdArg || getMachineId());
        return json ? JSON.parse(json) : null;
    } catch (e) { return null; }
}
function writeGateState(state, machineIdArg) {
    try {
        fs.writeFileSync(getGatePath(),
            encryptLicenseContent(JSON.stringify(state), machineIdArg || getMachineId()),
            { mode: 0o600 });
        return true;
    } catch (e) {
        console.warn('[Gate] gate.dat 写入失败:', e && e.message);
        return false;
    }
}

// ★ 2026-09-26 users-backup 单调 gen：gate.dat 与二级锚点 .license-anchor 双写
//   （复用 09-23 登录闸门的双锚点；gate 在 writable/exe 目录、anchor 在 userData），
//   machineId 派生密钥加密，渲染端/攻击者无法伪造内容；单删任一文件无法重置。
//   防旧 v2 备份重放导致密码/角色回滚。
//
// ★★ 2026-09-29 云离锚点跨端污染修复（装机实测：离线新版首启误报"配置与备份
//   不一致"）：云端/离线是两个独立产品——各自 userData、各自 config.json 与
//   users-backup.json；但 vault 统一状态是机器级单键（BNZC/license-vault/<mid>），
//   旧设计把 usersBackupGen/usersLegacyRetired 存成共享标量。云端先升级运行会把
//   gen 推高（实测 71）并置 legacy 退役；离线之后全新安装，自己的合法 legacy
//   备份读到"对端的"高水位+退役标记 → legacyBackupUsable 永久 false → 迁移被判
//   修法：这两个【产品私有】字段改按产品域分键（usersBackupGenV2 /
//   usersLegacyRetiredV2）。旧共享标量从此不再推进，merge 时原样保留存量、
//   仅升级引导期在"本产品在场有 v2 备份"前提下条件继承（回退旧版读到的锚点
//   冻结在升级前水位，属有意取舍）；授权裁决类字段 everActivated/accountReject
//   等仍机器级共享，语义不变。
//   域键首次缺失时绝不回退旧共享标量（那正是污染源），改以本产品在场【签名有效
//   v2 备份】的 gen 引导一次高水位；无 v2 备份（全新安装/legacy 老件）即为 0，
//   legacy 老件在日落窗口内正常迁移——与"新机首装"安全语义等价。
// 产品域名必须用【精确白名单】：任何未知名（自定义 --user-data-dir、未来第三
// 产品、改名变体如 tcm-prescription-system）一律落 'default' 桶，绝不并入
// cloud/offline——否则未知产品可向真实产品域写高水位/退役标记（跨域 DoS），
// 也可能让真实产品被误分进对端域。注意多个未知名会共享 default 桶（非标准
// 部署彼此间仍有同类互抬水位的可能），但 cloud/offline 两个真实产品的锚点
// 与 default 物理隔离、绝不被未知名抬升，等价新机锚点语义。
// 残余边界：本机执行者可用 --user-data-dir 指定同名目录冒入真实域（影响方向
// fail-closed、需本机执行权，旧标量时代同样可直接推高共享锚点），纵深加固需
// 叠加渠道常量双因子，记为已知项。
const APP_DOMAIN_BY_USERDATA = {
    'tcm-prescription-cloud': 'cloud',
    'tcm-prescription': 'offline'
};
function getAppDomain() {
    if (_appDomainCache !== undefined) return _appDomainCache;
    let d = 'default';
    try {
        if (typeof app !== 'undefined' && app && typeof app.getPath === 'function') {
            const base = require('path').basename(String(app.getPath('userData') || '')).toLowerCase();
            if (Object.prototype.hasOwnProperty.call(APP_DOMAIN_BY_USERDATA, base)) {
                d = APP_DOMAIN_BY_USERDATA[base];
            }
        }
    } catch (e) { return 'default'; } // getPath 抛错（app 将就绪未就绪）：不缓存，允许后续重判；
    // 无 electron 运行时（typeof app==='undefined'）不抛错、落 default 并缓存——
    // 该环境下产品名永不变，缓存无害（生产主进程所有调用均在 app 可用之后）。
    _appDomainCache = d;
    return d;
}
let _appDomainCache;
// 域 map 合并：gen 按域取高水位；退役标记按域取或。
// null-proto + 仅接受三个白名单域键：blob 虽经机器密钥加密，仍做纵深防御，
// 杜绝 __proto__/constructor 等键进入 map 后在别处被普通对象读取触发原型访问。
const DOMAIN_KEY_WHITELIST = { cloud: 1, offline: 1, default: 1 };
function mergeDomainGenMaps(a, b) {
    const out = Object.create(null);
    [a, b].forEach(m => {
        if (m && typeof m === 'object') {
            Object.keys(m).forEach(k => {
                if (!Object.prototype.hasOwnProperty.call(DOMAIN_KEY_WHITELIST, k)) return;
                const v = Number(m[k]); if (v > 0) out[k] = Math.max(out[k] || 0, v);
            });
        }
    });
    return out;
}
function mergeDomainRetiredMaps(a, b) {
    const out = Object.create(null);
    [a, b].forEach(m => {
        if (m && typeof m === 'object') {
            Object.keys(m).forEach(k => {
                if (!Object.prototype.hasOwnProperty.call(DOMAIN_KEY_WHITELIST, k)) return;
                if (m[k] === true) out[k] = true;
            });
        }
    });
    return out;
}
// ★ 2026-09-30 三方独立审查（2 功能 + 1 安全，安全侧端到端实证）阻断项修复：
//   引导结论必须【耐久化】。域键缺失但本产品在场有签名有效 v2 备份时，该产品
//   历史上确已参与锚点体系，应把继承自旧共享标量的高水位/退役结论一次性固化进
//   本产品域 map——否则 backupUserAccounts 幂等短路（users 不变即不重写备份）使
//   域键长期缺失，攻击者（或杀软/清理工具隔离）删掉 users-backup.json 后引导条件
//   （在场 v2）不再成立，vault 里仍存的旧标量读不到，gen/退役双双塌缩为 0/false，
//   植入无签名 legacy 件 + 伪造 v1 config 即可把任意 users 洗白签成 v2 权威。
//   固化后裁决只认 V2 map，不再依赖在场备份文件存续，删文件攻击链断开。
//   一次性成本：仅"升级后首启且 users 无变更"触发一次补丁（gen+退役合并为一次
//   写）；此后哨位命中零 vault 往返。legacy/none/bad 在场（全新安装/从未跑过新版）
//   绝不固化——那是本次事故修复的豁免路径。
// ★ 2026-09-30 第二轮（云离并发审查）：退役固化不再依赖旧共享标量——在场机器
//   签名 v2 件本身就是"本产品写过 v2"的铁证，写过 v2 即永久退役 legacy；这使并发
//   整 blob 写抹掉退役键后可在任意锚点读路径自愈（新机上旧标量根本不存在）。
let _domainBootstrapDone = false;
let _domainBootstrapScheduled = false;
// 登录窗显示后延迟固化：3s 落在用户查看/输入密码期间（主进程冻结不挡窗前首帧，
// 2026-09-29 性能红线），同时把"首启→固化完成"换件竞态压到 3s 一次性窗口。
const DOMAIN_BOOTSTRAP_DELAY_MS = 3000;
// 域锚点本地哨位 .domain-anchor（纯性能缓存，绝非安全权威）：
//   内容 {v,dom,gen,retired,at,sig}，sig=HMAC(机器绑定备份签名钥,'sentinel|'…)，
//   攻击者无法为本机预签（与 v2 备份同级机器绑定），跨机/跨产品复制验签必失败。
//   命中即让定时器回调跳过 vault 冷读（实测单次 PS spawn 2.7s，稳态每启动省一次）；
//   删除/篡改只损失这次读，fail-safe；安全裁决永远只认 vault/双文件 V2 map。
function getDomainSentinelPath() {
    try { return path.join(app.getPath('userData'), '.domain-anchor'); }
    catch (e) { return ''; }
}
function readDomainSentinel(dom) {
    try {
        const p = getDomainSentinelPath();
        if (!p || !fs.existsSync(p)) return null;
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (!j || j.v !== 1 || j.dom !== dom) return null;
        const gen = Number(j.gen) || 0;
        const retired = j.retired === true;
        const at = Number(j.at) || 0;
        const payload = '1|' + dom + '|' + gen + '|' + (retired ? '1' : '0') + '|' + at;
        const sig = crypto.createHmac('sha256', getUsersBackupSignKey())
            .update('sentinel|' + payload).digest('hex');
        if (!hexSignatureMatches(j.sig, sig)) return null;
        return { gen: gen, retired: retired };
    } catch (e) { return null; }
}
function writeDomainSentinel(dom, gen, retired) {
    try {
        const p = getDomainSentinelPath();
        if (!p) return;
        const at = Date.now();
        const g = Number(gen) || 0;
        const rt = retired === true;
        const payload = '1|' + dom + '|' + g + '|' + (rt ? '1' : '0') + '|' + at;
        const sig = crypto.createHmac('sha256', getUsersBackupSignKey())
            .update('sentinel|' + payload).digest('hex');
        fs.writeFileSync(p, JSON.stringify({ v: 1, dom: dom, gen: g, retired: rt, at: at, sig: sig }),
            { mode: 0o600 });
    } catch (e) { /* 哨位写失败仅损失一次 PS 读，不影响安全 */ }
}
// 用持有的统一态快照（刚读/刚写，缓存命中零 PS）刷新哨位
function syncDomainSentinel(dom, s) {
    try {
        const g = Number(s && s.usersBackupGenV2 && s.usersBackupGenV2[dom]) || 0;
        const rt = !!(s && s.usersLegacyRetiredV2 && s.usersLegacyRetiredV2[dom] === true);
        writeDomainSentinel(dom, g, rt);
    } catch (e) { /* 忽略 */ }
}
function ensureDomainBootstrap(mid) {
    if (_domainBootstrapDone) return;
    _domainBootstrapDone = true; // 失败也只在本进程尝试一次（异常不缓存于跨进程：重启自然重试）
    try {
        const r = readUnifiedState(mid);
        const s = r.state || null;
        const dom = getAppDomain();
        const genDone = !!(s && s.usersBackupGenV2 && Number(s.usersBackupGenV2[dom]) > 0);
        const retiredDone = !!(s && s.usersLegacyRetiredV2 && s.usersLegacyRetiredV2[dom] === true);
        if (genDone && retiredDone) { syncDomainSentinel(dom, s); return; }
        const inPlace = inspectUsersBackup();
        if (inPlace.trusted !== 'v2') {
            // legacy/none/bad：新机语义，绝不把旧标量归域（离线全新装豁免路径）；
            // 落"负哨位"（gen=0）让后续启动定时器跳过 vault 冷读。
            syncDomainSentinel(dom, s);
            return;
        }
        // 在场机器签名 v2 件=本产品确已写过 v2：
        //  gen seed=max(在场件 gen, 旧共享标量, 当前域键)，只抬不降（兜底 1：v2
        //  首件；域键被物理整 blob 覆盖回滚为旧值时也由此抬回真水位）；
        //  retired 直接置 true（写过 v2 即永久退役 legacy；并发抹键后据此自愈）。
        const patch = {};
        const curGen = Number(s && s.usersBackupGenV2 && s.usersBackupGenV2[dom]) || 0;
        const seed = Math.max(Number(inPlace.gen) || 0, Number(s && s.usersBackupGen) || 0, curGen, 1);
        if (seed > curGen) {
            patch.usersBackupGenV2 = Object.assign({}, (s && s.usersBackupGenV2) || null, { [dom]: seed });
        }
        if (!retiredDone) {
            patch.usersLegacyRetiredV2 = Object.assign({}, (s && s.usersLegacyRetiredV2) || null, { [dom]: true });
        }
        if (Object.keys(patch).length) {
            patchUnifiedState(patch, mid);
            const r2 = readUnifiedState(mid); // 写成功已回填缓存，零 PS
            syncDomainSentinel(dom, r2.state);
        }
    } catch (e) { /* 固化失败不阻断：调用方退回内存引导，下次启动重试；哨位不写 */ }
}
// ★ 2026-10-01 性能：ensureDomainBootstrap 的全异步镜像（prewarmGate 后台预固化
//   专用）。与同步版共享 _domainBootstrapDone——两者在本进程都只尝试一次，先到者
//   占位，失败语义也与同步版一致（退回内存引导，下次启动重试）。读写全走异步
//   vault 链，绝不 spawn 同步 PowerShell 冻结主进程/登录链。
async function ensureDomainBootstrapAsync(mid) {
    if (_domainBootstrapDone) return;
    _domainBootstrapDone = true;
    try {
        const r = await readUnifiedStateAsync(mid);
        const s = r.state || null;
        const dom = getAppDomain();
        const genDone = !!(s && s.usersBackupGenV2 && Number(s.usersBackupGenV2[dom]) > 0);
        const retiredDone = !!(s && s.usersLegacyRetiredV2 && s.usersLegacyRetiredV2[dom] === true);
        if (genDone && retiredDone) { syncDomainSentinel(dom, s); return; }
        const inPlace = inspectUsersBackup();
        if (inPlace.trusted !== 'v2') {
            // legacy/none/bad：新机语义，落负哨位（gen=0）让后续定时器跳过冷读
            syncDomainSentinel(dom, s);
            return;
        }
        const patch = {};
        const curGen = Number(s && s.usersBackupGenV2 && s.usersBackupGenV2[dom]) || 0;
        const seed = Math.max(Number(inPlace.gen) || 0, Number(s && s.usersBackupGen) || 0, curGen, 1);
        if (seed > curGen) {
            patch.usersBackupGenV2 = Object.assign({}, (s && s.usersBackupGenV2) || null, { [dom]: seed });
        }
        if (!retiredDone) {
            patch.usersLegacyRetiredV2 = Object.assign({}, (s && s.usersLegacyRetiredV2) || null, { [dom]: true });
        }
        if (Object.keys(patch).length) {
            await patchUnifiedStateAsync(patch, mid);
            const r2 = await readUnifiedStateAsync(mid); // 写成功已回填缓存，零 PS
            syncDomainSentinel(dom, r2.state);
        }
    } catch (e) { /* 固化失败不阻断：调用方退回内存引导 */ }
}
// 幂等稳态（备份 v2 且 users 全等、直接短路）路径专用：延迟一次性固化，
// 绝不在登录窗/主窗首帧链路同步 spawn PowerShell（2026-09-29 性能修复红线）。
function scheduleDomainBootstrap(mid) {
    if (_domainBootstrapDone || _domainBootstrapScheduled) return;
    _domainBootstrapScheduled = true;
    try {
        // 开发态/测试可经环境变量缩短延迟（仅时序，无安全后果：延迟越短越保守）
        const ev = Number(process.env.BNZC_DOMAIN_BOOTSTRAP_DELAY_MS);
        const delay = Number.isFinite(ev) && ev >= 0 ? ev : DOMAIN_BOOTSTRAP_DELAY_MS;
        setTimeout(() => {
            try {
                // 哨位命中（含 gen=0 新机负哨位）：零 vault 往返直接结案。
                // 但加一次纯文件级漂移校验（无 PS）：物理整 blob 覆盖后自愈路径
                // 可能写出"gen 已抬/退役缺位"的降级哨位，或在场真件水位已高于
                // 哨位——此时回退完整 ensure 耐久补齐；legacy/none 在场不触发
                // （新机豁免语义不变）。
                const st0 = readDomainSentinel(getAppDomain());
                if (st0) {
                    let drift = false;
                    try {
                        const ip0 = inspectUsersBackup();
                        if (ip0.trusted === 'v2'
                            && ((Number(ip0.gen) || 0) > st0.gen || st0.retired !== true)) {
                            drift = true;
                        }
                    } catch (e) { /* 文件不可读按无漂移处理，安全读路径另有自愈 */ }
                    if (!drift) { _domainBootstrapDone = true; return; }
                }
            } catch (e) { /* 哨位异常走完整检查 */ }
            ensureDomainBootstrap(mid);
        }, delay);
    } catch (e) { ensureDomainBootstrap(mid); /* 无定时器环境：同步兜底固化 */ }
}
function readUsersBackupGen(machineIdArg) {
    try {
        const mid = machineIdArg || getMachineId();
        // ★ M-2：gen 随统一状态存储（vault 优先）
        const r0 = readUnifiedState(mid);
        const dom = getAppDomain();
        const g0 = Number(r0.state && r0.state.usersBackupGenV2 && r0.state.usersBackupGenV2[dom]);
        if (g0 > 0) {
            // ★ 2026-09-30 M3 自愈：云离并发整 blob CredWrite 的读-写残余窗口
            //   （fresh 读与写入是两次独立 PS spawn）理论上可把本域键回滚为旧值。
            //   在场机器签名 v2 件是本机真水位——攻击者无法签出更高件、只能放更
            //   旧件（更旧则不抬升），故 inPlace.gen 更高时立即抬回。正常态两者
            //   恒等，不产生任何写入（inspect 仅文件级 HMAC，无 PS）。
            try {
                const ip = inspectUsersBackup();
                if (ip.trusted === 'v2') {
                    const bg = Number(ip.gen) || 0;
                    if (bg > g0) {
                        // ★ 2026-10-01 性能：自愈抬升改异步写（原同步 PS 写实测在
                        //   登录 rename 备份链上与 persist 写并发竞争 CredMan/PS，
                        //   单点冻结 5s+）。抬升依据是在场机器签名 v2 件（攻击者签
                        //   不出更高件），晚数百 ms 落 vault 无安全窗口——本次直接
                        //   返回 bg 供调用方签 bg+1 新件，下一次读自愈路径仍会兜底
                        //   抬升；写由 _vaultWriteChain 串行，与其他写保序合并不覆盖。
                        writeUsersBackupGenAsync(bg, mid).catch(() => {});
                        try { syncDomainSentinel(dom, readUnifiedState(mid).state); } catch (e2) { /* 忽略 */ }
                        return bg;
                    }
                }
            } catch (e) { /* 文件异常以 vault 键为准 */ }
            return g0;
        }
        // 域键缺失：先尝试一次性引导固化（在场 v2 才固化，防删备份塌缩锚点）
        ensureDomainBootstrap(mid);
        const r = readUnifiedState(mid);
        const g = Number(r.state && r.state.usersBackupGenV2 && r.state.usersBackupGenV2[dom]);
        if (g > 0) return g;
        // 未固化（legacy/无备份在场）内存引导：
        //  ① 本产品在场有签名有效 v2 备份 → 历史上参与过旧共享标量推进，继承
        //     标量高水位与本地 gen 取大——只抬高不降低，防回滚相对旧版零降级；
        //  ② 仅 legacy/无备份（如离线全新安装、从未跑过新版）→ 从未参与锚点
        //     体系，旧标量是对端污染值，绝不继承，从 0 开始，合法 legacy 老件
        //     在日落窗口内正常迁移。
        try {
            const inPlace = inspectUsersBackup();
            if (inPlace.trusted === 'v2') {
                const bg = Number(inPlace.gen) || 0;
                const scalar = Number(r.state && r.state.usersBackupGen) || 0;
                return Math.max(bg, scalar);
            }
        } catch (e) { /* 无在场 v2 件 → 0（新机/legacy 老件） */ }
        return 0;
    } catch (e) { return 0; }
}
function writeUsersBackupGen(gen, machineIdArg) {
    try {
        const mid = machineIdArg || getMachineId();
        const n = Number(gen);
        if (!(n > 0)) return false;
        const dom = getAppDomain();
        // 单调高水位补丁（uncertain 时落文件，不覆盖 vault）
        const r = readUnifiedState(mid);
        const cur = Number(r.state && r.state.usersBackupGenV2 && r.state.usersBackupGenV2[dom]) || 0;
        if (cur >= n) return true;
        const newMap = Object.assign({}, (r.state && r.state.usersBackupGenV2) || null, { [dom]: n });
        return patchUnifiedState({ usersBackupGenV2: newMap }, mid);
    } catch (e) {
        console.warn('[Gate] usersBackupGen 写入失败（非致命）:', e && e.message);
        return false;
    }
}

// ★ 2026-09-26 legacy 永久退役标记（双锚点 sticky）：新 exe 一旦写过 v2 备份
//   即置位，此后无签名 legacy 备份一律不可采信；单删任一文件无法复位。
//   ★ 第四轮残留风险评估（机器绑定后收窄）：备份 v2 签名已机器绑定，攻击者无法
//   为受害者机器预签任何 v2 备份；"双删锚点+植入旧件"只剩无签名 legacy 路径，
//   而 legacy 采信需 anchor 未建立+未退役+日落窗口内三条件同成立，可利用窗口
//   已收敛到真实 v1 老机升级场景（基线等价性论证记 KNOWLEDGE）。
function legacyRetired(machineIdArg) {
    try {
        const mid = machineIdArg || getMachineId();
        // ★ 2026-09-26 M-2：退役标记随统一状态存储
        // ★ 2026-09-29：按产品域读取（云端退役不连坐离线新装）；旧共享标量
        //   仅在本产品在场确有 v2 备份（=本产品确实写过 v2）时继承，只收紧
        // ★ 2026-09-30：域键缺失先做引导耐久化（gen+退役一次补丁），固化后
        //   只认 V2 map——删/换 users-backup.json 无法撤销退役（H-1 攻击链）
        const r0 = readUnifiedState(mid);
        const dom = getAppDomain();
        if (r0.state && r0.state.usersLegacyRetiredV2 && r0.state.usersLegacyRetiredV2[dom] === true) return true;
        ensureDomainBootstrap(mid);
        const r = readUnifiedState(mid);
        if (r.state && r.state.usersLegacyRetiredV2 && r.state.usersLegacyRetiredV2[dom] === true) return true;
        // 未固化（legacy/无备份在场）：旧标量不继承
        if (r.state && r.state.usersLegacyRetired === true) {
            try {
                const inPlace = inspectUsersBackup();
                if (inPlace.trusted === 'v2') return true;
            } catch (e) { /* 无法核验 → 不继承 */ }
        }
        return false;
    } catch (e) { return false; }
}
function markLegacyRetired(machineIdArg) {
    try {
        const mid = machineIdArg || getMachineId();
        const dom = getAppDomain();
        const r = readUnifiedState(mid);
        if (r.state && r.state.usersLegacyRetiredV2 && r.state.usersLegacyRetiredV2[dom] === true) return true;
        // 退役补丁（uncertain 时落文件，不覆盖 vault）
        const newMap = Object.assign({}, (r.state && r.state.usersLegacyRetiredV2) || null, { [dom]: true });
        const ok = patchUnifiedState({ usersLegacyRetiredV2: newMap }, mid);
        if (ok) syncDomainSentinel(dom, readUnifiedState(mid).state); // 缓存命中零 PS
        return ok;
    } catch (e) {
        console.warn('[Gate] legacyRetired 标记失败（非致命）:', e && e.message);
        return false;
    }
}

// ★ 2026-09-26 I2：备份文件 users 的独立 HMAC（stableStringify 在本文件后文定义，
// 函数声明提升，运行时可用）。
// ★ 2026-09-26 gen 绑定：签名必须覆盖 gen——gen 若在签名外，攻击者拿到旧 v2
// 备份只改 gen 字段即可冒充新件，单调锚点失效。签名内容=gen|stableStringify(users)。
// ★ 第四轮：签名密钥机器绑定（getUsersBackupSignKey）——攻击者自有安装产出的
// 合法 v2 备份移植到受害者机器后验签必失败（trusted='bad'），回填/证明链全断。
function computeUsersBackupSignature(users, gen) {
    const list = Array.isArray(users) ? users : [];
    const genPart = String(typeof gen === 'number' ? gen : Number(gen) || 0);
    return crypto.createHmac('sha256', getUsersBackupSignKey())
        .update(genPart + '|' + stableStringify(list)).digest('hex');
}

// 检查 users-backup.json，返回 { trusted, users }：
//   trusted='v2'    有独立签名且验签通过（权威）
//   trusted='legacy' 旧版无签名备份（仅一个升级周期内的兼容窗口，调用方按场景采信）
//   trusted='bad'   有签名但验签失败/文件损坏（疑似投毒，禁止采信）
//   trusted='none'  备份不存在
function inspectUsersBackup() {
    try {
        const p = getUsersBackupPath();
        if (!fs.existsSync(p)) return { trusted: 'none', users: [] };
        const backup = JSON.parse(fs.readFileSync(p, 'utf8'));
        const users = backup && Array.isArray(backup.users) ? backup.users : [];
        if (typeof backup.usersSignature === 'string' && backup.usersSignature.length > 0) {
            if (hexSignatureMatches(backup.usersSignature,
                computeUsersBackupSignature(users, backup.gen))) {
                return { trusted: 'v2', users, backupAt: backup.backupAt, gen: backup.gen };
            }
            console.warn('[License] users-backup.json 签名校验失败（疑似投毒），备份不可采信');
            return { trusted: 'bad', users: [] };
        }
        return { trusted: 'legacy', users, backupAt: backup.backupAt, gen: backup.gen };
    } catch (e) {
        return { trusted: 'bad', users: [] };
    }
}

// 将当前 config 中的 users 备份到独立文件（非关键路径，失败可安全跳过）
// ★ 2026-09-26 阻断修复（双重独立三审共识：备份毒化链）：
//   ① 写入单调 gen 并双持久化 gate.dat + .license-anchor（machineId 密钥加密，
//      攻击者无法伪造内容；单删任一文件不失效），旧件重放（密码/角色回滚）在
//      回填/证明处被 gen 新鲜度拒绝；
//   ② 已有可验证 v2 备份时，新 users 必须包含旧备份全部条目（旧为新的子集）
//      才允许覆写——防应用自身给未验签 users 签出合法备份（毒化洗白）；
//   ③ 锚点已建立但备份文件缺失（攻击者删备份制造竞态）→ 拒绝写入；
//   ④ options.proven=true：调用方已对【同一份 config】过 configUsersProvenAuthentic
//      闸门、本次写盘是已认证变更（改密/改名/移除幽灵账号），允许推进备份
//      （含条目变少），解决"合法改密→超集校验拒绝→备份永久陈旧→损坏后旧哈希回填"。
//   非 proven 路径截断保护（新列表条数变少不覆写）保留。
function backupUserAccounts(config, options) {
    options = options || {};
    // ★ 2026-10-01 根修（冷机登录窗冻结残余路径）：asyncVault 模式把【整条证明链】
    //   延后到预热读（prewarmGate 发起的 readUnifiedStateAsync，in-flight 单飞）
    //   回填缓存之后再执行。此前实现只把链尾两次 vault 写改异步，但链上的
    //   readUsersBackupGen×3 仍是同步 execFileSync——冷机 PowerShell 5.1 冷启动
    //   8~14s 期间（登录窗 get-app-config / whenReady 校正链与 prewarm 并发），
    //   同步 PS 会把整个主进程冻结，登录窗迟显、IPC 排队错层。延后后：
    //   ① 调用点（get-app-config IPC / 登录弱哈希升级 rename 链）立即返回，零冻结；
    //   ② await 到的是 prewarm 同一个 in-flight Promise，不额外 spawn PS；
    //   ③ 续跑时 30s 缓存必热，同步证明链全走 existsSync/内存，毫秒完成，链尾
    //      gen+退役仍是单次异步补丁；
    //   ④ 安全实质不变：调用点 cfg.users 已经 configUsersProvenAuthentic 证明
    //      （rename/校正传 proven:true），v2 备份件晚数百 ms~数秒落盘只影响
    //      "此窄窗内 config 同时被删"的可用性（权威 config 仍在），无绕过面，
    //      锚点有 M3 在场件自愈；读失败时降级直接执行（=旧行为，正确优先）。
    if (options.asyncVault === true && options.__deferred !== true) {
        let mid2 = '';
        try { mid2 = getMachineId(); } catch (e) { mid2 = ''; }
        const reentry = () => {
            try {
                backupUserAccounts(config, Object.assign({}, options, { __deferred: true }));
            } catch (e) {
                console.warn('[License] 异步备份延后链执行失败（非致命）:', e && e.message);
            }
        };
        if (mid2 && typeof readUnifiedStateAsync === 'function') {
            Promise.resolve(readUnifiedStateAsync(mid2)).then(reentry, reentry);
        } else {
            setImmediate(reentry);
        }
        return true;
    }
    try {
        if (!config || !Array.isArray(config.users) || config.users.length === 0) return false;
        const proven = options.proven === true;
        const newUsers = config.users;
        const bp = getUsersBackupPath();
        let oldBackup = null;
        let oldMissing = false;
        try {
            if (fs.existsSync(bp)) {
                oldBackup = JSON.parse(fs.readFileSync(bp, 'utf8')) || null;
                // ★ 截断保护：新列表条数少于旧备份不覆盖，防异常截断冲掉好备份。
                //   proven 变更（移除幽灵账号/合法删号）允许变少。
                if (!proven && oldBackup && Array.isArray(oldBackup.users)
                    && oldBackup.users.length > newUsers.length) {
                    console.warn('[License] backupUserAccounts 跳过：当前账号数 ' + newUsers.length
                        + ' 少于备份 ' + oldBackup.users.length + '，保留原备份');
                    return false;
                }
            } else {
                oldMissing = true;
            }
        } catch (oe) { oldBackup = null; oldMissing = true; /* 旧件损坏 → 允许覆写 */ }

        // ★ 2026-09-29 性能幂等：在场已是签名有效 v2 件且 users 与当前逐字段一致时，
        //   直接短路——不写盘、不推进 gen、不读写 vault（Windows 凭据管理器经
        //   execFileSync 同步往返，实测单次 2.7s；get-app-config 在登录窗/主窗启动
        //   必调，旧实现账号一字未改也要 vault 读+写各一次，冻结主进程 5s+，导致
        //   登录窗迟显、show/关窗消息排队错层闪烁，gen 每分钟空涨数代）。
        //   安全性等价：同内容刷新不改变任何密码哈希/角色/条目，也不签发新东西，
        //   锚点不推进无损防回滚（内容相同的旧件重放零收益）；账号真增减/改密/改名
        //   时 users 必变，相等检查不通过，自动走下方完整证明+写入路径。
        //   仅信任验签通过的 v2 件（机器绑定 HMAC），legacy/bad/损坏件不短路。
        try {
            const inPlace0 = inspectUsersBackup();
            if (inPlace0.trusted === 'v2' && usersListsEqual(newUsers, inPlace0.users)) {
                // 同步性能红线不破：引导耐久化（升级首启一次性 gen/退役固化，
                // 防删备份塌缩锚点）延迟到主窗显示后异步执行一次。
                scheduleDomainBootstrap(getMachineId());
                return true;
            }
        } catch (ie) { /* 校验异常按原完整路径处理 */ }

        if (!proven) {
            // ★ 第四轮（J1 纵深）：gen 锚点已建立时，在场备份必须是【新鲜 v2 件】
            //   才允许非 proven 覆写。否则（legacy/bad/陈旧 gen/缺失）一律拒绝——
            //   合法流中锚点建立后在场备份总与锚点同 gen（新鲜 v2），此分支只拦
            //   "锚点在而备份被替换/回滚/删除"的攻击与竞态，正常路径不可达。
            if (readUsersBackupGen() > 0) {
                const inPlace = inspectUsersBackup();
                if (!(inPlace.trusted === 'v2' && backupGenFresh(inPlace))) {
                    console.warn('[License] backupUserAccounts 拒绝：gen 锚点已建立但在场备份非新鲜 v2 件'
                        + '(trusted=' + inPlace.trusted + ')，防备份替换/回滚洗白');
                    return false;
                }
            }
            // 旧件是 v2 签名件：新 users 必须是旧备份的超集（usersProvenByBackup(old,new)），
            // 未验签新增/改字段条目会让检查失败 → 拒绝覆写（防毒化）。
            // 旧件 legacy 无签名，不作此约束（调用方必须已先过 configUsersProvenAuthentic）。
            if (oldBackup && typeof oldBackup.usersSignature === 'string') {
                let oldV2 = null;
                try {
                    if (hexSignatureMatches(oldBackup.usersSignature,
                        computeUsersBackupSignature(oldBackup.users, oldBackup.gen))) {
                        oldV2 = oldBackup;
                    }
                } catch (_) { oldV2 = null; }
                if (oldV2 && !usersProvenByBackup(oldV2.users, newUsers)) {
                    console.warn('[License] backupUserAccounts 拒绝覆写：新 users 含旧 v2 备份无法证明的条目（防毒化）');
                    return false;
                }
            }
            // ★ 阻断修复（复审发现 2）：gen 锚点已建立但备份缺失/不可解析——
            //   攻击者删备份可让超集校验整体跳过（竞态实证）→ 无证明不签。
            if ((oldMissing || !oldBackup) && readUsersBackupGen() > 0) {
                console.warn('[License] backupUserAccounts 拒绝：gen 锚点已建立但备份缺失（防删备份竞态洗白）');
                return false;
            }
        }

        const anchorGen = readUsersBackupGen();
        const gen = (typeof anchorGen === 'number' && anchorGen > 0) ? anchorGen + 1 : 1;
        const backup = {
            backupAt: new Date().toISOString(),
            gen: gen,
            users: newUsers,
            usersSignature: computeUsersBackupSignature(newUsers, gen)
        };
        fs.writeFileSync(bp, JSON.stringify(backup, null, 2), { mode: 0o600 });
        // ★ 2026-10-01 启动性能：options.asyncVault=true（get-app-config 启动备份
        //   刷新 / 登录时弱哈希升级 PBKDF2 的 rename 链 proven 刷新）时，gen+退役
        //   合并为【单次】异步补丁后台完成，不阻塞登录：一次 CredWrite 两键齐落，
        //   既省一次 1.5~9s 的 PS 往返，也从结构上消除两个兄弟写背靠背入队、后写
        //   旧快照回退前写的面。两类调用点 config 重签写盘+v2 备份文件（机器绑定
        //   HMAC）均已同步落盘，仅锚点延后，且 rename 链随后 verifyLoginGate 经
        //   写链保序；读路径带 M3 自愈与在场 v2 件水位抬升，安全语义不变。
        //   启动安全翻转（v1 迁移/重装自愈/版本绑定校正）与改密/删号/激活等交互
        //   路径不传此项，保持同步写满语义零窗口。
        if (options.asyncVault === true) {
            const __dom = getAppDomain();
            // ★ mid 必传：缺失会使异步读走跨 mid 候选合并分支（把 primary blob
            //   当旧 mid 残留删除 + 补丁写到 undefined 目标，灾难级，冒烟实证）。
            patchUnifiedStateAsync({
                usersBackupGenV2: { [__dom]: gen },
                usersLegacyRetiredV2: { [__dom]: true } // v2 备份一旦写过，legacy 永久退役
            }, getMachineId()).catch(() => {});
        } else {
            writeUsersBackupGen(gen);
            markLegacyRetired();
        }
        return true;
    } catch (e) {
        console.warn('[License] backupUserAccounts 失败（非致命）:', e.message);
        return false;
    }
}

// 从独立备份读取 users（保持导出名，返回 inspectUsersBackup 的结构化结果）
function loadUserAccountBackup() {
    return inspectUsersBackup();
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
function getMachineId(hwFpOverride) {
    try {
        // 1. 硬件特征（主体，规则3要求"多硬件哈希串"）
        // 优先使用 getHardwareFingerprint（MachineGuid + 主板 + CPU）
        let hwFp = '';
        if (hwFpOverride !== undefined) {
            hwFp = hwFpOverride; // 显式指定（mid 候选用），跳过磁盘回退
        } else {
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
                const dskOut = tryWmicExec('wmic diskdrive get serialnumber', 2000);
                if (dskOut) {
                    const lines = dskOut.split('\n').map(s => s.trim())
                        .filter(s => s && s.toLowerCase() !== 'serialnumber');
                    if (lines.length > 0 && lines[0]) diskParts.push('dsk=' + lines[0]);
                }
                if (diskParts.length > 0) {
                    hwFp = require('crypto').createHash('sha256')
                        .update(diskParts.join('|')).digest('hex');
                }
            } catch (e) { /* 忽略 */ }
          }
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
// ★ 2026-10-01 wmic 退役：Win11 24H2 起系统不再附带 wmic.exe，每次 execSync
//   都快速失败（~40ms/次 × 每启动 6 次）并刷 stderr 噪声；detectWmicGone 后
//   永久跳过，老系统（wmic 存在）行为不变。
let _wmicAvailable = null;
function tryWmicExec(cmd, timeoutMs) {
    if (_wmicAvailable === false) return null;
    try {
        const out = require('child_process').execSync(cmd,
            { timeout: timeoutMs || 4000, windowsHide: true }).toString();
        if (_wmicAvailable === null) _wmicAvailable = true;
        return out;
    } catch (e) {
        // 9009=Windows"不是内部或外部命令"；ENOENT=spawn 找不到——均为 wmic 已移除，
        // 判定永久不可用；超时/其他非零退出保持未知（老机瞬态失败可重试）
        if (_wmicAvailable === null
            && (e && (e.code === 'ENOENT' || e.status === 9009))) {
            _wmicAvailable = false;
        }
        return null;
    }
}
let _hardwareFingerprintCache = null;
// ★ 2026-10-02 启动性能：首次指纹采集已 reg query 过一次 MachineGuid，
//   getHwFingerprintVariants 的 mg-only 候选直接复用，启动链再省一次 reg
//   进程（本机 ~50ms，慢机/杀软下可达数百 ms）。null=尚未拿到（variants 仍
//   可按旧逻辑自查 reg 一次，保留瞬态失败的独立重试语义）；字符串=已拿到
//   的小写 guid。
let _machineGuidCache = null;
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
            // 仅成功时缓存：失败/正则不匹配保持 null，variants 自查兜底行为同旧版
            if (m) {
                _machineGuidCache = m[1].toLowerCase();
                parts.push('mg=' + _machineGuidCache);
            }
        } catch (e) { /* 保持 _machineGuidCache = null，variants 可独立重试 */ }
        // 2. 主板序列号（硬件固定，VM 克隆时可能为空或默认值）
        {
            const out = tryWmicExec('wmic baseboard get serialnumber', 2000);
            if (out) {
                const lines = out.split('\n').map(s => s.trim())
                    .filter(s => s && s.toLowerCase() !== 'serialnumber');
                if (lines.length > 0 && lines[0]) parts.push('bb=' + lines[0]);
            }
        }
        // 3. CPU ID（硬件固定，VM 克隆时可能变化）
        {
            const out = tryWmicExec('wmic cpu get processorid', 2000);
            if (out) {
                const lines = out.split('\n').map(s => s.trim())
                    .filter(s => s && s.toLowerCase() !== 'processorid');
                if (lines.length > 0 && lines[0]) parts.push('cpu=' + lines[0]);
            }
        }
        _hardwareFingerprintCache = parts.length === 0 ? '' :
            crypto.createHash('sha256').update(parts.join('|')).digest('hex');
    } catch (e) {
        _hardwareFingerprintCache = '';
    }
    return _hardwareFingerprintCache;
}

// ============================================================================
//  ★ P1-[2.1] 密钥三层 + HKDF 改造（本地文件加密密钥派生升级，2026-08-19）
//
//  三层结构（RFC 5869 HKDF-SHA256）：
//    第一层 根密钥 IKM     = LICENSE_HMAC_KEY（静态主密钥，与激活码签名链路共用常量，不改动）
//    第二层 设备主密钥 PRK = HKDF-Extract(salt = 设备指纹(machineId|hwFp), IKM)
//                          绑定到具体设备：破解一台不影响其他机器、防跨机复制
//    第三层 用途密钥 OKM   = HKDF-Expand(PRK, info = 'bnzc:local-file:v1:<用途>', 32)
//                          license / license-hmac / trial / lastrun 各用途域分离，
//                          单一用途密钥泄露不会波及其他本地文件
//
//  说明：
//    1) 仅升级“本地文件加密”的密钥派生（license.dat / trial.dat / last-run.dat）；
//       激活码签名链路（HMAC 签名 / ECDSA v5 验签）完全不动 → 已发激活码零影响。
//    2) 旧 SHA256 派生保留为回退：存量加密文件仍可读取（HKDF → SHA256含hwFp → SHA256无hwFp
//       三级回退），读到后重新保存即自动迁移为 HKDF 派生。
//    3) 与 Java 端 LicenseManager.java 的 RFC5869 实现算法完全一致，便于跨端对齐验证。
// ============================================================================
const HKDF_SALT_PREFIX = 'bnzc:local:';
const HKDF_INFO_PREFIX = 'bnzc:local-file:v1:';

// RFC 5869 HKDF 一步完成（crypto.hkdfSync = Extract + Expand）
// keylen 默认 32（AES-256 / HMAC-SHA256 密钥长度）
function hkdfSha256(ikm, salt, info, keylen) {
    return crypto.hkdfSync('sha256',
        Buffer.from(ikm, 'utf8'),
        Buffer.from(salt, 'utf8'),
        Buffer.from(info, 'utf8'),
        keylen || 32);
}

// 第三层：用途密钥（域分离，info 带独立前缀防止与激活码签名链路混淆）
// ★ 阶段2：可选 ikm 参数——写路径不传（默认最新密钥 V2）；读路径按档位遍历生成候选，
//   存量旧密钥派生的文件读取成功后重存即自动迁移 V2
function hkdfPurposeKey(machineId, purpose, ikm, hwFpOverride) {
    const hwFp = (hwFpOverride !== undefined) ? hwFpOverride : getHardwareFingerprint();
    const salt = HKDF_SALT_PREFIX + (machineId || '') + '|' + (hwFp || '');
    return hkdfSha256(ikm || LICENSE_HMAC_KEY, salt, HKDF_INFO_PREFIX + purpose, 32);
}

// 指纹候选：当前采集值 + 仅 MachineGuid。Win11 24H2 起 wmic 被移除、旧机
// 采集抖动（2s 超时）都会让指纹退化为 mg-only——解密时逐一尝试避免击穿
let _hwFpVariantsCache = null;
function getHwFingerprintVariants() {
    if (_hwFpVariantsCache) return _hwFpVariantsCache;
    const list = [];
    const primary = getHardwareFingerprint();
    if (primary) list.push(primary);
    // mg-only 候选（重算一次只含 MachineGuid 的指纹）
    // ★ 2026-10-02：优先复用首次指纹采集已查到的 MachineGuid（_machineGuidCache），
    //   避免启动链第二次 reg query；仅在尚未采集过时走 reg 自查兜底（行为同旧版）。
    let mgLower = null;
    if (_machineGuidCache !== null) {
        mgLower = _machineGuidCache;
    } else {
        try {
            const out = require('child_process').execSync(
                'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
                { timeout: 4000, windowsHide: true }).toString();
            const m = out.match(/MachineGuid\s+REG_SZ\s+([A-Fa-f0-9-]+)/i);
            if (m) {
                mgLower = m[1].toLowerCase();
                _machineGuidCache = mgLower;
            }
        } catch (e) { /* 忽略 */ }
    }
    if (mgLower) {
        const mgOnly = crypto.createHash('sha256').update('mg=' + mgLower).digest('hex');
        if (list.indexOf(mgOnly) === -1) list.push(mgOnly);
    }
    list.push(''); // 极端：全部采集失败
    _hwFpVariantsCache = Array.from(new Set(list));
    return _hwFpVariantsCache;
}

// ★ P1-[2.1] 各用途 HKDF 密钥
function deriveLicenseKeyHkdf(machineId, ikm)     { return hkdfPurposeKey(machineId, 'license', ikm); }
function deriveLicenseHmacKeyHkdf(machineId, ikm) { return hkdfPurposeKey(machineId, 'license-hmac', ikm); }
function deriveTrialKeyHkdf(machineId, ikm)       { return hkdfPurposeKey(machineId, 'trial', ikm); }
function deriveLastRunKeyHkdf(machineId, ikm)     { return hkdfPurposeKey(machineId, 'lastrun', ikm); }

// ★ P3-A 新增：派生 AES-256 密钥（含硬件指纹）
// 新密钥 = SHA256(machineId + hardwareFingerprint + IKM)
function deriveLicenseKey(machineId, ikm) {
    const hwFp = getHardwareFingerprint();
    const combined = (machineId || '') + (hwFp || '') + (ikm || LICENSE_HMAC_KEY);
    return crypto.createHash('sha256').update(combined).digest();
}

// ★ P3-A 新增：旧密钥派生（不含硬件指纹，向后兼容旧 license.dat）
// 旧密钥 = SHA256(machineId + IKM)
function deriveLicenseKeyLegacy(machineId, ikm) {
    const combined = (machineId || '') + (ikm || LICENSE_HMAC_KEY);
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
    // ★ P1-[2.1] 改用 HKDF 派生密钥（旧版读取时三级回退自动兼容）
    const key = deriveLicenseKeyHkdf(machineId);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const plaintext = Buffer.from(jsonStr, 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const payload = Buffer.concat([iv, ciphertext]).toString('base64');
    // ★ P3-C 新增：计算外层 HMAC（基于 machineId + 硬件指纹 + 密文）
    // 防止攻击者替换整个 license.dat 文件（即使 machineId 相同，HMAC 不匹配也会拒绝）
    const hmacKey = deriveLicenseHmacKeyHkdf(machineId);
    const hmac = crypto.createHmac('sha256', hmacKey).update(payload).digest('hex');
    return 'ENC2:' + hmac + ':' + payload;
}

// ★ P3-C 新增：派生 license HMAC 密钥（独立于加密密钥，不同盐）
function deriveLicenseHmacKey(machineId, ikm) {
    const hwFp = getHardwareFingerprint();
    const combined = (machineId || '') + (hwFp || '') + (ikm || LICENSE_HMAC_KEY) + ':hmac';
    return crypto.createHash('sha256').update(combined).digest();
}

// 解密 license 字符串（返回 JSON 字符串，失败返回 null）
// ★ P3-C 新增：优先 ENC2 格式（含 HMAC 校验），回退 ENC1 格式（向后兼容）
// ★ P1-[2.1] 升级：三级回退（HKDF → SHA256含hwFp → SHA256无hwFp）
function decryptLicenseContent(encryptedStr, machineId) {
    if (!encryptedStr) return null;
    // ★ P3-C 新增：优先尝试 ENC2 格式（含 HMAC 校验）
    if (encryptedStr.startsWith('ENC2:')) {
        const parts = encryptedStr.substring(5).split(':');
        if (parts.length < 2) return null;
        const storedHmac = parts[0];
        const base64Data = parts.slice(1).join(':');
        // ★ 阶段2：三级 HMAC 密钥候选 × 密钥档（HKDF → 旧SHA256含hwFp → 最旧SHA256无hwFp，V2 → V1）
        const hmacCandidates = [];
        for (const ikm of LICENSE_HMAC_KEYS) {
            hmacCandidates.push(
                deriveLicenseHmacKeyHkdf(machineId, ikm),
                deriveLicenseHmacKey(machineId, ikm),
                deriveLicenseHmacKeyLegacy(machineId, ikm)
            );
        }
        let hmacMatched = false;
        for (const hmacKey of hmacCandidates) {
            try {
                const expected = crypto.createHmac('sha256', hmacKey).update(base64Data).digest('hex');
                if (crypto.timingSafeEqual(Buffer.from(storedHmac, 'hex'), Buffer.from(expected, 'hex'))) {
                    hmacMatched = true;
                    break;
                }
            } catch (e) { /* 长度不匹配，尝试下一个候选密钥 */ }
        }
        if (!hmacMatched) {
            console.error('[License] HMAC 校验失败（文件可能被替换/篡改）');
            return null;
        }
        // HMAC 校验通过，解密内容（★ 阶段2：三级密钥 × 密钥档候选）
        const decryptCandidates = [];
        for (const ikm of LICENSE_HMAC_KEYS) {
            decryptCandidates.push(
                deriveLicenseKeyHkdf(machineId, ikm),
                deriveLicenseKey(machineId, ikm),
                deriveLicenseKeyLegacy(machineId, ikm)
            );
        }
        for (const key of decryptCandidates) {
            const plaintext = tryDecryptAes(base64Data, key);
            if (plaintext) return plaintext;
        }
        return null;
    }
    // 旧 ENC1 格式 - 向后兼容
    if (encryptedStr.startsWith('ENC1:')) {
        const base64Data = encryptedStr.substring(5);
        // ★ 阶段2：三级密钥尝试 × 密钥档（HKDF → SHA256含hwFp → SHA256无hwFp，V2 → V1）
        const decryptCandidates = [];
        for (const ikm of LICENSE_HMAC_KEYS) {
            decryptCandidates.push(
                deriveLicenseKeyHkdf(machineId, ikm),
                deriveLicenseKey(machineId, ikm),
                deriveLicenseKeyLegacy(machineId, ikm)
            );
        }
        for (const key of decryptCandidates) {
            const plaintext = tryDecryptAes(base64Data, key);
            if (plaintext) return plaintext;
        }
        return null;
    }
    return null;
}

// ★ P3-C 新增：旧 HMAC 密钥派生（不含硬件指纹，向后兼容）
function deriveLicenseHmacKeyLegacy(machineId, ikm) {
    const combined = (machineId || '') + (ikm || LICENSE_HMAC_KEY) + ':hmac';
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
function deriveTrialKey(machineId, ikm) {
    const hwFp = getHardwareFingerprint();
    const combined = (machineId || '') + (hwFp || '') + (ikm || LICENSE_HMAC_KEY) + ':trial';
    return crypto.createHash('sha256').update(combined).digest();
}

// ★ P3-A 新增：旧 trial 密钥派生（不含硬件指纹，向后兼容）
function deriveTrialKeyLegacy(machineId, ikm) {
    const combined = (machineId || '') + (ikm || LICENSE_HMAC_KEY) + ':trial';
    return crypto.createHash('sha256').update(combined).digest();
}

// ★ P3-A 新增：派生 last-run 加密密钥（含硬件指纹）
function deriveLastRunKey(machineId, ikm) {
    const hwFp = getHardwareFingerprint();
    const combined = (machineId || '') + (hwFp || '') + (ikm || LICENSE_HMAC_KEY) + ':lastrun';
    return crypto.createHash('sha256').update(combined).digest();
}

// ★ P3-A 新增：旧 last-run 密钥派生（不含硬件指纹，向后兼容）
function deriveLastRunKeyLegacy(machineId, ikm) {
    const combined = (machineId || '') + (ikm || LICENSE_HMAC_KEY) + ':lastrun';
    return crypto.createHash('sha256').update(combined).digest();
}

// 加密 trial JSON 字符串
// ★ P1-[2.1] 改用 HKDF 派生密钥（旧版读取时三级回退自动兼容）
function encryptTrialContent(jsonStr, machineId) {
    const key = deriveTrialKeyHkdf(machineId);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const plaintext = Buffer.from(jsonStr, 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return TRIAL_ENC_PREFIX + Buffer.concat([iv, ciphertext]).toString('base64');
}

// 解密 trial 字符串（仅处理 TRIAL1: 前缀，失败返回 null）
// ★ P1-[2.1] 升级：三级回退（HKDF → SHA256含hwFp → SHA256无hwFp）
// ★ 阶段2：三级回退 × 密钥档（V2 → V1）
function decryptTrialContent(encryptedStr, machineId) {
    if (!encryptedStr || !encryptedStr.startsWith(TRIAL_ENC_PREFIX)) return null;
    const base64Data = encryptedStr.substring(TRIAL_ENC_PREFIX.length);
    const decryptCandidates = [];
    for (const ikm of LICENSE_HMAC_KEYS) {
        decryptCandidates.push(
            deriveTrialKeyHkdf(machineId, ikm),
            deriveTrialKey(machineId, ikm),
            deriveTrialKeyLegacy(machineId, ikm)
        );
    }
    for (const key of decryptCandidates) {
        const plaintext = tryDecryptAes(base64Data, key);
        if (plaintext) return plaintext;
    }
    return null;
}

// 加密 last-run JSON 字符串
// ★ P1-[2.1] 改用 HKDF 派生密钥（旧版读取时三级回退自动兼容）
function encryptLastRunContent(jsonStr, machineId) {
    const key = deriveLastRunKeyHkdf(machineId);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const plaintext = Buffer.from(jsonStr, 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return LASTRUN_ENC_PREFIX + Buffer.concat([iv, ciphertext]).toString('base64');
}

// 解密 last-run 字符串（仅处理 LASTRUN1: 前缀，失败返回 null）
// ★ P1-[2.1] 升级：三级回退（HKDF → SHA256含hwFp → SHA256无hwFp）
// ★ 阶段2：三级回退 × 密钥档（V2 → V1）
function decryptLastRunContent(encryptedStr, machineId) {
    if (!encryptedStr || !encryptedStr.startsWith(LASTRUN_ENC_PREFIX)) return null;
    const base64Data = encryptedStr.substring(LASTRUN_ENC_PREFIX.length);
    const decryptCandidates = [];
    for (const ikm of LICENSE_HMAC_KEYS) {
        decryptCandidates.push(
            deriveLastRunKeyHkdf(machineId, ikm),
            deriveLastRunKey(machineId, ikm),
            deriveLastRunKeyLegacy(machineId, ikm)
        );
    }
    for (const key of decryptCandidates) {
        const plaintext = tryDecryptAes(base64Data, key);
        if (plaintext) return plaintext;
    }
    return null;
}

// ============================================================================
//  HMAC 签名（用于 license.dat 完整性校验）
//  v2: 签名包含 type/maxPrescriptions/features，防篡改版本分级
//  v3: 签名包含 clinicName/machineId/licenseBinding，实现三因子绑定
//  向后兼容：旧版 license（无 maxPrescriptions/features）用 v1 签名逻辑验证
// ============================================================================
// ★ 阶段2：可选 hmacKey 参数——验签处按档位传入（V2/V1）；不传则按 license masterKey
//   派生或最新密钥（写路径/ masterKey 一致性校验语义不变）
function generateSignature(data, hmacKey) {
    // 签名内容包含所有关键字段，任一字段被篡改都会导致签名不匹配
    const content = [
        data.user,
        data.type,
        data.issuedAt,
        data.expiresAt,
        String(data.maxPrescriptions !== undefined ? data.maxPrescriptions : 0),
        Array.isArray(data.features) ? data.features.join(',') : ''
    ].join('|');
    return crypto.createHmac('sha256', hmacKey || getEffectiveHmacKey()).update(content).digest('hex');
}

// ★ v3 签名：在 v2 基础上增加 clinicName/machineId/licenseBinding 三个绑定字段
function generateSignatureV3(data, hmacKey) {
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
    return crypto.createHmac('sha256', hmacKey || getEffectiveHmacKey()).update(content).digest('hex');
}

// v1 签名逻辑（向后兼容旧版 license）
function generateSignatureV1(data, hmacKey) {
    const content = [data.user, data.type, data.issuedAt, data.expiresAt].join('|');
    return crypto.createHmac('sha256', hmacKey || getEffectiveHmacKey()).update(content).digest('hex');
}

// ★ P0-2 加固（2026-08-26）：masterKey 一致性校验（防替换/删除 masterKey 的降级攻击）
// 背景：masterKey 不参与 v5/v6/v7 非对称签名内容（云端在签名后添加），单靠非对称验签
//      无法发现 masterKey 被篡改。攻击者替换/删除 masterKey 后可控制客户端派生密钥
//      （HMAC/CONFIG_SIGN），进而伪造 config.json 完整性签名。
// 修复：非对称验签通过后，用 license 当前 masterKey 派生密钥重算 v3/v2 HMAC，
//      必须与云端下发的 data.signature 一致：
//      - masterKey 被替换 → 派生密钥变化 → HMAC 不匹配 → 拒绝
//      - masterKey 被删除 → fallback 硬编码密钥 → 与云端 masterKey 派生密钥不匹配 → 拒绝
//      - 正常 license（云端配置 masterKey）→ 派生一致 → 通过
//      - 云端未配置 masterKey 时签发的 license（无该字段，HMAC 为硬编码密钥所签）→ 通过（向后兼容）
// ★ 红线：宁可漏检不可误报。校验异常时放行（仅记日志），绝不阻塞正常用户。
function verifyMasterKeyConsistency(data) {
    try {
        const sigBuf = Buffer.from(data.signature, 'hex');
        // setLicenseDataContext(data) 已缓存 masterKey，generateSignatureV3/V2 自动用派生密钥
        const expectedV3 = Buffer.from(generateSignatureV3(data), 'hex');
        if (sigBuf.length === expectedV3.length && crypto.timingSafeEqual(sigBuf, expectedV3)) {
            return true;
        }
        const expectedV2 = Buffer.from(generateSignature(data), 'hex');
        if (sigBuf.length === expectedV2.length && crypto.timingSafeEqual(sigBuf, expectedV2)) {
            return true;
        }
        console.warn('[License] masterKey 一致性校验失败（masterKey 疑似被篡改/删除），拒绝该 license');
        setLicenseDataContext(null);
        return false;
    } catch (e) {
        // 异常按放行处理（宁可漏检不可误报）
        console.warn('[License] masterKey 一致性校验异常（放行）:', e.message);
        return true;
    }
}

// ★ 2026-09-11 阶段1b：最近一次 verifySignature 拒绝原因（'hmac_sunset' = HMAC 日落截断）
//   供 UI 层区分提示文案（日落在"联网验证即自愈"，与"文件损坏需重新激活"不同）
let lastVerifyRejectReason = null;
function getLastVerifyRejectReason() {
    return lastVerifyRejectReason;
}

function verifySignature(data) {
    if (!data.signature) return false;
    lastVerifyRejectReason = null;  // 每次验签重置，防陈旧标记串扰

    // ★ P1-3: 缓存当前 license 数据上下文，供 getEffectiveHmacKey 派生密钥使用
    // 注意：此时 license 数据尚未验签，但 masterKey 字段不参与签名内容（云端在签名后添加），
    //      因此攻击者修改 masterKey 会导致派生密钥改变，但 cloud 签名仍按原 masterKey 计算，
    //      所以篡改后的 license 会验签失败（除非攻击者知道原 masterKey 并重算签名）。
    //      ECDSA v5（如果配置）提供更强的防篡改保证。
    setLicenseDataContext(data);

    // ★ P1-[5.1][5.3] 新增：v7 Ed25519 签名优先校验
    // 内容 = v5 全部字段 + sigSerial + sigNonce，算法 Ed25519（比 ECDSA P-256 更现代、更安全）
    // v7 验签失败直接拒绝（fail-closed，与 v6/v5 一致）：
    //   license 声明由 v7 云端签发却验不过，说明字段被篡改后重算了对称 HMAC；
    //   若降级到 v6/v5/HMAC 会让非对称验签保护形同虚设。
    // 旧版 license（无 signatureV7 字段）不受影响，继续走 v6/v5/HMAC 链路。
    if (data.signatureV7 && ED25519_VERIFY_PUBLIC_KEY_PEM) {
        if (verifyEd25519SignatureV7(data)) {
            // ★ P0-2 加固（2026-08-26）：非对称验签通过后还需校验 masterKey 一致性
            //（masterKey 不参与 v7 签名内容，防替换/删除 masterKey 的降级攻击，见函数注释）
            return verifyMasterKeyConsistency(data);
        }
        console.warn('[License] v7 Ed25519 验签失败，拒绝该 license（fail-closed）');
        setLicenseDataContext(null);
        return false;
    }

    // ★ P1-[2.2] 新增：v6 ECDSA 防重放签名优先校验
    // 如果 license 包含 signatureV6 字段且配置了 ECDSA 公钥，优先验 v6（内容 = v5 + serial + nonce）
    // v6 验签失败直接拒绝（fail-closed，与 v5 一致）：license 声明由 v6 云端签发却验不过，
    //   说明字段被篡改后重算了对称 HMAC；若降级到 v5/HMAC 会让非对称验签保护形同虚设。
    // 旧版 license（无 signatureV6 字段）不受影响，继续走 v5/HMAC 链路。
    if (data.signatureV6 && ECDSA_VERIFY_PUBLIC_KEY_PEM) {
        if (verifyECDSASignatureV6(data)) {
            // ★ P0-2 加固（2026-08-26）：同上，masterKey 一致性校验
            return verifyMasterKeyConsistency(data);
        }
        console.warn('[License] v6 ECDSA 验签失败，拒绝该 license（fail-closed）');
        setLicenseDataContext(null);
        return false;
    }

    // ★ 任务2 新增：v5 ECDSA 签名优先校验
    // 如果 license 包含 signatureV5 字段且配置了 ECDSA 公钥，优先用非对称验签
    // ★ 第三轮终检 P1 修复（2026-08-16）：验签失败直接拒绝（fail-closed）。
    //   license 含 signatureV5 说明由 v5 云端签发，验签失败 = 字段被篡改后
    //   重算了对称 HMAC（需反编译拿硬编码密钥）。若降级到 HMAC 会让非对称
    //   验签保护形同虚设。旧版 license（无 signatureV5 字段）不受影响。
    if (data.signatureV5 && ECDSA_VERIFY_PUBLIC_KEY_PEM) {
        if (verifyECDSASignature(data)) {
            // ★ P0-2 加固（2026-08-26）：同上，masterKey 一致性校验
            return verifyMasterKeyConsistency(data);
        }
        console.warn('[License] v5 ECDSA 验签失败，拒绝该 license（fail-closed）');
        setLicenseDataContext(null);
        return false;
    }

    // ★ 2026-09-11 阶段1b：HMAC 兜底日落截断——license 无任何非对称签名字段
    //   （signatureV5/V6/V7 全缺失）且 issuedAt ≥ HMAC_SUNSET_DATE 时直接拒绝。
    //   正版 license 自 2026-08 起签发必带非对称签名，截断日后仍"只有 HMAC"的
    //   license 唯一来源是用泄露对称密钥伪造。存量旧 license（issuedAt 更早）
    //   不受影响（180 天宽限 + 服务端 ensureLicenseV7 联网一次即升级 V7）。
    if (!data.signatureV5 && !data.signatureV6 && !data.signatureV7) {
        const issuedAtMs = Date.parse(data.issuedAt || '');
        if (!isNaN(issuedAtMs) && issuedAtMs >= Date.parse(HMAC_SUNSET_DATE)) {
            lastVerifyRejectReason = 'hmac_sunset';
            console.warn('[License] license 仅含对称 HMAC 签名且签发于 ' + HMAC_SUNSET_DATE +
                ' 之后，已拒绝（对称签名日落）。请联网完成一次在线验证以自动升级授权文件。');
            setLicenseDataContext(null);
            return false;
        }
    }

    // ★ P1-3 新增：如果 license 含 masterKey 字段，必须使用 masterKey 派生密钥验签
    // ★ 安全修复：masterKey 存在时拒绝 fallback 到硬编码密钥
    //   - masterKey 派生密钥验签失败 → 直接返回 false（license 已被篡改或 masterKey 不匹配）
    //   - 旧版 license（无 masterKey 字段）仍走硬编码密钥 fallback（向后兼容）
    if (data.masterKey) {
        // ★ 阶段2：masterKey 分支同样应用 LEGACY 截断——masterKey 明文随 license 下发，
        //   攻击者可从任意真实 license 提取后构造 HMAC-only+masterKey 伪造文件，绕过
        //   硬编码密钥档位截断（不堵则档位收紧形同虚设）。V5 上线（2026-07-21）后服务端
        //   签发必带 V5，更晚的"masterKey 派生 HMAC-only"文件必为伪造；无 issuedAt 不拦。
        const __mkIssuedMs = Date.parse(data.issuedAt || '');
        const __mkSunsetMs = Date.parse(LEGACY_HMAC_SUNSET_DATE);
        if (!isNaN(__mkIssuedMs) && !isNaN(__mkSunsetMs) && __mkIssuedMs >= __mkSunsetMs) {
            lastVerifyRejectReason = 'hmac_sunset';
            console.warn('[License] license 仅含 masterKey 派生 HMAC 签名且签发于 ' + LEGACY_HMAC_SUNSET_DATE +
                ' 之后，已拒绝（对称签名日落）。请联网完成一次在线验证以自动升级授权文件。');
            setLicenseDataContext(null);
            return false;
        }
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

    // ★ 2026-09-11 阶段2：硬编码密钥分档验签（V2 全期 / V1 仅 2026-08-01 前）。
    //   V1（泄露密钥）档应用 LEGACY_HMAC_SUNSET_DATE：V5 上线（2026-07-21）后服务端
    //   再无合法 HMAC-only 签发，更晚的"仅 V1 HMAC"文件必为伪造；无 issuedAt 不拦。
    //   服务端 HMAC 字段仍按现状签发（V1），新客户端主线为 V7 非对称验签，此处的
    //   V2 档为未来服务端密钥切换预留的防御位。
    const __fallbackIssuedMs = Date.parse(data.issuedAt || '');
    const __fallbackSunsetMs = Date.parse(LEGACY_HMAC_SUNSET_DATE);
    for (let ki = 0; ki < LICENSE_HMAC_KEYS.length; ki++) {
        const ikm = LICENSE_HMAC_KEYS[ki];
        if (ki > 0 && !isNaN(__fallbackIssuedMs) && !isNaN(__fallbackSunsetMs) &&
            __fallbackIssuedMs >= __fallbackSunsetMs) {
            lastVerifyRejectReason = 'hmac_sunset';  // 与 masterKey 分支截断同标记，UI 引导联网自愈
            break;  // V1 档已日落：issuedAt ≥ 2026-08-01 的旧密钥文件不再尝试
        }
        // ★ v3 签名优先校验（含 clinicName/machineId/licenseBinding 时使用）— 硬编码密钥 fallback
        if (data.clinicName !== undefined && data.machineId !== undefined && data.licenseBinding) {
            const expectedV3 = generateSignatureV3(data, ikm);
            try {
                if (crypto.timingSafeEqual(Buffer.from(data.signature, 'hex'), Buffer.from(expectedV3, 'hex'))) {
                    return true;
                }
            } catch (e) { /* 长度不匹配，继续尝试 v2/v1 */ }
        }
        // v2 签名校验
        const expectedV2 = generateSignature(data, ikm);
        try {
            if (crypto.timingSafeEqual(Buffer.from(data.signature, 'hex'), Buffer.from(expectedV2, 'hex'))) {
                return true;
            }
        } catch (e) { /* 长度不匹配，继续尝试 v1 */ }
        // v1 签名向后兼容（旧版 license 无 maxPrescriptions/features 字段）
        if (data.maxPrescriptions === undefined && !Array.isArray(data.features)) {
            const expectedV1 = generateSignatureV1(data, ikm);
            try {
                if (crypto.timingSafeEqual(Buffer.from(data.signature, 'hex'), Buffer.from(expectedV1, 'hex'))) {
                    return true;
                }
            } catch (e) {
                if (data.signature === expectedV1) return true;
            }
        }
        if (data.signature === expectedV2) return true;
    }
    return false;
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

        // ★ 密钥轮换兼容：新公钥 → 旧公钥依次尝试（任一通过即放行）
        for (const pem of ECDSA_VERIFY_PUBLIC_KEYS) {
            const verify = crypto.createVerify('SHA256');
            verify.update(content);
            verify.end();
            if (verify.verify(pem, derSig)) return true;
        }
        return false;
    } catch (e) {
        console.warn('[License] v5 ECDSA 验签异常:', e.message);
        return false;
    }
}

// ★ P1-[2.2] 新增：ECDSA P-256 非对称验签（v6 防重放）
// 签名内容 = v5 全部字段 + sigSerial + sigNonce，与云端 generateSignatureV6 完全一致
function verifyECDSASignatureV6(data) {
    if (!data.signatureV6 || !ECDSA_VERIFY_PUBLIC_KEY_PEM) return false;
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
            data.licenseBinding || '',
            String(data.sigSerial !== undefined ? data.sigSerial : ''),
            String(data.sigNonce !== undefined ? data.sigNonce : '')
        ].join('|');

        const rawSigHex = data.signatureV6;
        const rawSigBytes = Buffer.from(rawSigHex, 'hex');
        if (rawSigBytes.length !== 64) {
            console.warn('[License] v6 签名长度异常:', rawSigBytes.length);
            return false;
        }
        const r = rawSigBytes.slice(0, 32);
        const s = rawSigBytes.slice(32, 64);
        const derSig = encodeEcdsaSigToDER(r, s);

        // ★ 密钥轮换兼容：新公钥 → 旧公钥依次尝试（任一通过即放行）
        for (const pem of ECDSA_VERIFY_PUBLIC_KEYS) {
            const verify = crypto.createVerify('SHA256');
            verify.update(content);
            verify.end();
            if (verify.verify(pem, derSig)) return true;
        }
        return false;
    } catch (e) {
        console.warn('[License] v6 ECDSA 验签异常:', e.message);
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

// ★ P1-[5.1][5.3] 新增：Ed25519 非对称验签（v7）
// 签名内容 = v5 全部字段 + sigSerial + sigNonce（与云端 generateSignatureV7 完全一致）
// Ed25519 签名固定 64 字节（无需 DER 转换），验签无需指定哈希算法
function verifyEd25519SignatureV7(data) {
    if (!data.signatureV7 || !ED25519_VERIFY_PUBLIC_KEY_PEM) return false;
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
            data.licenseBinding || '',
            String(data.sigSerial !== undefined ? data.sigSerial : ''),
            String(data.sigNonce !== undefined ? data.sigNonce : '')
        ].join('|');

        const sigBytes = Buffer.from(data.signatureV7, 'hex');
        if (sigBytes.length !== 64) {
            console.warn('[License] v7 签名长度异常:', sigBytes.length);
            return false;
        }

        // Ed25519：crypto.verify 的算法参数传 null（算法自带 SHA-512 预哈希）
        // ★ 密钥轮换兼容：新公钥 → 旧公钥依次尝试（任一通过即放行）
        for (const pem of ED25519_VERIFY_PUBLIC_KEYS) {
            if (crypto.verify(null, Buffer.from(content, 'utf8'), pem, sigBytes)) return true;
        }
        return false;
    } catch (e) {
        console.warn('[License] v7 Ed25519 验签异常:', e.message);
        return false;
    }
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
        // ★ 第三轮终检 P2 修复：旧 XOR 格式（硬编码密钥）可跨机复制，读取成功后
        //   立即重写为本机 AES 格式（密钥含 machineId），此后旧格式文件不再生效
        try {
            const migrated = JSON.parse(json);
            writeTrial(migrated);
            console.log('[License] trial 已从旧 XOR 格式迁移为本机 AES 格式');
            return migrated;
        } catch (pe) { return null; }
    } catch (e) {
        return null;
    }
}

// ★ P0-5 修复：原子写入（先写 .tmp 再 rename），防止断电/崩溃导致 license/trial/last-run 文件半写损坏
//    （半写损坏会让合法用户 validateLicense 失败被拒登，需重新激活）
function atomicWriteFileSync(filePath, content) {
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, filePath);
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
                atomicWriteFileSync(trialPath, encrypted);
                return;
            }
        }
        // 回退到 XOR 加密（仅当 machineId 不可用时）
        console.warn('[License] machineId 不可用，trial 回退到 XOR 加密');
        const encrypted = xorEncrypt(json, TRIAL_KEY);
        atomicWriteFileSync(trialPath, encrypted);
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
        // ★ 第三轮终检 P2 修复：旧 XOR 格式可伪造时间戳绕过回拨检测，读取成功后
        //   立即重写为本机 AES 格式（与 trial 迁移策略一致）
        try {
            const migrated = JSON.parse(json);
            writeLastRun(migrated);
            console.log('[License] last-run 已从旧 XOR 格式迁移为本机 AES 格式');
            return migrated;
        } catch (pe) { return null; }
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
                atomicWriteFileSync(lastRunPath, encrypted);
                return;
            }
        }
        // 回退到 XOR 加密（仅当 machineId 不可用时）
        console.warn('[License] machineId 不可用，last-run 回退到 XOR 加密');
        const encrypted = xorEncrypt(json, LASTRUN_KEY);
        atomicWriteFileSync(lastRunPath, encrypted);
    } catch (e) {
        console.error('[License] 写入 last-run 文件失败:', e.message);
    }
}

// ★ P1-[2.2] 新增：v6 serial 防重放审计（fail-open，仅警告记录，绝不阻塞激活）
// 目的：检测"旧 license 副本回灌/重放"。v6 license 自带 issuedAt（云端签发毫秒时间戳），
//       以 user|issuedAt 为键记录已见最高 sigSerial。
//  - 同一签发批次（同 user|issuedAt）再次出现更小/相等 serial → 疑似重放 → 记录告警
//  - 不同签发批次（issuedAt 不同）天然不同键，不误报（换码/重激活均产生新 issuedAt）
//  - 条目上限 20，FIFO 淘汰，防止 last-run.dat 无限膨胀
function auditSigSerial(data) {
    try {
        if (!data || !data.signatureV6) return;
        const serial = parseInt(data.sigSerial, 10);
        if (isNaN(serial) || serial <= 0) return;
        const key = (data.user || '') + '|' + (data.issuedAt || '');
        const lastRun = readLastRun() || {};
        const seen = (lastRun.sigSerialSeen && typeof lastRun.sigSerialSeen === 'object') ? lastRun.sigSerialSeen : {};
        const prev = seen[key];
        const isNew = prev === undefined;
        if (!isNew && serial <= prev) {
            console.warn('[License] 疑似授权文件重放：同一签发批次 serial=' + serial
                + ' 已见更高 serial=' + prev + '（仅记录告警，不阻断运行）');
        }
        if (isNew || serial > prev) {
            seen[key] = serial;
            const keys = Object.keys(seen);
            if (keys.length > 20) {
                const sorted = keys.slice().sort();
                for (let i = 0; i < sorted.length - 20; i++) delete seen[sorted[i]];
            }
            lastRun.sigSerialSeen = seen;
            writeLastRun(lastRun);
        }
    } catch (e) {
        console.warn('[License] serial 审计异常:', e.message);
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
    // ★ P1-[2.2] 新增：v6 ECDSA 防重放签名相关字段透传
    if (license.signatureV6 !== undefined) normalized.signatureV6 = license.signatureV6;
    if (license.sigKId !== undefined) normalized.sigKId = license.sigKId;
    if (license.sigSerial !== undefined) normalized.sigSerial = license.sigSerial;
    if (license.sigNonce !== undefined) normalized.sigNonce = license.sigNonce;
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
    // ★ 第三轮终检 P2 修复：license 含 machineId 但本地获取为空时原会跳过校验
    //   （getMachineId 失败/被破坏 → 绑定失效）。现 fail-closed：视为不匹配。
    if (license.machineId && !localMachineId) {
        mismatches.push('无法获取本机机器标识，授权绑定校验失败（环境异常）');
    } else if (license.machineId && localMachineId && license.machineId !== localMachineId) {
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
// ★ 2026-09-26 F2：格式感知——v2（有 usersSignature）须 users/config 双签名同时
//   匹配；v1（无 usersSignature）旧配置按原 4 字段内容验签，交由调用方迁移。
function loadSignedConfigCandidate() {
    // ★ 第三轮终检 P2 修复（2026-08-16）：
    //   1. 原只读 exe 目录 config，而 installLicense 写的是 writableDir（NSIS 版= userData），
    //      路径不一致导致 NSIS 版从未真正校验过签名（exe 目录无签名 → 一直走兜底放行）。
    //      现优先校验 writableDir（与签名写入一致），exe 目录作兼容兜底（Portable 旧数据）。
    //   2. 删除两处兜底放行：无 config.json / 无 configSignature 原返回 true，
    //      攻击者删 config 或删签名字段即可绕过 → 现返回 false。
    //      安全性依据：本函数仅在 license 含 licenseBinding（v3+ 激活）时被调用，
    //      v3+ 激活流程 installLicense 必写签名 config，无签名 = 被删/损坏/篡改。
    const candidatePaths = [
        path.join(getWritableDir(), 'config.json'),
        path.join(getExeDirectory(), 'config.json')
    ];
    // ★ 2026-09-26 fail-closed（安全审查 #5）：区分 JSON 损坏与 IO 错误，
    //   不再与"文件不存在"混为一谈，否则锁文件竞态可把闸门打成空态放行。
    let sawCorrupt = false;
    let sawIoError = false;
    for (const p of candidatePaths) {
        try {
            if (!fs.existsSync(p)) continue;
            const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (parsed && parsed.configSignature) return { cfg: parsed, configPath: p };
        } catch (e) {
            if (e && e.name === 'SyntaxError') sawCorrupt = true;
            else if (e && e.code === 'ENOENT') { /* exists/读之间被删，继续下一路径 */ }
            else sawIoError = true;
        }
    }
    if (sawIoError) return { ioError: true };
    if (sawCorrupt) return { corrupt: true };
    return null;
}

function hexSignatureMatches(actualHex, expectedHex) {
    try {
        // ★ 2026-09-26 严格格式：Buffer.from(hex) 会静默丢弃奇数尾 nibble，
        //   真签名追加 1 个 hex 字符仍可能判等。先锁死 64 位小写 hex。
        if (typeof actualHex !== 'string' || !/^[0-9a-f]{64}$/.test(actualHex)) return false;
        if (typeof expectedHex !== 'string' || !/^[0-9a-f]{64}$/.test(expectedHex)) return false;
        const a = Buffer.from(actualHex, 'hex');
        const b = Buffer.from(expectedHex, 'hex');
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch (e) { return false; }
}

// 检查 config 双签名，返回 { ok, legacy, configPath, cfg, reason, usersTrusted }
// ★ 2026-09-26 失败分类（H1/B1 修复核心）：
//   reason='missing'            无任何带 configSignature 的候选件
//   reason='bad_issued_at'      configIssuedAt 缺失
//   reason='users_mismatch'     v2 件 users 签名在所有候选密钥下均不通过
//                               （users 无权威源可纠正 → 调用方必须 fail-closed）
//   reason='header_mismatch'    users 签名通过但 config 签名不通过（users 可信、仅
//                               header 漂移 → 可自愈重签）
//   reason='unsigned_unverified' 无 usersSignature 且 v1 签名也不通过
// cfgArg（可选）：调用方已读入内存的 config 对象——传入时直接检查它、
//   不再二次读盘（防 TOCTOU：闸门看到好件、写盘用了被替换的异件）；
//   configPath 按写口径回填，仅供日志使用。
function inspectConfigSignatures(cfgArg) {
    let loaded;
    if (cfgArg && typeof cfgArg === 'object') {
        loaded = { cfg: cfgArg, configPath: path.join(getWritableDir(), 'config.json') };
    } else {
        loaded = loadSignedConfigCandidate();
        if (loaded && loaded.ioError) {
            console.warn('[License] config.json 读取 IO 错误，fail-closed（不与文件缺失混淆）');
            return { ok: false, reason: 'config_io_error' };
        }
        if (loaded && loaded.corrupt) {
            console.warn('[License] config.json JSON 损坏，fail-closed（交由备份自愈）');
            return { ok: false, reason: 'config_corrupt' };
        }
        if (!loaded) {
            console.warn('[License] config.json 缺失或无签名，完整性校验不通过（fail-closed）');
            return { ok: false, reason: 'missing' };
        }
    }
    const { cfg, configPath } = loaded;
    // 必须有 configIssuedAt 才能验签
    if (!cfg.configIssuedAt) return { ok: false, reason: 'bad_issued_at', cfg, configPath };
    // ★ P1-预防重装：v1 头签名（无 usersSignature 的历史存量件）用稳定硬编码密钥
    // 验签；兼容历史 masterKey 派生的老签名：多候选密钥逐个验签，任一匹配即通过，
    // 避免重装/重激活后密钥漂移导致已激活用户被误锁（宁可漏检不可误报）。
    const signCandidates = [CONFIG_SIGN_KEY];
    const _mk = getLicenseMasterKey();
    if (_mk) signCandidates.push(getEffectiveConfigSignKey());
    const hasUsersSig = typeof cfg.usersSignature === 'string' && cfg.usersSignature.length > 0;
    let usersTrusted = false;
    if (hasUsersSig) {
        // ★ 第四轮：v2 users 签名【机器绑定】——静态 CONFIG_SIGN_KEY 不是 v2 候选：
        //   usersSignature 为本次新引入、野外无静态签名存量；保留静态候选=保留
        //   跨机移植洗白通道（攻击者自有安装产出的签名件在受害者机器上必须验签失败）。
        // ★ 第五轮（安全#1）：masterKey 派生键同样出局——LICENSE_MASTER_KEY 是
        //   全局单一 Cloudflare env 且明文随 license 下发，攻击者持同部署任一
        //   license 即可预签 masterKey 派生件移植受害者机（PoC 实证幽灵 admin
        //   放行）。v2 系新引入无存量 → 直接删除该候选；signConfig 同口径恒用
        //   机器键，否则 masterKey 在场时自签自验不过。
        const v2Candidates = [getUsersSignKey()];
        for (const key of v2Candidates) {
            const expectedUsers = computeUsersSignature(cfg.users, key);
            const usersOk = hexSignatureMatches(cfg.usersSignature, expectedUsers);
            const signContent = [
                cfg.clinicName || '', cfg.doctorName || '', cfg.edition || '',
                cfg.configIssuedAt, cfg.usersSignature
            ].join('|');
            const headerOk = hexSignatureMatches(cfg.configSignature,
                crypto.createHmac('sha256', key).update(signContent).digest('hex'));
            if (usersOk && headerOk) {
                return { ok: true, legacy: false, configPath, cfg, usersTrusted: true };
            }
            if (usersOk) usersTrusted = true; // users 有签发证明，仅 header 漂移
        }
    } else {
        // v1 旧格式：签名内容仅 clinicName|doctorName|edition|configIssuedAt
        for (const key of signCandidates) {
            const signContent = [cfg.clinicName || '', cfg.doctorName || '', cfg.edition || '',
                                  cfg.configIssuedAt].join('|');
            const expected = crypto.createHmac('sha256', key).update(signContent).digest('hex');
            if (hexSignatureMatches(cfg.configSignature, expected)) {
                return { ok: true, legacy: true, configPath, cfg };
            }
        }
    }
    if (usersTrusted) {
        return { ok: false, reason: 'header_mismatch', usersTrusted: true, cfg, configPath };
    }
    return { ok: false, reason: hasUsersSig ? 'users_mismatch' : 'unsigned_unverified', cfg, configPath };
}

function verifyConfigIntegrity() {
    return inspectConfigSignatures().ok;
}

// v1 合法配置一次性迁移为 v2（users 纳入签名）。
// 返回值：
//   true       迁移完成
//   false      临时性失败（IO/签名异常），不致命，下次启动重试
//   'tampered' 拒绝迁移：磁盘 users 与备份不一致/缺少可验证备份
//              （v1 签名不覆盖 users，无权威源时不得把 users 固化进 v2）
function migrateConfigUsersSignature(inspection) {
    try {
        const cfg = inspection.cfg;
        const diskUsers = Array.isArray(cfg.users) ? cfg.users : [];
        const backup = inspectUsersBackup();
        if (diskUsers.length > 0) {
            // 有账号：必须有【可采信】备份且磁盘全部账号由备份证明（子集语义）。
            //   v2 备份须 gen 新鲜（防旧件重放回滚密码/角色）；
            //   legacy 无签名备份须在日落窗口+锚点未建立（锚点建立后伪造不可分辨）。
            // 防存量 v1 机器升级时把"被篡改/植入"的 users 静默固化（I1）。
            let backupAcceptable = false;
            if (backup.trusted === 'v2') {
                backupAcceptable = backupGenFresh(backup);
            } else if (backup.trusted === 'legacy') {
                backupAcceptable = legacyBackupUsable(backup);
            }
            if (!backupAcceptable || !usersProvenByBackup(diskUsers, backup.users)) {
                // none/bad/窗口外/gen 旧件/证明失败：v1 签名不覆盖 users——
                // 攻击者可拿任意合法 v1 件改 users、伪造/回滚备份冒充老用户，
                // 故一律拒绝（fail-closed），真实极少数老用户由客服核验恢复。
                console.warn('[License] v1→v2 迁移中止：磁盘 users 缺少可采信备份证明（trusted='
                    + backup.trusted + '）');
                return 'tampered';
            }
        } else if (backup.trusted === 'v2' && backupGenFresh(backup) && backup.users.length > 0) {
            // 磁盘 users 被清空但 v2 新鲜备份有账号：先回填再迁移（截断保护场景）
            cfg.users = backup.users;
        }

        signConfig(cfg);
        if (!cfg.configSignature || !cfg.usersSignature) return false;
        fs.writeFileSync(inspection.configPath, JSON.stringify(cfg, null, 2), 'utf8');
        // ★ 2026-10-01（双审查 B-Z3 收口）：v1→v2 迁移是【安全翻转】（gen 锚点建立
        //   + legacy 退役墓碑），刻意保持同步满语义、零窗口——锚点延后落盘的数秒
        //   窗内若进程被杀/植入 legacy 件，正中"双删洗白 legacy 账号"威胁模型。
        //   迁移为每台老机一次性路径，宁可这一次承担冷 PS 耗时。
        backupUserAccounts(cfg, {});
        console.log('[License] users 完整性签名迁移完成（v1→v2）');
        return true;
    } catch (e) {
        console.warn('[License] migrateConfigUsersSignature 异常:', e.message);
        return false;
    }
}

// ★ P2-预防重装：config.json 完整性自愈
// 触发时机：license 本身验签有效（调用方已前置校验），但本地 config 完整性签名不匹配。
// 典型场景：重装/重激活导致 config 签名密钥或内容漂移，合法用户被误锁。
// 处理：用 license 内已验签的权威值（clinicName/doctorName）覆盖本地 config 并重签写入。
// ★ 2026-09-26 H1/B1 修复（阻断项）：
//   users 不在 license 内，本地不存在"权威 users"。因此：
//   ① inspection.reason==='users_mismatch'（v2 件 users 签名失败）时调用方直接
//      fail-closed，不得进入本函数——重签未验签的 users 等于洗白植入/提权/降级；
//   ② 磁盘有 users 时必须与可信备份（v2；特定兼容状态含 legacy）完全一致才允许
//      带着它们重签；备份缺失/投毒/不一致一律拒绝；
//   ③ 磁盘 users 为空时从备份回填：v2 权威直接采信；legacy 旧备份仅兼容窗口采信，
//      本函数成功后立即重写为 v2 签名备份；bad 备份拒绝。
function selfHealConfigFromLicense(license, inspection) {
    try {
        inspection = inspection || inspectConfigSignatures();
        if (inspection.reason === 'users_mismatch') {
            console.warn('[License] selfHeal 拒绝：users 签名失配且无权威源，禁止重签洗白');
            return false;
        }
        const configDir = getWritableDir();
        const configPath = require('path').join(configDir, 'config.json');
        let config = {};
        try {
            if (fs.existsSync(configPath)) config = JSON.parse(fs.readFileSync(configPath, 'utf8')) || {};
        } catch (e) { config = {}; }
        if (!Array.isArray(config.users)) config.users = [];

        const backup = inspectUsersBackup();

        if (config.users.length === 0) {
            // 空账号：只从【新鲜 v2】备份回填（旧 gen 件拒绝=防重放回滚）；
            // legacy 无签名备份仅当现存 config 本身是 v1 合法件且在窗口内才允许。
            if (backup.trusted === 'v2') {
                if (backupGenFresh(backup) && backup.users.length > 0) {
                    config.users = backup.users;
                    console.log('[License] selfHeal 已从 users-backup.json 回填账号:',
                        backup.users.length, '个(v2)');
                }
            } else if (inspection.ok && inspection.legacy
                       && legacyBackupUsable(backup) && backup.users.length > 0) {
                config.users = backup.users;
                console.log('[License] selfHeal 已从 legacy 备份回填账号:',
                    backup.users.length, '个(legacy窗口)');
            } else if (backup.trusted === 'bad') {
                console.warn('[License] selfHeal 拒绝：users-backup.json 签名损坏（疑被投毒）');
                return false;
            }
        } else if (inspection.usersTrusted) {
            // users 签名本身通过（header_mismatch）：users 已有签发证明，无需备份复核
        } else {
            // 磁盘有账号、签名不通过：
            //   新鲜 v2 备份可证明（子集语义）；
            //   legacy 备份只在 v1 合法件（inspection.legacy===true）窗口内可证明——
            //   missing/unsigned/bad_issued_at 等攻击者可自造状态一律不再接受 legacy。
            let proven = false;
            if (backup.trusted === 'v2' && backupGenFresh(backup)) {
                proven = usersProvenByBackup(config.users, backup.users);
            } else if (inspection.legacy === true && legacyBackupUsable(backup)) {
                proven = usersProvenByBackup(config.users, backup.users);
            }
            if (!proven) {
                console.warn('[License] selfHeal 拒绝：磁盘 users 无有效备份证明'
                    + '(reason=' + inspection.reason + ',backup=' + backup.trusted + ')');
                return false;
            }
        }

        // 用 license 权威值覆盖（license 已验签通过）
        if (license.clinicName && config.clinicName !== license.clinicName) {
            config.clinicName = license.clinicName;
        }
        if (license.doctorName && config.doctorName !== license.doctorName) {
            config.doctorName = license.doctorName;
        }

        signConfig(config);
        if (!config.configSignature) {
            console.warn('[License] selfHealConfigFromLicense 重签失败，跳过自愈');
            return false;
        }
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
        // proven：users 已由本函数内部验签/备份证明、且刚随有效 v2 config 落盘，
        // 允许推进备份（含"备份缺失+gen锚点已建立"场景，否则备份永久缺失）。
        // ★ 2026-10-01（双审查 B-Z3 收口）：重装自愈属安全翻转，锚点同步写零窗口
        //   （自愈为偶发恢复路径，冷 PS 一次性耗时可接受，不留双删洗白窗）。
        backupUserAccounts(config, { proven: true });
        console.log('[License] config.json 重装自愈完成（用 license 权威值重签）');
        return true;
    } catch (e) {
        console.warn('[License] selfHealConfigFromLicense 异常:', e.message);
        return false;
    }
}

// ============================================================================
//  ★ P1-B 新增：安全检测（调试器检测，防 hook/调试绕过 license）
// ============================================================================
function isDebuggerAttached() {
    try {
        // ★ E2E 旁路（2026-08-22 恢复：原 ca5ae735 修复被 22ee942c 自动同步覆盖丢失）：
        //   构建管线 e2e 双条件（BNZC_E2E=1 环境变量 + exe 同级 marker，main.js 已校验置位）
        //   放行调试参数；生产环境无 marker，检测保持 100% 生效。
        if (global.__BNZC_E2E_BYPASS === true) return false;
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
        const vmIndicators = [
            'vmware', 'virtualbox', 'vbox', 'qemu', 'xen', 'hyper-v', 'hyperv',
            'parallels', 'vmware virtual platform', 'innotek gmbh'
        ];

        // 1. WMI 查询计算机制造商和型号
        {
            const out = tryWmicExec('wmic computersystem get manufacturer,model', 2000);
            if (out) {
                const low = out.toLowerCase();
                for (const ind of vmIndicators) {
                    if (low.includes(ind)) {
                        console.warn('[License] 检测到 VM 标志（WMI Manufacturer/Model）:', ind);
                        _vmCheckCache = true;
                        return true;
                    }
                }
            }
        }

        // 2. WMI 查询磁盘型号（VM 磁盘通常含 VBOX/VIRTUAL/VMware）
        {
            const out = tryWmicExec('wmic diskdrive get model', 2000);
            if (out) {
                const low = out.toLowerCase();
                for (const ind of vmIndicators) {
                    if (low.includes(ind)) {
                        console.warn('[License] 检测到 VM 标志（WMI DiskDrive Model）:', ind);
                        _vmCheckCache = true;
                        return true;
                    }
                }
            }
        }

        // 3. BIOS 版本字符串（VMware/VirtualBox BIOS 标志）
        {
            const out = tryWmicExec('wmic bios get serialnumber,version', 2000);
            if (out) {
                const low = out.toLowerCase();
                for (const ind of vmIndicators) {
                    if (low.includes(ind)) {
                        console.warn('[License] 检测到 VM 标志（WMI BIOS）:', ind);
                        _vmCheckCache = true;
                        return true;
                    }
                }
            }
        }

        // 4. 进程列表检测沙箱（Sandboxie）
        {
            const out = tryWmicExec('wmic process get name', 2000);
            if (out) {
                const low = out.toLowerCase();
                if (low.includes('sandboxie') || low.includes('sandboxiedcomlaunch') ||
                    low.includes('sandboxierpcss')) {
                    console.warn('[License] 检测到沙箱进程（Sandboxie）');
                    _vmCheckCache = true;
                    return true;
                }
            }
        }

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

// ★ 2026-09-12 到期时间客户可读化：ISO UTC（2026-09-10T22:21:58.727Z）原样弹给客户
//   完全看不懂，统一格式化为北京时间 yyyy-MM-dd HH:mm（与 validate.js __expBJ、
//   离线APP LicenseManager.formatBeijingTime 三端同语义）
function formatExpireBeijing(isoStr) {
    try {
        const ms = new Date(isoStr).getTime();
        if (isNaN(ms)) return String(isoStr || '');
        const d = new Date(ms + 8 * 3600e3);
        const pad = function (n) { return String(n).padStart(2, '0'); };
        return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) +
            ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
    } catch (e) {
        return String(isoStr || '');
    }
}

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

        // ★ P1-[2.2] 新增：v6 serial 防重放审计（仅警告记录，fail-open，不影响放行）
        auditSigSerial(license);

        // ★ v3 新增：config.json 完整性校验
        // 防止用户修改 config.json 中的 clinicName 绕过 license 绑定校验
        // ★ 2026-09-26 H1/B1 修复：
        //   - users 签名失配（users_mismatch）= 无权威源可纠正的篡改/植入，
        //     直接 fail-closed，绝不允许 selfHeal 重签洗白；
        //   - 其他失配（missing/header 漂移等）才尝试自愈，自愈后仍失败也 fail-closed；
        //   - v1 合法旧件迁移时若 users 与备份不一致（migrate 返回 'tampered'），
        //     同样拒绝放行。
        //   ★ 复审重要项收口：任何已装 license（含 free 无 licenseBinding）都强制
        //     本地完整性校验——本地签名不依赖网络/绑定，免费档跑在最不受控机器上，
        //     不能整体豁免（空 users 的未签名件由 selfHeal 重签迁移，不误杀）。
        const configInspection = inspectConfigSignatures();
        if (!configInspection.ok) {
            if (configInspection.reason === 'users_mismatch') {
                console.warn('[License] users 签名失配，config_tampered（禁止自愈洗白）');
                return {
                    valid: false,
                    message: '配置文件用户列表已被篡改（账号/角色/密码哈希签名校验失败）。\n请联系客服处理，切勿自行修改 config.json。',
                    type: 'config_tampered',
                    license: license
                };
            }
            const healed = selfHealConfigFromLicense(license, configInspection);
            if (!healed || !verifyConfigIntegrity()) {
                return {
                    valid: false,
                    message: '配置文件 config.json 已被篡改或损坏，请重新打包或联系客服。\n（诊所名/医师名/用户列表签名校验失败）',
                    type: 'config_tampered',
                    license: license
                };
            }
            // 自愈后放行，不锁定合法用户
        } else if (configInspection.ok && configInspection.legacy) {
            const migrated = migrateConfigUsersSignature(configInspection);
            if (migrated === 'tampered') {
                return {
                    valid: false,
                    message: '配置文件用户列表与备份不一致（账号可能被篡改或植入）。\n请联系客服处理，切勿自行修改 config.json。',
                    type: 'config_tampered',
                    license: license
                };
            }
            if (migrated !== true) {
                console.warn('[License] users 签名迁移未完成，下次启动重试（不影响本次放行）');
            }
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
            // ★ 2026-09-12 到期消息客户可读化：北京时间 + 已过期天数（原 ISO UTC 客户看不懂）
            const __overdueDays = Math.max(1, Math.ceil((now - expiresAtMs) / (24 * 60 * 60 * 1000)));
            return {
                valid: false,
                message: `授权已过期。\n用户：${license.user}\n到期时间：${formatExpireBeijing(license.expiresAt)}（北京时间）\n已过期 ${__overdueDays} 天，请联系客服续费。`,
                type: 'expired',
                license: license
            };
        }

        // license 有效
        // ★ P1-[2.2] 修复：合并写入，保留 sigSerialSeen 等审计字段（避免覆盖丢失）
        const lrData = readLastRun() || {};
        lrData.timestamp = now;
        writeLastRun(lrData);
        const remainingDays = Math.ceil((expiresAtMs - now) / (24 * 60 * 60 * 1000));
        return {
            valid: true,
            message: `授权有效\n用户：${license.user}\n类型：${license.type}\n到期：${formatExpireBeijing(license.expiresAt)}\n剩余：${remainingDays} 天`,
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

    // ★ 2026-09-26 阻断修复（安全审查 #1）：users 来源闸门必须在试用到期裁决
    //   之前——旧顺序下"试用过期/只读"态闸门被跳过，get-app-config 会给未验签
    //   users 签出合法 v2 备份，攻击者账号永久洗白。任何授权状态先过此闸。
    if (!configUsersProvenAuthentic()) {
        console.warn('[License] 试用态 users 来源校验失败，config_tampered');
        return {
            valid: false,
            message: '配置文件用户列表已被篡改或备份损坏。\n请联系客服处理，切勿自行修改 config.json 或 users-backup.json。',
            type: 'config_tampered'
        };
    }

    if (now > trialExpiresAtMs) {
        return {
            valid: false,
            message: `试用期已到期（${currentTrialDays} 天）。\n请联系客服购买正式授权。`,
            type: 'trial_expired',
            trial: trial
        };
    }

    // 试用有效（v2: 试用版也有处方数量限制）
    // ★ P1-[2.2] 修复：合并写入，保留 sigSerialSeen 等审计字段（避免覆盖丢失）
    const trialLrData = readLastRun() || {};
    trialLrData.timestamp = now;
    writeLastRun(trialLrData);
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
            // ★ P0-5 修复：原子写入，防止断电/崩溃导致 license.dat 半写损坏
            atomicWriteFileSync(licensePath, encrypted);
            return { success: true, path: licensePath };
        } catch (writeErr) {
            // ★ 写入失败时尝试 fallback 到 userData 目录（防御性兜底）
            console.warn('[License] 主路径写入失败，尝试 userData 兜底:', writeErr.message);
            const fallbackPath = path.join(app.getPath('userData'), 'license.dat');
            atomicWriteFileSync(fallbackPath, encrypted);
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
//   4. 检测到撤销/过期时退出应用并显示提示
// ============================================================================
const HEARTBEAT_INTERVAL = 24 * 60 * 60 * 1000; // 24 小时
const HEARTBEAT_RETRY_INTERVAL = 5 * 60 * 1000; // 5 分钟重试
const HEARTBEAT_MAX_RETRIES = 3;
// ★ P2 服务端收口（KNOWLEDGE 条目三十七）：撤销检查主裁决切 /entitlement
//   四态（服务端裁决，客户端只消费不自算）；老 status 心跳保留为 entitlement
//   不可达时的回退（过渡期，老接口退役后删除）。
const ENTITLEMENT_API_URL = 'https://tcm-prescription-system.pages.dev/api/license/entitlement';
const HEARTBEAT_API_URL = 'https://tcm-prescription-system.pages.dev/api/license/status';

let _heartbeatTimer = null;
let _heartbeatRetryTimer = null;
let _heartbeatRetryCount = 0;

// 带 15s 超时的 POST（★ 2026-08-16 P1 修复沿用：Node fetch(undici) 不识别
//   timeout 选项，原写法会挂起至 OS TCP 超时，改用 AbortController + setTimeout）
async function postJsonWithTimeout(url, body) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal
        });
        if (!response.ok) {
            console.warn('[Heartbeat] 请求失败:', response.status, url);
            return null;
        }
        return await response.json();
    } finally {
        clearTimeout(timeoutId);
    }
}

// ★ P2-③ 撤销检查收口：返回统一四态形态 { state, reason, warning }。
//   ① 主裁决：entitlement 四态（LICENSED/NO_LICENSE/LICENSE_EXPIRED/LICENSE_REVOKED）
//   ② 回退：entitlement 不可达时走老 status 心跳，revoked 语义映射四态
//   ③ 两端都不可达返回 null（交由既有重试逻辑，无网络不影响离线使用）
//   四态 → 动作映射（heartbeatHandler 消费）：REVOKED/EXPIRED → quit；
//   LICENSED/NO_LICENSE → 不退出（NO_LICENSE=试用/未绑定机器，对拍老接口
//   "未找到绑定记录 revoked:false 不退出"语义，试用用户零影响）。
async function checkLicenseRevocation(machineId) {
    const mid = machineId || getMachineId();

    // ① 主裁决：entitlement 四态
    try {
        const ent = await postJsonWithTimeout(ENTITLEMENT_API_URL, { machineId: mid });
        if (ent && ent.success && ent.state) {
            _heartbeatRetryCount = 0;
            return { state: ent.state, reason: null, warning: null };
        }
        console.warn('[Heartbeat] entitlement 响应异常:', ent && ent.error);
    } catch (e) {
        console.warn('[Heartbeat] entitlement 裁决不可达，回退老心跳:', e.message);
    }

    // ② 回退：老 status 心跳（revoked 语义 → 四态映射）
    try {
        const data = await postJsonWithTimeout(HEARTBEAT_API_URL, { machineId: mid });
        if (data) {
            _heartbeatRetryCount = 0;
            if (data.revoked) {
                return {
                    state: /过期/.test(data.reason || '') ? 'LICENSE_EXPIRED' : 'LICENSE_REVOKED',
                    reason: data.reason || null,
                    warning: null
                };
            }
            return { state: 'LICENSED', reason: null, warning: data.warning || null };
        }
    } catch (e) {
        console.warn('[Heartbeat] 老心跳检测异常:', e.message);
    }

    return null; // ③ 两端都不可达 → 既有重试逻辑接管
}

async function heartbeatHandler() {
    try {
        const machineId = getMachineId();
        if (!machineId) return;

        // ★ 高-2 修复（TOCTOU）：本机付费态在发起网络请求【之前】一次性固化。
        //   旧代码收到 NO_LICENSE 后再读 license.dat，攻击者可并发删 dat 降级为
        //   trial 逃过退出。现在以请求前快照为准，事后删文件无效。
        let preIsPaid = false;
        try {
            const _pre = validateLicense({ localMachineId: machineId });
            const _plt = _pre.licenseType || _pre.type || '';
            preIsPaid = !!(_pre.valid && _pre.type === 'licensed' && _plt !== 'free');
        } catch (le) { /* 本地态异常按非付费处理（宁可漏检不可误退） */ }

        const result = await checkLicenseRevocation(machineId);
        if (result === null) {
            _heartbeatRetryCount++;
            if (_heartbeatRetryCount <= HEARTBEAT_MAX_RETRIES) {
                console.warn('[Heartbeat] 重试第', _heartbeatRetryCount, '次');
                // ★ 低-4：重试句柄与 24h interval 句柄分离（旧码覆盖 interval 句柄
                //   导致泄漏且 stopHeartbeat 无法真正停止）。
                _heartbeatRetryTimer = setTimeout(heartbeatHandler, HEARTBEAT_RETRY_INTERVAL);
            }
            return;
        }

        // ★ P2-③ 四态裁决。退出条件：
        //   REVOKED / EXPIRED → 无条件退出；
        //   ★ 2026-09-23 NO_LICENSE：请求前本机是有效付费授权（非 free），
        //     后台却查无绑定 = 诊所/激活码已被删除 → 退出（与登录闸门同语义）。
        //     真·试用机 preIsPaid=false，零影响。
        if (result.state === 'LICENSE_REVOKED' || result.state === 'LICENSE_EXPIRED') {
            console.error('[Heartbeat] 授权失效退出:', result.state, result.reason || '');
            app.quit();
        }
        if (result.state === 'NO_LICENSE' && preIsPaid) {
            // ★ 中-3：近 10 分钟内登录闸门刚验证通过（登录请求与心跳命中不同
            //   colo、KV 传播窗口）时，延时 2.5s 重裁一次，避免登录后瞬间误退。
            let _recentVerified = false;
            try {
                const _gu = await getUnifiedGateAsync(machineId);
                _recentVerified = !!(_gu.lastVerify && Date.now() - _gu.lastVerify < 10 * 60 * 1000);
            } catch (ge) { /* 读不到按非近期处理 */ }
            if (_recentVerified) {
                await sleep(2500);
                const retry = await checkLicenseRevocation(machineId);
                if (retry === null) return;  // 重裁不可达：不退出，等下个周期
                if (retry.state === 'LICENSED') return;
                if (retry.state === 'LICENSE_REVOKED' || retry.state === 'LICENSE_EXPIRED') {
                    console.error('[Heartbeat] 授权失效退出:', retry.state, retry.reason || '');
                    app.quit();
                }
            }
            console.error('[Heartbeat] 后台已无授权绑定（诊所/激活码已删除），退出');
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
    if (_heartbeatTimer || _heartbeatRetryTimer) return;
    console.log('[Heartbeat] 启动网络心跳检测（每 24 小时检查一次）');
    heartbeatHandler();
    _heartbeatTimer = setInterval(heartbeatHandler, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
    if (_heartbeatTimer) {
        clearInterval(_heartbeatTimer);
        _heartbeatTimer = null;
    }
    if (_heartbeatRetryTimer) {
        clearTimeout(_heartbeatRetryTimer);
        _heartbeatRetryTimer = null;
    }
    console.log('[Heartbeat] 停止网络心跳检测');
}

// ============================================================================
//  ★ 2026-09-23 P0 登录后台闸门（主进程裁决；渲染端经 IPC 调用）
//  规则（用户拍板，与渲染层文案一致）：
//   ① licensed 非 free → 必须后台 state=LICENSED；NO_LICENSE（诊所/码已删）/
//     REVOKED/EXPIRED 一律 fail-closed；
//   ② trial → 放行；但 gate.everActivated=true（曾激活）的机器必须在线证明；
//   ③ free → 永久离线可用，豁免；
//   ④ 网络不可达/HTTP错误 → 签名锚点 offlineStart（只由主进程写，不可重置）
//     给 7 天宽限。
// ============================================================================
const GATE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

// ★ 2026-10-02 登录性能：在线裁决预取。真机/Node 实测：同进程首个裁决
//   2.1~3.8s（冷 TLS 握手 + Cloudflare Worker 冷路径），连接热后稳定
//   0.55s。登录窗 whenReady 即后台预取一次，点登录直接复用，冷耗时整段
//   藏进"用户看登录框/输密码"窗口。
//   安全边界（四条，缺一不可）：
//   ① 仅复用「HTTP 200 + ent.success===true + state==='LICENSED'」；
//     netFail/httpFail/malformed/任何拒绝态一律丢弃、点登录时新鲜重裁，
//     fail-closed 语义零变化；
//   ② 一次性消费：登录链取走即清空槽位 → 紧随其后的主窗
//     installMainWindowGate 吊销自检永远拿新鲜裁决（吊销延迟不增加）；
//   ③ 缓存键 = machineId|username：换用户名/换机不命中，账号墓碑联动
//     不会错用到他人裁决；
//   ④ TTL 20s：只覆盖正常"开程序→输密码→登录"交互；超时作废。
const ADJ_PREWARM_TTL_MS = 20000;
// 保热定时调用：已完成槽位小于此年龄视为热槽保留（配合 15s 调用间隔，
// 保证到点换新、点击时槽龄恒 ≤~15s 且不产生多余请求）。
const ADJ_PREWARM_REFRESH_MS = 10000;
let __adjPrewarm = null; // { key, at, promise }

async function __adjudicateFetch(machineId, username) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 15000);
    try {
        // ★ 2026-09-23 账号删除联动：透传 username，服务端只读账号墓碑后下发
        //   accountState（命中 ACCOUNT_REVOKED）。
        const payload = { machineId: machineId };
        if (username) payload.username = username;
        const resp = await fetch(ENTITLEMENT_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        if (!resp.ok) return { httpFail: resp.status };
        // ★ 低-1：JSON 解析失败（代理解析页/脏响应）不是断网，单独标记 fail-closed
        let ent;
        try { ent = await resp.json(); } catch (e) { return { malformed: true }; }
        return { ok: true, ent: ent };
    } catch (e) {
        // AbortError（超时）与 TypeError（不可达）均按断网处理
        return { netFail: true };
    } finally { clearTimeout(tid); }
}

// 供 main.js 登录窗显示期间周期调用以保持裁决"热"：
//   · 同键在途 → 单飞复用，绝不重复打服务端；
//   · 同键已完成且年龄 < ADJ_PREWARM_REFRESH_MS(10s) → 仍是热槽，保留；
//   · 其余（无槽/异键/已凉）→ 发新裁决替换。
// 配合 15s 保热间隔：每次定时调用时槽龄约 15s（≥10s）→ 换新，点登录时
// 槽龄恒 ≤~15s（< TTL 20s），吊销复用窗口不大于旧单次预取的 20s TTL。
function prewarmAdjudication(machineId, username) {
    try {
        if (!machineId) return;
        const key = machineId + '|' + (username || '');
        const cur = __adjPrewarm;
        if (cur && cur.key === key) {
            if (!cur.settled) return;                                  // 在途单飞
            if (Date.now() - cur.at < ADJ_PREWARM_REFRESH_MS) return;  // 热槽保留
        }
        __fireAdjPrewarmSlot(machineId, username, key);
    } catch (e) { /* 预热纯增益，任何异常静默 */ }
}

// ★ 2026-10-02 点击登录瞬间调用（login.js 在 PBKDF2 之前 fire-and-forget）：
//   与密码校验并行，gate 真正发起时槽已在途或已完成。TTL(20s) 内同键槽
//   （在途或已完成）一律直接复用——点击场景零等待优先；异键/无槽/超龄才发
//   新裁决。只是"提前发请求"，裁决消费的安全条件（200/success/LICENSED/
//   serverTime/墓碑）全部不变，不构成新攻击面。
function ensureAdjudicationWarm(machineId, username) {
    try {
        if (!machineId) return;
        const key = machineId + '|' + (username || '');
        const cur = __adjPrewarm;
        if (cur && cur.key === key) {
            if (!cur.settled) return;
            if (Date.now() - cur.at < ADJ_PREWARM_TTL_MS) return;
        }
        __fireAdjPrewarmSlot(machineId, username, key);
    } catch (e) { /* 预热纯增益，任何异常静默 */ }
}

function __fireAdjPrewarmSlot(machineId, username, key) {
    const slot = { key, at: Date.now(), promise: null, settled: false };
    slot.promise = __adjudicateFetch(machineId, username)
        .catch(() => ({ netFail: true }))
        .then((r) => { slot.settled = true; return r; });
    __adjPrewarm = slot;
}

// 一次性取出可复用的预取结果（LICENSED 才用）；其余情况新鲜补裁。
function __consumeAdjPrewarm(machineId, username) {
    if (!__adjPrewarm) return null;
    if (Date.now() - __adjPrewarm.at > ADJ_PREWARM_TTL_MS) { __adjPrewarm = null; return null; }
    if (__adjPrewarm.key !== machineId + '|' + (username || '')) return null;
    const slot = __adjPrewarm;
    __adjPrewarm = null; // ② one-shot：主窗自检不得再复用
    return slot.promise
        .then((r) => (r && r.ok && r.ent && r.ent.success === true && r.ent.state === 'LICENSED')
            ? r
            : __adjudicateFetch(machineId, username))
        .catch(() => __adjudicateFetch(machineId, username));
}

async function adjudicateViaMainProcess(machineId, username) {
    const cached = __consumeAdjPrewarm(machineId, username);
    if (cached) return cached;
    return __adjudicateFetch(machineId, username);
}

function gateStateMessage(state) {
    return {
        'NO_LICENSE': '该诊所/激活码已被删除，无法登录。如有疑问请联系客服',
        'LICENSE_REVOKED': '授权已被吊销，无法登录，请联系客服',
        'LICENSE_EXPIRED': '授权已过期，请续费后再登录',
        'ACCOUNT_REVOKED': '该账号已被删除，无法登录。如有疑问请联系客服',
        'DEVICE_DISABLED': '本设备已被停用，请联系客服'
    }[state] || '授权状态异常，无法登录，请联系客服';
}

// ============================================================================
//  ★ 二级锚点（2026-09-23 纵深防御，针对复审高-1）
//  攻击面：本机用户删 gate.dat 即可重播种 7 天宽限；删 license.dat+gate.dat
//  可降级全新试用（everActivated 随文件灭失）。二级锚点 .license-anchor 与
//  gate.dat 物理分离（便携版 gate 在 exe 目录、anchor 在 userData），密钥
//  purpose 独立（'anchor-enc'/'anchor-mac'），只删一个文件无法重置/降级。
//  残留风险：两锚点同源于随包静态 IKM，持有静态密钥的逆向者可同时伪造；
//  根治需 OS 密钥库（Windows DPAPI/TPM、Android Keystore），已列入路线。
// ============================================================================
function getAnchorPath() {
    return path.join(app.getPath('userData'), '.license-anchor');
}
function encryptAnchor(jsonStr, mid) {
    const key = hkdfPurposeKey(mid, 'anchor-enc');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const payload = Buffer.concat([iv, cipher.update(Buffer.from(jsonStr, 'utf8')), cipher.final()]).toString('base64');
    const mk = hkdfPurposeKey(mid, 'anchor-mac');
    const hmac = crypto.createHmac('sha256', mk).update(payload).digest('hex');
    return 'ANC2:' + hmac + ':' + payload;
}
function decryptAnchor(encrypted, mid) {
    try {
        if (!encrypted || encrypted.indexOf('ANC2:') !== 0) return null;
        const parts = encrypted.substring(5).split(':');
        if (parts.length < 2) return null;
        const payload = parts.slice(1).join(':');
        const mk = hkdfPurposeKey(mid, 'anchor-mac');
        const expected = crypto.createHmac('sha256', mk).update(payload).digest('hex');
        if (!crypto.timingSafeEqual(Buffer.from(parts[0], 'hex'), Buffer.from(expected, 'hex'))) return null;
        const data = Buffer.from(payload, 'base64');
        const decipher = crypto.createDecipheriv('aes-256-cbc', hkdfPurposeKey(mid, 'anchor-enc'), data.slice(0, 16));
        return Buffer.concat([decipher.update(data.slice(16)), decipher.final()]).toString('utf8');
    } catch (e) { return null; }
}
function readAnchorState(mid) {
    try {
        const p = getAnchorPath();
        if (!fs.existsSync(p)) return null;
        const json = decryptAnchor(fs.readFileSync(p, 'utf8'), mid);
        return json ? JSON.parse(json) : null;
    } catch (e) { return null; }
}
function writeAnchorState(state, mid) {
    try {
        fs.writeFileSync(getAnchorPath(), encryptAnchor(JSON.stringify(state), mid), { mode: 0o600 });
        return true;
    } catch (e) {
        console.warn('[Gate] 二级锚点写入失败:', e && e.message);
        return false;
    }
}

// ============================================================================
//  ★ 2026-09-26 M-2 根治：Windows 凭据管理器锚点（替代可双删的文件锚点）
//
//  旧风险：gate.dat + .license-anchor 两个文件双删后，在线吊销/账号删除的拒绝
//  标记与 7 天宽限起点全部消失 → 断网滚动重播种即可无限本地使用。
//  现把【统一状态】经 CredWrite 存进 Windows 凭据管理器（Generic 凭据，DPAPI
//  保管、按 Windows 用户隔离），资源管理器/del/双删均无法触及，只能经
//  shared/credential-vault.ps1 的 delete/write 通道操作。
//
//  威胁模型边界（诚实记录）：凭据管理器把攻击门槛从「任何用户删两个文件」提高
//  到「需代码执行 + CredWrite API + 重算机器密钥并构造有效密文」——对教程级
//  /脚本小子级双删是根治；但同 Windows 用户下已具备代码执行能力的攻击者仍可
//  调 CredWrite 重写 blob（本地软件对本机代码执行无纯客户端数学解）。残余项
//  对应未来「服务端短周期 token + 设备证明」路线。
//
//  降级：PowerShell/凭据 API 不可用（极旧系统或策略禁用）时自动回落旧双文件
//  模式，可用性不变，风险仅限该类罕见机器。环境变量 BNZC_VAULT_DISABLED=1
//  供测试强制走文件路径。
// ============================================================================
// 打包态判定：生产包【不信任任何环境变量安全配置】——否则普通用户一条
// `setx BNZC_VAULT_DISABLED 1` 就能把 vault 永久打回可双删的文件模式。
// 开发/冒烟（node 或 -app 直启）下 app.isPackaged 为假，env 开关才生效。
function isAppPackaged() {
    try { return !!require('electron').app.isPackaged; }
    catch (e) {
        try { return __dirname.indexOf('app.asar') !== -1; }
        catch (e2) { return false; }
    }
}
const VAULT_PACKAGED = isAppPackaged();
const VAULT_TARGET_PREFIX =
    (!VAULT_PACKAGED && process.env.BNZC_VAULT_TARGET_PREFIX) || 'BNZC/license-vault/';
let _vaultHealth = 0;     // 0=未探测 1=可用 -1=瞬态失败（退避到期可重试）
let _vaultFailAt = 0;
let _vaultEnvDisabled = false; // 开发态经 BNZC_VAULT_DISABLED 显式禁用（非故障）
const VAULT_RETRY_MS = 30000;

// 定位随包 ps1：展平分发布局（electron/credential-vault.ps1）或 shared 布局
function getVaultPs1Path() {
    // 禁用开关仅开发态生效（打包后忽略，防普通用户 setx 关闭 vault）
    if (!VAULT_PACKAGED && process.env.BNZC_VAULT_DISABLED === '1') return null;
    const cands = [
        path.join(__dirname, 'credential-vault.ps1'),        // 进包：electron/
        path.join(__dirname, '..', 'credential-vault.ps1')  // 开发：shared/license/
    ];
    for (const f of cands) {
        try { if (fs.existsSync(f)) return f; } catch (e) { /* 续 */ }
    }
    return null;
}

// 经 EncodedCommand 执行 ps1（asar 内无法 -File；参数走环境变量，ps1 同口径）
function vaultInvoke(action, target, value) {
    const ps1Path = getVaultPs1Path();
    if (!ps1Path) return { ok: false, error: 'vault-ps1-unavailable' };
    let script;
    try { script = fs.readFileSync(ps1Path, 'utf8'); }
    catch (e) { return { ok: false, error: 'vault-ps1-read-failed' }; }
    // ★ EncodedCommand 下脚本按 Unicode 传入，文件 UTF-8 BOM 会成为内容首字符，
    //   使 param 块不再是首个语句而解析失败（InvalidLeftHandSide）——剥掉 BOM
    if (script.charCodeAt(0) === 0xFEFF) script = script.slice(1);

    const env = Object.assign({}, process.env, {
        BNZC_VAULT_ACTION: action,
        BNZC_VAULT_TARGET: target || '',
        BNZC_VAULT_VALUE: value || ''
    });
    const psExe = process.env.SystemRoot
        ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
        : 'powershell.exe';
    let stdout;
    try {
        stdout = childProcess.execFileSync(psExe, [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')
        ], { env, timeout: 15000, maxBuffer: 1 << 20, windowsHide: true });
    } catch (e) {
        return { ok: false, error: 'vault-spawn-failed' };
    }
    const lines = String(stdout || '').trim().split(/[\r\n]+/).filter(Boolean);
    if (!lines.length) return { ok: false, error: 'vault-empty-output' };
    try { return JSON.parse(lines[lines.length - 1]); }
    catch (e) { return { ok: false, error: 'vault-bad-json' }; }
}

// ★ 2026-10-01 启动性能根治：vault 异步原语族。
//   背景：vaultInvoke 用 execFileSync 同步 spawn PowerShell（单次实测 1.5~3.4s），
//   verifyLoginGate（登录窗/主窗打开即触发）链路 3 次同步 PS 累计冻结主进程
//   ~4.5s——所有窗口 IPC/compositor 调度全停，用户感知"打开登录框/页面异常缓慢"。
//   异步化后 PS 仍要跑同样时长，但主进程事件循环不再被阻塞（UI 流畅，仅授权
//   检查本身耗时，渲染端本就有等待态）。
//   安全语义与同步版逐条等价（fresh 读合并 / uncertain 不覆写 / 双文件降级），
//   写链经 _vaultWriteChain 串行化保持同步版"主进程单线程天然串行"的写序。
function __vaultParseStdout(stdout) {
    const lines = String(stdout || '').trim().split(/[\r\n]+/).filter(Boolean);
    if (!lines.length) return { ok: false, error: 'vault-empty-output' };
    try { return JSON.parse(lines[lines.length - 1]); }
    catch (e) { return { ok: false, error: 'vault-bad-json' }; }
}
function vaultInvokeAsync(action, target, value) {
    return new Promise((resolve) => {
        const ps1Path = getVaultPs1Path();
        if (!ps1Path) { resolve({ ok: false, error: 'vault-ps1-unavailable' }); return; }
        let script;
        try { script = fs.readFileSync(ps1Path, 'utf8'); }
        catch (e) { resolve({ ok: false, error: 'vault-ps1-read-failed' }); return; }
        if (script.charCodeAt(0) === 0xFEFF) script = script.slice(1);
        const env = Object.assign({}, process.env, {
            BNZC_VAULT_ACTION: action,
            BNZC_VAULT_TARGET: target || '',
            BNZC_VAULT_VALUE: value || ''
        });
        const psExe = process.env.SystemRoot
            ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
            : 'powershell.exe';
        // ★ 2026-10-01：execFile 极端错误（EMFILE/EINVAL）可能同步抛出，包一层
        //   与回调失败同口径 resolve（永不 reject），避免沿写链冒泡成未捕获异常
        //   且跳过文件降级（双审查 A-建议2）。
        try {
            childProcess.execFile(psExe, [
                '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')
            ], { env, timeout: 15000, maxBuffer: 1 << 20, windowsHide: true },
                (err, stdout) => {
                    if (err) { resolve({ ok: false, error: 'vault-spawn-failed' }); return; }
                    resolve(__vaultParseStdout(stdout));
                });
        } catch (e) {
            resolve({ ok: false, error: 'vault-spawn-failed' });
        }
    });
}

// 异步读单 mid（与 readVaultState 同语义）
async function readVaultStateAsync(mid) {
    const r = await vaultInvokeAsync('read', VAULT_TARGET_PREFIX + mid, '');
    if (!r || r.ok !== true) return { dead: true };
    if (!r.found || !r.blob) return { dead: false, state: null };
    return decryptVaultRecord(r.blob, mid);
}
// 异步批量读（与 readVaultStates 同语义：一次 PS 进程合并 N 候选）
async function readVaultStatesAsync(mids) {
    const list = mids.filter(Boolean);
    if (!list.length) return [];
    const joined = list.map(m => VAULT_TARGET_PREFIX + m).join(',');
    const r = await vaultInvokeAsync('read-many', joined, '');
    if (!r || r.ok !== true || !Array.isArray(r.items)) {
        return list.map(() => ({ dead: true }));
    }
    return list.map((m) => {
        const item = r.items.find(it => it && it.target === VAULT_TARGET_PREFIX + m);
        if (!item || item.error) return { dead: true };
        if (!item.found || !item.blob) return { dead: false, state: null };
        return decryptVaultRecord(item.blob, m);
    });
}
// 异步写（与 writeVaultState 同语义）
async function writeVaultStateAsync(state, mid) {
    if (!_emptyFpWarned && getHardwareFingerprint() === '') {
        _emptyFpWarned = true;
        console.error('[Gate] 硬件指纹采集全部失败，vault blob 未绑定硬件（请检查系统）');
    }
    let blob;
    try { blob = encryptVaultBlob(JSON.stringify(state), mid); }
    catch (e) { return false; }
    const r = await vaultInvokeAsync('write', VAULT_TARGET_PREFIX + mid, blob);
    if (r && r.ok === true) return true;
    console.warn('[Gate] vault 写入失败，本次回落文件：', r && r.error);
    return false;
}
// 异步跨候选解析（与 resolveVaultState 同语义：全候选级联合并、写回 primary、删旧）
async function resolveVaultStateAsync(primaryMid) {
    const variants = getMidVariants();
    const results = await readVaultStatesAsync(variants);
    const found = [];
    let anyDead = false, anyCorrupt = false;
    for (let i = 0; i < variants.length; i++) {
        const v = results[i];
        if (!v || v.dead) { anyDead = true; continue; }
        if (v.state) found.push({ mid: variants[i], state: v.state });
        if (v.corrupt) anyCorrupt = true;
    }
    if (!found.length) {
        if (anyDead) return { dead: true };
        return { dead: false, state: null, corrupt: anyCorrupt };
    }
    let merged = {};
    for (const f of found) merged = mergeUnifiedStates(merged, f.state);
    if (found.length === 1 && found[0].mid === primaryMid) {
        const __st = found[0].state;
        if (__st && (__st.usersBackupGenV2 || __st.usersLegacyRetiredV2)) {
            __st.usersBackupGenV2 = mergeDomainGenMaps(null, __st.usersBackupGenV2);
            __st.usersLegacyRetiredV2 = mergeDomainRetiredMaps(null, __st.usersLegacyRetiredV2);
        }
        return { dead: false, state: __st };
    }
    if (await writeVaultStateAsync(merged, primaryMid)) {
        for (const f of found) {
            if (f.mid !== primaryMid) {
                await vaultInvokeAsync('delete', VAULT_TARGET_PREFIX + f.mid, '');
            }
        }
        return { dead: false, state: merged };
    }
    return { dead: false, state: merged };
}
// 异步统一态读取（与 readUnifiedStateFresh 同语义，全链 await）
async function readUnifiedStateFreshAsync(mid) {
    if (vaultAvailable()) {
        const v = await resolveVaultStateAsync(mid);
        if (v.dead) {
            markVaultTransient();
        } else {
            const fileState = readFileLegacyState(mid);
            if (v.state && fileState) {
                const merged = mergeUnifiedStates(v.state, fileState);
                if (await writeVaultStateAsync(merged, mid)) {
                    removeLegacyAnchorFiles();
                    return { vault: true, state: merged };
                }
                return { vault: false, state: merged };
            }
            if (v.state) return { vault: true, state: v.state };
            if (fileState) {
                if (v.corrupt) return { vault: false, state: fileState, uncertain: true };
                if (await writeVaultStateAsync(fileState, mid)) {
                    removeLegacyAnchorFiles();
                    console.log('[Gate] 旧双文件锚点已迁移进 Windows 凭据管理器');
                    return { vault: true, state: fileState };
                }
                return { vault: false, state: fileState };
            }
            if (v.corrupt) return { vault: true, state: null, uncertain: true };
            return { vault: true, state: null };
        }
    }
    const fileState = readFileLegacyState(mid);
    if (fileState) return { vault: false, state: fileState };
    return { vault: false, state: null, uncertain: !_vaultEnvDisabled };
}
// 异步统一态读取（缓存 + in-flight 单飞去重：并发 IPC 只 spawn 一次 PS）
let _unifiedReadInFlight = null;
function readUnifiedStateAsync(mid) {
    const now = Date.now();
    if (_unifiedCache && _unifiedCache.mid === mid && now - _unifiedCache.at < UNIFIED_CACHE_MS) {
        let hasLegacy = false;
        try { hasLegacy = fs.existsSync(getGatePath()) || fs.existsSync(getAnchorPath()); }
        catch (e) { hasLegacy = false; }
        if (!hasLegacy) return Promise.resolve(_unifiedCache.result);
    }
    if (_unifiedReadInFlight && _unifiedReadInFlight.mid === mid) return _unifiedReadInFlight.p;
    // 记录读发起时刻：冷 PS 读飞行 1.5~14s，期间同步 writeUnifiedState
    // （execFileSync 阻塞模型）可整体插队完成 invalidate→fresh读→CredWrite→
    // 回填缓存；晚到的异步读回调携带的是插队前的旧镜像，绝不能反覆盖更新的
    // 权威回填，否则后续 async 写会以旧态为基底整 blob 回退（双审查 A#1）。
    const readStartedAt = Date.now();
    const p = readUnifiedStateFreshAsync(mid).then((result) => {
        if (result.vault === true) {
            const cc = _unifiedCache;
            if (!cc || cc.mid !== mid || cc.at <= readStartedAt) {
                _unifiedCache = { mid, at: Date.now(), result };
            }
        }
        return result;
    }).finally(() => { if (_unifiedReadInFlight && _unifiedReadInFlight.p === p) _unifiedReadInFlight = null; });
    _unifiedReadInFlight = { mid, p };
    return p;
}
// 异步统一态写入（与 writeUnifiedState 同语义：fresh 读合并、写成功回填缓存、
// 失败降级双文件）；_vaultWriteChain 串行化保持同步版天然串行的写序。
let _vaultWriteChain = Promise.resolve();
function writeUnifiedStateAsync(state, mid, freshRead, patchLike) {
    // ★ 2026-10-01 根修（双独立审查阻断项）：合并基底必须在"执行时刻"选定，
    //   不能信任入队时刻传入的 freshRead。写链只串行化执行，多个写常背靠背入队
    //   （gen+退役、trial 高水位+弱哈希备份），PS CredWrite 单次 1.5~9s，等轮到
    //   自己执行时入队时快照早已陈旧——若据此整 blob CredWrite，会把链上前一写
    //   刚落的增量（gen/墓碑/lastSeenHigh，极端时序下甚至 installLicense 同步
    //   落账的 everActivated）整包回退。规则（freshRead 形参保留仅作调用方意图
    //   声明，实际基底只认执行时刻状态）：
    //   ① 入队之后本进程有更新的 vault 读/写回填（cache.at > enqueueAt，含同步
    //      权威写回填）→ 一律以最新镜像为基底（本进程串行写序即真相）；
    //   ② 否则缓存镜像 vault 非空且年龄 <2s（同 tick 刚读/fresh PS 读均会新鲜
    //      回填，外部无并发窗口）→ 用之（覆盖 patch 链传 freshRead 的零 PS 场景）；
    //   ③ 否则（含空 vault 首写、缓存超窗）invalidate + fresh PS 读，保持云/离
    //      并发 M3 前提，杜绝 30s 陈旧镜像整包覆盖对端域键；
    //   ④ 写后复核：async CredWrite await 让出事件循环期间，同步 writeUnifiedState
    //      （execFileSync 阻塞模型，如 installLicense 激活落账）可以整体插队完成
    //      自己的读-改-写；若写完发现 cache.at 新于本次基底，说明插队权威写已被
    //      我们这次 blob 覆盖——立即以其镜像为基底重合并本次补丁并再写一次
    //      （最多 3 次收敛）。链上其他 async 写都排在本 run 之后，不可能插队，
    //      竞争者只有同步写；排队 async 写随后经规则①采用本次回填，链式收敛。
    //   ⑤ 补丁类写（patchLike，仅 gen/退役键）基底不明或 vault uncertain 时绝不
    //      裸写 vault（裸补丁整 blob 会抹掉 everActivated/账号墓碑等安全键，
    //      fail-open），按域单调合并落双文件，待 vault 恢复对账——同同步
    //      patchUnifiedState 语义。权威全态写（persist 在线裁决）不适用。
    //   ⑥ 复核 3 次仍持续观测到插队（极端竞争）不撒谎 return true：失效缓存
    //      强制对账并返回 false，状态翻转类调用方（均 await）按失败重试。
    const enqueueAt = Date.now();
    mid = mid || getMachineId();
    const mergeOnto = (cs) => {
        const out = Object.assign({}, cs, state);
        out.usersBackupGenV2 = mergeDomainGenMaps(cs.usersBackupGenV2, state.usersBackupGenV2);
        out.usersLegacyRetiredV2 = mergeDomainRetiredMaps(cs.usersLegacyRetiredV2, state.usersLegacyRetiredV2);
        // accountReject 刻意保持顶层整键替换（不用 mergeRejectMaps 并集）：
        // clearAccountRejectIfMatch 解封路径依赖"在线确认有效→删除本用户名条目
        // →整键写回"完成墓碑移除，并集会把已解除条目复活致合法用户无法登录。
        // 代价（两个不同用户名裁决背靠背时后写旧快照抹掉前者墓碑）在现实不可达：
        // 翻转类 persist 全部 await、登录裁决 UI 串行、心跳自检 username 为空。
        return out;
    };
    const run = async () => {
        let s = state;
        let baseAt = 0;
        let spillToFiles = false; // 补丁写须走双文件分流（基底不明/uncertain）
        try {
            let cur;
            const c = _unifiedCache;
            const sameMidVault = !!(c && c.mid === mid && c.result && c.result.vault === true);
            const newerThanQueue = sameMidVault && c.at > enqueueAt;
            const selfFresh = sameMidVault && !!c.result.state && (Date.now() - c.at < 2000);
            if (newerThanQueue || selfFresh) {
                cur = c.result;
            } else {
                invalidateUnifiedCache();
                const readStart = Date.now();
                cur = await readUnifiedStateAsync(mid);
                // 读飞行窗口（冷 PS 1.5~14s）内同步权威写整体插队完成时，缓存已
                // 被其更新镜像占据（回填守卫保证晚到读不反覆盖）→ 改用更新镜像，
                // 不能用 Promise 带回的插队前旧态当基底（双审查 A#1 配套）。
                const cf = _unifiedCache;
                if (cf && cf.mid === mid && cf.result && cf.result.vault === true
                    && cf.result.state && cf.at > readStart && cf.result !== cur) {
                    cur = cf.result;
                }
            }
            // fresh PS 读与缓存命中都会把 result 回填 _unifiedCache（同引用），
            // 记录基底时间戳供写后复核比对。
            const c2 = _unifiedCache;
            if (c2 && c2.mid === mid && c2.result === cur) baseAt = c2.at;
            const cs = cur.state;
            if (cs) {
                s = mergeOnto(cs);
                // vault 暂时解不开（指纹抖动/瞬态损坏），cs 只是文件侧镜像：
                // 补丁不得覆写真 vault（权威写的 uncertain 覆写是设计语义，不限）
                if (patchLike && cur.uncertain) spillToFiles = true;
            } else if (patchLike && cur.uncertain) {
                spillToFiles = true; // vault 解不开/状态不明：补丁落双文件；
                // 注意真空 vault（found:false、非 uncertain）不在此列——裸补丁
                // 直写正是锚点首建路径，vault 本空无安全键可抹（同同步版语义）。
            }
        } catch (e) {
            if (patchLike) {
                // fresh 读抛错（fs/解析异常）：禁止裸补丁直写 vault。尽力合并
                // 文件侧旧态后走双文件，与同步 patchUnifiedState 分流同构。
                spillToFiles = true;
                try {
                    const fst = readFileLegacyState(mid);
                    if (fst) {
                        s = Object.assign({}, fst, state);
                        s.usersBackupGenV2 = mergeDomainGenMaps(fst.usersBackupGenV2, state.usersBackupGenV2);
                        s.usersLegacyRetiredV2 = mergeDomainRetiredMaps(fst.usersLegacyRetiredV2, state.usersLegacyRetiredV2);
                    }
                } catch (e2) { s = state; }
            } else {
                s = state; // 权威全态写：读取异常按旧行为直写，vault 写自身成败兜底
            }
        }
        // ⑤ 补丁分流：基底不明/uncertain，只落双文件绝不碰 vault
        if (spillToFiles) {
            invalidateUnifiedCache();
            if (!_vaultEnvDisabled) markVaultTransient();
            let gOk0 = false, aOk0 = false;
            try { gOk0 = !!writeGateState(s, mid); } catch (e) { /* 续写 anchor */ }
            try { aOk0 = !!writeAnchorState(s, mid); } catch (e) { /* 忽略 */ }
            return !!(gOk0 || aOk0);
        }
        if (vaultAvailable()) {
            let wrote = await writeVaultStateAsync(s, mid);
            // ④ 写后复核+重合并重写（见函数头注释）
            let guard = 0;
            let converged = true;
            while (wrote) {
                const cc = _unifiedCache;
                const jumpedIn = cc && cc.mid === mid && cc.result && cc.result.vault === true
                    && !!cc.result.state && cc.at > baseAt;
                if (!jumpedIn) break;
                if (guard++ >= 3) { converged = false; break; }
                baseAt = cc.at;
                s = mergeOnto(cc.result.state);
                wrote = await writeVaultStateAsync(s, mid);
            }
            if (wrote && converged) {
                _unifiedCache = { mid, at: Date.now(), result: { vault: true, state: s } };
                return true;
            }
            // ⑥ 持续插队未收敛：失效缓存强制下次 fresh 对账，不谎报成功
            if (!converged) {
                invalidateUnifiedCache();
                return false;
            }
        }
        // 降级写双文件后进程内 vault 缓存不再代表完整态（文件侧可能被 M3 读回合并），
        // 显式失效，下一次读重新 fresh 合并。
        invalidateUnifiedCache();
        if (!_vaultEnvDisabled) markVaultTransient();
        let gOk = false, aOk = false;
        try { gOk = !!writeGateState(s, mid); } catch (e) { /* 继续写 anchor */ }
        try { aOk = !!writeAnchorState(s, mid); } catch (e) { /* 忽略 */ }
        return !!(gOk || aOk);
    };
    const p = _vaultWriteChain.then(run, run);
    _vaultWriteChain = p.catch(() => {});
    return p;
}
// 异步 getUnifiedGate（与 getUnifiedGate 同语义）
async function getUnifiedGateAsync(mid) {
    // ★ 2026-10-01：必须返回浅拷贝。readUnifiedStateAsync 命中 30s 缓存时 r.state
    //   就是 _unifiedCache 本体，而 verifyLoginGate 会就地改 gate（lastVerify/
    //   lastSeenHigh/accountReject、trial 纯放行等），且部分路径不 await 落盘——
    //   若直接透出本体，心跳/并发调用会在缓存窗口里读到"半裁决"污染态。嵌套 V2
    //   map 裁决只读，且写链 mergeDomain*Maps 恒返回新对象，顶层 + accountReject
    //   一层拷贝即足。
    const r = await readUnifiedStateAsync(mid);
    const s = Object.assign({}, r.state || {});
    if (!s.accountReject || s.accountReject.__arMap !== 1) {
        s.accountReject = normalizeRejectMap(s.accountReject);
    } else {
        s.accountReject = Object.assign({}, s.accountReject);
    }
    return {
        gate: s,
        anchor: s,
        vault: r.vault === true,
        uncertain: r.uncertain === true,
        everActivated: !!s.everActivated,
        lastReject: s.lastReject || null,
        lastVerify: Number(s.lastVerify) || 0,
        lastSeenHigh: Number(s.lastSeenHigh) || 0,
        accountReject: s.accountReject || {}
    };
}

// ★ 2026-10-02 快车道专用：零 PS 读取"仍在缓存窗内"的本机高水位，用于在不付
//   vault 冷读代价的前提下识别时钟回拨。缓存冷/不鲜/vault 降级一律返回 0
//   （调用方按"无法判定"保守处理）。
function __getWarmLastSeenHigh(mid) {
    try {
        const c = _unifiedCache;
        if (!c || c.mid !== mid || !c.result || c.result.vault !== true) return 0;
        if (Date.now() - c.at > UNIFIED_CACHE_MS) return 0;
        return Number(c.result.state && c.result.state.lastSeenHigh) || 0;
    } catch (e) { return 0; }
}

// 凭据子系统健康探测（懒加载）：失败只标记时间，退避到期允许重试——
// PowerShell 冷启动/杀软拖慢造成的瞬态失败不应永久封死本进程。
function vaultProbe() {
    if (_vaultHealth === 1) return true;
    const now = Date.now();
    if (_vaultHealth === -1 && now - _vaultFailAt < VAULT_RETRY_MS) return false;
    if (!VAULT_PACKAGED && process.env.BNZC_VAULT_DISABLED === '1') _vaultEnvDisabled = true;
    if (getVaultPs1Path() === null) { _vaultHealth = -1; _vaultFailAt = now; return false; }
    const r = vaultInvoke('probe', '', '');
    if (r && r.ok === true) { _vaultHealth = 1; return true; }
    _vaultHealth = -1;
    _vaultFailAt = now;
    return false;
}
// 运行中 read/write 瞬态故障：转退避态（下次调用到期可重试，不永久判决）
function markVaultTransient() {
    _vaultHealth = -1;
    _vaultFailAt = Date.now();
}

// 轻量可用性门（不 spawn 进程）：仅环境禁用与退避期短路。实际探活由
// read-many/write 本身的成败承担（read 对 spawn 失败返回 dead，语义等价
// probe 且省一次 PS spawn——单次 spawn 本机实测 2.5s+，启动链敏感）。
function vaultAvailable() {
    if (!VAULT_PACKAGED && process.env.BNZC_VAULT_DISABLED === '1') _vaultEnvDisabled = true;
    if (_vaultEnvDisabled) return false;
    if (_vaultHealth === -1 && Date.now() - _vaultFailAt < VAULT_RETRY_MS) return false;
    return true;
}

// vault 独立加密用途（与 license.dat / gate.dat 的 'license' 域分离，
// 防密文跨位置互换重放）。格式 VLT2:hex(hmac):base64(iv+ciphertext)
function encryptVaultBlob(jsonStr, mid) {
    const key = hkdfPurposeKey(mid, 'vault-enc');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const payload = Buffer.concat([
        iv,
        cipher.update(Buffer.from(jsonStr, 'utf8')),
        cipher.final()
    ]).toString('base64');
    const mk = hkdfPurposeKey(mid, 'vault-mac');
    const hmac = crypto.createHmac('sha256', mk).update(payload).digest('hex');
    return 'VLT2:' + hmac + ':' + payload;
}
function decryptVaultBlob(blob, mid, fp) {
    try {
        if (!blob || blob.indexOf('VLT2:') !== 0) return null;
        const parts = blob.substring(5).split(':');
        if (parts.length < 2) return null;
        const storedHmac = parts[0];
        const payload = parts.slice(1).join(':');
        const mk = hkdfPurposeKey(mid, 'vault-mac', undefined, fp);
        const expected = crypto.createHmac('sha256', mk).update(payload).digest('hex');
        if (!crypto.timingSafeEqual(Buffer.from(storedHmac, 'hex'), Buffer.from(expected, 'hex'))) {
            return null;
        }
        const data = Buffer.from(payload, 'base64');
        if (data.length < 32) return null;
        const decipher = crypto.createDecipheriv('aes-256-cbc',
            hkdfPurposeKey(mid, 'vault-enc', undefined, fp), data.slice(0, 16));
        return Buffer.concat([decipher.update(data.slice(16)), decipher.final()]).toString('utf8');
    } catch (e) { return null; }
}

// 早期 vault（曾用 license 用途 ENC2 写入）按指定指纹候选解密
function decryptEnc2VaultFallback(blob, mid, fp) {
    try {
        if (!blob || blob.indexOf('ENC2:') !== 0) return null;
        const parts = blob.substring(5).split(':');
        if (parts.length < 2) return null;
        const storedHmac = parts[0];
        const payload = parts.slice(1).join(':');
        const mk = hkdfPurposeKey(mid, 'license-hmac', undefined, fp);
        const expected = crypto.createHmac('sha256', mk).update(payload).digest('hex');
        if (!crypto.timingSafeEqual(Buffer.from(storedHmac, 'hex'), Buffer.from(expected, 'hex'))) {
            return null;
        }
        const data = Buffer.from(payload, 'base64');
        if (data.length < 32) return null;
        const decipher = crypto.createDecipheriv('aes-256-cbc',
            hkdfPurposeKey(mid, 'license', undefined, fp), data.slice(0, 16));
        return Buffer.concat([decipher.update(data.slice(16)), decipher.final()]).toString('utf8');
    } catch (e) { return null; }
}

function readVaultState(mid) {
    const r = vaultInvoke('read', VAULT_TARGET_PREFIX + mid, '');
    if (!r || r.ok !== true) return { dead: true };
    if (!r.found || !r.blob) return { dead: false, state: null };
    return decryptVaultRecord(r.blob, mid);
}

// blob → 统一状态（遍历指纹候选，VLT2 与早期 ENC2 回退）
function decryptVaultRecord(blob, mid) {
    let json = null;
    for (const fp of getHwFingerprintVariants()) {
        json = decryptVaultBlob(blob, mid, fp) || decryptEnc2VaultFallback(blob, mid, fp);
        if (json) break;
    }
    if (!json) return { dead: false, state: null, corrupt: true };
    try { return { dead: false, state: JSON.parse(json) || null }; }
    catch (e) { return { dead: false, state: null, corrupt: true }; }
}

// 批量读：N 个 mid 候选合并为一次 PS 进程（单次 PS spawn 本机实测 2.5s+，
// 逐个 spawn 会让登录/激活启动链阻塞 N×2.5s——E2E 与慢机实测回归）
function readVaultStates(mids) {
    const list = mids.filter(Boolean);
    if (!list.length) return [];
    const joined = list.map(m => VAULT_TARGET_PREFIX + m).join(',');
    const r = vaultInvoke('read-many', joined, '');
    if (!r || r.ok !== true || !Array.isArray(r.items)) {
        // 批量整体失败（spawn/输出异常）按全 dead 处理
        return list.map(() => ({ dead: true }));
    }
    return list.map((m) => {
        const item = r.items.find(it => it && it.target === VAULT_TARGET_PREFIX + m);
        if (!item || item.error) return { dead: true };
        if (!item.found || !item.blob) return { dead: false, state: null };
        return decryptVaultRecord(item.blob, m);
    });
}
let _emptyFpWarned = false;
function writeVaultState(state, mid) {
    // 采集全失败时静默写会让 blob 脱离硬件绑定——显式告警（不拒绝，保可用性）
    if (!_emptyFpWarned && getHardwareFingerprint() === '') {
        _emptyFpWarned = true;
        console.error('[Gate] 硬件指纹采集全部失败，vault blob 未绑定硬件（请检查系统）');
    }
    let blob;
    try { blob = encryptVaultBlob(JSON.stringify(state), mid); }
    catch (e) { return false; }
    const r = vaultInvoke('write', VAULT_TARGET_PREFIX + mid, blob);
    if (r && r.ok === true) return true;
    // 触顶等确定性失败显式告警（叠加对账机制避免静默丢状态）
    console.warn('[Gate] vault 写入失败，本次回落文件：', r && r.error);
    return false;
}

// mid 候选：当前 mid + 各指纹候选（mg-only 等）对应的 mid。Win11 移除
// wmic 会让 mid 自身变化——vault target 必须逐个候选查找，否则旧凭据被孤立
let _midVariantsCache = null;
function getMidVariants() {
    if (_midVariantsCache) return _midVariantsCache;
    const list = [getMachineId()];
    for (const fp of getHwFingerprintVariants()) {
        const m = getMachineId(fp);
        if (m && list.indexOf(m) === -1) list.push(m);
    }
    _midVariantsCache = list.filter(Boolean);
    return _midVariantsCache;
}

// 跨 mid 候选解析 vault：扫描【全部】候选 target，所有命中态级联合并
// （不能命中第一个即返回——抖动下旧 target 可能遮蔽更新的拒绝），合并态写
// primary，再统一删除所有旧 target。
function resolveVaultState(primaryMid) {
    const variants = getMidVariants();
    // 批量读（1 次 PS 进程），避免逐候选 spawn 的启动链阻塞
    const results = readVaultStates(variants);
    const found = [];
    let anyDead = false, anyCorrupt = false;
    for (let i = 0; i < variants.length; i++) {
        const v = results[i];
        if (!v || v.dead) { anyDead = true; continue; }
        if (v.state) found.push({ mid: variants[i], state: v.state });
        if (v.corrupt) anyCorrupt = true;
    }
    if (!found.length) {
        if (anyDead) return { dead: true };
        return { dead: false, state: null, corrupt: anyCorrupt };
    }
    let merged = {};
    for (const f of found) merged = mergeUnifiedStates(merged, f.state);
    // 稳态快路径：唯一命中就在 primary——无需重写（每次读省一次 PS 写进程）。
    // ★ 2026-09-30：raw 直返前对两张 V2 map 过白名单归一（blob 虽经机器密钥
    //   加密，纵深防御 __proto__/constructor 等异类键残留进入后续读-改-写链）。
    if (found.length === 1 && found[0].mid === primaryMid) {
        const __st = found[0].state;
        if (__st && (__st.usersBackupGenV2 || __st.usersLegacyRetiredV2)) {
            __st.usersBackupGenV2 = mergeDomainGenMaps(null, __st.usersBackupGenV2);
            __st.usersLegacyRetiredV2 = mergeDomainRetiredMaps(null, __st.usersLegacyRetiredV2);
        }
        return { dead: false, state: __st };
    }
    if (writeVaultState(merged, primaryMid)) {
        for (const f of found) {
            if (f.mid !== primaryMid) {
                vaultInvoke('delete', VAULT_TARGET_PREFIX + f.mid, '');
            }
        }
        return { dead: false, state: merged };
    }
    return { dead: false, state: merged };
}

// 两个统一状态对账合并
// 权威侧 = lastVerify 较大一侧：其 null 字段（LICENSED 清除）必须生效，
// 不能被另一侧旧态复活（曾误拒合法用户）。
function mergeUnifiedStates(a, b) {
    a = a || {};
    b = b || {};
    const va = Number(a.lastVerify) || 0, vb = Number(b.lastVerify) || 0;
    let auth;
    if (vb > va) auth = b;
    else if (va > vb) auth = a;
    else {
        // verify 同刻（如 vault 写拒绝失败、只落文件）：拒绝跟较晚 rejectAt
        auth = (Number(b.rejectAt) || 0) > (Number(a.rejectAt) || 0) ? b : a;
    }
    // 墓碑只做保守并集：merge 无法区分「权威侧曾承载该键后被在线裁决清除」与
    // 「权威侧由启动读缺口（PS 冷启动/杀软/退避）建立、从未加载过该键」——
    // 凭 at<verify 推断清除会误删合法墓碑（R4-1）。合法清除只走本人在线
    // LICENSED 的 clearAccountRejectIfMatch 显式通道并随 persist 全量落盘；
    // 若当次 vault 写失败导致旧键残留，并集期间该用户离线仍被拒（fail-closed，
    // 下次在线 LICENSED 重试清除）。
    const authVerify = Math.max(va, vb);
    return {
        everActivated: !!(a.everActivated || b.everActivated),
        lastReject: auth.lastReject || null,
        rejectAt: Number(auth.rejectAt) || null,
        lastVerify: authVerify,
        offlineStart: Number(auth.offlineStart) || null,
        lastSeenHigh: Math.max(Number(a.lastSeenHigh) || 0, Number(b.lastSeenHigh) || 0),
        accountReject: mergeRejectMaps(
            normalizeRejectMap(a.accountReject),
            normalizeRejectMap(b.accountReject)),
        usersBackupGen: Math.max(Number(a.usersBackupGen) || 0, Number(b.usersBackupGen) || 0),
        usersLegacyRetired: a.usersLegacyRetired === true || b.usersLegacyRetired === true,
        // ★ 2026-09-29 产品域隔离锚点：按域合并，云端/离线互不抬水位
        usersBackupGenV2: mergeDomainGenMaps(a.usersBackupGenV2, b.usersBackupGenV2),
        usersLegacyRetiredV2: mergeDomainRetiredMaps(a.usersLegacyRetiredV2, b.usersLegacyRetiredV2)
    };
}

// 旧双文件状态合并（沿用既有语义；offlineStart 两侧取最早）
function mergeLegacyState(gate, anchor) {
    gate = gate || {};
    anchor = anchor || {};
    const gs = Number(gate.offlineStart) || 0;
    const as = Number(anchor.offlineStart) || 0;
    // ★ 2026-09-29：gate.dat/.license-anchor 在【本产品】可写目录，但内容可能是
    //   vault 写失败时回落的【整份机器态】（含对端推进的共享标量），物理位置不
    //   能证明标量归属。
    const fileGen = Math.max(Number(gate.usersBackupGen) || 0, Number(anchor.usersBackupGen) || 0);
    const fileRetired = gate.usersLegacyRetired === true || anchor.usersLegacyRetired === true;
    // 只搬运文件中【已持久化】的 V2 域 map（降级文件模式的权威锚点，缺失会让
    // gen/退役跨重启归零，防回滚失效）。旧共享标量【不在 merge 时动态归域】：
    // 归域与耐久化唯一收口在 ensureDomainBootstrap（由 readUsersBackupGen/
    // legacyRetired 引导读触发，或幂等短路延迟调度），以在场 v2 备份为门槛，
    // 首见即一次性固化进 V2 map。
    // 致命反例（TOCTOU）：backupUserAccounts 先写 v2 备份文件、后打 gen 补丁，
    // 若 merge 每次读都按"实时在场件"把标量归域，中间窗口在场件已翻 v2，污染
    // 标量 71 会被归成当前域高水位，反使 writeUsersBackupGen 误判 cur>=n 而
    // 拒绝落补丁——锚点永久停在污染值。故此处绝不读 users-backup.json。
    const genV2Map = mergeDomainGenMaps(gate.usersBackupGenV2, anchor.usersBackupGenV2);
    const retiredV2Map = mergeDomainRetiredMaps(gate.usersLegacyRetiredV2, anchor.usersLegacyRetiredV2);
    return {
        everActivated: !!(gate.everActivated || anchor.everActivated),
        lastReject: gate.lastReject || anchor.lastReject || null,
        rejectAt: gate.rejectAt || anchor.rejectAt || null,
        lastVerify: Math.max(Number(gate.lastVerify) || 0, Number(anchor.lastVerify) || 0),
        offlineStart: (gs && as) ? Math.min(gs, as) : (gs || as || null),
        lastSeenHigh: Math.max(Number(gate.lastSeenHigh) || 0, Number(anchor.lastSeenHigh) || 0),
        accountReject: mergeRejectMaps(
            normalizeRejectMap(gate.accountReject),
            normalizeRejectMap(anchor.accountReject)),
        usersBackupGen: fileGen,
        usersLegacyRetired: fileRetired,
        usersBackupGenV2: genV2Map,
        usersLegacyRetiredV2: retiredV2Map
    };
}

// 迁移完成后清理旧文件（便携版 exe 目录可能无权限，失败忽略）
function removeLegacyAnchorFiles() {
    try { fs.rmSync(getGatePath(), { force: true }); } catch (e) { /* 忽略 */ }
    try { fs.rmSync(getAnchorPath(), { force: true }); } catch (e) { /* 忽略 */ }
}
function readFileLegacyState(mid) {
    const gate = readGateState(mid);
    const anchor = readAnchorState(mid);
    return (gate || anchor) ? mergeLegacyState(gate, anchor) : null;
}

// 统一状态读取（进程内短缓存：写即失效）。backupUserAccounts 等链路会连续
// 多次读取，缓存把多次 PS 往返收敛为一次；同步读-改-写流不会读到旧值。
// ★ 2026-10-01 启动性能：1.5s → 30s。旧窗口在 prewarm 完成后、用户输完密码
//   点击登录前就过期（实测 4-9s PS 预热 + 真实用户 3-10s 输入），gate 读只能
//   重新 spawn 一次 PS，预热完全白做。30s 窗口覆盖一次登录交互全程；安全不失：
//   本进程任何写都主动 invalidate/回填（读-改-写不读旧值）；OS 凭据无法被普通
//   文件删除改写（vault 设计前提），外部持同用户权限主动 delete 已超出本机威胁
//   模型；云/离并发写入由 fresh 读 + M3 gen 水位自愈收敛；每次应用重启都全新
//   fresh 读，运行期心跳本为 24h 长周期，30s 陈旧窗口无可观测安全增益差。
const UNIFIED_CACHE_MS = 30000;
// ★ 2026-10-02：登录窗保热鲜度线（< UNIFIED_CACHE_MS；main.js 15s 周期调
//   prewarmGate，缓存年龄过线即失效重读，保证点击时缓存年龄 ≤~15s）
const GATE_PREWARM_FRESH_MS = 12000;
let _unifiedCache = null; // {mid, at, result}
function invalidateUnifiedCache() { _unifiedCache = null; }

function readUnifiedState(mid) {
    const now = Date.now();
    if (_unifiedCache && _unifiedCache.mid === mid && now - _unifiedCache.at < UNIFIED_CACHE_MS) {
        // 缓存命中前检查旧文件锚点：降级期另一实例可能刚落了文件态（对账
        // 输入），文件存在必须 fresh 对账——文件检查为微秒级 fs.stat，不损性能
        let hasLegacy = false;
        try { hasLegacy = fs.existsSync(getGatePath()) || fs.existsSync(getAnchorPath()); }
        catch (e) { hasLegacy = false; }
        if (!hasLegacy) return _unifiedCache.result;
    }
    const result = readUnifiedStateFresh(mid);
    // 只缓存 vault 成功结果：文件态读取无 PS 开销，且文件可能被外部删除，
    // 缓存文件态会导致读-改-写链路误判锚点存在。
    // at 必须在读取完成后取：fresh 自身可能慢于缓存窗口（慢机多 PS 往返），
    // 否则缓存插入即过期，性能收敛失效。
    if (result.vault === true) _unifiedCache = { mid, at: Date.now(), result };
    return result;
}

// 统一状态读取：vault 优先（跨 mid 候选）；vault↔文件强制对账；
// 旧双文件一次性迁移；写 vault 必须成功才删旧文件。
function readUnifiedStateFresh(mid) {
    if (vaultAvailable()) {
        const v = resolveVaultState(mid);
        if (v.dead) {
            markVaultTransient(); // 运行中瞬态故障：退避，不永久判决
        } else {
            const fileState = readFileLegacyState(mid);
            // ① vault 与文件并存（降级期写入留下）：对账后写回，成功才删文件
            if (v.state && fileState) {
                const merged = mergeUnifiedStates(v.state, fileState);
                if (writeVaultState(merged, mid)) {
                    removeLegacyAnchorFiles();
                    return { vault: true, state: merged };
                }
                return { vault: false, state: merged };
            }
            if (v.state) return { vault: true, state: v.state };
            if (fileState) {
                // ③ vault 损坏 + 旧文件：不能当空 vault 迁移覆盖（会丢真态），
                //   本次用文件态并标 uncertain，待在线 LICENSED 权威覆写
                if (v.corrupt) return { vault: false, state: fileState, uncertain: true };
                // ② vault 无凭据 + 旧双文件：迁移（写成功才删）
                if (writeVaultState(fileState, mid)) {
                    removeLegacyAnchorFiles();
                    console.log('[Gate] 旧双文件锚点已迁移进 Windows 凭据管理器');
                    return { vault: true, state: fileState };
                }
                return { vault: false, state: fileState };
            }
            // vault 凭据解不开（指纹抖动/损坏）且无文件：状态不明
            if (v.corrupt) return { vault: true, state: null, uncertain: true };
            // ④ 真空态
            return { vault: true, state: null };
        }
    }
    const fileState = readFileLegacyState(mid);
    if (fileState) return { vault: false, state: fileState };
    // vault 退避中又无文件：显式禁用（测试）外，状态不明 → fail-closed
    return { vault: false, state: null, uncertain: !_vaultEnvDisabled };
}

// 统一状态写入：vault 优先；写失败/不可用回落【双文件双写】（至少一份落盘）
// ★ 2026-09-30 M3（云离并发审查阻断项收口）：所有整 blob CredWrite（persistUnified
//   在线裁决 8 个调用点 / installLicense 激活 / gen / 退役补丁）写前统一取当前
//   统一态，把云离对端进程在本快照之后落入的域锚点按单调语义并入（gen 按域 max、
//   退役按域 OR），杜绝持网络裁决前陈旧快照整包写抹掉对端键、重开删备份洗白链。
//   patch 链经 freshRead 形参传入同 tick 的 fresh 读结果（零新增 PS）；persist/
//   installLicense 等权威写强制 fresh——网络 await 再短也不信 1500ms 缓存。
//   残余：fresh 读与 CredWrite 是两次独立 PS spawn，该秒级窗口内对端写入仍可能
//   被覆盖，由 readUsersBackupGen 在场件水位自愈 + 退役在场 v2 自愈兜底
//   （均为文件级检查，无 PS；攻击者只能放更旧件，无法签高件/撤退役）。
function writeUnifiedState(state, mid, freshRead) {
    let s = state;
    try {
        // freshRead=同 tick 刚 invalidate 后读到的结果（patch 链专用，零新增 PS）；
        // 否则（persist 在线裁决/激活等持可能陈旧快照的权威写）强制废弃 1500ms
        // 缓存做 fresh 读——快网裁决 <1.5s 返回时缓存仍会遮蔽对端刚落的域键。
        if (!freshRead) invalidateUnifiedCache();
        const cur = freshRead || readUnifiedState(mid);
        const cs = cur.state;
        if (cs) {
            s = Object.assign({}, cs, state);
            // 两张 V2 map 绝不整键替换：入参无该字段时也保留当前态（过白名单）
            s.usersBackupGenV2 = mergeDomainGenMaps(cs.usersBackupGenV2, state.usersBackupGenV2);
            s.usersLegacyRetiredV2 = mergeDomainRetiredMaps(cs.usersLegacyRetiredV2, state.usersLegacyRetiredV2);
            // accountReject 保持整键替换：解封（clearAccountRejectIfMatch）依赖
            // 整键写回移除条目；详见异步写链 mergeOnto 处注释（2026-10-01）。
        }
    } catch (e) { s = state; /* 读取异常按原状态直写（vault 写自身成败兜底） */ }
    if (vaultAvailable() && writeVaultState(s, mid)) {
        // 写成功即填缓存：紧随其后的 readUnifiedState（persist 链常态）不再
        // 触发一次 2.5s+ 的 fresh read——启动链总阻塞的关键收敛点
        _unifiedCache = { mid, at: Date.now(), result: { vault: true, state: s } };
        return true;
    }
    if (!_vaultEnvDisabled) markVaultTransient();
    // 注意：两份都要尝试，不能用 || 短路（gate 成功就跳过 anchor 会破坏
    // 单删任一文件不失效的双写语义）
    let gOk = false, aOk = false;
    try { gOk = !!writeGateState(s, mid); } catch (e) { /* 继续写 anchor */ }
    try { aOk = !!writeAnchorState(s, mid); } catch (e) { /* 忽略 */ }
    return !!(gOk || aOk);
}

// 内部读-改-写补丁（gen/退役标记）：uncertain 时绝不覆盖可能只是暂时
// 读不出的 vault——补丁落文件，待 vault 恢复后对账合并
// ★ 2026-09-30（M2/M3）：写前强制失效 1500ms 缓存做 fresh 读；正常态补丁交由
//   writeUnifiedState 统一 fresh 合并（同 tick 缓存命中零新增 PS），云离并发下
//   对端域键在任意整 blob 写路径都不被抹。
function patchUnifiedState(patch, mid) {
    invalidateUnifiedCache();
    const r = readUnifiedState(mid);
    if (r.uncertain) {
        // 状态不明：补丁与文件态按域单调合并后落双文件，绝不覆写 vault
        const s = Object.assign({}, r.state, patch);
        if (patch.usersBackupGenV2) {
            s.usersBackupGenV2 = mergeDomainGenMaps(r.state && r.state.usersBackupGenV2, s.usersBackupGenV2);
        }
        if (patch.usersLegacyRetiredV2) {
            s.usersLegacyRetiredV2 = mergeDomainRetiredMaps(r.state && r.state.usersLegacyRetiredV2, s.usersLegacyRetiredV2);
        }
        let gOk = false, aOk = false;
        try { gOk = !!writeGateState(s, mid); } catch (e) { /* 续 */ }
        try { aOk = !!writeAnchorState(s, mid); } catch (e) { /* 忽略 */ }
        return !!(gOk || aOk);
    }
    return writeUnifiedState(patch, mid, r);
}

// ★ 2026-10-01 启动性能：patchUnifiedState 的全异步版（启动备份固化链专用）。
//   语义与同步版严格一致：uncertain（指纹抖动/vault 瞬态故障）时只落双文件、
//   绝不覆写 vault；正常态走异步 vault 写链（freshRead 传入避免二次 PS 读）。
async function patchUnifiedStateAsync(patch, mid) {
    // 纵深防御：mid 缺失会让 readUnifiedStateFreshAsync 走跨候选合并，误删
    // primary blob（见 backupUserAccounts asyncVault 调用点冒烟实证）。
    mid = mid || getMachineId();
    const r = await readUnifiedStateAsync(mid);
    if (r.uncertain) {
        const s = Object.assign({}, r.state, patch);
        if (patch.usersBackupGenV2) {
            s.usersBackupGenV2 = mergeDomainGenMaps(r.state && r.state.usersBackupGenV2, s.usersBackupGenV2);
        }
        if (patch.usersLegacyRetiredV2) {
            s.usersLegacyRetiredV2 = mergeDomainRetiredMaps(r.state && r.state.usersLegacyRetiredV2, s.usersLegacyRetiredV2);
        }
        let gOk = false, aOk = false;
        try { gOk = !!writeGateState(s, mid); } catch (e) { /* 续 */ }
        try { aOk = !!writeAnchorState(s, mid); } catch (e) { /* 忽略 */ }
        return !!(gOk || aOk);
    }
    // patchLike=true：执行时刻基底若翻 uncertain/读失败，写链按规则⑤只落
    // 双文件绝不裸补丁覆写 vault（入队前这一道 uncertain 分流仍保留，省一次入队）
    return writeUnifiedStateAsync(patch, mid, r, true);
}
// writeUsersBackupGen 的全异步版（单调高水位补丁，语义同同步版）
async function writeUsersBackupGenAsync(gen, machineIdArg) {
    try {
        const mid = machineIdArg || getMachineId();
        const n = Number(gen);
        if (!(n > 0)) return false;
        const dom = getAppDomain();
        const r = await readUnifiedStateAsync(mid);
        const cur = Number(r.state && r.state.usersBackupGenV2 && r.state.usersBackupGenV2[dom]) || 0;
        if (cur >= n) return true;
        const newMap = Object.assign({}, (r.state && r.state.usersBackupGenV2) || null, { [dom]: n });
        return await patchUnifiedStateAsync({ usersBackupGenV2: newMap }, mid);
    } catch (e) {
        console.warn('[Gate] usersBackupGen 异步写入失败（非致命）:', e && e.message);
        return false;
    }
}
// 注：曾有 markLegacyRetiredAsync（退役单键异步补丁），2026-10-01 起移除——
// asyncVault 备份链已把 gen+退役合并为单次 patchUnifiedStateAsync 补丁
// （backupUserAccounts L874-883），单键版无调用方且会多开一次 CredWrite、
// 重新引入兄弟写背靠背互踩面，故不保留。

// ★ 2026-09-23 账号级拒绝标记 = 按用户名存储的集合 { username: {username,state,at} }
//   （同机多账号先后被删互不覆盖；重新开通只清对应键）。旧版单条记录
//   {username,state,at} 读入时自动迁移为集合，首次 persist 即落新格式。
function normalizeRejectMap(v) {
    if (!v || typeof v !== 'object') return {};
    // 旧版单条：顶层自带 state 标量
    if (v.__arMap !== 1 && (typeof v.state === 'string') && (typeof v.username === 'string')) {
        const k = v.username || '';
        const m = { __arMap: 1 };
        m[k] = { username: v.username, state: v.state || 'ACCOUNT_REVOKED', at: Number(v.at) || Date.now() };
        return m;
    }
    const m = { __arMap: 1 };
    for (const k of Object.keys(v)) {
        if (k === '__arMap') continue;
        const rec = v[k];
        if (rec && typeof rec === 'object' && typeof rec.state === 'string') m[k] = rec;
    }
    return m;
}
// 双锚点合并：同名记录取 at 更新者（任一锚点有即拒绝）
function mergeRejectMaps(a, b) {
    const out = { __arMap: 1 };
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (k === '__arMap') continue;
        const ra = a[k], rb = b[k];
        out[k] = (!ra || (rb && Number(rb.at) > Number(ra.at))) ? rb : ra;
    }
    return out;
}

// 双锚点统一视图
function getUnifiedGate(mid) {
    // ★ 2026-09-26 M-2：统一状态（vault 优先 + 旧双文件迁移/降级）。
    //   gate/anchor 指向同一状态对象——旧代码对两处的同写保持幂等；
    //   降级文件模式 persist 时同内容双写，物理双份语义不变。
    const r = readUnifiedState(mid);
    const s = r.state || {};
    // __arMap 是 accountReject 映射内部标记（非 state 顶层字段）
    if (!s.accountReject || s.accountReject.__arMap !== 1) {
        s.accountReject = normalizeRejectMap(s.accountReject);
    }
    return {
        gate: s,
        anchor: s,
        vault: r.vault === true,
        uncertain: r.uncertain === true,
        everActivated: !!s.everActivated,
        lastReject: s.lastReject || null,
        lastVerify: Number(s.lastVerify) || 0,
        lastSeenHigh: Number(s.lastSeenHigh) || 0,
        accountReject: s.accountReject || {}
    };
}
function persistUnified(u, mid) {
    // vault 模式写凭据；故障/降级自动回落双文件
    return writeUnifiedState(u.gate, mid);
}

// ★ 2026-10-01 启动性能：异步版 persist（verifyLoginGate 全链专用，主进程零冻结）
function persistUnifiedAsync(u, mid) {
    // vault 模式写凭据；故障/降级自动回落双文件（语义同 persistUnified）
    // ★ 2026-10-01 性能/安全：gate 裁决刚读过 unified blob（prewarm/缓存/fresh），
    //   传同一镜像仅作意图声明；writeUnifiedStateAsync 在执行时刻重验基底——
    //   镜像新鲜（<2s）时零 PS 读直接合并，超窗/入队后有更新写则自行 fresh 读
    //   或采用更新镜像，陈旧快照绝不整包覆盖 vault（双独立审查 F1 收口）。
    const c = _unifiedCache;
    const freshRead = c && c.mid === mid && c.result && c.result.vault === true && c.result.state
        ? c.result : undefined;
    return writeUnifiedStateAsync(u.gate, mid, freshRead);
}

// ★ 中-1：单调高水位防时间回拨/前拨。gate 与 anchor 双写 lastSeenHigh。
//   回拨判定（now 显著低于历史高水位）见 verifyLoginGate 内 rollbackSuspected：
//   不再直接硬拒，而是要求在线 LICENSED 自愈（旧 gateRollbackFail 已移除）。
function bumpHighWater(u, now) {
    const high = Math.max(u.lastSeenHigh, now);
    u.lastSeenHigh = high;
    u.gate.lastSeenHigh = high;
    u.anchor.lastSeenHigh = high;
}

// 宽限判定（密文锚点 offlineStart 只缺失时播种；曾被硬拒一律不再给宽限，
// 只能联网拿 LICENSED 清除）。gate 与 anchor 的 lastReject 任一存在即阻断。
// ★ 高-1 修复：两侧 offlineStart 取【最早】值，绝不覆盖另一侧已有的起点
//   （旧码读不到 gate 时把两侧都重写成 now，删单文件即可无限重置）。
async function gateGracePass(u, mid, username) {
    const now = Date.now();
    // 状态不明（vault 瞬态故障且无文件 / 凭据损坏 / 指纹抖动）：fail-closed，
    // 绝不播种新宽限（否则一次启动故障即可把 7 天时钟归零），只认在线 LICENSED
    if (u.uncertain) {
        return { ok: false, message: '授权状态暂无法核验，请联网后重试' };
    }
    if (u.lastReject) {
        return { ok: false, message: '授权未通过授权服务器核验，请联网后重试' };
    }
    // ★ 2026-09-23 账号级硬拒：该 username 在线收到过 ACCOUNT_REVOKED，断网也
    //   不享受宽限（按用户名精确匹配，同机其他未删账号不受影响）。
    const __arRec = username ? u.accountReject[username] : null;
    if (__arRec) {
        return { ok: false, message: gateStateMessage(__arRec.state || 'ACCOUNT_REVOKED') };
    }
    const gs = Number(u.gate.offlineStart) || 0;
    const as = Number(u.anchor.offlineStart) || 0;
    let start;
    if (!gs && !as) {
        start = now;  // 两侧都缺失才新播种
        u.gate.offlineStart = now;
        u.anchor.offlineStart = now;
    } else {
        start = Math.min(gs || Infinity, as || Infinity);
        if (!gs) u.gate.offlineStart = start;  // 只补缺失侧
        if (!as) u.anchor.offlineStart = start;
    }
    await persistUnifiedAsync(u, mid);
    if (now - start < GATE_GRACE_MS) return { ok: true, grace: true };
    return { ok: false, message: '无法连接授权服务器且已超过 7 天离线宽限期，请联网后重试或联系客服' };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ★ 2026-10-02 登录秒开（1.0.263）：在线明确 LICENSED 的放行后 vault 对账。
//   verifyLoginGate 付费快车道在拿到服务端明确裁决后【立即放行】（不等待 vault
//   PS 读/写，冷 PS 真机 3~14s），本机统一态的读-改-写全部在本函数后台完成，
//   与主窗 installMainWindowGate 紧接其后的第二趟闸门形成强制收口：该趟持
//   【新鲜在线裁决】（预取槽一次性消费，绝不复用），在线时成功态同样走快车道
//   但任何吊销/墓碑/硬拒/时间异常（非 LICENSED 或缺 serverTime/回拨不自愈）都
//   落 fresh vault 全量逻辑立即隐藏主窗并锁死（架构既定的"唯一热更可达吊销点"，
//   登录窗不展示任何业务数据）；断网时该趟完整执行 vault 宽限/墓碑/回拨硬分支。
//   安全语义对照同步分支逐项保持一致：
//   ① rollback：凭 ent.serverTime 自愈高水位；快车道已强制 serverTime 可解析，
//      本函数再守一道（比同步分支更严，见函数内注释）——缺有效 serverTime 或其
//      不足以自愈回拨时【不做任何 mutation】直接返回；
//   ② everActivated/lastVerify 同值同写；lastReject/rejectAt/offlineStart 双清
//      与墓碑删除属安全翻转，仅当本地记录时间戳不新于本次在线裁决（+60s 容差）
//      时才执行，相对旧"无条件清除"净收敛，防止陈旧 LICENSED 裁决清掉更新吊销；
//   ③ 仅按本 username 删账号墓碑（username 空绝不清理，铁律不变）；
//   ④ persistUnifiedAsync 在后台链内被 await（经 _vaultWriteChain 保序），
//      翻转不丢、不与其他写乱序；失败由主窗闸门下一轮完整读裁决兜底。
function reconcileOnlineLicensedAsync(mid, username, ent) {
    (async () => {
        // ★ 双审查收口：裁决时间戳是本次所有"清除/解封/自愈"指令的权威水位。
        //   拿不到有效 serverTime 则宁可不写（保留旧拒绝态），绝不凭本地时钟解封。
        const stMs = Date.parse((ent && ent.serverTime) || '');
        if (isNaN(stMs) || stMs <= 0) {
            try { console.warn('[Gate] LICENSED 后台对账：缺有效 serverTime，跳过写入'); } catch (e2) {}
            return;
        }
        const u = await getUnifiedGateAsync(mid);
        const now = Date.now();
        const rollback = !!(u.lastSeenHigh && now < u.lastSeenHigh - TIME_TAMPER_THRESHOLD);
        if (rollback) {
            // 比同步分支 healHighFromServer 更严的纵深防御：stMs 不足以凭旧高
            // 水位自愈时（同步分支只校验可解析性即放行——兼容用户时钟前调后
            // 拨正的合法场景），后台任务不做任何 mutation；放行与否由快车道
            // ⑥ 与全量分支按各自语义决定，状态收敛不依赖本写。
            if (stMs < (u.lastSeenHigh || 0) - TIME_TAMPER_THRESHOLD) {
                try { console.warn('[Gate] LICENSED 后台对账：serverTime 不足自愈回拨，跳过写入'); } catch (e2) {}
                return;
            }
            u.gate.lastSeenHigh = stMs; u.anchor.lastSeenHigh = stMs; u.lastSeenHigh = stMs;
        } else {
            const high = Math.max(u.lastSeenHigh || 0, now);
            u.lastSeenHigh = high; u.gate.lastSeenHigh = high; u.anchor.lastSeenHigh = high;
        }
        u.gate.everActivated = true; u.anchor.everActivated = true;
        u.gate.lastVerify = now; u.anchor.lastVerify = now;
        // ★ 双审查收口（对抗 fail-open）：本地拒绝记录比本次裁决【更新】时不清。
        //   60s 容差对齐 KV 传播软重试口径；任何方向失败都保留拒绝态（fail-safe）。
        //   注：本判定基于读快照时刻，属对旧"无条件清除"的净收敛；写执行时刻
        //   CAS 重判（多进程秒级窗口）见既有 backlog R3/P3-C，不在本次范围。
        const VERDICT_SKEW_MS = 60 * 1000;
        const localRejectAt = Math.max(Number(u.gate.rejectAt) || 0,
            Number(u.anchor && u.anchor.rejectAt) || 0);
        if (localRejectAt <= stMs + VERDICT_SKEW_MS) {
            u.gate.offlineStart = null; u.gate.lastReject = null; u.gate.rejectAt = null;
            u.anchor.offlineStart = null; u.anchor.lastReject = null; u.anchor.rejectAt = null;
        }
        if (username) {
            const tomb = (u.gate.accountReject || {})[username];
            const tombAt = (tomb && (Number(tomb.at) || 0)) || 0;
            if (tombAt <= stMs + VERDICT_SKEW_MS) {
                delete u.gate.accountReject[username];
                delete u.anchor.accountReject[username];
            }
        }
        await persistUnifiedAsync(u, mid);
    })().catch((e) => {
        try { console.warn('[Gate] LICENSED 后台对账失败（主窗闸门将强制复核）:', e && e.message); } catch (e2) {}
    });
}

// ★ 2026-10-01 启动性能：app whenReady 最早阶段后台预热授权统一态。
//   背景：1.0.258 M-2 把锚点迁入 Windows 凭据管理器后，读状态需 spawn
//   Windows PowerShell 5.1——冷机实测 9~14s、客户现场 1.5~3.4s（系统日志：
//   "正在准备首次使用模块"）。登录提交 verifyLoginGate 与主窗自检都消费同一
//   状态。此处与窗口创建/用户输密码并行提前发起一次异步读：readUnifiedStateAsync
//   自带 in-flight 单飞+短时缓存（同步 readUnifiedState 共享同一缓存），后续
//   所有 gate 读 await 同一 Promise 或直接命中缓存，冷 PS 不再压在登录关键路径；
//   vault 健康探测也顺带完成。性能原语：幂等、永不抛错、不改变任何
//   fail-open/closed 裁决。注意它并非零写入——读路径本身在检测到旧双文件锚点/
//   跨 mid 残留时会做幂等迁入合并写回（既有语义，非预热新增），ensureDomain
//   BootstrapAsync 也会幂等固化缺失的域键；除此之外不产生读路径之外的额外写。
//   vault 不可用时读双文件（毫秒）后自然结束。
let _gatePrewarmPromise = null;
let __gatePrewarmInFlight = false;
// ★ 2026-10-02 内存级"刚在线证实 LICENSED"时刻（不落盘、零 PS）。快车道放行时
//   同步置位，供主窗第二趟闸门在新机首激活（reconcile 冷 PS 尚未把 lastVerify
//   写入 vault）撞 KV 跨 colo 传播 NO_LICENSE 时仍可走 10 分钟软重试；进程重启清空。
let __lastOnlineLicensedAt = 0;
function prewarmGate() {
    // ★ 2026-10-02：保热可重入。旧实现一次性 latch——首次预热 5~14s 填缓存
    //   后，30s TTL 一过再调也直接返回旧 Promise，用户在登录框停留超过 30s
    //   点击时仍吃一次冷 PS 读（真机 3~6s）。现：在途必单飞（绝不并发 spawn
    //   第二个 PS）；缓存仍鲜（30s 内 vault 成功态）直接复用；过期则重新发起。
    const c = _unifiedCache;
    const cacheAge = c && c.at ? (Date.now() - c.at) : Infinity;
    const cacheWarm = !!(c && c.result && c.result.vault === true && c.result.state
        && cacheAge < UNIFIED_CACHE_MS);
    if (__gatePrewarmInFlight) return _gatePrewarmPromise;
    if (cacheWarm && _gatePrewarmPromise) {
        // 仍在裁决可接受窗口但已过保热鲜度线（12s）：失效缓存强制下一轮
        // fresh PS 读——main.js 每 15s 调一次，保证点击时缓存年龄 ≤~15s，
        // 不留"30s TTL + 15s 间隔"拼出的 40s 冷读空档。
        if (cacheAge >= GATE_PREWARM_FRESH_MS) invalidateUnifiedCache();
        else return _gatePrewarmPromise;
    }
    __gatePrewarmInFlight = true;
    _gatePrewarmPromise = (async () => {
        try {
            const mid = getMachineId();
            if (mid) {
                await readUnifiedStateAsync(mid);
                // ★ 2026-10-01 性能：全新机/域键缺失时，把首次 readUsersBackupGen
                //   才触发的域键耐久化（原同步 PS 写，实测压在登录 rename 备份链上
                //   冻结 4-7s）提前到预热后台完成。不 await 固化写：与用户输密码
                //   并行；即使点击时尚写完，readUsersBackupGen 也会退回纯文件内存
                //   引导（同一 max 水位 seed 算法、零 PS），随后的备份 gen 写经
                //   _vaultWriteChain 排在固化写之后，水位只抬不降，安全等价。
                ensureDomainBootstrapAsync(mid).catch(() => {});
            }
        } catch (e) {
            console.warn('[Gate] 启动预热失败（非致命）:', e && e.message);
        } finally {
            __gatePrewarmInFlight = false;
        }
    })();
    return _gatePrewarmPromise;
}

async function verifyLoginGate(usernameInput) {
    const fail = (message) => ({ ok: false, message });
    const mid = getMachineId();
    if (!mid) return fail('无法获取设备标识，请重启软件后重试');
    // ★ 2026-09-23 账号删除联动：本地密码已通过的登录用户名，透传到裁决端点
    const username = String(usernameInput == null ? '' : usernameInput).trim().slice(0,64);

    let local;
    try { local = validateLicense({ localMachineId: mid }); }
    catch (e) { return fail('授权校验异常，请联系客服'); }

    const lt = local.licenseType || local.type || '';

    // ★ 2026-10-01 启动性能：free 永久豁免在 vault 冷读【之前】直接放行——
    //   free license.dat 由服务端签发，validateLicense 已完成验签+机器绑定校验，
    //   本机不可伪造；free 产品语义永久离线可用，不消费 gate 任何字段
    //   （everActivated/lastReject/offlineStart/accountReject/lastSeenHigh 均不适用：
    //   时间回拨对 free 本来就不拦、不进宽限/墓碑/在线裁决）。旧码在 free 分支的
    //   bumpHighWater+persist 没有任何安全消费者，徒增每次登录 2 次 PS 往返。
    //   放行结果与旧码完全一致（{ ok:true, free:true }），但 free 机登录零 PS。
    if (local.valid && local.type === 'licensed' && lt === 'free') {
        return { ok: true, free: true };
    }

    // ★ 2026-10-02 秒开快车道（1.0.263，真机插桩实测）：付费已激活机先在线
    //   裁决，只要拿到【服务端明确的成功态 LICENSED 且账号无删除标记】立即放行，
    //   vault 统一态的 PS 读+写全部后移到 reconcileOnlineLicensedAsync 后台完成，
    //   冷 PS（真机 3~14s）无论用户点多快都不再压在点击路径；紧随其后的主窗
    //   installMainWindowGate 是权威完整闸门（fresh vault+新鲜裁决+硬锁），安全
    //   收口点不变、吊销时间窗不增加。以下情形【绝不快车道】，落下方原全量逻辑
    //   （fail-closed 语义零变化）：网络失败/超时、HTTP 错误、响应畸形、success
    //   非 true、任何非 LICENSED 态、ACCOUNT_REVOKED 账号墓碑、试用期、本地授权
    //   无效。裁决结果透传给分支①复用，不重复请求（预取槽本为一次性消费）。
    let __fastAdj = null;
    if (local.valid && local.type === 'licensed') {
        __fastAdj = await adjudicateViaMainProcess(mid, username);
        const __fe = __fastAdj && __fastAdj.ok && __fastAdj.ent;
        if (__fe && __fe.success === true && __fe.state === 'LICENSED'
            && __fe.accountState !== 'ACCOUNT_REVOKED') {
            // ★ 双独立审查收口（1.0.263 发版必补，零 PS/零额外网络成本）：
            // ⑤ 必须携带可解析的权威 serverTime——旧 LICENSED 分支
            //    healHighFromServer 依赖同一份时间证明，真实服务端 success 恒发；
            //    缺时间戳的注入/畸形成功响应不享受快车道，落全量分支按原硬拒处理。
            // ⑥ 回拨态零成本识别：读 ≤30s 内存热缓存（whenReady 起每 15s 保热，
            //    正常点击时必有槽）的高水位；本机处于回拨态且 serverTime 不足以
            //    凭旧高水位自愈时不走快车道，落全量分支（由其 healHighFromServer
            //    按原语义自愈放行或硬拒——fail-closed 语义零变化）。
            //    缓存冷（极罕见：vault 降级/PS 仍在途）无法零成本判回拨——仍强制
            //    有效 serverTime，且 reconcile 缺有效 serverTime 时不做任何
            //    mutation，离线回拨硬分支继续 fail-closed 兜底。
            const __stMs = Date.parse(__fe.serverTime || '');
            let __rollbackBlocked = false;
            if (!isNaN(__stMs) && __stMs > 0) {
                const __warmHigh = __getWarmLastSeenHigh(mid);
                if (__warmHigh && Date.now() < __warmHigh - TIME_TAMPER_THRESHOLD
                    && __stMs < __warmHigh - TIME_TAMPER_THRESHOLD) {
                    __rollbackBlocked = true;
                }
            }
            if (!isNaN(__stMs) && __stMs > 0 && !__rollbackBlocked) {
                // ⑦ 内存标记（见 __lastOnlineLicensedAt 注释）：覆盖新机首激活时
                //   冷 PS 对账尚未把 lastVerify 写进 vault 的 KV 传播窗口。
                __lastOnlineLicensedAt = Date.now();
                reconcileOnlineLicensedAsync(mid, username, __fe);
                return { ok: true };
            }
        }
    }

    // ★ 2026-10-01 启动性能：gate 冷读走异步（vault PS 不冻结主进程）；
    //   ★ 2026-10-02：离线端 prewarmGate() 改为登录窗 show 后发起（PS CreateProcess
    //   同步阻塞不抢首帧），云端不接线；此处通常仍命中 in-flight 单飞/短时缓存
    //   （同步读共享同一缓存），冷机不再苦等 PS；未预热时本行自行发起冷读，fail-closed 不变。
    const u = await getUnifiedGateAsync(mid);
    const now = Date.now();

    // ★ 2026-10-01 性能（1.0.263，真机插桩实测）：稳态 LICENSED 放行不等待 vault 写。
    //   实测每次登录要跑两趟完整闸门（登录提交链 + 主窗 installMainWindowGate
    //   热更吊销自检），旧码两趟都无条件 await persistUnifiedAsync——而写链规则③
    //   必 fresh PS 读 + CredWrite（真机热 PS 各 2.5~3s、冷 PS 8~14s），单趟
    //   ~7s 串行压在登录点击路径（转圈"正在进入系统…"）。稳态放行时本轮落盘
    //   内容只有 lastVerify + bumpHighWater(lastSeenHigh) 两个单调时间戳，与
    //   §51 试用高水位同款风险包（后台 _vaultWriteChain 保序落盘；放行后秒级内
    //   崩溃只损失本轮水位推进，回拨利用需先回拨系统时钟，几秒差无增益），故不
    //   await。凡真实安全翻转仍一律 await 落盘后才放行：
    //   ① everActivated false→true（首激活落账）；
    //   ② lastReject/rejectAt/offlineStart 存在→本轮清除（硬拒/宽限恢复，解封语义）；
    //   ③ 本 username 有 accountReject 墓碑→本轮解封删除（延迟落盘会让下次登录
    //      仍命中墓碑，且墓碑属安全翻转类，保守 await）；
    //   ④ rollbackSuspected 凭服务端时间自愈高水位（时钟攻击语境，保守 await）。
    //   墓碑【新增】（accountHardFail）/硬拒落账/宽限播种在各自分支本就 await，不动。
    //   ★必须在应用本轮 mutation 之前调用（判定读的是历史态）。
    const licensedHasSecurityFlip = (rollback) => {
        if (rollback) return true;
        if (!u || !u.gate) return true;
        if (!u.gate.everActivated) return true;
        if (u.gate.lastReject || u.gate.rejectAt || u.gate.offlineStart) return true;
        if (username && u.gate.accountReject && u.gate.accountReject[username]) return true;
        return false;
    };

    // ★ 高-3 修复：时间回拨不再于裁决前硬拒（旧逻辑合法用户无任何自愈途径，
    //   free 用户也被锁）。只标记可疑：随后必须在线拿到 LICENSED，凭响应里
    //   的权威 serverTime 重置高水位；断网/任何非 LICENSED 态均 fail-closed。
    const rollbackSuspected = !!(u.lastSeenHigh && now < u.lastSeenHigh - TIME_TAMPER_THRESHOLD);
    const rollbackMessage = '检测到系统时间异常（时间回拨），请恢复正确时间并联网核验';
    // 以服务端时间执行回拨自愈（LICENSED 分支共用）
    const healHighFromServer = (ent) => {
        const stMs = Date.parse(ent.serverTime || '');
        if (isNaN(stMs) || stMs <= 0) return false;
        u.gate.lastSeenHigh = stMs;
        u.anchor.lastSeenHigh = stMs;
        u.lastSeenHigh = stMs;
        return true;
    };

    // ★ 2026-09-23 账号墓碑消费：服务端下发 accountState=ACCOUNT_REVOKED → 双锚点
    //   写【账号级】拒绝标记并硬拒（断网/MITM 均不可绕过；按用户名隔离，不影响
    //   同机其他账号）。返回非 null 即为应直接返回的拒绝结果。
    const accountHardFail = async (ent) => {
        if (ent && ent.accountState === 'ACCOUNT_REVOKED' && username) {
            const rec = { username: username, state: 'ACCOUNT_REVOKED', at: now };
            u.gate.accountReject[username] = rec;
            u.anchor.accountReject[username] = rec;
            await persistUnifiedAsync(u, mid);
            return fail(gateStateMessage('ACCOUNT_REVOKED'));
        }
        return null;
    };
    // 服务端确认该账号无墓碑（真实有效）：只清【本用户名】的拒绝标记。
    // ★ 铁律：username 缺失（主窗自检/激活窗复核等无登录态上下文调用）时绝不
    //   清除任何账号标记——否则同机他人一次正常联网即可为被删账号滚动解封。
    const clearAccountRejectIfMatch = () => {
        if (!username) return;
        delete u.gate.accountReject[username];
        delete u.anchor.accountReject[username];
    };

    // ③ free 永久豁免已上移至 vault 冷读之前（零 PS 快道）

    // ① 付费已激活：在线裁决
    if (local.valid && local.type === 'licensed') {
        // ★ 2026-10-02：快车道已消费预取槽并裁决过一次（非 LICENSED 才会走到
        //   这里），直接复用其结果，不再发第二次请求；仅当快车道未执行时新裁。
        let r = __fastAdj || await adjudicateViaMainProcess(mid, username);

        // ★ P2-1：激活后 KV 传播最长约 60s，近 10 分钟内有 lastVerify 即收到
        //   NO_LICENSE，延时 2.5s 重裁一次（回拨可疑时不走此软重试）。
        // ★ 2026-10-02：快车道放行（首激活冷 PS 对账 lastVerify 尚未落盘）后主窗
        //   第二趟闸门同属"刚被服务端证实 LICENSED"，内存标记 __lastOnlineLicensedAt
        //   等价覆盖该 10 分钟窗口，避免新机首登误锁主窗。
        const __recentOnlineLicensed = !!__lastOnlineLicensedAt
            && now - __lastOnlineLicensedAt < 10 * 60 * 1000;
        if (!rollbackSuspected && r.ok && r.ent && r.ent.success &&
            r.ent.state === 'NO_LICENSE' &&
            ((u.lastVerify && now - u.lastVerify < 10 * 60 * 1000) || __recentOnlineLicensed)) {
            await sleep(2500);
            r = await adjudicateViaMainProcess(mid, username);
        }

        if (r.ok && r.ent && r.ent.success === true && r.ent.state) {
            // ★ 账号删除优先裁决：即使设备授权 LICENSED，账号墓碑命中也硬拒
            const __accFail = await accountHardFail(r.ent);
            if (__accFail) return __accFail;
            if (r.ent.state === 'LICENSED') {
                // ★ 2026-10-01：mutation 前判翻转，稳态放行不等 vault 写（见函数头注释）
                const __awaitWrite = licensedHasSecurityFlip(rollbackSuspected);
                if (rollbackSuspected) {
                    if (!healHighFromServer(r.ent)) return fail(rollbackMessage);
                } else {
                    bumpHighWater(u, now);
                }
                u.gate.everActivated = true; u.anchor.everActivated = true;
                u.gate.lastVerify = now; u.gate.offlineStart = null; u.gate.lastReject = null; u.gate.rejectAt = null;
                u.anchor.lastVerify = now; u.anchor.offlineStart = null; u.anchor.lastReject = null; u.anchor.rejectAt = null;
                clearAccountRejectIfMatch();
                const __wp = persistUnifiedAsync(u, mid);
                if (__awaitWrite) await __wp; else __wp.catch(() => {});
                return { ok: true };
            }
            // 硬失效态：双锚点持久化拒绝标记（删任一文件不能再吃宽限）
            u.gate.lastReject = r.ent.state; u.gate.rejectAt = now;
            u.anchor.lastReject = r.ent.state; u.anchor.rejectAt = now;
            await persistUnifiedAsync(u, mid);
            return fail(gateStateMessage(r.ent.state));
        }
        // ★ 回拨可疑：任何非在线 LICENSED 一律拒绝（含断网，无宽限）
        if (rollbackSuspected) return fail(rollbackMessage);
        // ★ S2：仅真断网（netFail）走宽限；HTTP 错误/畸形/ success 非 true 全拒
        // ★ 2026-09-23 例外：HTTP 403 = 设备安全封锁（device_block，entitlement
        //   唯一 403 来源）。按 2026-09-11 红线「本地使用不阻断」，走与断网相同
        //   的 gateGracePass：受 lastReject 双锚点（曾在线收过硬拒即无宽限，
        //   MITM 注入 403 绕不过吊销）+ 7 天宽限约束。
        if (r.httpFail === 403) {
            return await gateGracePass(u, mid, username);
        }
        if (r.httpFail) {
            return fail('授权服务暂时不可用（HTTP ' + r.httpFail + '），请稍后重试或联系客服');
        }
        if (r.malformed) {
            return fail('授权服务响应异常，请稍后重试或联系客服');
        }
        if (r.ok) {
            // success=false 或结构缺失，一律 fail-closed（低-1）
            return fail((r.ent && r.ent.message) || '授权校验未通过，请联系客服');
        }
        return await gateGracePass(u, mid, username);
    }

    // ② 试用期
    if (local.valid && local.type === 'trial') {
        // uncertain（指纹/read 瞬态故障）同样必须在线证明，不得 fail-open
        if (u.everActivated || rollbackSuspected || u.uncertain) {
            // 曾激活机 license.dat 被删，或时钟回拨可疑（纯试用也一样）：
            // 必须在线证明 LICENSED。
            const r = await adjudicateViaMainProcess(mid, username);
            if (r.ok && r.ent && r.ent.success === true && r.ent.state) {
                // ★ 账号删除优先裁决
                const __accFail = await accountHardFail(r.ent);
                if (__accFail) return __accFail;
                if (r.ent.state === 'LICENSED') {
                    // ★ 2026-10-01：mutation 前判翻转，稳态放行不等 vault 写（见函数头注释）
                    const __awaitWrite = licensedHasSecurityFlip(rollbackSuspected);
                    if (rollbackSuspected) {
                        if (!healHighFromServer(r.ent)) return fail(rollbackMessage);
                    } else {
                        bumpHighWater(u, now);
                    }
                    u.gate.everActivated = true; u.anchor.everActivated = true;
                    // ★ 中-1：LICENSED 落账双清 lastReject/offlineStart
                    u.gate.lastVerify = now; u.gate.offlineStart = null; u.gate.lastReject = null; u.gate.rejectAt = null;
                    u.anchor.lastVerify = now; u.anchor.offlineStart = null; u.anchor.lastReject = null; u.anchor.rejectAt = null;
                    clearAccountRejectIfMatch();
                    const __wp = persistUnifiedAsync(u, mid);
                    if (__awaitWrite) await __wp; else __wp.catch(() => {});
                    return { ok: true };
                }
                // ★ 高-2 修复：硬失效态同样双写 lastReject（旧码直接 return,
                //   删 dat 后断网即可吃宽限，比不删 dat 处境更好）。
                u.gate.lastReject = r.ent.state; u.gate.rejectAt = now;
                u.anchor.lastReject = r.ent.state; u.anchor.rejectAt = now;
                await persistUnifiedAsync(u, mid);
                return fail(gateStateMessage(r.ent.state));
            }
            if (rollbackSuspected) return fail(rollbackMessage);
            if (r.netFail) {
                const g = await gateGracePass(u, mid, username);
                if (g.ok) return g;
                return fail(g.message);  // 超宽限/曾拒：保留可读原因
            }
            if (r.httpFail === 403) {
                // 设备安全封锁：同付费分支，按 09-11 红线走宽限
                const g = await gateGracePass(u, mid, username);
                if (g.ok) return g;
                return fail(g.message);
            }
            if (r.httpFail) {
                return fail('授权服务暂时不可用（HTTP ' + r.httpFail + '），请稍后重试');
            }
            if (r.malformed) {
                return fail('授权服务响应异常，请稍后重试');
            }
            if (r.ok) {
                return fail((r.ent && r.ent.message) || '授权校验未通过，请联系客服');
            }
            return fail('授权校验异常，请联系客服');
        }
        bumpHighWater(u, now);
        // ★ 2026-10-01 启动性能：纯试用放行不等待 vault 写——主窗立即打开，
        //   高水位心跳写在后台串行完成（_vaultWriteChain 保序）。此处仅推进单调
        //   时间戳，无任何安全状态翻转；放行后数秒内崩溃最坏只损失本轮水位推进
        //   （回拨利用需先回拨系统时钟，几秒差无实际增益）。所有状态翻转类写
        //   （LICENSED 落账/硬拒墓碑/宽限播种/账号墓碑）仍一律 await，见上各分支。
        persistUnifiedAsync(u, mid).catch(() => {});
        return { ok: true, trial: true };
    }

    // 本地状态无效：一行可读原因
    // ★ P3-1：tampered 族同时提示系统时间可能（时间回拨也归此 type）
    const msg = {
        'expired': '授权已过期，请续费后再登录',
        'trial_expired': '试用期已过期，请激活后再登录',
        'tampered': '授权文件已损坏或系统时间异常，请重新激活或核对系统时间',
        'config_tampered': '配置文件异常，请联系客服',
        'binding_mismatch': '授权绑定不匹配，请联系客服',
        'debugger': '检测到调试器连接，请关闭调试模式后重启',
        'invalid': '授权状态异常，请联系客服'
    }[local.type] || '本机授权状态异常，请先完成注册或激活';
    return fail(msg);
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

// ============================================================================
//  ★ 2026-09-26 F2：users 数组完整性签名
//  usersSignature = HMAC(users 稳定序列化)；configSignature（v2 格式）把
//  usersSignature 纳入签名内容，形成 users→usersSignature→configSignature 链，
//  防本地篡改/植入账号、提权 role、降级密码哈希。
//  旧（v1）签名配置无 usersSignature：验签通过后一次性迁移重签（见 validateLicense）。
// ============================================================================
function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
        return '[' + value.map(stableStringify).join(',') + ']';
    }
    const keys = Object.keys(value).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

function computeUsersSignature(users, key) {
    const list = Array.isArray(users) ? users : [];
    return crypto.createHmac('sha256', key).update(stableStringify(list)).digest('hex');
}

// 两个 users 列表确定性深比较（顺序也参与）
function usersListsEqual(a, b) {
    return stableStringify(Array.isArray(a) ? a : [])
        === stableStringify(Array.isArray(b) ? b : []);
}

// ★ 2026-09-26 账号来源证明（多重集子集语义）：磁盘每个账号都必须能在备份中
// 找到一个【逐字段完全相同】的条目。
// 为什么不用全等：backupUserAccounts 有截断保护——正常删除账号后备份会合法地
// 保留更多旧账号（备份是磁盘的超集）；全等比较会把合法删号误判为篡改而锁死。
// 攻击覆盖：
//   磁盘多出备份没有的账号（植入/提权新建）→ 条数超出 → 拒绝；
//   改 role/密码哈希但条数不变 → 找不到相同条目 → 拒绝；
//   删账号+加恶意号（条数不变）→ 恶意号无匹配 → 拒绝。
function usersProvenByBackup(diskUsers, backupUsers) {
    const disk = Array.isArray(diskUsers) ? diskUsers : [];
    const backup = Array.isArray(backupUsers) ? backupUsers : [];
    if (disk.length > backup.length) return false;
    const pool = backup.map(u => stableStringify(u));
    for (const d of disk) {
        const key = stableStringify(d);
        const idx = pool.indexOf(key);
        if (idx === -1) return false;
        pool.splice(idx, 1);
    }
    return true;
}

// 读取主 config 原件（与 main.js getWritableConfigPath 同口径：
// portable→exe 目录，NSIS→userData），返回 { cfg, configPath }
// ★ 2026-09-26 区分错误：JSON 损坏→corrupt；其他 IO 错误→ioError（fail-closed），
//   不再一律按空件处理（否则锁文件竞态把闸门打成空态 fail-open）。
function loadPrimaryConfigRaw() {
    try {
        const p = path.join(getWritableDir(), 'config.json');
        if (fs.existsSync(p)) {
            return { cfg: JSON.parse(fs.readFileSync(p, 'utf8')) || {}, configPath: p };
        }
    } catch (e) {
        if (e && e.name === 'SyntaxError') return { cfg: {}, configPath: null, corrupt: true };
        if (e && e.code === 'ENOENT') return { cfg: {}, configPath: null };
        return { cfg: {}, configPath: null, ioError: true };
    }
    return { cfg: {}, configPath: null };
}

// v2 备份 gen 新鲜度：锚点缺失（新机/锚点被删，无法证明回滚）→ 采信；
// 锚点存在 → 备份 gen 必须 ≥ 锚点高水位（正常写入后两者相等；
// 旧件重放 gen 更小 → 拒绝，防密码/角色回滚）。
function backupGenFresh(backup) {
    if (!backup || backup.trusted !== 'v2') return false;
    const anchorGen = readUsersBackupGen();
    if (!anchorGen) return true;
    const bg = Number(backup.gen);
    return typeof bg === 'number' && bg >= anchorGen;
}

// legacy（无签名）备份可采信条件，缺一不可：
//   ① legacy 未被双锚点标记永久退役（新 exe 一旦写过 v2 备份即退役，sticky）；
//   ② 双锚点 usersBackupGen 均未建立（单删任一文件仍由另一锚点拦截）；
//   ③ backupAt 存在且不晚于硬编码日落；
//   ④ 调用方处于 v1 合法件上下文（由调用处用 inspection 判定，本函数不含此项）。
//   注：backupAt 是无签名字段，单靠日落不构成硬边界——硬边界是①②双锚点；
//   日落只用于"从未跑过新 exe 的真实老升级"这一不可避免的一次性窗口收口。
function legacyBackupUsable(backup) {
    if (!backup || backup.trusted !== 'legacy') return false;
    if (legacyRetired()) return false;
    if (readUsersBackupGen() > 0) return false;
    if (!backup.backupAt) return false;
    const cutoff = new Date(USERS_LEGACY_BACKUP_SUNSET + 'T23:59:59+08:00').getTime();
    const t = new Date(backup.backupAt).getTime();
    return !isNaN(cutoff) && !isNaN(t) && t <= cutoff;
}

// get-app-config 回填专用：磁盘 users 为空时，只回填新鲜 v2 备份；
// v1 合法件窗口内允许 legacy（missing/unsigned 状态拒绝 legacy）。
function getFillableUsers() {
    try {
        const backup = inspectUsersBackup();
        if (backup.trusted === 'v2' && backupGenFresh(backup) && backup.users.length > 0) {
            return backup.users;
        }
        const insp = inspectConfigSignatures();
        if (insp.ok && insp.legacy && legacyBackupUsable(backup) && backup.users.length > 0) {
            return backup.users;
        }
    } catch (e) { /* 返回空 */ }
    return [];
}

// ★ 2026-09-26 H1/B1：磁盘 config 中既有 users 是否具有"真实应用签发"的来源证明。
// 一切"读取已有 config 再重签"的写路径（register-local-user / config:update /
// installLicense / enforceEditionBinding / ensureLocalActivationUser /
// desktop-user-ipc / get-app-config 内联自愈）都必须先过此闸门，
// 防止这些路径成为 users 篡改的洗白通道。
// 采信规则：
//   v2 双签名完整 / usersTrusted（仅 header 漂移）→ true；
//   IO 错误 → false（fail-closed，不与缺失混淆）；
//   users 为空（出厂/首注册态）→ true（users_mismatch/corrupt 除外）；
//   v1 合法旧件（legacy）→ v2 新鲜备份 或 窗口内 legacy 备份子集证明；
//   missing/unsigned/其他失配 → 仅新鲜 v2 备份子集证明。
// cfgArg（可选）：调用方已读入内存的 config——闸门直接裁决该对象，不二次读盘
//   （TOCTOU 阻断：否则外部进程可在闸门后替换 config，让异件被签）。
function configUsersProvenAuthentic(cfgArg) {
    const hasArg = cfgArg && typeof cfgArg === 'object';
    const insp = inspectConfigSignatures(hasArg ? cfgArg : undefined);
    if (insp.ok && !insp.legacy) return true;
    if (insp.usersTrusted) return true;
    if (insp.reason === 'config_io_error') return false;

    let diskUsers;
    if (hasArg) {
        diskUsers = Array.isArray(cfgArg.users) ? cfgArg.users : [];
    } else {
        const raw = loadPrimaryConfigRaw();
        if (raw.ioError) return false;
        // 无内存件且磁盘损坏：拿不到真实 users，任何证明都无从谈起（fail-closed）
        if (raw.corrupt) return false;
        diskUsers = Array.isArray(raw.cfg.users) ? raw.cfg.users : [];
    }
    if (diskUsers.length === 0) {
        // users_mismatch 且磁盘为空 = 攻击者删光 users 制造"空"态 → 不放行
        return insp.reason !== 'users_mismatch';
    }

    const backup = inspectUsersBackup();
    if (insp.ok && insp.legacy) {
        // v1 合法件：新鲜 v2 备份 / 窗口内 legacy 备份证明磁盘全部账号（子集语义）。
        if (backup.trusted === 'v2') {
            return backupGenFresh(backup) && usersProvenByBackup(diskUsers, backup.users);
        }
        return legacyBackupUsable(backup) && usersProvenByBackup(diskUsers, backup.users);
    }
    // missing / unsigned / 其他失配：仅新鲜 v2 签名备份
    return backup.trusted === 'v2' && backupGenFresh(backup)
        && usersProvenByBackup(diskUsers, backup.users);
}

// ============================================================================
//  ★ P0 修复：config.json 签名函数
//  直接修改原对象，设置 configIssuedAt + usersSignature + configSignature
//  v2 签名内容：clinicName|doctorName|edition|configIssuedAt|usersSignature
// ============================================================================
function signConfig(config) {
    try {
        if (!config) return config;
        if (!config.configIssuedAt) {
            config.configIssuedAt = new Date().toISOString();
        }
        // ★ 第五轮（安全#1）：恒用机器绑定密钥——v2 验签端已删除 masterKey 派生
        //   候选（跨机移植通道），签发端必须同口径，否则 masterKey license 在场
        //   时自签的 config 本机验不过。
        const signKey = getUsersSignKey();
        // 先在局部算齐再赋值，保证两签名原子落盘（任一异常都不产生半成品）
        const usersSignature = computeUsersSignature(config.users, signKey);
        const signContent = [
            config.clinicName || '',
            config.doctorName || '',
            config.edition || '',
            config.configIssuedAt,
            usersSignature
        ].join('|');
        const configSignature = crypto.createHmac('sha256', signKey)
            .update(signContent).digest('hex');
        config.usersSignature = usersSignature;
        config.configSignature = configSignature;
        return config;
    } catch (e) {
        console.warn('[License] signConfig 失败:', e.message);
        return config;
    }
}

// ============================================================================
//  ★ P0 修复：统一安装 License（缺失的核心函数）
//  功能：
//    1. 写入加密的 license.dat
//    2. 清除试用期标记（trial.dat）
//    3. 更新 config.json（clinicName、doctorName、管理员用户）
//    4. 对 config.json 签名
//  参数：
//    base64Content - license base64 字符串
//    options - { machineId, doctorName, phone, password, clinicName, edition }
// ============================================================================
function installLicense(base64Content, options = {}) {
    try {
        const actualMachineId = options.machineId || getMachineId();

        // ★ 2026-09-26 H1/B1 + 复审 TOCTOU：config 只读一次，闸门裁决内存件，
        // 随后所有 mutate 都在同一对象上完成，防读盘窗口被利用。
        const configDir = getWritableDir();
        const configPath = require('path').join(configDir, 'config.json');
        let config = {};
        try {
            if (fs.existsSync(configPath)) {
                config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            }
        } catch (e) {
            // ★ 第四轮（J3）：JSON 损坏区分处置——从新鲜备份回填 users 后继续
            //   （闸门仍会对回填件裁决；备份不可信时回填为空，闸门按空 users 放行
            //   正常装码），其他 IO 错误维持原空件行为。
            if (e && e.name === 'SyntaxError') {
                console.warn('[License] config.json JSON 损坏，装码前从备份回填 users:', e.message);
                config = { users: getFillableUsers() };
            } else {
                console.warn('[License] 读取 config.json 失败，将创建新配置:', e.message);
            }
        }
        // 装码前先验明现存 users 来源，fail-fast——
        // 防止试用期间植入/篡改的账号经激活重签洗白。无 config 的出厂态（users 空）
        // 自然通过。
        if (!configUsersProvenAuthentic(config)) {
            console.warn('[License] installLicense 中止：现存 users 无真实签发来源');
            return { success: false, error: '本地配置已被篡改，请联系客服处理后再激活' };
        }

        // 1. 写入加密的 license.dat
        const writeResult = writeLicenseContent(base64Content, actualMachineId);
        if (!writeResult.success) {
            return { success: false, error: writeResult.error };
        }

        // ★ 2026-09-23 安全 / 2026-09-26 M-2：激活唯一写点 → 统一状态（vault
        //   凭据优先，降级双文件）同置 everActivated。此后删 license.dat / 双删文件
        //   都不能降级为全新试用（vault 凭据无法用文件删除移除）。
        try {
            const __r = readUnifiedState(actualMachineId);
            const __s = __r.state || {};
            __s.everActivated = true;
            __s.offlineStart = null;
            __s.lastVerify = Date.now();
            __s.lastReject = null;
            __s.rejectAt = null;
            writeUnifiedState(__s, actualMachineId);
        } catch (ge) { console.warn('[License] everActivated 标记失败(非致命):', ge && ge.message); }

        // 2. 清除试用期标记（trial.dat）
        try {
            const trialPath = getTrialPath();
            if (fs.existsSync(trialPath)) {
                fs.unlinkSync(trialPath);
                console.log('[License] 已清除试用期标记');
            }
        } catch (e) {
            console.warn('[License] 清除 trial.dat 失败（非致命）:', e.message);
        }

        // 3. 同步 config.json（诊所名、医师名、管理员账户）
        // config / configPath / configDir 已在函数开头单次读取（闸门裁决同一对象）

        let configChanged = false;

        // 更新诊所名
        // ★ 2026-09-06 P0 修复（绑定校验诊所名不匹配）：同步 config.clinicName 以 license
        //   内已签发的权威值为准优先——官网下单页「姓名/诊所名称」单框设计，客户常把
        //   "诊所名 / 医师名"一并填入并写进申请，服务端照此签发 license.clinicName；
        //   若以激活表单参数（options.clinicName）为准同步，config.clinicName 与
        //   license.clinicName 不一致 → checkLicenseBinding 报"诊所名不匹配"阻断启动。
        //   options.clinicName 仅在 license 无该字段时兜底（旧版 license）。
        let authoritativeClinicName = '';
        try {
            const licenseData = readLicense(actualMachineId);
            if (licenseData && licenseData.clinicName) {
                authoritativeClinicName = String(licenseData.clinicName);
            }
        } catch (clErr) {
            console.warn('[License] 读取 license 诊所名失败（用激活参数兜底）:', clErr.message);
        }
        const effClinicName = authoritativeClinicName || options.clinicName || '';
        if (effClinicName && config.clinicName !== effClinicName) {
            config.clinicName = effClinicName;
            configChanged = true;
        } else if (!config.clinicName && options.doctorName) {
            // doctorName作为兜底（兼容旧调用）
        }

        // 更新医师名/管理员名
        const doctorName = options.doctorName || '';
        if (doctorName && config.doctorName !== doctorName) {
            config.doctorName = doctorName;
            configChanged = true;
        }

        // 创建管理员用户（phone作为用户名）
        // ★ 2026-08-19 修复：密码留空默认 admin，只要填了手机号即创建可登录账户。
        //   旧逻辑 password 为空时不建号 → 激活框密码留空默认 admin，登录 手机号+admin
        //   报"用户名或密码错误"。现放宽：有手机号即建号，密码留空统一回退 admin。
        const phone = options.phone || '';
        const password = options.password || 'admin';
        if (phone) {
            if (!Array.isArray(config.users)) config.users = [];

            // 密码哈希：PASSWORD_SALT / hashOf 已提升为模块级
            // （2026-09-26 阻断修复，原块级 const 导致 ensureLocalActivationUser 必崩）
            const nowMs = Date.now();

            // 检查用户是否已存在
            const existingUser = config.users.find(u => u.username === phone);
            if (!existingUser) {
                config.users.push({
                    username: phone,
                    password: hashOf(password),
                    passwordHash: hashOf(password),
                    salt: PASSWORD_SALT,
                    name: doctorName || phone,
                    role: 'admin',
                    createdAt: new Date().toISOString()
                });
                configChanged = true;
                console.log('[License] 已创建管理员账户:', phone);
            } else if (options.password && options.password !== 'admin') {
                // ★ 2026-09-20 换机重激活密码同步（惠康康案例）：本机已有同号老账户
                //   （历史注册/试用），激活窗口明确填写的密码此前被静默忽略 → 客户被
                //   老密码锁死（激活成功却登录"用户名或密码错误"，且删数据目录对客户
                //   不可行）。云端 claim 已通过身份核验（手机号/诊所名）=原激活本人，
                //   允许按本次显式密码更新本机账户。'admin'=渲染层留空占位（2026-09-04
                //   方案B 语义），不覆盖——保留注册密码保护铁律。lastPwdUpdatedAt 驱动
                //   前端镜像层（addLocalActivationUser Phase 1.3）启动自愈强制覆盖。
                const passwordHash = hashOf(options.password);
                existingUser.password = passwordHash;
                existingUser.passwordHash = passwordHash;
                existingUser.salt = PASSWORD_SALT;
                existingUser.name = doctorName || existingUser.name || phone;
                existingUser.lastPwdUpdatedAt = nowMs;
                existingUser.updatedAt = nowMs;
                configChanged = true;
                console.log('[License] 已更新已有账户密码(激活显式密码):', phone);
            }
        }

        // ★ 2026-09-06 P0 修复（机构版激活后仍显示【修改密码】）：装码即绑定版本。
        //   installLicense 此前从不写 config.edition（options.edition 参数被忽略），
        //   enforceEditionBinding 又只在启动/断点续传时调用 → 会话内激活后不重启直接
        //   登录，edition 停留出厂 personal → 机构版【用户管理】错显为【修改密码】。
        //   license.dat 已于步骤1落盘，此处读出并按 license.type 就地校正同一份
        //   config（edition + 角色保证），与下方签名写盘一次成型（双写会互相覆盖，
        //   必须在同一份 config 对象上合并后单次写盘）。
        try {
            const licData = readLicense(actualMachineId);
            const bind = applyEditionBindingToConfig(licData, config);
            if (bind.applied && bind.corrected) {
                configChanged = true;
                console.log('[License] 装码版本绑定: edition', bind.from, '->', bind.to);
            }
        } catch (be) {
            console.warn('[License] 装码版本绑定校正失败（非致命，启动时 enforceEditionBinding 兜底）:', be.message);
        }

        // 4. 签名并保存 config.json
        // ★ 第三轮终检 P2 修复：config 无签名时（重激活且内容无变化）也强制签名写入，
        //   避免 verifyConfigIntegrity fail-closed 后误拦（与 APP 端 activateOnline 对齐）
        if (configChanged || !config.configSignature) {
            signConfig(config);
            // ★ 第三轮终检 P2 修复：signConfig 失败会返回未签名 config（无 configSignature），
            //   原样写入会让 verifyConfigIntegrity 走"无签名"分支。现未签名则拒绝写入，
            //   保留磁盘上的旧签名 config（fail-safe：宁可配置不更新也不破坏完整性链）。
            if (!config.configSignature) {
                console.error('[License] signConfig 未生成签名，跳过 config.json 写入（保留原签名配置）');
            } else {
                try {
                    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
                    console.log('[License] config.json 已更新并签名');
                } catch (writeErr) {
                    // 尝试 fallback 到 userData 目录
                    console.warn('[License] 写入 config.json 失败，尝试 fallback:', writeErr.message);
                    try {
                        const fallbackPath = require('path').join(app.getPath('userData'), 'config.json');
                        fs.writeFileSync(fallbackPath, JSON.stringify(config, null, 2), 'utf8');
                        console.log('[License] config.json 已写入 fallback 路径:', fallbackPath);
                    } catch (fbErr) {
                        console.error('[License] config.json fallback 写入也失败:', fbErr.message);
                    }
                }
            }
        }

        console.log('[License] installLicense 完成，license 路径:', writeResult.path);
        // proven：装码已通过 license 验签 + users 闸门，config 刚重签落盘，
        // 允许推进备份（含备份缺失场景，否则备份永久缺失、后续自愈无据可依）。
        backupUserAccounts(config, { proven: true }); // ★ P3-预防重装：激活后同步刷新账号独立备份
        return { success: true, path: writeResult.path, configUpdated: configChanged };
    } catch (e) {
        console.error('[License] installLicense 异常:', e);
        return { success: false, error: e.message };
    }
}

// ============================================================================
//  ★ 版本绑定校正：存在正式 license 时，强制使 config.edition 与激活码版本一致
//  同一台设备只能注册一个版本。若 config.edition 与 license 版本不一致
//  则自动校正 edition 与用户角色：
//    机构版 → edition=cloud_clinic/clinic，用户角色=admin
//    标准版 → edition=cloud_personal/personal，用户角色=user
//  ★ 第三轮终检 P0 修复（2026-08-16）：本函数曾于 a1665523 只实现在 cloud_desktop
//    副本，未进入 shared 事实源，随后被 CI 同步覆盖删除（副本漂移事故）。
//    现恢复到事实源，并新增签名校验：license 验签失败时不得用于校正
//    （防止伪造 license.type=pro 提权 admin 角色）。
//  返回：{ success, corrected, edition, from, to }
// ============================================================================
// ★ 2026-09-06 P0 修复（机构版激活后仍显示【修改密码】）核心抽离：
//   原 enforceEditionBinding 只在【启动时/断点续传后】调用，而 installLicense 从不写
//   config.edition → 会话内激活（登录窗管理员激活 installAdminLicenseDesktop /
//   激活窗口 saveLicense / admin-status 轮询 BridgeInstall 三条路径）后不重启直接
//   登录，config.edition 仍为出厂 personal → get-app-config 对机构版授权只"不强制
//   personal"、不会主动校正为 clinic → 前端按标准版对齐 → 【修改密码】错显。
//   现抽核心供 installLicense 装码时就地调用（装码即绑定版本，对齐 APP 端
//   installAdminLicense 内置 normalizeEdition 的语义）。
// 机构类 type 集合对齐 APP 端 LicenseManager（pro/institution/clinic/clinic_custom）。
const INSTITUTIONAL_LICENSE_TYPES = ['pro', 'institution', 'clinic', 'clinic_custom'];

function applyEditionBindingToConfig(license, config) {
    if (!license || !license.type) {
        return { skip: 'no-license' };  // 无正式 license，无需校正
    }
    // ★ 安全加固：仅信任验签通过的 license（防伪造 type 提权）
    if (!verifySignature(license)) {
        console.warn('[License] 版本绑定: license 验签失败，跳过校正');
        return { skip: 'signature' };
    }
    const type = String(license.type || '').toLowerCase();
    const isInstitution = INSTITUTIONAL_LICENSE_TYPES.includes(type);
    // ★ 2026-09-21 免费版（free）走标准版形态分支：edition 校正为 personal、
    //   全员 user 角色（单用户）；功能差异由 features 位表达，与 edition 无关。
    if (!isInstitution && type !== 'personal' && type !== 'standard' && type !== 'free') {
        return { skip: 'unknown-type' };  // 无法识别的版本，跳过
    }
    if (!config || typeof config !== 'object') {
        return { skip: 'no-config' };
    }

    const isCloud = (config.appMode === 'cloud') ||
                    ['cloud', 'cloud_personal', 'cloud_clinic'].includes(config.edition);

    let targetEdition;
    if (isInstitution) {
        targetEdition = isCloud ? 'cloud_clinic' : 'clinic';
    } else {
        targetEdition = isCloud ? 'cloud_personal' : 'personal';
    }

    let corrected = false;
    const from = config.edition;
    if (config.edition !== targetEdition) {
        config.edition = targetEdition;
        corrected = true;
        console.log('[License] 版本绑定校正 edition:', from, '->', targetEdition);
    }

    // ★ 2026-08-20 角色合规修复：机构版不再全员强制 admin（旧逻辑把医师也提权 → 医师登录也显示
    //   【用户管理】，违反"机构版=管理员显示用户管理、医师不显示"规范）。机构版仅保证至少一名
    //   管理员（防全表无 admin 锁死管理入口），其余角色保持用户管理设置；标准版仍全员 user（单用户规范）。
    if (Array.isArray(config.users) && config.users.length > 0) {
        if (isInstitution) {
            const hasAdmin = config.users.some(u => u && (u.role === 'admin' || u.role === 'clinic_admin'));
            if (!hasAdmin) {
                const first = config.users[0];
                console.log('[License] 版本绑定校正：机构版无管理员，提升首个用户', first.username, '-> admin');
                first.role = 'admin';
                corrected = true;
            }
        } else {
            for (const u of config.users) {
                if (u && u.role && u.role !== 'user') {
                    console.log('[License] 版本绑定校正用户角色:', u.username, u.role, '-> user（标准版单用户）');
                    u.role = 'user';
                    corrected = true;
                }
            }
        }
    }

    return { applied: true, corrected: corrected, from: from, to: config.edition };
}

function enforceEditionBinding() {
    try {
        const license = readLicense();
        const configDir = getWritableDir();
        const configPath = require('path').join(configDir, 'config.json');
        if (!fs.existsSync(configPath)) {
            return { success: true, corrected: false };
        }
        // ★ 第四轮（J2/B-重2）：闸门必须裁决【改写前】的同一内存件——apply 会就地
        //   改 edition/users 角色，改后验签必失真；快照在改写前留存（与读盘同一份，
        //   无 TOCTOU 二次读窗口），闸门验快照=磁盘原貌。
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const __preMutationSnapshot = JSON.parse(JSON.stringify(config));
        const r = applyEditionBindingToConfig(license, config);
        if (r.skip) {
            return { success: true, corrected: false };
        }

        if (r.corrected) {
            // ★ 2026-09-26 H1/B1：重签前验明磁盘 users 来源（快照=改写前内存件），
            // 防本路径洗白篡改 users。
            if (!configUsersProvenAuthentic(__preMutationSnapshot)) {
                console.warn('[License] 版本绑定校正中止：磁盘 users 无真实签发来源');
                return { success: false, corrected: false, error: 'config_tampered' };
            }
            signConfig(config);
            // ★ 第三轮终检 P2 修复：未生成签名则拒绝写入（与 installLicense 策略一致）
            if (!config.configSignature) {
                console.error('[License] signConfig 未生成签名，跳过版本绑定校正写入');
                return { success: true, corrected: false };
            }
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
            // ★ 第四轮（B-重2）：改角色/版本后 proven 刷新备份——否则备份滞留旧
            //   admin 角色，config 损坏后由备份回填=提权复活。
            // ★ 2026-10-01（双审查 B-Z3 收口）：版本绑定校正改角色属安全翻转，
            //   锚点保持同步写零窗口（仅在 r.corrected 偶发校正时执行一次）。
            try { backupUserAccounts(config, { proven: true }); } catch (be) { /* 非致命 */ }
            console.log('[License] config.json 版本绑定校正完成，已重新签名');
        }

        return { success: true, corrected: r.corrected, from: r.from, to: r.to };
    } catch (e) {
        console.warn('[License] enforceEditionBinding 异常（非致命）:', e.message);
        return { success: false, corrected: false, error: e.message };
    }
}

// ★ v300 免费版账号链修复（Seed 独立代码审查问题 1/2）：
//   1) 建号结果必须"写入后回读取证"，调用方不能用"填了手机号"冒充账号已创建
//      （config 写入/signConfig 失败时旧逻辑仍回传 accountCreated=true，客户登录失败）；
//   2) already-free 幂等补绑走同一入口；账号已存在时不覆盖密码（注册密码保护铁律）。
function __enumerateConfigPaths() {
    const paths = [];
    try {
        paths.push(require('path').join(getWritableDir(), 'config.json'));
    } catch (e) { /* 忽略 */ }
    try {
        const ud = app.getPath('userData');
        if (ud) {
            const p = require('path').join(ud, 'config.json');
            if (paths.indexOf(p) === -1) paths.push(p);
        }
    } catch (e) { /* 忽略 */ }
    return paths;
}

// 两处 config（可写目录 / userData fallback）任一回读到该用户即视为存在
function localUserExists(username) {
    if (!username) return false;
    const target = String(username);
    for (const p of __enumerateConfigPaths()) {
        try {
            if (!fs.existsSync(p)) continue;
            const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (Array.isArray(cfg.users) && cfg.users.some(u => u && (u.username === target || u.name === target))) {
                return true;
            }
        } catch (e) { /* 不可读按不存在继续查下一处 */ }
    }
    return false;
}

// 免费版领取/补绑专用：幂等确保手机号本地管理员账号存在。
// 返回 {success, existed}；任何失败都 success=false，绝不"假成功"。
function ensureLocalActivationUser(phone, password) {
    try {
        const trimmed = String(phone || '').trim();
        if (!/^1[3-9]\d{9}$/.test(trimmed)) {
            return { success: false, existed: false, error: '手机号格式不正确' };
        }

        // ★ 复审 TOCTOU 收口：config 只读一次，后续闸门/落盘都用同一内存件。
        const configPath = require('path').join(getWritableDir(), 'config.json');
        let config = null;
        let primaryReadOk = false;
        let configCorruptBackfilled = false;
        try {
            if (fs.existsSync(configPath)) {
                config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                primaryReadOk = true;
            }
        } catch (e) {
            // ★ 第四轮（J3）：JSON 损坏→备份回填（闸门随后裁决回填件），
            //   其他 IO 错误维持"将重建"行为。
            if (e && e.name === 'SyntaxError') {
                console.warn('[License] ensureLocalActivationUser config 损坏，从备份回填 users:', e.message);
                config = { users: getFillableUsers() };
                // ★ 第五轮（复审A高危#1）：回填件视为有效主件内容——若仍置
                //   primaryReadOk=false，下方 `if (!primaryReadOk) config={}` 会把
                //   刚回填的账号清空，后续 proven 覆写把备份也冲掉=账号双端丢失。
                primaryReadOk = true;
                configCorruptBackfilled = true;
            } else {
                console.warn('[License] ensureLocalActivationUser 读取 config 失败，将重建:', e.message);
            }
        }
        // 幂等：主件命中 或 fallback 件命中（保持原 localUserExists 全路径语义），
        // 不覆盖密码（保护用户注册时自设密码）。
        const inPrimary = !!(config && Array.isArray(config.users)
            && config.users.some(u => u && (u.username === trimmed || u.name === trimmed)));
        if (inPrimary || localUserExists(trimmed)) {
            // ★ 第五轮（复审A#5）：config 刚从损坏回填且账号在回填件中命中时，
            //   磁盘上仍是坏件——顺带重签写盘把损坏 config 修复掉（非致命，
            //   失败不影响本次补绑结果；inPrimary 才修：回填件含该用户才是
            //   备份证明过的真实内容）。
            if (configCorruptBackfilled && inPrimary) {
                try {
                    signConfig(config);
                    if (config.configSignature) {
                        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
                        backupUserAccounts(config, { proven: true });
                        console.log('[License] ensureLocalActivationUser 已顺带修复损坏 config');
                    }
                } catch (re) {
                    console.warn('[License] ensureLocalActivationUser 修复损坏 config 失败（非致命）:', re.message);
                }
            }
            return { success: true, existed: true };
        }
        if (!config || !primaryReadOk) config = {};
        if (!Array.isArray(config.users)) config.users = [];

        // ★ 2026-09-26 H1/B1：新增账号前闸门裁决内存件（免费领取在出厂空 config
        //   上进行，自然通过），防篡改 config 经此路径重签洗白。
        if (!configUsersProvenAuthentic(config)) {
            console.warn('[License] ensureLocalActivationUser 中止：现存 users 无真实签发来源');
            return { success: false, existed: false, error: '本地配置被篡改，建号已中止，请联系客服' };
        }

        const pwd = password || 'admin';
        config.users.push({
            username: trimmed,
            password: hashOf(pwd),
            passwordHash: hashOf(pwd),
            salt: PASSWORD_SALT,
            name: trimmed,
            role: 'admin',
            createdAt: new Date().toISOString()
        });

        signConfig(config);
        if (!config.configSignature) {
            console.error('[License] ensureLocalActivationUser signConfig 未生成签名，拒绝写入');
            return { success: false, existed: false, error: 'config签名失败' };
        }

        let writeOk = false;
        try {
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
            writeOk = true;
        } catch (we) {
            console.warn('[License] ensureLocalActivationUser 主路径写入失败，尝试 fallback:', we.message);
            try {
                const fallbackPath = require('path').join(app.getPath('userData'), 'config.json');
                fs.writeFileSync(fallbackPath, JSON.stringify(config, null, 2), 'utf8');
                writeOk = true;
            } catch (fe) {
                console.error('[License] ensureLocalActivationUser fallback 写入也失败:', fe.message);
            }
        }

        // ★ 回读取证：写入声明成功但磁盘查不到，仍按失败返回
        if (!writeOk || !localUserExists(trimmed)) {
            return { success: false, existed: false, error: '手机号账号确保失败' };
        }

        // proven：users 刚过闸门随签名 config 落盘
        backupUserAccounts(config, { proven: true });
        console.log('[License] ensureLocalActivationUser 已确保本地管理员账号:', trimmed);
        return { success: true, existed: false };
    } catch (e) {
        console.error('[License] ensureLocalActivationUser 异常:', e.message);
        return { success: false, existed: false, error: e.message };
    }
}

module.exports = {
    enforceEditionBinding,  // ★ 启动时校正 config.edition 与激活码版本一致（main.js 调用）
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
    // ★ P3-预防重装：账号独立持久化备份
    getUsersBackupPath,    // 账号备份文件路径
    backupUserAccounts,    // 备份 users 到独立文件
    loadUserAccountBackup, // 从独立备份读取 users（返回 {users,trusted}）
    inspectUsersBackup,    // ★ 2026-09-26 I2：备份签名检查（{trusted,users}）
    configUsersProvenAuthentic, // ★ 2026-09-26 H1/B1：重签前置闸门
    getFillableUsers,     // ★ 2026-09-26：回填专用（新鲜v2/v1窗口legacy）
    backupGenFresh,       // ★ 2026-09-26：v2 备份 gen 新鲜度（测试用）
    legacyBackupUsable,   // ★ 2026-09-26：legacy 备份可采信判定（测试用）
    usersProvenByBackup,   // ★ 2026-09-26：账号来源子集证明（测试用）
    usersListsEqual,       // 全等等比较（测试用）
    // ★ v300 免费版账号链：回读确证的幂等建号（免费领取/already-free 补绑）
    localUserExists,
    ensureLocalActivationUser,
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
    // ★ 2026-09-23 登录后台闸门（IPC 委托：主进程裁决 LICENSED/trial/free/7天宽限）
    verifyLoginGate,
    // ★ 2026-10-01 启动性能：whenReady 后台预热 vault 统一态（冷 PS 移出登录关键路径）
    prewarmGate,
    // ★ 2026-10-02 登录性能：whenReady 后台预取在线裁决（冷 TLS/Worker 移出登录路径）
    prewarmAdjudication,
    // ★ 2026-10-02 登录性能：点击登录瞬间保热（TTL 内热槽直接复用，与 PBKDF2 并行）
    ensureAdjudicationWarm,
    readAnchorState,       // 二级锚点读（供测试用）
    writeAnchorState,      // 二级锚点写（供测试用）
    // ★ 2026-09-26 M-2：文件锚点原语/统一视图（迁移冒烟用，与 anchor 导出对称）
    readGateState,
    writeGateState,
    getUnifiedGate,
    persistUnified,
    // ★ 2026-09-26 M-2：凭据管理器层（冒烟/诊断用）
    vaultProbe,
    readUnifiedState,
    writeUnifiedState,
    invalidateUnifiedCache,
    // M-2 级联对账冒烟用（内部原语）
    writeVaultState,
    getMidVariants,
    // ★ 2026-09-11 阶段1b：拒绝原因查询（'hmac_sunset' = HMAC 日落截断，UI 引导联网自愈）
    getLastVerifyRejectReason,
    stopHeartbeat,         // 停止心跳检测
    checkLicenseRevocation, // 手动检查授权状态（供测试用）
    // ★ P1-3 新增：masterKey 派生密钥机制
    setLicenseDataContext,  // 缓存当前 license 数据（供 verifyConfigIntegrity 派生密钥用）
    getLicenseMasterKey,    // 获取当前 license 的 masterKey（供测试用）
    getEffectiveHmacKey,    // 获取生效的 HMAC 密钥（masterKey 派生或硬编码 fallback）
    getEffectiveConfigSignKey, // 获取生效的 config 签名密钥（masterKey 派生或硬编码 fallback）
    // P6-6 新增：激活工单
    submitActivationTicket,
    getCachedActivationTicket,
    // ★ P0 修复：config签名 + license统一安装
    signConfig,
    inspectConfigSignatures, // ★ 2026-09-26 F2：双签名检查（供测试/启动迁移）
    migrateConfigUsersSignature, // v1→v2 迁移（供测试）
    stableStringify,         // users 稳定序列化（供测试）
    installLicense,
    // ★ 2026-09-07 导出装码绑定核心：main.js get-app-config 存量自愈调用
    //   （旧版本激活的机器 config.edition 停留出厂 personal → 机构版【用户管理】
    //    错显为【修改密码】；每次读配置时按 license.type 就地上调并固化磁盘）
    applyEditionBindingToConfig,
    // ★ 第三轮终检 P1 修复：导出验签函数，供 prescription-counter / feature-guard
    //   在使用 license 字段前校验签名（堵住 readLicense 不验签的旁路）
    verifySignature
};
