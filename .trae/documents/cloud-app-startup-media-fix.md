# 云端APP启动优化 + 照片录像查找修复

## Context

用户反馈两个问题：
1. 云端APP启动缓慢
2. 云端APP录像照片保存后，点击历史处方无法找到文件，离线APP正常

## 根因分析

### 问题2（文件查找失败）— 根因已确认

**命名格式不一致**：
- 离线APP `generateFileName`：`患者姓名_编号_type.ext`（[db-bendi/electron/video-recorder.js](file:///c:/Users/61767/Documents/trae_projects/kyt-zy/offline_project/db-bendi/electron/video-recorder.js) L801）
- 云端APP `generateFileName`：`编号_患者姓名_type.ext`（[video-recorder-inject.js](file:///c:/Users/61767/Documents/trae_projects/kyt-zy/cloud_project/cloud_app/app/src/main/assets/video-recorder-inject.js) L347）

**重命名逻辑bug**：
云端APP `renameMediaFiles`（[MainActivity.java](file:///c:/Users/61767/Documents/trae_projects/kyt-zy/cloud_project/cloud_app/app/src/main/java/com/tcm/prescription/MainActivity.java) L964-965）只搜索 `姓名_编号` 前缀，但文件实际是 `编号_姓名` 格式，导致重命名失败 → 临时编号文件未被重命名为正式编号 → 查找时找不到。

### 问题1（启动缓慢）

- `onPageFinished` 中同步读取 assets 文件并注入脚本，阻塞 UI
- loading 布局在脚本注入完成后才隐藏，延迟 100ms
- 远程URL加载的网络延迟是固有瓶颈，但脚本注入可优化

## 修改方案

### 1. 修复文件命名格式（问题2）

**文件**：[video-recorder-inject.js](file:///c:/Users/61767/Documents/trae_projects/kyt-zy/cloud_project/cloud_app/app/src/main/assets/video-recorder-inject.js) L347

将 `generateFileName` 返回值从 `编号_患者姓名` 改为 `患者姓名_编号`（与离线APP一致）：

```javascript
// 当前（错误）：
return identifier + '_' + cleanName + '_' + type + sub + '.' + ext;

// 修复后：
return cleanName + '_' + identifier + '_' + type + sub + '.' + ext;
```

### 2. 修复重命名逻辑（问题2）

**文件**：[MainActivity.java](file:///c:/Users/61767/Documents/trae_projects/kyt-zy/cloud_project/cloud_app/app/src/main/java/com/tcm/prescription/MainActivity.java) L949-978

修改 `renameMediaFiles` 方法，同时支持两种格式的重命名：
- oldPrefixes: `姓名_旧编号` 和 `旧编号_姓名`
- newPrefixes: `姓名_新编号` 和 `新编号_姓名`

修改 `renameFilesInDir` 方法，遍历两种前缀并替换为对应的新前缀。

### 3. 优化启动速度（问题1）

**文件**：[MainActivity.java](file:///c:/Users/61767/Documents/trae_projects/kyt-zy/cloud_project/cloud_app/app/src/main/java/com/tcm/prescription/MainActivity.java) L292-311

修改 `onPageFinished`：
- 先隐藏 loading 布局（让用户立即看到页面）
- 再异步注入脚本（不阻塞 UI 显示）

```javascript
// 当前：先注入脚本，100ms后隐藏loading
injectLayoutFixScript(view);
mainHandler.post(() -> { injectVideoRecorderScript(view); });
mainHandler.postDelayed(() -> { 隐藏loading }, 100);

// 优化后：先隐藏loading，再异步注入脚本
mainHandler.post(() -> { 隐藏loading; });
mainHandler.postDelayed(() -> { injectLayoutFixScript + injectVideoRecorderScript }, 50);
```

## 验证方法

1. **文件查找**：云端APP拍照录像保存后，处方保存成功，点击历史处方的📷按钮能找到文件
2. **已有文件兼容**：之前用 `编号_姓名` 格式保存的文件仍能被 `findMediaFiles` 找到（已支持两种格式搜索）
3. **启动速度**：APP启动时页面更快显示，loading消失更快
