# 统一各端照相录像功能 - 实施计划

## Context

用户要求桌面、手机端（离线和云端）的照相录像功能参考本地离线桌面程序（db-bendi）统一更新。

经探索发现，三个离线桌面版本（db-bendi、db-geren、db-dingzhi）的 `electron/video-recorder.js` **完全一致**，是可靠的参考标准。但**云端桌面**（cloud_desktop）的 video-recorder.js 差异很大（暗色主题、内联样式、无切换摄像头、前置摄像头默认），需要替换。**云端手机端**的 video-recorder-inject.js 已基本一致，仅需微调按钮顺序。

## 各端现状对比

| 特性 | db-bendi（参考标准） | cloud_desktop（需替换） | cloud_app（已基本一致） | db-shouji（已一致） |
|---|---|---|---|---|
| 主题 | 白色 | ❌ 暗色 #1a1a1a | ✅ 白色 | ✅ 白色 |
| 样式 | CSS 类 `video-` | ❌ 内联样式 | ✅ CSS 类 `cloud-vr-` | ✅ CSS 类 `video-` |
| 切换摄像头 | ✅ 有 🔄 | ❌ 无 | ✅ 有 | ✅ 有 |
| 摄像头默认 | `environment`(后置) | ❌ `user`(前置) | ✅ `environment` | ✅ `environment` |
| 录像按钮 | 开始/停止/保存 分开 | ❌ 开始/停止 切换+放弃 | ✅ 分开 | ✅ 分开 |
| 全局函数名 | `openRecordingOverlay` | ❌ `openVideoRecorder` | ✅ `openRecordingOverlay` | ✅ `openRecordingOverlay` |
| generateFileName | 患者姓名_处方编号 | ✅ 一致 | ✅ 一致 | ✅ 一致 |
| preload接口 | — | ✅ 兼容 | — | — |

## 实施步骤

### 步骤1：替换云端桌面 video-recorder.js（核心修改）

**文件**：`cloud_project/cloud_desktop/electron/video-recorder.js`

**操作**：用 `offline_project/db-bendi/electron/video-recorder.js` 的完整内容替换。

**兼容性验证**：
- preload.js 暴露了 `saveVideoFile(arrayBuffer, fileName)` 和 `savePrescriptionImage(imageData, fileName)` ✅
- main.js 的 `injectVideoRecorder(win)` 函数读取文件并 `executeJavaScript` 注入，不依赖函数名 ✅
- `openVideoRecorder` 仅在 video-recorder.js 内部使用（定义+按钮绑定+window暴露），无外部引用 ✅
- 按钮注入到 `.history-header`，云端页面有此元素 ✅

### 步骤2：调整云端手机端按钮顺序

**文件**：`cloud_project/tcm-prescription-system/public/index.html`

**操作**：将 mobile-action-bar 按钮顺序从 `📷 拍照 | 🎥 录像` 调整为 `🎥 录像 | 📷 拍照`（与 db-shouji 一致）。

当前：
```html
<button ... onclick="if(window.openPhotoOverlay)...">📷 拍照</button>
<button ... onclick="if(window.openRecordingOverlay)...">🎥 录像</button>
```

调整为：
```html
<button ... onclick="if(window.openRecordingOverlay)...">🎥 录像</button>
<button ... onclick="if(window.openPhotoOverlay)...">📷 拍照</button>
```

### 步骤3：无需修改的端

- **离线桌面**（db-bendi、db-geren、db-dingzhi）：已完全一致，无需修改
- **离线手机**（db-shouji）：内联代码与 db-bendi 一致，无需修改
- **云端手机 video-recorder-inject.js**：已与 db-bendi 基本一致（`cloud-vr-` 前缀避免与页面 `video-` 类名冲突），无需修改

## 验证方案

1. **云端桌面**：重新打包 cloud_desktop Electron 应用，运行后点击 `.history-header` 中的 📷/🎥 按钮，应弹出白色主题 overlay，有切换摄像头按钮，后置摄像头默认
2. **云端手机端**：部署 index.html 到 Cloudflare Pages，安装新 APK，处方页面底部应显示 `🎥 录像 | 📷 拍照 | 🗑️ 清空 | 💾 保存 | 🖨️ 打印`
3. **文件保存**：录像保存为 `患者姓名_处方编号_video.webm`，拍照保存为 `患者姓名_处方编号_photo_tongue_front.png` 和 `photo_tongue_under.png`
