const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的API给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
    // 检测是否在Electron环境中
    isElectron: true,
    
    // 保存处方图片
    savePrescriptionImage: (imageData, fileName) => {
        return ipcRenderer.invoke('save-prescription-image', imageData, fileName);
    },
    
    // 获取图片保存目录
    getImageDirectory: () => {
        return ipcRenderer.invoke('get-image-directory');
    },
    
    // 打开图片保存目录
    openImageDirectory: () => {
        return ipcRenderer.invoke('open-image-directory');
    },
    
    // 选择图片保存目录
    selectImageSaveDirectory: () => {
        return ipcRenderer.invoke('select-image-save-directory');
    },
    
    // 登录成功
    loginSuccess: (userData) => {
        return ipcRenderer.invoke('login-success', userData);
    },
    
    // 获取登录用户
    getLoggedInUser: () => {
        return ipcRenderer.invoke('get-logged-in-user');
    },
    
    // 退出应用
    quitApp: () => {
        return ipcRenderer.invoke('quit-app');
    }
});
