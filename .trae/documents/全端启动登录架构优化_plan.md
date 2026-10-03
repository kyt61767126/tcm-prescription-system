# 全端启动/登录速度架构优化实施计划

> 2026-10-02｜范围：离线桌面 / 云桌面 / 云 Web+云APP / 离线APP 四端
> 基线：离线桌面 1.0.267（已完成两轮提速）、云桌面 1.2.261、离线APP vc312、云APP vc311
> 性质：**授权链/付费墙邻接改动**，全程守 `.trae/KNOWLEDGE.md`（§52/§52.1/§52.2/§52.3），权威源→sync 分发→VerifyOnly→双独立子代理审查→check-interface→精确 git add→build.bat。

---

## 一、研究结论（证据基线）

### 1.1 方法
- 两个独立子代理完成四端静态走查（全部结论带 文件:行号 证据）。
- dev Electron（Playwright + E2E 旁路 + 隔离 userData）真机分段墙钟打点，2026-10-02 实测。
- **实测确认**：fused 最终产物（dist\win-unpacked）关闭了 Inspect/调试管道，Playwright 永久 180s 超时（build.bat L247-251 注释明示，E2E 只能跑 pre-fuse 中间产物）。最终产物的自动化打点只能在 pre-fuse exe 上做；dev Electron 代码路径与最终产物一致，相对对比有效。

### 1.2 离线桌面实测数据（本机，dev Electron）

| 场景 | 双击→登录窗可输 | 点击登录→主界面遮罩消失 |
|---|---|---|
| 全新 userData 首启 | **786~799ms** | 快击 5996ms（首启含夹具填栏+弱哈希升级） |
| 稳态冷启 | **316~366ms** | 快击 **2269ms**（时间轴见下） |
| 稳态+真人节奏 | 同上 | 此前手工实测 **170~480ms**（预热全部完成时） |

稳态快击时间轴（perf3，ms）：loginReady 261 → 预建主窗 index.html 可见 1083 → 主窗 parse 完成 1322（仅 239ms，overlay=flex 未登录态）→ click 1630 → 遮罩消失 3899。

**结论**：
1. 登录窗弹出（0.3~0.8s）与预建主窗 parse（0.24s）已不是瓶颈；
2. **快击场景点击后仍有 ~2.3s**，其中预建窗在点击前 308ms 已就绪 → 全部在登录提交链：渲染层 PBKDF2 60 万轮（本机微基准 **118~124ms/次**，慢机 2~4 倍）、弱哈希升级触发主进程 **2 次** pbkdf2Sync（~240ms，慢机 0.5~1s）、verify-gate（validateLicense 重读+试用档 vault 冷读等待在途预热）、第二次完整 get-app-config IPC（handler 内再跑 validateLicense+readLicense）、loginSuccess 写盘、reveal 重跑 checkLoginStatus（含 checkSession/getCurrentUser/loadData）；
3. 真人输密码 3~8s 时预热全部完成，故体感已 170~480ms——**优化价值在慢机、快击、冷 vault 三重叠加的下限**，以及云桌面/Web/APP 的更大欠账。

### 1.3 四端欠账对照

| 优化能力 | 离线桌面 | 云桌面 | Web/云APP | 离线APP |
|---|---|---|---|---|
| 裁决/机器码 setImmediate 预取 | ✅ | ❌ | — | — |
| vault PS 预热后移 show 后门闩 | ✅ | 无需 vault | — | — |
| 预建隐藏主窗 + reveal | ✅（shared 已就绪，云 main.js 未接线） | ❌（**shared 零改动即可移植**） | — | — |
| reg-gate sendSync 快道 | ✅ | 无需 | — | — |
| 登录点击链串行 IPC/网络 | 残余 2 处（见 A2/A3） | **最坏 3 次串行 /users 冷 RTT（0.5~3.8s/次）** | config.json 同步 XHR 每冷启 1 RTT | 主线程 864KB JS 完整性哈希 |
| whenReady 窗前串行网络 | 试用登记（最坏 5s，专项处理） | **未激活 checkAdminStatus 最坏 10s 无窗** | — | — |
| 冷 Worker/TLS 预热 | 裁决已预取 | ❌（共享 telemetry 在 +1.5s 才发） | — | — |
| 静态资源缓存 | file:// 无此问题 | file:// 包内 | ✅ cv+immutable 已做 | ✅ 本地 assets |

已核实的关键事实：
- `shared/desktop-windows.cjs`、`shared/license/license-manager.js` 双端 MD5 等体，云桌面缺的只是 main.js 接线。
- 云桌面 license 心跳在渲染层 cloud.js `performHeartbeatCheck`（auth-core.js L2544+），主进程无需补 startHeartbeat。
- 云 preload.js L188-252 与离线 preload.js L238-302 均存在 bootstrapForceCloudToken **IIFE 重复嵌套**（每窗多 1 次 config:get-force-token + 6 项存储写）。
- 离线 APP `MainActivity.onCreate` 主线程：SecurityGuard（mainHandler.post 仍在主线程）+ `verifyJsIntegrity()` 每次冷启流式哈希 auth-core 563KB+license-manager 301KB；无自定义 Application；System.exit(0) 退出=次次冷进程。
- 云 APP 主线程 `InetAddress.getAllByName` DNS 预解析（StrictMode 违例，弱网 ANR 尖峰）。
- 热更白名单：桌面/APP 均不含 electron 主进程、.cjs、.ps1、config.json、license/* —— **A/B/D 批全部必须重发版**；C 批（public/）push/热包即达。

---

## 二、实施方案（四个批次，按 ROI/风险排序）

### 批次 A：离线桌面 1.0.268（一次构建收口）

| # | 改动 | 文件锚点（权威源→分发） | 预计收益 | 风险 |
|---|---|---|---|---|
| A1 | **isVirtualMachine 检测后移**：validateLicense 首调的 4 次 wmic execSync（结果仅 console.warn、**无任何安全消费者**）改登录窗 show 门闩后异步执行，保留 `_vmCheckCache` 语义 | shared/license/license-manager.js L2483-2602 → sync-all G4（4 副本） | Win10 老机/杀软 0.4~2s，最坏 8s；Win11 ~160ms | 低（无消费者，语义零变化；走授权链流程） |
| A2 | **弱哈希升级延后**：login.js L737-749 renameUser（主进程 2×pbkdf2Sync）改为 loginSuccess reveal 之后 fire-and-forget，失败保留下次重试 | db-offline/desktop/electron/login.js（端内独有） | 旧哈希/明文账户每次登录 -240ms（慢机 -0.5~1s）主线程 | 中（密码写点；本次登录已过，仅影响下次；保留重试） |
| A3 | **消灭点击路径第二次 get-app-config**：①login.js L763 改用本地缓存 getAppConfig()，renameUser 升级成功后令缓存失效重取一次；②主进程 get-app-config handler（main.js ~L1420-1477）复用 `global.__bnzcLicenseStatusCache`，删除紧接的重复 readLicense；installLicense/签名翻转点主动刷缓存 | login.js + main.js（均端内） | 每次登录 -1 轮 validateLicense+readLicense，削平主线程突发 | 中（缓存失效点要齐：installLicense/trial 翻转/configUsersProvenAuthentic） |
| A4 | **bnzc-debug.log 收口**：extractBnzcFromArgv 每启动固定 3 次 appendFileSync（main.js L632/L664/L728 等 8 处）改为仅命中 bnzc 参数时写，或并入 electron-logger 异步追加 | main.js（端内） | 每启动 -3 次同步 open/write/close（机械盘/杀软更明显） | 极低 |
| A5 | **删除 preload 重复 IIFE**：preload.js L238-302 内层重复嵌套整段删除（动前先 git log 确认非热替换占位） | db-offline/desktop/electron/preload.js；**同款云端 preload.js 随 B 批一起改** | 每窗 -1 次 IPC+6 项存储写，修复缺陷 | 低（token 注入链需回归云处方历史） |
| A6 | **预建主窗提前**：登录窗 show 后固定 400ms setTimeout（main.js ~L783）改为 show 即刻发起（与 50ms prewarm kick 同拍或直接并入） | main.js setLoginWindow 注入器 | 慢击无差；快击多拿 ~400ms 预建余量，降低 reveal 15s 回退概率 | 低 |
| A7 | **登录窗初始化重排**：login.js DOMContentLoaded（L822-878）事件绑定/initLoginInput 提前到首个 await 前；getAppConfig 与 checkBnzcPendingActivation 并行；updateLoginActivateHint 的 getStatus 合并 A3 缓存 | login.js（端内） | 输入可交互提前 20~100ms | 低 |
| A8（可选） | **whenReady 小 IO 重排**：migrateLegacyDataToCentral 与 ensureWritableConfig/ensureEditionSelected 在保持"config 就绪先于开窗"依赖关系下并行化；validateLicense 结果提前产出 reg-gate 缓存 | main.js L1057-1096 | 常态 -100~300ms | 中（授权邻接，若评审有争议则本期不做） |

### 批次 B：云桌面 1.2.262（ROI 最高，shared 层零改动，一次云构建）

| # | 改动 | 锚点 | 预计收益 | 风险 |
|---|---|---|---|---|
| B1 | **预建隐藏主窗接线**：云 main.js 工厂注入补 setLoginWindow 钩子（移植离线 L751-798）；login-success（L908-922）冷建 createMainWindow 改 revealMainWindow，回退路径保留 | db-yunduan/cloud_desktop/electron/main.js（端内） | 点击→主窗 -300~500ms | 低-中（核对主窗 checkLoginStatus 与 token 时序） |
| B2 | **pages.dev 冷连接预热提前**：登录窗 show 即刻发起（当前共享模块 +1.5s 才动）——渲染层 login.html 注入 `<link rel="preconnect">` 或主进程 show 钩子 net.fetch 轻端点 | cloud main.js 或 electron/login.html | 点击登录 -0.5~3s（冷 Worker 2.1~3.8s） | 低（纯预热不改裁决） |
| B3 | **机器码 setImmediate 预取**：仿离线 L30-60，whenReady 前先读名单+getMachineId+裁决在途 | cloud main.js L647-688 | 慢机开窗 -100~500ms | 低 |
| B4 | **未激活 checkAdminStatus 后移**：L739-813 的 10s 超时网络等待移到 createLoginWindow 之后（先见窗，结果回来再按现有激活链收口） | cloud main.js | 消灭最坏 10s 无窗 | 中高（激活装号链，license-chain-release 专项审） |
| B5 | **登录串行网络合并**：①L788 clinic_admin 角色补登录——利用首次登录响应已带 clinicEdition 跳过/合并；②L829 token 补拉合并进首次 login（一次 /users 拿全 token/edition/clinicId）；③getAppConfig 收敛一次内存缓存；④route.prescriptions 处方预取贯通主窗（参照 public/index.html L3048-3052，含清旧值防串号） | cloud_desktop/electron/login.js | -1~2 个冷 RTT（0.5~3s+），入主界面 -0.5~1s | 中（认证链+跨用户串号防御） |
| B6 | **get-app-config handler 去写盘**：L944-952 每次调用 backupUserAccounts 移除（仅在真实变更点写） | cloud main.js | 每登录 -1 次签名写盘 | 低-中 |
| B7（排除项） | 心跳已在 cloud.js 渲染层，主进程不接线；reg-gate 云端无 maybePromptRegistration，不需要 | — | — | — |

### 批次 C：Web/云APP（push 即达，不耗版号，独立小批）

| # | 改动 | 锚点 | 收益 | 风险 |
|---|---|---|---|---|
| C1 | **config.json 同步 XHR 去同步化**：public/index.html L2013-2035（`xhr.open(...,false)`）改启动早期异步预取+await 点接入，或构建期注入占位 | public/index.html 权威源 → tools/sync-html.ps1 6 副本 | 冷启解析期 -1 RTT（100~500ms），web+云APP+云桌面渲染同惠 | 中（CONFIG 被多处依赖，需梳理解析时序；check-interface 前后必跑） |

### 批次 D：双 APP 原生层（随 APK 排期，license-chain-release 审查）

| # | 改动 | 锚点 | 收益 | 风险 |
|---|---|---|---|---|
| D1 | 离线APP SecurityGuard `mainHandler.post` 改真后台线程（对齐云APP L214 写法） | db-offline/app MainActivity.java L176 | 首帧 -50~200ms | 低 |
| D2 | verifyJsIntegrity（864KB 双 SHA-256，L3340-3383）移到 splash 之后；篡改判定保留"退出/封功能"硬语义但延迟执行 | MainActivity.java L282 | 启动 -30~100ms（慢机更多） | **高（付费墙/完整性根），需专门安全设计评审** |
| D3 | 新增 Application 类，后台线程预热 WebView/Chromium 内核 | app AndroidManifest + 新类 | 冷启 -100~300ms（估算） | 中（Capacitor 兼容实测） |
| D4 | 云APP DNS 预解析移后台线程 | cloud_app MainActivity.java L223-230 | 消除弱网 ANR 尖峰 | 低 |
| D5 | stock(70KB)/analytics(32KB)/symptom(73KB) 首屏不需要，改 idle 动态加载 | 离线 index.html + 热更白名单内业务 JS | 解析期 -100~250ms | 中（界面铁律；白名单内可先发热更验证，Java 不碰） |
| D6 | video-recorder.js 404 修复：assets 补文件或 Java 注入从 onPageFinished+300ms 提前到 onPageStarted | MainActivity.java L760 | 小 | 低 |

### 列档本期不做（已评估风险/收益不匹配）
- **试用登记网络后移开窗**（离线 main.js L1131，最坏 -5s）：denied 状态当前决定"到期弹窗 vs 登录窗"，后移需重新设计 verify-gate 对 pending 登记的等待与 denied 落盘消费——做独立专项，不与本批同船。
- 硬件指纹 2 次 wmic 异步化：参与密钥派生/机器绑定，授权之根，不动。
- hot-update resolveEntry 全量哈希 worker 化：热更三道验签门禁，仅热更机偶发，不动。
- self-check asar 全量哈希延迟：篡改暴露窗口，安全侧不点头不动。
- index.html 内联数千味药材数据外移：预建窗已吸收 parse 成本，收益小且触结构铁律，不做。
- Service Worker 预缓存壳：当前无 SW，属新体系，单独立项。

---

## 三、多端同步与生效方式

| 改动 | 权威源 | 同步命令 | 副本影响 | 生效 |
|---|---|---|---|---|
| A1 | shared/license/license-manager.js | sync-all.ps1（G4 license 三文件 4 目标） | 双端 electron×2 + APP assets + 其他 | 离线重发 exe（APP 不用 VM 检测，随其版本自然带） |
| A2/A3/A4/A6/A7 | 离线 main.js/login.js | 无（端内独有） | — | exe |
| A5/B 云 preload | 两端 electron/preload.js 各自独有 | 无 | — | 两端分别重发 |
| B1-B6 | 云 main.js/login.js | 无 | — | 云 exe |
| C1 | public/index.html | sync-html.ps1 | 6 份 HTML | push Pages + 云桌面热包；离线两份 index.html 独立维护不受影响 |
| D 批 | 两端 Java | 手工分叉无脚本 | — | APK |

---

## 四、验证

1. **打点固化**：将本轮临时打点脚本提炼为 `e2e/perf-startup.cjs`（正式文件），指标 `loginReady`、`click2ready`（遮罩消失口径）、预建窗 parse 三段；pre-fuse 中间产物可直连，dev 模式支持对比。每批改动前后各跑 ≥3 轮取中位数。**授权端点限流（本轮实测 HTTP 429）：脚本两次启动间隔 ≥15s，总裁决调用受控，避免污染结果/触发风控。**
2. `node --check` 全部改动 JS；sync-all/sync-auth-core/sync-html `-VerifyOnly` exit 0。
3. C1 前后跑 check-interface.bat（6 OK），禁止改 HTML 结构。
4. **双独立子代理审查**（安全视角 + 时序视角），A1/A3/B4/B5/D2 为必审重点。
5. 离线：build.bat 全流程 pre-fuse E2E 6/6 + fuse/签名/PE-Zone + 十三道校验 + 93 冒烟；云：云桌面构建+手工登录冒烟（冷 Worker/预建窗/处方预取）。
6. C1 push 后实测 Pages 冷启（config 不再阻塞解析）+ 云APP 真机一轮。
7. 真机回归清单：付费机登录、试用机登录、free 机登录、旧哈希账户登录（升级后下次直接进）、无手机号注册引导、断网登录、X 关窗进程零残留、云端处方历史（A5 token 注入链）、多用户切换。

## 五、风险与回滚
- 每项独立 commit，可单独 revert；批次内不改裁决条件/付费墙判定逻辑（A1 仅移除无消费者调用、B2 纯预热是已验证安全模式）。
- 授权敏感项（A1/A3/B4/B5/D2）一律 license-chain-release 流程：双审不过不构建。
- 失败构建消耗版号：A 批目标 1.0.268 一次构建；B 批云桌面一次构建；C 批零版号；D 批随各自 APK 节奏。
- 完成后结论沉淀 KNOWLEDGE.md（新增 §52.4 全端架构优化与打点方法论）。

## 六、建议执行顺序
1. **批次 A**（离线 1.0.268，本机可立即做、可量化、风险可控）；
2. **批次 C**（小而快，push 即达，覆盖面广）；
3. **批次 B**（云桌面，绝对收益最大，一次云构建）；
4. **批次 D**（随双 APP 下个版本排期，D2 先做安全设计评审）。
