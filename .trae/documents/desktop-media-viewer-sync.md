# 桌面版媒体查看功能同步实施计划

## 概述
将移动端已完成的"拍照录像在历史处方栏快速查看"功能（方案A：文件名匹配）同步到4个Electron桌面版应用：
1. 云端桌面版: `cloud_project/cloud_desktop/`
2. 离线桌面版 db-bendi: `offline_project/db-bendi/`
3. 离线桌面版 db-dingzhi: `offline_project/db-dingzhi/`
4. 离线桌面版 db-geren: `offline_project/db-geren/`

每个桌面版需修改3个文件：preload.js、main.js、index.html。

## 当前状态分析

### 共同架构
- Electron `contextBridge.exposeInMainWorld('electronAPI', {...})` + `ipcRenderer.invoke()` + `ipcMain.handle()`
- 文件保存路径：`downloads/YYYY-MM/`（月份文件夹）
- 已有视频录制功能：saveVideoFile, getVideoDirectory
- 4个index.html的renderHistoryList中均无📷🎥图标、viewMediaFiles函数、mediaViewerOverlay元素

### 各版本差异
| 项目 | cloud_desktop | db-bendi | db-dingzhi | db-geren |
|------|--------------|----------|------------|----------|
| shell导入 | **缺失** | 已有 | 已有 | 已有 |
| IPC包装 | safeHandle | 直接handle | 直接handle | 直接handle |
| renderHistoryList | 分页+LOCAL-前缀+isToday | 简单单行 | 单行+诊费 | 单行+诊费 |
| openVideoDirectory方法 | 无 | 有 | 有 | 有 |

### 关键行号定位
**cloud_desktop:**
- preload.js: getVideoDirectory在行35-37，saveBackupFile在行40
- main.js: require在行1，getDownloadsDirectory在行112，getCurrentMonthDirectory在行135，get-video-directory handler在行465-467，save-backup-file handler在行470
- index.html: escapeHtml行1966，showToast行5630，renderHistoryList行6015，真正`</body>`行9282（行6212是打印模板字符串内的）

**db-bendi:**
- preload.js: openVideoDirectory在行26-27，saveUserData在行30
- main.js: open-video-directory handler在行305-309，saveUserData函数在行311
- index.html: escapeHtml行1516，showToast行2745，renderHistoryList行3053，`</body>`行4895

**db-dingzhi:**
- preload.js: openVideoDirectory在行26-27，saveUserData在行30
- main.js: open-video-directory handler在行305-309，saveUserData函数在行311
- index.html: escapeHtml行1547，showToast行2773，renderHistoryList行3081，`</body>`行4957

**db-geren:**
- preload.js: openVideoDirectory在行26-27，saveUserData在行30
- main.js: open-video-directory handler在行305-309，saveUserData函数在行311
- index.html: escapeHtml行1305，showToast行2545，renderHistoryList行2853，`</body>`行4726

## 实施方案

### 第一步：修改4个 preload.js

在getVideoDirectory（或openVideoDirectory）之后添加3个新方法：

```javascript
// ---------- 媒体文件查看（新增） ----------
findMediaFiles: (patientName, prescriptionNo) =>
    ipcRenderer.invoke('find-media-files', patientName, prescriptionNo),

openFile: (filePath, mimeType) =>
    ipcRenderer.invoke('open-file', filePath, mimeType || ''),

readFileAsBase64: (filePath) =>
    ipcRenderer.invoke('read-file-as-base64', filePath),
```

**插入位置：**
- cloud_desktop/preload.js: 在 `getVideoDirectory` (行35-37) 之后，`saveBackupFile` (行40) 之前
- db-bendi/dingzhi/geren/preload.js: 在 `openVideoDirectory` (行26-27) 之后，`saveUserData` (行30) 之前

### 第二步：修改4个 main.js — 添加IPC handlers

#### cloud_desktop/electron/main.js
1. **行1修改**：添加shell导入
   - 原: `const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');`
   - 改: `const { app, BrowserWindow, ipcMain, dialog, session, shell } = require('electron');`

2. **行467后插入**（get-video-directory handler之后，save-backup-file handler之前）：
   使用safeHandle包装，保持与现有代码风格一致

#### db-bendi/dingzhi/geren/electron/main.js
**行309后插入**（open-video-directory handler之后，saveUserData函数之前）：
直接使用ipcMain.handle，与现有代码风格一致

#### IPC handler实现代码

```javascript
// ★ 查找媒体文件（新增）
ipcMain.handle('find-media-files', async (event, patientName, prescriptionNo) => {
    try {
        if (!patientName) return { success: true, files: [] };
        const downloadsDir = getDownloadsDirectory();
        const files = [];
        const prefix = `${patientName}_${prescriptionNo || ''}`;
        let monthDirs = [];
        try {
            const entries = await fs.readdir(downloadsDir, { withFileTypes: true });
            monthDirs = entries.filter(e => e.isDirectory()).map(e => path.join(downloadsDir, e.name));
        } catch (e) { /* downloads目录可能不存在 */ }
        for (const monthDir of monthDirs) {
            let fileEntries = [];
            try {
                fileEntries = await fs.readdir(monthDir, { withFileTypes: true });
            } catch (e) { continue; }
            for (const fe of fileEntries) {
                if (!fe.isFile()) continue;
                const fileName = fe.name;
                if (!fileName.startsWith(prefix)) continue;
                const filePath = path.join(monthDir, fileName);
                try {
                    const stat = await fs.stat(filePath);
                    const ext = path.extname(fileName).toLowerCase();
                    const isVideo = ext === '.webm' || ext === '.mp4' || ext === '.avi' || ext === '.mov';
                    files.push({
                        name: fileName,
                        path: filePath,
                        type: isVideo ? 'video' : 'image',
                        size: stat.size,
                        lastModified: stat.mtimeMs
                    });
                } catch (e) { /* 跳过无法读取的文件 */ }
            }
        }
        return { success: true, files };
    } catch (error) {
        console.error('查找媒体文件失败:', error);
        return { success: false, error: error.message, files: [] };
    }
});

// ★ 打开文件（系统默认程序）（新增）
ipcMain.handle('open-file', async (event, filePath, mimeType) => {
    try {
        if (!filePath) return { success: false, error: '文件路径为空' };
        await shell.openPath(filePath);
        return { success: true };
    } catch (error) {
        console.error('打开文件失败:', error);
        return { success: false, error: error.message };
    }
});

// ★ 读取文件为Base64（新增）
ipcMain.handle('read-file-as-base64', async (event, filePath) => {
    try {
        if (!filePath) return { success: false, error: '文件路径为空' };
        const buffer = await fs.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        let mimeType = 'image/png';
        if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
        else if (ext === '.png') mimeType = 'image/png';
        else if (ext === '.webm') mimeType = 'video/webm';
        else if (ext === '.mp4') mimeType = 'video/mp4';
        const base64 = buffer.toString('base64');
        return { success: true, base64: `data:${mimeType};base64,${base64}` };
    } catch (error) {
        console.error('读取文件失败:', error);
        return { success: false, error: error.message };
    }
});
```

**cloud_desktop版本注意**：用 `safeHandle('find-media-files', async ...)` 替代 `ipcMain.handle('find-media-files', async ...)`，保持与现有代码风格一致。

### 第三步：修改4个 index.html — 3处修改

#### 修改点1：renderHistoryList中添加📷🎥图标按钮

**cloud_desktop/index.html** (行6046附近，删除按钮之前)：
在删除按钮前插入媒体查看按钮：
```javascript
<button onclick="event.stopPropagation();viewMediaFiles('${escapeHtml(p.patientName || p.name || '未知')}','${escapeHtml(p.prescriptionNo || '')}')" style="background:none;border:none;font-size:14px;cursor:pointer;padding:0 2px;" title="查看拍照录像">📷🎥</button>
<button class="small-btn" style="background:#ffdddd;padding:2px 6px;font-size:10px;" onclick="event.stopPropagation();deleteHistory(${p.id})">删除</button>
```

**db-bendi/dingzhi/geren/index.html** (renderHistoryList单行内，删除按钮之前)：
在删除按钮前插入媒体查看按钮（注意保持单行格式）：
```javascript
<button onclick="event.stopPropagation();viewMediaFiles('${escapeHtml(p.patientName)}','${escapeHtml(p.prescriptionNo || '')}')" style="background:none;border:none;font-size:14px;cursor:pointer;padding:0 2px;" title="查看拍照录像">📷🎥</button><button class="small-btn" style="background:#ffdddd;padding:2px 6px;font-size:10px;" onclick="event.stopPropagation();deleteHistory(${p.id})">删除</button>
```

#### 修改点2：添加4个JavaScript函数

在renderHistoryList函数之后添加4个函数（与移动端完全一致）：
```javascript
async function viewMediaFiles(patientName, prescriptionNo) {
    if (!window.electronAPI || !window.electronAPI.findMediaFiles) {
        showToast('媒体查看功能仅在APP中可用');
        return;
    }
    const overlay = document.getElementById('mediaViewerOverlay');
    const content = document.getElementById('mediaViewerContent');
    if (!overlay || !content) return;
    content.innerHTML = '<div style="text-align:center;padding:20px;color:#999;">正在查找媒体文件...</div>';
    overlay.style.display = 'flex';
    try {
        const result = await window.electronAPI.findMediaFiles(patientName, prescriptionNo);
        if (!result.success || !result.files || result.files.length === 0) {
            content.innerHTML = '<div style="text-align:center;padding:20px;color:#999;">未找到相关拍照或录像文件</div>';
            return;
        }
        const sorted = result.files.sort((a,b) => {
            const aType = a.type === 'video' ? 1 : 0;
            const bType = b.type === 'video' ? 1 : 0;
            if (aType !== bType) return aType - bType;
            return (a.lastModified||0) - (b.lastModified||0);
        });
        window.__currentMediaFiles = sorted;
        content.innerHTML = sorted.map((f, idx) =>
            '<div class="media-thumb" onclick="openMediaFile(' + idx + ')" style="display:inline-block;margin:5px;cursor:pointer;text-align:center;">' +
                '<div style="width:80px;height:80px;border:1px solid #ddd;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:32px;background:#f5f5f5;">' + (f.type === 'video' ? '🎥' : '📷') + '</div>' +
                '<div style="font-size:10px;color:#666;margin-top:4px;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(f.name) + '</div>' +
            '</div>'
        ).join('');
    } catch(e) {
        content.innerHTML = '<div style="text-align:center;padding:20px;color:#dc3545;">查找失败: ' + escapeHtml(String(e)) + '</div>';
    }
}

async function openMediaFile(idx) {
    const file = window.__currentMediaFiles && window.__currentMediaFiles[idx];
    if (!file) return;
    if (file.type === 'video') {
        const result = await window.electronAPI.openFile(file.path);
        if (!result.success) showToast('打开视频失败: ' + (result.error || ''));
    } else {
        const content = document.getElementById('mediaViewerContent');
        content.innerHTML = '<div style="text-align:center;margin-bottom:10px;"><button onclick="viewMediaFilesBack()" style="padding:6px 12px;background:#1976d2;color:#fff;border:none;border-radius:4px;cursor:pointer;">← 返回列表</button></div><div style="text-align:center;"><img src="' + (file.path.startsWith('data:') ? file.path : '') + '" style="max-width:100%;max-height:400px;border:1px solid #ddd;border-radius:4px;" /></div>';
        try {
            const result = await window.electronAPI.readFileAsBase64(file.path);
            if (result.success) {
                const img = content.querySelector('img');
                if (img) img.src = result.base64;
            } else {
                showToast('加载图片失败: ' + (result.error || ''));
            }
        } catch(e) {
            showToast('加载图片失败: ' + String(e));
        }
    }
}

function viewMediaFilesBack() {
    const content = document.getElementById('mediaViewerContent');
    if (!content || !window.__currentMediaFiles) return;
    content.innerHTML = window.__currentMediaFiles.map((f, idx) =>
        '<div class="media-thumb" onclick="openMediaFile(' + idx + ')" style="display:inline-block;margin:5px;cursor:pointer;text-align:center;">' +
            '<div style="width:80px;height:80px;border:1px solid #ddd;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:32px;background:#f5f5f5;">' + (f.type === 'video' ? '🎥' : '📷') + '</div>' +
            '<div style="font-size:10px;color:#666;margin-top:4px;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(f.name) + '</div>' +
        '</div>'
    ).join('');
}

function closeMediaViewer() {
    const overlay = document.getElementById('mediaViewerOverlay');
    if (overlay) overlay.style.display = 'none';
    window.__currentMediaFiles = null;
}
```

**插入位置：**
- cloud_desktop: 在renderHistoryList函数（行6054）之后
- db-bendi: 在renderHistoryList函数（行3057）之后
- db-dingzhi: 在renderHistoryList函数（行3085）之后
- db-geren: 在renderHistoryList函数（行2857）之后

#### 修改点3：在`</body>`前添加mediaViewerOverlay HTML

```html
<div id="mediaViewerOverlay" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:99998;align-items:center;justify-content:center;" onclick="if(event.target===this)closeMediaViewer()"><div style="background:#fff;border-radius:10px;padding:16px;width:90%;max-width:500px;max-height:80vh;overflow-y:auto;position:relative;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><span style="font-size:16px;font-weight:600;color:#333;">拍照录像查看</span><button onclick="closeMediaViewer()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#999;line-height:1;">&times;</button></div><div id="mediaViewerContent"></div></div></div>
```

**插入位置：**
- cloud_desktop: 行9282 `</body>` 之前
- db-bendi: 行4895 `</body>` 之前
- db-dingzhi: 行4957 `</body>` 之前
- db-geren: 行4726 `</body>` 之前

## 验证步骤

1. **代码完整性验证**：
   - 检查每个preload.js是否包含findMediaFiles, openFile, readFileAsBase64
   - 检查每个main.js是否包含3个新IPC handler
   - 检查每个index.html是否包含📷🎥图标、4个函数、mediaViewerOverlay

2. **cloud_desktop特殊验证**：
   - 确认main.js行1已添加shell导入
   - 确认IPC handler使用safeHandle包装

3. **Git提交推送**：
   - 提交桌面版修改
   - 推送到GitHub（cloud_desktop部分需触发Cloudflare Pages部署）

## 假设与决策

1. **文件名匹配规则**：与移动端一致，匹配以`患者姓名_处方编号`开头的文件
2. **媒体文件类型**：图片(png/jpg/jpeg)和视频(webm/mp4/avi/mov)
3. **搜索范围**：遍历downloads目录下所有月份子目录
4. **图片预览方式**：Base64编码内嵌显示（与移动端一致）
5. **视频打开方式**：系统默认播放器打开（shell.openPath）
6. **cloud_desktop的IPC包装**：使用现有safeHandle保持代码风格一致
7. **离线版不需要导入shell**：3个离线版main.js行15已包含shell
