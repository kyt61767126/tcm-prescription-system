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

    // ---------- 视频录制 ----------
    saveVideoFile: (arrayBuffer, fileName) => {
        return ipcRenderer.invoke('save-video-file', arrayBuffer, fileName);
    },

    getVideoDirectory: () => {
        return ipcRenderer.invoke('get-video-directory');
    },

    openVideoDirectory: () => {
        return ipcRenderer.invoke('open-video-directory');
    },

    // ---------- 处方文件查看（新增） ----------
    findMediaFiles: (patientName, prescriptionNo, createdAt) => {
        return ipcRenderer.invoke('find-media-files', patientName, prescriptionNo, createdAt);
    },

    listAllMediaFiles: () => {
        return ipcRenderer.invoke('list-all-media-files');
    },

    openFile: (filePath, mimeType) => {
        return ipcRenderer.invoke('open-file', filePath, mimeType || '');
    },

    readFileAsBase64: (filePath) => {
        return ipcRenderer.invoke('read-file-as-base64', filePath);
    },

    renameMediaFiles: (patientName, oldNo, newNo) => {
        return ipcRenderer.invoke('rename-media-files', patientName, oldNo, newNo);
    },

    deleteFile: (filePath) => {
        return ipcRenderer.invoke('delete-file', filePath);
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

    // 安全存储（safeStorage）- P0-2: 基于 Windows DPAPI 的系统级加密
    // 用于替代 auth-core.js 中旧的硬编码盐 XOR 加密（PWDv1/PWDv2）
    safeStorageAvailable: () => {
        return ipcRenderer.invoke('auth:safeStorageAvailable');
    },

    encryptString: (plaintext) => {
        return ipcRenderer.invoke('auth:encryptString', plaintext);
    },

    decryptString: (encryptedBase64) => {
        return ipcRenderer.invoke('auth:decryptString', encryptedBase64);
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
    },

    // ★ 同步对话框（替代原生 alert/confirm 和原 HTML 模态框方案）
    // 原因：
    //   1. Electron 35 原生 alert() 关闭后鼠标光标不显示（Chromium 模态框焦点 bug）
    //   2. 原 HTML 模态框方案将 confirm 改为返回 Promise，破坏了 `if (!confirm(...)) return;` 同步语义
    //      （Promise 是 truthy，导致删除等危险操作不弹窗直接执行）
    // 方案：使用 Electron 原生 dialog.showMessageBoxSync（同步阻塞，行为与原生 alert/confirm 一致）
    // 兼容：同步返回 boolean，`if (!confirm(...))` 和 `await confirm(...)` 均正确工作
    alertSync: (message) => ipcRenderer.sendSync('dialog:alert-sync', String(message || '')),
    confirmSync: (message) => ipcRenderer.sendSync('dialog:confirm-sync', String(message || '')) === 1,

    // ★ License 授权管理
    license: {
        getStatus: () => ipcRenderer.invoke('license:get-status'),
        activate: (base64Content) => ipcRenderer.invoke('license:activate', base64Content)
    }
});
