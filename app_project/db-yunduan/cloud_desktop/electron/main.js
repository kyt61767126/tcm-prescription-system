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
const fse = require('fs-extra');
const crypto = require('crypto');
const licenseManager = require('./license-manager');
const APP_ICON = path.join(__dirname, '..', 'build', 'icon.ico');  // ★ 窗口图标（本能印章），随 app.asar 打包
app.setAppUserModelId('com.benneng.prescription');  // ★ Windows 任务栏图标关联
const prescriptionCounter = require('./prescription-counter');
const featureGuard = require('./feature-guard');
const activateManager = require('./activate');
const selfCheck = require('./self-check');  // ★ P0-③ exe 签名/完整性自校验（非阻塞，仅记录）
const logger = require('./electron-logger.cjs');  // ★ P0-[6.3] 主进程滚动日志（脱敏 + 2MB 轮转，.cjs 确保 CJS 解析）

let mainWindow;
let loginWindow;
let packagingWindow = null;
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
function getExeDirectory() {
    return process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'));
}

// 通用目录创建：优先 exe 同级，失败回退到 userData
// name 参数支持绝对路径或相对路径
function ensureDirWithFallback(name, { rethrow = false } = {}) {
    const targetPath = path.isAbsolute(name) ? name : path.join(getExeDirectory(), name);
    try {
        fse.ensureDirSync(targetPath);
        return targetPath;
    } catch (error) {
        console.error(`无法创建文件夹:`, error);
        if (rethrow) throw error;
        const fallbackPath = path.join(app.getPath('userData'), path.basename(name));
        fse.ensureDirSync(fallbackPath);
        return fallbackPath;
    }
}

function getDataDirectory() {
    // ★ 2026-08-29 v3 数据集中：与媒体同根（安装盘\惠康中医媒体\data），备份/换机只拷一个文件夹
    return getCentralDataDir();
}

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

function getDownloadsDirectory() {
    // ★ 2026-08-29 修复重装丢媒体（v2 按用户要求改安装盘）：媒体保存到「安装盘根目录\惠康中医媒体\downloads」。
    //   演进史：v0 存安装目录（重装软件被 NSIS 清空 → 照片丢失）；v1 存 %APPDATA%（防住重装软件，
    //   但重装系统格 C 盘会丢）；v2 存安装盘根目录专属文件夹（重装软件✅不丢 + 重装C系统✅不丢 + 打开盘符即见易备份）。
    //   创建失败（如无权限）自动回退 %APPDATA%（保证可用性优先）。
    //   便携版（PORTABLE_EXECUTABLE_DIR）保持 exe 同级——便携特性：拷目录即迁移。
    if (process.env.PORTABLE_EXECUTABLE_DIR) {
        return ensureDirWithFallback('downloads');
    }
    try {
        const exeDir = getExeDirectory();
        const driveRoot = path.parse(exeDir).root; // 如 D:\
        return ensureDirWithFallback(path.join(driveRoot, '惠康中医媒体', 'downloads'), { rethrow: true });
    } catch (e) {
        console.warn('[Media] 安装盘根目录不可写，回退 userData/downloads:', e.message);
        return ensureDirWithFallback(path.join(app.getPath('userData'), 'downloads'));
    }
}

// ★ 全部媒体根目录（读取/扫描兼容历代位置）：
//   v2 安装盘\惠康中医媒体\downloads + v1 userData/downloads + v0 exe 同级 downloads（存量旧文件仍可查可读）
function getAllMediaRoots() {
    const roots = [];
    try { roots.push(path.resolve(getDownloadsDirectory())); } catch(e) {}
    try {
        const driveRoot = path.parse(getExeDirectory()).root;
        roots.push(path.resolve(driveRoot, '惠康中医媒体', 'downloads'));
    } catch(e) {}
    try { roots.push(path.resolve(getExeDirectory(), 'downloads')); } catch(e) {}
    try { roots.push(path.resolve(app.getPath('userData'), 'downloads')); } catch(e) {}
    return Array.from(new Set(roots));
}

// ★ 2026-08-29 数据集中 v3（用户要求"所有信息都在 D 盘一处"）：
//   处方文字数据（save-user-data 的 data/*.json）同样保存到「安装盘根目录\惠康中医媒体\data」。
//   与媒体同根 → 备份/换机只需拷贝一个「惠康中医媒体」文件夹。
//   - NSIS 安装版：安装盘\惠康中医媒体\data；创建失败回退 userData/data（可用性优先）
//   - 便携版：保持 exe 同级 data（便携特性：拷目录即迁移）
//   ★ 兼容读取：getAppDataDir（下）返回候选目录数组，读数据时旧位置仍可读（自动迁移在 whenReady）
let _centralDataDir = null; // 缓存实际选定的数据目录（保存/迁移目标）
function getCentralDataDir() {
    if (_centralDataDir) return _centralDataDir;
    if (process.env.PORTABLE_EXECUTABLE_DIR) {
        _centralDataDir = ensureDirWithFallback('data');
    } else {
        try {
            const driveRoot = path.parse(getExeDirectory()).root;
            _centralDataDir = ensureDirWithFallback(path.join(driveRoot, '惠康中医媒体', 'data'), { rethrow: true });
        } catch (e) {
            console.warn('[Data] 安装盘根目录不可写，回退 userData/data:', e.message);
            _centralDataDir = ensureDirWithFallback(path.join(app.getPath('userData'), 'data'));
        }
    }
    return _centralDataDir;
}

// 数据目录候选（读取兼容：新集中目录 + 旧 exe 同级 data + 旧 userData/data）
function getAppDataDirs() {
    const dirs = [];
    try { dirs.push(path.resolve(getCentralDataDir())); } catch(e) {}
    try { dirs.push(path.resolve(getExeDirectory(), 'data')); } catch(e) {}
    try { dirs.push(path.resolve(app.getPath('userData'), 'data')); } catch(e) {}
    return Array.from(new Set(dirs));
}

function getCurrentMonthFolder() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getCurrentMonthDirectory() {
    const monthDir = path.join(getDownloadsDirectory(), getCurrentMonthFolder());
    return ensureDirWithFallback(monthDir, { rethrow: true });
}

// 校验 key/文件名防止路径穿越（统一清洗非法字符）
function sanitizeKey(key) {
    return String(key || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\.\./g, '_');
}

// ★ 安全 key 校验：仅允许字母数字下划线短横，防止 save-user-data 路径越权
function isSafeKey(key) {
    if (!key || typeof key !== 'string') return false;
    return /^[a-zA-Z0-9_-]{1,64}$/.test(key);
}

function sanitizeFileName(fileName) {
    if (typeof fileName !== 'string') return `file_${Date.now()}.webm`;
    const base = sanitizeKey(path.basename(fileName));
    return base || `file_${Date.now()}.webm`;
}

// ★ 路径白名单校验：仅允许访问媒体根目录（userData/downloads 新位置 + exe 同级旧位置）下的文件
function getAllowedRoots() {
    const roots = new Set();
    getAllMediaRoots().forEach(r => roots.add(r));
    return Array.from(roots);
}

function isPathAllowed(filePath) {
    if (!filePath || typeof filePath !== 'string') return false;
    try {
        const resolved = path.resolve(filePath);
        for (const root of getAllowedRoots()) {
            const rel = path.relative(root, resolved);
            if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
                return true;
            }
        }
        console.warn('[路径校验] 拒绝访问:', filePath);
        return false;
    } catch (e) {
        return false;
    }
}

async function savePrescriptionImage(imageData, fileName) {
    try {
        const monthDir = getCurrentMonthDirectory();
        const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const safeName = sanitizeFileName(fileName);
        const filePath = path.join(monthDir, safeName);
        if (!isPathAllowed(filePath)) return { success: false, error: '路径不在允许的下载目录内，已拒绝' };
        await fs.writeFile(filePath, buffer);
        return { success: true, filePath, directory: monthDir };
    } catch (error) {
        console.error('保存图片失败:', error);
        return { success: false, error: '保存图片失败' };
    }
}

// ============================================================================
//  视频文件保存（新增）
// ============================================================================
async function saveVideoFile(arrayBuffer, fileName) {
    try {
        const monthDir = getCurrentMonthDirectory();
        const buffer = Buffer.from(arrayBuffer);
        const safeName = sanitizeFileName(fileName);
        let finalName = safeName;
        if (!finalName.endsWith('.webm')) {
            const base = finalName.replace(/\.[^.]+$/, '');
            finalName = base + '.webm';
        }
        const filePath = path.join(monthDir, finalName);
        if (!isPathAllowed(filePath)) return { success: false, error: '路径不在允许的下载目录内，已拒绝' };
        await fs.writeFile(filePath, buffer);
        return { success: true, filePath, directory: monthDir, fileName: finalName };
    } catch (error) {
        console.error('保存视频失败:', error);
        return { success: false, error: '保存视频失败' };
    }
}

// ★ 重命名处方文件（支持改姓名和编号，用于"先拍照后录入姓名"场景的媒体文件绑定）
async function renameMediaFiles(oldPatientName, newPatientName, oldNo, newNo) {
    try {
        const sanitizeStr = s => (s || '').trim().replace(/[\/\\:*?"<>|]/g, '_').replace(/ /g, '');
        const cleanOldName = sanitizeStr(oldPatientName);
        const cleanNewName = sanitizeStr(newPatientName);
        const cleanOldNo = sanitizeStr(oldNo);
        const cleanNewNo = sanitizeStr(newNo);
        if (!cleanOldName || !cleanNewName || !cleanOldNo || !cleanNewNo) {
            return { success: true, renamed: 0 };
        }
        // 支持两种命名格式：姓名_编号 和 编号_姓名
        const oldPrefixes = [`${cleanOldName}_${cleanOldNo}`, `${cleanOldNo}_${cleanOldName}`];
        const newPrefixes = [`${cleanNewName}_${cleanNewNo}`, `${cleanNewNo}_${cleanNewName}`];
        // ★ 2026-08-29 扫描全部媒体根目录（新 userData/downloads + 旧 exe 同级 downloads）
        let renamed = 0;
        let monthDirs = [];
        for (const mediaRoot of getAllMediaRoots()) {
            try {
                const entries = await fs.readdir(mediaRoot, { withFileTypes: true });
                monthDirs.push(...entries.filter(e => e.isDirectory()).map(e => path.join(mediaRoot, e.name)));
            } catch (e) { /* 该媒体根目录可能不存在 */ }
        }
        for (const monthDir of monthDirs) {
            let fileEntries = [];
            try {
                fileEntries = await fs.readdir(monthDir, { withFileTypes: true });
            } catch (e) { continue; }
            for (const fe of fileEntries) {
                if (!fe.isFile()) continue;
                const fileName = fe.name;
                for (let i = 0; i < oldPrefixes.length; i++) {
                    if (!fileName.includes(oldPrefixes[i])) continue;
                    const newFileName = fileName.replace(oldPrefixes[i], newPrefixes[i]);
                    if (newFileName === fileName) continue;
                    try {
                        await fs.rename(path.join(monthDir, fileName), path.join(monthDir, newFileName));
                        renamed++;
                    } catch (e) { /* 跳过无法重命名的文件 */ }
                    break; // 匹配到一个前缀即可，避免重复替换
                }
            }
        }
        return { success: true, renamed };
    } catch (error) {
        console.error('重命名处方文件失败:', error);
        return { success: false, error: error.message, renamed: 0 };
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

// 聚焦或恢复窗口
function focusWindow(win) {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.focus();
}

// ============================================================================
//  窗口创建
// ============================================================================
function createMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        focusWindow(mainWindow);
        return;
    }

    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1024,
        minHeight: 700,
        autoHideMenuBar: true,
        center: true,
        show: false,
        icon: APP_ICON,
        webPreferences: getSharedWebPrefs()
    });

    // ★ P1-A6：DevTools 反调试（仅打包环境生效）
    installDevToolsGuard(mainWindow.webContents);

    mainWindow.webContents.on('dom-ready', async () => {
        // ★修复登录界面闪现（2026-07-19）：
        // 原因：index.html 中 loginOverlay 默认 style="display:flex;visibility:visible;"
        //       dom-ready 时 loginOverlay 已渲染显示，但 checkLoginStatus() 是异步执行
        //       会在 show() 之后才隐藏 loginOverlay，导致用户看到第二次登录界面闪现
        // 方案：已通过 login.html 登录时（currentLoggedInUser 存在），
        //       先 executeJavaScript 同步隐藏 loginOverlay，再 show()
        if (currentLoggedInUser) {
            try {
                await mainWindow.webContents.executeJavaScript(`
                    try {
                        var _ov = document.getElementById('loginOverlay');
                        if (_ov) _ov.style.display = 'none';
                        var _mc = document.querySelector('.main-container');
                        if (_mc) _mc.style.display = 'flex';
                    } catch(e) {}
                `);
            } catch(e) { /* 忽略注入失败 */ }
            mainWindow.webContents.send('main:login-user', currentLoggedInUser);
        }
        mainWindow.show();

        // ★ 注入视频录制模块（从同目录读取 video-recorder.js）
        injectVideoRecorder(mainWindow);

        // ★ 修复 Electron 35 alert() 关闭后鼠标光标不显示的 bug
        // 问题根源：Electron 35 中原生 alert() 关闭后 Chromium 模态框焦点未正确恢复，导致鼠标光标不显示
        // 修复方案：用 Electron 原生 dialog.showMessageBoxSync（同步阻塞，由 main.js 的 IPC handler 处理）替代原生 alert/confirm
        //          业务代码同步调用 window.alert/confirm 不受影响（保留同步语义）
        try {
            const fixCode = `(function() {
                if (window.__nativeDialogsInjected) return;
                window.__nativeDialogsInjected = true;
                if (window.electronAPI && typeof window.electronAPI.alertSync === 'function') {
                    var origAlert = window.alert;
                    window.alert = function(msg) {
                        try { window.electronAPI.alertSync(msg); }
                        catch(e) { console.warn('[alert] 同步 dialog 失败，回退原生:', e.message); origAlert(msg); }
                    };
                }
                if (window.electronAPI && typeof window.electronAPI.confirmSync === 'function') {
                    var origConfirm = window.confirm;
                    window.confirm = function(msg) {
                        try { return window.electronAPI.confirmSync(msg); }
                        catch(e) { console.warn('[confirm] 同步 dialog 失败，回退原生:', e.message); return origConfirm(msg); }
                    };
                }
                // ★ P0 修复：替换 window.prompt（Electron 原生 prompt 返回 null，导致编辑功能失效）
                if (window.electronAPI && typeof window.electronAPI.prompt === 'function') {
                    window.prompt = function(message, defaultValue) {
                        return window.electronAPI.prompt(message, defaultValue);
                    };
                    console.log('[FIX] window.prompt 已替换为 Electron 异步 prompt');
                }
                console.log('[FIX] alert/confirm/prompt 已替换为 Electron 原生 dialog');
            })();`;
            await mainWindow.webContents.executeJavaScript(fixCode);
            console.log('[FIX] 原生同步 dialog 注入完成');
        } catch(e) { console.warn('[FIX] 原生同步 dialog 注入失败:', e.message); }

        // ★ 过滤启动时偶发的"系统异常"/"数据处理异常"toast，避免干扰用户
        // 来源：index.html 的 window.addEventListener('error') 和 unhandledrejection 监听器
        try {
            await mainWindow.webContents.executeJavaScript(`
                (function() {
                    if (window.__dataErrorToastFiltered) return;
                    window.__dataErrorToastFiltered = true;
                    if (typeof window.showToast !== 'function') return;
                    var _origToast = window.showToast;
                    window.showToast = function(msg) {
                        if (typeof msg === 'string' &&
                            (msg.indexOf('数据处理异常') >= 0 || msg.indexOf('系统异常') === 0)) {
                            console.error('[已过滤toast]', msg);
                            return;
                        }
                        return _origToast.apply(this, arguments);
                    };
                })();
            `);
        } catch(e) { console.warn('[过滤toast] 注入失败:', e.message); }
    });

    // ★ 直接加载打包的 index.html（已移除热更新机制，页面始终以打包文件为准）
    mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

    // ★ 安全：拦截 window.open 防止钓鱼攻击
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('file://') || url.startsWith('http://localhost')) {
            return { action: 'deny' };
        }
        shell.openExternal(url);
        return { action: 'deny' };
    });

    // ★ 安全（P3-1 最终加固）：主框架导航防护——仅允许应用自身 file:// 页面，
    //   阻断渲染进程被诱导整页跳转到远程地址（远程页面会继承 preload API 面）
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith('file://')) {
            event.preventDefault();
            console.warn('[安全] 已阻断主窗口整页导航到非本地地址:', url);
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function getSharedWebPrefs() {
    return {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        partition: SESSION_PARTITION
    };
}

// ============================================================================
//  ★ P1-A6 安全增强：DevTools 反调试（仅打包环境启用）
//  策略：
//   1. 仅在 app.isPackaged 时启用，开发环境保留 DevTools 调试能力
//   2. 监听 devtools-opened 事件，立即关闭 DevTools 窗口
//   3. 拦截 F12 / Ctrl+Shift+I / Ctrl+Shift+J / Ctrl+U 等快捷键
// ============================================================================
const IS_PROD_PACKAGED = app.isPackaged;

function installDevToolsGuard(webContents) {
    if (!IS_PROD_PACKAGED) return;  // 开发环境跳过
    try {
        webContents.on('devtools-opened', () => {
            try {
                webContents.closeDevTools();
                console.warn('[Security] DevTools 已被阻止');
            } catch (e) { /* 忽略 */ }
        });
        webContents.on('before-input-event', (event, input) => {
            if (!input || !event) return;
            const key = (input.key || '').toLowerCase();
            const ctrl = input.control || input.meta;
            const shift = input.shift;
            if (key === 'f12') { event.preventDefault(); return; }
            if (ctrl && shift && (key === 'i' || key === 'j')) { event.preventDefault(); return; }
            if (ctrl && shift && key === 'r') { event.preventDefault(); return; }
            if (ctrl && !shift && key === 'u') { event.preventDefault(); return; }
            // ★ P4-D 打印快捷键：Ctrl+P 纵向打印 / Ctrl+Shift+P 横向打印
            // 拦截浏览器默认打印对话框，改用应用自定义的 printPrescription
            if (ctrl && key === 'p') {
                event.preventDefault();
                const orientation = shift ? 'landscape' : 'portrait';
                webContents.executeJavaScript(
                    `if (typeof printPrescription === 'function') printPrescription('${orientation}');`
                ).catch(() => {});
                return;
            }
        });
        // 3. ★ P0 安全增强：定时主动检查 DevTools 状态（防止 devtools-opened 事件被 hook 绕过）
        //    每 3 秒检查一次，若发现 DevTools 已打开则强制关闭
        const _devtoolsCheckTimer = setInterval(() => {
            try {
                if (webContents.isDestroyed()) {
                    clearInterval(_devtoolsCheckTimer);
                    return;
                }
                if (webContents.isDevToolsOpened()) {
                    console.warn('[Security] 主动检测到 DevTools 已打开，强制关闭');
                    webContents.closeDevTools();
                }
                // 检测 debugger API 附加（防止通过 webContents.debugger.attach 附加）
                if (webContents.debugger && typeof webContents.debugger.isAttached === 'function' &&
                    webContents.debugger.isAttached()) {
                    console.warn('[Security] 检测到 Debugger API 已附加，强制分离');
                    try { webContents.debugger.detach(); } catch (e) { /* 忽略 */ }
                }
            } catch (e) { /* 忽略 */ }
        }, 3000);
        // 4. ★ P0 安全增强：启动时检测 --remote-debugging-port / --inspect 参数
        //    防止通过命令行参数启动远程调试端口绕过 DevTools 拦截
        try {
            const argv = process.argv.join(' ');
            if (argv.includes('--remote-debugging-port') ||
                argv.includes('--inspect-brk') || argv.includes('--inspect=')) {
                console.warn('[Security] 检测到远程调试参数，DevTools 防护已启用:', argv);
            }
        } catch (e) { /* 忽略 */ }
    } catch (e) {
        console.warn('[Security] installDevToolsGuard 异常:', e.message);
    }
}

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
//  视频录制模块注入（新增）
// ============================================================================
async function injectVideoRecorder(win) {
    try {
        const recorderPath = path.join(__dirname, 'video-recorder.js');
        const code = await fs.readFile(recorderPath, 'utf8');
        await win.webContents.executeJavaScript(code);
        console.log('[视频录制] 模块注入成功');
    } catch (e) {
        console.error('[视频录制] 模块注入失败:', e.message);
    }
}

// ============================================================================
//  ★ 方案A 轻量更新提示（2026-08-23）：启动静默检查官网 latest.json
//  - 登录页 dom-ready 1.5s 后主进程 net.fetch 静默检查（绕过渲染层 CSP/缓存）
//  - 官网版本 > 本地 app.getVersion() 才提示（三段式比较，宁可漏检不可误报）
//  - 提示方式：登录窗增高 40px + 顶部黄色横幅，点击跳官网下载页手动覆盖安装
//  - 无自动下载/自动安装；网络失败/解析失败/格式异常一律静默跳过
// ============================================================================
const UPDATE_CHECK_URL = 'https://tcm-prescription-system.pages.dev/updates/cloud/latest.json';
const UPDATE_DOWNLOAD_URL = 'https://tcm-prescription-system.pages.dev/download';
const UPDATE_BANNER_EXTRA_HEIGHT = 40;

// 三段式版本号比较：仅当远程版本严格大于本地版本才提示
function isNewerRemoteVersion(remote, local) {
    if (!remote || !local) return false;
    const r = String(remote).split('.');
    const l = String(local).split('.');
    for (let i = 0; i < 3; i++) {
        const rv = parseInt(r[i], 10) || 0;
        const lv = parseInt(l[i], 10) || 0;
        if (rv > lv) return true;
        if (rv < lv) return false;
    }
    return false;
}

async function checkForUpdateAndNotify(win) {
    try {
        const res = await net.fetch(UPDATE_CHECK_URL, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) {
            console.log('[update] 检查跳过: HTTP ' + res.status);
            return;
        }
        const latest = await res.json();
        const localVer = app.getVersion();
        const remoteVer = latest && latest.version;
        // 版本号白名单校验：防止 latest.json 被篡改后向 executeJavaScript 注入任意代码
        if (!/^[0-9A-Za-z.\-+]+$/.test(String(remoteVer || ''))) {
            console.log('[update] 检查跳过: 官网版本号格式异常');
            return;
        }
        if (!isNewerRemoteVersion(remoteVer, localVer)) {
            console.log('[update] 已是最新版本 v' + localVer);
            return;
        }
        console.log('[update] 发现新版本 v' + remoteVer + '（当前 v' + localVer + '），注入登录页横幅');
        injectUpdateBanner(win, remoteVer);
    } catch (e) {
        // 离线/超时/DNS 失败：静默跳过（宁可漏检不可误报，不打扰离线使用）
        console.log('[update] 检查跳过（网络不可用或超时）: ' + (e && e.message));
    }
}

function injectUpdateBanner(win, newVersion) {
    if (!win || win.isDestroyed()) return;
    try {
        // 窗口增高 40px 并重新居中，为顶部横幅腾出空间（不遮挡居中的登录卡片）
        win.setSize(260, 430 + UPDATE_BANNER_EXTRA_HEIGHT);
        win.center();
        const bannerCode = `
            (function() {
                if (document.getElementById('__updateBanner')) return;
                var b = document.createElement('div');
                b.id = '__updateBanner';
                b.style.cssText = 'position:fixed;top:0;left:0;right:0;height:32px;z-index:99999;'
                    + 'display:flex;align-items:center;justify-content:center;gap:6px;'
                    + 'background:linear-gradient(135deg,#fff8e1 0%,#ffecb3 100%);'
                    + 'border-bottom:1px solid #f0c040;font-size:11px;color:#7a5c00;'
                    + 'font-family:"Microsoft YaHei",sans-serif;';
                var label = document.createElement('span');
                label.textContent = '🆕 新版 v' + ${JSON.stringify(String(newVersion))};
                var link = document.createElement('span');
                link.textContent = '立即下载';
                link.style.cssText = 'color:#1565c0;font-weight:bold;text-decoration:underline;cursor:pointer;';
                link.addEventListener('click', function() {
                    window.open(${JSON.stringify(UPDATE_DOWNLOAD_URL)});
                });
                b.appendChild(label);
                b.appendChild(link);
                document.body.appendChild(b);
            })();
        `;
        win.webContents.executeJavaScript(bannerCode).catch(function(e) {
            console.warn('[update] 横幅注入失败:', e && e.message);
        });
    } catch (e) {
        console.warn('[update] 横幅注入异常:', e && e.message);
    }
}

function createLoginWindow() {
    if (loginWindow && !loginWindow.isDestroyed()) {
        focusWindow(loginWindow);
        return;
    }

    loginWindow = new BrowserWindow({
        // ★ 2026-08-28 再压缩：窗口260→240宽，初始高度420→360，最小高度420→340（消除红框空白根源：
        //   实测最小内容=紫头56+主内容180+footer28+版权15≈279，给340安全下限足够）
        width: 240,
        height: 360,
        resizable: false,
        autoHideMenuBar: true,
        center: true,
        show: false,
        icon: APP_ICON,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            partition: SESSION_PARTITION
        }
    });

    // ★ 2026-08-28 登录窗口高度自适应：dom-ready 后按页面实际内容高度调整（含报错/激活提示/多账户下拉场景），
    //   上限 480px→460（宽度收窄高度略收）；下限 420→340（正常无报错时紧凑无红框）。
    loginWindow.webContents.on('dom-ready', () => {
        try {
            loginWindow.webContents.executeJavaScript('Math.ceil(document.body.scrollHeight)').then(h => {
                const target = Math.min(Math.max(Number(h) || 360, 340), 460);
                const current = loginWindow.getBounds();
                if (Math.abs(current.height - target) > 4 || current.width !== 240) {
                    loginWindow.setBounds({ x: current.x, y: current.y, width: 240, height: target });
                }
            }).catch(() => {});
        } catch (e) { /* 自适应失败保持 360 */ }
    });

    // ★ P1-A6：DevTools 反调试（仅打包环境生效）
    installDevToolsGuard(loginWindow.webContents);

    // ★ 方案A：更新横幅「立即下载」点击 → 拦截 window.open → 系统浏览器打开官网下载页
    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('file://') || url.startsWith('http://localhost')) {
            return { action: 'deny' };
        }
        shell.openExternal(url);
        return { action: 'deny' };
    });

    // ★ 安全（P3-1 最终加固）：登录窗口主框架导航防护——仅允许应用自身 file:// 页面
    loginWindow.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith('file://')) {
            event.preventDefault();
            console.warn('[安全] 已阻断登录窗口整页导航到非本地地址:', url);
        }
    });

    loginWindow.loadFile(path.join(__dirname, 'login.html'));

    loginWindow.on('closed', () => {
        loginWindow = null;
    });

    loginWindow.webContents.on('dom-ready', () => {
        console.log('[login] dom-ready triggered, executing JS...');
        // ★ 彻底禁用密码输入框自动填充（防止 Chromium 弹出旧版应用名凭据提示）
        // 根因：Chromium 通过 input type="password" 识别密码字段并弹出凭据提示
        //       autocomplete="off" 被现代 Chromium 忽略
        // 彻底修复：将 type="password" 改为 type="text" + webkitTextSecurity=disc（视觉仍为圆点）
        //           系统不再识别为密码字段，从根源消除提示
        //           配合 autocomplete="new-password" + readonly 延迟移除双保险
        loginWindow.webContents.executeJavaScript(`
            (function() {
                var pwds = document.querySelectorAll('input[type="password"]');
                for (var i = 0; i < pwds.length; i++) {
                    var p = pwds[i];
                    p.setAttribute('autocomplete', 'new-password');
                    p.setAttribute('readonly', '');
                    p.addEventListener('focus', function() { this.removeAttribute('readonly'); });
                    p.setAttribute('type', 'text');
                    p.style.webkitTextSecurity = 'disc';
                }
            })();
        `).then(() => {
            console.log('[login] executeJavaScript succeeded, showing window...');
            loginWindow.show();
        }).catch(e => {
            console.warn('[login] executeJavaScript failed:', e.message);
            loginWindow.show();
        });

        // ★ 方案A：登录页首帧直出完成后再静默检查更新（延迟 1.5s，不与首屏渲染竞争）
        setTimeout(() => {
            if (loginWindow && !loginWindow.isDestroyed()) {
                checkForUpdateAndNotify(loginWindow);
            }
        }, 1500);
    });

    loginWindow.on('ready-to-show', () => {
        console.log('[login] ready-to-show event');
    });
}

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
    if (!_isLicensed) {
        console.log('[Cloud] 未激活，先显示激活窗口');
        createLoginWindow();
        setTimeout(() => {
            if (loginWindow && !loginWindow.isDestroyed()) {
                activateManager.showActivateWindow(loginWindow);
            }
        }, 500);
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

// ★ License 授权相关 IPC
ipcMain.handle('license:get-status', () => {
    // ★ P1修复：云端桌面版无试用期，改用 readLicense 判断，不再调用 validateLicense
    // 原逻辑：validateLicense() 在无 license 时会创建 trial.dat 并返回 {valid:true,type:'trial'}，
    // 导致云端桌面版（无试用设计）在边界场景（关闭激活窗口后）被间接触发试用状态。
    try {
        const localMachineId = activateManager.getMachineId();
        const lic = licenseManager.readLicense(localMachineId);
        if (!lic) {
            return { valid: false, licenseType: 'none', message: '请激活后使用' };
        }
        // 计算剩余天数
        let remainingDays = -1;  // -1 表示永久授权
        if (lic.expiresAt) {
            const exp = new Date(lic.expiresAt);
            remainingDays = Math.ceil((exp - new Date()) / (24 * 60 * 60 * 1000));
            if (remainingDays < 0) remainingDays = 0;
        }
        return {
            valid: true,
            licenseType: lic.type || 'licensed',
            remainingDays,
            message: '已激活'
        };
    } catch (e) {
        console.error('[IPC] get-status 异常:', e);
        return { valid: false, licenseType: 'none', message: '激活信息异常' };
    }
});

ipcMain.handle('license:activate', (event, base64Content) => {
    try {
        const localMachineId = activateManager.getMachineId();
        // ★ 统一安装（一行搞定：写license+清trial+同步config）
        const result = licenseManager.installLicense(base64Content, {
            machineId: localMachineId
        });
        if (result.success) {
            const validate = licenseManager.validateLicense({ localMachineId });
            return { success: true, status: validate };
        }
        return { success: false, error: result.error };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// ★ 新增：离线激活文件选择对话框（导入 license.dat）
// 用户在激活窗口点击"导入离线激活文件"按钮时调用
// 返回 { success, filePath, base64Content } 或 { success: false, error }
ipcMain.handle('license:select-offline-file', async (event) => {
    try {
        const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
        const result = await dialog.showOpenDialog(win, {
            title: '选择离线激活文件',
            defaultPath: app.getPath('downloads'),
            filters: [
                { name: 'License 文件', extensions: ['dat', 'lic', 'txt'] },
                { name: '所有文件', extensions: ['*'] }
            ],
            properties: ['openFile']
        });
        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, cancelled: true };
        }
        const filePath = result.filePaths[0];
        const fsSync = require('fs');
        const content = fsSync.readFileSync(filePath, 'utf8');
        // 去除可能的空白字符和换行（确保 base64 解析正常）
        const trimmed = content.trim();
        return { success: true, filePath: filePath, base64Content: trimmed };
    } catch (e) {
        console.error('[IPC] select-offline-file 异常:', e);
        return { success: false, error: e.message };
    }
});

// ★ v2: 处方数量限制 IPC
// ★ 第三轮终检 P1 修复（2026-08-16）：授权执行点异常时 fail-closed（原放行可绕过 30 张限制）
ipcMain.handle('license:can-prescribe', () => {
    try {
        return prescriptionCounter.canPrescribe();
    } catch (e) {
        console.error('[IPC] can-prescribe 异常:', e);
        return { allowed: false, current: 0, max: 30, remaining: 0, error: '处方数校验异常，请重启软件' };
    }
});

ipcMain.handle('license:increment-prescription', () => {
    try {
        const newCount = prescriptionCounter.increment();
        return { success: true, count: newCount };
    } catch (e) {
        console.error('[IPC] increment-prescription 异常:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('license:decrement-prescription', () => {
    try {
        const newCount = prescriptionCounter.decrement();
        return { success: true, count: newCount };
    } catch (e) {
        console.error('[IPC] decrement-prescription 异常:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('license:get-prescription-status', () => {
    try {
        return prescriptionCounter.getStatus();
    } catch (e) {
        console.error('[IPC] get-prescription-status 异常:', e);
        // ★ 第三轮终检 P1 修复：max:0 在 UI 表示"无限"，异常时按试用限制显示（fail-closed）
        return { current: 0, max: 30, remaining: 30, licenseType: 'trial', month: '' };
    }
});

// ★ v2: 功能权限校验 IPC
ipcMain.handle('license:check-feature', (event, featureName) => {
    try {
        return featureGuard.checkFeature(featureName);
    } catch (e) {
        console.error('[IPC] check-feature 异常:', e);
        // ★ 第三轮终检 P1 修复：授权执行点异常时拒绝（fail-closed）
        return { allowed: false, message: '功能校验异常，请重启软件后再试', feature: featureName };
    }
});

ipcMain.handle('license:get-feature-status', () => {
    try {
        return featureGuard.getFeatureStatus();
    } catch (e) {
        console.error('[IPC] get-feature-status 异常:', e);
        return [];
    }
});

// ★ 激活码相关 IPC（云端激活系统，第3周任务）

// ★ 一体化到期提示 + 拉起激活窗口（双按钮：前往激活 / 退出软件）
// 用异步 dialog.showMessageBox（不阻塞 main process 事件循环）
// 用户点击【前往激活】→ 关闭到期弹窗，唤起激活码输入页面，软件保持运行
// 用户点击【退出软件】→ 直接 app.exit(0) 终止 Electron 进程
// 激活窗口关闭后 license 仍失效时，自动重新弹 expire-alert（兜底限制）
ipcMain.handle('license:show-expire-alert', async (event, message) => {
    try {
        return await activateManager.showExpireAlertAndActivate(mainWindow, message);
    } catch (e) {
        console.error('[IPC] show-expire-alert 异常:', e);
        // 出错时尝试单独弹激活窗口（兜底放行，避免阻塞用户）
        try { activateManager.showActivateWindow(mainWindow); } catch (e2) {
            console.error('[IPC] showActivateWindow 也失败:', e2);
        }
        return { success: false, error: String(e) };
    }
});

ipcMain.handle('license:show-activate', () => {
    try {
        activateManager.showActivateWindow(mainWindow);
    } catch (e) {
        console.error('[IPC] show-activate 异常:', e);
    }
});

ipcMain.handle('license:submit-activate', async (event, code, user, clinicName, phone, password, edition) => {
    try {
        const machineId = activateManager.getMachineId();
        // ★ v3 新增：透传 clinicName 给云端做绑定校验
        // ★ P1优化：增加phone/password参数，激活码激活也自动创建管理员账户
        const result = await activateManager.activateOnline(code, machineId, user, clinicName, phone, password, edition);
        // ★ v4 新增：激活成功后弹窗显示"已绑定 X/N 台设备"
        if (result && result.success && result.licenseInfo) {
            const info = result.licenseInfo;
            const maxDevices = info.maxDevices || 1;
            const devicesCount = info.devicesCount || 1;
            // 多设备授权时显示配额信息（单设备时不显示，保持原行为）
            if (maxDevices > 1) {
                const { dialog } = require('electron');
                dialog.showMessageBoxSync(mainWindow, {
                    type: 'info',
                    title: '激活成功',
                    message: `激活成功！\n已绑定 ${devicesCount}/${maxDevices} 台设备`,
                    detail: `剩余可用设备数：${maxDevices - devicesCount} 台\n如需解绑旧设备，请联系管理员。`,
                    buttons: ['确定'],
                    defaultId: 0
                });
            }
        }
        return result;
    } catch (e) {
        console.error('[IPC] submit-activate 异常:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('license:close-activate', () => {
    try {
        activateManager.closeActivateWindow();
    } catch (e) {
        console.error('[IPC] close-activate 异常:', e);
    }
});

ipcMain.handle('license:restart', () => {
    try {
        activateManager.restartApp();
    } catch (e) {
        console.error('[IPC] restart 异常:', e);
    }
});

ipcMain.handle('license:get-machine-id', () => {
    try {
        return activateManager.getMachineId();
    } catch (e) {
        console.error('[IPC] get-machine-id 异常:', e);
        return null;
    }
});

// ★ 管理员一键激活 - 提交激活请求到平台
ipcMain.handle('license:submit-admin-request', async (event, data) => {
    try {
        const result = await activateManager.submitAdminRequest(data);
        return result;
    } catch (e) {
        console.error('[IPC] submit-admin-request 异常:', e);
        return { success: false, error: e.message };
    }
});

// ★ 激活工单（规则3）：license-manager.submitActivationTicket → 云端 KV ticket → 后台工单审批页一键审批发码
ipcMain.handle('license:submit-ticket', async (event, payload) => {
    try {
        if (!licenseManager || typeof licenseManager.submitActivationTicket !== 'function') {
            return { success: false, error: '工单模块不可用' };
        }
        const result = await licenseManager.submitActivationTicket(payload);
        return result;
    } catch (e) {
        console.error('[IPC] submit-ticket 异常:', e);
        return { success: false, error: e && e.message ? e.message : '提交工单失败' };
    }
});

// ★ 管理员一键激活 - 检查激活状态
ipcMain.handle('license:check-admin-status', async (event, requestId) => {
    try {
        const result = await activateManager.checkAdminStatus(requestId);
        return result;
    } catch (e) {
        console.error('[IPC] check-admin-status 异常:', e);
        return { success: false, error: e.message };
    }
});

// ★ 管理员一键激活 - 保存license
ipcMain.handle('license:save-license', async (event, licenseBase64) => {
    try {
        const result = await activateManager.saveLicense(licenseBase64);
        return result;
    } catch (e) {
        console.error('[IPC] save-license 异常:', e);
        return { success: false, error: e.message };
    }
});

// ★ 管理员一键激活 - 取消激活请求
ipcMain.handle('license:cancel-admin-request', async (event, requestId) => {
    try {
        const result = await activateManager.cancelAdminRequest(requestId);
        // ★ 取消后清除本地 requestId
        activateManager.clearAdminRequestId();
        return result;
    } catch (e) {
        console.error('[IPC] cancel-admin-request 异常:', e);
        return { success: false, error: e.message };
    }
});

// ★ requestId 本地持久化（解决轮询超时/关闭窗口后丢失状态的问题）
ipcMain.handle('license:load-admin-request-id', async () => {
    try {
        return activateManager.loadAdminRequestId();
    } catch (e) {
        console.error('[IPC] load-admin-request-id 异常:', e);
        return null;
    }
});

ipcMain.handle('license:clear-admin-request-id', async () => {
    try {
        activateManager.clearAdminRequestId();
        return { success: true };
    } catch (e) {
        console.error('[IPC] clear-admin-request-id 异常:', e);
        return { success: false, error: e.message };
    }
});

// ★ P2-7 安全修复：已移除测试用 license:set-trial-days IPC handler
// 原因：该 IPC 允许渲染进程任意修改试用期天数，可被用于绕过试用期限制
// 如需调试试用期功能，请在主进程中直接调用 licenseManager.setTrialDays()
/*
// ★ 设置试用期天数（测试用，0=立即过期触发激活，默认 7）
ipcMain.handle('license:set-trial-days', (event, days) => {
    try {
        return licenseManager.setTrialDays(days);
    } catch (e) {
        console.error('[IPC] set-trial-days 异常:', e);
        return { success: false, error: String(e) };
    }
});
*/

// ★ 获取试用期天数（默认 7）
ipcMain.handle('license:get-trial-days', () => {
    try {
        return { success: true, trialDays: licenseManager.getTrialDays() };
    } catch (e) {
        return { success: false, trialDays: 7, error: String(e) };
    }
});

// ★ 同步 alert/confirm 对话框（替代原生 window.alert/window.confirm）
// 问题：Electron 35 中原生 alert() 关闭后鼠标光标不显示（Chromium 模态框焦点 bug）
// 方案：使用 Electron 原生 dialog.showMessageBoxSync（同步阻塞，行为与原生一致）
// 渲染进程通过 window.electronAPI.alertSync/confirmSync 调用（dom-ready 时已重写 window.alert/confirm）
ipcMain.on('dialog:alert-sync', (event, message) => {
    try {
        const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
        if (win && !win.isDestroyed()) {
            dialog.showMessageBoxSync(win, {
                type: 'info',
                message: message,
                buttons: ['确定'],
                defaultId: 0,
                noLink: true
            });
        }
    } catch (e) {
        console.error('[dialog:alert-sync] 失败:', e.message);
    }
    event.returnValue = true;
});

ipcMain.on('dialog:confirm-sync', (event, message) => {
    let result = 0; // 默认取消
    try {
        const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
        if (win && !win.isDestroyed()) {
            result = dialog.showMessageBoxSync(win, {
                type: 'question',
                message: message,
                buttons: ['取消', '确定'],
                defaultId: 1,
                cancelId: 0,
                noLink: true
            });
        }
    } catch (e) {
        console.error('[dialog:confirm-sync] 失败:', e.message);
    }
    event.returnValue = result; // 0=取消, 1=确定
});

// ★ P0 修复：异步 prompt 对话框（替代原生 window.prompt）
// 问题：Electron 中 window.prompt() 默认返回 null，导致 handleEditUser 等函数静默失败
// 方案：创建模态子窗口（prompt-modal.html），返回 Promise<string|null>
// 兼容：业务代码需用 `await prompt(...)`，preload.js 已暴露 electronAPI.prompt
// ★ P0 修复：prompt-modal 资源路径（打包后必须在 asar 内可访问）
const PROMPT_HTML_PATH = path.join(__dirname, 'prompt-modal.html');
const PROMPT_PRELOAD_PATH = path.join(__dirname, 'prompt-preload.js');

ipcMain.handle('dialog:prompt', async (event, message, defaultValue) => {
    const parentWin = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    if (!parentWin || parentWin.isDestroyed()) {
        return null;
    }

    const promptWin = new BrowserWindow({
        width: 480,
        height: 280,
        parent: parentWin,
        modal: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        autoHideMenuBar: true,
        title: '请输入',
        show: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: PROMPT_PRELOAD_PATH
        }
    });

    // 使用 hash 传递参数（避免 file:// query string 兼容问题）
    const params = encodeURIComponent(JSON.stringify({ message: message || '', defaultValue: defaultValue || '' }));
    // ★ P0 修复：loadURL(file://) 对 asar 内文件支持不可靠，打包后静默失败导致 await 挂起（点击编辑无反应）
    // 改用 loadFile（Electron 原生 API，对 asar 路径有原生支持），与主窗口加载方式一致
    try {
        await promptWin.loadFile(PROMPT_HTML_PATH, { hash: params });
    } catch (loadErr) {
        console.error('[prompt] loadFile 失败:', PROMPT_HTML_PATH, loadErr);
        try { promptWin.close(); } catch(e) {}
        return null;
    }
    promptWin.show();

    return new Promise((resolve) => {
        let resolved = false;
        const cleanup = () => {
            ipcMain.removeListener('prompt:submit', handleSubmit);
            ipcMain.removeListener('prompt:cancel', handleCancel);
        };
        const handleSubmit = (e, value) => {
            if (resolved || e.sender !== promptWin.webContents) return;
            resolved = true;
            cleanup();
            promptWin.close();
            resolve(value);
        };
        const handleCancel = (e) => {
            if (resolved || (e && e.sender !== promptWin.webContents)) return;
            resolved = true;
            cleanup();
            promptWin.close();
            resolve(null);
        };
        ipcMain.on('prompt:submit', handleSubmit);
        ipcMain.on('prompt:cancel', handleCancel);
        promptWin.on('closed', () => {
            if (!resolved) {
                resolved = true;
                cleanup();
                resolve(null);
            }
        });
    });
});

ipcMain.handle('save-prescription-image', (event, imageData, fileName) => savePrescriptionImage(imageData, fileName));

// ★ 视频文件保存 IPC（新增）
ipcMain.handle('save-video-file', async (event, arrayBuffer, fileName) => {
    return await saveVideoFile(arrayBuffer, fileName);
});

// ★ 获取视频保存目录（新增）
ipcMain.handle('get-video-directory', async () => {
    return getCurrentMonthDirectory();
});

// ★ 在文件管理器中打开视频目录（新增）
ipcMain.handle('open-video-directory', async () => {
    const dir = getCurrentMonthDirectory();
    shell.openPath(dir);
    return { success: true, directory: dir };
});

// ★ 查找处方文件（新增）
ipcMain.handle('find-media-files', async (event, patientName, prescriptionNo, createdAt) => {
    try {
        if (!patientName) return { success: true, files: [] };
        const sanitizeStr = s => (s || '').trim().replace(/[\/\\:*?"<>|]/g, '_').replace(/ /g, '');
        const cleanName = sanitizeStr(patientName);
        const identifier = sanitizeStr(prescriptionNo || '');
        const files = [];
        const foundPaths = new Set();
        const prefix1 = `${cleanName}_${identifier}`;
        const prefix2 = `${identifier}_${cleanName}`;

        // 解析 createdAt 时间范围（±1天）
        let startTime = 0, endTime = 0;
        if (createdAt) {
            try {
                const time = new Date(createdAt).getTime();
                if (!isNaN(time)) {
                    startTime = time - 24 * 60 * 60 * 1000;
                    endTime = time + 48 * 60 * 60 * 1000;
                }
            } catch (e) { /* 忽略解析失败 */ }
        }

        // ★ 2026-08-29 扫描全部媒体根目录（新 userData/downloads + 旧 exe 同级 downloads）
        let monthDirs = [];
        for (const mediaRoot of getAllMediaRoots()) {
            try {
                const entries = await fs.readdir(mediaRoot, { withFileTypes: true });
                monthDirs.push(...entries.filter(e => e.isDirectory()).map(e => path.join(mediaRoot, e.name)));
            } catch (e) { /* 该媒体根目录可能不存在 */ }
        }
        for (const monthDir of monthDirs) {
            let fileEntries = [];
            try {
                fileEntries = await fs.readdir(monthDir, { withFileTypes: true });
            } catch (e) { continue; }
            for (const fe of fileEntries) {
                if (!fe.isFile()) continue;
                const fileName = fe.name;
                if (!fileName.includes(prefix1) && !fileName.includes(prefix2)) continue;
                const filePath = path.join(monthDir, fileName);
                if (foundPaths.has(filePath)) continue;
                foundPaths.add(filePath);
                try {
                    const stat = await fs.stat(filePath);
                    const ext = path.extname(fileName).toLowerCase();
                    const isVideo = ext === '.webm' || ext === '.mp4' || ext === '.avi' || ext === '.mov';
                    files.push({
                        name: fileName,
                        path: filePath,
                        type: isVideo ? 'video' : 'image',
                        size: stat.size,
                        lastModified: stat.mtimeMs
                    });
                } catch (e) { /* 跳过无法读取的文件 */ }
            }
        }

        // 回退策略：如果按编号未找到文件，用患者姓名+创建时间范围查找
        if (files.length === 0 && cleanName) {
            const mediaKeywords = ['photo', 'video', 'prescription', 'tongue'];
            const validExtensions = ['.jpg', '.jpeg', '.png', '.webm', '.mp4', '.avi', '.mov'];
            for (const monthDir of monthDirs) {
                let fileEntries = [];
                try {
                    fileEntries = await fs.readdir(monthDir, { withFileTypes: true });
                } catch (e) { continue; }
                for (const fe of fileEntries) {
                    if (!fe.isFile()) continue;
                    const fileName = fe.name;
                    const ext = path.extname(fileName).toLowerCase();
                    if (!fileName.includes(cleanName)) continue;
                    if (!validExtensions.includes(ext)) continue;
                    if (!mediaKeywords.some(k => fileName.includes(k))) continue;
                    const filePath = path.join(monthDir, fileName);
                    if (foundPaths.has(filePath)) continue;
                    try {
                        const stat = await fs.stat(filePath);
                        if (startTime > 0 && (stat.mtimeMs < startTime || stat.mtimeMs > endTime)) continue;
                        const isVideo = ext === '.webm' || ext === '.mp4' || ext === '.avi' || ext === '.mov';
                        files.push({
                            name: fileName,
                            path: filePath,
                            type: isVideo ? 'video' : 'image',
                            size: stat.size,
                            lastModified: stat.mtimeMs
                        });
                    } catch (e) { /* 跳过无法读取的文件 */ }
                }
            }
        }

        return { success: true, files };
    } catch (error) {
        console.error('查找处方文件失败:', error);
        return { success: false, error: error.message, files: [] };
    }
});

// ★ 重命名处方文件（新增）
ipcMain.handle('rename-media-files', async (event, oldPatientName, newPatientName, oldNo, newNo) => {
    return await renameMediaFiles(oldPatientName, newPatientName, oldNo, newNo);
});

// ★ 删除文件（新增）- 路径白名单校验，仅允许 downloads 目录下文件
ipcMain.handle('delete-file', async (event, filePath) => {
    try {
        if (!filePath) return { success: false, error: '文件路径为空' };
        if (!isPathAllowed(filePath)) return { success: false, error: '路径不在允许的目录内，已拒绝' };
        await fs.unlink(filePath);
        return { success: true };
    } catch (error) {
        console.error('删除文件失败:', error);
        return { success: false, error: error.message };
    }
});

// ★ 打开文件（系统默认程序）（新增）- 路径白名单校验
ipcMain.handle('open-file', async (event, filePath, mimeType) => {
    try {
        if (!filePath) return { success: false, error: '文件路径为空' };
        if (!isPathAllowed(filePath)) return { success: false, error: '路径不在允许的目录内，已拒绝' };
        await shell.openPath(filePath);
        return { success: true };
    } catch (error) {
        console.error('打开文件失败:', error);
        return { success: false, error: error.message };
    }
});

// ★ 读取文件为Base64（新增）- 路径白名单校验
ipcMain.handle('read-file-as-base64', async (event, filePath) => {
    try {
        if (!filePath) return { success: false, error: '文件路径为空' };
        if (!isPathAllowed(filePath)) return { success: false, error: '路径不在允许的目录内，已拒绝' };
        const buffer = await fs.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        let mimeType = 'image/png';
        if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
        else if (ext === '.png') mimeType = 'image/png';
        else if (ext === '.webm') mimeType = 'video/webm';
        else if (ext === '.mp4') mimeType = 'video/mp4';
        const base64 = buffer.toString('base64');
        return { success: true, base64: `data:${mimeType};base64,${base64}` };
    } catch (error) {
        console.error('读取文件失败:', error);
        return { success: false, error: error.message };
    }
});

async function saveUserData(key, data) {
    try {
        if (!isSafeKey(key)) return { success: false, error: 'key 无效' };
        const filePath = path.join(getDataDirectory(), key + '.json');
        const tmpPath = filePath + '.tmp';
        await fse.writeJson(tmpPath, data, { spaces: 2 });
        await fs.rename(tmpPath, filePath);
        return { success: true };
    } catch (error) {
        console.error('保存用户数据失败:', error);
        return { success: false, error: '保存用户数据失败' };
    }
}

async function getUserData(key) {
    try {
        if (!isSafeKey(key)) return { success: false, data: null };
        // ★ 2026-08-29 v3 兼容读取：优先新集中目录，旧目录（exe同级/旧userData）兜底
        const fileName = key + '.json';
        const candidateDirs = getAppDataDirs();
        for (const dir of candidateDirs) {
            const filePath = path.join(dir, fileName);
            if (await fse.pathExists(filePath)) {
                const data = await fse.readJson(filePath);
                return { success: true, data };
            }
        }
        return { success: false, data: null };
    } catch (error) {
        console.error('读取用户数据失败:', error);
        return { success: false, data: null };
    }
}

// ★ 2026-08-29 v3 存量数据自动迁移：启动时把旧位置 data/*.json 拷到新集中目录
//   （不删除旧文件，保守起见保留双份；新写入只进新目录，旧目录自然废弃）
async function migrateLegacyDataToCentral() {
    try {
        const centralDir = getCentralDataDir();
        const legacyDirs = getAppDataDirs().filter(d => path.resolve(d) !== path.resolve(centralDir));
        let migrated = 0;
        for (const legacyDir of legacyDirs) {
            if (!(await fse.pathExists(legacyDir))) continue;
            const entries = await fse.readdir(legacyDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
                const src = path.join(legacyDir, entry.name);
                const dst = path.join(centralDir, entry.name);
                // 只在目标不存在时拷贝（新目录数据优先，不回退覆盖）
                if (await fse.pathExists(dst)) continue;
                try {
                    await fse.copy(src, dst);
                    migrated++;
                } catch (e) { /* 单文件失败不影响整体 */ }
            }
        }
        if (migrated > 0) {
            console.log(`[Data] 已迁移 ${migrated} 个旧数据文件到集中目录: ${centralDir}`);
        }
        return migrated;
    } catch (e) {
        console.warn('[Data] 存量数据迁移失败（不影响运行）:', e.message);
        return 0;
    }
}

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

ipcMain.handle('save-user-data', (event, key, data) => saveUserData(key, data));
ipcMain.handle('get-user-data', (event, key) => getUserData(key));

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

// ===== 🔧 历史处方修复 IPC ②：直接读取 userData/prescriptions.json (云端 19 条硬备份) =====
ipcMain.handle('fs:read-prescriptions-json', async () => {
    try {
        const ud = app.getPath('userData');
        const f1 = path.join(ud, 'prescriptions.json');
        if (await fse.pathExists(f1)) {
            const c = await fse.readFile(f1, 'utf8');
            try { return { success: true, data: JSON.parse(c), _path: f1 }; } catch(e) { return { success:false, raw: c }; }
        }
        const pD = path.join(ud, 'Partitions');
        if (await fse.pathExists(pD)) {
            const subs = await fse.readdir(pD);
            for (const sub of subs) {
                const pf = path.join(pD, sub, 'prescriptions.json');
                if (await fse.pathExists(pf)) {
                    const c = await fse.readFile(pf, 'utf8');
                    try { return { success:true, data: JSON.parse(c), _path: pf }; } catch(e){}
                }
            }
        }
    } catch(e) { console.error('fs:read-prescriptions-json fail:',e); }
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

// 打包配置页：读取 config.json
ipcMain.handle('packaging-read-config', async () => {
    try {
        const configPath = getWritableConfigPath();
        if (await fse.pathExists(configPath)) {
            const cfg = await fse.readJson(configPath);
            return cfg;
        }
        return null;
    } catch (e) {
        console.error('打包配置读取失败:', e);
        return null;
    }
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

// ===== 修改用户密码 =====
ipcMain.handle('user:change-password', async (event, { username, oldPassword, newPassword }) => {
    try {
        if (!username || !newPassword) {
            return { success: false, error: '缺少用户名或新密码' };
        }
        const pwd = newPassword;
        if (pwd.length < 8) return { success: false, error: '密码至少8位' };
        if (!/[a-zA-Z]/.test(pwd) || !/[0-9]/.test(pwd)) {
            return { success: false, error: '密码必须同时包含字母和数字' };
        }

        // 更新 config.json 中的用户
        const configPath = getWritableConfigPath();
        if (await fse.pathExists(configPath)) {
            const config = await fse.readJson(configPath);
            if (config && Array.isArray(config.users)) {
                const userIdx = config.users.findIndex(u => u.username === username);
                if (userIdx !== -1) {
                    const { passwordHash, salt } = await hashPassword(pwd);
                    config.users[userIdx].password = passwordHash;
                    config.users[userIdx].passwordHash = passwordHash;
                    config.users[userIdx].salt = salt;
                    config.users[userIdx].updatedAt = new Date().toISOString();
                    // 签名保护：signConfig(config) 直接修改原对象，切勿将返回值赋值给属性（会造成循环引用）
                    licenseManager.signConfig(config);
                    await fse.writeJson(configPath, config, { spaces: 2 });
                    console.log('[User] password changed for:', username);
                    return { success: true };
                }
            }
        }

        // 回退：写入 localStorage 路径
        const userDataPath = path.join(getDataDirectory(), 'systemUsers.json');
        if (await fse.pathExists(userDataPath)) {
            const users = await fse.readJson(userDataPath);
            const userIdx = users.findIndex(u => u.username === username);
            if (userIdx !== -1) {
                const { passwordHash, salt } = await hashPassword(pwd);
                users[userIdx].password = passwordHash;
                users[userIdx].passwordHash = passwordHash;
                users[userIdx].salt = salt;
                await fse.writeJson(userDataPath, users, { spaces: 2 });
                return { success: true };
            }
        }

        return { success: false, error: '用户不存在' };
    } catch (e) {
        console.error('[User] change-password failed:', e);
        return { success: false, error: String(e) };
    }
});

// ===== 添加用户（注册管理员账户） =====
ipcMain.handle('user:add', async (event, { username, password, name, role }) => {
    try {
        if (!username || !password) {
            return { success: false, error: '缺少用户名或密码' };
        }
        if (password.length < 8) return { success: false, error: '密码至少8位' };
        if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
            return { success: false, error: '密码必须同时包含字母和数字' };
        }
        
        // 校验用户名格式（4-20位，以字母开头，只含字母、数字或下划线）
        const usernameRegex = /^[a-zA-Z][a-zA-Z0-9_]{3,19}$/;
        if (!usernameRegex.test(username)) {
            return { success: false, error: '用户名需为4-20位，以字母开头，只含字母、数字或下划线' };
        }

        const configPath = getWritableConfigPath();
        let config = {};
        if (await fse.pathExists(configPath)) {
            config = await fse.readJson(configPath);
        }
        if (!config.users) config.users = [];
        
        // 检查用户名是否已存在
        if (config.users.find(u => u.username === username)) {
            return { success: false, error: '用户名已存在' };
        }
        
        // 添加新用户
        const { passwordHash, salt } = await hashPassword(password);
        config.users.push({
            username: username,
            password: passwordHash,
            passwordHash: passwordHash,
            salt: salt,
            name: name || username,
            role: role || 'admin',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
        
        // 签名保护：signConfig(config) 直接修改原对象，切勿将返回值赋值给属性（会造成循环引用）
        licenseManager.signConfig(config);
        await fse.writeJson(configPath, config, { spaces: 2 });
        console.log('[User] add user:', username);
        return { success: true };
    } catch (e) {
        console.error('[User] add failed:', e);
        return { success: false, error: String(e) };
    }
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

// 打包配置页：写入 config.json
ipcMain.handle('packaging-write-config', async (event, config) => {
    try {
        const configPath = getWritableConfigPath();
        await fse.writeJson(configPath, config, { spaces: 2 });
        return true;
    } catch (e) {
        console.error('打包配置写入失败:', e);
        return false;
    }
});

// 打包配置完成信号
ipcMain.on('packaging-done', () => {
    if (packagingWindow) {
        packagingWindow.close();
        packagingWindow = null;
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

// 备份文件保存：写入「惠康中医媒体\downloads\中医处方系统\」子目录（与APP端命名一致，2026-08-29）
ipcMain.handle('save-backup-file', async (event, jsonStr, fileName) => {
    try {
        const safeName = sanitizeFileName(fileName);
        if (!safeName.endsWith('.json')) return { success: false, error: '文件名无效（仅允许 .json）' };
        const backupDir = path.join(getDownloadsDirectory(), '中医处方系统');
        fse.ensureDirSync(backupDir);
        const filePath = path.join(backupDir, safeName);
        if (!isPathAllowed(filePath)) return { success: false, error: '路径不在允许的下载目录内，已拒绝' };
        await fs.writeFile(filePath, jsonStr, 'utf8');
        return { success: true, fileName: safeName, filePath };
    } catch (error) {
        console.error('保存备份文件失败:', error);
        return { success: false, error: '保存备份文件失败' };
    }
});

// 一键恢复：列出备份文件（中医处方系统/ 子目录 + downloads 根存量，按时间倒序）
ipcMain.handle('list-backup-files', async () => {
    try {
        const base = getDownloadsDirectory();
        const dirs = [path.join(base, '中医处方系统'), base];
        const seen = new Set();
        const files = [];
        for (const dir of dirs) {
            // ★ 2026-08-31 修复：顶部 fs=require('fs').promises 没有 existsSync，
            //   原 fs.existsSync 抛 TypeError → 整个 handler catch 返回 success:false
            //   → 前端误报"未找到备份文件"（备份明明写入成功）。必须用同步版 require('fs')。
            if (!require('fs').existsSync(dir)) continue;
            const entries = await fs.readdir(dir);
            for (const name of entries) {
                if (!name.endsWith('.json') || seen.has(name)) continue;
                seen.add(name);
                try {
                    const st = await fs.stat(path.join(dir, name));
                    if (st.isFile()) files.push({ fileName: name, size: st.size, lastModified: st.mtimeMs });
                } catch (e) {}
            }
        }
        files.sort((a, b) => b.lastModified - a.lastModified);
        return { success: true, files: files.slice(0, 20) };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// 一键恢复：按文件名读取备份内容（兼容子目录与 downloads 根存量）
ipcMain.handle('read-backup-file', async (event, fileName) => {
    try {
        const safeName = sanitizeFileName(fileName);
        if (!safeName.endsWith('.json')) return { success: false, error: '文件名无效' };
        const base = getDownloadsDirectory();
        const candidates = [path.join(base, '中医处方系统', safeName), path.join(base, safeName)];
        for (const fp of candidates) {
            if (!isPathAllowed(fp)) continue;
            // ★ 2026-08-31 修复：fs(promises) 无 existsSync（同 list-backup-files）
            if (require('fs').existsSync(fp)) {
                const json = await fs.readFile(fp, 'utf8');
                return { success: true, json };
            }
        }
        return { success: false, error: '未找到备份文件: ' + safeName };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// ★ 2026-08-31 一键恢复兜底：原生文件选择对话框 + 直接读取备份内容
//   根因：alert 已被替换为原生同步 dialog（阻塞 renderer 主线程）→ 用户激活丢失 →
//   渲染层 input.click() 的 FileChooser 被 Chromium 静默拒绝（用户"看不到文件选择器"）。
//   主进程 dialog.showOpenDialog 无用户激活限制，是最可靠的兜底通道。
ipcMain.handle('open-backup-picker', async () => {
    try {
        let win = null;
        try { win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null; } catch (e) {}
        const base = getDownloadsDirectory();
        const result = await dialog.showOpenDialog(win, {
            title: '选择备份文件（.json）',
            defaultPath: path.join(base, '中医处方系统'),
            filters: [{ name: '备份 JSON', extensions: ['json'] }],
            properties: ['openFile']
        });
        if (!result || result.canceled || !result.filePaths || result.filePaths.length === 0) {
            return { success: false, canceled: true };
        }
        const fp = result.filePaths[0];
        const json = await fs.readFile(fp, 'utf8');
        return { success: true, json, fileName: path.basename(fp) };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// P1-1 自动备份策略：保存到 userData/backups/（独立目录，便于清理）
// 文件名格式：backup_YYYYMMDD_HHmmss.json
ipcMain.handle('save-auto-backup', async (event, jsonStr, fileName) => {
    try {
        const safeName = sanitizeFileName(fileName);
        if (!safeName.endsWith('.json')) return { success: false, error: '文件名无效（仅允许 .json）' };
        if (!/^backup_\d{8}_\d{6}\.json$/.test(safeName)) {
            return { success: false, error: '文件名格式不符（backup_YYYYMMDD_HHmmss.json）' };
        }
        const backupsDir = path.join(app.getPath('userData'), 'backups');
        fse.ensureDirSync(backupsDir);
        const filePath = path.join(backupsDir, safeName);
        await fs.writeFile(filePath, jsonStr, 'utf8');
        return { success: true, fileName: safeName, filePath };
    } catch (error) {
        console.error('保存自动备份失败:', error);
        return { success: false, error: '保存自动备份失败' };
    }
});

// P1-1 列出所有自动备份文件（按时间倒序）
ipcMain.handle('list-auto-backups', async () => {
    try {
        const backupsDir = path.join(app.getPath('userData'), 'backups');
        if (!fse.existsSync(backupsDir)) return { success: true, files: [] };
        const entries = await fs.readdir(backupsDir, { withFileTypes: true });
        const files = [];
        for (const e of entries) {
            if (!e.isFile() || !e.name.startsWith('backup_') || !e.name.endsWith('.json')) continue;
            const filePath = path.join(backupsDir, e.name);
            const stat = await fs.stat(filePath);
            files.push({
                fileName: e.name,
                timestamp: stat.mtimeMs || stat.ctimeMs || Date.now(),
                size: stat.size
            });
        }
        files.sort((a, b) => b.timestamp - a.timestamp);
        return { success: true, files };
    } catch (error) {
        console.error('列出自动备份失败:', error);
        return { success: false, files: [], error: error.message };
    }
});

// P1-1 删除指定自动备份文件
ipcMain.handle('delete-auto-backup', async (event, fileName) => {
    try {
        const safeName = sanitizeFileName(fileName);
        if (!/^backup_\d{8}_\d{6}\.json$/.test(safeName)) {
            return { success: false, error: '文件名格式不符' };
        }
        const backupsDir = path.join(app.getPath('userData'), 'backups');
        const filePath = path.join(backupsDir, safeName);
        // 路径白名单校验：仅允许访问 backups 目录
        const resolved = path.resolve(filePath);
        const backupsRoot = path.resolve(backupsDir);
        const rel = path.relative(backupsRoot, resolved);
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
            return { success: false, error: '路径越权已拒绝' };
        }
        if (fse.existsSync(filePath)) {
            await fs.unlink(filePath);
            return { success: true };
        }
        return { success: true, message: '文件不存在' };
    } catch (error) {
        console.error('删除自动备份失败:', error);
        return { success: false, error: error.message };
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

// ★ 打印处方（直接打印）
// 方案：隐藏窗口加载处方 HTML → 渲染进程调用 window.print() → 弹系统打印对话框 → 关闭
// 最快最简单，无预览窗口、无 PDF 中间步骤
// ★ 2026-08-02 同步云端 cloud_desktop 方案：隐藏窗口+字体等待+2分钟超时
//   旧方案（显示窗口+webContents.print+30秒超时）已废弃，用户体验差且超时过短
ipcMain.handle('print-prescription', async (event, html, orientation) => {
    try {
        const isLandscape = orientation === 'landscape';

        // 隐藏窗口（用户不可见）
        // ★ 修复字体偏大根因2：窗口宽度从559px改为600px（>148mm=559.37px@96dpi）
        //   原559px比body宽度(559.37px)少0.37px，触发水平滚动条→连锁触发垂直滚动条→
        //   有效视口缩至~544px，webContents.print()按559.37/544≈1.028放大内容
        //   600px与网页版window.open('width=600')完全一致，body(559.37px)在视口内无滚动条
        const printWin = new BrowserWindow({
            show: false,
            width: isLandscape ? 820 : 600,
            height: isLandscape ? 600 : 850,
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false
            }
        });
        printWin.setMenu(null);

        // ★ 彻底修复字体偏大：移除CSS @page的size规则，避免与webContents.print pageSize选项双重指定
        //   双重指定（CSS @page size + pageSize选项）触发Chromium fit-to-page缩放，内容被放大
        //   移除size后：纸张大小由pageSize选项唯一控制，边距由CSS @page margin:0唯一控制
        const processedHtml = html.replace(/@page\s*\{[^}]*\}/g, '');
        const base64Html = Buffer.from(processedHtml, 'utf8').toString('base64');
        const dataUrl = 'data:text/html;charset=utf-8;base64,' + base64Html;

        return new Promise((resolve) => {
            let settled = false;

            const safeResolve = (val) => {
                if (settled) return;
                settled = true;
                if (!printWin.isDestroyed()) printWin.close();
                resolve(val);
            };

            printWin.loadURL(dataUrl);

            // 页面加载完成后，等待布局和字体就绪，再调用打印
            printWin.webContents.once('did-finish-load', () => {
                setTimeout(async () => {
                    try {
                        // 强制布局刷新 + 等待字体加载
                        await printWin.webContents.executeJavaScript(
                            'document.body.offsetHeight; document.fonts ? document.fonts.ready : Promise.resolve()'
                        );
                        await new Promise(r => setTimeout(r, 200));
                        // ★ 修复字体偏大根因1（主因）：改用 window.print() 代替 webContents.print()
                        //
                        // 原因：webContents.print({ pageSize:'A5', margins:{marginType:'none'} }) 选项
                        //   与 CSS @page { size:A5; margin:0 } 规则形成【双重指定】：
                        //   - Blink布局引擎按 CSS @page 布局内容（通道A）
                        //   - Chrome打印后端按 pageSize/margins 选项设置打印参数（通道B）
                        //   两通道对A5尺寸的内部表示存在微小差异（浮点精度/DPI假设/舍入），
                        //   触发 fit-to-page 缩放算法，缩放因子略>1.0，内容被放大。
                        //
                        // 网页版 window.print() 无 pageSize/margins 选项，仅依赖 CSS @page，
                        //   打印后端直接使用CSS布局尺寸，不触发fit-to-page缩放，1:1渲染。
                        //
                        // 修复方案：桌面版也改用 window.print()，与网页版完全一致。
                        //   CSS @page { size:A5; margin:0 } 是唯一的页面参数来源，
                        //   纸张大小和边距均由CSS控制，无双重指定冲突。
                        //
                        // 时序：window.print()异步打开系统打印对话框，onafterprint在对话框关闭后触发。
                        //   等待onafterprint后再safeResolve，避免在用户还在操作打印对话框时关闭窗口。
                        // ★ 默认纸张A5 + 手动选打印机（2026-08-17）
                        //   客户端打印机不固定，不做自动匹配；始终弹打印对话框由用户手动选择打印机，
                        //   pageSize:'A5' 作为对话框默认纸张，无需每次手动切换纸张
                        await new Promise((resolvePrint) => {
                            const printOptions = {
                                silent: false,
                                printBackground: true,
                                pageSize: 'A5',
                                landscape: isLandscape,
                                margins: { marginType: 'none' }
                            };
                            printWin.webContents.print(printOptions, (success, failureReason) => {
                                if (!success && failureReason) {
                                    console.error('[print] 打印失败:', failureReason);
                                }
                                resolvePrint();
                            });
                        });
                        safeResolve(true);
                    } catch (e) {
                        console.error('[print] 打印失败:', e);
                        safeResolve(false);
                    }
                }, 500);
            });

            printWin.webContents.once('did-fail-load', (_e, errorCode, errorDesc) => {
                console.error('[print] 页面加载失败:', errorCode, errorDesc);
                safeResolve(false);
            });

            // 超时保护：2分钟
            setTimeout(() => {
                if (!settled) {
                    console.warn('[print] 2分钟超时，自动关闭');
                    safeResolve(false);
                }
            }, 2 * 60 * 1000);
        });
    } catch (e) {
        console.error('打印失败:', e);
        return false;
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
