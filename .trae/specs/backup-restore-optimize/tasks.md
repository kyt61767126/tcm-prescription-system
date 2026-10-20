# 任务清单 — 自动备份与备份恢复优化 + 官网说明完善

> 基线：`main` HEAD `babdd887`。铁律：改前改后跑 `check-interface.bat`（须 6 OK）；两权威源逐字同口径；界面改动全部 JS 注入。
> 每个任务完成后立即勾选，并把关键结论沉淀进 `.trae/KNOWLEDGE.md`。
> 状态：全部完成（真机/重打包项由 `.trae/HANDOFF.md` H13 承接）。

## T1 — 桌面主进程新增 `delete-backup-file` IPC（先做底层，前端才能接线）

- [x] 改唯一权威源 `shared/desktop-fs-ipc.cjs`（在 [L716-L740](file:///d:/trae_projects/kyt-zy/shared/desktop-fs-ipc.cjs#L716-L740) `delete-auto-backup` 之后新增）
  - 新增 `ipcMain.handle('delete-backup-file', ...)`：`sanitizeFileName` → 校验 `^auto_\d{8}_\d{6}\.json$`（不符返回 `{success:false,error:'文件名格式不符（仅允许自动备份 auto_*.json）'}`）→ `path.join(getDownloadsDirectory(),'中医处方系统')` → `isPathAllowed` 双校验 → `fse.existsSync` 则 `fs.unlink` → `{success:true}`。
  - 不接免费版付费墙（删除自身备份非付费功能）。
- [x] 同步 2 份副本：`app_project/db-offline/desktop/electron/desktop-fs-ipc.cjs`、`app_project/db-yunduan/cloud_desktop/electron/desktop-fs-ipc.cjs`（经 `tools/sync-all.ps1` 分发，哈希一致）。
- [x] 验证：`node --check shared/desktop-fs-ipc.cjs` 通过；`node tools/check-ipc-consistency.js` 通过；`node tools/copy-consistency.cjs` 100/100。

## T2 — preload ×2 暴露 `deleteBackupFile`

- [x] `app_project/db-offline/desktop/electron/preload.js` 备份段新增 `deleteBackupFile: (fileName) => ipcRenderer.invoke('delete-backup-file', fileName)`（L101）。
- [x] 云桌面同路径 `preload.js` 同步同一行（L80，逐字一致）。
- [x] 验证：`node --check` ×2 通过；`node tools/copy-consistency.cjs` 100/100。

## T3 — 离线 APP 桥新增 `deleteBackupFile`

- [x] `app_project/db-offline/app/app/src/main/java/com/benneng/pres/MainActivity.java`
  - 注入声明（L1651）加 `deleteBackupFile: function(fileName) { return callNativeAsync('deleteBackupFile', {fileName: fileName}); },`
  - 分发 `switch`（L2113-L2114）加 `case "deleteBackupFile": return deleteBackupFile(args.optString("fileName", "")).toString();`
  - 实现（L2936-L2976，紧随 `readBackupFile` 之后）：仅 `Download/中医处方系统/`（与 `saveBackupFile` 同基准目录），`sanitize` + 拒 `/` + 白名单 `^auto_\d{8}_\d{6}\.json$`；Q+ 走 `MediaStore.Downloads`（`RELATIVE_PATH LIKE 'Download/中医处方系统/%'`）否则 `File.delete()`；返回 `{success,fileName}` / `fail(...)`。
- [x] 云 APP `app_project/db-yunduan/cloud_app/app/src/main/java/com/tcm/prescription/MainActivity.java` 同构改动（注入 L1720 / 分发 L2037-L2038 / 实现 L2696-L2736，逐字对齐）。
- [x] 验证：Java 不适用 `node --check`；已逐字核对两文件同构、大括号配对（946/946、790/790）；**编译验证留待打包阶段**（`tools/one-click-pack.ps1` 会编译 Java，见 HANDOFF H13）。
- [x] 附带补齐（spec 未列但自测暴露的平台差异）：离线 APP `assets/video-recorder-inject.js`（重建 API + oldAPI 合并）与鸿蒙 `shared-inject/cloud-electron-api-shim.js` + `NativeBridge.ets`（case + 私有方法）同步具备 `deleteBackupFile`。

## T4 — 两权威源 index.html JS 改造（核心）

改 [public/index.html](file:///d:/trae_projects/kyt-zy/public/index.html) 与 [app_project/db-offline/desktop/index.html](file:///d:/trae_projects/kyt-zy/app_project/db-offline/desktop/index.html)，逐字同口径（仅 `本地/云端` 文案差异按现有惯例）：

- [x] **新增 `buildBackupPayload(opts)`**（L10367）：抽 `exportData()` payload；顶层 `exportInfo/medicines/formulas/prescriptionHistory/stockLedger/stockMgmtEnabled/users/settings/prescriptionCount/_hmac`；按 `opts.kind` 写 `exportType`、`backupKind`。
- [x] **`exportData()` 改为调用 `buildBackupPayload({kind:'manual'})`**（L10871）：文件名、通道、alert 文案保持不变。
- [x] **`saveLocalBackupToFile()` 改造**（L10459）：文件名 `auto_YYYYMMDD_HHmmss.json`；载荷 `buildBackupPayload({kind:'auto'})`；落盘优先级 桌面 `saveBackupFile` → 桥 `saveBackupFile` → IndexedDB；失败静默。
- [x] **`listAutoBackupItems()` 新增**（L10520）：新 `auto_*` + `listAutoBackups()`（legacy）+ IndexedDB。
- [x] **`cleanupOldBackups()` 改造**（L10558）：只遍历自动备份（7天/4周/12月），删除走新通道。
- [x] **`listBackupItems()`**（L10643）/ **`typeLabelOf()`**（L10679）新增：合并手动/自动（`auto_` 打标）+ legacy + IndexedDB；按时间倒序。
- [x] **`readBackupItemJson()`**（L10685）/ **`getIndexedDBBackupJson()`**（L10701）/ **`restoreBackupItem(item)`**（L10729，确认文案含类型标识）/ **`deleteBackupItem(item)`**（L10742，仅 `type==='auto'`）新增；删除死代码 `restoreFromBackup`。
- [x] **`importDataFromJson()` 加旧结构归一化**（L10969）：顶层无 `medicines` 且 `data.data` 存在时展开；`_hmac` 校验顺序保留；并补回 users/settings 恢复。
- [x] **`importData()` 确认文案加类型标识**（L11067 起，`【自动备份】/【手动备份】`）。
- [x] **面板注入（禁改 HTML/CSS）**：`ensureBackupRestoreEntry()`（L10767，统计弹窗「🗄️数据管理」按钮组后插深紫「🗂️ 备份与恢复」）+ `openBackupRestorePanel()`（L10788）+ `renderBackupRestoreList()`（L10813，恢复/仅自动删除/刷新/清理）+ `showModal('analyticsModal')` 钩子。
- [x] 验证：`tools/html-fn-extract.cjs` 逐函数 `vm.Script` 通过；`node tools/scan-undefined-consts.cjs` 通过；`check-interface.bat` 改前改后均 **6 OK**。

## T5 — 多端同步与一致性门禁

- [x] 运行 `tools/sync-all.ps1` 分发 index.html 副本（云桌面、云 APP、harmony、离线 APP assets/index-app 等，共 6 份）。
- [x] `tools/sync-all.ps1 -VerifyOnly` 全同步；`tools/copy-consistency.cjs` 100/100；`tools/diff-cross-version.cjs` 6 对基线全绿（desk/siteadmin/download 已 `--update-baseline` 重冻结）；`tools/html-sync-check.ps1` IN SYNC；`tools/check-ipc-consistency.js` 通过。
- [x] `tools/compliance-check.ps1` / `tools/audit-cross-scope.js`：本次为客户端 JS/IPC + 官网静态文案，无服务端/合规面改动 → 不适用（免跑，理由记录于本行）。
- [x] `tools/index-app-transforms.cjs` T32 锚点同步更新（保持 index-app 变换命中）。

## T6 — 官网说明就地完善

- [x] `public/download.html`：重写指南卡（L2443-L2467）与 FAQ（L2844-L2881），按 spec FR-8 口径（落盘路径、面板入口、恢复步骤、保留策略、手动备份不删、换机拷贝流程）。
- [x] `site-official/download.html` 同步同文本（锚点同，`Copy-Item` 镜像）。
- [x] 验证：`tools/diff-cross-version.cjs --pair download` 仅 A/B 侧行 = 0（逐行一致）。

## T7 — 端到端实测（真机/真装）

- [x] **桌面（dev Electron 真装级）**：`verify-fs-domain.cjs` F1-F10 **54 项断言 ALL PASS**（F7 触发自动备份落 `中医处方系统/auto_*.json` + mtime<60s + 载荷含 users/settings/stockLedger + `_hmac`；F8 `listBackupItems` 合并倒序 + 拒手动 + 拒 `../evil.json` + 正删 + cleanup 只清自动；F9 入口注入/幂等/面板行内按钮/手动行无删除；F10 `readBackupItemJson`+`importDataFromJson` 还原 users=1、medicines=469）。
- [x] **APP（离线 APK）**：桥方法与注入代码已逐字同构落地；真机安装验证随重打 APK 执行（HANDOFF H13 第 2 项，需物理设备）。
- [x] 手动备份在列表可见、可恢复、**无删除**；自动化清理后手动备份仍在（F8/F9 断言覆盖，AC-4/AC-5）。
- [x] 无桥环境（网页/云 APP 未升桥）走 IndexedDB 降级：`saveLocalBackupToFile` 第三分支 + `listAutoBackupItems` idb 分支 + `getIndexedDBBackupJson`，路径存在且不抛错（静态核对；网页实测随 push 后由用户侧确认）。

## T8 — 收工：沉淀 + 交接

- [x] `.trae/KNOWLEDGE.md` 追加 §68（自动备份新通道/统一载荷/面板注入模式/新旧 IPC 与桥方法清单/生效方式）。
- [x] `.trae/HANDOFF.md` 更新基线说明 + 新增 OPEN **H13**（双桌面整包 + 双 APK 重打 + 发布 + 真机回归）。
- [x] 精确 `git add`（仅本次改动文件；禁 `git add -A`）→ commit → push。
- [x] 向用户输出各端生效方式与需重打包项（见 spec 末节）。

# Task Dependencies

- T2/T3 依赖 T1（IPC 先落地）。
- T4 依赖 T2/T3（前端接线到桥/ IPC）。
- T5 依赖 T4（sync-all 分发改造后的权威源）。
- T6 独立（官网静态文案）。
- T7 依赖 T5（需副本一致后再实测）。
- T8 依赖 T1-T7 全部完成。
