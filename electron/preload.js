const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
    // 检测是否在 Electron 环境中运行
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
    }
});
