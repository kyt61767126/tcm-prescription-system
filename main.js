const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');

const store = new Store();

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  createMenu();
}

function createMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '新建处方',
          accelerator: 'Ctrl+N',
          click: () => mainWindow.webContents.send('new-prescription')
        },
        {
          label: '保存处方',
          accelerator: 'Ctrl+S',
          click: () => mainWindow.webContents.send('save-prescription')
        },
        { type: 'separator' },
        {
          label: '打印处方',
          accelerator: 'Ctrl+P',
          click: () => mainWindow.webContents.send('print-prescription')
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: 'Alt+F4',
          click: () => app.quit()
        }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'Ctrl+Z', role: 'undo' },
        { label: '重做', accelerator: 'Ctrl+Y', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', accelerator: 'Ctrl+X', role: 'cut' },
        { label: '复制', accelerator: 'Ctrl+C', role: 'copy' },
        { label: '粘贴', accelerator: 'Ctrl+V', role: 'paste' }
      ]
    },
    {
      label: '查看',
      submenu: [
        { label: '刷新', accelerator: 'F5', role: 'reload' },
        { type: 'separator' },
        { label: '实际大小', accelerator: 'Ctrl+0', role: 'resetZoom' },
        { label: '放大', accelerator: 'Ctrl+Plus', role: 'zoomIn' },
        { label: '缩小', accelerator: 'Ctrl+Minus', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全屏', accelerator: 'F11', role: 'togglefullscreen' }
      ]
    },
    {
      label: '工具',
      submenu: [
        {
          label: '药品管理',
          accelerator: 'F2',
          click: () => mainWindow.webContents.send('open-medicine')
        },
        {
          label: '验方管理',
          accelerator: 'F3',
          click: () => mainWindow.webContents.send('open-formula')
        },
        {
          label: '病历管理',
          accelerator: 'F4',
          click: () => mainWindow.webContents.send('open-history')
        },
        { type: 'separator' },
        {
          label: '数据备份',
          click: () => mainWindow.webContents.send('backup-data')
        },
        {
          label: '数据恢复',
          click: () => mainWindow.webContents.send('restore-data')
        }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '使用说明',
          accelerator: 'F1',
          click: () => mainWindow.webContents.send('show-help')
        },
        { type: 'separator' },
        {
          label: '关于',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于',
              message: '中医处方系统专业版 v2.0.0',
              detail: '专业的中医处方管理软件\n无任何使用限制\n永久免费使用'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

ipcMain.handle('store-get', (event, key) => {
  return store.get(key);
});

ipcMain.handle('store-set', (event, key, value) => {
  store.set(key, value);
  return true;
});

ipcMain.handle('store-delete', (event, key) => {
  store.delete(key);
  return true;
});

ipcMain.handle('store-clear', () => {
  store.clear();
  return true;
});

ipcMain.handle('export-data', async (event, data) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出数据',
    defaultPath: `tcm-data-${new Date().toISOString().split('T')[0]}.json`,
    filters: [
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (!result.canceled) {
    const fs = require('fs');
    fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8');
    return { success: true, path: result.filePath };
  }
  return { success: false };
});

ipcMain.handle('import-data', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入数据',
    filters: [
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const fs = require('fs');
    const content = fs.readFileSync(result.filePaths[0], 'utf-8');
    return { success: true, data: JSON.parse(content) };
  }
  return { success: false };
});
