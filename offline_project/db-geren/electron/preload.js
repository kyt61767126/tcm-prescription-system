// ============================================================================
//  preload.js - 在 contextIsolation 模式下向渲染进程暴露安全 API
//  所有方法均通过 contextBridge 暴露，渲染进程无法直接访问 ipcRenderer/require
// ============================================================================
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    isElectron: true,

    // 处方图片保存
    savePrescriptionImage: (imageData, fileName) =>
        ipcRenderer.invoke('save-prescription-image', imageData, fileName),

    // 用户数据持久化
    saveUserData: (key, data) => ipcRenderer.invoke('save-user-data', key, data),
    getUserData: (key) => ipcRenderer.invoke('get-user-data', key),

    // 登录态
    loginSuccess: (userData) => ipcRenderer.invoke('login-success', userData),
    getCurrentUser: () => ipcRenderer.invoke('get-current-user'),

    // 应用配置（取代旧的 get-index-html-content 正则解析）
    getAppConfig: () => ipcRenderer.invoke('get-app-config'),
    setAutoStart: (enabled) => ipcRenderer.invoke('set-auto-start', enabled),

    // 退出
    quitApp: () => ipcRenderer.invoke('quit-app'),

    // 备份文件保存（绕过 Electron 下载机制，直接写文件）
    saveBackupFile: (jsonStr, fileName) => ipcRenderer.invoke('save-backup-file', jsonStr, fileName),

    // 主进程推送给渲染进程：登录用户信息（主窗口 dom-ready 时一次性发送）
    onLoginUser: (callback) => {
        const handler = (_event, user) => callback(user);
        ipcRenderer.once('main:login-user', handler);
    },

    showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options)
});
