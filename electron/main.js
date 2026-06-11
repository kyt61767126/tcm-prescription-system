const { app, BrowserWindow, ipcMain, dialog, protocol, session } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fse = require('fs-extra');

let mainWindow;
let loginWindow;
let sharedSession;

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

function hasSavedLoginState() {
    try {
        const userDataPath = app.getPath('userData');
        const settingsPath = path.join(userDataPath, 'login-state.json');
        if (fse.pathExistsSync(settingsPath)) {
            const data = fse.readJsonSync(settingsPath);
            return data && data.hasLoggedIn;
        }
    } catch (e) {
        console.log('检查登录状态失败:', e);
    }
    return false;
}

let currentLoggedInUser = null;

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

function createLoginWindow() {
    loginWindow = new BrowserWindow({
        width: 400,
        height: 350,
        resizable: false,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            session: sharedSession
        },
        icon: path.join(__dirname, 'icon.png')
    });

    const loginPath = path.join(__dirname, 'login.html');
    loginWindow.loadFile(loginPath);

    if (!app.isPackaged) {
        loginWindow.webContents.openDevTools();
    }
}

const USE_CLOUD_VERSION = true;

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

    if (USE_CLOUD_VERSION) {
        const cloudUrl = 'https://tcm-prescription-system.pages.dev';
        
        mainWindow.webContents.once('dom-ready', () => {
            if (currentLoggedInUser) {
                mainWindow.webContents.executeJavaScript(`
                    (function() {
                        var userStr = ${JSON.stringify(JSON.stringify(currentLoggedInUser))};
                        if (window.localStorage) {
                            window.localStorage.setItem('currentUser', userStr);
                        }
                        if (window.sessionStorage) {
                            window.sessionStorage.setItem('currentUser', userStr);
                        }
                    })();
                `).catch(err => console.log('注入登录状态失败:', err));
            }
        });
        
        mainWindow.webContents.once('did-finish-load', () => {
            if (currentLoggedInUser) {
                mainWindow.webContents.executeJavaScript(`
                    (function() {
                        var userStr = ${JSON.stringify(JSON.stringify(currentLoggedInUser))};
                        if (window.localStorage && !window.localStorage.getItem('currentUser')) {
                            window.localStorage.setItem('currentUser', userStr);
                        }
                        if (window.sessionStorage && !window.sessionStorage.getItem('currentUser')) {
                            window.sessionStorage.setItem('currentUser', userStr);
                        }
                        if (typeof checkLoginStatus === 'function') {
                            setTimeout(function() { checkLoginStatus(); }, 200);
                        }
                    })();
                `).catch(err => console.log('备用注入登录状态失败:', err));
            }
        });
        
        mainWindow.loadURL(cloudUrl);
    } else {
        const indexPath = path.join(__dirname, '..', 'index.html');
        mainWindow.loadFile(indexPath);
    }

    if (!app.isPackaged) {
        mainWindow.webContents.openDevTools();
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

app.whenReady().then(() => {
    sharedSession = session.fromPartition('persist:tcm-prescription-system');
    
    fse.ensureDirSync(getDownloadsDirectory());

    const restored = restoreLoginState();
    
    if (restored) {
        console.log('恢复登录状态成功，直接打开主窗口');
        createMainWindow();
    } else {
        console.log('无登录状态，显示登录窗口');
        createLoginWindow();
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            if (restoreLoginState()) {
                createMainWindow();
            } else {
                createLoginWindow();
            }
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

    if (loginWindow) {
        loginWindow.close();
        loginWindow = null;
    }

    createMainWindow();

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

ipcMain.handle('login-cancel', async () => {
    app.quit();
    return { success: true };
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});