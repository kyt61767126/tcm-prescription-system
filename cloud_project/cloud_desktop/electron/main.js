const { app, BrowserWindow, ipcMain, dialog, session, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fse = require('fs-extra');
const Database = require('better-sqlite3');
const licenseManager = require('./license-manager');
const prescriptionCounter = require('./prescription-counter');
const featureGuard = require('./feature-guard');
const activateManager = require('./activate');
const updateNotifier = require('./update-notifier');

let mainWindow;
let loginWindow;
let sharedSession;
let currentLoggedInUser = null;

// 本地离线数据库（better-sqlite3），与 APP 端 SQLite 离线方案语义保持一致
let db = null;

// 全局异常处理：防止未捕获异常导致应用崩溃
process.on('uncaughtException', (e) => {
    console.error('未捕获异常:', e);
});
process.on('unhandledRejection', (e) => {
    console.error('未处理的Promise拒绝:', e);
});

// 单例锁：防止多实例运行
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

// 安全 IPC handler 包装器：自动捕获异常，防止渲染进程崩溃
function safeHandle(channel, handler, defaultValue) {
    ipcMain.handle(channel, async (event, ...args) => {
        try {
            return await handler(event, ...args);
        } catch (e) {
            console.error(`IPC ${channel} 异常:`, e);
            return defaultValue !== undefined ? defaultValue : { success: false, error: e.message };
        }
    });
}

// 命令行开关：仅启用媒体流（录像所需）
// 已移除的安全风险开关：
//   - enable-usermedia-screen-capturing：屏幕捕获，录像用不到
//   - use-fake-ui-for-media-stream：自动批准媒体流，可被滥用（已由 setPermissionRequestHandler 白名单授权替代）
//   - allow-file-access-from-files：file:// 访问 file://，XSS 风险（云端桌面不需要）
app.commandLine.appendSwitch('enable-features', 'WebDialog');
app.commandLine.appendSwitch('enable-media-stream');

// ★ 已移除原 `app.on('browser-window-created', ...)` 中的 HTML 模态框注入方案
// 原因：该方案将 confirm 改为返回 Promise，破坏了 `if (!confirm(...)) return;` 同步语义
//      （Promise 是 truthy，导致删除等危险操作不弹窗直接执行）
// 现方案：使用 Electron 原生 dialog.showMessageBoxSync（同步阻塞，行为与原生一致）
//        由 dom-ready 时注入的代码重写 window.alert/confirm 调用 electronAPI.alertSync/confirmSync

function getExeDirectory() {
    if (process.env.PORTABLE_EXECUTABLE_DIR) {
        return process.env.PORTABLE_EXECUTABLE_DIR;
    }
    return path.dirname(app.getPath('exe'));
}

function getDownloadsDirectory() {
    const exeDir = getExeDirectory();
    const downloadsPath = path.join(exeDir, 'downloads');
    
    try {
        fse.ensureDirSync(downloadsPath);
        return downloadsPath;
    } catch (error) {
        console.error('无法在程序目录创建downloads文件夹:', error);
        const userDataPath = app.getPath('userData');
        const fallbackPath = path.join(userDataPath, 'downloads');
        fse.ensureDirSync(fallbackPath);
        return fallbackPath;
    }
}

function getCurrentMonthFolder() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

function getCurrentMonthDirectory() {
    const downloadsDir = getDownloadsDirectory();
    const monthFolder = getCurrentMonthFolder();
    const monthDir = path.join(downloadsDir, monthFolder);
    
    try {
        fse.ensureDirSync(monthDir);
        return monthDir;
    } catch (error) {
        console.error('创建月份目录失败:', error);
        throw error;
    }
}

// ★ 路径白名单校验：仅允许访问 downloads 目录及其子目录下的文件
// 防止恶意渲染进程通过 IPC 读取/删除/打开系统任意文件（如 C:\Windows\system32）
function getAllowedRoots() {
    const roots = new Set();
    try { roots.add(path.resolve(getDownloadsDirectory())); } catch(e) {}
    try { roots.add(path.resolve(app.getPath('userData'), 'downloads')); } catch(e) {}
    return Array.from(roots);
}

function isPathAllowed(filePath) {
    if (!filePath || typeof filePath !== 'string') return false;
    try {
        const resolved = path.resolve(filePath);
        for (const root of getAllowedRoots()) {
            const rel = path.relative(root, resolved);
            // 在允许目录内：相对路径不以 .. 开头，且不是绝对路径
            if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
                return true;
            }
        }
        console.warn('[路径校验] 拒绝访问:', filePath);
        return false;
    } catch (e) {
        console.warn('[路径校验] 异常:', e.message);
        return false;
    }
}

// ★ 安全文件名清理：剥离目录部分，过滤危险字符，防止路径穿越
function sanitizeFileName(fileName) {
    if (!fileName || typeof fileName !== 'string') return '';
    // 剥离目录部分，仅保留文件名
    let name = path.basename(fileName);
    // 过滤危险字符（与 renameMediaFiles 的 sanitizeStr 一致）
    name = name.replace(/[\/\\:*?"<>|]/g, '_').replace(/ /g, '');
    // 防御 .. 穿越（path.basename 已剥离，但双重保险）
    name = name.replace(/\.\./g, '_');
    return name;
}

// ★ 安全 key 校验：仅允许字母数字下划线短横，防止 save-user-data 路径越权
function isSafeKey(key) {
    if (!key || typeof key !== 'string') return false;
    return /^[a-zA-Z0-9_-]{1,64}$/.test(key);
}

async function savePrescriptionImage(imageData, fileName) {
    try {
        const safeName = sanitizeFileName(fileName);
        if (!safeName) return { success: false, error: '文件名无效' };
        const monthDir = getCurrentMonthDirectory();

        const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        const filePath = path.join(monthDir, safeName);
        if (!isPathAllowed(filePath)) return { success: false, error: '路径不在允许的下载目录内，已拒绝' };
        await fs.writeFile(filePath, buffer);

        console.log('图片已保存:', filePath);
        return { success: true, filePath, directory: monthDir };
    } catch (error) {
        console.error('保存图片失败:', error);
        return { success: false, error: '保存图片失败' };
    }
}

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

async function saveVideoFile(arrayBuffer, fileName) {
    try {
        const safeName = sanitizeFileName(fileName);
        if (!safeName) return { success: false, error: '文件名无效' };
        const monthDir = getCurrentMonthDirectory();
        const buffer = Buffer.from(arrayBuffer);
        let finalName = safeName;
        if (!finalName.endsWith('.webm')) {
            const base = finalName.replace(/\.[^.]+$/, '');
            finalName = base + '.webm';
        }
        const filePath = path.join(monthDir, finalName);
        if (!isPathAllowed(filePath)) return { success: false, error: '路径不在允许的下载目录内，已拒绝' };
        await fs.writeFile(filePath, buffer);
        console.log('视频已保存:', filePath);
        return { success: true, filePath, directory: monthDir };
    } catch (error) {
        console.error('保存视频失败:', error);
        return { success: false, error: '保存视频失败' };
    }
}

// ★ 重命名处方文件（处方保存后云端分配新编号时同步重命名本地文件）
async function renameMediaFiles(patientName, oldNo, newNo) {
    try {
        const sanitizeStr = s => (s || '').trim().replace(/[\/\\:*?"<>|]/g, '_').replace(/ /g, '');
        const cleanName = sanitizeStr(patientName);
        const cleanOldNo = sanitizeStr(oldNo);
        const cleanNewNo = sanitizeStr(newNo);
        if (!cleanName || !cleanOldNo || !cleanNewNo || cleanOldNo === cleanNewNo) {
            return { success: true, renamed: 0 };
        }
        const oldPrefixes = [
            `${cleanName}_${cleanOldNo}`,
            `${cleanOldNo}_${cleanName}`
        ];
        const newPrefixes = [
            `${cleanName}_${cleanNewNo}`,
            `${cleanNewNo}_${cleanName}`
        ];
        
        const searchDirectories = [];
        const currentDownloadsDir = getDownloadsDirectory();
        searchDirectories.push(currentDownloadsDir);
        
        const userDataDownloadsDir = path.join(app.getPath('userData'), 'downloads');
        if (userDataDownloadsDir !== currentDownloadsDir) {
            searchDirectories.push(userDataDownloadsDir);
        }
        
        const exeDir = getExeDirectory();
        const parentExeDir = path.dirname(exeDir);
        const parentDownloadsDir = path.join(parentExeDir, 'downloads');
        if (parentDownloadsDir !== currentDownloadsDir && parentDownloadsDir !== userDataDownloadsDir) {
            searchDirectories.push(parentDownloadsDir);
        }
        
        let renamed = 0;
        
        for (const downloadsDir of searchDirectories) {
            let monthDirs = [];
            try {
                const entries = await fs.readdir(downloadsDir, { withFileTypes: true });
                monthDirs = entries.filter(e => e.isDirectory()).map(e => path.join(downloadsDir, e.name));
            } catch (e) { /* downloads目录可能不存在 */ }
            
            for (const monthDir of monthDirs) {
                let fileEntries = [];
                try {
                    fileEntries = await fs.readdir(monthDir, { withFileTypes: true });
                } catch (e) { continue; }
                
                for (const fe of fileEntries) {
                    if (!fe.isFile()) continue;
                    const fileName = fe.name;
                    
                    let matchedIndex = -1;
                    for (let i = 0; i < oldPrefixes.length; i++) {
                        if (fileName.includes(oldPrefixes[i])) {
                            matchedIndex = i;
                            break;
                        }
                    }
                    
                    if (matchedIndex === -1) continue;
                    
                    const newFileName = fileName.replace(oldPrefixes[matchedIndex], newPrefixes[matchedIndex]);
                    if (newFileName === fileName) continue;
                    
                    try {
                        await fs.rename(path.join(monthDir, fileName), path.join(monthDir, newFileName));
                        renamed++;
                        console.log('[重命名文件]', fileName, '->', newFileName);
                    } catch (e) { 
                        console.error('[重命名文件失败]', fileName, e.message);
                    }
                }
            }
        }
        return { success: true, renamed };
    } catch (error) {
        console.error('重命名处方文件失败:', error);
        return { success: false, error: error.message, renamed: 0 };
    }
}

function saveLoginState(hasLoggedIn, user = null) {
    try {
        const userDataPath = app.getPath('userData');
        const settingsPath = path.join(userDataPath, 'login-state.json');
        fse.writeJsonSync(settingsPath, { hasLoggedIn, user }, { spaces: 2 });
        if (user) {
            currentLoggedInUser = user;
        }
    } catch (e) {
        console.log('保存登录状态失败:', e);
    }
}

function restoreLoginState() {
    try {
        const userDataPath = app.getPath('userData');
        const settingsPath = path.join(userDataPath, 'login-state.json');
        if (fse.pathExistsSync(settingsPath)) {
            const data = fse.readJsonSync(settingsPath);
            if (data && data.hasLoggedIn && data.user) {
                currentLoggedInUser = data.user;
                console.log('已恢复登录用户:', data.user.username);
                return true;
            }
        }
    } catch (e) {
        console.log('恢复登录状态失败:', e);
    }
    return false;
}

// 初始化本地离线数据库（better-sqlite3），建表 SQL 与 APP 端 SQLite 完全一致
function initDatabase() {
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'tcm_prescription.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
        CREATE TABLE IF NOT EXISTS prescriptions (
          id INTEGER PRIMARY KEY,
          data TEXT NOT NULL,
          updated_at TEXT,
          updated_at_ms INTEGER,
          created_by TEXT,
          synced INTEGER DEFAULT 0,
          deleted INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_pres_synced ON prescriptions(synced);
        CREATE INDEX IF NOT EXISTS idx_pres_user ON prescriptions(created_by);
        CREATE TABLE IF NOT EXISTS cache_kv (
          key TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          cached_at TEXT
        );
        CREATE TABLE IF NOT EXISTS sync_status (
          id INTEGER PRIMARY KEY DEFAULT 1,
          last_push TEXT,
          last_pull TEXT,
          pending_count INTEGER DEFAULT 0
        );
    `);
    console.log('本地离线数据库已初始化:', dbPath);
}

function createLoginWindow() {
    if (loginWindow && !loginWindow.isDestroyed()) {
        if (loginWindow.isMinimized()) loginWindow.restore();
        loginWindow.focus();
        return;
    }
    
    loginWindow = null;
    
    loginWindow = new BrowserWindow({
        width: 260,
        height: 380,
        resizable: false,
        autoHideMenuBar: true,
        center: true,
        maximizable: false,
        minimizable: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            session: sharedSession
        }
    });

    const loginPath = path.join(__dirname, 'login.html');
    loginWindow.loadFile(loginPath);

    loginWindow.once('ready-to-show', () => {
        loginWindow.show();
    });

    // 安全加固：登录窗口也禁止外部导航和弹窗
    loginWindow.webContents.on('will-navigate', (event, navigationUrl) => {
        const parsedUrl = new URL(navigationUrl);
        if (parsedUrl.protocol !== 'file:') {
            event.preventDefault();
            console.warn('登录窗口拦截外部导航:', navigationUrl);
        }
    });
    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
        console.warn('登录窗口拦截弹窗:', url);
        return { action: 'deny' };
    });

    loginWindow.on('closed', () => {
        loginWindow = null;
    });
}

function createMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
        mainWindow = null;
    }
    
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        autoHideMenuBar: true,
        center: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            session: sharedSession
        }
    });

    const indexPath = path.join(__dirname, '..', 'index.html');
    mainWindow.loadFile(indexPath);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // 生产环境安全配置：禁用开发者工具和右键菜单
    const isDev = process.env.ELECTRON_DEV === '1' || process.defaultApp;
    if (!isDev) {
        mainWindow.webContents.on('devtools-opened', () => {
            mainWindow.webContents.closeDevTools();
        });
        mainWindow.setMenu(null);
    }

    // 安全加固：禁止导航到外部 URL（防止钓鱼攻击）
    mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
        const parsedUrl = new URL(navigationUrl);
        // 仅允许 file: 协议（本地文件）
        if (parsedUrl.protocol !== 'file:') {
            event.preventDefault();
            console.warn('拦截外部导航:', navigationUrl);
        }
    });

    // 安全加固：禁止新窗口弹窗（所有 window.open 在当前窗口内打开）
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        console.warn('拦截弹窗:', url);
        return { action: 'deny' };
    });

    mainWindow.webContents.on('dom-ready', async () => {
        if (currentLoggedInUser) {
            const userJson = JSON.stringify(currentLoggedInUser).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            mainWindow.webContents.executeJavaScript(`
                (function() {
                    localStorage.setItem('cloud_currentUser', '${userJson}');
                    localStorage.setItem('cloud_isLoggedIn', 'true');
                    sessionStorage.setItem('currentUser', '${userJson}');
                    sessionStorage.setItem('isLoggedIn', 'true');
                    if (document.getElementById('loginOverlay')) {
                        document.getElementById('loginOverlay').style.display = 'none';
                    }
                    // ★ 防御性修复：提前显示 main-container，防止 init() 异常导致空白
                    var mc = document.querySelector('.main-container');
                    if (mc) mc.style.display = 'flex';
                    if (typeof updateUserDisplay === 'function') {
                        try { updateUserDisplay(); } catch(e) {}
                    }
                    if (typeof loadData === 'function') {
                        try { loadData(); } catch(e) {}
                    }
                })();
            `).catch(() => {});
        }
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
                console.log('[FIX] alert/confirm 已替换为 Electron 原生同步 dialog');
            })();`;
            await mainWindow.webContents.executeJavaScript(fixCode);
            console.log('[FIX] 原生同步 dialog 注入完成');
        } catch(e) { console.warn('[FIX] 原生同步 dialog 注入失败:', e.message); }
    });
    
    if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.close();
        loginWindow = null;
    }
}

app.whenReady().then(async () => {
    // ★ License 授权校验（启动时校验，未授权或过期则弹双按钮：前往激活/退出软件）
    const licenseResult = licenseManager.validateLicense();
    console.log('[License]', licenseResult.type, licenseResult.message);
    if (!licenseResult.valid) {
        // ★ 启动时 license 失效：弹双按钮到期提示（前往激活/退出软件）
        // - 用户点击【前往激活】→ 唤起激活码输入页面，激活成功后重启进入主界面
        // - 用户点击【退出软件】→ app.exit(0) 退出
        // - 启动时 mainWindow 尚未创建，传 null 作为 parentWindow
        // - 激活窗口关闭后 license 仍失效时，兜底逻辑会重新弹 expire-alert
        await activateManager.showExpireAlertAndActivate(null, licenseResult.message);
        return;
    }
    if (licenseResult.type === 'trial') {
        console.log('[License] 试用模式：', licenseResult.message);
    }

    // ★ 启动自动更新检查（第4周任务，延迟 5 秒检查避免影响启动）
    updateNotifier.init('cloud');

    // 初始化本地离线数据库（建表，幂等）
    try {
        initDatabase();
    } catch (e) {
        console.error('初始化本地离线数据库失败:', e);
    }

    fse.ensureDirSync(getDownloadsDirectory());
    
    sharedSession = session.fromPartition('persist:tcm-prescription-cloud');

    // 安装 CSP（P2-1: 收紧 Content-Security-Policy）
    // - 增加 object-src 'none' 禁止插件加载（防 Flash/PDF 漏洞）
    // - 增加 base-uri 'self' 防 base 标签劫持
    // - 增加 form-action 'self' 防表单提交到第三方
    // - 增加 frame-ancestors 'none' 防点击劫持
    // - connect-src 收紧：移除 *.workers.dev 通配，仅允许明确域名
    sharedSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https://tcm-prescription-system.pages.dev https://*.cloudflareaccess.com; " +
                    "img-src 'self' data: blob: https:; " +
                    "media-src 'self' blob: data: https:; " +
                    "connect-src 'self' https://tcm-prescription-system.pages.dev; " +
                    "font-src 'self' data:; " +
                    "style-src 'self' 'unsafe-inline'; " +
                    "object-src 'none'; " +
                    "base-uri 'self'; " +
                    "form-action 'self'; " +
                    "frame-ancestors 'none'; " +
                    "worker-src 'self' blob:;"
                ]
            }
        });
    });

    // 授予 camera/microphone 权限（视频录制所需）
    // P1-3 修复：增加 URL 来源校验，仅允许本地 file:// 和官方域名请求媒体权限
    // 防止 XSS 注入后从非白名单来源调用 getUserMedia 访问摄像头/麦克风
    const ALLOWED_HOSTS = ['tcm-prescription-system.pages.dev', 'localhost', '127.0.0.1'];
    function isUrlAllowed(urlStr) {
        if (!urlStr) return false;
        try {
            const u = new URL(urlStr);
            // file:// 协议（本地加载的 index.html）始终允许
            if (u.protocol === 'file:') return true;
            // https 白名单域名
            if (u.protocol === 'https:' && ALLOWED_HOSTS.includes(u.hostname)) return true;
            // 本地开发 http
            if (u.protocol === 'http:' && ALLOWED_HOSTS.includes(u.hostname)) return true;
            return false;
        } catch (e) {
            return false;
        }
    }

    sharedSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const url = webContents.getURL();
        const allowed = isUrlAllowed(url);
        console.log('[权限请求]', permission, 'from', url, '->', allowed ? '允许' : '拒绝');
        if (!allowed) {
            callback(false);
            return;
        }
        if (permission === 'media' || permission === 'camera' || permission === 'microphone') {
            callback(true);
        } else {
            callback(false);
        }
    });

    // 在主窗口创建前预先授权设备访问
    if (sharedSession.setDevicePermissionHandler) {
        sharedSession.setDevicePermissionHandler((details) => {
            const url = details.originURL ? details.originURL.toString() : '';
            const allowed = isUrlAllowed(url);
            if (!allowed) return false;
            if (details.deviceType === 'videoinput' || details.deviceType === 'audioinput') {
                return true;
            }
            return false;
        });
    }
    
    createLoginWindow();

    app.on('activate', () => {
        const allWindows = BrowserWindow.getAllWindows();
        if (allWindows.length === 0) {
            if (currentLoggedInUser) {
                createMainWindow();
            } else {
                createLoginWindow();
            }
        } else {
            if (mainWindow && !mainWindow.isDestroyed()) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.focus();
            } else if (loginWindow && !loginWindow.isDestroyed()) {
                if (loginWindow.isMinimized()) loginWindow.restore();
                loginWindow.focus();
            }
        }
    });
});

// ★ License 授权相关 IPC
ipcMain.handle('license:get-status', () => {
    return licenseManager.validateLicense();
});

ipcMain.handle('license:activate', (event, base64Content) => {
    try {
        const result = licenseManager.writeLicenseContent(base64Content);
        if (result.success) {
            const validate = licenseManager.validateLicense();
            return { success: true, status: validate };
        }
        return { success: false, error: result.error };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// ★ v2: 处方数量限制 IPC
ipcMain.handle('license:can-prescribe', () => {
    try {
        return prescriptionCounter.canPrescribe();
    } catch (e) {
        console.error('[IPC] can-prescribe 异常:', e);
        return { allowed: true, current: 0, max: 0, remaining: -1 };
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
        return { current: 0, max: 0, remaining: -1, licenseType: 'unknown', month: '' };
    }
});

// ★ v2: 功能权限校验 IPC
ipcMain.handle('license:check-feature', (event, featureName) => {
    try {
        return featureGuard.checkFeature(featureName);
    } catch (e) {
        console.error('[IPC] check-feature 异常:', e);
        return { allowed: true, message: '功能可用（校验异常，默认放行）', feature: featureName };
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

ipcMain.handle('license:submit-activate', async (event, code, user) => {
    try {
        const machineId = activateManager.getMachineId();
        const result = await activateManager.activateOnline(code, machineId, user);
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

// ★ 设置试用期天数（测试用，0=立即过期触发激活，默认 7）
ipcMain.handle('license:set-trial-days', (event, days) => {
    try {
        return licenseManager.setTrialDays(days);
    } catch (e) {
        console.error('[IPC] set-trial-days 异常:', e);
        return { success: false, error: String(e) };
    }
});

// ★ 获取试用期天数（默认 7）
ipcMain.handle('license:get-trial-days', () => {
    try {
        return { success: true, trialDays: licenseManager.getTrialDays() };
    } catch (e) {
        return { success: false, trialDays: 7, error: String(e) };
    }
});

// ★ 同步 alert/confirm 对话框（替代原生 window.alert/window.confirm 和原 HTML 模态框方案）
// 问题：
//   1. Electron 35 原生 alert() 关闭后鼠标光标不显示（Chromium 模态框焦点 bug）
//   2. 原 HTML 模态框方案将 confirm 改为返回 Promise，破坏同步语义（见上方注释）
// 方案：使用 Electron 原生 dialog.showMessageBoxSync（同步阻塞，行为与原生一致）
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

ipcMain.handle('save-prescription-image', async (event, imageData, fileName) => {
    return await savePrescriptionImage(imageData, fileName);
});

ipcMain.handle('save-video-file', async (event, arrayBuffer, fileName) => {
    return await saveVideoFile(arrayBuffer, fileName);
});

ipcMain.handle('get-video-directory', async () => {
    return getCurrentMonthDirectory();
});

// ★ 查找处方文件（新增）
safeHandle('find-media-files', async (event, patientName, prescriptionNo, createdAt) => {
    if (!patientName) return { success: true, files: [] };
    const sanitizeStr = s => (s || '').trim().replace(/[\/\\:*?"<>|]/g, '_').replace(/ /g, '');
    const cleanName = sanitizeStr(patientName);
    const identifier = sanitizeStr(prescriptionNo || '');
    
    const identifiers = new Set([identifier]);
    if (identifier.startsWith('LOCAL-')) {
        identifiers.add(identifier.replace('LOCAL-', ''));
    } else if (identifier) {
        identifiers.add('LOCAL-' + identifier);
    }
    
    const prefixes = [];
    for (const id of identifiers) {
        if (id) {
            prefixes.push(`${cleanName}_${id}`);
            prefixes.push(`${id}_${cleanName}`);
        }
    }
    
    // 解析 createdAt 时间范围（±1天）
    let startTime = 0, endTime = Date.now() + 365 * 24 * 60 * 60 * 1000;
    if (createdAt) {
        try {
            const createdDate = new Date(createdAt);
            const time = createdDate.getTime();
            startTime = time - 24 * 60 * 60 * 1000;
            endTime = time + 48 * 60 * 60 * 1000;
        } catch (e) { /* 解析失败用宽松范围 */ }
    }
    
    const files = [];
    const foundPaths = new Set();
    
    const searchDirectories = [];
    
    const currentDownloadsDir = getDownloadsDirectory();
    searchDirectories.push(currentDownloadsDir);
    
    const userDataDownloadsDir = path.join(app.getPath('userData'), 'downloads');
    if (userDataDownloadsDir !== currentDownloadsDir) {
        searchDirectories.push(userDataDownloadsDir);
    }
    
    const exeDir = getExeDirectory();
    const parentExeDir = path.dirname(exeDir);
    const parentDownloadsDir = path.join(parentExeDir, 'downloads');
    if (parentDownloadsDir !== currentDownloadsDir && parentDownloadsDir !== userDataDownloadsDir) {
        searchDirectories.push(parentDownloadsDir);
    }
    
    console.log('[查找文件] 患者:', cleanName, '编号:', identifier);
    console.log('[查找文件] 搜索前缀:', prefixes);
    console.log('[查找文件] 搜索目录:', searchDirectories);
    
    for (const downloadsDir of searchDirectories) {
        let monthDirs = [];
        try {
            const entries = await fs.readdir(downloadsDir, { withFileTypes: true });
            monthDirs = entries.filter(e => e.isDirectory()).map(e => path.join(downloadsDir, e.name));
        } catch (e) { 
            console.log('[查找文件] 目录不存在:', downloadsDir);
            continue; 
        }
        
        for (const monthDir of monthDirs) {
            let fileEntries = [];
            try {
                fileEntries = await fs.readdir(monthDir, { withFileTypes: true });
            } catch (e) { continue; }
            
            for (const fe of fileEntries) {
                if (!fe.isFile()) continue;
                const fileName = fe.name;
                const matches = prefixes.some(p => fileName.includes(p));
                if (!matches) continue;
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
                    console.log('[查找文件] 找到:', fileName);
                } catch (e) { /* 跳过无法读取的文件 */ }
            }
        }
    }
    
    console.log('[查找文件] 共找到:', files.length, '个文件');
    
    if (files.length === 0 && cleanName) {
        console.log('[查找文件] 未找到匹配文件，尝试仅按患者姓名搜索');
        
        const mediaKeywords = ['photo', 'video', 'prescription', 'tongue'];
        const validExtensions = ['.jpg', '.jpeg', '.png', '.webm', '.mp4', '.avi', '.mov'];
        
        for (const downloadsDir of searchDirectories) {
            let monthDirs = [];
            try {
                const entries = await fs.readdir(downloadsDir, { withFileTypes: true });
                monthDirs = entries.filter(e => e.isDirectory()).map(e => path.join(downloadsDir, e.name));
            } catch (e) { continue; }
            
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
                    
                    const hasMediaKeyword = mediaKeywords.some(k => fileName.includes(k));
                    if (!hasMediaKeyword) continue;
                    
                    const filePath = path.join(monthDir, fileName);
                    
                    if (foundPaths.has(filePath)) continue;
                    
                    try {
                        const stat = await fs.stat(filePath);
                        // 如果有时间范围，用时间筛选
                        if (startTime > 0 && (stat.mtimeMs < startTime || stat.mtimeMs > endTime)) continue;
                        const isVideo = ext === '.webm' || ext === '.mp4' || ext === '.avi' || ext === '.mov';
                        files.push({
                            name: fileName,
                            path: filePath,
                            type: isVideo ? 'video' : 'image',
                            size: stat.size,
                            lastModified: stat.mtimeMs
                        });
                        console.log('[查找文件] 按姓名+时间找到:', fileName);
                    } catch (e) { /* 跳过无法读取的文件 */ }
                }
            }
        }
        console.log('[查找文件] 按姓名+时间搜索后共找到:', files.length, '个文件');
    }
    
    return { success: true, files };
}, { success: false, files: [] });

// ★ 列出所有媒体文件（调试用）（新增）
safeHandle('list-all-media-files', async () => {
    const allFiles = [];
    const searchDirectories = [];
    
    const currentDownloadsDir = getDownloadsDirectory();
    searchDirectories.push(currentDownloadsDir);
    
    const userDataDownloadsDir = path.join(app.getPath('userData'), 'downloads');
    if (userDataDownloadsDir !== currentDownloadsDir) {
        searchDirectories.push(userDataDownloadsDir);
    }
    
    const exeDir = getExeDirectory();
    const parentExeDir = path.dirname(exeDir);
    const parentDownloadsDir = path.join(parentExeDir, 'downloads');
    if (parentDownloadsDir !== currentDownloadsDir && parentDownloadsDir !== userDataDownloadsDir) {
        searchDirectories.push(parentDownloadsDir);
    }
    
    for (const downloadsDir of searchDirectories) {
        let monthDirs = [];
        try {
            const entries = await fs.readdir(downloadsDir, { withFileTypes: true });
            monthDirs = entries.filter(e => e.isDirectory()).map(e => path.join(downloadsDir, e.name));
        } catch (e) { continue; }
        
        for (const monthDir of monthDirs) {
            let fileEntries = [];
            try {
                fileEntries = await fs.readdir(monthDir, { withFileTypes: true });
            } catch (e) { continue; }
            
            for (const fe of fileEntries) {
                if (!fe.isFile()) continue;
                const fileName = fe.name;
                const filePath = path.join(monthDir, fileName);
                try {
                    const stat = await fs.stat(filePath);
                    allFiles.push({
                        name: fileName,
                        path: filePath,
                        size: stat.size,
                        lastModified: stat.mtimeMs
                    });
                } catch (e) { /* 跳过无法读取的文件 */ }
            }
        }
    }
    
    return { success: true, files: allFiles, searchDirectories };
}, { success: false, files: [], searchDirectories: [] });

// ★ 重命名处方文件（新增）
safeHandle('rename-media-files', async (event, patientName, oldNo, newNo) => {
    return await renameMediaFiles(patientName, oldNo, newNo);
}, { success: false, renamed: 0 });

// ★ 删除文件（新增）
safeHandle('delete-file', async (event, filePath) => {
    if (!filePath) return { success: false, error: '文件路径为空' };
    if (!isPathAllowed(filePath)) return { success: false, error: '路径不在允许的下载目录内，已拒绝' };
    await fs.unlink(filePath);
    return { success: true };
});

// ★ 打开文件（系统默认程序）（新增）
safeHandle('open-file', async (event, filePath, mimeType) => {
    if (!filePath) return { success: false, error: '文件路径为空' };
    if (!isPathAllowed(filePath)) return { success: false, error: '路径不在允许的下载目录内，已拒绝' };
    const result = await shell.openPath(filePath);
    if (result) {
        console.error('[打开文件失败]', result);
        return { success: false, error: result };
    }
    return { success: true };
});

// ★ 在文件管理器中打开视频目录（新增）
safeHandle('open-video-directory', async () => {
    const dir = getCurrentMonthDirectory();
    await shell.openPath(dir);
    return { success: true, directory: dir };
});

// ★ 读取文件为Base64（新增）
safeHandle('read-file-as-base64', async (event, filePath) => {
    if (!filePath) return { success: false, error: '文件路径为空' };
    if (!isPathAllowed(filePath)) return { success: false, error: '路径不在允许的下载目录内，已拒绝' };
    try {
        const stat = await fs.stat(filePath);
        if (stat.size === 0) {
            return { success: false, error: '文件为空' };
        }
        if (stat.size > 100 * 1024 * 1024) {
            return { success: false, error: '文件过大（超过100MB）' };
        }
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
        console.error('读取文件失败:', filePath, error);
        return { success: false, error: '读取文件失败：' + error.message };
    }
});

// 保存备份数据文件到与图片相同的目录（安装目录/downloads/YYYY-MM/）
ipcMain.handle('save-backup-file', async (event, jsonStr, fileName) => {
    try {
        const safeName = sanitizeFileName(fileName);
        if (!safeName || !safeName.endsWith('.json')) return { success: false, error: '文件名无效（仅允许 .json）' };
        const monthDir = getCurrentMonthDirectory();
        const filePath = path.join(monthDir, safeName);
        if (!isPathAllowed(filePath)) return { success: false, error: '路径不在允许的下载目录内，已拒绝' };
        const buffer = Buffer.from(jsonStr, 'utf-8');
        await fs.writeFile(filePath, buffer);
        console.log('备份文件已保存:', filePath);
        return { success: true, filePath, directory: monthDir };
    } catch (error) {
        console.error('保存备份文件失败:', error);
        return { success: false, error: '保存备份文件失败' };
    }
});

ipcMain.handle('get-image-directory', async () => {
    return getCurrentMonthDirectory();
});

ipcMain.handle('get-backup-directory', async () => {
    return getCurrentMonthDirectory();
});

ipcMain.handle('open-image-directory', async () => {
    const dir = getCurrentMonthDirectory();
    dialog.showOpenDialog({
        defaultPath: dir,
        properties: ['openDirectory']
    });
});

ipcMain.handle('open-backup-directory', async () => {
    const dir = getCurrentMonthDirectory();
    dialog.showOpenDialog({
        defaultPath: dir,
        properties: ['openDirectory']
    });
});

// 选择图片保存目录（用户可自定义保存位置）
ipcMain.handle('select-image-save-directory', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory']
    });
    if (!result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0];
        currentLoggedInUser = currentLoggedInUser || {};
        // 保存到配置文件中（与用户绑定）
        try {
            const { app } = require('electron');
            const configPath = path.join(app.getPath('userData'), 'image-save-config.json');
            await fs.writeFile(configPath, JSON.stringify({ savePath: selectedPath }), 'utf-8');
            return { success: true, path: selectedPath };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }
    return { success: false, error: '用户取消了选择' };
});

ipcMain.handle('get-downloads-root', async () => {
    return getDownloadsDirectory();
});

ipcMain.handle('login-success', async (event, userData) => {
    const sender = event.sender;
    const senderWindow = BrowserWindow.fromWebContents(sender);
    
    saveLoginState(true, userData);
    currentLoggedInUser = userData;

    if (senderWindow === loginWindow) {
        if (loginWindow) {
            loginWindow.close();
            loginWindow = null;
        }
        createMainWindow();
    }

    return { success: true };
});

ipcMain.handle('get-logged-in-user', async () => {
    return currentLoggedInUser;
});

ipcMain.handle('get-index-html-content', async () => {
    const possiblePaths = [
        path.join(__dirname, '..', 'index.html'),
        path.join(__dirname, 'index.html'),
        path.join(process.resourcesPath, 'app', 'index.html')
    ];
    
    for (const filePath of possiblePaths) {
        try {
            if (fse.pathExistsSync(filePath)) {
                const content = fse.readFileSync(filePath, 'utf8');
                return { success: true, content, path: filePath };
            }
        } catch (e) {
            console.log('主进程读取index.html失败:', filePath, e.message);
        }
    }
    return { success: false, content: '' };
});

ipcMain.handle('login-cancel', async () => {
    app.quit();
    return { success: true };
});

ipcMain.handle('logout', async () => {
    saveLoginState(false);
    app.quit();
    return { success: true };
});

ipcMain.handle('quit-app', async () => {
    saveLoginState(false);
    app.quit();
    return { success: true };
});

// 获取数据目录（供前端读取本地文件用）
ipcMain.handle('get-data-directory', async () => {
    return getExeDirectory();
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

// 保存用户数据（按 key 存储，与登录用户绑定）
ipcMain.handle('save-user-data', async (event, key, data) => {
    try {
        if (!isSafeKey(key)) return { success: false, error: 'key 无效' };
        const userDataDir = path.join(app.getPath('userData'), 'user-data');
        await fse.ensureDir(userDataDir);
        const filePath = path.join(userDataDir, `${key}.json`);
        await fs.writeFile(filePath, JSON.stringify(data), 'utf-8');
        return { success: true };
    } catch (e) {
        return { success: false, error: '保存用户数据失败' };
    }
});

// 读取用户数据（按 key 读取）
ipcMain.handle('get-user-data', async (event, key) => {
    try {
        if (!isSafeKey(key)) return null;
        const filePath = path.join(app.getPath('userData'), 'user-data', `${key}.json`);
        const content = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(content);
    } catch (e) {
        return null;
    }
});

// ===================== 本地离线数据库 IPC 接口 =====================
// 与 APP 端 LocalDB 模块语义对齐（见 offline-sqlite-sync.md 4.2）

// 数据库是否就绪；未初始化则尝试初始化
safeHandle('localdb:ready', async () => {
    if (!db) {
        try { initDatabase(); } catch (e) { console.error('初始化数据库失败:', e); }
    }
    return !!db && db.open;
}, false);

// 按 created_by 查询未删除处方（data 解析后返回，按更新时间倒序）
safeHandle('localdb:getPrescriptions', async (event, username) => {
    if (!db) return [];
    let rows;
    if (username) {
        rows = db.prepare(`SELECT data FROM prescriptions WHERE created_by = ? AND deleted = 0 ORDER BY updated_at_ms DESC`).all(username);
    } else {
        rows = db.prepare(`SELECT data FROM prescriptions WHERE deleted = 0 ORDER BY updated_at_ms DESC`).all();
    }
    return rows.map(r => {
        try { return JSON.parse(r.data); } catch (e) { return null; }
    }).filter(Boolean);
}, []);

// 新增/覆盖处方；opts 可指定 { synced, deleted }
safeHandle('localdb:upsertPrescription', async (event, p, opts) => {
    if (!db) return { success: false, error: '数据库未初始化' };
    if (!p || p.id == null) return { success: false, error: '缺少处方 id' };
    opts = opts || {};
    const id = p.id;
    const data = JSON.stringify(p);
    const updatedAt = p.updatedAt || new Date().toISOString();
    const updatedAtMs = (function () {
        const t = new Date(updatedAt).getTime();
        return isNaN(t) ? Date.now() : t;
    })();
    const createdBy = p.createdBy || (currentLoggedInUser && currentLoggedInUser.username) || null;
    const synced = opts.synced ? 1 : 0;
    const deleted = opts.deleted ? 1 : 0;
    db.prepare(`
        INSERT OR REPLACE INTO prescriptions (id, data, updated_at, updated_at_ms, created_by, synced, deleted)
        VALUES (@id, @data, @updated_at, @updated_at_ms, @created_by, @synced, @deleted)
    `).run({ id, data, updated_at: updatedAt, updated_at_ms: updatedAtMs, created_by: createdBy, synced, deleted });
    return { success: true };
}, { success: false, error: '数据库异常' });

// 查询所有未同步处方（含软删除 deleted=1，供同步引擎推送），按更新时间升序
safeHandle('localdb:getUnsyncedPrescriptions', async () => {
    if (!db) return [];
    const rows = db.prepare(`SELECT data, deleted FROM prescriptions WHERE synced = 0 ORDER BY updated_at_ms ASC`).all();
    return rows.map(r => {
        try {
            const obj = JSON.parse(r.data);
            obj.deleted = r.deleted; // 注入 deleted 标记，便于同步引擎区分软删除
            return obj;
        } catch (e) { return null; }
    }).filter(Boolean);
}, []);

// 标记某条处方已同步
safeHandle('localdb:markSynced', async (event, id) => {
    if (!db) return { success: false, error: '数据库未初始化' };
    db.prepare(`UPDATE prescriptions SET synced = 1 WHERE id = ?`).run(id);
    return { success: true };
}, { success: false, error: '数据库异常' });

// 软删除某条处方（进入待同步队列：deleted=1, synced=0）
safeHandle('localdb:markDeleted', async (event, id) => {
    if (!db) return { success: false, error: '数据库未初始化' };
    db.prepare(`UPDATE prescriptions SET deleted = 1, synced = 0 WHERE id = ?`).run(id);
    return { success: true };
}, { success: false, error: '数据库异常' });

// 统计未同步条数
safeHandle('localdb:countUnsynced', async () => {
    if (!db) return 0;
    const row = db.prepare(`SELECT COUNT(*) AS count FROM prescriptions WHERE synced = 0`).get();
    return row ? row.count : 0;
}, 0);

// 读取缓存 KV（解析 JSON 失败时回退为原始字符串）
safeHandle('localdb:getCache', async (event, key) => {
    if (!db || !key) return null;
    const row = db.prepare(`SELECT data FROM cache_kv WHERE key = ?`).get(key);
    if (!row) return null;
    try { return JSON.parse(row.data); } catch (e) { return row.data; }
}, null);

// 写入缓存 KV
safeHandle('localdb:setCache', async (event, key, data) => {
    if (!db || !key) return { success: false, error: '缺少 key' };
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    const cachedAt = new Date().toISOString();
    db.prepare(`
        INSERT OR REPLACE INTO cache_kv (key, data, cached_at) VALUES (@key, @data, @cached_at)
    `).run({ key, data: payload, cached_at: cachedAt });
    return { success: true };
}, { success: false, error: '数据库异常' });

// 读取同步状态
safeHandle('localdb:getSyncStatus', async () => {
    if (!db) return { last_push: null, last_pull: null, pending_count: 0 };
    const row = db.prepare(`SELECT * FROM sync_status WHERE id = 1`).get();
    if (!row) return { last_push: null, last_pull: null, pending_count: 0 };
    return {
        last_push: row.last_push,
        last_pull: row.last_pull,
        pending_count: row.pending_count
    };
}, { last_push: null, last_pull: null, pending_count: 0 });

// 写入同步状态；pending_count 未提供时按实际未同步条数计算
safeHandle('localdb:setSyncStatus', async (event, s) => {
    if (!db) return { success: false, error: '数据库未初始化' };
    s = s || {};
    const lastPush = s.last_push || null;
    const lastPull = s.last_pull || null;
    let pendingCount;
    if (typeof s.pending_count === 'number') {
        pendingCount = s.pending_count;
    } else {
        const c = db.prepare(`SELECT COUNT(*) AS count FROM prescriptions WHERE synced = 0`).get();
        pendingCount = c ? c.count : 0;
    }
    db.prepare(`
        INSERT OR REPLACE INTO sync_status (id, last_push, last_pull, pending_count) VALUES (1, @last_push, @last_pull, @pending_count)
    `).run({ last_push: lastPush, last_pull: lastPull, pending_count: pendingCount });
    return { success: true };
}, { success: false, error: '数据库异常' });

// 退出前关闭数据库句柄
app.on('before-quit', () => {
    if (db) {
        try { db.close(); } catch (e) { console.log('关闭数据库失败:', e); }
        db = null;
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
