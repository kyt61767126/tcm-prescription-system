// ============================================================================
//  惠康中医-定制  Electron 主进程
//  安全配置：contextIsolation=true / nodeIntegration=false
//  注：未启用 sandbox，以保留原生 window.prompt/confirm/alert（业务大量使用）
//      contextIsolation 仍确保渲染进程无法直接访问 Node API
//  所有 API 通过 preload.js 的 contextBridge 暴露
//
//  ★ 本文件为定制版 electron/main.js，基于原本地版增加：
//    - session.setPermissionRequestHandler：自动授予 camera/microphone 权限
//    - save-video-file IPC handler：视频 ArrayBuffer 写入文件
//    - get-video-directory / open-video-directory IPC handler
//    - dom-ready 时注入 video-recorder.js 模块
//    - CSP 增加 media-src 'self' blob: 允许视频预览
// ============================================================================
const { app, BrowserWindow, ipcMain, session, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fse = require('fs-extra');
const crypto = require('crypto');
const licenseManager = require('./license-manager');
const prescriptionCounter = require('./prescription-counter');
const featureGuard = require('./feature-guard');
const activateManager = require('./activate');
const updateNotifier = require('./update-notifier');
const hotUpdate = require('./hot-update');

let mainWindow;
let loginWindow;
let packagingWindow = null;
let sharedSession;
let currentLoggedInUser = null;
const SESSION_PARTITION = 'persist:tcm-prescription-dingzhi';

// 全局异常捕获，避免静默崩溃
process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err && err.stack ? err.stack : err);
});

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
    return ensureDirWithFallback('data');
}

function getDownloadsDirectory() {
    return ensureDirWithFallback('downloads');
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

// ★ 路径白名单校验：仅允许访问 downloads 目录及其子目录下的文件
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
        const downloadsDir = getDownloadsDirectory();
        let renamed = 0;
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
        await fse.writeJson(tmpPath, payload, { spaces: 2 });
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

    // ★ 热更新：优先加载热更新目录的 index.html，fallback 到打包文件
    const hotUpdatePath = hotUpdate.getHotUpdateIndexPath(app);
    if (hotUpdatePath) {
        console.log('[HotUpdate] 使用热更新版本:', hotUpdatePath);
        mainWindow.loadFile(hotUpdatePath);
    } else {
        mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
    }
    // 异步检查并下载更新（下次启动生效）
    hotUpdate.checkAndDownloadUpdate(app, 'dingzhi');

    // ★ 安全：拦截 window.open 防止钓鱼攻击
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('file://') || url.startsWith('http://localhost')) {
            return { action: 'deny' };
        }
        shell.openExternal(url);
        return { action: 'deny' };
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
        });
    } catch (e) {
        console.warn('[Security] installDevToolsGuard 异常:', e.message);
    }
}

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

function createLoginWindow() {
    if (loginWindow && !loginWindow.isDestroyed()) {
        focusWindow(loginWindow);
        return;
    }

    loginWindow = new BrowserWindow({
        width: 260,
        height: 400,
        resizable: false,
        autoHideMenuBar: true,
        center: true,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            partition: SESSION_PARTITION
        }
    });

    // ★ P1-A6：DevTools 反调试（仅打包环境生效）
    installDevToolsGuard(loginWindow.webContents);

    loginWindow.loadFile(path.join(__dirname, 'login.html'));

    loginWindow.on('closed', () => {
        loginWindow = null;
    });

    loginWindow.webContents.on('dom-ready', () => {
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
        `).catch(e => console.warn('[login] 注入 disableAutofill 失败:', e.message));
        loginWindow.show();
    });
}

// ★ P1-9 代码完整性校验：检测关键 JS 文件是否被篡改
// 原理：首次运行时计算关键文件 SHA256 哈希并存储为基线，后续启动重新计算并比对
// 防护效果：攻击者修改 auth-core.js / license-manager.js 绕过 license 校验时，哈希不匹配将阻止启动
async function verifyCodeIntegrity() {
    const criticalFiles = [
        path.join(__dirname, 'auth-core.js'),
        path.join(__dirname, 'license-manager.js')
    ];
    const baselinePath = path.join(app.getPath('userData'), 'integrity.dat');

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
        baseline = raw.trim();
    } catch (e) {
        // 基线文件不存在，首次运行
    }

    if (!baseline) {
        try {
            await fs.writeFile(baselinePath, combinedHash, 'utf8');
            console.log('[Integrity] 首次运行，已建立完整性基线');
        } catch (e) {
            console.warn('[Integrity] 无法写入基线文件:', e.message);
        }
        return true;
    }

    if (baseline === combinedHash) {
        console.log('[Integrity] 代码完整性校验通过');
        return true;
    }

    console.error('[Integrity] 代码完整性校验失败！检测到关键文件被篡改');
    console.error('[Integrity] 基线:', baseline.substring(0, 16) + '...');
    console.error('[Integrity] 当前:', combinedHash.substring(0, 16) + '...');
    return false;
}

app.whenReady().then(async () => {
    // ★ License 授权校验（启动时校验，未授权或过期则弹双按钮：前往激活/退出软件）
    // ★ v3 新增：传入 localMachineId 用于三因子绑定校验（clinicName + machineId）
    let localMachineId = '';
    let licenseResult;
    try {
        localMachineId = activateManager.getMachineId();
        licenseResult = licenseManager.validateLicense({ localMachineId });
    } catch (e) {
        console.error('[License] validateLicense exception, fallback to trial:', e.message);
        licenseResult = { valid: true, type: 'trial', message: '校验异常，进入试用模式' };
    }
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
    // 授权有效时，在控制台显示授权信息（不弹窗，避免干扰用户）
    if (licenseResult.type === 'trial') {
        console.log('[License] 试用模式：', licenseResult.message);
    }

    // ★ P1-9 代码完整性校验：检测 auth-core.js / license-manager.js 是否被篡改
    // 防盗破解：攻击者修改 JS 文件绕过 license 校验时，本检测会阻止启动
    // 首次运行建立基线，后续启动比对哈希
    try {
        const integrityOk = await verifyCodeIntegrity();
        if (!integrityOk) {
            dialog.showMessageBoxSync({
                type: 'error',
                title: '完整性校验失败',
                message: '检测到关键代码文件已被篡改，软件无法启动。\n请从官方渠道重新下载安装，或联系客服。',
                buttons: ['退出']
            });
            app.exit(1);
            return;
        }
    } catch (e) {
        console.warn('[Integrity] 完整性校验异常（降级放行）:', e.message);
    }

    // ★ 启动自动更新检查（第4周任务，延迟 5 秒检查避免影响启动）
    updateNotifier.init('geren');

    fse.ensureDirSync(getDownloadsDirectory());

    sharedSession = session.fromPartition(SESSION_PARTITION);
    installCSP(sharedSession);

    // ★ 授予 camera/microphone 权限（视频录制所需）
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

    createLoginWindow();

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
    // ★ v3 新增：传入 localMachineId 用于绑定校验
    try {
        const localMachineId = activateManager.getMachineId();
        return licenseManager.validateLicense({ localMachineId });
    } catch (e) {
        return licenseManager.validateLicense();
    }
});

ipcMain.handle('license:activate', (event, base64Content) => {
    try {
        // ★ P1-A 新增：writeLicenseContent 需要 machineId 用于加密
        let localMachineId = '';
        try { localMachineId = activateManager.getMachineId(); } catch (e) {}
        const result = licenseManager.writeLicenseContent(base64Content, localMachineId);
        if (result.success) {
            // ★ 离线激活/导入 license 后清除 trial.dat（与 activateOnline 成功后一致）
            // 防止试用模式数据残留导致重复弹窗
            try {
                const fsSync = require('fs');
                const trialPath = licenseManager.getTrialPath();
                if (fsSync.existsSync(trialPath)) {
                    fsSync.unlinkSync(trialPath);
                    console.log('[License] 离线导入：trial.dat 已清除');
                }
            } catch (e) {
                console.warn('[License] 离线导入：清除 trial.dat 失败:', e);
            }
            // ★ v3 新增：激活后立即校验绑定
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
ipcMain.handle('license:can-prescribe', () => {
    try {
        return prescriptionCounter.canPrescribe();
    } catch (e) {
        console.error('[IPC] can-prescribe 异常:', e);
        return { allowed: true, current: 0, max: 0, remaining: -1 };  // 出错时放行，避免阻塞用户
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

ipcMain.handle('license:submit-activate', async (event, code, user, clinicName) => {
    try {
        const machineId = activateManager.getMachineId();
        // ★ v3 新增：透传 clinicName 给云端做绑定校验
        const result = await activateManager.activateOnline(code, machineId, user, clinicName);
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
        const downloadsDir = getDownloadsDirectory();
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
        const filePath = path.join(getDataDirectory(), key + '.json');
        if (await fse.pathExists(filePath)) {
            const data = await fse.readJson(filePath);
            return { success: true, data };
        }
        return { success: false, data: null };
    } catch (error) {
        console.error('读取用户数据失败:', error);
        return { success: false, data: null };
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
        doctorName: '张大夫',
        edition: 'personal',
        productName: '惠康中医-个人'
    };
    try {
        const configPath = path.join(__dirname, '..', 'config.json');
        if (await fse.pathExists(configPath)) {
            const cfg = await fse.readJson(configPath);
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
        const configPath = path.join(__dirname, '..', 'config.json');
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

// 打包配置页：写入 config.json
ipcMain.handle('packaging-write-config', async (event, config) => {
    try {
        const configPath = path.join(__dirname, '..', 'config.json');
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

// 备份文件保存：直接写入 downloads 目录，避免 Electron 下载机制的不确定性
ipcMain.handle('save-backup-file', async (event, jsonStr, fileName) => {
    try {
        const safeName = sanitizeFileName(fileName);
        if (!safeName.endsWith('.json')) return { success: false, error: '文件名无效（仅允许 .json）' };
        const filePath = path.join(getDownloadsDirectory(), safeName);
        if (!isPathAllowed(filePath)) return { success: false, error: '路径不在允许的下载目录内，已拒绝' };
        await fs.writeFile(filePath, jsonStr, 'utf8');
        return { success: true, fileName: safeName, filePath };
    } catch (error) {
        console.error('保存备份文件失败:', error);
        return { success: false, error: '保存备份文件失败' };
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

// ★ 打印处方（解决 Electron iframe print() 不工作的问题）
// ★ 修复 2026-07-27：data: URL + encodeURIComponent 在 Electron 28+ 中存在两个问题：
//   1) did-finish-load 事件对 data: URL 经常不触发，导致 print() 永不调用，30秒后超时关闭
//   2) 处方 HTML 含大量内联样式，encodeURIComponent 后 URL 可能过长被截断
//   修复方案：改用 base64 编码的 data URL（更短更可靠），监听 dom-ready 替代 did-finish-load，
//            并处理 did-fail-load 错误，关联父窗口（modal）
ipcMain.handle('print-prescription', async (event, html, orientation) => {
    try {
        const parentWin = BrowserWindow.fromWebContents(event.sender);
        const printWin = new BrowserWindow({
            show: true,
            width: 800,
            height: 600,
            modal: !!parentWin && !parentWin.isDestroyed(),
            parent: parentWin && !parentWin.isDestroyed() ? parentWin : undefined,
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false
            }
        });
        // ★ 用 base64 编码替代 encodeURIComponent，避免 URL 长度截断和特殊字符问题
        const base64Html = Buffer.from(html, 'utf8').toString('base64');
        const dataUrl = 'data:text/html;charset=utf-8;base64,' + base64Html;

        return new Promise((resolve) => {
            let printed = false;  // 防止重复打印
            let settled = false;  // 防止重复 resolve

            const safeResolve = (val) => {
                if (settled) return;
                settled = true;
                if (!printWin.isDestroyed()) printWin.close();
                resolve(val);
            };

            printWin.loadURL(dataUrl);

            // ★ 监听 dom-ready（比 did-finish-load 更早更可靠）
            printWin.webContents.once('dom-ready', () => {
                // 给浏览器一点时间完成布局，否则可能打印空白页
                setTimeout(() => {
                    if (printed || printWin.isDestroyed()) return;
                    printed = true;
                    printWin.webContents.print({ silent: false, printBackground: true }, (success) => {
                        safeResolve(success);
                    });
                }, 200);
            });

            // ★ 兜底：若 dom-ready 不触发，did-finish-load 作为备份
            printWin.webContents.once('did-finish-load', () => {
                if (printed || printWin.isDestroyed()) return;
                console.warn('[print] dom-ready 未触发，由 did-finish-load 兜底打印');
                printed = true;
                printWin.webContents.print({ silent: false, printBackground: true }, (success) => {
                    safeResolve(success);
                });
            });

            // ★ 错误处理：data URL 加载失败时立即返回
            printWin.webContents.once('did-fail-load', (_e, errorCode, errorDesc) => {
                console.error('[print] did-fail-load:', errorCode, errorDesc);
                safeResolve(false);
            });

            // 超时保护：30秒后自动关闭
            setTimeout(() => {
                if (!settled) {
                    console.error('[print] 30秒超时未触发打印，强制关闭');
                    safeResolve(false);
                }
            }, 30000);
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
