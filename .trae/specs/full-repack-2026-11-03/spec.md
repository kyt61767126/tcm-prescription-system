# Spec · 整包重打 + 真机冒烟（2026-11-03）

> 用户已批准执行。本规格记录**已完成的构建/抽查事实**与**剩余冒烟的可执行方案**，供确认后继续。
> 铁律：不提交、不推送整包产物；不改热更清单；除 versionCode/minAppCode 外不动无关配置。

## 1. 目标与范围

对五端产物整包重打，并在本机可执行范围内做真机/接近真机冒烟，明确区分「已实测」与「受阻」。

| 端 | 源目录 | 构建入口 | 产物 |
|---|---|---|---|
| 云端桌面 exe | `app_project/db-yunduan/cloud_desktop` | `tools/one-click-pack.ps1 -AutoMode 1d` | `dist/` portable + Setup |
| 离线桌面 exe | `app_project/db-offline/desktop` | `-AutoMode 2d` | `dist/` portable + Setup |
| 云端 APP APK | `app_project/db-yunduan/cloud_app` | `-AutoMode 1a` | `app_project/db-yunduan/惠康中医-云端.apk` |
| 离线 APP APK | `app_project/db-offline/app` | `-AutoMode 2a` | `app_project/db-offline/惠康中医-本地.apk` |
| 鸿蒙 HAP | `app_project_harmony/huikang-cloud` | hvigor `assembleHap` + `hap-sign-tool localSign` | `entry/build/default/outputs/default/huikang-cloud-release-signed.hap` |

## 2. 已完成（事实，不可重复执行）

### 2.1 前置门禁（全绿）
- `node tools/pre-build-check.js app_project/db-yunduan/cloud_desktop` → PASS
- `node tools/pre-build-check.js app_project/db-offline/desktop` → PASS
- `powershell -File tools/sync-all.ps1 -VerifyOnly` → ALL PASS
- `powershell -File tools/check-interface.ps1` → 6 OK（界面锁零变更）
- `node tools/copy-consistency.cjs` → 110/110
- `node tools/check-cv-hashes.cjs --verify` → 15/15

### 2.2 构建结果
- 云端桌面：`1.2.287`；portable `81,765,152 B`、Setup `82,040,056 B`；FINAL IRON GATE / fuses / 签名 / fused smoke 全 PASS。
- 离线桌面：`1.0.310`；portable `79,153,640 B`、Setup `79,428,600 B`；同上全 PASS。
- 云端 APK：versionCode `350`，`12,621,157 B`。
- 离线 APK：versionCode `344`，`3,774,086 B`。
- 鸿蒙 HAP：unsigned `3,001,506 B` → 签名 `3,041,346 B`（versionCode 保持 1000000，未上调）。

> 版本漂移门禁：因按要求**不提交**，首个构建产生的版本号即成为未提交漂移；后续构建使用既有逃生口 `ALLOW_VERSION_DRIFT=1`，仅绕过提示、不修改任何配置。

### 2.3 解包抽查（逐文件 SHA-256 与源目录一致）
五端产物内均含以下文件且 `index.html` 命中 `__quizMobileTopBtn`：
- `index.html`
- `quiz/manifest.js`
- `quiz/quiz-core.js`
- `quiz/data/sb-1200.js`
- `quiz/data/by-426.js`

抽查方式：桌面用 `@electron/asar.extractAll` 解包后取哈希；APK/HAP 用 `System.IO.Compression.ZipFile` 直读条目并哈希；两端 APK 均校验 `assets/public/**`，HAP 校验 `resources/rawfile/**`。

## 3. 剩余执行（冒烟，需批准后执行）

### 3.1 源页面响应式与角色例外（复用既有脚本）
- 运行 `node tools/_tmp/verify-mobile-quiz-entry.cjs`：12 组合（云端/离线 × 375/768 × 医生/收费员等），断言顶部按钮数量/顺序、点击打开题库、关闭返回、无溢出、`pageerror=0`。基线为 164/164 通过。

### 3.2 热包 2026.11.02-3 应用后 Electron 实启
- 使用 dev Electron：`app_project/db-offline/desktop/node_modules/electron/dist/electron.exe`，cwd 为离线桌面目录，args `['.']`。
- 临时在 `node_modules/electron/dist/e2e-enabled.marker` 写标记，`BNZC_E2E=1` + `BNZC_E2E_DATA=<临时隔离目录>`，跑完删除标记。
- 预先把 `public/hot-update/desktop/local/{index.html,quiz,*.js}` 与 `version.json` 复制到 `<隔离目录>/hot-update/current/`，使 `resolveEntry()` 命中热包；用 Playwright `_electron` 断言窗口 URL 含 `hot-update/current/index.html`。
- 断言项：题库入口出现、两个题库可浏览、抽卷并评分、`?v=1.0.1` 在 `file://` 下无 404、375/768 顶栏「题库」可见可点、收费员云端隐藏/离线保留「保存」、`pageerror=0`、`console error=0`、无 404。

### 3.3 新装包 file:// 内置题库
- 对已解包目录 `C:\Users\61767\AppData\Local\Temp\kyt-asar\{cloud,offline}` 以 `file://` 加载 `index.html`，模拟登录后断言：`#__quizTopTab` 出现、`quiz/manifest.js` 与 `by-426.js?v=1.0.1` 加载 200（file:// 无 200 时以无 404 + 模块可用为准）、两题库列表可见、抽卷评分正常。
- 证明内置包不依赖热更（隔离目录中不存在 `hot-update/`）。

### 3.4 回退验证
- 运行 `node tools/_tmp/smoke-hot-update.cjs`：内置双版本夹具，验证回退到 `previous` 后 `resolveEntry` 恢复上一版、拉黑坏版本、可正常启动加载。
- 若脚本不可用，则用 `hot-update-core` 直接构造 current/previous 双目录，`rollbackLocal()` 后断言 `resolveEntry()` 返回 previous 文件路径。

### 3.5 真机（预计受阻，如实标注）
- Android：`adb devices` 无设备 → 标「受阻：缺 Android 真机」。
- 鸿蒙：无 DevEco 签名安装设备 → 标「受阻：缺鸿蒙真机」。
- 联网热更下载链路：不做线上轮询（用户本轮要求不发布），标「受阻：本轮不联网验证」。

## 4. 验收标准
- 3.1–3.4 全部实跑，输出断言统计与截图路径；任何 `pageerror/console error/404` 非零即失败并记录真因。
- 受阻项必须写明缺什么设备/环境与影响面，不得用模拟结果冒充真机。
- 最终汇报中文 Markdown，先结论后证据；不贴大段代码；不提交、不推送。

## 5. 变更与产物处置
- 本轮产生的版本号变更与 build-meta 均为**未提交工作区变更**，保持不提交。
- 整包产物（dist、APK、HAP）按用户要求不纳入提交；如需入库另行确认。
