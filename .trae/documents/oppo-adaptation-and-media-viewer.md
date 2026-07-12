# OPPO Find X8s+ 适配优化 + 历史处方栏媒体快速查看

## 概述

两个任务：
1. **OPPO Find X8s+ UI适配优化**：修复底部导航被手势条遮挡、顶部内容被摄像头遮挡、界面元素尺寸异常、整体布局错位
2. **历史处方栏媒体快速查看（方案A：文件名匹配）**：在历史处方列表添加📷🎥图标，点击查看该处方的拍照和录像文件

涉及 4 个 APP + 1 个云端网页：
- 离线 APP：db-shouji（个人版）、db-bendi（本地版）、db-dingzhi（定制版）
- 云端 APP：cloud_app
- 云端网页：cloud_project/tcm-prescription-system/public/index.html

---

## Part 1: OPPO Find X8s+ UI适配优化

### 根因分析

| 问题 | 根因 |
|------|------|
| 底部导航被手势条遮挡 | `.mobile-nav` 和 `.mobile-action-bar` 使用 `position:fixed; bottom:0`，未留 `env(safe-area-inset-bottom)` 空间 |
| 顶部内容被摄像头遮挡 | `windowLayoutInDisplayCutoutMode=never` 在部分 ColorOS 版本上行为异常，且 viewport 缺少 `viewport-fit=cover`，`env(safe-area-inset-top)` 不生效 |
| 界面元素太小/太大 | WebSettings 未设置 `setTextZoom(100)`，ColorOS 系统字体缩放影响 WebView 文字大小 |
| 整体布局显示不全/错位 | `100vh` 在 cutout letterboxing 模式下不匹配实际可视区域；底部 padding-bottom 固定 110px 未考虑 safe-area |

### 修改方案

#### 1.1 离线 APP（db-shouji / db-bendi / db-dingzhi）— 三处同步修改

##### 1.1a `android/app/src/main/res/values/styles.xml`

将 `AppTheme.NoActionBarLaunch` 中的 cutout 模式从 `never` 改为 `shortEdges`，允许内容延伸到刘海区域（配合 safe-area CSS 避开）：

```xml
<!-- 改前 -->
<item name="android:windowLayoutInDisplayCutoutMode">never</item>
<!-- 改后 -->
<item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>
```

##### 1.1b `android/app/src/main/java/com/benneng/pres/MainActivity.java`

在 `configureWebView()` 中 WebSettings 部分添加文本缩放锁定（约 line 109 附近，`s.setMixedContentMode(...)` 之后）：

```java
s.setTextZoom(100); // 锁定文本缩放100%，防止ColorOS系统字体设置影响布局
```

##### 1.1c `android/app/src/main/assets/public/index.html`

**viewport meta（line 1）**：添加 `viewport-fit=cover`

```
改前: content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
改后: content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
```

**CSS — body 和 html 添加 safe-area 和 text-size-adjust**（在 `body { ... }` 规则中，约 line 26）：

```css
body {
    /* 已有属性保持不变 */
    -webkit-text-size-adjust: 100%;
    text-size-adjust: 100%;
    padding-top: env(safe-area-inset-top);
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
}
```

**CSS — `.mobile-nav` 添加底部 safe-area**（line 161）：

```css
.mobile-nav {
    /* 已有属性保持不变 */
    padding-bottom: env(safe-area-inset-bottom);
}
```

**CSS — `.mobile-action-bar` 调整 bottom 偏移**（line 169）：

```css
.mobile-action-bar {
    /* 已有属性保持不变 */
    bottom: calc(52px + env(safe-area-inset-bottom));
}
```

**CSS — `.main-container` 移动端 padding-bottom 包含 safe-area**（在 `@media (max-width: 768px)` 内，line 191）：

```css
.main-container {
    /* 已有属性保持不变 */
    padding-bottom: calc(110px + env(safe-area-inset-bottom));
}
```

#### 1.2 云端 APP（cloud_app）

##### 1.2a `app/src/main/res/values/styles.xml`

同离线 APP，将 `windowLayoutInDisplayCutoutMode` 从 `never` 改为 `shortEdges`。

##### 1.2b `app/src/main/AndroidManifest.xml`

添加 `android:windowSoftInputMode="adjustPan"`（当前缺失，line 24）：

```xml
android:screenOrientation="portrait"
android:windowSoftInputMode="adjustPan">
```

##### 1.2c `app/src/main/java/com/tcm/prescription/MainActivity.java`

在 `configureWebView()` 中 WebSettings 部分添加（约 line 113 附近）：

```java
settings.setTextZoom(100);
```

##### 1.2d `cloud_project/tcm-prescription-system/public/index.html`（云端网页）

**viewport meta（line 5）**：添加 `viewport-fit=cover`

**CSS**：同离线 APP，添加 `text-size-adjust`、`safe-area-inset` 到 body、`.mobile-nav`、`.mobile-action-bar`、`.main-container`

> 注意：云端网页既在云端 APP（WebView）中加载，也在浏览器中访问。`viewport-fit=cover` 和 `env(safe-area-inset-*)` 在无刘海设备上自动失效，不影响浏览器用户体验。

---

## Part 2: 历史处方栏媒体快速查看（方案A：文件名匹配）

### 设计原理

不修改处方数据结构。通过 NativeBridge 扫描本地文件系统中以 `患者姓名_处方编号` 开头的文件，在历史处方列表中显示📷🎥图标，点击弹出媒体查看弹窗。

文件命名格式（已实现）：
- 图片：`患者姓名_处方编号_photo_舌面.png` / `患者姓名_处方编号_photo_面诊.png`
- 视频：`患者姓名_处方编号_video.webm`

文件存储路径（已实现）：
- 图片：`getExternalFilesDir(DIRECTORY_PICTURES)/本能中医处方/YYYY-MM/`
- 视频：`getExternalFilesDir(DIRECTORY_MOVIES)/本能中医处方/YYYY-MM/`

### 修改方案

#### 2.1 NativeBridge 新增 3 个方法（4 个 APP 同步）

在每个 APP 的 `MainActivity.java` 的 `NativeBridge.invoke()` switch 中添加 3 个 case：

##### 2.1a `findMediaFiles(patientName, prescriptionNo)`

扫描图片和视频目录的所有月份子目录，返回匹配 `patientName_prescriptionNo` 开头的文件列表。

```java
case "findMediaFiles":
    return findMediaFiles(args.optString("patientName", ""),
                          args.optString("prescriptionNo", "")).toString();
```

实现逻辑：
- 构造前缀：`sanitize(patientName) + "_" + sanitize(prescriptionNo)`
- 递归扫描 `getImageDir()` 和 `getVideoDir()` 下所有子目录
- 匹配 `file.getName().startsWith(prefix)` 的文件
- 返回 JSON：`{success: true, files: [{name, path, type, size, lastModified}]}`
- type 根据 `.webm` 后缀判断为 `"video"`，否则为 `"image"`

##### 2.1b `openFile(filePath, mimeType)`

用 FileProvider + Intent.ACTION_VIEW 打开文件（用于视频播放）。

```java
case "openFile":
    return openFile(args.optString("filePath", ""),
                    args.optString("mimeType", "")).toString();
```

实现逻辑：
- 用 `FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", file)` 获取 content URI
- 根据 filePath 后缀自动推断 mimeType（.webm → video/webm, .png → image/png, .jpg → image/jpeg）
- 创建 `Intent.ACTION_VIEW`，设置 `FLAG_GRANT_READ_URI_PERMISSION` 和 `FLAG_ACTIVITY_NEW_TASK`
- `startActivity(intent)` 打开系统播放器/查看器

##### 2.1c `readFileAsBase64(filePath)`

读取文件为 Base64 字符串（用于图片在弹窗中预览）。

```java
case "readFileAsBase64":
    return readFileAsBase64(args.optString("filePath", "")).toString();
```

实现逻辑：
- 读取文件为 byte[]
- `Base64.encodeToString(bytes, Base64.NO_WRAP)`
- 返回 JSON：`{success: true, data: "data:image/png;base64,..."}`

> 需要添加 import：`java.io.FileInputStream`（或用 `java.io.ByteArrayOutputStream`）

#### 2.2 electronAPI shim 新增方法

##### 2.2a 离线 APP（injectElectronApiShim in MainActivity.java）

在 `window.electronAPI = {...}` 对象中添加 3 个方法：

```javascript
findMediaFiles: function(patientName, prescriptionNo){
    return new Promise(function(resolve){
        try { var r = callNative('findMediaFiles', JSON.stringify({patientName:patientName,prescriptionNo:prescriptionNo})); resolve(r); }
        catch(e){ resolve({success:false, error:String(e)}); }
    });
},
openFile: function(filePath, mimeType){
    return new Promise(function(resolve){
        try { var r = callNative('openFile', JSON.stringify({filePath:filePath,mimeType:mimeType||''})); resolve(r); }
        catch(e){ resolve({success:false, error:String(e)}); }
    });
},
readFileAsBase64: function(filePath){
    return new Promise(function(resolve){
        try { var r = callNative('readFileAsBase64', JSON.stringify({filePath:filePath})); resolve(r); }
        catch(e){ resolve({success:false, error:String(e)}); }
    });
},
```

位置：在 `getVideoDirectory` 方法之后、`loginSuccess` 之前插入。

##### 2.2b 云端 APP（video-recorder-inject.js）

在 `window.electronAPI = {...}` 对象中添加相同的 3 个方法（在 `getVideoDirectory` 之后、`quitApp` 之前）。

#### 2.3 file_paths.xml 补充

##### 云端 APP（cloud_app/app/src/main/res/xml/file_paths.xml）

当前缺少 `files-path`（离线 APP 已有）。添加：

```xml
<files-path name="internal_files" path="." />
```

（用于 openFile 时 FileProvider 能访问 internal storage 的回退路径）

#### 2.4 renderHistoryList 修改

##### 2.4a 离线 APP index.html（line 2930-2934）

在 `[处方编号]` 后面添加 📷🎥 图标（仅当 `window.electronAPI` 可用时显示）：

```javascript
function renderHistoryList(list) {
    const el = DOM_CACHE.historyList || document.getElementById('historyList');
    if (!el) return;
    const hasNative = !!(window.electronAPI && window.electronAPI.findMediaFiles);
    el.innerHTML = list.map((p,i) =>`<div class="history-item" onclick="loadHistory(${p.id})"><div style="display:flex;justify-content:space-between;align-items:center;"><div><div style="display:flex;gap:8px;align-items:center;"><div class="history-name">${escapeHtml(p.patientName)}</div><div style="font-size:10px;color:#8b0000;font-weight:bold;">[${escapeHtml(p.prescriptionNo || '')}]</div>${hasNative ? `<span style="cursor:pointer;font-size:14px;" onclick="event.stopPropagation();viewMediaFiles('${escapeHtml(p.patientName)}','${escapeHtml(p.prescriptionNo || '')}')">📷🎥</span>` : ''}</div><div class="history-date">${escapeHtml(p.date)} - ${escapeHtml(p.diagnosis || '')}${p.registrationFee ? ' | 诊费:' + p.registrationFee.toFixed(2) + '元' : ''}</div></div><button class="small-btn" style="background:#ffdddd;padding:2px 6px;font-size:10px;" onclick="event.stopPropagation();deleteHistory(${p.id})">删除</button></div></div>`).join('') || '<div style="text-align:center;color:#999;padding:20px;font-size:11px;">无历史记录</div>';
}
```

##### 2.4b 云端网页 index.html（line 6028-6048）

在 `[处方编号]` 后面添加相同的 📷🎥 图标。图标仅在 `window.electronAPI` 可用时显示（即仅在云端 APP 中显示，浏览器访问时不显示）。

在 `visibleList.map` 回调中，`[${escapeHtml(p.prescriptionNo || '')}]` 后添加：

```javascript
${(window.electronAPI && window.electronAPI.findMediaFiles) ? `<span style="cursor:pointer;font-size:14px;" onclick="event.stopPropagation();viewMediaFiles('${escapeHtml(p.patientName || p.name || '未知')}','${escapeHtml(p.prescriptionNo || '')}')">📷🎥</span>` : ''}
```

#### 2.5 viewMediaFiles 函数 + 媒体查看弹窗

在离线 APP index.html 和云端网页 index.html 中各添加以下代码（放在 renderHistoryList 函数附近）：

##### CSS 样式（添加到 `<style>` 标签内）

```css
.media-viewer-overlay {
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.7); z-index: 99997;
    display: none; justify-content: center; align-items: center;
}
.media-viewer-modal {
    background: #fff; border-radius: 10px; padding: 16px;
    width: 92vw; max-width: 500px; max-height: 85vh; overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
}
.media-viewer-header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 12px; font-size: 14px; font-weight: 600; color: #333;
}
.media-viewer-close {
    background: none; border: none; font-size: 22px; cursor: pointer; color: #999;
}
.media-viewer-grid {
    display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;
}
.media-viewer-item {
    border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden;
    cursor: pointer; position: relative;
}
.media-viewer-item img {
    width: 100%; height: 120px; object-fit: cover; display: block;
}
.media-viewer-item .video-placeholder {
    width: 100%; height: 120px; background: #000; display: flex;
    align-items: center; justify-content: center; color: #fff; font-size: 32px;
}
.media-viewer-item .file-label {
    padding: 4px 6px; font-size: 10px; color: #666; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis;
}
.media-viewer-loading {
    text-align: center; padding: 30px; color: #999; font-size: 13px;
}
.media-viewer-fullimg {
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.95); z-index: 99998;
    display: none; justify-content: center; align-items: center;
    flex-direction: column;
}
.media-viewer-fullimg img {
    max-width: 95vw; max-height: 85vh; object-fit: contain;
}
.media-viewer-fullimg .close-fullimg {
    position: absolute; top: 10px; right: 15px; font-size: 28px;
    color: #fff; background: none; border: none; cursor: pointer;
}
```

##### HTML 弹窗结构（添加到 `</body>` 前）

```html
<div id="mediaViewerOverlay" class="media-viewer-overlay">
    <div class="media-viewer-modal">
        <div class="media-viewer-header">
            <span id="mediaViewerTitle">媒体文件</span>
            <button class="media-viewer-close" onclick="closeMediaViewer()">&times;</button>
        </div>
        <div id="mediaViewerContent"></div>
    </div>
</div>
<div id="mediaViewerFullImg" class="media-viewer-fullimg">
    <button class="close-fullimg" onclick="document.getElementById('mediaViewerFullImg').style.display='none'">&times;</button>
    <img id="mediaViewerFullImgEl" src="">
</div>
```

##### JavaScript 函数

```javascript
async function viewMediaFiles(patientName, prescriptionNo) {
    if (!window.electronAPI || !window.electronAPI.findMediaFiles) {
        alert('当前环境不支持查看媒体文件');
        return;
    }
    var overlay = document.getElementById('mediaViewerOverlay');
    var content = document.getElementById('mediaViewerContent');
    var title = document.getElementById('mediaViewerTitle');
    title.textContent = '媒体文件 - ' + patientName + ' [' + prescriptionNo + ']';
    content.innerHTML = '<div class="media-viewer-loading">正在查找媒体文件...</div>';
    overlay.style.display = 'flex';
    try {
        var result = await window.electronAPI.findMediaFiles(patientName, prescriptionNo);
        if (!result.success || !result.files || result.files.length === 0) {
            content.innerHTML = '<div class="media-viewer-loading">未找到 ' + escapeHtml(patientName) + ' 的媒体文件</div>';
            return;
        }
        // 排序：处方签图片 → 面诊照片 → 诊疗视频
        var order = ['photo_舌面', 'photo_面诊', 'photo_', 'video'];
        result.files.sort(function(a, b) {
            var getOrder = function(f) {
                for (var i = 0; i < order.length; i++) {
                    if (f.name.indexOf(order[i]) >= 0) return i;
                }
                return order.length;
            };
            return getOrder(a) - getOrder(b);
        });
        var html = '<div class="media-viewer-grid">';
        for (var i = 0; i < result.files.length; i++) {
            var f = result.files[i];
            if (f.type === 'video') {
                html += '<div class="media-viewer-item" onclick="openMediaFile(\'' + f.path.replace(/'/g, "\\'") + '\',\'video/webm\')">' +
                    '<div class="video-placeholder">▶</div>' +
                    '<div class="file-label">' + escapeHtml(f.name) + '</div></div>';
            } else {
                html += '<div class="media-viewer-item" data-path="' + escapeHtml(f.path) + '" id="mediaItem_' + i + '">' +
                    '<div class="media-viewer-loading" style="height:120px;">加载中...</div>' +
                    '<div class="file-label">' + escapeHtml(f.name) + '</div></div>';
                loadMediaThumbnail(f.path, 'mediaItem_' + i);
            }
        }
        html += '</div>';
        content.innerHTML = html;
    } catch (e) {
        content.innerHTML = '<div class="media-viewer-loading" style="color:#dc3545;">查找失败: ' + escapeHtml(String(e)) + '</div>';
    }
}

async function loadMediaThumbnail(filePath, elementId) {
    try {
        var result = await window.electronAPI.readFileAsBase64(filePath);
        var el = document.getElementById(elementId);
        if (el && result.success && result.data) {
            el.innerHTML = '<img src="' + result.data + '" onclick="showFullImage(\'' + result.data.replace(/'/g, "\\'") + '\')">';
        } else if (el) {
            el.innerHTML = '<div class="media-viewer-loading" style="height:120px;">加载失败</div>';
        }
    } catch (e) {
        var el = document.getElementById(elementId);
        if (el) el.innerHTML = '<div class="media-viewer-loading" style="height:120px;">加载失败</div>';
    }
}

function showFullImage(dataUri) {
    var fullImg = document.getElementById('mediaViewerFullImg');
    var imgEl = document.getElementById('mediaViewerFullImgEl');
    imgEl.src = dataUri;
    fullImg.style.display = 'flex';
}

async function openMediaFile(filePath, mimeType) {
    try {
        var result = await window.electronAPI.openFile(filePath, mimeType);
        if (!result.success) {
            alert('打开文件失败: ' + (result.error || '未知错误'));
        }
    } catch (e) {
        alert('打开文件失败: ' + String(e));
    }
}

function closeMediaViewer() {
    document.getElementById('mediaViewerOverlay').style.display = 'none';
}
```

> 注意：云端网页中 `escapeHtml` 函数已存在，无需重复定义。

---

## 实施顺序

1. **Part 1 - OPPO 适配**（先做，影响所有界面）
   - 修改 3 个离线 APP 的 styles.xml + MainActivity.java + index.html
   - 修改云端 APP 的 styles.xml + AndroidManifest.xml + MainActivity.java + 云端网页 index.html
   - 云端网页修改后 git push 触发 Cloudflare Pages 自动部署

2. **Part 2 - 媒体查看**（后做，独立功能）
   - 修改 4 个 APP 的 MainActivity.java（NativeBridge + electronAPI shim）
   - 修改云端 APP 的 file_paths.xml
   - 修改 3 个离线 APP 的 index.html（renderHistoryList + viewMediaFiles + 弹窗）
   - 修改云端网页 index.html（renderHistoryList + viewMediaFiles + 弹窗）+ video-recorder-inject.js
   - 云端网页 + inject.js 修改后 git push

3. **打包验证**
   - 4 个 APP 需重新打包生成 APK
   - 云端网页推送后 2-5 分钟自动部署

---

## 验证步骤

### OPPO 适配验证
1. 安装到 OPPO Find X8s+，检查顶部内容不被摄像头遮挡
2. 检查底部导航栏完整可见，不被手势条遮挡
3. 在 ColorOS 设置中调整系统字体大小为大/小，检查 APP 内文字大小不受影响
4. 检查各面板完整显示，无横向滚动、无内容裁切

### 媒体查看验证
1. 在历史处方列表中确认每个处方旁有 📷🎥 图标
2. 点击图标，弹窗显示该处方的所有媒体文件
3. 排序正确：处方签图片（舌面）→ 面诊照片 → 诊疗视频
4. 点击图片缩略图，弹出全屏大图查看
5. 点击视频，系统播放器打开播放
6. 无媒体文件的处方，弹窗显示"未找到媒体文件"
7. 浏览器访问云端网页时，不显示 📷🎥 图标（仅云端 APP 内显示）

---

## 假设与决策

1. **方案A（文件名匹配）**：用户已选择，不修改数据结构，通过扫描文件名匹配
2. **图片预览方式**：使用 Base64 data URI 在弹窗内预览（兼容云端 APP 的 `setAllowFileAccess(false)` 设置）
3. **视频播放方式**：用系统播放器打开（Intent.ACTION_VIEW），不在弹窗内内嵌播放
4. **媒体图标始终显示**：不预检查是否有媒体文件（避免每条处方都调用 NativeBridge 扫描），点击后才发现无文件时提示"未找到"
5. **三个离线 APP 同步修改**：db-shouji/bendi/dingzhi 代码结构相同，修改内容一致
6. **云端网页推送**：修改完成后自动 git commit + push 到 GitHub，Cloudflare Pages 自动部署
