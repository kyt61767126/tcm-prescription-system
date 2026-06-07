const { app, BrowserWindow, ipcMain, dialog, protocol, session } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');

let mainWindow;
let loginWindow;
let sharedSession;

// 获取用户设置的图片保存目录，默认在文档目录
function getBaseImageDir() {
    const userDataPath = app.getPath('userData');
    const settingsPath = path.join(userDataPath, 'settings.json');
    
    try {
        if (fsSync.existsSync(settingsPath)) {
            const settings = JSON.parse(fsSync.readFileSync(settingsPath, 'utf8'));
            if (settings.imageSavePath) {
                return path.join(settings.imageSavePath, '惠康堂处方图片');
            }
        }
    } catch (e) {
        console.log('读取设置失败，使用默认路径');
    }
    
    // 默认保存到用户文档目录
    const userDocuments = app.getPath('documents');
    return path.join(userDocuments, '惠康堂处方图片');
}

// 保存用户设置的目录
function saveImageDirSetting(dirPath) {
    const userDataPath = app.getPath('userData');
    const settingsPath = path.join(userDataPath, 'settings.json');
    const settings = {
        imageSavePath: dirPath
    };
    fsSync.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

// 获取当前年月文件夹名称
function getCurrentMonthFolder() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

// 确保目录存在
async function ensureDir(dirPath) {
    try {
        await fs.access(dirPath);
    } catch {
        await fs.mkdir(dirPath, { recursive: true });
    }
}

// 保存图片到本地（自动按月创建文件夹）
async function savePrescriptionImage(imageData, fileName) {
    try {
        const baseDir = getBaseImageDir();
        const monthFolder = getCurrentMonthFolder();
        const fullDir = path.join(baseDir, monthFolder);
        
        // 确保目录存在
        await ensureDir(fullDir);
        
        // 处理 base64 数据
        const base64Data = imageData.replace(/^data:image\/png;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        
        // 写入文件
        const filePath = path.join(fullDir, fileName);
        await fs.writeFile(filePath, buffer);
        
        console.log('图片已保存:', filePath);
        return { success: true, filePath };
    } catch (error) {
        console.error('保存图片失败:', error);
        return { success: false, error: error.message };
    }
}

// 检查是否有保存的登录状态
function hasSavedLoginState() {
    try {
        const userDataPath = app.getPath('userData');
        const settingsPath = path.join(userDataPath, 'login-state.json');
        if (fsSync.existsSync(settingsPath)) {
            const data = JSON.parse(fsSync.readFileSync(settingsPath, 'utf8'));
            return data && data.hasLoggedIn;
        }
    } catch (e) {
        console.log('检查登录状态失败:', e);
    }
    return false;
}

// 保存登录状态
function saveLoginState(hasLoggedIn) {
    try {
        const userDataPath = app.getPath('userData');
        const settingsPath = path.join(userDataPath, 'login-state.json');
        fsSync.writeFileSync(settingsPath, JSON.stringify({ hasLoggedIn }));
    } catch (e) {
        console.log('保存登录状态失败:', e);
    }
}

// 创建登录窗口
function createLoginWindow() {
    loginWindow = new BrowserWindow({
        width: 400,
        height: 310,
        resizable: false,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            session: sharedSession
        },
        icon: path.join(__dirname, 'icon.png')
    });

    // 加载登录页面
    const loginPath = path.join(__dirname, 'login.html');
    loginWindow.loadFile(loginPath);

    // 开发模式下打开 DevTools
    if (!app.isPackaged) {
        loginWindow.webContents.openDevTools();
    }
}

// 创建主窗口
function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            session: sharedSession
        },
        icon: path.join(__dirname, 'icon.png')
    });

    // 加载应用
    const indexPath = path.join(__dirname, '..', 'index.html');
    mainWindow.loadFile(indexPath);

    // 开发模式下打开 DevTools
    if (!app.isPackaged) {
        mainWindow.webContents.openDevTools();
    }
}

// 应用就绪
app.whenReady().then(() => {
    // 创建共享session
    sharedSession = session.fromPartition('persist:tcm-prescription-system');
    
    // 初始化根目录
    const baseDir = getBaseImageDir();
    ensureDir(baseDir).then(() => {
        console.log('图片保存目录已准备就绪:', baseDir);
    });

    // 检查是否有保存的登录状态
    if (hasSavedLoginState()) {
        // 有登录状态，直接显示主窗口
        createMainWindow();
    } else {
        // 没有登录状态，显示登录窗口
        createLoginWindow();
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            if (hasSavedLoginState()) {
                createMainWindow();
            } else {
                createLoginWindow();
            }
        }
    });
});

// 注册 IPC 处理
ipcMain.handle('save-prescription-image', async (event, imageData, fileName) => {
    return await savePrescriptionImage(imageData, fileName);
});

ipcMain.handle('get-image-directory', async () => {
    return getBaseImageDir();
});

ipcMain.handle('open-image-directory', async () => {
    const dir = getBaseImageDir();
    await ensureDir(dir);
    dialog.showOpenDialog({
        defaultPath: dir,
        properties: ['openDirectory']
    });
});

ipcMain.handle('select-image-save-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择处方图片保存位置',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: app.getPath('documents')
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0];
        saveImageDirSetting(selectedPath);
        
        // 立即测试创建目录
        const baseDir = getBaseImageDir();
        await ensureDir(baseDir);
        
        return { success: true, path: baseDir };
    }
    
    return { success: false };
});

ipcMain.handle('login-success', async () => {
    // 保存登录状态
    saveLoginState(true);
    
    // 关闭登录窗口
    if (loginWindow) {
        loginWindow.close();
        loginWindow = null;
    }
    
    // 打开主窗口
    createMainWindow();
    
    return { success: true };
});

ipcMain.handle('quit-app', async () => {
    // 清除登录状态
    saveLoginState(false);
    app.quit();
    return { success: true };
});

ipcMain.handle('login-cancel', async () => {
    app.quit();
    return { success: true };
});

// 关闭所有窗口时退出（Windows/Linux）
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
