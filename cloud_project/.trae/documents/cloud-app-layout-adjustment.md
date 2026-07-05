# 云端 APP 操作界面布局调整计划

## Context（背景）

用户要求参考离线 APP（`offline_project/db-shouji`）的操作界面布局，修改云端 APP（`public/index.html`）的操作界面布局。用户强调"不要删除功能按钮，制作布局调整"。

经过详细对比分析，两个项目的 **CSS 完全一致**，差异主要在 **HTML 结构顺序** 和 **HTML 内容** 上：

1. **HTML 结构顺序差异**：云端 APP 的模态框（modals）在顶部标签栏（`.top-tabs`）之前，而离线 APP 的模态框在主容器之后。这导致顶部标签栏没有直接在操作界面的最顶部显示。
2. **患者信息四行布局差异**：label 文字不同、class 拼写错误、多余的样式。

## 需要修改的文件

主要修改文件：`c:\Users\61767\Documents\trae_projects\kyt-zy\public\index.html`（网页版 + APP 版源文件）

同步修改的文件（保持一致性）：
- `cloud_project/tcm-prescription-system/index.html`（云端版源码，部署用）
- `cloud_project/cloud_desktop/index.html`（Electron 桌面版）
- `旧版/统一构建/打包-云端版/index.html`（旧版打包）

## 修改内容

### 1. HTML 结构顺序调整（顶部按钮直接在操作界面最顶部显示）

**问题**：云端 APP 的 HTML 结构顺序为：
```
登录覆盖层(#loginOverlay) → 模态框(modals, 第539-748行) → 顶部标签栏(.top-tabs, 第750行) → 主容器(.main-container)
```

离线 APP 的 HTML 结构顺序为：
```
登录覆盖层(#loginOverlay) → 顶部标签栏(.top-tabs) → 主容器(.main-container) → 底部栏 → 移动端导航 → 模态框(modals)
```

**修改方案**：将云端 APP 的模态框（第 539-748 行的所有 `<div class="modal">` 块）移到主容器和移动端导航之后，使顶部标签栏直接在登录覆盖层之后显示。

具体操作：
1. 提取第 539-748 行的所有模态框 HTML
2. 将这些模态框移到移动端快捷操作栏（`.mobile-action-bar`）之后
3. 确保顶部标签栏（`.top-tabs`）直接在登录覆盖层之后

### 2. 患者信息四行布局修改（与离线 APP 完全相同）

#### 2a. 第一行 label 文字："门诊" → "编号"
- 文件：`public/index.html` 第 782 行
- 修改：`<span class="patient-label">门诊</span>` → `<span class="patient-label">编号</span>`

#### 2b. 诊断区医师输入框 class 拼写错误修复
- 文件：`public/index.html` 第 822 行
- 修改：`class="patient-input.x-small"` → `class="patient-input x-small"`
- 原因：`patient-input.x-small` 是一个无效的 class 名（点号应为空格），导致医师输入框没有应用 `patient-input` 和 `x-small` 的样式

#### 2c. 统计输入框移除多余样式
- 文件：`public/index.html` 第 802 行
- 修改：`<input type="text" id="clinicNo" class="patient-input xx-small" style="background:#f5f5f5;color:#666;" readonly>` → `<input type="text" id="clinicNo" class="patient-input xx-small" readonly>`
- 原因：离线 APP 的统计输入框没有额外的灰色背景样式

## 不修改的内容（保留云端 APP 特有功能）

以下内容保持不变，不删除：
- 顶部标签栏的【处方查阅】【平台管理】【处方监管】按钮（角色相关，默认隐藏）
- 左面板顶部的"纵向打印"和"横向打印"按钮（云端 APP 特有）
- 患者信息输入框的 `onkeydown` 事件（Enter 键跳转功能）
- 移动端快捷操作栏的"🖨️ 打印"按钮
- `.tab-hint` 中的"【在线】"状态显示（vs 离线 APP 的"【个人】"）

## 验证方法

1. **语法验证**：修改后用 `node --check` 验证 JS 语法正确性
2. **本地测试**：在浏览器中打开 `public/index.html`，登录后检查：
   - 顶部标签栏是否直接在操作界面最顶部显示
   - 患者信息第一行是否显示"编号"（而非"门诊"）
   - 诊断区医师输入框是否正确显示样式
   - 统计输入框是否没有灰色背景
3. **功能测试**：确认所有功能按钮正常工作（打印、保存、处方查阅等）
4. **部署**：测试通过后部署到 Cloudflare Pages
