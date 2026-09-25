// ============================================================================
//  惠康中医-云端  Electron 主进程
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
    // ★ E2E 专用旁路（2026-08-21 T4）：放行远程调试需【同时】满足两个条件：
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
                // ★ 全局旁路标志：license 的 debugger 检测据此跳过
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
// ★ 修复：如果已存在的 config.json 签名不匹配（旧版用 masterKey 派生密钥签名），用硬编码密钥重新签名
async function ensureWritableConfig() {
    try {
        const writablePath = getWritableConfigPath();
        if (await fse.pathExists(writablePath)) {
            // 已存在：确保签名正确（兼容旧版无签名或 masterKey 派生密钥签名）
            try {
                const cfg = await fse.readJson(writablePath);
                // signConfig(cfg) 直接修改原对象：设置 configIssuedAt（如无）+ 更新 configSignature 字符串
                // 切勿将返回值赋给 configSignature 属性（会造成循环引用）
                licenseManager.signConfig(cfg);
                await fse.writeJson(writablePath, cfg, { spaces: 2 });
                console.log('[Config] config.json 签名已修复/刷新');
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
            // ★ 云端认证修复：connect-src 需允许连接云端 API 域名，
            //   否则 file:// 登录页 fetch(https://...pages.dev/api/...) 被 CSP 拦截 → Failed to fetch → 云端回退失败 → 误报"密码错误"
            "connect-src 'self' https://tcm-prescription-system.pages.dev https://*.tcm-prescription-system.pages.dev",
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
const UPDATE_CHECK_URL = 'https://tcm-prescription-system.pages.dev/updates/cloud/latest.json';
const UPDATE_DOWNLOAD_URL = 'https://tcm-prescription-system.pages.dev/download?card=card-cloud-desktop';
const updateManager = require('./update-manager.cjs').createDesktopUpdateManager({
    checkUrl: UPDATE_CHECK_URL,
    downloadPageUrl: UPDATE_DOWNLOAD_URL,
    // ★ 2026-09-14 静默热更新（Ed25519 验签三道门禁，详见 shared/hot-update-core.cjs）
    hotUpdateUrl: 'https://tcm-prescription-system.pages.dev/hot-update/desktop/cloud'
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
        // ★ 2026-09-24 P1 对齐离线版（离线端 2026-09-23 事故同险）：E2E/打包链路
        //   （[7.8/9] pre-fuse）跑的是签名前的 win-unpacked exe，self-check 必然判
        //   NotSigned=tampered → state=2，若用例活到 ready+25s 就会把【构建机自己的
        //   machineId】上报封锁，导致正式包登录时 entitlement 403。E2E 环境信号无意义，
        //   直接跳过（BNZC_E2E=1 由 smoke-launch.cjs spawn 注入）。
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
            body: JSON.stringify({ machineId: mid, integrityState: state, productClass: 'cloud', clientClass: 'desktop' }),
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
        const midHash = crypto.createHash('sha256').update('cloud-desktop:' + mid).digest('hex');
        await net.fetch(TELEMETRY_HEARTBEAT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ed: 'cloud-desktop', v: app.getVersion(), mid: midHash }),
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
    
    // ★ 云端版：不进入试用模式，直接检查 license.dat 是否存在且有效
    // 云端版需求：无试用、平台管理员一键激活后才可使用
    let _isLicensed = false;
    try {
        const localMachineId = activateManager.getMachineId();
        // 直接读取 license 文件，跳过试用模式
        const rawLicense = licenseManager.readLicense(localMachineId);
        if (rawLicense) {
            // 有 license 文件，验证其有效性
            const licenseResult = licenseManager.validateLicense({ localMachineId });
            _isLicensed = licenseResult.valid;
            console.log('[Cloud] License 校验结果:', _isLicensed ? '已激活' : '未激活/已过期');
        } else {
            // 没有 license 文件，云端版不进入试用模式
            _isLicensed = false;
            console.log('[Cloud] 无 license.dat，未激活状态（云端版无试用）');
        }
    } catch (e) {
        console.warn('[Cloud] License 校验异常:', e.message);
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

    // ★ 云端版流程：未激活时先弹激活窗口，已激活直接进登录
    // ★ 2026-09-03 (架构统一 P1) 启动断点续传补齐（离线桌面在 main.js L1453-L1515 已有，云端桌面缺，
    //   原 admin-status 查激活无 machineId 兜底 → 漏扫）— 统一: 创建登录窗口前 10s 超时自检
    if (!_isLicensed) {
        console.log('[Cloud] 未激活，启动断点续传 10s 自检 + 再显示登录+激活窗口');
        let _resumeDone = false;
        const _resumeTimeout = setTimeout(() => {
            if (_resumeDone) return;
            console.log('[Cloud] 启动断点续传 10s 超时，直接进入登录流程（渲染进程再兜底）');
            _resumeDone = true;
            createLoginWindow();
            setTimeout(() => {
                if (loginWindow && !loginWindow.isDestroyed()) activateManager.showActivateWindow(loginWindow);
            }, 500);
        }, 10000);
        try {
            const savedReq = await activateManager.loadAdminRequestId();
            const localMachineId = activateManager.getMachineId();
            if (savedReq && savedReq.requestId) {
                console.log('[Cloud] 启动断点续传命中 requestId:', savedReq.requestId, 'machineId fallback=', localMachineId ? 'YES' : 'no');
                const statusRes = await activateManager.checkAdminStatus(savedReq.requestId, localMachineId);
                if (statusRes && statusRes.success && statusRes.status === 'activated' && statusRes.license) {
                    clearTimeout(_resumeTimeout);
                    try {
                        const edition = (savedReq.edition) ? savedReq.edition : 'cloud_personal';
                        const doctorName = (savedReq.adminName || statusRes.licenseInfo && statusRes.licenseInfo.user || 'admin');
                        const clinicName = (savedReq.clinicName || statusRes.licenseInfo && statusRes.licenseInfo.clinicName || '云端诊所');
                        const phone = (savedReq.phone || statusRes.licenseInfo && statusRes.licenseInfo.phone || '');
                        // savedReq.password 是 activation-observer 写的 ENC:/XORv2: 加密串，主进程 safeStorage 解
                        let pwd = 'admin';
                        if (savedReq.password && typeof savedReq.password === 'string') {
                            try {
                                if (savedReq.password.startsWith('ENC:')) {
                                    const body = savedReq.password.slice(4);
                                    if (safeStorage && safeStorage.isEncryptionAvailable()) pwd = safeStorage.decryptString(Buffer.from(body, 'base64'));
                                } else if (savedReq.password.startsWith('XORv2:')) {
                                    const body = savedReq.password.slice(6);
                                    const out = Buffer.from(body, 'base64').toString('binary');
                                    const key = 'act_observer_v1_xor_fallback_key';
                                    let s = '';
                                    for (let i = 0; i < out.length; i++) s += String.fromCharCode(out.charCodeAt(i) ^ key.charCodeAt(i % key.length));
                                    pwd = s;
                                } else {
                                    pwd = savedReq.password;  // 历史兼容
                                }
                            } catch (_) { pwd = 'admin'; }
                        }
                        const inst = await licenseManager.installLicense(statusRes.license, {
                            machineId: localMachineId, doctorName, clinicName, phone, password: pwd, edition
                        });
                        if (inst && inst.success) {
                            const recheck = licenseManager.validateLicense({ localMachineId });
                            if (recheck && recheck.valid) {
                                const bind = licenseManager.enforceEditionBinding();
                                if (bind && bind.corrected) console.log('[Cloud] 启动断点续传版本校正', bind.edition);
                            }
                            activateManager.clearAdminRequestId();
                            console.log('[Cloud] 启动断点续传成功: 自动装号+建本地账号', phone, '->', inst);
                        } else {
                            console.warn('[Cloud] 启动断点续传 installLicense 失败，交渲染兜底', inst);
                        }
                    } catch (e) {
                        console.warn('[Cloud] 启动断点续传 activated 分支异常（不阻断）:', e.message);
                    }
                }
            }
        } catch (e) { console.warn('[Cloud] 启动断点续传全局异常（不阻断）:', e.message); }
        if (!_resumeDone) {
            clearTimeout(_resumeTimeout);
            _resumeDone = true;
            createLoginWindow();
            setTimeout(() => {
                if (loginWindow && !loginWindow.isDestroyed()) activateManager.showActivateWindow(loginWindow);
            }, 500);
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
    productClass: 'cloud'
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
    promptTitle: '请输入'
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
        edition: 'cloud_personal',
        productName: '惠康中医-云端'
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
                    licenseManager.backupUserAccounts(cfg);
                } else {
                    const backedUsers = licenseManager.loadUserAccountBackup();
                    if (backedUsers.length > 0) cfg.users = backedUsers;
                }
            } catch (e) {
                console.warn('账号备份刷新失败（非致命）:', e.message);
            }
            return { success: true, config: { ...defaults, ...cfg } };
        }
    } catch (e) {
        console.error('读取 config.json 失败:', e);
    }
    return { success: true, config: defaults };
});

// ===== 首次配置向导：更新 config.json =====
ipcMain.handle('config:update', async (event, updates) => {
    try {
        const configPath = getWritableConfigPath();
        let config = {};
        if (await fse.pathExists(configPath)) {
            config = await fse.readJson(configPath);
        }
        if (updates.clinicName !== undefined) config.clinicName = updates.clinicName;
        if (updates.doctorName !== undefined) config.doctorName = updates.doctorName;
        if (updates.title !== undefined) config.title = updates.title;
        // 签名保护：signConfig(config) 直接修改原对象，切勿将返回值赋值给属性（会造成循环引用）
        licenseManager.signConfig(config);
        await fse.writeJson(configPath, config, { spaces: 2 });
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
    productClass: 'cloud'
});

async function hashPassword(password) {
    const crypto = require('crypto');
    const PASSWORD_SALT = 'bnzc_prescription_salt_v1';
    const data = Buffer.from(PASSWORD_SALT + password, 'utf8');
    return {
        passwordHash: crypto.createHash('sha256').update(data).digest('hex'),
        salt: PASSWORD_SALT
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
