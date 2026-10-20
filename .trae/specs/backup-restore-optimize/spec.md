# 自动备份与备份恢复优化 + 官网说明完善 — 产品需求文档（SPEC）

## Overview

- **Summary**: 把「自动备份」从**写入隐藏目录、前端列表不可见、内容不完整、无删除能力**的假备份，改造为**与手动备份同通道、同结构、可列出、可一键恢复、可删除、可保留策略清理**的真备份；同时把官网下载页「数据备份与恢复指南」卡片与「数据与恢复」FAQ 改为与新版能力逐条对应的说明。
- **Purpose**: 2026-08-29 起引入的自动备份（P1-1）存在三重不可用：①桌面端落 `%APPDATA%\<userData>\backups\`，用户既看不到也不在恢复列表里；②APP 端无 `saveAutoBackup` 桥，自动备份落 IndexedDB，卸载 APP 即全丢（与"换机/重装可恢复"承诺相矛盾）；③自动备份只带 medicines/formulas/prescriptionHistory，缺 users/settings/stockLedger，即使恢复也救不回账号与设置。官网说明又与实现不符（说"无需手动备份"，实际恢复入口找不到自动备份）。
- **Target Users**: 离线桌面 / 云桌面 / 离线 APP / 云端 APP 的使用者；卸载重装、重装系统、换机迁移、误删数据需回滚的用户；客服（按官网说明指导用户操作）。

## Goals

- **自动备份真正可恢复**：自动备份与手动备份**同一落盘目录、同一 JSON 结构、同一恢复通道**，恢复时账号/设置/药品/验方/处方/库存台账一并还原。
- **自动备份用户可见**：桌面落「惠康中医媒体\downloads\中医处方系统\」，APP 落「Download/中医处方系统/」，落在用户能自己拷走的目录。
- **列表统一**：新增「备份与恢复」面板，手动 + 自动备份**合并一列**，标注类型（自动/手动）、时间、大小、处方数。
- **一键恢复 / 按需删除**：列表内任意一项可一键恢复；自动备份可单项删除、可一键清理过期自动备份；**手动备份永不自动删除**。
- **无桥环境不丢数据**：网页/无原生桥环境保留 IndexedDB 降级（但仍可列表、可恢复、可删）。
- **官网说明与实现一致**：指南卡与 FAQ 逐条对上新版行为，用户照做能成功恢复。

## Non-Goals

- 不改受保护的 6 份 `index.html` 结构与 CSS（面板与入口**全部 JS 运行时注入**）。
- 不新增独立官网页面；只就地完善现有卡片与 FAQ。
- 不改云备份/服务端 KV、不改云端账号同步体系（云端用户账号在服务端，无需本地恢复）。
- 不改手动「一键备份」的产品语义（仍写 `本地_<用户>_<日期>_<时间>.json` 到同目录）。
- 不做备份加密格式变更（保留既有 `_hmac` 与旧 `encrypted` 兼容读取）。

## Background & Context

**已核实现状（改动前基线行号，仅作定位，改动后行号会平移）**

- 桌面自动备份写入 `%APPDATA%\<userData>\backups\backup_YYYYMMDD_HHmmss.json`：
  - 前端：[index.html](file:///d:/trae_projects/kyt-zy/app_project/db-offline/desktop/index.html#L9782-L9812) `saveLocalBackupToFile()` / [L9837-L9881](file:///d:/trae_projects/kyt-zy/app_project/db-offline/desktop/index.html#L9837-L9881) `cleanupOldBackups()`。
  - 主进程：[desktop-fs-ipc.cjs](file:///d:/trae_projects/kyt-zy/shared/desktop-fs-ipc.cjs#L669-L740) `save-auto-backup` / `list-auto-backups` / `delete-auto-backup`。
  - preload：[preload.js](file:///d:/trae_projects/kyt-zy/app_project/db-offline/desktop/electron/preload.js#L101-L104) 暴露 `saveAutoBackup/listAutoBackups/deleteAutoBackup`。
- 恢复入口只列「惠康中医媒体\downloads\中医处方系统\」：`save-backup-file / list-backup-files / read-backup-file / open-backup-picker`（同文件 [L567-L665](file:///d:/trae_projects/kyt-zy/shared/desktop-fs-ipc.cjs#L567-L665)）→ **自动备份从未在恢复列表出现**，`listAutoBackups` 仅被清理逻辑调用。
- `restoreFromBackup()`（[index.html L9929-L9970](file:///d:/trae_projects/kyt-zy/app_project/db-offline/desktop/index.html#L9929-L9970)）只读 localStorage `localBackups`，**客户端零调用点 = 死代码**。
- 自动备份内容仅 `{timestamp, version:'P1-1', data:{medicines, formulas, prescriptionHistory}}`（[L9788-L9797](file:///d:/trae_projects/kyt-zy/app_project/db-offline/desktop/index.html#L9788-L9797)）；而手动 `exportData()`（[L9972-L10104](file:///d:/trae_projects/kyt-zy/app_project/db-offline/desktop/index.html#L9972-L10104)）带 `exportInfo / users / settings / stockLedger / stockMgmtEnabled / _hmac`。恢复逻辑 `importDataFromJson()`（[L10122-L10190](file:///d:/trae_projects/kyt-zy/app_project/db-offline/desktop/index.html#L10122-L10190)）只认**顶层**字段并做 HMAC 校验。
- APP 桥（离线 [MainActivity.java](file:///d:/trae_projects/kyt-zy/app_project/db-offline/app/app/src/main/java/com/benneng/pres/MainActivity.java#L1648-L1652)：注入声明 / [L2103-L2118](file:///d:/trae_projects/kyt-zy/app_project/db-offline/app/app/src/main/java/com/benneng/pres/MainActivity.java#L2103-L2118)：分发 / [L2744](file:///d:/trae_projects/kyt-zy/app_project/db-offline/app/app/src/main/java/com/benneng/pres/MainActivity.java#L2744),[L2809](file:///d:/trae_projects/kyt-zy/app_project/db-offline/app/app/src/main/java/com/benneng/pres/MainActivity.java#L2809),[L2872](file:///d:/trae_projects/kyt-zy/app/app/src/main/java/com/benneng/pres/MainActivity.java#L2872)：实现）仅 `saveBackupFile/listBackupFiles/readBackupFile` 等 → **无 saveAutoBackup**；云 APP 同构（`com/tcm/prescription/MainActivity.java`）。
- 两权威源同口径：[public/index.html](file:///d:/trae_projects/kyt-zy/public/index.html#L10363-L10530)（云系）与 [db-offline/desktop/index.html](file:///d:/trae_projects/kyt-zy/app_project/db-offline/desktop/index.html#L9782-L9970)（离线系），函数名与逻辑同构、行号偏移约 +581。
- 官网：`public/download.html` 指南卡 [L2443-L2469](file:///d:/trae_projects/kyt-zy/public/download.html#L2443-L2469)、FAQ「数据与恢复」[L2835-L2883](file:///d:/trae_projects/kyt-zy/public/download.html#L2835-L2883)；`site-official/download.html` 同结构（同一锚点文本）。

**已定调（用户确认）**：代码走「完整方案：自动备份必须真正可恢复」；官网走「就地完善现有卡片 + FAQ」（不新增独立页）。

## Functional Requirements

- **FR-1 统一备份载荷 `buildBackupPayload(opts)`**（两权威源 index.html 各新增一个函数，抽自现有 `exportData()` 的 payload 组装）
  - 返回顶层结构：`exportInfo`、`medicines`、`formulas`、`prescriptionHistory`、`stockLedger`、`stockMgmtEnabled`、`users`（`local_systemUsers` 经 `simpleDecrypt` 后 parse）、`settings`（clinicName/clinicDoctor/defaultRegFee/defaultDose）、`prescriptionCount`、`_hmac`。
  - `opts.kind`: `'manual' | 'auto'`；写入 `exportInfo.exportType`（manual=`'full'`、auto=`'auto'`）与 `exportInfo.backupKind`（`'manual' | 'auto'`），auto 时 `exportUser` 记为 `'自动备份'`。
  - `exportData()` 改为调用 `buildBackupPayload({kind:'manual'})`，保留原文件名 `本地_<用户>_<日期>_<时间>.json`、原 `saveBackupFile` 通道、原成功/失败 alert 文案（不改用户可见行为）。
- **FR-2 自动备份改通道、带 `auto_` 前缀**（`saveLocalBackupToFile()`）
  - 文件名：`auto_YYYYMMDD_HHmmss.json`；载荷：`buildBackupPayload({kind:'auto'})`。
  - 落盘优先级：① `window.electronAPI.saveBackupFile`（桌面 → 「惠康中医媒体\downloads\中医处方系统\」）；② `window.AndroidNative`/`electronAPI` 等价桥 `saveBackupFile`（APP → `Download/中医处方系统/`）；③ 无桥 → `saveBackupToIndexedDB`（IndexedDB 降级，保持现状可用）。
  - 失败路径不弹窗（静默，保持自动备份无感）；写成功返回 true 供节流判定。
- **FR-3 统一列表 `listBackupItems()`**（新增 JS 函数）
  - 桌面：`electronAPI.listBackupFiles()`（该 IPC 已同时覆盖 `中医处方系统/` 子目录 + `downloads/` 根）→ 打标：`fileName.startsWith('auto_')` → 类型「自动」，否则「手动」。
  - APP：桥 `listBackupFiles()` 同源返回（自动备份已落同目录）。
  - 无桥：`listIndexedDBBackups()` 打标为「自动」。
  - 每项统一字段：`{fileName, type, timestamp, size, prescriptionCount?}`（`prescriptionCount` 读不到时留空，由恢复前一并解析）。
  - 兼容读取旧自动备份：仍并列展示 `electronAPI.listAutoBackups()`（legacy `backup_*.json`，标「自动·旧」）与 IndexedDB legacy。
- **FR-4 「备份与恢复」面板（JS 运行时注入，禁改 HTML/CSS）**
  - 入口：DOM ready 后，定位「统计 → 🗄️数据管理」区块内既有按钮组（`button[onclick="exportData()"]` 的父容器，位于统计弹窗 HTML 内；设置弹窗的同名按钮在 APP 端被隐藏，不作为入口），`createElement` 追加「🗂️ 备份与恢复」按钮（样式内联，深紫底白字，与既有 `action-btn` 等高）。
  - 面板：JS `createElement` 生成的遮罩 + 卡片浮层（非 HTML 文件改动），列出 `listBackupItems()` 结果表：列 = 类型 / 时间 / 大小 / 处方数；行操作 = 「恢复」；自动备份行额外有「删除」；顶部有「一键清理旧自动备份」与「刷新」。
  - 空列表显示引导文案（去哪个目录拷贝备份）。
- **FR-5 恢复通道统一（`restoreBackupItem(item)`）**
  - 取代死代码 `restoreFromBackup()`：按文件读取（桌面 `electronAPI.readBackupFile(fileName)` / 桥 `readBackupFile` / IndexedDB `getIndexedDBBackup(fileName)`）→ `importDataFromJson(json)`。
  - 二次确认文案带**类型标识**：`确定用【自动备份】auto_20261020_093000.json 恢复吗？（时间：…，处方 N 条）恢复将合并/覆盖当前数据！`
  - 兼容旧结构：`importDataFromJson()` 入口加归一化 —— 若 `data.medicines` 等顶层缺失且 `data.data` 存在，则按 `payload = data.data` 展开（旧自动备份可恢复）；同时把归一化后对象回填 `Data`（原实现为直接改 `data`）。
  - 现有「📂 恢复数据」按钮（`importData()`）的确认文案加类型标识（列表首条是自动备份时注明「（自动备份）」）。
- **FR-6 删除能力（仅允许自动备份）**
  - 桌面：`shared/desktop-fs-ipc.cjs` 新增 IPC `delete-backup-file`，仅接受 `^auto_\d{8}_\d{6}\.json$`，路径限定 `getDownloadsDirectory()/中医处方系统/`，返回 `{success}`；preload ×2 暴露 `deleteBackupFile(fileName)`。
  - APP：两份 `MainActivity.java` 新增桥方法 `deleteBackupFile(fileName)`，限定 `Download/中医处方系统/` 下 `auto_*.json`，返回 JSONObject；同步补注入声明（多行字符串数组）与分发 `switch` 分支。
  - JS：`deleteBackupItem(item)` 按类型分流（桌面 IPC / 桥 / IndexedDB）；**手动备份不提供删除**。
- **FR-7 保留策略只清自动备份**（`cleanupOldBackups()` 改造）
  - 只对 `type==='auto'`（含 legacy `backup_*`）执行 7 天每日 / 4 周每周 / 12 月每月策略；**手动备份永不进入待删集**。
  - 删除分流：新自动备份走 `deleteBackupFile`，legacy 走 `deleteAutoBackup`，无桥走 IndexedDB。
- **FR-8 官网说明就地完善**
  - `public/download.html` + `site-official/download.html`：重写「💾 数据备份与恢复指南」卡 [L2443-L2469] 与 FAQ「💾 数据与恢复」[L2835-L2883] 内文，口径与新版一致：
    - 自动备份落盘位置：桌面「安装盘\惠康中医媒体\downloads\中医处方系统\」（`auto_*.json`）、APP「内部存储/Download/中医处方系统/」。
    - 手动备份同样是该目录（`本地_*.json`），二者并列在「统计 → 🗄️数据管理 → 🗂️ 备份与恢复」。
    - 恢复步骤：打开面板 → 选条目 → 恢复（账号/设置/药品/验方/处方/库存一并还原）。
    - 保留策略：自动备份保留 7 天每日 + 4 周每周 + 12 月每月；**手动备份不自动删除**。
    - 换机/重装：把整个「惠康中医媒体」/「中医处方系统」文件夹拷到新机同位置，再打开面板恢复。
  - 保留既有段落风格与 `install-steps`/`card` 类，不新增页面、不改站点结构。
- **FR-9 兼容与多端同步**
  - 两权威源逐字同口径改动；改后用 `tools/sync-all.ps1` 分发副本（云桌面、云 APP、harmony、离线 APP assets/index-app 等），并过 `tools/sync-all.ps1 -VerifyOnly`。

## Non-Functional Requirements

- **NFR-1 界面保护**：改动前后各跑 `check-interface.bat`（须 6 OK）；不编辑 6 份受保护 HTML 的 body 结构与 CSS；面板/入口全部 JS 注入。
- **NFR-2 多端同步门禁**：`tools/copy-consistency.cjs`、`tools/diff-cross-version.cjs`、`tools/html-sync-check.ps1`、`tools/check-ipc-consistency.js`、`node --check`（JS/CJS 语法）、`python`/`node` JSON 校验全部通过。
- **NFR-3 数据安全不降级**：`_hmac` 校验链路保留；删除 IPC/桥只接受 `auto_` 前缀且限定白名单目录（防路径穿越）；手动备份不可删。
- **NFR-4 用户可理解**：所有提示用中文、含"目录 + 文件名 + 类型"，小白可照做。
- **NFR-5 无回归**：`exportData/importData` 对外可见行为不变（除确认文案类型标识）；自动备份静默节流（2 min + 签名不变跳过）保持。

## Constraints

- **Technical**: Electron file:// + asar 打包；Android WebView（file://，Java 桥）；Cloudflare Pages 静态部署；IndexedDB 降级通道须保留。
- **Business**: 用户已知「自动备份无需手动」，本次不得把自动备份改成需要用户手动触发。
- **Dependencies**: `fse`、`simpleDecrypt`、`computeBackupHmac`、`window.StockCore`、`window.requireFeature('backup')` 均已存在，不得新引三方依赖。

## Assumptions

- `list-backup-files` 返回的 `fileName` 唯一（该 IPC 已用 `seen` 去重）；同一目录下 `auto_*` 与 `本地_*` 不重名。
- `importDataFromJson` 对顶层 `users/settings/prescriptionHistory` 的处理已覆盖"账号+设置可还原"，归一化旧结构后即可复用。
- APP 端 `Download/中医处方系统/` 为公共目录（既有 `saveBackupFile` 已在此写入并声明 `listBackupFiles` 可读），自动备份写此处无需新增权限。

## Acceptance Criteria

### AC-1: 自动备份落用户可见目录且内容完整
- **Type**: `rule`
- **Given**: 桌面（离线/云）或 APP 环境，触发一次自动备份（`saveLocalBackupToFile()`）
- **When**: 打开备份落盘目录
- **Then**: 出现 `auto_YYYYMMDD_HHmmss.json`，JSON 顶层含 `exportInfo/medicines/formulas/prescriptionHistory/users/settings/stockLedger/stockMgmtEnabled/_hmac`
- **Pass Condition**: 桌面路径 = `安装盘\惠康中医媒体\downloads\中医处方系统\`；APP 路径 = `Download/中医处方系统/`；文件内 `exportInfo.backupKind === 'auto'`；`users` 数组非空（有账号时）
- **Evidence**: 目录截图 + JSON 首屏字段

### AC-2: 备份与恢复面板列出全部备份
- **Type**: `rule`
- **Given**: 目录内同时存在 `auto_*.json` 与手动 `本地_*.json`
- **When**: 「统计 → 🗄️数据管理 → 🗂️ 备份与恢复」
- **Then**: 两类备份同表出现，类型列分别显示「自动」「手动」，含时间/大小/处方数
- **Pass Condition**: 列表条数 = 目录 `*.json` 条数（不超过 20 上限时）；无「自动备份不显示」现象
- **Evidence**: 面板截图 + 目录对照

### AC-3: 自动备份可一键恢复且账号设置一并还原
- **Type**: `rule`
- **Given**: 使用 `auto_*.json` 恢复
- **When**: 点「恢复」并在确认框点确定
- **Then**: 药品/验方/处方恢复，且账号表与诊所设置一并还原
- **Pass Condition**: 恢复后 `local_systemUsers` 可解析出恢复前账号；登录仍可用；确认框文案含「自动备份」与文件名
- **Evidence**: 面板截图 + 恢复前后账号/设置对比

### AC-4: 删除仅限自动备份，手动备份不可删
- **Type**: `rule`
- **Given**: 面板同时有自动与手动条目
- **When**: 查看行操作
- **Then**: 仅自动行有「删除」；手动行无删除入口；IPC/桥对非 `auto_` 文件名一律拒绝
- **Pass Condition**: 手动删除请求（伪造 `本地_*.json`）返回失败；自动删除后文件消失且列表刷新
- **Evidence**: 面板截图 + IPC/桥返回

### AC-5: 保留策略只清自动备份
- **Type**: `rule`
- **Given**: 混有过期自动备份与任意年龄手动备份
- **When**: 执行 `cleanupOldBackups()`
- **Then**: 仅过期自动备份被清；手动备份全部保留
- **Pass Condition**: 执行后手动 `本地_*.json` 数量不变；自动备份按 7 天/4 周/12 月规则收敛
- **Evidence**: 执行前后目录清单

### AC-6: 官网说明与实现一致
- **Type**: `rule`
- **Given**: 打开 `download.html`（安装说明 Tab 与 FAQ）
- **When**: 阅读「数据备份与恢复指南」与「数据与恢复」
- **Then**: 落盘路径、面板入口「统计 → 🗄️数据管理 → 🗂️备份与恢复」、保留策略、手动备份不自动删除，均与客户端实际一致
- **Pass Condition**: 文案中的路径/菜单路径可在客户端逐步复现成功；两副本（`public/` 与 `site-official/`）文本一致
- **Evidence**: 页面截图 + 客户端实测

## 生效方式（交付时必须声明）

- `index.html`（JS 改动）：属热更白名单 → 桌面 `desktop/local`、`desktop/cloud` 可重签热更；APP（`app-local`）可重签热更。
- `shared/desktop-fs-ipc.cjs` + `preload.js`：在 asar 内 → **需整包重装**才生效。
- `MainActivity.java`：**需重打 APK** 才生效（自动备份落目录 + 删除能力）。
- `public/download.html` / `site-official/download.html`：随 push 部署（Pages git 构建）生效。
