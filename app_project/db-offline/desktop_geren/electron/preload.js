// ============================================================================
// Electron Preload 脚本（安全模式：contextIsolation: true, nodeIntegration: false）
// ============================================================================
// 通过 contextBridge 安全暴露 IPC 接口给渲染进程
// 渲染进程只能访问 window.electronAPI 上白名单列出的方法，不能直接访问 Node.js
// ============================================================================

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    isElectron: true,

    // ---------- 打印处方（新增） ----------
    printPrescription: (html, orientation) =>
        ipcRenderer.invoke('print-prescription', html, orientation),

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

    renameMediaFiles: (oldPatientName, newPatientName, oldNo, newNo) => {
        return ipcRenderer.invoke('rename-media-files', oldPatientName, newPatientName, oldNo, newNo);
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

    // ---------- 应用配置 ----------
    getAppConfig: () => {
        return ipcRenderer.invoke('get-app-config');
    },
    updateClinicInfo: (data) => {
        return ipcRenderer.invoke('update-clinic-info', data);
    },
    setAutoStart: (enabled) => {
        return ipcRenderer.invoke('set-auto-start', enabled);
    },

    // ---------- 自动备份 ----------
    saveAutoBackup: (jsonStr, fileName) => {
        return ipcRenderer.invoke('save-auto-backup', jsonStr, fileName);
    },
    listAutoBackups: () => {
        return ipcRenderer.invoke('list-auto-backups');
    },
    deleteAutoBackup: (fileName) => {
        return ipcRenderer.invoke('delete-auto-backup', fileName);
    },

    // ---------- 兼容方法 ----------
    getCurrentUser: () => {
        return ipcRenderer.invoke('get-current-user');
    },
    onLoginUser: (callback) => {
        const handler = (_event, user) => callback(user);
        ipcRenderer.once('main:login-user', handler);
    },
    showMessageBox: (options) => {
        return ipcRenderer.invoke('show-message-box', options);
    },

    // ★清理：移除 localDB 系列（云端桌面版不需要本地数据库，这是离线版功能）
    // index.html:1524 有防御性检查 `window.electronAPI.localDB ? ... : null`，移除后不会崩溃

    // ★ 同步对话框（替代原生 alert/confirm 和原 HTML 模态框方案）
    // 原因：
    //   1. Electron 35 原生 alert() 关闭后鼠标光标不显示（Chromium 模态框焦点 bug）
    //   2. 原 HTML 模态框方案将 confirm 改为返回 Promise，破坏了 `if (!confirm(...)) return;` 同步语义
    //      （Promise 是 truthy，导致删除等危险操作不弹窗直接执行）
    // 方案：使用 Electron 原生 dialog.showMessageBoxSync（同步阻塞，行为与原生 alert/confirm 一致）
    // 兼容：同步返回 boolean，`if (!confirm(...))` 和 `await confirm(...)` 均正确工作
    alertSync: (message) => ipcRenderer.sendSync('dialog:alert-sync', String(message || '')),
    confirmSync: (message) => ipcRenderer.sendSync('dialog:confirm-sync', String(message || '')) === 1,

    // ★ 异步 prompt 对话框（替代原生 window.prompt）
    // 原因：Electron 35 BrowserWindow 中 window.prompt() 默认返回 null（不弹框），
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
        // ★ 一体化到期提示 + 拉起激活窗口（main process 中 dialog + showActivateWindow）
        showExpireAlert: (message) => ipcRenderer.invoke('license:show-expire-alert', message),
        // ★ v3 新增：clinicName 参数透传给云端做绑定校验
        submit: (code, user, clinicName) => ipcRenderer.invoke('license:submit-activate', code, user, clinicName),
        close: () => ipcRenderer.invoke('license:close-activate'),
        restart: () => ipcRenderer.invoke('license:restart'),
        getMachineId: () => ipcRenderer.invoke('license:get-machine-id')
    }
});
