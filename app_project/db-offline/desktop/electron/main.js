// ============================================================================
//  惠康中医-本地  Electron 主进程
//  安全配置：contextIsolation=true / nodeIntegration=false
//  注：未启用 sandbox，以保留原生 window.prompt/confirm/alert（业务大量使用）
//      contextIsolation 仍确保渲染进程无法直接访问 Node API
//  所有 API 通过 preload.js 的 contextBridge 暴露
//
//  ★ 本文件为机构版 electron/main.js，基于原离线版增加：
//    - session.setPermissionRequestHandler：自动授予 camera/microphone 权限
//    - save-video-file IPC handler：视频 ArrayBuffer 写入文件
//    - get-video-directory / open-video-directory IPC handler
//    - dom-ready 时注入 video-recorder.js 模块
//    - CSP 增加 media-src 'self' blob: 允许视频预览
// ============================================================================
const { app, BrowserWindow, ipcMain, session, dialog, shell, safeStorage, net } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const fse = require('fs-extra');
const crypto = require('crypto');
const licenseManager = require('./license-manager');
app.setAppUserModelId('com.benneng.prescription');  // ★ Windows 任务栏图标关联
const prescriptionCounter = require('./prescription-counter');
const featureGuard = require('./feature-guard');
const activateManager = require('./activate');
const selfCheck = require('./self-check');  // ★ P0-③ exe 签名/完整性自校验（非阻塞，仅记录）
const logger = require('./electron-logger.cjs');  // ★ P0-[6.3] 主进程滚动日志（脱敏 + 2MB 轮转，.cjs 确保 CJS 解析）

// ★ 2026-09-13 B2-1 文件域收口：媒体保存/查找/重命名、备份读写/一键恢复、用户数据
//   落盘、路径白名单等文件域逻辑全部在 desktop-fs-ipc.cjs（shared/ 唯一权威源 →
//   sync-all Group 14 分发 → copy-consistency 哈希门），39 项函数/IPC（19 handler + 20 工具）双端等体抽取。
//   本文件保留端配置与外部使用点（whenReady 迁移触发 / will-download 落盘），
//   改动铁律：改文件域只改 desktop-fs-ipc.cjs（change-password 回退已随 P2 user 域迁至 desktop-user-ipc.cjs）。
const desktopFileIpc = require('./desktop-fs-ipc.cjs').createDesktopFileIpc({ ipcMain, app, dialog, shell, BrowserWindow });
const { getExeDirectory, getDownloadsDirectory, migrateLegacyDataToCentral, sanitizeFileName, getDataDirectory } = desktopFileIpc;


let mainWindow;
let loginWindow;
let sharedSession;
let currentLoggedInUser = null;
// ★ 2026-09-23：激活窗关闭闸门复核需要当前登录用户名（账号墓碑按用户名裁决）
try { activateManager.bindUserContext(() => currentLoggedInUser); } catch (e) {}
const SESSION_PARTITION = 'persist:tcm-prescription-dingzhi';

// ============================================================================
//  ★ 全局异常捕获 + 安全防护
//  1. uncaughtException / unhandledRejection：写入滚动日志到 userData/logs/app.log
//     （electron-logger 自动脱敏敏感字段、2MB 轮转保留最近 5 份）
//  2. asar 运行环境检测：打包后必须从 app.asar 内运行，防止解包篡改
// ============================================================================
process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err && err.stack ? err.stack : err);
    logger.crash('uncaughtException', err);
});

process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
    logger.crash('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)));
});

// asar 运行环境检测：打包后 main.js 必须从 app.asar 内运行（防止解包篡改）
// 仅记录日志不退出，避免误判合法便携版/开发模式
if (app.isPackaged && !__dirname.includes('app.asar')) {
    console.error('[SECURITY] 检测到非 asar 运行环境，可能已被解包篡改: ' + __dirname);
}

app.commandLine.appendSwitch('enable-usermedia-screen-capturing');
app.commandLine.appendSwitch('enable-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('allow-file-access-from-files');

// ============================================================================
//  ★ 安全防护：拦截远程调试启动参数（防止绕过 DevTools 拦截）
//  攻击场景：通过 --inspect / --remote-debugging-port=9229 启动 exe 后，
//            可用 Chrome DevTools 远程连接，绕过 before-input-event 的 F12 拦截
//  修复：检测到调试参数立即退出程序
// ============================================================================
(function blockRemoteDebugging() {
    // ★ E2E 专用旁路（2026-08-21 P3，与云端版 T4 同款设计）：放行远程调试需【同时】满足：
    //   ① 环境变量 BNZC_E2E=1（外部攻击者无法在用户机器上预设）
    //   ② exe 同级目录存在 e2e-enabled.marker 文件（仅本地构建管线在 dist\win-unpacked
    //      跑 e2e 前临时写入、跑完即删；NSIS Setup / portable 产物永不携带此文件）
    //   任一条件缺失都按原逻辑阻断 —— 生产包的远程调试防护保持 100% 生效。
    try {
        if (process.env.BNZC_E2E === '1') {
            const fsSync = require('fs');
            const markerPath = path.join(path.dirname(process.execPath), 'e2e-enabled.marker');
            if (fsSync.existsSync(markerPath)) {
                console.warn('[E2E] 命中 e2e 旁路（BNZC_E2E=1 + marker），放行远程调试');
                // ★ 全局旁路标志：license 的 debugger 检测与服务端试用登记据此跳过
                //   （标志置位前提 = 双条件已校验通过，攻击者需同时控制环境变量+exe 目录写权限）
                global.__BNZC_E2E_BYPASS = true;
                // 顺带隔离 userData，避免 e2e 读写污染开发者/用户真实数据目录
                if (process.env.BNZC_E2E_DATA) {
                    try {
                        fsSync.mkdirSync(process.env.BNZC_E2E_DATA, { recursive: true });
                        app.setPath('userData', process.env.BNZC_E2E_DATA);
                        console.warn('[E2E] userData 已隔离至: ' + process.env.BNZC_E2E_DATA);
                    } catch (e) { console.warn('[E2E] userData 隔离失败:', e.message); }
                }
                return;
            }
        }
    } catch (e) { /* 旁路检查异常则按原逻辑继续阻断 */ }
    const argv = process.argv.join(' ').toLowerCase();
    const debugPatterns = [
        '--inspect',           // Node.js Inspector
        '--inspect-brk',       // 断点调试
        '--remote-debugging-port',  // Chrome 远程调试端口
        '--debug',             // 旧版调试
        '--debug-brk'          // 旧版断点调试
    ];
    for (const pattern of debugPatterns) {
        if (argv.includes(pattern)) {
            console.error('[SECURITY] 检测到远程调试参数，程序退出: ' + pattern);
            try {
                const { app: appRef } = require('electron');
                appRef.whenReady().then(() => {
                    const { dialog } = require('electron');
                    dialog.showMessageBoxSync({
                        type: 'error',
                        title: '安全提示',
                        message: '检测到调试参数，软件无法运行。',
                        detail: '请勿通过命令行添加调试参数启动本程序。'
                    });
                    appRef.quit();
                });
            } catch (e) {
                process.exit(1);
            }
            process.exit(1);
        }
    }
})();

// ============================================================================
//  目录与键名工具
// ============================================================================
// ★ 获取可写的 config.json 路径（打包后 asar 只读，必须用 exe 目录或 userData）
// Portable: exe 同目录；NSIS 安装版: userData 目录（与 license-manager.js getWritableDir 一致）
function getWritableConfigPath() {
    try {
        if (process.env.PORTABLE_EXECUTABLE_DIR) {
            return path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'config.json');
        }
        return path.join(app.getPath('userData'), 'config.json');
    } catch (e) {
        return path.join(getExeDirectory(), 'config.json');
    }
}

// ★ 首次启动时，将 asar 内的 config.json 复制到可写路径（仅复制一次）
// ★ 2026-09-26 B2 修复：已存在的 config.json 绝不无条件重签——否则被篡改/
//   植入的 users 会在 validateLicense 之前就被合法密钥就地"洗白"。
//   现仅检查签名状态：v2 完整件保持原样；v1 合法旧件交由 validateLicense
//   带备份校验迁移；签名无效件不动，由 validateLicense fail-closed。
async function ensureWritableConfig() {
    try {
        const writablePath = getWritableConfigPath();
        if (await fse.pathExists(writablePath)) {
            try {
                const insp = licenseManager.inspectConfigSignatures();
                if (insp.ok && !insp.legacy) {
                    // v2 双签名完整：无需任何处理
                } else if (insp.ok && insp.legacy) {
                    console.log('[Config] 现存 config.json 为 v1 合法旧件，启动校验时迁移');
                } else {
                    console.warn('[Config] 现存 config.json 签名无效(reason='
                        + insp.reason + ')，不就地重签，交由 validateLicense 裁决');
                }
            } catch (e) {
                console.warn('[Config] 签名检查失败，跳过:', e.message);
            }
            return writablePath;
        }
        const asarPath = path.join(__dirname, '..', 'config.json');
        if (await fse.pathExists(asarPath)) {
            const config = await fse.readJson(asarPath);
            await fse.writeJson(writablePath, config, { spaces: 2 });
            console.log('[Config] config.json copied to writable path:', writablePath);
        }
        return writablePath;
    } catch (e) {
        console.error('[Config] ensureWritableConfig failed:', e.message);
        return path.join(__dirname, '..', 'config.json');
    }
}

// ============================================================================
//  ★ 首次启动版本选择：统一安装包首次运行时，让用户选择标准版或机构版
//  ★ 选择后写入 config.json（edition + 默认用户角色），后续启动不再询问
// ============================================================================
async function ensureEditionSelected() {
    try {
        const configPath = getWritableConfigPath();
        let config = {};
        if (await fse.pathExists(configPath)) {
            config = await fse.readJson(configPath);
        }

        // 已有明确的 edition 值。
        // ★ 注意：'custom' 是旧版默认占位值，不代表用户已选择版本
        // ★ 2026-08-17 关键修复：机构版=正式激活才能使用；无授权（试用/过期/未激活）一律视作标准版，
        //   即使旧 edition 已知是 clinic_custom 等机构版值，也必须强制校正为 personal，
        //   防止旧安装包残留机构版 config 导致 顶部标签 vs Permission 双源不一致、改密按钮不显示。
        const knownEditions = ['personal', 'clinic', 'cloud_personal', 'cloud_clinic',
                               'offline_personal', 'offline_clinic', 'clinic_custom'];
        if (config.edition && knownEditions.includes(config.edition)) {
            // ★ 关键：仅当已正式授权时跳过校正；无授权一律强制标准版
            let alreadyLicensed = false;
            try { alreadyLicensed = !!licenseManager.readLicense(); } catch (e) { alreadyLicensed = false; }
            if (alreadyLicensed) {
                console.log('[Edition] 已正式授权，保留当前版本:', config.edition);
                return;
            }
            // 未授权：即便 edition 已知也进入下方，强制校正为标准版
            console.log('[Edition] 已知 edition=', config.edition, '但未授权，仍强制校正为标准版');
        }

        // ★ 2026-08-16：统一安装包下，无正式 license（试用）默认标准版，不再弹版本选择框。
        //   正式激活后由 enforceEditionBinding 校正 edition 与激活码版本一致。
        let hasLicense = false;
        try { hasLicense = !!licenseManager.readLicense(); } catch (e) { hasLicense = false; }

        if (!hasLicense) {
            // ★ 2026-09-26 H1/B1：本块改 users 角色并重签，先验明磁盘 users 来源，
            // 防篡改/植入 users 经启动校正洗白。不通过则跳过本块（不重签不写盘），
            // validateLicense 随后 fail-closed。
            // ★ 第四轮（J2）：闸门直接裁决本次读入的内存件（防 TOCTOU 二次读窗口）。
            if (!licenseManager.configUsersProvenAuthentic(config)) {
                console.warn('[Edition] 跳过试用标准版校正：现存 users 无真实签发来源');
                return;
            }
            // 试用期固定标准版（personal）
            config.edition = 'personal';
            if (Array.isArray(config.users)) {
                for (const u of config.users) {
                    if (u && u.role === 'admin') {
                        u.role = 'user';
                        console.log('[Edition] 用户', u.username, '角色已调整为 user（试用标准版）');
                    }
                }
            }
            licenseManager.signConfig(config);
            await fse.writeJson(configPath, config, { spaces: 2 });
            // ★ 第四轮（B-重2）：改角色写盘后 proven 刷新备份——否则备份滞留旧 admin
            //   角色，config 损坏后由备份回填=提权复活。
            try { licenseManager.backupUserAccounts(config, { proven: true }); } catch (_) {}
            console.log('[Edition] 无授权，试用默认标准版（personal）');
            return;
        }

        // 有正式 license：由 enforceEditionBinding 在启动时校正，这里不弹框
        console.log('[Edition] 已存在授权，版本由 enforceEditionBinding 校正');
    } catch (e) {
        console.error('[Edition] 版本选择失败:', e.message);
        // 失败不阻塞启动，使用默认配置
    }
}

// ============================================================================
//  ★ 试用固定标准版 + 服务端一次性试用登记（防卸载重装刷试用）
//  试用期固定为「标准版」（edition=personal），机构版只能通过正式激活获得。
// ============================================================================
function getTrialDeniedPath() {
    try {
        return require('path').join(licenseManager.getWritableDir(), 'trial-denied.dat');
    } catch (e) {
        return require('path').join(app.getPath('userData'), 'trial-denied.dat');
    }
}
function isTrialDenied() {
    try { return require('fs').existsSync(getTrialDeniedPath()); } catch (e) { return false; }
}
function writeTrialDeniedMarker() {
    try { require('fs').writeFileSync(getTrialDeniedPath(), String(Date.now()), 'utf8'); } catch (e) {}
}

// 试用期强制 config.edition=personal（标准版），用户角色=user
async function ensureTrialStandardEdition() {
    try {
        const fsSync = require('fs');
        const configPath = getWritableConfigPath();
        if (!fsSync.existsSync(configPath)) return false;
        const config = JSON.parse(fsSync.readFileSync(configPath, 'utf8'));
        // ★ 2026-09-26 H1/B1：校正会改 users 角色并重签，先验明来源（同上）
        // ★ 第四轮（J2）：闸门裁决本次读入的内存件（改写前状态，防 TOCTOU）。
        if (!licenseManager.configUsersProvenAuthentic(config)) {
            console.warn('[Trial] 跳过试用标准版校正：现存 users 无真实签发来源');
            return false;
        }
        let changed = false;
        if (config.edition !== 'personal') {
            console.log('[Trial] 试用期校正 edition:', config.edition, '->', 'personal');
            config.edition = 'personal';
            changed = true;
        }
        if (Array.isArray(config.users)) {
            for (const u of config.users) {
                if (u && u.role && u.role !== 'user') {
                    console.log('[Trial] 试用期校正用户角色:', u.username, u.role, '->', 'user');
                    u.role = 'user';
                    changed = true;
                }
            }
        }
        if (changed) {
            licenseManager.signConfig(config);
            fsSync.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
            // ★ 第四轮（B-重2）：改角色写盘后 proven 刷新备份（防旧角色备份回填提权）。
            try { licenseManager.backupUserAccounts(config, { proven: true }); } catch (_) {}
        }
        return true;
    } catch (e) {
        console.warn('[Trial] 试用期标准版校正异常（非致命）:', e.message);
        return false;
    }
}

// 服务端一次性试用登记：POST /api/trial/register
// 返回：{ allowed:true } 允许；{ denied:true, message } 次数超限；{ offline:true } 无网宽限本地试用
const TRIAL_REGISTER_API = 'https://tcm-prescription-system.pages.dev/api/trial/register';
async function registerTrialWithServer() {
    try {
        // ★ E2E 旁路（P3）：e2e 环境不向生产试用登记服务端发请求——
        //   ① 避免 e2e 反复跑机消耗真实设备试用次数；② 构建机可能已被登记导致 denied 误杀 e2e。
        //   返回 offline 宽限语义（与无网行为一致），本地试用照常发放。
        if (global.__BNZC_E2E_BYPASS === true) {
            console.warn('[E2E] 跳过服务端试用登记（e2e 旁路）');
            return { allowed: true, offline: true };
        }
        const hwFp = (licenseManager.getHardwareFingerprint && licenseManager.getHardwareFingerprint()) || '';
        if (!hwFp) return { allowed: true, offline: true };
        const machineId = (activateManager && activateManager.getMachineId) ? activateManager.getMachineId() : '';
        let cfg = {};
        try { cfg = JSON.parse(require('fs').readFileSync(getWritableConfigPath(), 'utf8')); } catch (e) {}
        const body = {
            hwFp,
            machineId,
            productName: cfg.productName || '惠康中医',
            edition: 'personal',
            appMode: cfg.appMode || 'offline'
        };
        const fetchPromise = async () => {
            const controller = new AbortController();
            const t = setTimeout(() => controller.abort(), 4000);
            try {
                const res = await fetch(TRIAL_REGISTER_API, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    signal: controller.signal
                });
                return await res.json();
            } finally { clearTimeout(t); }
        };
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 5000));
        const data = await Promise.race([fetchPromise(), timeoutPromise]);
        if (data && data.success && data.allowed === false) {
            return { denied: true, message: data.message || '该设备试用次数已达上限，请激活正式版' };
        }
        return { allowed: true, trialCount: data && data.trialCount };
    } catch (e) {
        // 无网/服务异常 → 宽限本地试用，联网后下次启动自动补报
        console.warn('[Trial] 试用登记失败（宽限本地试用）:', e.message);
        return { allowed: true, offline: true };
    }
}

async function saveLoginState(hasLoggedIn, user = null) {
    if (user) currentLoggedInUser = user;
    if (!hasLoggedIn) currentLoggedInUser = null;
    try {
        const settingsPath = path.join(app.getPath('userData'), 'login-state.json');
        const tmpPath = settingsPath + '.tmp';
        const payload = { hasLoggedIn, user, updatedAt: new Date().toISOString() };
        const jsonStr = JSON.stringify(payload, null, 2);
        // ★ P2-4: 使用 safeStorage 加密用户信息，防止明文泄露
        // safeStorage 不可用时回退明文（向后兼容）
        let fileContent;
        if (safeStorage.isEncryptionAvailable()) {
            const encrypted = safeStorage.encryptString(jsonStr);
            fileContent = 'ENC:' + encrypted.toString('base64');
        } else {
            fileContent = jsonStr;
        }
        await fs.writeFile(tmpPath, fileContent, 'utf8');
        await fs.rename(tmpPath, settingsPath);
    } catch (e) {
        console.error('保存登录状态失败:', e);
    }
}

// ============================================================================
//  CSP：禁止远程脚本、禁止内联事件
//  ★ 增加 media-src 'self' blob: 允许视频录制预览
// ============================================================================
function installCSP(sess) {
    sess.webRequest.onHeadersReceived((details, callback) => {
        const csp = [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' file:",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            "media-src 'self' blob:",          // 新增：允许 blob: 视频源
            "font-src 'self' data:",
            "connect-src 'self'",
            "object-src 'none'",
            "base-uri 'self'"
        ].join('; ');
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [csp]
            }
        });
    });
}

// ============================================================================
//  窗口创建 / DevTools 防护（B2-2 已抽至 desktop-windows.cjs 单一权威源）
//  focusWindow / getSharedWebPrefs / installDevToolsGuard / injectVideoRecorder /
//  createMainWindow / createLoginWindow —— 经 createDesktopWindows 工厂注入（接线
//  点在 updateManager 创建之后），状态经访问器回写本文件模块级变量。
// ============================================================================

// ============================================================================
//  ★ P1-A6 安全增强：DevTools 反调试 —— B2-2 已随窗口域抽至 desktop-windows.cjs
// ============================================================================

// ============================================================================
//  ★ 自定义协议 bnzc:// — 一键激活 URL Scheme
//  支持：bnzc://activate?code=BNZC-XXXX-XXXX-XXXX&clinic=诊所名
//  实现：
//    1. 单实例锁：软件运行时通过 second-instance 事件处理新链接
//    2. 注册 bnzc 为默认协议客户端（Windows 注册表关联）
//    3. 解析 process.argv（Windows/Linux）或 open-url 事件（macOS）
//    4. 将激活参数存入 pendingActivation，登录页自动检测并一键激活
// ============================================================================

// ★ 单实例锁 + second-instance 事件处理
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    console.log('[Bnzc] 已有实例运行，新实例退出（second-instance 将传递 URL）');
    app.quit();
    process.exit(0);
}

app.on('second-instance', (event, commandLine) => {
    console.log('[Bnzc] second-instance 事件, commandLine:', JSON.stringify(commandLine));
    try { require('fs').appendFileSync(path.join(app.getPath('userData'), 'bnzc-debug.log'), `[${new Date().toISOString()}] second-instance: ${JSON.stringify(commandLine)}\n`); } catch(e) {}
    for (const arg of commandLine) {
        if (arg && arg.startsWith('bnzc://')) {
            const parsed = parseBnzcUrl(arg);
            try { require('fs').appendFileSync(path.join(app.getPath('userData'), 'bnzc-debug.log'), `[${new Date().toISOString()}] parsed: ${JSON.stringify(parsed)}\n`); } catch(e) {}
            if (parsed) {
                _pendingActivation = parsed;
                console.log('[Bnzc] second-instance 捕获激活链接:', parsed.code);
                notifyPendingActivation(parsed);
            }
            break;
        }
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
    if (loginWindow && !loginWindow.isDestroyed()) {
        if (loginWindow.isMinimized()) loginWindow.restore();
        loginWindow.focus();
    }
});

// ★ 必须在 app.whenReady() 之前注册
// 开发模式下需要传入项目路径参数，否则 Windows 点击 bnzc:// 链接时只启动 electron.exe 但不加载项目
if (!app.isPackaged) {
    app.setAsDefaultProtocolClient('bnzc', process.execPath, [path.resolve(__dirname, '..')]);
    console.log('[Bnzc] 开发模式注册协议:', process.execPath, [path.resolve(__dirname, '..')]);
} else {
    app.setAsDefaultProtocolClient('bnzc');
}

// 存储待激活数据（通过 URL Scheme 传入）
let _pendingActivation = null;

// ★ 通知现有窗口有新的待激活数据
function notifyPendingActivation(parsed) {
    try { require('fs').appendFileSync(path.join(app.getPath('userData'), 'bnzc-debug.log'), `[${new Date().toISOString()}] notifyPendingActivation: code=${parsed.code}, mainWindow=${!!mainWindow && !mainWindow.isDestroyed()}, loginWindow=${!!loginWindow && !loginWindow.isDestroyed()}\n`); } catch(e) {}
    // 通知主窗口（已登录状态）
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.webContents) {
            mainWindow.webContents.send('bnzc:pending-activation', parsed);
            console.log('[Bnzc] 已通知主窗口 pending-activation');
        }
    }
    // 通知登录窗口（未登录状态）
    if (loginWindow && !loginWindow.isDestroyed()) {
        if (loginWindow.webContents) {
            loginWindow.webContents.send('bnzc:pending-activation', parsed);
            console.log('[Bnzc] 已通知登录窗口 pending-activation');
        }
    }
    // 如果都没有，创建登录窗口来处理
    if ((!mainWindow || mainWindow.isDestroyed()) && (!loginWindow || loginWindow.isDestroyed())) {
        console.log('[Bnzc] 无可用窗口，创建登录窗口处理激活');
        if (app.isReady()) {
            createLoginWindow();
        }
    }
}

// 从 process.argv 中拼接并提取 bnzc:// URL
// Windows 下命令行参数可能被 & 分割成多个片段，需要智能拼接
function extractBnzcFromArgv() {
    try {
        const argv = process.argv;
        // ★ 诊断日志：记录启动参数（定位"无反应"问题）
        try { require('fs').appendFileSync(path.join(app.getPath('userData'), 'bnzc-debug.log'), `[${new Date().toISOString()}] extractBnzcFromArgv START: argv=${JSON.stringify(argv)}\n`); } catch(e) {}
        // 先尝试找完整的 bnzc:// URL
        for (const arg of argv) {
            if (arg && arg.startsWith('bnzc://')) {
                // ★ 诊断日志：找到 bnzc:// 参数
                try { require('fs').appendFileSync(path.join(app.getPath('userData'), 'bnzc-debug.log'), `[${new Date().toISOString()}] found bnzc arg: ${arg}\n`); } catch(e) {}
                const parsed = parseBnzcUrl(arg);
                if (parsed) {
                    console.log('[Bnzc] 从命令行参数解析激活链接:', parsed.code);
                    try { require('fs').appendFileSync(path.join(app.getPath('userData'), 'bnzc-debug.log'), `[${new Date().toISOString()}] parsed OK: code=${parsed.code}\n`); } catch(e) {}
                    return parsed;
                }
                // 若首个片段无法独立解析，尝试拼接后续片段
                // 例: argv = ['electron', '.', 'bnzc://activate?code=XXX', 'clinic=YYY', 'user=ZZZ']
                let fullUrl = arg;
                for (let i = argv.indexOf(arg) + 1; i < argv.length; i++) {
                    const nextArg = argv[i];
                    if (nextArg && !nextArg.startsWith('-') && !nextArg.endsWith('.js') && !nextArg.endsWith('.cmd')) {
                        fullUrl += '&' + nextArg;
                    } else {
                        break;
                    }
                }
                console.log('[Bnzc] 拼接完整 URL:', fullUrl);
                const parsed2 = parseBnzcUrl(fullUrl);
                if (parsed2) {
                    console.log('[Bnzc] 从拼接 URL 解析激活链接:', parsed2.code);
                    return parsed2;
                }
            }
        }
        // ★ 诊断日志：遍历完 argv 但未找到 bnzc:// 参数
        try { require('fs').appendFileSync(path.join(app.getPath('userData'), 'bnzc-debug.log'), `[${new Date().toISOString()}] extractBnzcFromArgv: 未找到 bnzc:// 参数\n`); } catch(e) {}
    } catch (e) {
        try { require('fs').appendFileSync(path.join(app.getPath('userData'), 'bnzc-debug.log'), `[${new Date().toISOString()}] extractBnzcFromArgv 异常: ${e && e.message}\n`); } catch(e2) {}
    }
    return null;
}

// 解析 bnzc:// URL，提取激活参数
function parseBnzcUrl(rawUrl) {
    try {
        if (!rawUrl || typeof rawUrl !== 'string') return null;
        // Windows 下可能被引号包裹
        let url = rawUrl.trim().replace(/^"|"$/g, '');
        if (!url.startsWith('bnzc://')) return null;

        // bnzc://activate?code=XXX&clinic=YYY&user=ZZZ
        // 注意：Windows 可能传 bnzc://activate/?code=... (多一个 /)
        const pathPart = url.replace(/^bnzc:\/\//, '');
        const [routeRaw, queryStr] = pathPart.split('?');
        const route = routeRaw.replace(/\/+$/, ''); // 去掉尾部斜杠
        if (route !== 'activate') return null;

        const params = {};
        if (queryStr) {
            const pairs = queryStr.split('&');
            for (const pair of pairs) {
                const [k, v] = pair.split('=');
                if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || '');
            }
        }

        if (!params.code) return null;
        const result = {
            code: params.code.trim().toUpperCase(),
            clinicName: params.clinic ? decodeURIComponent(params.clinic) : '',
            user: params.user ? decodeURIComponent(params.user) : '',
            source: 'url-scheme',
            timestamp: Date.now()
        };
        console.log('[Bnzc] parseBnzcUrl 解析结果:', result);
        return result;
    } catch (e) {
        console.error('[Bnzc] parseBnzcUrl 失败:', e);
        return null;
    }
}

// macOS: open-url 事件
app.on('open-url', (event, url) => {
    event.preventDefault();
    const parsed = parseBnzcUrl(url);
    if (parsed) {
        _pendingActivation = parsed;
        console.log('[Bnzc] open-url 事件捕获激活链接:', parsed.code);
        notifyPendingActivation(parsed);
    }
});

// 启动时从 argv 检查
const _startupActivation = extractBnzcFromArgv();
if (_startupActivation) {
    _pendingActivation = _startupActivation;
}
// ★ 诊断日志：记录 _startupActivation 最终结果
try { require('fs').appendFileSync(path.join(app.getPath('userData'), 'bnzc-debug.log'), `[${new Date().toISOString()}] _startupActivation=${JSON.stringify(_startupActivation)}, _pendingActivation=${JSON.stringify(_pendingActivation)}\n`); } catch(e) {}

// ============================================================================
//  视频录制模块注入 —— B2-2 已随窗口域抽至 desktop-windows.cjs
// ============================================================================

// ★ 2026-09-13 更新器架构收口：检查/分片下载/装包逻辑全部在 update-manager.cjs
//   （shared/ 唯一权威源 → sync-all Group 12 分发 → copy-consistency 哈希门），
//   main.js 只保留渠道差异（检查地址 + 下载页锚点）与两个接线点：
//   dom-ready 调 updateManager.checkForUpdate(win)；setWindowOpenHandler 调 handleWindowOpen(url)。
const UPDATE_CHECK_URL = 'https://tcm-prescription-system.pages.dev/updates/local/latest.json';
const UPDATE_DOWNLOAD_URL = 'https://tcm-prescription-system.pages.dev/download?card=card-local-desktop';
const updateManager = require('./update-manager.cjs').createDesktopUpdateManager({
    checkUrl: UPDATE_CHECK_URL,
    downloadPageUrl: UPDATE_DOWNLOAD_URL,
    // ★ 2026-09-14 静默热更新（Ed25519 验签三道门禁，详见 shared/hot-update-core.cjs）
    hotUpdateUrl: 'https://tcm-prescription-system.pages.dev/hot-update/desktop/local'
});

// ★ 2026-09-13 B2-2 窗口域收口：createMainWindow/createLoginWindow/focusWindow 等 6 函数
//   抽至 desktop-windows.cjs（shared 唯一权威源 → sync-all Group 15 分发 → copy-consistency
//   哈希门）。状态经访问器注入：mainWindow/loginWindow/currentLoggedInUser 仍是本文件的
//   模块级变量（体外引用零改动），模块内经 get/set 读写保持同步。
const { createMainWindow, createLoginWindow, focusWindow } =
    require('./desktop-windows.cjs').createDesktopWindows({
        app, BrowserWindow, shell,
        updateManager,
        sendStartupHeartbeat,
        getCurrentLoggedInUser: () => currentLoggedInUser,
        getMainWindow: () => mainWindow,
        setMainWindow: (w) => { mainWindow = w; },
        getLoginWindow: () => loginWindow,
        setLoginWindow: (w) => { loginWindow = w; },
    });

// ★ 2026-09-14 P3-A 崩溃韧性补强：render-process-gone / child-process-gone 兜底
//   （shared/desktop-crash-guard.cjs 权威源，sync-all Group 18 分发）。主壳崩溃
//   自动销毁重建（登录态渲染层自恢复），60s 内 >=3 次熔断提示后自然退出；
//   clean-exit 过滤防正常关窗误报。窗口经访问器注入，不依赖 desktop-windows 内部。
require('./desktop-crash-guard.cjs').createDesktopCrashGuard({
    app, dialog, logger,
    createMainWindow, createLoginWindow,
    getMainWindow: () => mainWindow,
    setMainWindow: (w) => { mainWindow = w; },
    getLoginWindow: () => loginWindow,
    setLoginWindow: (w) => { loginWindow = w; },
});

// ★ 2026-09-09 下载转化统计：匿名启动心跳（管理后台「下载转化统计」数据源）。
//   隐私设计：机器码客户端 sha256 后上报（服务端再见不到原始机器码，且二次哈希存 KV），
//   不含 IP/手机号/任何个人信息；仅用于安装设备数去重统计。失败静默跳过，绝不影响主流程。
const TELEMETRY_HEARTBEAT_URL = 'https://tcm-prescription-system.pages.dev/api/telemetry/heartbeat';

// ★ 2026-09-11 P1 桌面完整性上报闭环：self-check 三路校验（exe 签名/.bnzc 区段/
//   asar 全文件）聚合为 integrityState（0-3，与安卓 verify.js 语义表对齐），启动
//   后延迟 25s 经 status 心跳通道上报（等 PowerShell 15s 超时窗 + asar 流式哈希完成）。
//   服务端仅对强信号（>=2 篡改证据）blockDevice 封锁在线能力；弱信号/失败仅审计。
//   非阻塞红线：上报失败/403 一律静默，本地使用不受影响（与安卓端同语义）。
const INTEGRITY_REPORT_URL = 'https://tcm-prescription-system.pages.dev/api/license/status';

async function reportDesktopIntegrity() {
    try {
        if (!app.isPackaged) return;
        // ★ 2026-09-23：E2E/打包链路（[7.8/9] pre-fuse）跑的是签名前的未签名
        //   win-unpacked exe，self-check 必然判 NotSigned=tampered → state=2，
        //   若用例活到 ready+25s 就会把【构建机自己的 machineId】上报封锁，
        //   导致正式包登录时 entitlement 403（今日事故）。E2E 环境信号无意义，
        //   直接跳过（BNZC_E2E=1 由 run-e2e.cjs spawn 注入）。
        if (process.env.BNZC_E2E === '1') return;
        const state = (selfCheck && selfCheck.getIntegrityState) ? selfCheck.getIntegrityState() : null;
        if (typeof state !== 'number') return;
        let mid = '';
        try {
            mid = (activateManager && activateManager.getMachineId) ? String(activateManager.getMachineId() || '') : '';
        } catch (e) { /* 机器码获取失败则跳过本次上报 */ }
        if (!mid) {
            console.log('[IntegrityReport] 上报跳过: 无机器码');
            return;
        }
        const res = await net.fetch(INTEGRITY_REPORT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ machineId: mid, integrityState: state, productClass: 'offline', clientClass: 'desktop' }),
            signal: AbortSignal.timeout(8000)
        });
        if (res.status === 403) {
            // 设备已被封锁（或本次强信号刚触发封锁）：在线能力卡死，本地使用不阻断（红线）
            console.warn('[IntegrityReport] 服务端拒绝（设备安全校验未通过），本地使用不受影响');
        } else {
            console.log('[IntegrityReport] 完整性状态已上报 state=' + state);
        }
    } catch (e) {
        console.log('[IntegrityReport] 上报跳过: ' + (e.message || e));
    }
}

async function sendStartupHeartbeat() {
    try {
        let mid = '';
        try {
            mid = (activateManager && activateManager.getMachineId) ? String(activateManager.getMachineId() || '') : '';
        } catch (e) { /* 机器码获取失败则跳过本次心跳 */ }
        if (!mid) {
            console.log('[telemetry] 心跳跳过: 无机器码');
            return;
        }
        const midHash = crypto.createHash('sha256').update('local-desktop:' + mid).digest('hex');
        await net.fetch(TELEMETRY_HEARTBEAT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ed: 'local-desktop', v: app.getVersion(), mid: midHash }),
            signal: AbortSignal.timeout(6000)
        });
        console.log('[telemetry] 启动心跳已上报 v' + app.getVersion());
    } catch (e) {
        console.log('[telemetry] 心跳跳过: ' + (e.message || e));
    }
}
// ★ createLoginWindow —— B2-2 已随窗口域抽至 desktop-windows.cjs（工厂注入）

// ★ P1-9 代码完整性校验：检测关键 JS 文件是否被篡改
// 原理：首次运行时计算关键文件 SHA256 哈希并存储为基线，后续启动重新计算并比对
// 防护效果：攻击者修改 auth-core.js / license-manager.js 绕过 license 校验时，哈希不匹配将阻止启动
// ★ P2-3 基线哈希使用 safeStorage（DPAPI）加密存储，攻击者无法直接伪造基线文件
// safeStorage 不可用时回退明文存储（向后兼容）
async function verifyCodeIntegrity() {
    const criticalFiles = [
        path.join(__dirname, 'auth-core.js'),
        path.join(__dirname, 'license-manager.js')
    ];
    // ★ 版本化基线：版本号变化时自动重建基线，避免升级后完整性校验误报
    const appVersion = app.getVersion();
    const baselinePath = path.join(app.getPath('userData'), 'integrity-v' + appVersion + '.dat');

    const hashes = [];
    for (const filePath of criticalFiles) {
        try {
            const content = await fs.readFile(filePath);
            const hash = crypto.createHash('sha256').update(content).digest('hex');
            hashes.push(hash);
        } catch (e) {
            console.warn('[Integrity] 读取文件失败，跳过:', filePath, e.message);
            return true;
        }
    }
    const combinedHash = crypto.createHash('sha256').update(hashes.join('|')).digest('hex');

    let baseline = null;
    try {
        const raw = await fs.readFile(baselinePath, 'utf8');
        const trimmed = raw.trim();
        if (trimmed.startsWith('ENC:')) {
            // ★ P2-3: 加密基线（safeStorage / DPAPI）
            try {
                if (safeStorage.isEncryptionAvailable()) {
                    const buf = Buffer.from(trimmed.slice(4), 'base64');
                    baseline = safeStorage.decryptString(buf);
                } else {
                    // safeStorage 不可用，无法解密旧基线 → 视为首次运行重建基线
                    baseline = null;
                }
            } catch (e) {
                console.warn('[Integrity] 基线解密失败，视为首次运行重建基线:', e.message);
                baseline = null;
            }
        } else {
            // 向后兼容：明文基线（旧版本写入）
            baseline = trimmed;
        }
    } catch (e) {
        // 基线文件不存在，首次运行
    }

    if (!baseline) {
        // 首次运行：存储当前哈希作为基线（优先加密存储）
        try {
            if (safeStorage.isEncryptionAvailable()) {
                const encrypted = safeStorage.encryptString(combinedHash);
                await fs.writeFile(baselinePath, 'ENC:' + encrypted.toString('base64'), 'utf8');
                console.log('[Integrity] 首次运行，已建立加密完整性基线');
            } else {
                // safeStorage 不可用，回退明文存储（向后兼容）
                await fs.writeFile(baselinePath, combinedHash, 'utf8');
                console.log('[Integrity] 首次运行，已建立明文完整性基线（safeStorage 不可用）');
            }
        } catch (e) {
            console.warn('[Integrity] 无法写入基线文件:', e.message);
        }
        return true;
    }

    if (baseline === combinedHash) {
        console.log('[Integrity] 代码完整性校验通过');
        return true;
    }

    console.warn('[Integrity] 代码完整性校验不匹配，自动重建基线（版本升级或重新打包场景）');
    console.warn('[Integrity] 基线:', baseline.substring(0, 16) + '...');
    console.warn('[Integrity] 当前:', combinedHash.substring(0, 16) + '...');
    try {
        if (safeStorage.isEncryptionAvailable()) {
            const encrypted = safeStorage.encryptString(combinedHash);
            await fs.writeFile(baselinePath, 'ENC:' + encrypted.toString('base64'), 'utf8');
        } else {
            await fs.writeFile(baselinePath, combinedHash, 'utf8');
        }
        console.log('[Integrity] 基线已自动重建');
    } catch (e) {
        console.warn('[Integrity] 无法重建基线:', e.message);
    }
    return true;
}

app.whenReady().then(async () => {
    // ★ P0-③ exe 签名/完整性自校验（非阻塞，仅记录，不影响启动流程）
    selfCheck.runSelfCheck();
    // ★ 2026-09-11 P1 完整性上报：延迟 25s 等三路校验落定后聚合上报（篡改证据
    //   优先于未完成——getIntegrityState 聚合逻辑保证 strong 信号不等 PowerShell）
    setTimeout(reportDesktopIntegrity, 25000);

    // ★ 2026-08-29 启动即建媒体专属文件夹（安装盘根目录\惠康中医媒体\downloads），
    //   用户安装后打开盘符即可看到，无需等首次拍照才创建（失败静默，运行时保存会再兜底）
    try { getDownloadsDirectory(); } catch (e) { console.warn('[Media] 启动建目录失败:', e.message); }

    // ★ 2026-08-29 v3 数据集中：启动建 data 目录并自动迁移旧位置数据文件（不阻塞启动，失败静默）
    try { await migrateLegacyDataToCentral(); } catch (e) { console.warn('[Data] 启动迁移异常:', e.message); }

    // ★ 首次启动时将 config.json 从 asar 复制到可写路径
    await ensureWritableConfig();

    // ★ 首次启动版本选择（统一安装包，试用前确定标准版/机构版）
    await ensureEditionSelected();
    
    // ★ 离线版：License 授权校验（启动时校验）
    // 离线版流程：无 license 时进入试用模式（默认7天），试用有效直接进登录；
    // 试用到期且未激活时弹双按钮到期提示（前往激活/退出软件）
    let licenseResult;
    let _isLicensed = false;
    try {
        const localMachineId = activateManager.getMachineId();
        licenseResult = licenseManager.validateLicense({ localMachineId });
        _isLicensed = licenseResult.valid;
        console.log('[License]', licenseResult.type, licenseResult.message);
    } catch (e) {
        // ★ P0修复：异常时拒绝启动（禁止降级为无限试用）
        // 原逻辑：异常降级为 {valid:true, type:'trial'}，且发生在下方 denied 检查之前，
        // 攻击者损坏 trial.dat 触发异常 + 断网即可绕过试用次数限制无限试用。
        // 现改为拒绝启动并引导重新激活（重新激活会重建 license.dat/trial.dat）。
        console.error('[License] validateLicense exception:', e.message);
        licenseResult = {
            valid: false,
            type: 'license_error',
            message: '激活信息校验异常，请重新激活软件。'
        };
        _isLicensed = false;
    }

    // ★ 版本绑定：存在正式 license 时强制校正 config.edition 与激活码版本一致
    try {
        const binding = licenseManager.enforceEditionBinding();
        if (binding && binding.success && binding.corrected) {
            console.log('[License] 启动版本绑定已校正:', binding.edition);
        }
    } catch (e) {
        console.warn('[License] 启动版本绑定校验失败（非致命）:', e.message);
    }

    // ★ 2026-09-23 P2-2：心跳不再在启动时立即执行（旧逻辑会在用户看登录窗时
    //   无提示退出）。改为登录成功后启动（见 'login-success' handler）；登录窗
    //   阶段的吊销由登录闸门给可读提示拦截。

    // ★ 2026-08-17关键修复：任何未授权状态（试用/过期/未激活/异常）都强制校正为标准版
    //   （机构版仅在正式激活后生效）防止旧安装包残留的机构版 edition 与实际试用状态不一致
    if (licenseResult && !_isLicensed) {
        try {
            await ensureTrialStandardEdition();
        } catch (e) {
            console.warn('[Trial] 未授权状态下标准版校正异常（非致命）:', e.message);
        }
    }

    // ★ 试用固定标准版 + 服务端一次试用登记（防卸载重装刷试用）
    if (licenseResult && licenseResult.type === 'trial' && _isLicensed) {
        try {
            await ensureTrialStandardEdition();
            if (isTrialDenied()) {
                console.warn('[Trial] 本机试用资格已被服务端锁定');
                licenseResult = {
                    valid: false,
                    message: '该设备已完成一次试用且已过期，请激活正式版。',
                    type: 'trial_limit_reached'
                };
                _isLicensed = false;
            } else {
                const reg = await registerTrialWithServer();
                if (reg && reg.denied) {
                    writeTrialDeniedMarker();
                    console.warn('[Trial] 服务端判定试用次数超限，已锁定本机试用');
                    licenseResult = {
                        valid: false,
                        message: reg.message || '该设备试用次数已达上限，请激活正式版',
                        type: 'trial_limit_reached'
                    };
                    _isLicensed = false;
                }
            }
        } catch (e) {
            console.warn('[Trial] 试用登记异常（非致命，继续试用）:', e.message);
        }
    }

    fse.ensureDirSync(getDownloadsDirectory());

    sharedSession = session.fromPartition(SESSION_PARTITION);
    installCSP(sharedSession);

    // ★ 授予 camera/microphone 权限
    sharedSession.setPermissionRequestHandler((webContents, permission, callback) => {
        if (permission === 'media' || permission === 'camera' || permission === 'microphone') {
            callback(true);
        } else {
            callback(false);
        }
    });

    // 在主窗口创建前预先授权
    if (sharedSession.setDevicePermissionHandler) {
        sharedSession.setDevicePermissionHandler((details) => {
            if (details.deviceType === 'videoinput' || details.deviceType === 'audioinput') {
                return true;
            }
            return false;
        });
    }

    // 处理渲染进程触发的文件下载（exportData 备份等）
    sharedSession.on('will-download', (event, item, webContents) => {
        try {
            const fileName = sanitizeFileName(item.getFilename());
            const filePath = path.join(getDownloadsDirectory(), fileName);
            item.setSavePath(filePath);
            item.once('done', () => {
                if (webContents && !webContents.isDestroyed()) {
                    webContents.executeJavaScript(`showToast('备份文件已保存到 downloads/${fileName}');`).catch(() => {});
                }
            });
        } catch (e) {
            console.error('下载处理失败:', e);
        }
    });

    // ★ 2026-09-03 启动断点续传（admin-request-id.dat 主进程检查）：
    //   桌面独立登录窗口 login.html 不加载 auth-core，index.html 的 resumeAdminPendingRequest
    //   只有登录成功后才跑；客户提交申请→切官网付款被切后台→轮询中断，重启后若未激活
    //   则 showExpireAlertAndActivate 弹激活窗但用户不打开 Tab1 管理员激活表单时，
    //   状态申请永远不被自动完成；若已激活则 admin-request-id.dat 中 phone/密码(加密)已存，
    //   主进程直接调 licenseManager.installLicense（=写license.dat+写config.users+自签），
    //   确保 config.json 在 createLoginWindow 前已有手机号用户（login.js getAppConfig 读到）。
    //   password 按 activate.js 相同的 decryptSensitive（safeStorage ENC:）解密；
    //   解密失败/空则退 admin 兜底；不阻塞启动（超时 10s）。
    try {
        const savedReq = activateManager.loadAdminRequestId();
        if (savedReq && savedReq.requestId) {
            const mid = activateManager.getMachineId() || '';
            const _pCheck = activateManager.checkAdminStatus(savedReq.requestId, mid);
            const _pTimeout = new Promise((resolve) => setTimeout(() => resolve(null), 10000));
            const sr = await Promise.race([_pCheck, _pTimeout]);
            if (sr && sr.success && sr.status === 'activated' && sr.license) {
                try {
                    // 解密 savedReq.password（activate.js saveAdminRequestId 已用 safeStorage 加密 ENC:）
                    let pwd = '';
                    try {
                        const pe = savedReq.password || '';
                        const { safeStorage } = require('electron');
                        if (pe && pe.startsWith('ENC:') && safeStorage && safeStorage.isEncryptionAvailable()) {
                            pwd = safeStorage.decryptString(Buffer.from(pe.slice(4), 'base64')) || '';
                        }
                    } catch (de) { console.warn('[License] 断点续传解密密码失败(退admin):', de.message); pwd = ''; }
                    const li = sr.licenseInfo || {};
                    const licInst = licenseManager.installLicense(sr.license, {
                        machineId: mid,
                        doctorName: savedReq.adminName || li.user || '',
                        clinicName: savedReq.clinicName || li.clinicName || '',
                        phone: savedReq.phone || li.phone || '',
                        password: pwd || 'admin',
                        edition: savedReq.edition || ''
                    });
                    if (licInst && licInst.success) {
                        console.log('[License] 启动断点续传: 已审核通过+自动安装license+建号完成（requestId=' + savedReq.requestId + ' phone=' + (savedReq.phone || '') + '）');
                        activateManager.clearAdminRequestId();
                        // 重新校验 license（刚写入）
                        const newMid = activateManager.getMachineId();
                        const newLic = licenseManager.validateLicense({ localMachineId: newMid });
                        if (newLic && newLic.valid) {
                            _isLicensed = true;
                            licenseResult = newLic;
                            try {
                                const b = licenseManager.enforceEditionBinding();
                                if (b && b.success && b.corrected) console.log('[License] 断点续传后版本校正:', b.edition);
                            } catch (be) {}
                            if (newLic.type !== 'trial') {
                                try { await ensureTrialStandardEdition(); } catch (te) {}
                            }
                        }
                    } else {
                        console.warn('[License] 启动断点续传installLicense失败（交给渲染进程兜底）:', licInst && licInst.error);
                    }
                } catch (srErr) {
                    console.warn('[License] 启动断点续传安装失败（非致命，交给渲染进程兜底）:', srErr.message);
                }
            }
        }
    } catch (e) {
        console.warn('[License] 启动断点续传异常（非致命，交给渲染进程）:', e.message);
    }

    // ★ 离线版流程：license 有效（含试用）直接进登录；
    //   试用到期/试用超限 → 只读模式放行（可登录查看历史数据，渲染层横幅引导激活，
    //     原生 canPrescribe 禁开方，savePrescription 守卫双保险）——2026-09-05；
    //   其他失效（正式授权过期/设备不符/校验异常）→ 弹到期提示（前往激活/退出）
    if (!_isLicensed) {
        const __roType = licenseResult ? licenseResult.type : '';
        if (__roType === 'trial_expired' || __roType === 'trial_limit_reached') {
            console.log('[License] 试用到期/超限（' + __roType + '）→ 只读模式进入登录');
            createLoginWindow();
        } else {
            console.log('[License] 未授权，弹出到期提示（前往激活/退出）');
            await activateManager.showExpireAlertAndActivate(null, licenseResult.message);
            return;
        }
    } else {
        createLoginWindow();
    }

    app.on('activate', () => {
        const allWindows = BrowserWindow.getAllWindows();
        if (allWindows.length === 0) {
            createLoginWindow();
        } else {
            if (loginWindow && !loginWindow.isDestroyed()) {
                focusWindow(loginWindow);
            } else if (mainWindow && !mainWindow.isDestroyed()) {
                focusWindow(mainWindow);
            }
        }
    });
});

// ============================================================================
//  IPC handlers
// ============================================================================

require('./desktop-license-ipc.cjs').createDesktopLicenseIpc({
    ipcMain, app, dialog, BrowserWindow,
    licenseManager, activateManager, prescriptionCounter, featureGuard,
    getMainWindow: () => mainWindow,
    productClass: 'offline',
    isTrialDenied,
    fse, safeStorage, path, getWritableConfigPath, hashPassword
});

// ★ 同步 alert/confirm 对话框（替代原生 window.alert/window.confirm）
// ★ 2026-09-14 P3-A 对话框域收口：dialog:alert-sync / dialog:confirm-sync /
//   dialog:prompt 三 handler 抽至 desktop-dialog.cjs（shared/ 权威源，sync-all
//   Group 17 分发，与 prompt-modal.html / prompt-preload.js 同组同位）。
//   历史注释归档：原生 alert 光标 bug 经 showMessageBoxSync 规避、prompt 经
//   prompt-modal.html 模态窗实现（loadFile 保 asar 兼容）——详见权威源头注释。
//   端差异仅 prompt 窗 title，经工厂入参注入；窗口引用经访问器注入（B2-2 同款）。
require('./desktop-dialog.cjs').createDesktopDialogIpc({
    ipcMain, dialog, BrowserWindow,
    getMainWindow: () => mainWindow,
    promptTitle: '惠康中医诊所管理系统 V1.0.0'
});

// ===================== 安全存储（safeStorage）=====================
// P0-2: 使用 Electron safeStorage API（基于 Windows DPAPI）加密敏感数据
// 替代旧的硬编码盐值 XOR 加密（PWDv1/PWDv2）
// 数据仅在当前用户/机器可解密，复制到其他机器无效
ipcMain.handle('auth:safeStorageAvailable', () => {
    try {
        return safeStorage.isEncryptionAvailable();
    } catch (e) {
        console.error('safeStorage 检测失败:', e);
        return false;
    }
});

// 加密字符串 -> 返回 base64（前缀 'SAFE:' 由调用方添加）
ipcMain.handle('auth:encryptString', (event, plaintext) => {
    try {
        if (!plaintext) return null;
        if (!safeStorage.isEncryptionAvailable()) return null;
        const buf = safeStorage.encryptString(String(plaintext));
        return buf.toString('base64');
    } catch (e) {
        console.error('safeStorage 加密失败:', e);
        return null;
    }
});

// 解密 base64 字符串 -> 返回明文（失败返回 null）
ipcMain.handle('auth:decryptString', (event, encryptedBase64) => {
    try {
        if (!encryptedBase64) return null;
        if (!safeStorage.isEncryptionAvailable()) return null;
        const buf = Buffer.from(String(encryptedBase64), 'base64');
        return safeStorage.decryptString(buf);
    } catch (e) {
        console.error('safeStorage 解密失败:', e);
        return null;
    }
});

// ===== 🔧 历史处方修复 IPC ①：从 config.json 拿到 wgj 用户的 token（全局兜底云端 API 认证） =====
ipcMain.handle('config:get-force-token', async () => {
    try {
        const configPath = getWritableConfigPath();
        if (await fse.pathExists(configPath)) {
            const cfg = await fse.readJson(configPath);
            if (cfg && Array.isArray(cfg.users)) {
                const w = cfg.users.find(u => u && u.username === 'wgj');
                if (w && w.token) return { success: true, token: w.token, user: w };
            }
        }
    } catch(e) {}
    return { success: false };
});

// 登录成功：保存用户、关闭登录窗口、打开主窗口
ipcMain.handle('login-success', async (event, userData) => {
    try {
        await saveLoginState(true, userData);
        if (loginWindow && !loginWindow.isDestroyed()) {
            loginWindow.close();
        }
        if (!mainWindow || mainWindow.isDestroyed()) {
            createMainWindow();
        }
        // ★ 2026-09-23 P2-2：登录成功后再启动周期心跳（首次立即执行时主窗口
        //   已在；REVOKED/EXPIRED/NO_LICENSE 退出均有登录闸门在前兜底，不会
        //   在登录窗阶段无提示消失）。
        try { licenseManager.startHeartbeat(); } catch (e) {
            console.warn('[License] 心跳启动失败（非致命）:', e.message);
        }
        return { success: true };
    } catch (e) {
        console.error('登录成功处理失败:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('get-current-user', async () => {
    return currentLoggedInUser;
});

// 读取 index.html 同目录下的 config.json；如不存在，则使用内置默认值
ipcMain.handle('get-app-config', async () => {
    const defaults = {
        clinicName: '本能堂中医诊所',
        doctorName: '本能堂',
        // ★ 2026-08-17：统一安装包默认 edition 改为 personal（离线标准版），
        //   机构版仅限正式激活后由 enforceEditionBinding 校正为 custom/clinic_custom；
        //   避免未授权态默认机构版导致试用 admin 缺【修改密码】按钮。
        edition: 'personal',
        productName: '惠康中医-本地'
    };
    try {
        const configPath = getWritableConfigPath();
        if (await fse.pathExists(configPath)) {
            const cfg = await fse.readJson(configPath);
            // ★ P3-预防重装：账号独立备份 刷新+回填
            // 每次读取配置时把当前账号备份到 users-backup.json；
            // 若 config 的 users 被清除，则从备份回填，避免原账号密码无法登入。
            try {
                if (Array.isArray(cfg.users) && cfg.users.length > 0) {
                    // ★ 2026-09-26 阻断修复（三审共识·备份毒化链 + 复审 TOCTOU）：
                    //   只有验明来源的内存件 users 才允许刷新备份——旧逻辑在任何
                    //   license 校验之前无条件备份，应用自身会给未验签 users 签出合法
                    //   v2 备份，攻击者再删 config 签名即可凭毒化备份通过闸门、重签洗白。
                    if (licenseManager.configUsersProvenAuthentic(cfg)) {
                        licenseManager.backupUserAccounts(cfg);
                    } else {
                        console.warn('[Config] users 来源未证明，跳过备份刷新（防毒化）');
                    }
                } else {
                    // 回填统一走 getFillableUsers：仅新鲜 v2 / v1 合法件窗口内 legacy
                    const fillUsers = licenseManager.getFillableUsers();
                    if (fillUsers.length > 0) cfg.users = fillUsers;
                }
            } catch (e) {
                console.warn('账号备份刷新失败（非致命）:', e.message);
            }
            let merged = { ...defaults, ...cfg };
            // ★ 授权身份判定：正式机构版/正式标准版/未授权(含试用)
            //   用 validateLicense(机器码绑定) + license.type 判断是否"正式机构版"。
            //   ★ 2026-08-18 重构：原"产品级永久绑定 if(true) 无条件强制=标准版"已废弃，
            //     因为离线桌面现支持机构版（管理员激活）。仅"未正式授权或非机构版"才强制标准版，
            //     正式机构版保留 clinic 版与 admin 角色（否则机构版激活后仍被打成标准版）。
            let formalValid = false;
            let formalInstitution = false;
            let formalCheckLic = null;
            try {
                const mid = (activateManager && activateManager.getMachineId) ? activateManager.getMachineId() : '';
                formalCheckLic = licenseManager.validateLicense({ localMachineId: mid });
                formalValid = !!(formalCheckLic && formalCheckLic.valid);
                if (formalValid) {
                    const lh = licenseManager.readLicense();
                    // ★ 2026-09-06 机构类 type 对齐 APP 端/装码绑定核心（license-manager
                    //   INSTITUTIONAL_LICENSE_TYPES）：pro/institution/clinic/clinic_custom。
                    //   原仅 pro/institution 两值，服务端其他机构类码（clinic/clinic_custom）
                    //   会被误判标准版 → 强制 personal + admin 降级 → 【用户管理】消失。
                    formalInstitution = !!(lh && lh.type && ['pro', 'institution', 'clinic', 'clinic_custom'].indexOf(String(lh.type).toLowerCase()) >= 0);
                }
            } catch (e) {
                console.warn('[Config] 授权身份判定失败（保守按未授权）:', e.message);
            }

            // ★ 2026-08-18 自愈：正式授权已装但激活手机号账户缺失/密码为空 → 用持久化的
            //   激活手机号补齐账户（默认密码 admin），确保"已激活即可用 手机号+admin 登入"。
            //   仅当正式授权且机器上留有激活手机号时才触发，绝不覆盖用户已改的密码。
            try {
                if (formalValid) {
                    const acctPhone = (activateManager && activateManager.loadAdminAccountPhone)
                        ? await activateManager.loadAdminAccountPhone()
                        : '';
                    if (acctPhone) {
                        if (!Array.isArray(cfg.users)) cfg.users = [];
                        let acctUser = cfg.users.find(u => u && (u.username === acctPhone || (u.phone && String(u.phone) === acctPhone)));
                        const wantRole = formalInstitution ? 'admin' : 'user';
                        const needHeal = !acctUser || !acctUser.password;
                        if (needHeal) {
                            // ★ 复审 TOCTOU：闸门在 mutate【之前】裁决同一内存件
                            // （新账号来源=已验签 admin-account.dat；先 mutate 会让
                            // users 签名失配，本块永远落不了盘）。
                            const __proven = licenseManager.configUsersProvenAuthentic(cfg);
                            const { passwordHash, salt } = await hashPassword('admin');
                            const healedUser = {
                                username: acctPhone,
                                password: passwordHash,
                                passwordHash,
                                salt,
                                name: cfg.doctorName || acctPhone,
                                role: wantRole,
                                createdAt: new Date().toISOString()
                            };
                            if (acctUser) {
                                acctUser.password = passwordHash;
                                acctUser.passwordHash = passwordHash;
                                acctUser.salt = salt;
                                acctUser.role = wantRole;
                            } else {
                                cfg.users.push(healedUser);
                            }
                            // 写入磁盘（需闸门通过+签名成功，否则跳过写入保留原配置）
                            try {
                                const writeCfg = { ...cfg };
                                licenseManager.signConfig(writeCfg);
                                if (__proven && writeCfg.configSignature) {
                                    await fse.writeJson(configPath, writeCfg, { spaces: 2 });
                                    try { licenseManager.backupUserAccounts(writeCfg, { proven: true }); } catch (e2) {}
                                    console.log('[Config] 自愈：已补齐激活管理员账户 (手机号=' + acctPhone + ', 角色=' + wantRole + ')');
                                } else if (!__proven) {
                                    // ★ 2026-09-26 I-1：防未验签 users 借本块重签洗白
                                    console.warn('[Config] users 来源未证明，激活账号补齐不落盘');
                                }
                            } catch (we) {
                                console.warn('[Config] 自愈写 config 失败（非致命）:', we.message);
                            }
                        }
                    }
                    // ★ 2026-08-18 兜底：无激活手机号记录（旧版激活/已装机器无 admin-account.dat）时，
                    //   机构版下若存在"密码为空/缺失"的 admin 账户 → 兜底重置为 admin（仅重设空密码账户，
                    //   绝不覆盖用户已设的非空密码；普通只读 user 账户不受影响）。
                    if (formalInstitution && !acctPhone) {
                        if (Array.isArray(cfg.users)) {
                            // ★ 复审 TOCTOU：先查有无目标、闸门裁决内存件，再 mutate。
                            const hasEmptyAdmin = cfg.users.some(u => u && u.role === 'admin' && !u.password);
                            if (hasEmptyAdmin) {
                                const __proven = licenseManager.configUsersProvenAuthentic(cfg);
                                for (const u of cfg.users) {
                                    if (u && u.role === 'admin' && !u.password) {
                                        const { passwordHash, salt } = await hashPassword('admin');
                                        u.password = passwordHash;
                                        u.passwordHash = passwordHash;
                                        u.salt = salt;
                                    }
                                }
                                try {
                                    const writeCfg = { ...cfg };
                                    licenseManager.signConfig(writeCfg);
                                    if (__proven && writeCfg.configSignature) {
                                        await fse.writeJson(configPath, writeCfg, { spaces: 2 });
                                        try { licenseManager.backupUserAccounts(writeCfg, { proven: true }); } catch (e2) {}
                                        console.log('[Config] 自愈兜底：机构版空密码 admin 账户已重置为 admin');
                                    } else if (!__proven) {
                                        console.warn('[Config] users 来源未证明，空密码兜底不落盘');
                                    }
                                } catch (we) {
                                    console.warn('[Config] 自愈兜底写 config 失败（非致命）:', we.message);
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn('[Config] 账户自愈异常（非致命）:', e.message);
            }

            // ★ 未正式授权(过期/异常/试用/空)或非机构版 → 强制标准版(personal) + 管理员降级为 user
            //  （保留原试用兜底：试用 admin 缺【修改密码】按钮的基础行为由此处保证）
            try {
                if (!formalInstitution) {
                    merged.edition = 'personal';
                    let downgradedCount = 0;
                    if (Array.isArray(merged.users)) {
                        for (const u of merged.users) {
                            if (u && (u.role === 'admin' || u.role === 'clinic_admin')) {
                                u.role = 'user';
                                downgradedCount++;
                            }
                        }
                    }
                    merged.productName = '惠康中医-本地';
                    console.log('[Config] 非机构版/未授权：强制标准版(personal) edition=personal。admin降级数=' + downgradedCount);
                } else if (formalValid) {
                    // ★★★ 2026-09-07 存量机器自愈（机构版激活后仍显示【修改密码】而非【用户管理】）：
                    //   旧逻辑本分支只"不降级"、从不上调——2026-09-06 装码绑定修复上线前激活的
                    //   机器，installLicense 从不写 config.edition → 磁盘 config.json 永远停留
                    //   出厂 personal → get-app-config 原样返回 personal → 渲染层
                    //   Permission._isStandardEditionForced()=true + enforceStandardEditionButtons
                    //   权威模式持续强制 → 机构版管理员【用户管理】错显为【修改密码】
                    //   （实测：授权状态已显示"已激活（机构版）剩余365天"但按钮仍是标准版）。
                    //   修复：复用 applyEditionBindingToConfig（与装码即绑定同一核心）：
                    //   ① edition 上调为机构版（离线 clinic / 云端 cloud_clinic）；
                    //   ② 保证至少一名 admin（防管理入口锁死）；
                    //   ③ 发生校正则签名后回写磁盘固化（重启/刷新不再回退）。
                    //   注：cfg 与 merged.users 共享同一数组引用，角色提升自动同步到 merged。
                    try {
                        const lh = licenseManager.readLicense();
                        if (lh) {
                            // ★ 复审 TOCTOU：闸门在 applyEditionBinding【之前】裁决内存件
                            // （apply 会改 edition/补 admin，先 mutate 签名就失配）。
                            const __proven = licenseManager.configUsersProvenAuthentic(cfg);
                            const bind = licenseManager.applyEditionBindingToConfig(lh, cfg);
                            if (bind.applied) {
                                merged.edition = cfg.edition;
                                if (bind.corrected) {
                                    const writeCfg = { ...cfg };
                                    licenseManager.signConfig(writeCfg);
                                    if (__proven && writeCfg.configSignature) {
                                        await fse.writeJson(configPath, writeCfg, { spaces: 2 });
                                        try { licenseManager.backupUserAccounts(writeCfg, { proven: true }); } catch (e2) {}
                                        console.log('[Config] 存量自愈：机构版 config.json 已固化 edition=' + cfg.edition +
                                            '（from=' + (bind.from || '?') + '）');
                                    } else {
                                        console.warn('[Config] 存量自愈：闸门/签名未过，仅本次会话生效（磁盘未固化）');
                                    }
                                }
                            }
                        }
                    } catch (he) {
                        console.warn('[Config] 机构版存量自愈失败（非致命，返回值已含磁盘原值）:', he.message);
                    }
                }
            } catch (e) {
                console.warn('[Config] 标准版兜底失败（非致命，保守走标准版）:', e.message);
                merged.edition = 'personal';
            }

            return { success: true, config: merged };
        }
    } catch (e) {
        console.error('读取 config.json 失败:', e);
        // ★ 2026-09-22 A2 修复：config.json 存在但 JSON 损坏（readJson 解析抛错）时，
        //   尝试从 users-backup.json 回填账号——否则老客户 config 损坏叠加
        //   localStorage 为空（userData 迁移/被清）会被强制重新注册。
        try {
            // 仅回填可信备份（新鲜 v2；config 已损坏不再接受无签名 legacy）
            const fillUsers = licenseManager.getFillableUsers();
            if (fillUsers.length > 0) {
                defaults.users = fillUsers;
                console.log('[Config] config.json 损坏，已从可信备份回填账号 '
                    + fillUsers.length + ' 个');
            }
        } catch (be) {
            console.warn('[Config] 备份回填失败（非致命）:', be.message);
        }
    }
    return { success: true, config: defaults };
});

// ===== 首次配置向导：更新 config.json =====
ipcMain.handle('config:update', async (event, updates) => {
    try {
        // ★ 2026-09-26 H1/B1 + 复审 TOCTOU：config 只读一次，闸门裁决内存件，
        // 防篡改/植入 users 经配置向导洗白。出厂空 config 自然通过。
        const configPath = getWritableConfigPath();
        let config = {};
        if (await fse.pathExists(configPath)) {
            config = await fse.readJson(configPath);
        }
        if (!licenseManager.configUsersProvenAuthentic(config)) {
            console.warn('[Config] config:update 中止：现存 users 无真实签发来源');
            return { success: false, error: '检测到本地配置被篡改，设置已中止，请联系客服' };
        }
        if (updates.clinicName !== undefined) config.clinicName = updates.clinicName;
        if (updates.doctorName !== undefined) config.doctorName = updates.doctorName;
        if (updates.title !== undefined) config.title = updates.title;
        // 签名保护：signConfig(config) 直接修改原对象，切勿将返回值赋值给属性（会造成循环引用）
        licenseManager.signConfig(config);
        await fse.writeJson(configPath, config, { spaces: 2 });
        // users 未变；proven 刷备份保持新鲜
        try { licenseManager.backupUserAccounts(config, { proven: true }); } catch (e2) {}
        console.log('[Config] config.json updated:', JSON.stringify(updates));
        return { success: true, config };
    } catch (e) {
        console.error('[Config] config:update failed:', e);
        return { success: false, error: String(e) };
    }
});

// ===== 打开激活窗口 =====
ipcMain.handle('showActivationWindow', async () => {
    try {
        if (activateManager && typeof activateManager.showActivateWindow === 'function') {
            activateManager.showActivateWindow(loginWindow);
            return { success: true };
        }
        // fallback：通过菜单触发
        return { success: false, error: 'activateManager 不可用' };
    } catch (e) {
        console.error('[Activate] showActivationWindow failed:', e);
        return { success: false, error: String(e) };
    }
});

require('./desktop-user-ipc.cjs').createDesktopUserIpc({
    ipcMain, fse, path, licenseManager,
    getWritableConfigPath, getDataDirectory, hashPassword,
    productClass: 'offline'
});

async function hashPassword(password) {
    const crypto = require('crypto');
    // ★ 2026-09-25 安全加固：常量盐单轮 SHA-256 → PBKDF2-SHA256 慢哈希
    //   600000 轮（OWASP 2025/2026 PBKDF2-SHA256 基线）+ 每密码 16 字节随机盐；
    //   存储格式（AuthCore.verifyPassword 同栈识别）：
    //   pbkdf2_sha256$<iterations>$<saltHex>$<derivedKeyHex>
    const iterations = 600000;
    const saltBuf = crypto.randomBytes(16);
    const dk = crypto.pbkdf2Sync(String(password), saltBuf, iterations, 32, 'sha256');
    const stored = 'pbkdf2_sha256$' + iterations + '$' + saltBuf.toString('hex') + '$' + dk.toString('hex');
    return {
        passwordHash: stored,
        salt: saltBuf.toString('hex')
    };
}

// ============================================================================
//  ★ bnzc:// 一键激活 — IPC 处理器
// ============================================================================

// 查询是否有待激活数据（来自 URL Scheme）
ipcMain.handle('bnzc:get-pending-activation', () => {
    try {
        console.log('[Bnzc] get-pending-activation: _pendingActivation =', JSON.stringify(_pendingActivation));
        try { require('fs').appendFileSync(path.join(app.getPath('userData'), 'bnzc-debug.log'), `[${new Date().toISOString()}] IPC get-pending-activation called, _pendingActivation=${JSON.stringify(_pendingActivation)}\n`); } catch(e) {}
        return { success: true, data: _pendingActivation };
    } catch (e) {
        console.error('[Bnzc] get-pending-activation 异常:', e);
        try { require('fs').appendFileSync(path.join(app.getPath('userData'), 'bnzc-debug.log'), `[${new Date().toISOString()}] IPC get-pending-activation ERROR: ${e && e.message}\n`); } catch(e2) {}
        return { success: false, error: String(e) };
    }
});

// 清除待激活数据（激活完成或用户放弃时调用）
ipcMain.handle('bnzc:clear-pending-activation', () => {
    try {
        console.log('[Bnzc] clear-pending-activation');
        _pendingActivation = null;
        return { success: true };
    } catch (e) {
        console.error('[Bnzc] clear-pending-activation 异常:', e);
        return { success: false, error: String(e) };
    }
});

// ★ 一键激活核心：接收激活码 + 诊所名，直接走激活流程
// 调用方：登录页检测到 bnzc:// 传来的参数后自动调用
ipcMain.handle('bnzc:auto-activate', async (event, { code, clinicName, user }) => {
    try {
        console.log('[Bnzc] auto-activate 调用:', { code, clinicName, user });
        try { require('fs').appendFileSync(path.join(app.getPath('userData'), 'bnzc-debug.log'), `[${new Date().toISOString()}] IPC auto-activate called: code=${code}, clinic=${clinicName}, user=${user}\n`); } catch(e) {}
        if (!code) return { success: false, error: '激活码为空' };

        // 1. 校验激活码格式
        const pattern = /^BNZC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
        if (!pattern.test(code)) {
            console.warn('[Bnzc] 激活码格式错误:', code);
            return { success: false, error: '激活码格式错误' };
        }

        // 2. 获取本机机器 ID
        const machineId = activateManager.getMachineId();
        console.log('[Bnzc] 机器 ID:', machineId);

        // 3. 调用云端激活（复用 activateOnline 逻辑）
        console.log('[Bnzc] 开始云端激活...');
        const result = await activateManager.activateOnline(code, machineId, user || '', clinicName || '');
        console.log('[Bnzc] 激活结果:', result);
        try { require('fs').appendFileSync(path.join(app.getPath('userData'), 'bnzc-debug.log'), `[${new Date().toISOString()}] auto-activate RESULT: ${JSON.stringify(result)}\n`); } catch(e) {}

        // 4. 多设备提示
        if (result && result.success && result.licenseInfo) {
            const info = result.licenseInfo;
            const maxDevices = info.maxDevices || 1;
            const devicesCount = info.devicesCount || 1;
            if (maxDevices > 1) {
                result.deviceInfo = { maxDevices, devicesCount };
            }
        }

        // 5. 激活成功后清除 pending
        if (result && result.success) {
            _pendingActivation = null;
            console.log('[Bnzc] 激活成功，已清除 pending');
        }

        return result;
    } catch (e) {
        console.error('[Bnzc] auto-activate 异常:', e);
        return { success: false, error: String(e.message || e) };
    }
});

ipcMain.handle('set-auto-start', async (event, enabled) => {
    try {
        app.setLoginItemSettings({
            openAtLogin: !!enabled,
            args: ['--hidden']
        });
        return { success: true };
    } catch (e) {
        console.error('设置开机自启失败:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('quit-app', async () => {
    await saveLoginState(false);
    currentLoggedInUser = null;
    app.quit();
    return { success: true };
});

ipcMain.handle('logout', async () => {
    await saveLoginState(false);
    currentLoggedInUser = null;
    app.quit();
    return { success: true };
});

ipcMain.handle('show-message-box', async (event, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    try {
        const result = await dialog.showMessageBox(win || undefined, options);
        return result;
    } catch (e) {
        console.error('showMessageBox failed:', e);
        return { response: 0, checkboxChecked: false };
    }
});

require('./desktop-print.cjs').createDesktopPrintIpc({ ipcMain, BrowserWindow });

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
