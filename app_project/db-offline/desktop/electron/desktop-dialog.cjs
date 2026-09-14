// ============================================================================
//  desktop-dialog.cjs — 桌面端对话框域 IPC（双桌面共用）
//  ★ 2026-09-14 P3-A 对话框域收口：从云桌面/离线桌面两份 main.js 等体抽取
//    （dialog:alert-sync / dialog:confirm-sync / dialog:prompt 三个 handler，
//    双端除 prompt 窗 title 外字节级同体，经逐行比对终验），
//    集中本模块唯一权威源（shared/ → sync-all Group 17 分发 → copy-consistency 哈希门）。
//  配套资源：prompt-modal.html + prompt-preload.js 与本模块同组同位分发
//    （__dirname 同目录解析，asar 内与开发目录均正确）。
//  依赖注入：createDesktopDialogIpc({ ipcMain, dialog, BrowserWindow,
//    getMainWindow, promptTitle }) —— 与 desktop-fs-ipc.cjs 同款工厂模式
//    （B2-1 验证过的架构）；getMainWindow 为访问器注入（替代原 || mainWindow 直引），
//    promptTitle 注入端差异（离线'惠康中医诊所管理系统 V1.0.0' / 云端'请输入'）。
//  铁律：改对话框域逻辑只改本文件，禁止再改两份 main.js 内嵌副本。
// ============================================================================
'use strict';

function createDesktopDialogIpc({ ipcMain, dialog, BrowserWindow, getMainWindow, promptTitle }) {
    const path = require('path');

    // ★ P0 修复：prompt-modal 资源路径（打包后必须在 asar 内可访问）
    const PROMPT_HTML_PATH = path.join(__dirname, 'prompt-modal.html');
    const PROMPT_PRELOAD_PATH = path.join(__dirname, 'prompt-preload.js');

    // ============================================================================
    //  同步 alert/confirm（替代原生，规避 Electron 35 光标消失 bug）
    //  渲染进程通过 window.electronAPI.alertSync/confirmSync 调用
    //  （dom-ready 时已重写 window.alert/confirm）
    // ============================================================================
    // 问题：Electron 35 中原生 alert() 关闭后鼠标光标不显示（Chromium 模态框焦点 bug）
    // 方案：使用 Electron 原生 dialog.showMessageBoxSync（同步阻塞，行为与原生一致）
    ipcMain.on('dialog:alert-sync', (event, message) => {
        try {
            const win = BrowserWindow.fromWebContents(event.sender) || getMainWindow();
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
            const win = BrowserWindow.fromWebContents(event.sender) || getMainWindow();
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

    // ============================================================================
    //  异步 prompt 对话框（替代原生 window.prompt）
    //  问题：Electron 中 window.prompt() 默认返回 null，导致 handleEditUser 等函数静默失败
    //  方案：创建模态子窗口（prompt-modal.html），返回 Promise<string|null>
    //  兼容：业务代码需用 `await prompt(...)`，preload.js 已暴露 electronAPI.prompt
    // ============================================================================
    ipcMain.handle('dialog:prompt', async (event, message, defaultValue) => {
        const parentWin = BrowserWindow.fromWebContents(event.sender) || getMainWindow();
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
            title: promptTitle,
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
}

module.exports = { createDesktopDialogIpc };
