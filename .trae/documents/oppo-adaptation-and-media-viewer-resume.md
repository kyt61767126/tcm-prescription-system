# OPPO适配 + 媒体查看功能 — 续接实施计划

## 摘要

本文档续接之前已批准的计划。OPPO适配（Part 1）和NativeBridge Java方法（Part 2.1）已完成。剩余工作：electronAPI shim JS方法（Part 2.2）、file_paths.xml（Part 2.3）、renderHistoryList + 媒体查看弹窗（Part 3）、Git推送（Part 4）。

## 当前状态分析

### 已完成 ✅
1. **OPPO适配**：4个APP + 云端网页的styles.xml（cutout=shortEdges）、AndroidManifest（adjustPan）、setTextZoom(100)、viewport-fit=cover、safe-area CSS
2. **NativeBridge Java方法**：4个APP的MainActivity.java已添加`findMediaFiles`、`openFile`、`readFileAsBase64`方法实现 + switch case分支

### 未完成 ❌
1. **electronAPI shim JS方法**：
   - 3个离线APP的`injectElectronApiShim`方法中缺少`findMediaFiles`、`openFile`、`readFileAsBase64`三个JS方法（getVideoDirectory后直接跳到loginSuccess）
   - 云端APP的`video-recorder-inject.js`中缺少相同3个方法（getVideoDirectory后直接跳到quitApp）
2. **云端APP file_paths.xml**：缺少`<files-path name="internal_files" path="." />`
3. **renderHistoryList + 媒体查看弹窗**：4个index.html均未添加📷🎥图标、viewMediaFiles函数、媒体查看弹窗
4. **Git推送**：云端修改尚未提交推送

## 实施方案

### Part 1: electronAPI shim新增3个JS方法

#### 1.1 三个离线APP的injectElectronApiShim

**文件**：
- `offline_project/db-shouji/android/app/src/main/java/com/benneng/pres/MainActivity.java`
- `offline_project/db-bendi/android/app/src/main/java/com/benneng/pres/MainActivity.java`
- `offline_project/db-dingzhi/android/app/src/main/java/com/benneng/pres/MainActivity.java`

**修改位置**：在`getVideoDirectory`方法后、`loginSuccess`方法前插入3个新方法。

**匹配字符串**（3个文件相同）：
```java
"    getVideoDirectory: function(){" +
"      return new Promise(function(resolve){" +
"        try { var r = callNative('getVideoDirectory', '{}'); resolve(r); }" +
"        catch(e){ resolve({success:false, error:String(e)}); }" +
"      });" +
"    }," +
"    loginSuccess: function(u){ return P({success:true}); }," +
```

**替换为**：
```java
"    getVideoDirectory: function(){" +
"      return new Promise(function(resolve){" +
"        try { var r = callNative('getVideoDirectory', '{}'); resolve(r); }" +
"        catch(e){ resolve({success:false, error:String(e)}); }" +
"      });" +
"    }," +
"    findMediaFiles: function(patientName, prescriptionNo){" +
"      return new Promise(function(resolve){" +
"        try { var r = callNative('findMediaFiles', JSON.stringify({patientName:patientName,prescriptionNo:prescriptionNo})); resolve(r); }" +
"        catch(e){ resolve({success:false, error:String(e), files:[]}); }" +
"      });" +
"    }," +
"    openFile: function(filePath, mimeType){" +
"      return new Promise(function(resolve){" +
"        try { var r = callNative('openFile', JSON.stringify({filePath:filePath,mimeType:mimeType||''})); resolve(r); }" +
"        catch(e){ resolve({success:false, error:String(e)}); }" +
"      });" +
"    }," +
"    readFileAsBase64: function(filePath){" +
"      return new Promise(function(resolve){" +
"        try { var r = callNative('readFileAsBase64', JSON.stringify({filePath:filePath})); resolve(r); }" +
"        catch(e){ resolve({success:false, error:String(e)}); }" +
"      });" +
"    }," +
"    loginSuccess: function(u){ return P({success:true}); }," +
```

#### 1.2 云端APP的video-recorder-inject.js

**文件**：`cloud_project/cloud_app/app/src/main/assets/video-recorder-inject.js`

**修改位置**：在`getVideoDirectory`方法后、`quitApp`方法前插入3个新方法（line 73-74之间）。

**匹配字符串**：
```javascript
            getVideoDirectory: function () {
                return new Promise(function (resolve) {
                    try {
                        var r = callNative('getVideoDirectory', '{}');
                        resolve(r);
                    } catch (e) { resolve({ success: false, error: String(e) }); }
                });
            },
            quitApp: function () {
```

**替换为**：
```javascript
            getVideoDirectory: function () {
                return new Promise(function (resolve) {
                    try {
                        var r = callNative('getVideoDirectory', '{}');
                        resolve(r);
                    } catch (e) { resolve({ success: false, error: String(e) }); }
                });
            },
            findMediaFiles: function (patientName, prescriptionNo) {
                return new Promise(function (resolve) {
                    try {
                        var r = callNative('findMediaFiles', JSON.stringify({ patientName: patientName, prescriptionNo: prescriptionNo }));
                        resolve(r);
                    } catch (e) { resolve({ success: false, error: String(e), files: [] }); }
                });
            },
            openFile: function (filePath, mimeType) {
                return new Promise(function (resolve) {
                    try {
                        var r = callNative('openFile', JSON.stringify({ filePath: filePath, mimeType: mimeType || '' }));
                        resolve(r);
                    } catch (e) { resolve({ success: false, error: String(e) }); }
                });
            },
            readFileAsBase64: function (filePath) {
                return new Promise(function (resolve) {
                    try {
                        var r = callNative('readFileAsBase64', JSON.stringify({ filePath: filePath }));
                        resolve(r);
                    } catch (e) { resolve({ success: false, error: String(e) }); }
                });
            },
            quitApp: function () {
```

### Part 2: 云端APP file_paths.xml

**文件**：`cloud_project/cloud_app/app/src/main/res/xml/file_paths.xml`

**修改**：在`<cache-path>`后添加`<files-path>`。

**匹配字符串**：
```xml
    <cache-path name="my_cache_images" path="." />
</paths>
```

**替换为**：
```xml
    <cache-path name="my_cache_images" path="." />
    <files-path name="internal_files" path="." />
</paths>
```

### Part 3: renderHistoryList + 媒体查看弹窗

需要修改4个index.html文件：
1. `offline_project/db-shouji/android/app/src/main/assets/public/index.html`
2. `offline_project/db-bendi/android/app/src/main/assets/public/index.html`
3. `offline_project/db-dingzhi/android/app/src/main/assets/public/index.html`
4. `cloud_project/tcm-prescription-system/public/index.html`

#### 3.1 修改renderHistoryList添加媒体图标

**3个离线APP**（renderHistoryList结构相同）：

在`[${escapeHtml(p.prescriptionNo || '')}]`后面添加📷🎥图标按钮：
```javascript
<div style="font-size:10px;color:#8b0000;font-weight:bold;">[${escapeHtml(p.prescriptionNo || '')}]</div>
<button onclick="event.stopPropagation();viewMediaFiles('${escapeHtml(p.patientName)}','${escapeHtml(p.prescriptionNo || '')}')" style="background:none;border:none;font-size:14px;cursor:pointer;padding:0 2px;" title="查看拍照录像">📷🎥</button>
```

**云端网页**（有分页逻辑）：

在`[${escapeHtml(p.prescriptionNo || '')}]`后面的`${isToday ? ...}`之前添加：
```javascript
<button onclick="event.stopPropagation();viewMediaFiles('${escapeHtml(p.patientName || p.name || '')}','${escapeHtml(p.prescriptionNo || '')}')" style="background:none;border:none;font-size:14px;cursor:pointer;padding:0 2px;" title="查看拍照录像">📷🎥</button>
```

#### 3.2 添加viewMediaFiles等函数

在renderHistoryList函数后添加以下函数（4个文件相同）：

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
        content.innerHTML = sorted.map(f => 
            `<div class="media-thumb" onclick="openMediaFile('${f.type === 'video' ? 'video' : 'image'}','${f.path.replace(/'/g,"\\'")}')" style="display:inline-block;margin:5px;cursor:pointer;text-align:center;">
                <div style="width:80px;height:80px;border:1px solid #ddd;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:32px;background:#f5f5f5;">${f.type === 'video' ? '🎥' : '📷'}</div>
                <div style="font-size:10px;color:#666;margin-top:4px;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(f.name)}</div>
            </div>`
        ).join('');
    } catch(e) {
        content.innerHTML = '<div style="text-align:center;padding:20px;color:#dc3545;">查找失败: ' + escapeHtml(String(e)) + '</div>';
    }
}

async function openMediaFile(type, filePath) {
    if (!window.electronAPI) return;
    if (type === 'image') {
        const content = document.getElementById('mediaViewerContent');
        if (!content) return;
        content.innerHTML = '<div style="text-align:center;padding:20px;color:#999;">加载中...</div>';
        try {
            const result = await window.electronAPI.readFileAsBase64(filePath);
            if (result.success && result.data) {
                content.innerHTML = '<img src="' + result.data + '" style="max-width:100%;max-height:70vh;border-radius:4px;" /><div style="margin-top:10px;"><button class="small-btn" onclick="window.electronAPI.openFile(\'' + filePath.replace(/'/g,"\\'") + '\')" style="background:#4CAF50;color:white;padding:6px 16px;border:none;border-radius:4px;cursor:pointer;">用系统应用打开</button></div>';
            } else {
                content.innerHTML = '<div style="text-align:center;padding:20px;color:#dc3545;">加载失败</div>';
            }
        } catch(e) {
            content.innerHTML = '<div style="text-align:center;padding:20px;color:#dc3545;">加载失败: ' + escapeHtml(String(e)) + '</div>';
        }
    } else {
        try {
            await window.electronAPI.openFile(filePath, 'video/webm');
        } catch(e) {
            showToast('打开视频失败: ' + String(e));
        }
    }
}

function closeMediaViewer() {
    const overlay = document.getElementById('mediaViewerOverlay');
    if (overlay) overlay.style.display = 'none';
}
```

#### 3.3 添加媒体查看弹窗HTML + CSS

在`</body>`前添加弹窗HTML：
```html
<div id="mediaViewerOverlay" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:99998;align-items:center;justify-content:center;" onclick="if(event.target===this)closeMediaViewer()">
    <div style="background:#fff;border-radius:10px;padding:16px;width:90%;max-width:500px;max-height:80vh;overflow-y:auto;position:relative;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <span style="font-size:16px;font-weight:600;color:#333;">拍照录像查看</span>
            <button onclick="closeMediaViewer()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#999;line-height:1;">&times;</button>
        </div>
        <div id="mediaViewerContent"></div>
    </div>
</div>
```

### Part 4: Git提交推送

提交云端网页（tcm-prescription-system）和云端APP（cloud_app）的修改到GitHub，触发Cloudflare Pages自动部署。

```bash
cd cloud_project/tcm-prescription-system
git add -A
git commit -m "feat: 添加历史处方媒体查看功能 + OPPO适配优化"
git push origin main
```

注意：仅推送云端网页和云端APP的修改。离线APP不涉及Git推送。

## 实施顺序

1. Part 1.1 — 3个离线APP的injectElectronApiShim添加3个JS方法
2. Part 1.2 — 云端APP的video-recorder-inject.js添加3个JS方法
3. Part 2 — 云端APPfile_paths.xml添加files-path
4. Part 3.1 — 4个index.html的renderHistoryList添加📷🎥图标
5. Part 3.2 — 4个index.html添加viewMediaFiles等函数
6. Part 3.3 — 4个index.html添加媒体查看弹窗HTML
7. Part 4 — Git提交推送云端修改

## 验证步骤

1. **编译验证**：确认Java文件无语法错误（检查字符串拼接是否正确）
2. **功能验证**：
   - 在历史处方列表中每条记录应显示📷🎥图标
   - 点击图标弹出媒体查看弹窗
   - 弹窗中显示该患者处方的所有图片和视频缩略图
   - 点击图片缩略图显示Base64预览
   - 点击视频缩略图用系统播放器打开
3. **OPPO适配验证**：界面在OPPO Find X8s+上显示正常，无遮挡
4. **云端部署验证**：GitHub推送后2-5分钟Cloudflare Pages自动部署完成

## 假设与决策

1. **方案A（文件名匹配）**：不修改处方数据结构，通过扫描文件系统中以`患者姓名_处方编号`开头的文件来查找媒体。已由用户批准。
2. **云端网页浏览器访问**：electronAPI不存在时，点击📷🎥图标提示"媒体查看功能仅在APP中可用"。
3. **媒体排序**：图片在前、视频在后，同类型按修改时间排序。
4. **图片预览**：在弹窗内用Base64数据显示（适合小图片），视频用系统播放器打开（避免大文件Base64传输）。
