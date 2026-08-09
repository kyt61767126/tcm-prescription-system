// ============================================================================
//  preload.js - 在 contextIsolation 模式下向渲染进程暴露安全 API
//  所有方法均通过 contextBridge 暴露，渲染进程无法直接访问 ipcRenderer/require
//
//  ★ 本文件为机构版 electron/preload.js，基于离线版增加：
//    - saveVideoFile：视频文件保存（ArrayBuffer → 文件）
//    - getVideoDirectory：获取视频保存目录
//    - openVideoDirectory：在文件管理器中打开视频目录
// ============================================================================
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    isElectron: true,

    printPrescription: (html, orientation) =>
        ipcRenderer.invoke('print-prescription', html, orientation),

    savePrescriptionImage: (imageData, fileName) =>
        ipcRenderer.invoke('save-prescription-image', imageData, fileName),

    saveVideoFile: (arrayBuffer, fileName) =>
        ipcRenderer.invoke('save-video-file', arrayBuffer, fileName),

    getVideoDirectory: () =>
        ipcRenderer.invoke('get-video-directory'),

    openVideoDirectory: () =>
        ipcRenderer.invoke('open-video-directory'),

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

    saveUserData: (key, data) => ipcRenderer.invoke('save-user-data', key, data),
    getUserData: (key) => ipcRenderer.invoke('get-user-data', key),

    safeStorageAvailable: () => ipcRenderer.invoke('auth:safeStorageAvailable'),
    encryptString: (plaintext) => ipcRenderer.invoke('auth:encryptString', plaintext),
    decryptString: (encryptedBase64) => ipcRenderer.invoke('auth:decryptString', encryptedBase64),

    loginSuccess: (userData) => ipcRenderer.invoke('login-success', userData),
    getCurrentUser: () => ipcRenderer.invoke('get-current-user'),

    getAppConfig: () => ipcRenderer.invoke('get-app-config'),
    setAutoStart: (enabled) => ipcRenderer.invoke('set-auto-start', enabled),

    quitApp: () => ipcRenderer.invoke('quit-app'),
    logout: () => ipcRenderer.invoke('logout'),

    saveBackupFile: (jsonStr, fileName) => ipcRenderer.invoke('save-backup-file', jsonStr, fileName),

    saveAutoBackup: (jsonStr, fileName) => ipcRenderer.invoke('save-auto-backup', jsonStr, fileName),
    listAutoBackups: () => ipcRenderer.invoke('list-auto-backups'),
    deleteAutoBackup: (fileName) => ipcRenderer.invoke('delete-auto-backup', fileName),

    onLoginUser: (callback) => {
        const handler = (_event, user) => callback(user);
        ipcRenderer.once('main:login-user', handler);
    },

    showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),

    alertSync: (message) => ipcRenderer.sendSync('dialog:alert-sync', String(message || '')),
    confirmSync: (message) => ipcRenderer.sendSync('dialog:confirm-sync', String(message || '')) === 1,

    prompt: (message, defaultValue) => ipcRenderer.invoke('dialog:prompt', String(message || ''), String(defaultValue || '')),

    license: {
        getStatus: () => ipcRenderer.invoke('license:get-status'),
        activate: (base64Content) => ipcRenderer.invoke('license:activate', base64Content),
        selectOfflineFile: () => ipcRenderer.invoke('license:select-offline-file'),
        canPrescribe: () => ipcRenderer.invoke('license:can-prescribe'),
        incrementPrescription: () => ipcRenderer.invoke('license:increment-prescription'),
        decrementPrescription: () => ipcRenderer.invoke('license:decrement-prescription'),
        getPrescriptionStatus: () => ipcRenderer.invoke('license:get-prescription-status'),
        checkFeature: (featureName) => ipcRenderer.invoke('license:check-feature', featureName),
        getFeatureStatus: () => ipcRenderer.invoke('license:get-feature-status'),
        setTrialDays: (days) => ipcRenderer.invoke('license:set-trial-days', days),
        getTrialDays: () => ipcRenderer.invoke('license:get-trial-days')
    },

    activate: {
        show: () => ipcRenderer.invoke('license:show-activate'),
        showExpireAlert: (message) => ipcRenderer.invoke('license:show-expire-alert', message),
        submit: (code, user, clinicName) => ipcRenderer.invoke('license:submit-activate', code, user, clinicName),
        close: () => ipcRenderer.invoke('license:close-activate'),
        restart: () => ipcRenderer.invoke('license:restart'),
        getMachineId: () => ipcRenderer.invoke('license:get-machine-id'),
        submitAdminRequest: (data) => ipcRenderer.invoke('license:submit-admin-request', data),
        checkAdminStatus: (requestId) => ipcRenderer.invoke('license:check-admin-status', requestId),
        saveLicense: (licenseBase64) => ipcRenderer.invoke('license:save-license', licenseBase64),
        cancelAdminRequest: (requestId) => ipcRenderer.invoke('license:cancel-admin-request', requestId),
        // ★ requestId 本地持久化（解决轮询超时/关闭窗口后丢失状态的问题）
        loadAdminRequestId: () => ipcRenderer.invoke('license:load-admin-request-id'),
        clearAdminRequestId: () => ipcRenderer.invoke('license:clear-admin-request-id')
    },

    updateConfig: (updates) => ipcRenderer.invoke('config:update', updates),
    showActivationWindow: () => ipcRenderer.invoke('showActivationWindow'),
    changeUserPassword: (payload) => ipcRenderer.invoke('user:change-password', payload),
    addUser: (payload) => ipcRenderer.invoke('user:add', payload),

    bnzcGetPendingActivation: () => ipcRenderer.invoke('bnzc:get-pending-activation'),
    bnzcClearPendingActivation: () => ipcRenderer.invoke('bnzc:clear-pending-activation'),
    bnzcAutoActivate: (payload) => ipcRenderer.invoke('bnzc:auto-activate', payload),

    onBnzcPendingActivation: (callback) => {
        const handler = (event, data) => callback(data);
        ipcRenderer.on('bnzc:pending-activation', handler);
        return () => ipcRenderer.removeListener('bnzc:pending-activation', handler);
    }
});