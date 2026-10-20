# 验收清单（Checklist）— 自动备份与备份恢复优化

## 开工前

- [x] `git status` 已核对（工作区即为本次改动集，符合预期）；已 Read `.trae/KNOWLEDGE.md` 与 `.trae/HANDOFF.md`。
- [x] 已记录基线 commit（`babdd887`，`git log -1` 已核）与改动前 `check-interface.bat` = 6 OK。

## 功能验收

- [x] AC-1 自动备份落用户可见目录（桌面 `惠康中医媒体\downloads\中医处方系统\`；APP `Download/中医处方系统/`），文件名 `auto_YYYYMMDD_HHmmss.json`，载荷含 users/settings/stockLedger/_hmac。
      **证据**：E2E F7 — `saveLocalBackupToFile()` 返回 true，落盘 `auto_20261020_084637.json`（mtime 距今 0s），`backupKind=auto`，含 medicines/formulas/prescriptionHistory/stockLedger/users/settings，`_hmac` 保留。
- [x] AC-2「备份与恢复」面板合并列出手动+自动，类型/时间/大小/处方数齐全。
      **证据**：E2E F8（`listBackupItems` 含 auto+manual、时间倒序、字段齐）+ F9（面板列出 3 行）。
- [x] AC-3 自动备份一键恢复成功，账号表与诊所设置一并还原；确认框含类型标识。
      **证据**：E2E F10 — `readBackupItemJson` → `importDataFromJson` 还原 `users=1`、`medicines=469`；`restoreBackupItem` 确认文案含【类型】+文件名。
- [x] AC-4 删除仅自动备份；手动备份无删除入口；IPC/桥拒非 `auto_` 文件名。
      **证据**：E2E F8 — 拒手动备份、拒 `../evil.json`、正删 auto 成功、手动文件仍完整；F9 — 手动行无「删除」按钮。
- [x] AC-5 保留策略只清自动备份，手动备份数量不变。
      **证据**：E2E F8 — `cleanupOldBackups` 清 2024 过期 auto，`本地_*.json` 保留。
- [x] AC-6 官网两副本（`public/`、`site-official/`）文案一致，且与客户端实际路径/入口逐条对应。
      **证据**：`diff-cross-version --pair download` 仅 A/B 侧行 = 0；文案路径 `安装盘\惠康中医媒体\downloads\中医处方系统\` / `Download/中医处方系统/` 与 `saveBackupFile` 实施基准目录一致；入口 `统计 → 🗄️数据管理 → 🗂️ 备份与恢复` 与 `ensureBackupRestoreEntry` 注入位置一致。

## 界面与同步门禁

- [x] `check-interface.bat` 改动后仍 **6 OK**（面板与入口均为 JS 注入，HTML 结构/CSS 未改）。
- [x] `tools/sync-all.ps1 -VerifyOnly` 全同步；`tools/copy-consistency.cjs` 100/100；`tools/diff-cross-version.cjs` 6 对基线全绿；`tools/html-sync-check.ps1` IN SYNC；`tools/check-ipc-consistency.js` 通过。
- [x] `node --check` 通过（`shared/desktop-fs-ipc.cjs`、两份 `preload.js`、`tools/index-app-transforms.cjs`）；index.html 内嵌 JS 经 `tools/html-fn-extract.cjs` 逐函数 `vm.Script` 校验通过。

## 安全与非回归

- [x] 删除路径双校验（`auto_` 前缀 + 白名单目录 canonical path / Android 限 `Download/中医处方系统/`），无路径穿越。
      **证据**：E2E F8 拒 `../evil.json`；IPC 内 `path.relative` + `isPathAllowed`；Android `sanitize` 拒 `/` + `MediaStore` RELATIVE_PATH 限定。
- [x] `_hmac` 校验保留，旧结构自动备份可被归一化恢复。
      **证据**：`buildBackupPayload` 仍算 `_hmac`（F7 断言保留）；`importDataFromJson` 归一化后再校验（L10969-L10986）。
- [x] `exportData()`/`importData()` 对外可见行为除确认文案外零变化；自动备份静默节流保持（2 min + 签名去重）。
      **证据**：`exportData()` 仅在载荷组装改为 `buildBackupPayload({kind:'manual'})`，文件名/通道/alert 未变；节流逻辑未触碰。
- [x] IndexedDB 降级通道可用。
      **证据**：`saveLocalBackupToFile` 第三分支 + `listAutoBackupItems` idb 分支 + `getIndexedDBBackupJson` 完整（静态核对，无桥环境不抛错）。

## 交付与生效

- [x] 明确告知用户各端生效方式：`index.html` 可热更（desktop local/cloud、app-local）；`desktop-fs-ipc.cjs`/`preload.js` 需整包；`MainActivity.java` 需重打 APK；官网随 push 部署。
- [x] `.trae/KNOWLEDGE.md`（§68）与 `.trae/HANDOFF.md`（基线说明 + H13）已更新并随代码 commit/push。
- [x] 精确 `git add`（禁止 `-A`）。
