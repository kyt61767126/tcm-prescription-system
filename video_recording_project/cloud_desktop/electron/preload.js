// ============================================================================
//  preload.js - 云端桌面版 安全 API 桥接（contextIsolation 模式）
//
//  ★ 本文件基于 cloud_project/cloud_desktop/electron/preload.js 增加：
//    - saveVideoFile：视频文件保存（ArrayBuffer → 文件）
//    - getVideoDirectory：获取视频保存目录
//    - openVideoDirectory：在文件管理器中打开视频目录
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

    // ---------- 视频录制（新增） ----------
    saveVideoFile: (arrayBuffer, fileName) => {
        return ipcRenderer.invoke('save-video-file', arrayBuffer, fileName);
    },

    getVideoDirectory: () => {
        return ipcRenderer.invoke('get-video-directory');
    },

    openVideoDirectory: () => {
        return ipcRenderer.invoke('open-video-directory');
    },

    // ---------- 备份数据保存（与图片同目录：安装目录/downloads/YYYY-MM/） ----------
    saveBackupFile: (fileName, content) => {
        return ipcRenderer.invoke('save-backup-file', fileName, content);
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
