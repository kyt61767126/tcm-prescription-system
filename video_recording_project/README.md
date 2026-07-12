# 问诊视频录制 + 拍照功能 - 桌面端实现

## 目录结构

```
video_recording_project/
├── offline_desktop/          # 离线桌面端（基于 db-bendi）
│   └── electron/
│       ├── main.js           # 主进程（含视频IPC + 权限 + 脚本注入）
│       ├── preload.js        # 预加载脚本（含 saveVideoFile API）
│       └── video-recorder.js # 录制+拍照模块（UI + getUserMedia + MediaRecorder + Canvas）
├── cloud_desktop/            # 云端桌面端（基于 cloud_desktop）
│   └── electron/
│       ├── main.js           # 主进程（含视频IPC + SQLite + 权限 + 脚本注入）
│       ├── preload.js        # 预加载脚本（含 saveVideoFile + localDB API）
│       └── video-recorder.js # 录制+拍照模块（与离线版相同）
└── README.md                 # 本文档
```

## 功能概述

在历史处方栏（右侧 history-header）注入两个按钮：

### 🎥 视频录制

- 摄像头实时预览（镜像翻转）
- 开始 / 停止 / 保存 三步操作
- 录制中红色指示灯 + 倒计时（最长 60 秒）
- 自动选择最佳编码格式（VP9 > VP8 > 默认）
- 保存为 WebM 文件到 `downloads/YYYY-MM/` 目录
- 文件名格式：`video_YYYYMMDD_HHmmss.webm`

### 📷 拍照

- 摄像头实时预览（镜像翻转）
- 拍照 / 保存 / 重拍 三步操作
- 拍照时白色闪光效果
- 拍照后显示照片预览，可重拍或保存
- 使用 Canvas 捕获当前帧，保存为 PNG
- 复用现有 `savePrescriptionImage` IPC，无需新增通道
- 文件名格式：`photo_YYYYMMDD_HHmmss.png`
- 保存到 `downloads/YYYY-MM/` 目录（与处方图片同目录）

## 技术规格

### 视频录制

| 参数 | 值 | 说明 |
|---|---|---|
| 分辨率 | 640×480 | VGA，足够记录面部/舌象 |
| 帧率 | 15 fps | 问诊场景无需高帧率 |
| 视频码率 | 500 kbps | MediaRecorder videoBitsPerSecond |
| 音频码率 | 64 kbps | MediaRecorder audioBitsPerSecond |
| 编码格式 | WebM (VP9+Opus) | 自动降级到 VP8 |
| 最长时长 | 60 秒 | 到时自动停止 |
| 估算体积 | ~3.75 MB/条 | 60秒 × 500kbps ÷ 8 |

### 拍照

| 参数 | 值 | 说明 |
|---|---|---|
| 分辨率 | 摄像头原始分辨率 | 通常 640×480 或更高 |
| 格式 | PNG (无损) | Canvas toDataURL('image/png') |
| 音频 | 不采集 | 拍照仅需 video track |
| 保存方式 | base64 → IPC | 复用 savePrescriptionImage 通道 |
| 估算体积 | ~300 KB - 1 MB/张 | 取决于画面复杂度 |

## 部署方式

### 离线桌面端（db-bendi / db-dingzhi / db-geren）

1. **备份原文件**（可选）：
   ```
   offline_project/db-bendi/electron/main.js     → main.js.bak
   offline_project/db-bendi/electron/preload.js  → preload.js.bak
   ```

2. **复制新文件**：
   ```
   video_recording_project/offline_desktop/electron/main.js
       → offline_project/db-bendi/electron/main.js
   video_recording_project/offline_desktop/electron/preload.js
       → offline_project/db-bendi/electron/preload.js
   video_recording_project/offline_desktop/electron/video-recorder.js
       → offline_project/db-bendi/electron/video-recorder.js
   ```

3. **无需修改 index.html**：video-recorder.js 由 main.js 在 `dom-ready` 时自动注入。

4. **重新启动应用**即可看到历史处方栏出现 📷 和 🎥 两个按钮。

> db-dingzhi 和 db-geren 的 Electron 架构与 db-bendi 相同，可直接复用同一套文件。

### 云端桌面端（cloud_desktop）

1. **备份原文件**（可选）：
   ```
   cloud_project/cloud_desktop/electron/main.js     → main.js.bak
   cloud_project/cloud_desktop/electron/preload.js  → preload.js.bak
   ```

2. **复制新文件**：
   ```
   video_recording_project/cloud_desktop/electron/main.js
       → cloud_project/cloud_desktop/electron/main.js
   video_recording_project/cloud_desktop/electron/preload.js
       → cloud_project/cloud_desktop/electron/preload.js
   video_recording_project/cloud_desktop/electron/video-recorder.js
       → cloud_project/cloud_desktop/electron/video-recorder.js
   ```

3. **无需修改 index.html**：同上，自动注入。

4. **重新启动应用**。

## 新增的 IPC 通道

| 通道名 | 方向 | 参数 | 返回值 | 说明 |
|---|---|---|---|---|
| `save-video-file` | 渲染→主 | `(ArrayBuffer, fileName)` | `{success, filePath, directory, fileName}` | 视频二进制写入文件 |
| `get-video-directory` | 渲染→主 | 无 | `string` (目录路径) | 获取当前月份目录 |
| `open-video-directory` | 渲染→主 | 无 | `{success, directory}` | 在文件管理器中打开 |

> **拍照无需新增 IPC 通道**——复用现有的 `save-prescription-image` 通道，接受 base64 图片数据写入文件。

## 新增的 preload API

```javascript
window.electronAPI.saveVideoFile(arrayBuffer, fileName)  // ArrayBuffer → 视频文件
window.electronAPI.getVideoDirectory()                   // 获取视频保存目录
window.electronAPI.openVideoDirectory()                  // 打开视频目录
// 拍照复用已有 API：
window.electronAPI.savePrescriptionImage(dataUrl, fileName)  // base64 → PNG 文件
```

## 架构设计要点

### 1. 权限处理
- `session.setPermissionRequestHandler` 自动授予 `media` 权限
- 用户无需手动点击授权对话框
- 其他权限仍被拒绝（保持安全策略）

### 2. CSP 更新
- 离线版：`media-src 'self' blob:` 允许 blob 视频源
- 云端版：同上，且保留原有的 Cloudflare 域名白名单

### 3. 脚本注入机制
- main.js 在 `dom-ready` 时读取 `video-recorder.js` 文件
- 通过 `webContents.executeJavaScript()` 注入到渲染进程
- **无需修改 index.html**，对现有页面零侵入

### 4. 媒体保存策略
- **视频**：ArrayBuffer 直接转 Buffer 写文件（不走 base64，效率更高）
- **拍照**：Canvas → toDataURL → base64 → 复用 savePrescriptionImage IPC
- 两者均保存到 `downloads/YYYY-MM/` 目录（与处方图片同目录）
- 文件名自动生成时间戳，防止重名

### 5. 摄像头资源管理
- 打开录制/拍照浮层时启动摄像头
- 关闭浮层时自动 `stop()` 所有 Track
- 录制中关闭浮层会先停止录制再释放摄像头
- 拍照和录制不会同时打开（打开一个浮层会先关闭另一个）

## 使用流程

### 视频录制

```
1. 登录系统，进入主界面
2. 点击右侧历史处方栏的 🎥 按钮
3. 浮层弹出，摄像头自动预览
4. 点击「开始录制」→ 红灯亮起，倒计时开始
5. 点击「停止录制」或等待 60 秒自动停止
6. 点击「保存视频」→ 视频写入 downloads/YYYY-MM/ 目录
7. Toast 提示保存路径，浮层自动关闭
```

### 拍照

```
1. 登录系统，进入主界面
2. 点击右侧历史处方栏的 📷 按钮
3. 浮层弹出，摄像头自动预览
4. 点击「拍照」→ 白色闪光，画面定格为照片预览
5. 点击「保存照片」→ PNG 写入 downloads/YYYY-MM/ 目录
   或点击「重拍」→ 恢复摄像头实时预览
6. Toast 提示保存路径，浮层自动关闭
```

## 故障排查

| 症状 | 原因 | 解决 |
|---|---|---|
| 🎥/📷 按钮未出现 | history-header 未渲染或选择器不匹配 | 检查控制台日志，确认 video-recorder.js 已注入 |
| 摄像头初始化失败 | 无摄像头设备或被其他程序占用 | 关闭占用摄像头的程序（如 Zoom/微信视频） |
| 录制后无法保存 | electronAPI.saveVideoFile 未定义 | 确认 preload.js 已正确替换 |
| 拍照后无法保存 | electronAPI.savePrescriptionImage 未定义 | 确认 preload.js 已正确替换 |
| 拍照画面空白 | video 流尚未就绪 | 等待摄像头预览稳定后再点拍照 |
| 视频文件为空 | MediaRecorder 未收到数据 | 尝试降低分辨率或更换浏览器内核版本 |
| 保存路径不存在 | downloads 目录无写入权限 | 检查程序目录权限，或使用 userData 回退目录 |

## 后续扩展方向

1. **处方关联**：在 IndexedDB 处方记录中新增 `videoFile`/`photoFile` 字段，将媒体与处方关联
2. **历史标记**：在历史列表项上显示 🎥/📷 标记，点击可查看关联媒体
3. **视频回放**：在应用内嵌入 WebM 播放器
4. **照片查看器**：在应用内嵌入图片查看器，支持缩放旋转
5. **Android 移植**：需修改 AndroidManifest.xml（加 CAMERA/RECORD_AUDIO 权限）+ MainActivity.java（加 onPermissionRequest + NativeBridge 方法）
