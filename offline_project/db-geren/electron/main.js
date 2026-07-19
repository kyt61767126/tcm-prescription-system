// ============================================================================
//  惠康中医-个人  Electron 主进程
//  安全配置：contextIsolation=true / nodeIntegration=false
//  注：未启用 sandbox，以保留原生 window.prompt/confirm/alert（业务大量使用）
//      contextIsolation 仍确保渲染进程无法直接访问 Node API
//  所有 API 通过 preload.js 的 contextBridge 暴露
//
//  ★ 本文件基于 offline_project/db-bendi/electron/main.js 增加：
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

let mainWindow;
let loginWindow;
let packagingWindow = null;
let sharedSession;
let currentLoggedInUser = null;
const SESSION_PARTITION = 'persist:tcm-prescription-personal';

// 全局异常捕获，避免静默崩溃
process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err && err.stack ? err.stack : err);
});

app.commandLine.appendSwitch('enable-usermedia-screen-capturing');
app.commandLine.appendSwitch('enable-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('allow-file-access-from-files');

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
        const oldPrefix = `${cleanName}_${cleanOldNo}`;
        const newPrefix = `${cleanName}_${cleanNewNo}`;
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
                if (!fileName.includes(oldPrefix)) continue;
                const newFileName = fileName.replace(oldPrefix, newPrefix);
                if (newFileName === fileName) continue;
                try {
                    await fs.rename(path.join(monthDir, fileName), path.join(monthDir, newFileName));
                    renamed++;
                } catch (e) { /* 跳过无法重命名的文件 */ }
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

// 启动时从 login-state.json 恢复登录状态，避免每次都强制重新登录
// 这样用户即使修改密码失败，下次启动仍可进入主界面查看历史处方
async function loadLoginState() {
    try {
        const settingsPath = path.join(app.getPath('userData'), 'login-state.json');
        if (await fse.pathExists(settingsPath)) {
            const data = await fse.readJson(settingsPath);
            if (data && data.hasLoggedIn && data.user) {
                currentLoggedInUser = data.user;
                console.log('[main] 恢复登录状态:', currentLoggedInUser.username);
                return true;
            }
        }
    } catch (e) {
        console.error('读取登录状态失败:', e);
    }
    return false;
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

    mainWindow.webContents.on('dom-ready', () => {
        if (currentLoggedInUser) {
            mainWindow.webContents.send('main:login-user', currentLoggedInUser);
        }
        mainWindow.show();

        // ★ 注入视频录制模块（从同目录读取 video-recorder.js）
        injectVideoRecorder(mainWindow);
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

    loginWindow.loadFile(path.join(__dirname, 'login.html'));

    loginWindow.on('closed', () => {
        loginWindow = null;
    });

    loginWindow.webContents.on('dom-ready', () => {
        loginWindow.show();
    });
}

app.whenReady().then(() => {
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

    // 启动时尝试恢复上次登录状态；已登录过则直接进入主窗口，否则显示登录窗口
    loadLoginState().then((restored) => {
        if (restored && currentLoggedInUser) {
            createMainWindow();
        } else {
            createLoginWindow();
        }
    });

    app.on('activate', () => {
        const allWindows = BrowserWindow.getAllWindows();
        if (allWindows.length === 0) {
            // 重新激活时优先恢复登录态
            loadLoginState().then((restored) => {
                if (restored && currentLoggedInUser) {
                    createMainWindow();
                } else {
                    createLoginWindow();
                }
            });
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
ipcMain.handle('rename-media-files', async (event, patientName, oldNo, newNo) => {
    return await renameMediaFiles(patientName, oldNo, newNo);
});

// ★ 删除文件（新增）
ipcMain.handle('delete-file', async (event, filePath) => {
    try {
        if (!filePath) return { success: false, error: '文件路径为空' };
        await fs.unlink(filePath);
        return { success: true };
    } catch (error) {
        console.error('删除文件失败:', error);
        return { success: false, error: error.message };
    }
});

// ★ 打开文件（系统默认程序）（新增）
ipcMain.handle('open-file', async (event, filePath, mimeType) => {
    try {
        if (!filePath) return { success: false, error: '文件路径为空' };
        await shell.openPath(filePath);
        return { success: true };
    } catch (error) {
        console.error('打开文件失败:', error);
        return { success: false, error: error.message };
    }
});

// ★ 读取文件为Base64（新增）
ipcMain.handle('read-file-as-base64', async (event, filePath) => {
    try {
        if (!filePath) return { success: false, error: '文件路径为空' };
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

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
