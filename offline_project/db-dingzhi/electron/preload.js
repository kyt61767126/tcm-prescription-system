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

    // ---------- 打印处方（新增） ----------
    printPrescription: (html, orientation) =>
        ipcRenderer.invoke('print-prescription', html, orientation),

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

    renameMediaFiles: (oldPatientName, newPatientName, oldNo, newNo) =>
        ipcRenderer.invoke('rename-media-files', oldPatientName, newPatientName, oldNo, newNo),

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

    // ★ 异步 prompt 对话框（替代原生 window.prompt）
    // 原因：Electron BrowserWindow 中 window.prompt() 默认返回 null（不弹框），
    //      导致 handleEditUser / editMedicine 等函数静默失败（点击"编辑"无反应）
    // 方案：创建独立 BrowserWindow（modal）作为 prompt 对话框，返回 Promise<string|null>
    // 兼容：业务代码需用 `await prompt(...)`，同步调用会得到 Promise 对象
    prompt: (message, defaultValue) => ipcRenderer.invoke('dialog:prompt', String(message || ''), String(defaultValue || '')),

    // ★ License 授权管理
    license: {
        getStatus: () => ipcRenderer.invoke('license:get-status'),
        activate: (base64Content) => ipcRenderer.invoke('license:activate', base64Content),
        // ★ 新增：离线激活文件选择对话框（返回 { success, filePath, base64Content }）
        selectOfflineFile: () => ipcRenderer.invoke('license:select-offline-file'),
        // v2 新增：处方数量限制
        canPrescribe: () => ipcRenderer.invoke('license:can-prescribe'),
        incrementPrescription: () => ipcRenderer.invoke('license:increment-prescription'),
        decrementPrescription: () => ipcRenderer.invoke('license:decrement-prescription'),
        getPrescriptionStatus: () => ipcRenderer.invoke('license:get-prescription-status'),
        // v2 新增：功能权限校验
        checkFeature: (featureName) => ipcRenderer.invoke('license:check-feature', featureName),
        getFeatureStatus: () => ipcRenderer.invoke('license:get-feature-status'),
        // ★ 试用期配置（测试用，0=立即过期，默认 7）
        setTrialDays: (days) => ipcRenderer.invoke('license:set-trial-days', days),
        getTrialDays: () => ipcRenderer.invoke('license:get-trial-days')
    },

    // ★ 激活码激活窗口（云端激活系统，第3周任务）
    activate: {
        show: () => ipcRenderer.invoke('license:show-activate'),
        // ★ 一体化到期提示 + 拉起激活窗口（main process 中 dialog.showMessageBoxSync + showActivateWindow）
        showExpireAlert: (message) => ipcRenderer.invoke('license:show-expire-alert', message),
        // ★ v3 新增：clinicName 参数透传给云端做绑定校验
        submit: (code, user, clinicName) => ipcRenderer.invoke('license:submit-activate', code, user, clinicName),
        close: () => ipcRenderer.invoke('license:close-activate'),
        restart: () => ipcRenderer.invoke('license:restart'),
        getMachineId: () => ipcRenderer.invoke('license:get-machine-id')
    }
});
