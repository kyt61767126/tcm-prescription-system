# 统一桌面/手机端（离线和云端）照相录像功能

## 任务背景

用户要求：将"桌面、手机端（离线和云端）的照相、录像功能"统一为与本地离线桌面程序（db-bendi）一致的实现。

## 当前状态分析（基于 Phase 1 探索）

### 参考标准：db-bendi/electron/video-recorder.js（786 行）

核心特性：
- **UI 主题**：白色（`background: #fff`）
- **CSS 类前缀**：`video-`（如 `.video-overlay`、`.video-modal`）
- **按钮注入位置**：`.history-header` 刷新按钮前，📷 在 🎥 左边
- **摄像头默认 facingMode**：`environment`（后置）
- **切换摄像头**：🔄 按钮，支持前后切换
- **录像流程**：开始录制 → 停止录制 → 保存视频（三个独立按钮）
- **拍照流程**：两步采集（1. 舌面图像 → 2. 舌下络脉）
- **文件命名规则**：`患者姓名_处方编号_type_subtype.ext`（如 `张三_26070701_video.webm`）
- **录制参数**：640×480 / 15fps / 500kbps / 最长 60 秒 / WebM-VP9

### 各端对比结果

| 端 | 文件路径 | 与 db-bendi 一致性 | 需要修改 |
|---|---|---|---|
| 离线桌面 db-bendi | `offline_project/db-bendi/electron/video-recorder.js` | 参考标准 | - |
| 离线桌面 db-geren | `offline_project/db-geren/electron/video-recorder.js` | **完全一致** ✓ | 无 |
| 离线桌面 db-dingzhi | `offline_project/db-dingzhi/electron/video-recorder.js` | **完全一致** ✓ | 无 |
| 云端桌面 cloud_desktop | `cloud_project/cloud_desktop/electron/video-recorder.js` | **完全一致** ✓（上次会话已替换） | 无 |
| 离线手机 db-shouji | `offline_project/db-shouji/android/app/src/main/assets/public/index.html`（内联） | **功能完全一致** ✓ | 无 |
| 云端手机 cloud_app | `cloud_project/cloud_app/app/src/main/assets/video-recorder-inject.js` | **功能一致**，但 CSS 类前缀为 `cloud-vr-`（非 `video-`） | 见下方决策 |
| 云端网页 tcm-prescription-system | `cloud_project/tcm-prescription-system/public/index.html` | **按钮顺序不一致**：当前 `📷 拍照 → 🎥 录像`，应为 `🎥 录像 → 📷 拍照` | **必须修改** |

### 关键发现

1. **云端网页 index.html 第 1031-1039 行**（mobile-action-bar）当前按钮顺序：
   ```html
   <button class="action-btn" onclick="if(window.openPhotoOverlay)window.openPhotoOverlay();else alert('拍照功能加载中，请稍候')">📷 拍照</button>
   <button class="action-btn" onclick="if(window.openRecordingOverlay)window.openRecordingOverlay();else alert('录像功能加载中，请稍候')">🎥 录像</button>
   ```
   需交换为：`🎥 录像 → 📷 拍照`（与 db-shouji 第 535 行的 mobile-action-bar 一致）

2. **db-shouji 的 mobile-action-bar 按钮顺序**（参考标准，第 535 行）：
   ```
   🎥 录像 → 📷 拍照 → 🗑️ 清空 → 📊 统计 → 🔑 修改密码
   ```

3. **cloud_app/video-recorder-inject.js** 实现完整，功能与 db-bendi 一致：
   - 录像：开始/停止/保存，60 秒，500kbps，WebM
   - 拍照：两步采集（舌面→舌下络脉）
   - 切换摄像头 🔄
   - 文件命名：`患者姓名_处方编号_type_subtype.ext`
   - 唯一差异：CSS 类前缀 `cloud-vr-`（vs db-bendi 的 `video-`），DOM ID 前缀 `cloudVr`（vs `video`）

## 假设与决策

### 决策 1：cloud_app 的 CSS 类前缀保持 `cloud-vr-`，不统一为 `video-`

**理由**：
- cloud_app 通过 Android WebView 注入脚本到第三方页面（tcm-prescription-system.pages.dev）
- 使用独立前缀 `cloud-vr-` 是为了避免与宿主页面 CSS 冲突的合理设计
- 功能与 db-bendi 完全一致，前缀差异不影响用户体验
- 强行统一可能导致难以排查的样式冲突风险

**用户感知**：无差异（功能、UI 视觉、交互完全一致）

### 决策 2：cloud_desktop Electron 应用不重新打包

**理由**：
- 上次会话已替换 video-recorder.js 文件内容
- 重新打包需用户明确要求（耗时较长）
- 开发环境下可直接运行 `npm start` 验证

## 拟定修改

### 修改 1（必须）：调整云端网页 mobile-action-bar 按钮顺序

**文件**：`cloud_project/tcm-prescription-system/public/index.html`

**位置**：第 1033-1034 行

**修改前**：
```html
<button class="action-btn" onclick="if(window.openPhotoOverlay)window.openPhotoOverlay();else alert('拍照功能加载中，请稍候')">📷 拍照</button>
<button class="action-btn" onclick="if(window.openRecordingOverlay)window.openRecordingOverlay();else alert('录像功能加载中，请稍候')">🎥 录像</button>
```

**修改后**（交换两行顺序）：
```html
<button class="action-btn" onclick="if(window.openRecordingOverlay)window.openRecordingOverlay();else alert('录像功能加载中，请稍候')">🎥 录像</button>
<button class="action-btn" onclick="if(window.openPhotoOverlay)window.openPhotoOverlay();else alert('拍照功能加载中，请稍候')">📷 拍照</button>
```

**为什么**：使按钮顺序与 db-shouji 离线手机端一致（🎥 录像 在 📷 拍照 左边）

### 修改 2（必须）：部署到 Cloudflare Pages

**操作**：在 `cloud_project/tcm-prescription-system/` 目录下执行 git add/commit/push

**提交信息**：`统一移动端按钮顺序：录像在前拍照在后（与离线手机端一致）`

**为什么**：Cloudflare Pages 通过 git push 自动部署，云端 APP 和云端网页都会加载最新版本

## 不需要修改的端

- **db-bendi / db-geren / db-dingzhi**：完全一致 ✓
- **cloud_desktop**：上次会话已替换 ✓
- **db-shouji**：内联实现完全一致 ✓
- **cloud_app/video-recorder-inject.js**：功能一致，CSS 前缀差异为合理设计 ✓

## 验证步骤

1. **本地验证 index.html 修改**：用 Grep 确认第 1033-1034 行顺序已交换
2. **git push 成功**：确认 `main -> main` 推送成功
3. **Cloudflare Pages 部署**：可选，访问 `https://tcm-prescription-system.pages.dev` 确认按钮顺序
4. **云端 APP 验证**：可选，重新打包 APK 后在手机上确认按钮顺序（🎥 录像 在 📷 拍照 左边）

## 影响范围

- **云端网页用户**：mobile-action-bar 按钮顺序变更（🎥 在 📷 左边）
- **云端 APP 用户**：同上（因为 APP 加载同一页面）
- **离线端用户**：无影响（实现已一致）
