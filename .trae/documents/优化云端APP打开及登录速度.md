# 优化云端APP打开及登录速度 — 实施计划

## 一、摘要

云端APP（Capacitor 壳 WebView 实载 `tcm-prescription-system.pages.dev`）每次冷启动**全量重新下载约 1MB 静态资源**（index.html 637KB + auth-core.js 317KB + 11 个业务 JS），根因是三层"防旧页面"机制叠加把缓存彻底废掉；登录 API 关键路径上串行执行审计日志、失败计数清理等非关键 KV/D1 写操作。本计划分四阶段：**① 内容哈希 cv + immutable 长缓存（网页+APP 打开提速核心）→ ② 移除每次启动清缓存（需重打云APP APK）→ ③ 登录 API 非关键写 waitUntil 化 → ④ 智能打包热包路径误报修复（遗留待办）**，并以 push 门禁杜绝"忘 bump cv 导致更新不生效"的历史教训复发。

## 二、现状与瓶颈（已探明，带证据）

### 2.1 打开速度：每次冷启动全量下载

启动链：`MainActivity.onCreate` → 显示原生蓝色遮罩 → `webView.clearCache(true)`（L356，**每次启动清掉全部 HTTP 磁盘缓存**）→ `loadUrl(CLOUD_URL + "?_v=" + 时间戳)`（L373，**HTML 缓存键每次必变**）→ HTML 下载（637KB，brotli 后约 100-150KB）→ `config.json` 同步 XHR（L837-842，DOM 解析期阻塞一个 RTT）→ 13 个业务 JS（`_headers` 中 `/*.js` 为 `max-age=0, must-revalidate`，本可 304，但被 clearCache 清光后**全部 200 全量重下**）→ 首帧脚本置 `__firstFrameReady__` → 原生遮罩揭幕。

- clearCache(true) 是 2026-08-23 为治"线上更新不生效"加的；时间戳 URL 是 2026-09-10 为治"清缓存异步竞争窗口"加的。两刀叠加后：**每次打开 = 无任何缓存可用**。
- `_headers` 全部业务 JS `max-age=0` 本意是 304 极速校验，但缓存每次被清，304 从未生效。

### 2.2 登录速度：API 关键路径串行非关键写

登录必走云端权威（本地表 password 留空，见 index.html L1749-1750 注释）：`/api/users?login=true` → 服务端 `checkIpRateLimit`（KV 读+写）→ `checkLoginLocked`（KV 读）→ `findUserForLogin`（D1/KV）→ `verifyPassword` PBKDF2 10 万次迭代（防枚举必需，不动）→ 密码通过后 **`await clearLoginFailures`×2（L1565-1568）+ `await writeAuditLog`（L1613，D1 insert + KV put）** 串行执行完才返回响应 → 客户端 `loginOverlay` 隐藏进入操作界面。非关键写合计约 50-150ms。

### 2.3 智能打包误报（遗留待办①）

`tools/build-skip.ps1` L31-36：cloud-desktop / cloud-app 的 sources 含 `public`，而 `public/hot-update/*`（热包发布产物）不在 `$sideEffectPatterns`（L54-66，已有 `^public/downloads/`、`^public/updates/` 先例）→ 纯热包发布后云端两端被误判需重打。本次优化要重打云APP APK，须先修此误报。

## 三、改动方案

### 阶段 1：site 侧缓存优化 + 门禁（云端网页立即受益；对现有 APP 无害）

**1a. 新建 `tools/check-cv-hashes.cjs`（cv 哈希工具 + 校验门禁）**

- 内置目标清单：`public/index.html` 中 13 个 script 引用（12 个根级 JS + `electron/video-recorder.js`）：
  `auth-core.js, permission.js, normalize-config.js, debug-logger.js, print-utils.js, medicine-dict.js, symptom-dict.js, cloud-api.js, performance-utils.js, prescription-core.js, stock-core.js, security-guard.js, electron/video-recorder.js`
- 哈希 = `crypto.createHash('sha256')` 对 `public/<file>` 字节取前 8 位 hex。
- 改写规则（`--update` 模式）：`src="X.js?cv=任意"` 或 `src="X.js"`（video-recorder 现为 `?v=20260817d`，统一改为 `?cv=`）→ `src="X.js?cv=<sha8>"`；幂等（重复运行零改动），UTF-8 无 BOM、LF 写回。
- 校验模式（默认）：任一 cv ≠ 当前文件哈希 → exit 1，输出待 bump 文件与修复指引。
- **不碰** `public/hot-update/**`（已发布热包快照）与 `public/electron/login.html`（其相对引用解析到 `/electron/*.js` 副本，与根级文件不同路径，不受影响——已验证 `public/electron/` 下有全套独立副本）。

**1b. `public/_headers` 调整**

- 13 个精确路径规则（替换现有 `/symptom-dict.js` 86400 规则；`/electron/video-recorder.js` 原 max-age=0 条目升级）：
  ```
  /auth-core.js
    Cache-Control: public, max-age=31536000, immutable
  （…其余 12 个同款，含 /symptom-dict.js、/electron/video-recorder.js）
  ```
- 保留 `/*.js → max-age=0, must-revalidate` 兜底（继续覆盖 `/electron/` 其它副本、`/hot-update/**`、admin 资源）。精确规则优先于通配是 CF Pages 既有行为（现有 symptom-dict 86400 规则已在用此机制）。
- 注释更新：说明"内容哈希 cv 自失效，immutable 安全；根因参见 2026-08-20 教训（当年是 max-age=86400 无内容哈希才卡旧版）"。

**1c. 首次执行**：`node tools/check-cv-hashes.cjs --update` → `tools/sync-html.ps1`（cv 变更传播到云桌面/云APP assets 两副本）。

**1d. 门禁接线**

- `.githooks/pre-push` 新增 ⑪（十一道门）：`node tools/check-cv-hashes.cjs` 失败 → 提示"业务 JS 内容变更后必须 `--update` 重刷 cv，再跑 sync-html.ps1 传播副本"。
- `.github/workflows/verify-unified.yml` 新增 `8/8 cv hash consistency` step（仿 7/7 结构）。

**1e. `tools/build-skip.ps1` 误报修复**：`$sideEffectPatterns` 数组追加 `'^public/hot-update/'`（与 `^public/downloads/`、`^public/updates/` 同性质同位置，L54-66）。

**标准工作流（沉淀进 KNOWLEDGE）**：改 shared/ 权威源 → `sync-all.ps1`（刷新 public/*.js）→ `check-cv-hashes.cjs --update`（bump cv）→ `sync-html.ps1`（传播 HTML 副本）→ push（十一道门全绿）。

### 阶段 2：MainActivity 移除每次清缓存（需重打云APP APK）

`app_project/db-yunduan/cloud_app/app/src/main/java/com/tcm/prescription/MainActivity.java`：

- **删除** L356 `webView.clearCache(true);` 及其日志行，注释改写为：HTML 由时间戳 URL 每次必拉最新（L373 不变）；业务 JS 由内容哈希 cv + immutable 自失效（URL 变=缓存键变=必拉新），无需清缓存；localStorage 不受影响（本来就没清）。
- `setCacheMode(LOAD_DEFAULT)`（L362）、时间戳 loadUrl、`onPageStarted` 重定向逻辑全部保留。
- 完成后重打云APP APK（versionCode 自动递增）；已装机用户经应用内轻量更新横幅（hash-manifest 检查→APK 直链下载）升级。

### 阶段 3：登录 API 非关键写 waitUntil 化

`functions/api/users.js` 登录端点（L1387 起）内：

- `await clearLoginFailures(...)`（L1565、L1567）→ `context.waitUntil(clearLoginFailures(...))`。
- 登录端点内全部 `await writeAuditLog(...)`（L1448、L1476、L1489、L1502、L1515、L1586、L1613、L1642 等登录路径上的）→ `context.waitUntil(writeAuditLog(...))`。writeAuditLog 内部全量 try/catch 不抛错，waitUntil 安全。
- **保持 await 不动**：`checkIpRateLimit`（限流读改写需原子）、`checkLoginLocked`、`findUserForLogin`、`verifyPassword`（PBKDF2 防枚举必需）、`signToken`、设备绑定/额度预检读写（授权正确性）、P0-11 哈希升级写。
- 此改动属登录高风险链路：完成后按 KNOWLEDGE 模型矩阵跑独立审查（Pro 审查 + 安全二查），并跑 `tools/probe-param-matrix.cjs` 确认 14 断言不回归。

### 阶段 4（评估结论，本轮不做）：本地 assets + 热更方案

cloud_app WebView 远程加载、本地 assets 仅打包兜底；本地化需：MainActivity 切本地 assets + 云端 Functions 全量 CORS（当前未放行 `https://localhost` Capacitor Origin）+ 云APP 专属热更通道。工程量大、收益与阶段 1+2 重叠，**定性为后续远期方向，本轮不做**。

## 四、验证步骤

1. **本地门禁全绿**：`check-cv-hashes.cjs --update` → `sync-html.ps1` → `html-sync-check.ps1` ①、`check-interface.ps1` ④（body 哈希只取 `<body>` 到首个 `<script`，cv 改动在区域外，已确认安全）、`diff-cross-version.cjs` ⑩ 三对、其余十道门 + 新 ⑪。
2. **users.js**：`node --check functions/api/users.js` + probe-param-matrix ⑥ 全过。
3. **部署后线上验证**：`curl -sI https://tcm-prescription-system.pages.dev/auth-core.js` 确认 `cache-control: public, max-age=31536000, immutable`；`/` 确认 `no-cache, must-revalidate`；首页 HTML 中 13 个 script src 均带 `?cv=<8位>`。
4. **二次打开验证**（新设备/清数据后连开两次）：远程调试或抓包确认第二次启动 JS 命中缓存（200 from disk cache，无网络传输），HTML 仍全量拉最新。
5. **登录验证**：真机登录成功/失败各一次（失败路径审计也 waitUntil 化，确认错误提示、锁定计数不受影响）。
6. **智能打包**：阶段 2 重打 APK 前跑 `[4] 预览`，确认纯热包路径不再触发云端两端重打标记。

## 五、生效方式

- **云端网页**：push 即部署生效（immutable 缓存 + 登录 API 提速立即受益，刷新两次后第二次秒开）。
- **云端APP**：页面与缓存头改动随部署即时下发；**「移除每次清缓存」需重打 APK**（versionCode 递增），已装机用户经应用内更新横幅升级后，二次打开起 JS 走本地缓存。
- **云桌面/离线桌面/离线APP**：页面加载不受影响（file:// / 本地 assets 无 HTTP 缓存）；云桌面/云端网页的登录经 waitUntil 化的 API 提速受益；离线端登录走本地不受影响。

## 六、风险与回滚

- **忘 bump cv = 卡旧版**（2026-08-20 教训的机制化复发路径）→ ⑪ 门禁 push 时强制拦截，失败信息含修复命令；CI 同步兜底。
- **hot-update 产物误缓存**：已规避——immutable 仅精确匹配根级 13 文件，`/hot-update/**` 与 `/electron/**`（除 video-recorder）仍走 `/*.js` max-age=0 兜底，热更新链语义不变。
- **回滚**：恢复 `_headers` 13 条为原样（`/*.js` 兜底规则一直在），cv 参数残留无害；MainActivity 恢复 clearCache 一行；users.js waitUntil 恢复 await。均为独立小改，可单项回滚。

## 七、执行顺序

阶段 1（1a-1e）→ 验证 1/3 → 阶段 3（users.js）→ 验证 2/5 → 阶段 2（MainActivity + 重打云APP APK，打包前验证 6）→ 各端生效方式提示 + KNOWLEDGE 沉淀（cv 工作流、十一道门、本计划结论）→ commit + push。
