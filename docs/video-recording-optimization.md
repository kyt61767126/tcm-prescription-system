# 录像拍照功能优化文档

> 本文档记录本能中医处方系统所有项目（离线桌面版、离线手机APP、云端桌面版、云端手机APP）的录像拍照功能架构特点、保存路径规范、优化过程和后续优化方向，方便以后优化修改。

## 一、项目总览

| 项目 | 路径 | 架构 | 录像拍照保存方式 |
|------|------|------|----------------|
| 离线桌面版（本地版） | `offline_project/db-bendi/electron/` | Electron + 本地 HTML | 本地 `downloads/YYYY-MM/` |
| 离线桌面版（定制版） | `offline_project/db-dingzhi/electron/` | Electron + 本地 HTML | 本地 `downloads/YYYY-MM/` |
| 离线桌面版（个人版） | `offline_project/db-geren/electron/` | Electron + 本地 HTML | 本地 `downloads/YYYY-MM/` |
| 离线手机APP（本地版） | `offline_project/db-bendi/android/` | Android WebView + assets HTML | 本地 `Pictures/Movies/YYYY-MM/` |
| 离线手机APP（定制版） | `offline_project/db-dingzhi/android/` | Android WebView + assets HTML | 本地 `Pictures/Movies/YYYY-MM/` |
| 离线手机APP（个人版） | `offline_project/db-shouji/android/` | Android WebView + assets HTML | 本地 `Pictures/Movies/YYYY-MM/` |
| 云端桌面版 | `cloud_project/cloud_desktop/electron/` | Electron + 远程网页 | 本地 `downloads/YYYY-MM/` |
| 云端手机APP | `cloud_project/cloud_app/` | Capacitor + 远程网页 | 本地 `Pictures/Movies/YYYY-MM/` |

**核心原则**：图片和视频全部本地保存，不接入后端，不占用 Cloudflare 免费额度。

## 二、保存路径和文件命名规范

### 2.1 统一命名规范

```
患者姓名_处方编号_type.ext
```

- `type`：`photo`（照片）或 `video`（视频）
- `ext`：`png`（照片）或 `webm`（视频）
- 若获取不到患者姓名，使用 `unknown`
- 若获取到处方编号，使用时间戳替代（`YYMMDD_HHMMSS`）

### 2.2 各端保存目录

| 端 | 图片保存目录 | 视频保存目录 |
|----|------------|------------|
| 桌面版（Electron） | `安装目录/downloads/YYYY-MM/` | `安装目录/downloads/YYYY-MM/` |
| 手机APP（Android 10+） | `Pictures/本能中医处方/YYYY-MM/` | `Movies/本能中医处方/YYYY-MM/` |
| 手机APP（Android 9及以下） | `Pictures/本能中医处方/YYYY-MM/` | `Movies/本能中医处方/YYYY-MM/` |

### 2.3 月份分类子目录

所有端统一使用 `YYYY-MM` 格式的月份子目录：
- 2026年7月 → `2026-07`
- 2026年12月 → `2026-12`

**实现函数**：`getCurrentMonthFolder()`

## 三、各项目架构特点

### 3.1 离线桌面版（Electron）

**关键文件**：
- `electron/main.js`：主进程，IPC 处理 `savePrescriptionImage`/`saveVideoFile`/`saveBackupFile`
- `electron/video-recorder.js`：前端录像拍照 UI 和逻辑（IIFE 注入）
- `electron/preload.js`：contextBridge 注入 `window.electronAPI`

**特点**：
- 通过 Electron IPC 通信，主进程负责文件写入
- 保存到 `app.getPath('userData')/downloads/YYYY-MM/`
- 摄像头固定前置（`facingMode: 'user'`），无前后切换（桌面合理）
- 有音频降级机制（`echoCancellation: false` 等）
- 保存成功用 `showToast` 弹窗提示，显示完整路径

### 3.2 离线手机APP（Android WebView）

**关键文件**：
- `android/app/src/main/java/com/benneng/pres/MainActivity.java`：主活动，包含 NativeBridge
- `android/app/src/main/assets/public/index.html`：离线网页，包含录像拍照 UI 和逻辑
- `android/app/src/main/AndroidManifest.xml`：权限配置

**特点**：
- 通过 `@JavascriptInterface` 注入 `AndroidNative` 桥接
- `NativeBridge.invoke(name, json)` 统一入口，分发到 `savePrescriptionImage`/`saveVideoFile` 等
- 图片保存到 `Pictures/本能中医处方/YYYY-MM/`，视频保存到 `Movies/本能中医处方/YYYY-MM/`
- Android 10+ 使用 `getExternalFilesDir()`，Android 9 及以下使用 `getExternalStoragePublicDirectory()`
- 有摄像头前后切换（`switchCamera`/`switchCameraForPhoto`）
- 有音频降级机制（`echoCancellation: false` 等 + 音频失败降级到仅视频）
- `WebChromeClient.onPermissionRequest` 自动授权摄像头和麦克风
- `onBackPressed` 调用 JS 的 `handleAndroidBack()` 处理返回键
- 保存成功用 `showToast` 弹窗提示，显示完整路径

### 3.3 云端桌面版（Electron + 远程网页）

**关键文件**：
- `electron/main.js`：主进程，IPC 处理
- `electron/video-recorder.js`：录像拍照 UI 和逻辑
- `electron/preload.js`：contextBridge 注入

**特点**：
- 与离线桌面版架构基本相同
- 保存到 `app.getPath('userData')/downloads/YYYY-MM/`
- 摄像头固定前置，无前后切换
- 有音频降级机制（`echoCancellation: false` 等 + 音频失败降级）
- 保存成功用 `setStatus` 在 overlay 内显示路径（与离线版用 `showToast` 略有差异）

### 3.4 云端手机APP（Capacitor + 远程网页）

**关键文件**：
- `app/src/main/java/com/tcm/prescription/MainActivity.java`：主活动，包含 NativeBridge
- `app/src/main/assets/video-recorder-inject.js`：录像拍照注入脚本（新建）
- `app/src/main/AndroidManifest.xml`：权限配置

**特点**：
- 基于 Capacitor 框架，通过 `getBridge().getWebView()` 获取 WebView
- 通过 `@JavascriptInterface` 注入 `AndroidNative` 桥接
- `onPageFinished` 中读取 `assets/video-recorder-inject.js` 并通过 `evaluateJavascript` 注入
- 注入脚本包含：electronAPI shim、浮动按钮（fixed 定位）、录像/拍照 overlay、MutationObserver
- 图片保存到 `Pictures/本能中医处方/YYYY-MM/`，视频保存到 `Movies/本能中医处方/YYYY-MM/`
- 有摄像头前后切换（`switchCamera`/`switchCameraForPhoto`）
- 有音频降级机制（`echoCancellation: false` 等 + 音频失败降级到仅视频）
- `WebChromeClient.onPermissionRequest` 自动授权摄像头和麦克风
- `MutationObserver` 监听 SPA 路由变化，确保按钮持久显示
- 保存成功用 `showToast` 弹窗提示，显示完整路径
- **不修改云端网页前端代码**，所有逻辑通过原生注入

## 四、跨项目一致性对照表

| 功能点 | 离线桌面 | 离线APP | 云端桌面 | 云端APP |
|--------|---------|---------|---------|---------|
| 月份分类子目录（YYYY-MM） | ✅ | ✅ | ✅ | ✅ |
| 文件命名规范 | ✅ | ✅ | ✅ | ✅ |
| 保存路径提示 | showToast | showToast | showToast | showToast |
| 摄像头前后切换 | ❌（桌面合理） | ✅ | ❌（桌面合理） | ✅ |
| 音频降级机制 | ✅ | ✅ | ✅ | ✅ |
| 音频失败降级到仅视频 | ✅ | ✅ | ✅ | ✅ |
| Android 权限自动授权 | N/A | ✅ | N/A | ✅ |
| Android 返回键处理 | N/A | ✅ | N/A | N/A |
| SPA 路由适配 | N/A | N/A | N/A | ✅（MutationObserver） |
| 备份文件保存 | ✅ | ✅ | ✅ | ✅ |
| MediaScanner 通知 | N/A | ✅ | N/A | ✅ |
| formatPrice 函数 | ✅ | ✅ | ✅ | N/A（注入脚本自带） |
| sortPrescriptionsByTimeDesc 函数 | ✅ | ✅ | ✅ | N/A |
| __APP_VERSION__ 定义 | ✅ | ✅ | ✅ | N/A |
| saveBackupFile 参数顺序 | (jsonStr, fileName) | (jsonStr, fileName) | (jsonStr, fileName) | (jsonStr, fileName) |

## 五、优化过程记录

### 5.1 2026-07-08 第一次全面优化

**背景**：用户要求"手机离线APP录像、照片保存参考离线桌面版设定，方便查阅"。

**修改内容**：

#### 离线APP（db-bendi、db-dingzhi、db-shouji）

1. **MainActivity.java**：
   - `savePrescriptionImage` 添加 `dir = new File(dir, getCurrentMonthFolder())` 月份子目录
   - `saveVideoFile` 添加月份子目录，返回 `directory` 和 `fileName` 字段
   - 新增 `getCurrentMonthFolder()` 方法
   - `onBackPressed` 修改为调用 JS 的 `handleAndroidBack()`
   - 修复 db-bendi 缺失 `getVideoDir()` 方法导致编译失败

2. **index.html**：
   - 视频保存成功提示改为 `showToast('视频已保存到：' + savePath)`
   - 照片保存成功提示改为 `showToast('照片已保存到：' + savePath)`
   - 新增 `handleAndroidBack()` 函数处理 Android 返回键
   - 移除历史处方栏的录像拍照按钮注入（按钮已在 HTML 静态结构中定义）

#### 云端手机APP（cloud_app）- 新功能实施

1. **AndroidManifest.xml**：
   - 添加 `CAMERA`、`RECORD_AUDIO`、`MODIFY_AUDIO_SETTINGS` 权限
   - 添加 `WRITE_EXTERNAL_STORAGE`（Android 9及以下）、`READ_EXTERNAL_STORAGE`
   - 添加 `uses-feature` 声明（camera、camera.front、microphone）

2. **video-recorder-inject.js**（新建）：
   - 完整的 electronAPI shim（调用 AndroidNative 桥接）
   - 浮动按钮（📷 拍照 + 🎥 录像，fixed 定位）
   - 录像 overlay（摄像头预览、前后切换、录制控制、计时器）
   - 拍照 overlay（摄像头预览、闪光效果、保存/重拍）
   - MutationObserver 监听 SPA 路由变化
   - 保存成功提示显示完整路径

3. **MainActivity.java**：
   - 添加 NativeBridge 内部类（savePrescriptionImage/saveVideoFile/getCurrentMonthFolder 等）
   - 注入 `AndroidNative` 桥接
   - `onCreate` 中动态申请相机、麦克风、存储权限
   - `WebChromeClient.onPermissionRequest` 授权摄像头和麦克风
   - `onPageFinished` 中注入 `video-recorder-inject.js`
   - `onDestroy` 中移除 `AndroidNative` 接口

### 5.2 2026-07-08 第二次全面检查优化

**背景**：用户要求"对整个项目录像和拍照设置再次检查优化完善"。

**检查结果**：
- 离线APP三个版本（db-bendi、db-dingzhi、db-shouji）的 NativeBridge 实现完全一致 ✅
- 保存路径提示、文件命名规范、摄像头切换、音频降级、权限配置全部正确 ✅
- 云端桌面版和离线桌面版的保存逻辑一致 ✅
- 云端手机APP的注入脚本完整 ✅

**修复内容**：

1. **云端桌面版**（`cloud_project/cloud_desktop/electron/video-recorder.js`）：
   - 录像 `getUserMedia` 添加音频约束（`echoCancellation: false` 等）
   - 添加音频失败降级到仅视频的逻辑

2. **离线桌面版**（db-bendi、db-dingzhi、db-geren 的 `video-recorder.js`）：
   - 录像 `getUserMedia` 的 `audio: true` 改为音频约束对象
   - 添加 `echoCancellation: false`、`noiseSuppression: false`、`autoGainControl: false`

**优化原因**：与移动端保持一致，预防桌面版在某些设备上遇到音频处理兼容性问题。

### 5.3 2026-07-08 第三次全面同步优化

**背景**：用户要求"按建议顺序实施！逐项完成！"，对整个项目进行同步优化。

**优化内容**：

#### 第一批（高优先级）

1. **formatPrice 函数添加到离线APP**（6个文件）
   - 在 6 个离线版本 index.html 中添加 `formatPrice(val)` 函数
   - 替换药品表格单价/总金额显示：`(parseFloat(item.price) || 0).toFixed(2)` → `formatPrice(item.price)`
   - 替换药品管理列表进价/单价显示：`(parseFloat(m.costPrice) || 0).toFixed(2)` → `formatPrice(m.costPrice)`
   - 替换统计表格收入/费用/成本/利润显示（仅桌面版，Android版无统计功能）
   - **涉及文件**：db-bendi/index.html、db-dingzhi/index.html、db-geren/index.html 及对应 android 版本、db-shouji/android/.../index.html

2. **saveBackupFile 参数顺序统一**（6个文件）
   - 云端桌面版参数顺序从 `(fileName, content)` 改为 `(jsonStr, fileName)`
   - 与离线版和 `savePrescriptionImage(imageData, fileName)` 保持一致
   - **涉及文件**：cloud_desktop/electron/preload.js、main.js、index.html 及 tcm-prescription-system 副本

#### 第二批（中优先级）

3. **历史处方排序提取公共函数**（6个文件）
   - 在 6 个离线版本中添加 `sortPrescriptionsByTimeDesc(list)` 公共函数
   - 替换所有内联排序代码 `prescriptions.sort((a, b) => (b.createdAt || b.id || 0) - ...)` 为 `sortPrescriptionsByTimeDesc(prescriptions)`
   - **涉及文件**：db-bendi、db-dingzhi、db-geren 的 index.html 及对应 android 版本

4. **离线APP添加 __APP_VERSION__**（6个文件）
   - 在 6 个离线版本中添加 `window.__APP_VERSION__ = '2026-07-06-v1'` 定义
   - 与云端三端保持同步
   - **涉及文件**：db-bendi、db-dingzhi、db-geren 的 index.html 及对应 android 版本

5. **IPC handler 一致性评估**
   - 云端桌面版 19 个 handler，离线桌面版 13 个，差异 11 个
   - 大部分差异是合理的功能差异（登录/注销 vs 本地配置）
   - 建议仅统一高优先级项（目录打开功能），其他保持现状

#### 第三批（低优先级）

6. **离线桌面版音频失败降级**（3个文件）
   - 为 3 个离线桌面版 video-recorder.js 添加 try-catch 降级逻辑
   - 音频获取失败时自动降级到仅视频
   - 添加音频轨道检查，显示"无音频"提示
   - **涉及文件**：db-bendi、db-dingzhi、db-geren 的 electron/video-recorder.js

7. **云端桌面版提示方式统一**（1个文件）
   - 视频保存成功提示从 `setStatus('视频已保存到 ' + result.directory, 'success')` 改为 `showToast('视频已保存到：' + result.directory)`
   - 照片保存成功提示从 `setPhotoStatus('照片已保存到 ' + result.directory, 'success')` 改为 `showToast('照片已保存到：' + result.directory)`
   - 与其他端保持一致
   - **涉及文件**：cloud_desktop/electron/video-recorder.js

8. **拍照录像自动保存**（5个文件）
   - 拍照完成后自动调用 `savePhoto()`，无需手动点击"保存照片"按钮
   - 录像停止后自动调用 `saveVideo()`，无需手动点击"保存视频"按钮
   - 使用 `setTimeout(saveVideo, 300)` / `setTimeout(savePhoto, 300)` 延迟300ms，确保UI状态更新完成
   - 保留保存按钮作为备用：如果自动保存失败，用户仍可手动点击重试
   - 提示文案从"点击保存"改为"正在自动保存..."
   - **涉及文件**：
     - db-bendi/electron/video-recorder.js
     - db-dingzhi/electron/video-recorder.js
     - db-geren/electron/video-recorder.js
     - cloud_desktop/electron/video-recorder.js
     - cloud_app/app/src/main/assets/video-recorder-inject.js

**优化原因**：全面统一各端的关键函数和接口，提高代码一致性和可维护性。

## 六、关键技术决策

### 6.1 为什么图片视频不上传云端？

1. **Cloudflare KV 限制**：1GB 存储、每日 1,000 次写入、单值 25MB 上限
2. **base64 膨胀**：base64 编码浪费 33% 空间
3. **视频过大**：1 分钟视频可达数十 MB，远超 KV 单值上限
4. **隐私合规**：患者面诊照片/诊疗视频留在本地，符合医疗数据保护原则
5. **离线可用**：断网也能保存，与离线APP体验一致
6. **零云端成本**：永不触达 Cloudflare 免费额度

### 6.2 为什么云端APP用注入脚本而不修改前端？

1. **不影响桌面端**：云端网页同时服务桌面端、移动端、浏览器，修改会影响所有端
2. **复用成熟代码**：离线APP的录像拍照逻辑已成熟，可直接参考
3. **部署独立**：不需要重新构建和部署云端网页
4. **维护简单**：所有移动端特有逻辑集中在 `video-recorder-inject.js` 一个文件

### 6.3 为什么用 MutationObserver？

云端网页是 React SPA，路由切换时 React 会重新渲染 DOM，可能导致注入的浮动按钮被清除。`MutationObserver` 监听 `document.body` 的 `childList` 变化，发现按钮消失时自动重新注入。

## 七、已知问题和后续优化方向

### 7.1 已知问题

1. **云端桌面版提示方式不一致**：用 `setStatus` 而非 `showToast`，与离线版略有差异
   - 影响：用户体验略有不同，但不影响功能
   - 优化方向：可统一为 `showToast`（低优先级）

2. **离线桌面版缺少音频失败降级**：有音频约束但无降级到仅视频的逻辑
   - 影响：桌面环境通常不需要，但极少数设备可能遇到音频问题
   - 优化方向：可添加与云端桌面版相同的降级逻辑（低优先级）

3. **云端APP文件名获取依赖 DOM**：从 DOM 获取患者姓名和处方编号，若云端网页结构变化可能失效
   - 影响：DOM 结构变化时文件名可能退化为时间戳
   - 优化方向：可与前端约定 `data-*` 属性，更稳定地获取患者信息（中优先级）

### 7.2 后续优化方向

1. **录像质量自适应**：根据设备性能和网络状况自动调整分辨率和码率
2. **视频压缩**：保存前对视频进行压缩，减少存储空间
3. **图片水印**：自动添加诊所名称和日期水印
4. **批量管理**：提供文件管理界面，支持按月份、患者姓名查看和删除
5. **云端备份（可选）**：若未来需要跨设备同步，可接入 R2 或 OSS，仅上传元数据到 KV
6. **录像时长配置**：允许用户自定义最大录制时长（当前固定 60 秒）
7. **多语言支持**：录像拍照 UI 的提示信息支持多语言

## 八、文件索引

### 离线桌面版
- `offline_project/db-bendi/electron/main.js` - 主进程 IPC
- `offline_project/db-bendi/electron/video-recorder.js` - 录像拍照逻辑
- `offline_project/db-bendi/electron/preload.js` - 桥接注入
- `offline_project/db-dingzhi/electron/` - 同上
- `offline_project/db-geren/electron/` - 同上

### 离线手机APP
- `offline_project/db-bendi/android/app/src/main/java/com/benneng/pres/MainActivity.java` - NativeBridge
- `offline_project/db-bendi/android/app/src/main/assets/public/index.html` - 录像拍照 UI
- `offline_project/db-bendi/android/app/src/main/AndroidManifest.xml` - 权限
- `offline_project/db-dingzhi/android/` - 同上
- `offline_project/db-shouji/android/` - 同上

### 云端桌面版
- `cloud_project/cloud_desktop/electron/main.js` - 主进程 IPC
- `cloud_project/cloud_desktop/electron/video-recorder.js` - 录像拍照逻辑
- `cloud_project/cloud_desktop/electron/preload.js` - 桥接注入

### 云端手机APP
- `cloud_project/cloud_app/app/src/main/java/com/tcm/prescription/MainActivity.java` - NativeBridge + 注入
- `cloud_project/cloud_app/app/src/main/assets/video-recorder-inject.js` - 注入脚本
- `cloud_project/cloud_app/app/src/main/AndroidManifest.xml` - 权限

### 参考项目
- `video_recording_project/` - 录像功能原型和参考实现

---

**最后更新**：2026-07-08
**维护者**：Trae AI 助手
**更新原则**：每次优化后更新本文档，记录修改内容和原因
