# 同步权威源对照（以 tools/sync-all.ps1 当前组定义为准；脚本改动后以脚本为准）

## 权威源 → 同步目标（改 shared/，勿改副本）

| shared 权威源 | 分发方式 | 主要目标 |
|---|---|---|
| `shared/auth-core/cloud.js`、`shared/auth-core/offline.js` | sync-auth-core.ps1（独立脚本，**不在** sync-all） | 离线 3 目标 + 云端 8 目标，文件名均为 `auth-core.js` |
| `shared/license/license-manager.js` | sync-all Group4 | cloud_desktop/electron、db-offline desktop/electron（展平）、desktop/license、assets/public/license |
| `shared/license/feature-guard.js`、`prescription-counter.js` | sync-all Group4 | 同上 4 目标 |
| `shared/desktop-fs-ipc.cjs` | Group14 | 2 个 electron 目录 |
| `shared/desktop-windows.cjs` | Group15 | 2 个 electron 目录 |
| `shared/desktop-dialog.cjs`、`prompt-modal.html`、`prompt-preload.js` | Group17 | 2 个 electron 目录 |
| `shared/desktop-crash-guard.cjs` | Group18 | 2 个 electron 目录 |
| `shared/permission.js`、calculate-hash、electron-logger、pe-guard、update-manager、hot-update-core、voice-input、vendor 等 | Group1/2/3/7/9/10/12/19 等 | 各组 targets 列出的多端目录 |
| `index.html`（云端权威） | Group11 生成器 + sync-index 变换 | 云端各副本 |
| `index-app.html`（离线 APP 权威） | Group13 `tools/sync-index-app.cjs` 生成 | APP assets `public/index.html` |
| site-admin | Group16 `tools/sync-siteadmin.cjs` | site-admin 副本 |

## 无 shared 源的真权威（直接改本体）

- `app_project/db-offline/desktop/electron/activate.js`
- `app_project/db-offline/desktop/electron/activate-window.html`
- 其他未出现在任何 sync 组与生成器中的文件（改动前用 `Grep tools/` 复核文件名）。

## 关键陷阱

- Group4 `$LicenseTargets` 含 `.../desktop/electron` 目录，而源文件是 `license/license-manager.js`；`Sync-Group` 用 `Split-Path $file -Leaf` 展平 → `electron/license-manager.js` 是副本。五处同名文件哈希一致即共享同一份 Node 端权威源。
- sync-all 对漂移副本执行 Copy-Item 静默还原，输出 `[SYNC] <path>`；改完副本跑它等于白改。

## 热更白名单 14 文件（generate-app-hotupdate.cjs；改动必须 APK+热包同步发）

`index.html`、`auth-core.js`、`permission.js`、`normalize-config.js`、`debug-logger.js`、`print-utils.js`、`medicine-dict.js`、`symptom-dict.js`、`performance-utils.js`、`prescription-core.js`、`stock-core.js`、`voice-input.js`、`vendor/pinyin-pro.min.js`、`vendor/xlsx.full.min.js`。

不在白名单（只随整包）：`license/license-manager.js`、`license/feature-guard.js`、所有 .cjs 主进程模块、Java 代码。

## 关键远端/命令速查

- 线上热包版本：`https://tcm-prescription-system.pages.dev/hot-update/app-local/version.json`
- 热包目录：`public/hot-update/app-local/`（version.json 含 Ed25519 signature + 每文件 sha256）
- 构建 cwd：`app_project/db-offline/app`，命令 `.\gradlew.bat :app:assembleRelease -x lint --console=plain`
- APK 产物：`app_project/db-offline/app/app/build/outputs/apk/release/app-release.apk`
- 分发固定名：`app_project/db-offline/惠康中医-v<N>免费版测试包.apk`、`app_project/db-offline/惠康中医-本地.apk`
