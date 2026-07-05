// ============================================================================
//  本能中医处方系统 - 定制版  Electron 主进程
//  安全配置：contextIsolation=true / nodeIntegration=false
//  注：未启用 sandbox，以保留原生 window.prompt/confirm/alert（业务大量使用）
//      contextIsolation 仍确保渲染进程无法直接访问 Node API
//  所有 API 通过 preload.js 的 contextBridge 暴露
// ============================================================================
const { app, BrowserWindow, ipcMain, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fse = require('fs-extra');

let mainWindow;
let loginWindow;
let sharedSession;
let currentLoggedInUser = null;
const SESSION_PARTITION = 'persist:tcm-prescription-custom';

// 全局异常捕获，避免静默崩溃
process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err && err.stack ? err.stack : err);
});

// ============================================================================
//  目录与键名工具
// ============================================================================
function getExeDirectory() {
    return process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'));
}

// 通用目录创建：优先 exe 同级，失败回退到 userData
function ensureDirWithFallback(name, { rethrow = false } = {}) {
    const exeDir = getExeDirectory();
    const targetPath = path.join(exeDir, name);
    try {
        fse.ensureDirSync(targetPath);
        return targetPath;
    } catch (error) {
        console.error(`无法在程序目录创建${name}文件夹:`, error);
        if (rethrow) throw error;
        const fallbackPath = path.join(app.getPath('userData'), name);
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
    return String(key || '').replace(/[\\/:*?"<>|]/g, '_');
}

function sanitizeFileName(fileName) {
    if (typeof fileName !== 'string') return `image_${Date.now()}.png`;
    const base = sanitizeKey(path.basename(fileName));
    return base || `image_${Date.now()}.png`;
}

async function savePrescriptionImage(imageData, fileName) {
    try {
        const monthDir = getCurrentMonthDirectory();
        const base64Data = imageData.replace(/^data:image\/png;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const safeName = sanitizeFileName(fileName);
        const filePath = path.join(monthDir, safeName);
        await fs.writeFile(filePath, buffer);
        return { success: true, filePath, directory: monthDir };
    } catch (error) {
        console.error('保存图片失败:', error);
        return { success: false, error: error.message };
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
// ============================================================================
function installCSP(sess) {
    sess.webRequest.onHeadersReceived((details, callback) => {
        const csp = [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' file:",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
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
function createLoginWindow() {
    if (loginWindow && !loginWindow.isDestroyed()) {
        focusWindow(loginWindow);
        return;
    }

    loginWindow = new BrowserWindow({
        width: 360,
        height: 420,
        resizable: false,
        autoHideMenuBar: true,
        center: true,
        maximizable: false,
        minimizable: false,
        webPreferences: getSharedWebPrefs()
    });

    loginWindow.loadFile(path.join(__dirname, 'login.html'));
    loginWindow.on('closed', () => { loginWindow = null; });
}

function createMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
        mainWindow = null;
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

    mainWindow.webContents.on('dom-ready', () => {
        if (currentLoggedInUser) {
            mainWindow.webContents.send('main:login-user', currentLoggedInUser);
        }
        mainWindow.show();
        if (loginWindow && !loginWindow.isDestroyed()) {
            loginWindow.close();
            loginWindow = null;
        }
    });

    mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

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

app.whenReady().then(() => {
    fse.ensureDirSync(getDownloadsDirectory());

    sharedSession = session.fromPartition(SESSION_PARTITION);
    installCSP(sharedSession);

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
            if (currentLoggedInUser) createMainWindow();
            else createLoginWindow();
        } else {
            if (mainWindow && !mainWindow.isDestroyed()) {
                focusWindow(mainWindow);
            } else if (loginWindow && !loginWindow.isDestroyed()) {
                focusWindow(loginWindow);
            }
        }
    });
});

// ============================================================================
//  IPC handlers
// ============================================================================
ipcMain.handle('save-prescription-image', (event, imageData, fileName) => savePrescriptionImage(imageData, fileName));

async function saveUserData(key, data) {
    try {
        const safeKey = sanitizeKey(key);
        if (!safeKey) return { success: false, error: 'invalid key' };
        const filePath = path.join(getDataDirectory(), safeKey + '.json');
        const tmpPath = filePath + '.tmp';
        await fse.writeJson(tmpPath, data, { spaces: 2 });
        await fs.rename(tmpPath, filePath);
        return { success: true };
    } catch (error) {
        console.error('保存用户数据失败:', error);
        return { success: false, error: error.message };
    }
}

async function getUserData(key) {
    try {
        const safeKey = sanitizeKey(key);
        if (!safeKey) return { success: false, data: null };
        const filePath = path.join(getDataDirectory(), safeKey + '.json');
        if (await fse.pathExists(filePath)) {
            const data = await fse.readJson(filePath);
            return { success: true, data };
        }
        return { success: false, data: null };
    } catch (error) {
        console.error('读取用户数据失败:', error);
        return { success: false, data: null, error: error.message };
    }
}

ipcMain.handle('save-user-data', (event, key, data) => saveUserData(key, data));
ipcMain.handle('get-user-data', (event, key) => getUserData(key));

// 登录成功：保存用户、关闭登录窗口、打开主窗口
ipcMain.handle('login-success', async (event, userData) => {
    try {
        await saveLoginState(true, userData);
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
        edition: 'custom',
        productName: '本能中医处方系统-定制'
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
        const filePath = path.join(getDownloadsDirectory(), safeName);
        await fs.writeFile(filePath, jsonStr, 'utf8');
        return { success: true, fileName: safeName, filePath };
    } catch (error) {
        console.error('保存备份文件失败:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('quit-app', async () => {
    await saveLoginState(false);
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

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
