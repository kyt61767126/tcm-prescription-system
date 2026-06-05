const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');

let mainWindow;

// 获取系统文档目录下的固定根目录
function getBaseImageDir() {
    const userDocuments = app.getPath('documents');
    return path.join(userDocuments, '惠康堂处方图片');
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

// 创建主窗口
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
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
    // 初始化根目录
    const baseDir = getBaseImageDir();
    ensureDir(baseDir).then(() => {
        console.log('图片保存目录已准备就绪:', baseDir);
    });

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
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

// 关闭所有窗口时退出（Windows/Linux）
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
