// ============================================================================
// Electron Preload 脚本（安全模式：contextIsolation: true, nodeIntegration: false）
// ============================================================================
// 通过 contextBridge 安全暴露 IPC 接口给渲染进程
// 渲染进程只能访问 window.electronAPI 上白名单列出的方法，不能直接访问 Node.js
// ============================================================================

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    isElectron: true,

    // ---------- 图像保存 ----------
    savePrescriptionImage: (imageData, fileName) => {
        return ipcRenderer.invoke('save-prescription-image', imageData, fileName);
    },

    getImageDirectory: () => {
        return ipcRenderer.invoke('get-image-directory');
    },

    openImageDirectory: () => {
        return ipcRenderer.invoke('open-image-directory');
    },

    selectImageSaveDirectory: () => {
        return ipcRenderer.invoke('select-image-save-directory');
    },

    // ---------- 备份数据保存（与图片同目录：安装目录/downloads/YYYY-MM/） ----------
    saveBackupFile: (jsonStr, fileName) => {
        return ipcRenderer.invoke('save-backup-file', jsonStr, fileName);
    },

    getBackupDirectory: () => {
        return ipcRenderer.invoke('get-backup-directory');
    },

    openBackupDirectory: () => {
        return ipcRenderer.invoke('open-backup-directory');
    },

    // ---------- 登录管理 ----------
    loginSuccess: (userData) => {
        return ipcRenderer.invoke('login-success', userData);
    },

    loginCancel: () => {
        return ipcRenderer.invoke('login-cancel');
    },

    getLoggedInUser: () => {
        return ipcRenderer.invoke('get-logged-in-user');
    },

    getIndexHtmlContent: () => {
        return ipcRenderer.invoke('get-index-html-content');
    },

    logout: () => {
        return ipcRenderer.invoke('logout');
    },

    quitApp: () => {
        return ipcRenderer.invoke('quit-app');
    },

    // ---------- 用户数据目录 ----------
    getDataDirectory: () => {
        return ipcRenderer.invoke('get-data-directory');
    },

    saveUserData: (key, data) => {
        return ipcRenderer.invoke('save-user-data', key, data);
    },

    getUserData: (key) => {
        return ipcRenderer.invoke('get-user-data', key);
    },

    // ---------- 本地离线数据库 ----------
    localDB: {
        ready: () => ipcRenderer.invoke('localdb:ready'),
        getPrescriptions: (username) => ipcRenderer.invoke('localdb:getPrescriptions', username),
        upsertPrescription: (p, opts) => ipcRenderer.invoke('localdb:upsertPrescription', p, opts),
        getUnsyncedPrescriptions: () => ipcRenderer.invoke('localdb:getUnsyncedPrescriptions'),
        markSynced: (id) => ipcRenderer.invoke('localdb:markSynced', id),
        markDeleted: (id) => ipcRenderer.invoke('localdb:markDeleted', id),
        countUnsynced: () => ipcRenderer.invoke('localdb:countUnsynced'),
        getCache: (key) => ipcRenderer.invoke('localdb:getCache', key),
        setCache: (key, data) => ipcRenderer.invoke('localdb:setCache', key, data),
        getSyncStatus: () => ipcRenderer.invoke('localdb:getSyncStatus'),
        setSyncStatus: (s) => ipcRenderer.invoke('localdb:setSyncStatus', s)
    }
});
