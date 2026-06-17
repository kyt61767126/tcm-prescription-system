const { app, BrowserWindow, ipcMain, dialog, protocol, session } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fse = require('fs-extra');

let mainWindow;
let sharedSession;
let currentLoggedInUser = null;

app.commandLine.appendSwitch('enable-features', 'WebDialog');

app.on('browser-window-created', (event, window) => {
    window.webContents.on('dom-ready', () => {
        window.webContents.executeJavaScript(`
            (function() {
                if (window.__electronDialogsInjected) return;
                window.__electronDialogsInjected = true;
                
                window.alert = function(message) {
                    return new Promise((resolve) => { showElectronAlert(String(message || ''), () => resolve()); });
                };
                window.prompt = function(message, defaultValue) {
                    return new Promise((resolve) => { showElectronPrompt(String(message || ''), String(defaultValue || ''), (value) => resolve(value)); });
                };
                window.confirm = function(message) {
                    return new Promise((resolve) => { showElectronConfirm(String(message || ''), (result) => resolve(result)); });
                };
                
                function showElectronAlert(message, callback) {
                    const modal = document.createElement('div');
                    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:99999;';
                    modal.innerHTML = '<div style="background:#fff;padding:20px;border-radius:8px;min-width:300px;max-width:500px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><div style="margin-bottom:15px;font-size:14px;color:#333;white-space:pre-wrap;">' + escapeHtml(message) + '</div><div style="text-align:right;"><button id="__alertOk" style="padding:6px 16px;background:#4CAF50;color:#fff;border:none;border-radius:4px;cursor:pointer;">确定</button></div></div>';
                    document.body.appendChild(modal);
                    document.getElementById('__alertOk').onclick = function() { modal.remove(); if (callback) callback(); };
                }
                function showElectronPrompt(message, defaultValue, callback) {
                    const modal = document.createElement('div');
                    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:99999;';
                    modal.innerHTML = '<div style="background:#fff;padding:20px;border-radius:8px;min-width:300px;max-width:500px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><div style="margin-bottom:15px;font-size:14px;color:#333;">' + escapeHtml(message) + '</div><input id="__promptInput" type="text" value="' + escapeAttr(defaultValue) + '" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;font-size:14px;box-sizing:border-box;"><div style="margin-top:15px;text-align:right;"><button id="__promptCancel" style="padding:6px 16px;margin-right:8px;background:#f0f0f0;border:1px solid #ddd;border-radius:4px;cursor:pointer;">取消</button><button id="__promptOk" style="padding:6px 16px;background:#4CAF50;color:#fff;border:none;border-radius:4px;cursor:pointer;">确定</button></div></div>';
                    document.body.appendChild(modal);
                    const input = document.getElementById('__promptInput');
                    input.focus(); input.select();
                    document.getElementById('__promptOk').onclick = function() { const v = input.value; modal.remove(); if (callback) callback(v); };
                    document.getElementById('__promptCancel').onclick = function() { modal.remove(); if (callback) callback(null); };
                    input.onkeydown = function(e) { if (e.key === 'Enter') document.getElementById('__promptOk').click(); else if (e.key === 'Escape') document.getElementById('__promptCancel').click(); };
                }
                function showElectronConfirm(message, callback) {
                    const modal = document.createElement('div');
                    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:99999;';
                    modal.innerHTML = '<div style="background:#fff;padding:20px;border-radius:8px;min-width:300px;max-width:500px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><div style="margin-bottom:15px;font-size:14px;color:#333;white-space:pre-wrap;">' + escapeHtml(message) + '</div><div style="text-align:right;"><button id="__confirmCancel" style="padding:6px 16px;margin-right:8px;background:#f0f0f0;border:1px solid #ddd;border-radius:4px;cursor:pointer;">取消</button><button id="__confirmOk" style="padding:6px 16px;background:#4CAF50;color:#fff;border:none;border-radius:4px;cursor:pointer;">确定</button></div></div>';
                    document.body.appendChild(modal);
                    document.getElementById('__confirmOk').onclick = function() { modal.remove(); if (callback) callback(true); };
                    document.getElementById('__confirmCancel').onclick = function() { modal.remove(); if (callback) callback(false); };
                }
                function escapeHtml(str) { return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
                function escapeAttr(str) { return String(str).replace(/"/g, '&quot;').replace(/&/g, '&amp;'); }
            })();
        `).catch(() => {});
    });
});

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

async function savePrescriptionImage(imageData, fileName) {
    try {
        const monthDir = getCurrentMonthDirectory();
        
        const base64Data = imageData.replace(/^data:image\/png;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        
        const filePath = path.join(monthDir, fileName);
        await fs.writeFile(filePath, buffer);
        
        console.log('图片已保存:', filePath);
        return { success: true, filePath, directory: monthDir };
    } catch (error) {
        console.error('保存图片失败:', error);
        return { success: false, error: error.message };
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

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            session: sharedSession,
            webviewTag: false
        },
        icon: path.join(__dirname, 'icon.png')
    });

    const indexPath = path.join(__dirname, '..', 'index.html');
    
    mainWindow.loadFile(indexPath);

    if (!app.isPackaged) {
        mainWindow.webContents.openDevTools();
    }
}
app.whenReady().then(() => {
    sharedSession = session.fromPartition('persist:tcm-prescription-system');
    
    fse.ensureDirSync(getDownloadsDirectory());

    createMainWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});

ipcMain.handle('save-prescription-image', async (event, imageData, fileName) => {
    return await savePrescriptionImage(imageData, fileName);
});

ipcMain.handle('get-image-directory', async () => {
    return getCurrentMonthDirectory();
});

ipcMain.handle('open-image-directory', async () => {
    const dir = getCurrentMonthDirectory();
    dialog.showOpenDialog({
        defaultPath: dir,
        properties: ['openDirectory']
    });
});

ipcMain.handle('get-downloads-root', async () => {
    return getDownloadsDirectory();
});

ipcMain.handle('login-success', async (event, userData) => {
    saveLoginState(true, userData);
    return { success: true };
});

ipcMain.handle('get-logged-in-user', async () => {
    return currentLoggedInUser;
});

ipcMain.handle('quit-app', async () => {
    saveLoginState(false);
    app.quit();
    return { success: true };
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});