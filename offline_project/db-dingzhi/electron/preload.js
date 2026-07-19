// ============================================================================
//  preload.js - 在 contextIsolation 模式下向渲染进程暴露安全 API
//  所有方法均通过 contextBridge 暴露，渲染进程无法直接访问 ipcRenderer/require
//
//  ★ 本文件基于 offline_project/db-bendi/electron/preload.js 增加：
//    - saveVideoFile：视频文件保存（ArrayBuffer → 文件）
//    - getVideoDirectory：获取视频保存目录
//    - openVideoDirectory：在文件管理器中打开视频目录
// ============================================================================
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    isElectron: true,

    // 处方图片保存
    savePrescriptionImage: (imageData, fileName) =>
        ipcRenderer.invoke('save-prescription-image', imageData, fileName),

    // ---------- 视频录制（新增） ----------
    saveVideoFile: (arrayBuffer, fileName) =>
        ipcRenderer.invoke('save-video-file', arrayBuffer, fileName),

    getVideoDirectory: () =>
        ipcRenderer.invoke('get-video-directory'),

    openVideoDirectory: () =>
        ipcRenderer.invoke('open-video-directory'),

    // ---------- 处方文件查看（新增） ----------
    findMediaFiles: (patientName, prescriptionNo, createdAt) =>
        ipcRenderer.invoke('find-media-files', patientName, prescriptionNo, createdAt),

    openFile: (filePath, mimeType) =>
        ipcRenderer.invoke('open-file', filePath, mimeType || ''),

    readFileAsBase64: (filePath) =>
        ipcRenderer.invoke('read-file-as-base64', filePath),

    renameMediaFiles: (patientName, oldNo, newNo) =>
        ipcRenderer.invoke('rename-media-files', patientName, oldNo, newNo),

    deleteFile: (filePath) =>
        ipcRenderer.invoke('delete-file', filePath),

    // 用户数据持久化
    saveUserData: (key, data) => ipcRenderer.invoke('save-user-data', key, data),
    getUserData: (key) => ipcRenderer.invoke('get-user-data', key),

    // 安全存储（safeStorage）- P0-2: 基于 Windows DPAPI 的系统级加密
    // 用于替代 auth-core.js 中旧的硬编码盐 XOR 加密（PWDv1/PWDv2）
    safeStorageAvailable: () => ipcRenderer.invoke('auth:safeStorageAvailable'),
    encryptString: (plaintext) => ipcRenderer.invoke('auth:encryptString', plaintext),
    decryptString: (encryptedBase64) => ipcRenderer.invoke('auth:decryptString', encryptedBase64),

    // 登录态
    loginSuccess: (userData) => ipcRenderer.invoke('login-success', userData),
    getCurrentUser: () => ipcRenderer.invoke('get-current-user'),

    // 应用配置（取代旧的 get-index-html-content 正则解析）
    getAppConfig: () => ipcRenderer.invoke('get-app-config'),
    setAutoStart: (enabled) => ipcRenderer.invoke('set-auto-start', enabled),

    // 退出
    quitApp: () => ipcRenderer.invoke('quit-app'),
    logout: () => ipcRenderer.invoke('logout'),

    // 备份文件保存（绕过 Electron 下载机制，直接写文件）
    saveBackupFile: (jsonStr, fileName) => ipcRenderer.invoke('save-backup-file', jsonStr, fileName),

    // P1-1 自动备份策略：保存/列出/删除（userData/backups/ 目录）
    saveAutoBackup: (jsonStr, fileName) => ipcRenderer.invoke('save-auto-backup', jsonStr, fileName),
    listAutoBackups: () => ipcRenderer.invoke('list-auto-backups'),
    deleteAutoBackup: (fileName) => ipcRenderer.invoke('delete-auto-backup', fileName),

    // 主进程推送给渲染进程：登录用户信息（主窗口 dom-ready 时一次性发送）
    onLoginUser: (callback) => {
        const handler = (_event, user) => callback(user);
        ipcRenderer.once('main:login-user', handler);
    },

    showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),

    // ★ 同步对话框（替代原生 alert/confirm）
    // 原因：Electron 35 中原生 alert() 关闭后鼠标光标不显示（已知 bug）
    // 方案：使用 Electron 原生 dialog.showMessageBoxSync（同步阻塞，行为与原生 alert/confirm 一致）
    // 业务代码同步调用 alert/confirm 不受影响（dom-ready 时已重写 window.alert/confirm 调用这些方法）
    alertSync: (message) => ipcRenderer.sendSync('dialog:alert-sync', String(message || '')),
    confirmSync: (message) => ipcRenderer.sendSync('dialog:confirm-sync', String(message || '')) === 1,

    // ★ License 授权管理
    license: {
        getStatus: () => ipcRenderer.invoke('license:get-status'),
        activate: (base64Content) => ipcRenderer.invoke('license:activate', base64Content)
    }
});
