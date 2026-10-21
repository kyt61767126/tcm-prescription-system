# 跨用户接力台账（HANDOFF）

> **本文件是不同 Trae 用户/账号间接力同一项目遗留任务的唯一交接源**，随 Git 共享。
> 任何账号、任何机器 clone 本仓库后：项目规则（`.trae/rules/project_rules.md`）自动注入 →
> 开工读 `.trae/KNOWLEDGE.md` → 读本文件 OPEN 任务，从最高优先级继续，无需口头交接。
>
> **铁律**
> 1. 本文件只放「未完成/进行中」任务；**完成即从 OPEN 删除并把结论沉淀进 KNOWLEDGE.md**，保持短小（每会话全量读）。
> 2. **禁止放密钥、token、密码、客户隐私**；环境凭据各机自备（见文末环境前置）。
> 3. 状态只认 Git：任务必须写明基线 commit / 关联 PR；工作区未提交改动不算交接。
> 4. 收工必须把本文件与代码**同批 commit+push**，否则下一账号看不到（规则见 project_rules.md「跨用户接力协议」）。
>
> 状态枚举：`OPEN`（待接） / `IN-PROGRESS`（注明账号@机器+开始日期，需 24h 心跳更新否则视为可重接） / `BLOCKED`（注明阻塞与所需人/物） / `DONE→已归档KNOWLEDGE`。

---

## 当前基线（2026-10-21 更新）

- **main HEAD：`83554069`（KNOWLEDGE §71 离线端授权分裂态沉淀）**，前序 `95f340e5`（v2026.10.21 Release）。工作区干净。
- **2026-10-21 登录框版本显示全端统一「离线版/云端版」（KNOWLEDGE §70，含晚间第二轮药丸布置统一，已入库）**：第一轮=两份 login.js 标签统一【离线版】/【云端版】+ `public/index.html` 补显示（已重打包并发布 v2026.10.21：云桌面 1.2.273 / 云APP 336 / 离线桌面 1.0.288）；第二轮（用户三截图验收：云APP 三行不居中、离线APP 327 一行式漏细分版）=`public/index.html` 两写入器补 `textAlign:center`+meta 一行式、离线 `desktop/index.html` 同构改造、**变换表 T10/T11 锚点重写**、sync-html+sync-index-app 重新分发。生效：云网页/云 APP 随 push 即达；**离线 APP 328 已重打并发布官网（v2026.10.21）**；云桌面/离线桌面登录窗已是目标样式，无需专门重打。
- **线上核验（2026-10-20）**：站点 `/` 的 index.html SHA256 = 本地 `public/index.html`（`3365fef1…`，逐字节一致）→ 网页/云 APP 已含修复、functions 随同次 Pages 原子构建生效；`/hot-update/desktop/cloud/version.json` = **2026.10.20-1（app 1.2.271）**。
- **2026-10-19 P40 收尾（历史）**：登录闸 NO_LICENSE 码错位自愈 + 热更 **2026.10.17-7** + 令牌幂等台账补写 + Java clinicName 透传入库；P40 真机已激活+登录闭环；**离线整包已构建（H7：exe 1.0.276 + APK 322，待发布/复测）**。
- **线上状态（已实测）**：
  - production 部署源=每次 push 的最新提交（**Pages git 构建自动部署已 Active**；本次直传 `0012e7a2` 与 git 构建 `f9e9ea16` 已等价验证，后续无需手动 wrangler）；app-local 热更 **2026.10.17-7**（minAppCode 288 继承；线上 version.json 实测，auth-core.js SHA256 `bb4dede2…45210` 与 manifest 逐字节一致，无 `DEBUG verifyLoginGate` 串）。
  - functions 已随部署更新（activation-token GET 405 / 坏码 POST 400 冒烟通过；令牌幂等台账补写 + validate 诊所名闸台账豁免均在线）。**git 构建配额可用 → 后续静态/functions 随 push 即达，wrangler 直传仅作配额耗尽/大文件超限兜底。**
  - **激活架构评审（2026-10-17）**：`.trae/documents/activation-architecture-review-2026-10-17.md`（六端 × 激活方式 × 版本全景 + P0/P1 问题清单 + O1-O7 优化建议 + S1-S4 路线 + 待拍板 5 项；见 OPEN H8）。
  - **P40 真机闭环（2026-10-17 晚，已实证）**：-7 热更生效（DEBUG alert 消失）→ 管理员激活框用 `BNZC-MG3B-…` + 手机号重新激活（预设诊所名经 `redeemedDevices` 台账豁免）→ KV 记录 `status=used、devices=[P40 mid]、productClass=offline、clientClass=app`，`entitlement(mid)=LICENSED（institution，永久）` → **登录正常**（license_log 有 `activate machineId=5784b5da...`）。此前 -7 后仍弹激活框的真因=上一会话手工重置码记录造成「本地有 license.dat / 服务端 unused」分裂，非客户端 bug。
  - **整包批次（2026-10-18，最新代码，已构建验包待发布）**：云桌面 **1.2.269**、云APP **versionCode 325**、离线桌面 **1.0.277**、离线APP **versionCode 323**；artifact-locate「各源一致，可发布」；版本副作用 AutoCommit `1ba4fdf1`；热更重签 desktop/local + desktop/cloud 均 **2026.10.18-1**（app 1.0.277/1.2.269）。**发布未执行**（需人工 `一键发布.bat` 或指示执行 `publish-release --changed-only --confirm --push`）。
  - **2026-10-18 邀请码"激活码不存在"修复**（离线桌面实锤 `BNZC-KLPF-…`：本地 license 有效但服务端无该码记录）：`invite.js` 在码查不到时凭 `machineId` 反查真实绑定码（device_version→license 索引），成功返回 `resolvedLicenseCode` 供客户端自愈；客户端 `loadInviteInfo` 统一带 `machineId`、自愈 `license:code` 并同步激活码显示、失败文案改"本机授权记录未同步"。热更：app-local **2026.10.18-3**、desktop/local **2026.10.18-2**。
  - **2026-10-18 取消免费版（产品决策）**：`claim-free` 端点返回 **410**（停止新发；存量 `type=free` 授权继续可用，登录闸/心跳豁免保留）；离线客户端版本页移除「🆓 永久免费版」按钮（改提示试用/购买）、注册引导去免费版；桌面激活窗 `activate-window.html` 隐藏免费按钮（**asar 内，需整包才生效**，旧包由服务端 410 兜底提示）；`download.html` 下架免费版卡片、功能对比表删除免费列、FAQ 改为"已停止发放/存量不受影响"。热更：app-local **2026.10.18-4**、desktop/local **2026.10.18-3**。
  - **2026-10-18 取消免费版后的离线整包（待发布）**：离线桌面 **1.0.278**（Setup 79,292,280B / 便携 79,017,312B，FileVersion 1.0.278）、离线 APP **versionCode 324**（3,577,561B，SHA256 `63C05F36…`）；`artifact-locate` 各源一致可发布；版本副作用 AutoCommit `c60d4852`。桌面原生激活窗的免费按钮隐藏**只在本包生效**（旧包由服务端 410 兜底）；发布后下载页=1.0.278/324。
  - **2026-10-18 淘宝发货卡片二维码修复工具**：新增 **`/download-card`** 卖家工具页（生成 `/d` 短链二维码、可下载 PNG 上传自动发货工具、一键复制不含 `{qrcode:…}` 占位符的发货文案）；新增 **`/d`** 302 跳转 `/download`。原因：自动发货工具不渲染 `{qrcode:链接}` 占位符 → 卡片只显示一行占位文本、无二维码；以后发货卡片：图片位上传本页 PNG、文字用本页文案。存量卡片把 `{qrcode:…}` 行删掉、保留链接即可。
  - **2026-10-19 离线桌面 1.0.280（激活三项优化，已构建验包，待发布）**：`eeb21f99` 三项优化 + `9f562fc3` 成功页 Tab 可见性修复。①登录页注册入口只留一个（删 login.js 红字入口，仅 auth-core 绿色「📝 注册开通」）；②注册成功页「我有激活码，立即激活」→ 激活窗 `?initialTab=code` 直达激活码输入界面（auth-core→preload→main→activate.js→activate-window 全链，官网付款入口无参保持原样）；③激活成功多设备「确定」框改为以激活窗为父窗 + 弹框期间临时取消 screen-saver 置顶（修「看不到确定框、激活无法完成」）。产物：`app_project/db-offline/desktop/dist/惠康中医-本地 Setup 1.0.280.exe` **79,307,632 B**（SHA256 `F3BA27695EBF67F113686BAA6B841AC71DFE8B1193C9D29C0DF05AB15499BF21`）、便携 `惠康中医-本地 1.0.280.exe` **79,032,752 B**（SHA256 `8E3A8473E8DF96234A2734E192BA72AA06F54F48ACDD1DF3996C58C40F111461`）；构建 7 道铁闸全过（E2E 6/6、铁闸8 26/26、铁闸8c 157/157、签名+smoke launch PASS）；独立验证 27 PASS/0 FAIL。**发布未执行**（人工 `一键发布.bat`）。
  - **2026-10-19 云端最新版「授权状态」不显示激活码/邀请码修复（`b167fd91`；desktop/cloud 热更 2026.10.19-1）**：客户电脑（云桌面 1.2.269）实锤 F1 授权区只显示「✅ 已激活（机构版）剩余 X 天」。根因①云端 auth-core 从未实现激活码常显（离线版 09-15 已有）；②邀请码卡片只认本地 `license:code`/`machineId`，老客户（管理员激活/换机重装/诊所改名/无 device_version）凭据失效且静默。修复：`invite.js` 可选账号态（Bearer 或 body.authToken→verifyToken→clinicId）三层兜底（诊所名索引→admin_phone 生产 JSON→license.phone 全扫）+ 缓存（阳性 1h/阴性 10min）+ 他所在册码归属拦截 + unused 过滤 + 索引安全回填；`cloud.js` 授权区新增「🔑 激活码」(点击复制)+「🎁 我的邀请码」，账号请求带本地码、仅本地无码时回写 license:code，失败回退旧路径。匿名行为逐字节不变。验证：终审 43 服务端+29 客户端+59 热更包全 PASS（0 阻塞）。**随 push 部署 functions + 网页 + 热更文件；客户云桌面下次启动自动拉热更（2026.10.19-1）后生效；旧客户端零回归。**
  - desktop/local 热更 **2026.10.18-3**、desktop/cloud 热更 **2026.10.19-4**、app-local **2026.10.18-4**（发布时三渠道版本表统一）。
  - **2026-10-19 离线正式版宽限 48h→30 天 + 云 APP/网页离线兜底壳**：①`entitlement.js` gate token 默认 TTL 由 48h 放宽到 **720h（30 天）**、钳制上限同步 720h（licExp 仍限制不超授权到期；吊销/删除最迟 30 天后生效——产品决策）；离线桌面/APP 正式版 **30 天内断网可登录操作**（试用/免费规则不变，客户端无需改动/重打包）。②新增 `public/sw.js` + `index.html` 尾部注册：云端网页/云 APP **首次在线访问后**缓存 App Shell（index+业务 JS+vendor），之后断网冷启动/刷新由 SW 回退缓存页——同源 localStorage/IndexedDB，离线登录缓存与本地处方同步队列可直接使用；API（/api/）、热更（/hot-update/）、管理端不缓存；静态资源网络优先、离线回退缓存；`/sw.js` 已加 no-cache 头。**无需重打 APK**（现有云 APP 联网启动一次即安装 SW）；首次安装/从未联网的极冷启动仍显示原生「网络异常-重新加载」页。验证：Playwright 本地静态服务+离线重载 8/8（注册/缓存/断网重载为真实 App Shell/API 不被壳兜底/恢复在线正常）。
  - **2026-10-19 云 APP 同步标识遮挡修复（客户截图：悬浮「☁️已同步」盖住底部导航/操作栏）**：移动端改为隐藏悬浮胶囊，在底部导航「设置」项右上角显示 8px 状态圆点（绿=已同步/橙=待同步 N/灰=离线/红=失败，`pointer-events:none` 不挡点击）；补传完成 toast、失败 5 分钟节流提示；桌面/宽屏仍保留可点击悬浮胶囊。验证：Playwright 桌面/移动双上下文 7/7（移动胶囊隐藏、导航圆点不遮保存按钮）。
  - **2026-10-19 云端版「断网可用 + 联网自动同步」一期 MVP（desktop/cloud 热更 2026.10.19-4）**：处方本地优先（IndexedDB 先落盘）→ `outbox` 队列 → 联网自动 pull 增量 / push 补传；删除墓碑同步、冲突保留「（冲突副本）」、幂等重试、状态徽标；服务端 `GET /api/prescriptions?sync=1&since=&limit=` 增量（data + tombstones + serverTime/nextSince/hasMore，角色过滤同旧 GET，D1 includeDeleted→KV 回退）；时间戳统一伪北京 UTC；永久删除墓碑（KV `clinic:{id}:prescriptions_permanent`）+ POST 拒绝重建（409 `PERMANENTLY_DELETED`），修「离线旧 upsert 复活永久删除处方」；修复现网「离线保存恢复网络后可能被增量落库清掉」缺陷。**灰度/回退**：默认 both（全量开启，一期无白名单）；回退用后台 `allowedMode='cloud'`（`local` 在网页/云桌面会被 auth-core 升为 both，不可作回退），或写 KV `config:cloud_offline_sync` = `{"mode":"off"}` 紧急总开关。**已知限制**：sync 每轮 D1 全表读（大诊所读放大，放量前建议 since SQL 下推/限频）；DB v4 升级时旧标签页需刷新（onblocked）；媒体文件不在一期。验证：独立验证 179/179 + 服务端自测 124 + 上线前审查（可放行）。
  - **2026-10-19 修复云 APP「每次同步弹库存预警」+ 同步时机重复扣库存（严重数据正确性）**：根因——`stock-core.js` 通过包装全局 `savePrescriptionToDB` 做库存扣减/预警（toast「⚠ 库存预警：…」），而云端离线同步拉取复用了这个业务保存函数 → **每轮 pull 都把云端处方当成本机新保存**：反复扣库存、反复弹预警，并可能把库存扣成负数；D1 不保留顶层 `__stockApplied` 还会让同步后的处方在下次编辑时再扣一遍。修复：①CloudSync 新增块内 `savePrescriptionToDBRaw()`（只写 IndexedDB，绕开业务钩子），pull 落地/推送回写/冲突副本全部改走 raw；②StockCore 扣减标记同时镜像进 `record.extra.__stockApplied`（D1 会持久化 extra），同步落地时恢复到顶层，保证跨设备/重装后不重复扣减；③`shared/stock-core.js` 权威源已 sync-all 到 7 副本。验证：Lead 探针 4/4（拉取/回写/冲突都 0 次业务钩子、标记从 extra 恢复）、stock-core 单测 94/94、同步独立验证 A/B 178/179（仅 D1 辅助工具旧桩 git 基线查找失败）；desktop/cloud 热更 **2026.10.19-4**（含新 index+stock-core，20 文件签名 PASS）。**修复前已受影响的库存需人工核对/冲正**（流水里可看到同方重复扣减记录）。
  - **2026-10-19 移动端同步状态可发现性补强（客户反馈“同步消失、小绿点是什么”）**：小圆点=云端同步状态指示灯（绿=已同步/橙=待同步/灰=离线/红=失败），同步未消失、仍自动运行。补强：圆点可点击→toast 显示完整状态；F1 基础设置底部新增「☁️ 云端同步：…」明细（含待同步处置说明），不再只能靠猜；桌面/宽屏悬浮胶囊不变。验证：Playwright 移动端 9/9（含圆点可点、设置明细可见）。
  - **2026-10-19 云 APP 断网冷启动兜底（真机实测 SW 未生效 → 原生内置壳）**：客户飞行模式冷启动仍是 WebView `ERR_FAILED` 错误页，说明该 Android WebView 未成功启用/保留 Service Worker（SW 方案不可靠）。改原生兜底：主框架加载失败 → 加载同源 URL `?__offline_shell=1`，`WebViewClient.shouldInterceptRequest` 把静态资源替换为 APK 内置 `assets/public`（同源 localStorage/IndexedDB → 离线登录缓存/本地处方/待同步队列可用），顶部橙色「离线模式」横幅，`online` 自动重试，网络恢复后自动退出离线壳；资源缺失回退原错误页。真机 v327 仍报 `?__offline_shell=1` ERR_FAILED → **v329** 改为无网络启动直接 `loadDataWithBaseURL` 加载**自包含内联离线壳**（index 引用的同源业务 JS/CSS 全部内联，完全绕开 WebView 拦截/错误回调），真机离线壳已能打开（橙色横幅）。v329 内登录仍报超时：cloudFetch 中文超时文案 + WebView navigator.onLine 误报导致跳过离线缓存 → **v330** 修复 auth-core（任何云端认证异常先试离线缓存，密码本地校验），已 sync 11 副本。**v331** 又发现 cloudFetch 超时是 return 错误对象（非 throw），catch 兜底不触发 → 离线缓存仍被跳过；已在 authenticate 失败响应分支识别 fromCloud=false/timedOut/网络文案并走 tryOfflineLogin。`app_project/db-yunduan/惠康中医-云端.apk`，12,408,679B，SHA256 `DB45B537…9A0F`。真机待安装 v331 验证。
  - **2026-10-19 最终调整：所有版本离线宽限统一为 7 天（取消 30 天）**：①服务端 `entitlement.js` gate token 默认 TTL 720h→168h、钳制上限 168h（离线桌面/APP 正式版离线登录/心跳宽限最长 7 天，licExp 仍不超授权到期，吊销最迟 7 天生效）；②云端 `cloud.js` 离线登录缓存 30 天→7 天（云网页/云桌面/云 APP）；③离线 `offline.js` 离线缓存 30 天→7 天；auth-core 已 sync 11 副本、cv 1a5be63b；cloud APP **v332**（12,408,275B，SHA256 `6BC6027C…09F1`），desktop/cloud 热更 **2026.10.19-5**（20 文件验签 PASS）。验证：Playwright 5/5（含 8 天前缓存必须拒绝）。
  - **2026-10-19 官网同步 + 正式发布 v2026.10.19（cloud APK v332）**：`node tools/publish-release.js --target=cloud --confirm --push` 完成：cloud APK v332 上传 GitHub Release（tag v2026.10.19，asset huikang-cloud.apk）、`public/downloads/惠康中医-云端.apk` 已替换（SHA256 6BC6027C…09F1）、`public/hash-manifest.json` + `site-official/hash-manifest.json` 双权威源已同步（cloud.apk versionCode=332）、Pages 已推送部署。线上 `hash-manifest.json` 已核验 cloud v332/sha 一致；APP 内更新检测按 versionCode 会提示 332。
  - **2026-10-19 登录提速：断网秒登 + 慢网 2.5s 离线兜底（cloud APP v333 已发布）**：①登录请求超时 30s→12s；②`authenticateWithFastFallback`：`navigator.onLine=false` 直接离线缓存登录（0ms 级），云端 2.5s 未返回且有离线缓存则先放行进主界面（本地密码校验，云端请求继续），云端先回则正常云端登录；③`login()`/`loginWithUsernamePassword` 统一走快速路径；登录成功仍先隐藏登录框再异步 loadData。实测：慢网 5s 模拟 2505ms 进入、断网 0ms、云端快 1ms。cloud APP **v333**（12,409,717B，SHA256 `BA5C7CB6…9985`）已发布官网/Release（v2026.10.19 覆盖更新）+ 热更 2026.10.19-6。
  - **勿重复实施**：-6 调试 alert 已移除并重签 -7 覆盖；P40 登录闸码错位自愈已上线；令牌 redeemedDevices 台账（首兑写 + 幂等短路补写）已上线；Java `activateLicense` clinicName 透传已入库（待 APK v325 生效）。
  - 完整方案：`.trae/documents/activation-architecture-optimization_plan.md` / `.trae/documents/activation-streamline_plan.md`（P0 方案A 全链已闭环，详见 KNOWLEDGE 2026-10-17 条目）。
- **2026-10-20 自动备份真正可恢复 + 「备份与恢复」面板 + 官网说明（代码已就位，待重打包/发布）**：自动备份改走手动备份同一落盘通道（桌面 `惠康中医媒体\downloads\中医处方系统\`、APP `Download/中医处方系统\`）文件名 `auto_YYYYMMDD_HHmmss.json`；统一载荷 `buildBackupPayload()`（含 users/settings/stockLedger）；JS 注入「🗂️ 备份与恢复」面板（合并列出手动+自动、一键恢复、仅自动可删、清理旧自动备份；**手动备份永不自动删除**）；新增 `delete-backup-file` IPC + preload + Android 双 MainActivity + 离线 APP inject + 鸿蒙 shim/NativeBridge。E2E `verify-fs-domain.cjs` F1-F10 **54 断言 ALL PASS**；门禁（check-interface 6 OK / copy-consistency 100/100 / html-sync-check / diff-cross-version 6 对 / check-ipc-consistency / sync-all -VerifyOnly）全绿。详见 KNOWLEDGE §68；**待办见 H13**。
- **2026-10-18 构建现场已清理（已决）**：外部会话 09:45 打包因版本基线漂移中止——产物 1.0.277/1.2.269/cloud APK 325 已归档到 `%TEMP%\kyt-build-archive-20261018-102617`，工作区残留已从 `stash@{0}` 丢弃并删 dist 残留；`verify-version-baseline` 复核通过（HEAD 1.0.276/1.2.268/322/324，dist 无残留）。下次打包将按**最新代码**（含 S1b-③ gate token/会话）重新递增到 277/269/325；产物发布仍为独立人工闸。
- 工作区有多个**未跟踪文件**（`_verify/`、`_verify-report.md`、`promo/`、`tools/_tmp/*` 等）：非本台账任务产物，**提交时精确 `git add`，禁止 `git add -A`**。

---

## OPEN 遗留任务

### H15 ｜优先级：高｜注册激活流程统一优化一期（A+D+E）——已批准，未动工（E 调研已完成，可直接开工）
- **状态**：OPEN（方案获用户批准 2026-10-21；代码零改动，基线 `83554069`）
- **背景（用户拍板口径）**：三步流=①首次注册仅一次（6字段）②激活码自动激活或官网后台管理员手动激活 ③配额机构 5 台/个人 2 台（电脑手机混算，「同一版本同一配额」）。只做一期 A+D+E，二期三期不做：
  - **A 注册档案贯穿**：激活框砍掉手机号/密码输入框（只留激活码+邀请码）；手机号/诊所名/医生姓名从本机注册档案自动提交；工单 Tab 字段自动带出、只读展示。
  - **D 四端流程统一**：删激活框「密码留空默认 admin」历史遗留（登录=注册手机号+注册密码）；字段/文案/样式按三步流统一。
  - **E 云端配额放宽**：云端机构版账号级配额 1→5 台（个人版保持 2 台），与离线对齐。
- **E 项调研结论（2026-10-21 本会话完成，直接可用）**：云端配额两层结构——
  - ①全局层：`license.maxDevices`（登录预检 `functions/api/users.js` ~2534-2597，全所设备总数封口，走 license_clinic_index 投影索引；属购买时商业配额，**勿动**；非正整数 fail-open）。
  - ②账号层：`bindUserDevice`（`functions/api/users.js:115-130`）机构版默认 **1 台/账号**——E 的真正卡点。个人版默认 2（`:92` `MAX_DEVICES_PER_ACCOUNT=2`）。
  - 改动点：a) `:92` 附近加机构版默认常量 5；b) `:123` `isInstitution ? 1 : …` 改 5（`:119-120` 注释同步）；c) **存量 KV `user_devices:{username}` 已写死 maxDevices=1 的机构版账号需放宽**：bindUserDevice 内 `isInstitution && record.maxDevices===1` 时升 5（"1"是历史默认值而非管理员手调，误伤风险极低；管理员可后台 set-devices 改回）；d) `:2608-2609` DEVICE_LIMIT 文案「机构版每账号最多 1 台」→ 5 台；e) 离线侧已对齐勿动（`activate-from-ticket.js:201` / `admin-approve.js:208` type=pro 默认 5 台）；f) admin set-devices（`:2894-2955`）机构版走 license.maxDevices 路径不动。
- **A+D 锚点（`shared/auth-core/offline.js` 权威源，约 57 万字符读不动整文件，按行段处理）**：激活框结构 4119-4180（activateCodeInput/activatePhoneInput/activatePwdInput/activateInviteInput）；提交逻辑 ~3907-3935（actPhone/actPwd → `electronAPI.activate.submit`）；注册弹窗 `__regPrefill` 5106-5153（regClinicName/regAdminName/regUsername/regPhone/regPassword）；`syncSharedFieldsFrom` 7081-7107（Tab 互带）；工单 Tab `ticketClinicName` 等 5984 起；`adminCodeEntryBtn` 7119。A 需注册档案落盘（config.json+localStorage 双写）供激活框/工单 Tab 自动带出。
- **范围**：仅 A+D+E。**勿动安全红线**：fail-closed、码过期 403、激活后本地自验、单设备单码、换机联系人一致校验、云端账号订阅/离线码+机器码两授权模型不变。
- **执行顺序（用户已确认分阶段）**：① E 先行（纯 functions，push 即生效零风险）→ ② A+D（auth-core 权威源改造）→ ③ 门禁：`node --check` + `check-interface.bat` 改前后 + `sync-all.ps1` 分发 + `-VerifyOnly` + `copy-consistency.cjs`（auth-core 改动 cv 哈希变，pre-push 会拦，需按流程重刷 cv 并补提交）→ ④ commit+push → ⑤ 五端生效方式说明（云网页/云APP push 即达；离线APP 热包重启生效；桌面激活窗/登录窗在 asar 内的部分需整包才生效）→ ⑥ 完成后结论沉淀 KNOWLEDGE §72 随代码同批提交。
- **验收**：E——机构版账号第 2 台设备登录不再 DEVICE_LIMIT（存量记录升级生效）；A——激活框无手机号/密码输入框仍激活成功（档案自动提交）；D——激活链路无「默认 admin」路径，登录=注册手机号+注册密码。
- **基线 commit**：`83554069`

### H7 ｜优先级：高｜整包批次（最新代码）：云桌面 1.2.269 + 云APP 325 + 离线桌面 1.0.277 + 离线APP 323（✅ 已构建验包，待发布）
- **状态**：IN-PROGRESS（2026-10-18 10:41 四端构建/验包完成，AutoCommit `1ba4fdf1`；待发布 + 桌面冷启动深链复测）
- **已完成（本批次，全部通过）**：
  1. **云桌面 1.2.269**：Setup 81,882,088 B / 便携 81,607,168 B（FileVersion 1.2.269）。
  2. **云 APP versionCode 325**：项目根 `惠康中医-云端.apk` 12,395,941 B（SHA256 `C854FD85…`）。
  3. **离线桌面 1.0.277**：Setup 79,281,936 B / 便携 79,006,984 B（FileVersion 1.0.277）。
  4. **离线 APP versionCode 323**：`app_project/db-offline/惠康中医-本地.apk` 3,577,707 B（SHA256 `6979003F…`）。
  5. `artifact-locate.js --check` → 「各源一致，可发布」；版本副作用 AutoCommit 已 push（`1ba4fdf1`，4 个打包基线已记录）。
  6. 热更重签：desktop/local **2026.10.18-1**（app 1.0.277）、desktop/cloud **2026.10.18-1**（app 1.2.269）；app-local 保持 **2026.10.18-2**。
- **剩余动作**：
  1. **发布**（`一键发布.bat` 人工确认；或指示我执行 `node tools/publish-release.js --changed-only --confirm --push`）。
  2. **桌面冷启动深链真机复测**（装 1.0.277）：`bnzc://activate?...` 冷启动唤起 → 兑换 → 自动注册/装码 → 登录。
  3. 云 APP 325 真机安装复测（可选，验 Java clinicName 透传 + 最新 JS）。
- **勿做**：鸿蒙构建暂停；发布前不再改源码（打包基线 `1ba4fdf1`）。
- **验收**：发布后下载页/`hash-manifest.json`=1.0.277/323/325；线上 `hot-update/desktop/{local,cloud}/version.json` 均 `2026.10.18-1`；桌面冷启动深链通过。
- **基线 commit**：`1ba4fdf1`

### H9 ｜优先级：高｜离线桌面 1.0.280（激活三项优化）发布 + Windows 真机回归（2026-10-19）
- **状态**：IN-PROGRESS（已构建验包，`dist/惠康中医-本地 Setup 1.0.280.exe` 等 2 产物；源码提交 `eeb21f99`+`9f562fc3`；**发布未执行**）
- **已完成**：三需求全部落地并通过独立验证（27 PASS/0 FAIL）+ 浏览器级 Playwright 探针（initialTab 直达/登录页唯一入口）+ IPC mock（父窗=激活窗、置顶 true→false→true）；`copy-consistency 100/100`、`check-interface 6 OK`、`desktop-license-smoke 149/149`、构建 E2E 6/6 + FINAL IRON GATE 全 PASS + fused smoke launch PASS。
- **剩余动作**：
  1. **发布**（人工 `一键发布.bat`，或指示执行 `node tools/publish-release.js --changed-only --confirm --push`）；发布后下载页应=1.0.280。
  2. **Windows 真机多设备激活回归（reviewer 指出的唯一残差）**：用机构版多设备码在 Win10/11 实机激活 → 「激活成功 已绑定 X/N 台设备」确定框必须显示在激活窗之上、可点；点确定后激活窗恢复置顶、3 秒重启倒计时可见。
  3. 真机验证两需求：零账户登录窗只显示 1 个「📝 注册开通」入口；注册成功页点「我有激活码，立即激活」直接落在激活码输入框（不再先显示版本选择页）；点「没有激活码，在线购买正式版」仍进版本选择页。
- **勿做**：云桌面同款「成功确定框被云激活窗遮挡」未修（云 activate.js 无 getActivateWindow，工厂回退主窗=与改前一致）；要修需另给云 activate.js 加访问器并重打云桌面。
- **验收**：真机 1/2/3 全过；下载页/hash-manifest 显示 1.0.280。
- **基线 commit**：`9f562fc3`

### H10 ｜优先级：高｜云端授权状态激活码/邀请码修复上线后客户真机验证（2026-10-19）
- **状态**：IN-PROGRESS（代码 `b167fd91` 已提交；随 push 部署 functions + 静态 + desktop/cloud 热更 2026.10.19-1）
- **已完成**：服务端账号态三层兜底（诊所索引/admin_phone/phone 全扫 + 归属/缓存/unused 过滤）、客户端授权区激活码+邀请码卡片、8 云端 auth-core 副本 + cv/HTML 同步、热更包 2026.10.19-1（20 文件签名）；独立终审 43+29+59 全 PASS、0 阻塞；门禁全绿。
- **剩余动作**：
  1. **客户云桌面验证**：启动 → 等热更静默拉取 → **彻底退出重开**（淡绿横幅）→ 登录 → F1 基础设置-授权状态应显示「🔑 激活码：BNZC-…（点击复制）」+「🎁 我的邀请码：……」。若仍缺：看 `%APPDATA%\惠康中医-云端\hot-update\.hot-version` 是否 2026.10.19-1、wrangler tail 看 `/api/license/invite` 返回。
  2. **云端网页/云APP**：刷新即达（public/auth-core.js + cv c6ddf377 随 push 部署）。
  3. **回归抽样**：未激活/试用账号打开授权区应无激活码卡片、无报错；匿名邀请码查询行为与改前一致（服务端匿名字段零变化）。
- **回滚**：热更客户端 `node tools/rollback-hotupdate.cjs -c cloud`（新增回滚包）或后台旧 version.json；服务端回滚必须与热更同批（旧服务端会忽略新客户端 Authorization/body.authToken，客户端仍走 code/machineId 旧路径，故单回滚服务端不致命但会丢账号态兜底）。
- **勿做**：不建议把 token 写入日志/URL；共用电脑残留他所 license:code 的展示一致性为已知低优项（后版本处理）。
- **验收**：客户机授权区显示激活码+邀请码；网页/APP 刷新同步显示；匿名/旧客户端零回归。
- **基线 commit**：`b167fd91`

### H11 ｜优先级：高｜云端版「断网可用+联网自动同步」一期 MVP：试点观察 → 放量（2026-10-19）
- **状态**：IN-PROGRESS（代码 `fdaa2e98` 已 push 部署；functions+静态+desktop/cloud 热更 **2026.10.19-4** 已上线（-4 含同步扣库存修复）；一期默认对所有 `allowedMode=both` 用户开启，无白名单）
- **已完成**：IndexedDB v4 outbox/sync_state；保存/删除本地优先+入队（await 入队修 R1/R2）；CloudSync pull→push→pull、冲突副本、墓碑、幂等重试、状态徽标、online/visibility/5min 定时；getAllUserPrescriptions 脏数据保护 + syncPrescriptionsDBDiff protectedIds（修现网离线保存被清掉缺陷）；服务端 `GET ?sync=1` 增量 + 时间戳归一 + 永久墓碑/409 防复活 + KV kill switch；热更 2026.10.19-3（20 文件验签/hash/cv PASS）。独立验证 179/179、服务端自测 124、上线前审查可放行。
- **剩余动作**：
  1. **灰度观察**：先选 1-2 家诊所（把其他用户 `allowedMode` 置 `cloud`，试点保持 `both`）观察 3-5 天：sync 错误率、待同步积压、冲突副本数量、D1 行读量（免费 5M/天；当前 sync 每轮全表读，需按诊所规模评估）。
  2. **放量前优化（建议）**：`sync=1` 的 since 下推 SQL（D1 `clinic_id+updated_at/deleted_at` 索引）+ 服务端限频；客户端 pull 批量写 IDB；DB v4 onblocked 提示用户刷新旧标签页。
  3. **已知限制**：媒体文件不同步；回收站恢复已补「撤 delete op + 入队 upsert」；冲突副本会在报表中作为独立处方计数（需产品确认口径）；platform_admin 空转同步。
  4. **回滚**：后台 `allowedMode='cloud'`（立即停同步、回旧行为）或 KV `config:cloud_offline_sync={"mode":"off"}` 总开关；客户端 `rollback-hotupdate.cjs -c cloud`。
- **验收**：断网开方→重启→记录在；联网自动上传（云端可见、待同步归零）；断网删除→联网云端软删；双端并发冲突副本不丢；回退 cloud 后零同步请求。
- **基线 commit**：`fdaa2e98`（跨版本基线重冻结 `7c7d5985`；线上核验：hotVersion=2026.10.19-3、云端 index 含 CloudSync/outbox/PERMANENTLY_DELETED、`/api/prescriptions?sync=1` 未认证 401）

### H12 ｜优先级：高｜离线正式版 30 天宽限 + 云 APP/网页 Service Worker 离线壳：上线验证（2026-10-19）
- **状态**：已上线（commit `0072b931` 已 push；线上核验 `/sw.js` 200+no-cache、index 含 SW 注册；**无需重打 APK/离线桌面**）
- **已完成**：`entitlement.js` gate token 默认 TTL 720h/上限 720h（48h→30 天）；`public/sw.js` App Shell 缓存 + `index.html` 注册（https 或 localhost）；`/sw.js` no-cache 头；cloud_desktop/cloud_app/harmony index 已 sync-html；Playwright 离线重载 8/8。
- **剩余动作**：
  1. **验证 30 天宽限真机**：离线正式版设备联网登录一次（服务端签发 30 天 token）→ 断网重启，应可登录；查 `license:gateToken` exp-iat≈720h；超过 30 天或时钟回拨仍 fail-closed。
  2. **验证云 APP/网页离线壳**：云 APP/浏览器联网打开一次（SW 安装）→ 断网冷启动/刷新，应出现应用壳（登录/缓存数据）；首次安装从未联网仍显示原生重试页（预期）；查 `chrome://serviceworker-internals` 或日志 `[SW] 离线壳已注册`。
  3. **观察**：SW 缓存命中后在线请求仍网络优先（静态），若发现旧 JS 被缓存需 bump `sw.js` 的 SW_VERSION 与文件字节；Cloudflare `_headers` 已给 /sw.js no-cache。
  4. **可选增强**：把云 APP 首次冷启动的原生错误页升级为品牌化离线页/自动重试（需 APK 重打，本期做 SW 后非必须）。
- **回滚**：无需回滚期（SW 不影响在线网络优先；如需停用可改 index 移除注册或 SW_VERSION 清缓存）；gate TTL 可用环境变量 `GATE_TOKEN_TTL_HOURS` 覆盖（≤720）。
- **验收**：离线正式版 30 天内断网登录成功；云 APP 联网一次后断网冷启动可用；API 不被 SW 缓存；在线更新不受影响。\n- **基线 commit**：`0072b931`（Playwright 本地静态服务离线重载 8/8；线上 `/sw.js` 200/no-cache、index 注册已核验）

### H13 ｜优先级：高｜自动备份可恢复 + 「备份与恢复」面板：重打包与发布（2026-10-20）
- **状态**：IN-PROGRESS（代码全部门禁 + E2E F1-F10 54 断言通过；**四端整包已重打并完成产物核验 PASS**；待：热更重签 / 真机回归 / 发布）
- **已完成**：`delete-backup-file` IPC（shared 权威源 + 2 副本）、preload×2、Android 双 `MainActivity.java`、离线 APP `video-recorder-inject.js`、鸿蒙 `cloud-electron-api-shim.js`+`NativeBridge.ets`、两权威源 `index.html`（`buildBackupPayload`/`saveLocalBackupToFile`/`listBackupItems`/`restoreBackupItem`/`deleteBackupItem`/`cleanupOldBackups`/面板注入/`importDataFromJson` 旧结构归一化）、官网 `download.html`×2；`sync-all.ps1` 分发 6 份 index 副本；`diff-cross-version` 基线已重冻结（desk/siteadmin/download）。
- **剩余动作**（第 1-2 项已合成一键脚本：**双击 `重打包四端.bat`**，逻辑源 `tools/repack-four-targets.ps1`，打包委托 `one-click-pack.ps1 -AutoMode 3` 并自动解 asar/APK grep 核验本批标记；`-Force` 忽略增量跳过，`-SkipPack` 只核验）：
  1. ~~**双桌面整包重打**~~ ✅ **已完成**（2026-10-20 11:08-11:21，`一键打包.bat 3` + `NO_BUILD_SKIP=1` 全量重打）：云端 `惠康中医-云端 Setup 1.2.271.exe`、离线 `惠康中医-本地 Setup 1.0.281.exe`；产物核验 4 端全 PASS（asar 含 `delete-backup-file`/`deleteBackupFile`/`buildBackupPayload`/`备份与恢复`）。
  2. ~~**双 APP 重打 APK**~~ ✅ **已完成**：云端 `惠康中医-云端.apk`、离线 `惠康中医-本地.apk`（versionCode 325）；核验 APK 内 `assets/public/index.html` 含 `buildBackupPayload`/`备份与恢复`、`classes*.dex` 含 `deleteBackupFile`（Java 编译验证同步完成）。鸿蒙包暂不构建（近期搁置）。
  3. **热更重签**：`index.html` 属白名单 → `desktop/local`、`desktop/cloud`、`app-local` 可热更（但**桌面删除能力依赖整包**，热更只带前端面板）。
  4. **真机/真装实测**：桌面 + APP 触发自动备份 → 目录现 `auto_*.json` → 面板列出 → 恢复（账号+设置+数据齐回归）→ 仅自动可删 → 清理后手动备份仍在；无桥环境（网页）走 IndexedDB 降级不报错。
  5. **发布**（人工 `一键发布.bat` 或 `node tools/publish-release.js --changed-only --confirm --push`）；发布后 `download.html` 指南随 Pages 自动生效（本批官网文案已含新路径/新入口）。
- **坑记录**：本次打包末尾「副作用自动收纳」因**.git/index.lock 陈旧残留**（11:05:02，无 git 进程）失败，5 个版本号副作用文件（cloud_desktop package.json/build-meta.json、cloud_app build.gradle、offline desktop package.json、offline app build.gradle）未自动提交，已人工清锁并补提交。**教训：打包前先确认无陈旧 index.lock，否则版本基线漂移会静默累积。**
- **勿做**：不改 HTML 结构/CSS（守 `check-interface` 6 OK）；不动手动备份命名与通道；鸿蒙不构建。
- **验收**：四端安装新包后 AC-1..AC-5 全过（见 `.trae/specs/backup-restore-optimize/checklist.md`）；官网文案与客户端路径逐条一致。
- **基线 commit**：本批提交（见 commit message）；规格文档 `.trae/specs/backup-restore-optimize/`

### H8 ｜优先级：中（S1 实施中）｜激活流程全端架构收敛
- **状态**：IN-PROGRESS（5 项决策已拍板；**S1a + S1b-①②③ 已完成**；**S1b 剩余**：客户端接入 session、真机矩阵、桌面整包 1.0.277、云端 gate token 分发复测）。**2026-10-18 09:45 另一会话打包因版本基线漂移中止（1.0.277/1.2.269/325 未入库），遗留副作用已 `git stash`（"10-18 09:45 打包遗留副作用…"）待负责人处理，勿直接提交。**
- **已拍板决策**：
  1. **O1 activation-session**：✅ 接受，S1 先做 MVP（令牌核销后移到 claim 成功，幂等可重试）；
  2. **云 APP 本地授权载体**：✅ 补**签名 gate token 缓存**（不引入 license.dat），云端统一为「账号权威 + gate token 离线宽限」；
  3. **O4 设备投影表迁移**：✅ 双写 **2 个整包周期**（S3 执行）；
  4. **旧端点退役**：✅ 冻结新客户端 → 观察 **12 个月** → 公告 **6 个月** sunset（约 18 个月）；
  5. **历史默认 admin 强制改密**：✅ 仅**新开通/重置**强制，历史账号不强制。
- **S1a 已完成（本次提交）**：
  1. 新增 `functions/api/license/reconcile.js`：默认不写授权业务 KV；`actions`（NO_ACTION/CLEAR_STALE_CODE/REINSTALL_LICENSE/SERVER_RECORD_MISMATCH/COMPLETE_ACTIVATION/REACTIVATE/RENEW/CONTACT_SUPPORT）；**匿名未绑定码只回 codeExists**（无 clinicName/到期泄露）+ 码级频控 5/h（管理员豁免）；repair 仅 platform_admin，且只允许（a）重建派生索引（b）凭 `redeemedDevices` 台账 + 码 unused + 配额未满 三条件补绑（写 license 记录 + `reconcile-rebind` 审计），其余 repairFailed。
  2. `shared/auth-core/offline.js` 登录闸失败自愈：**结构化触发**（仅本地 `status.valid && type=licensed` 且非 free/trial，排除账号删除/吊销/停用/网络类）；对账成功→清错位码/重装 license 后**优先重跑主进程 verifyGate**（桌面 IPC 锚点/回拨/墓碑不被绕过）；P40 型「本地有效/服务端无授权」只追加诊断码文案，不自动修复；同账号每运行期只对账一次。
  3. `admin-account.normalizeActivationPassword` 默认 `fill-empty`（只补无 hash/salt 的历史空账号），审批/轮询/工单不再覆盖已改密码；仅 admin-submit 显式 passwordCred 才 overwrite；无凭据时拒绝回落字面 admin。
  4. 测试 `tools/act-reconcile-test.cjs` **29 PASS/0 FAIL**（含匿名码探测面/管理员诊断面/码错位二次裁决/P40 分裂/repair 三态/频控/封锁设备）。
  5. **S1b-① 后台「🔎 激活诊断」页已上线**：主站 `https://tcm-prescription-system.pages.dev/admin/activation-diagnose`（Cloudflare Pages 去 .html，用 pretty URL）；功能=机码/激活码/本地状态 → reconcile 摘要 + 建议动作 + license_log 时间线 + 受控修复按钮 + 一键复制诊断报告；令牌读主站 `license_admin_token`。**后台站副本为跳转页**（huikang-admin 未部署 /api Functions，接口固定主域）；需先在主站 /admin 登录平台管理员。
  6. **app-local 热更 2026.10.17-8 已重签**（minAppCode 288 继承）：APP 端登录闸对账自愈自第 2 次冷启动起生效（桌面登录窗在 asar 内仍需整包 1.0.277）。
  7. **S1b-② activation-session MVP（服务端）已上线**：新增 `functions/api/license/activation-session.js`（action=start/complete/status）——令牌 redeem 增加 `deferConsume`（只 `linked` 绑首兑机，不核销）+ 新 `action=consume`（claim 成功后才核销并写台账）；start 返回 sid（30min TTL、绑 machineId、**不向前端泄露裸码**），complete 由服务端调 claim→成功再 consume，claim 失败返回 `retry:true` 且令牌保持 linked（可重试），成功幂等；`tools/act-session-test.cjs` 20 PASS/0 FAIL，旧令牌回归 44 PASS。**客户端尚未接入**（后续新包/热更用 session）；旧 redeem/claim 语义零变化。
  8. **S1b-③ 云 APP gate token 缓存 + 离线宽限已上线**：`shared/auth-core/cloud.js` 心跳 entitlement=LICENSED 时缓存服务端 ES256 `gateToken` 并以 `serverTime` 校正时钟基线；网络不可达/心跳异常/裁决不可达三处先验签（mid/exp/iat/licExp/回拨，公钥与 offline 同源 v1/v2），通过则离线宽限放行，否则回退既有 7 天离线锁定；cv 已 bump（`auth-core.js?cv=68348e41`）并 sync 云端 8 副本 + 3 份 index.html；云 APP 为在线 WebView 壳，**push 即达**（云桌面/鸿蒙随各自分发）。
- **生效注意（审查结论，务必遵守）**：
  - 服务端 reconcile 随 push 由 Pages 构建即上线；
  - auth-core 属热更白名单：**APP 需重签 app-local 热更才生效**（minAppCode 288 不抬）；**桌面登录链在 asar 登录窗内**，主窗热更不覆盖登录窗 → 桌面「登录闸自愈」需**整包 1.0.277** 才生效；
  - 自愈仅对「本地授权有效但闸门拒绝」触发；时间回拨/tampered/config_tampered/账号删除**不触发**（防硬拒态变可写修复路径）。
- **S1b 待做**：① 客户端接入 activation-session（新包/热更，需重签 app-local）② 真机矩阵：码错位/license.dat 损坏/时间回拨/账号删除 ③ 桌面整包 1.0.277 使登录窗自愈生效 ④ 云桌面/鸿蒙 gate token 随各自整包/热更分发后复测。
- **勿做**：不动 35+ 端点历史语义；不改人工审核铁律/价格/端锁；**禁止手工改 KV 码记录**（业务级重置一律走 reconcile/repair 或 admin 工具）。
- **验收**：S1b 完成后重现「KV 手改 unused + 本地有 license」→ 后台诊断页可定位并可受控 repair；旧客户端零回归；pre-push 全绿 + act-* mock 入库测试常绿。
- **基线 commit**：`d042fac6`

### H4 ｜优先级：高｜红米改名修复云端 functions 部署 + 真机复验（2026-10-15）
- **代码已提交推送并上线**：commit `d085f785`——users.js（migratePrescriptionOwnership + formerUsernames 链 + 两改名端点）、prescriptions.js + _lib/auth.js（token `a` 别名签名与读侧别名过滤）、离线 5 副本 index.html（heal 双闸）、热更 2026.10.15-1 双端。双独立审查+安全二查已过，105 断言全绿（rename-cloud 36 / rename-heal-pwd 31 / owner-migrate 回归 38）。
- **上线确认（2026-10-15）**：热更 version.json 线上已为 2026.10.15-1（app-local minAppCode 288 + desktop/local，已拉 URL 实测）；本仓是 Pages 项目，functions 随 push 由 Pages 原子构建部署（与静态同次发布，无需手动 wrangler）。
- **⏳ 仅剩真机复验（红米，需人工）**：
  1. 联网打开 App 拉到 2026.10.15-1 → 彻底划掉重进 → ①手机号登录一次（heal 修复英文名行）→ 英文名退出再登成功；②历史处方可见；③英文名身份改密后手机号+旧密码登录不得把新密码回滚（闸2）。
  2. 云端首单实测：诊所账号手机号改英文名 → 历史处方与回收站立即可见；`migrationWarning` 仅在单副本失败时 true；审计日志含 migrate 统计。
  3. 已知遗留（产品确认后另开）：云端 formulas 个人常用方 created_by 未随改名迁移。
- 详见 KNOWLEDGE 2026-10-15 条目（§408-413）。

### H2 ｜优先级：中（需人工真机，Agent 不可替代）｜激活 P1/P2/P3 真机回归
- **执行用详细清单（含预期/抓包点/记录模板，执行人直接照做）**：`.trae/documents/h2-real-device-regression-checklist.md`
- **进度（2026-10-14，Agent CDP 真机实测设备 A，详细记录见清单 §3.5）**：
  - ✅ §0 热更 2026.10.14-1 落机确认（.hot-version + auth-core SHA256 F5603A74 与仓库逐字节一致）。
  - ✅ **A1（P0）**：已登录用户激活码 Tab 手机号/诊所/姓名自动带出，提示文案正确（截图 phone-30）。
  - ✅ **F2（P0）**：离线 App claim body 精确匹配 P3 口径（offline/app、无 pwdCap/password）。
  - ⚠️ **D2 同机不适用**：错号在同机幂等放行属设计（existingDevice 免核验），服务端锚点/设备/到期零改动已实证；**跨机 D1/D2 仍需设备 B**。
  - 🟡 附带观察（低优，不阻塞）：existing 重激活响应 `resolvedIdentity.phone` 回显客户端号而非 record 锚点号（validate.js L1093），错号场景客户端会建本地错号账号；已由 2026-10-16 阶段2①修复（record.phone 锚点优先回带）。
  - ⏳ 待测：A2/A3/B 组（云端三端）/C 组（桌面）/D1+D2（设备 B）/E 组（裸码，需管理员备 unused 裸码）/F1/F3/F4。
- **摘要**：
  1. 离线 App（已注册账号）：版本页金色按钮进激活码页 → 手机号自动带出 → **只输码**激活成功。
  2. 离线 App：试用到期提醒入口同上；App 需彻底退出重开第 2 次拉到热更（当前 -7）。
  3. 换机：新设备输码，手机号带出为原绑定号 → 自动解绑最旧机恢复；故意改错手机号 → 必须被拒。
  4. 桌面（Electron，云/离各一）：激活窗 user/clinicName/phone 正确透传桥 submit。
  5. 云端 Web/桌面：刷新即达（cv ed835152），登录态用户手机号自动带出。
  6. 渠道裸码（无锁端 personal 码）首激：码+手机号 200，`identitySource=phone-anchor`；后台激活码日志可见 `phone-anchor-activation`。
  7. P3 零行为变化核对（任一版本即可）：抓包 claim body 仍含 productClass/clientClass（云端另含 pwdCap:'v2'）；Tab1 直建订单 order-submit 正常（字段未缺失）。
- **异常回流**：任何一项失败，把现象/机器/版本记入本任务并改 BLOCKED，附 license_log action。

### H14 ｜优先级：中｜云端处方"假成功"防护上线后客户复验（2026-10-20）
- **状态**：已上线（`452b1837` 假成功防护 + `716d8559`/`b3a19daa` T5 端间同步开关统一 + `3bf95776` 热更 2026.10.20-3 均已 push；**线上已核验** hotVersion=`2026.10.20-3`）；**仅剩客户机人工复验**
- **背景（客户实报）**：云桌面新开处方 → 同账号的云端网页/云 APP **看不到该方**；云桌面角标却显示「☁️ 已同步」。用户重登/刷新后恢复正常（偶发、时间相关）。
- **根因（三条缺陷叠加，已实证）**：①`dualWritePrescription` 吞 D1 写错、POST 仍回 `success:true` → 客户端凭 success 删掉待同步 op、角标转绿；②读路径**D1 优先**（仅 D1 零行才回退 KV、登录预取纯 D1）⇒ **KV 有/D1 无**的处方在所有端永久不可见；③`ensurePrescriptionSchema` 只自愈 2 列、upsert 写 10 列 → 缺列即整条 INSERT 失败。详见 KNOWLEDGE §69。
- **已完成**：服务端不吞错（返回 `{d1Ok,d1Error}` + 审计 `prescription_d1_write_failed`）+ POST 回传 `storedIn/d1WriteFailed/d1Error`（只增字段）+ `d1UpsertPrescription` 缺列自愈重试一次 + 列清单扩至 10 列；客户端 `CloudSync.push` 收 `d1WriteFailed` 不删 op（保留重试、角标不再谎报）；新增 `tools/cloud-sync-fake-success-test.cjs`（修复前 3/3 红、修复后 6/0 绿）并接入 pre-push **第⑱道门**（两次 push 均十八道全绿）；`sync-all` 分发 6 端副本；`check-interface` 6 OK / `copy-consistency` 100/100 / `check-cv-hashes` 15/15 / `diff-cross-version` 全绿。
- **云桌面热更（已签发，仅 cloud 通道）**：`2026.10.20-3`（app 1.2.271，含 T5 端间同步开关统一 + cloud 模式升 both），20 文件 Ed25519 签名；index.html 取 **cloud 身份源** `app_project/db-yunduan/cloud_desktop/index.html`。**离线两端与离线 APP 不受影响（离线源保留 Capacitor 判定），未重签。** 线上已核验 hotVersion=`2026.10.20-3`。
- **剩余动作（人工/复验）**：
  1. **客户机复验**：云桌面**彻底退出重开** → 自动拉热更 2026.10.20-3 → 打开 F1 基础设置滚到底 → 应出现「☁️ 云端同步」明细行（之前看不到是因为 allowedMode='cloud' 被误判为纯云端模式，本批已统一升 both）。再新开一方 → 同账号云 APP 重进应可见。
  2. **噪音排查（若再复现）**：`wrangler tail` 搜 `[D1] upsert prescription failed` 与审计 `prescription_d1_write_failed`，按 id 定位；确认有 KV 有/D1 无的遗留处方再做 T4 回填。
- **未做（另可立项）**：T4 KV→D1 对账回填（本次症状自行恢复、无遗留 id 清单）。
- **已完成（本批 T5，端间同步开关统一）**：云通道 `allowedMode` 的 `local`/`cloud` 统一升为 `both`——`shared/auth-core/cloud.js` 登录归一化（去掉 `!global.Capacitor`，local+cloud 均升 both）+ `public/index.html#getSyncMode()` 唯一读出口兜底升 both（覆盖已登录缓存态）。离线源 `offline.js` 保留 Capacitor 判定不动。验证：`sync-auth-core -VerifyOnly` 11 副本双源一致、`sync-all/sync-html` 全同步、`check-cv-hashes` 15/15、`check-interface` 6 OK、`copy-consistency` 100/0、`cloud-sync-fake-success-test` 6/6。云端网页/云 APP 随 push 刷新即达、无需重打包；云桌面页面部分需热更（已签发 2026.10.20-3）。
- **规格文档**：`.trae/specs/cloud-rx-latest-not-visible/{spec.md,tasks.md}`
- **基线 commit**：`452b1837`（假成功防护） + `716d8559`（T5 local→both） + `b3a19daa`（T5 cloud→both 补漏） + `3bf95776`（热更 2026.10.20-3）

### H3 ｜优先级：低（长期观察）｜KV 容量与套餐
- audit_log 前缀 880 键（2026-10-13 实测，总 1926），接近单页 1000；D1 迁移完成后安排清理。
- 用户此前决策「先削减不升级」；若 list/write 再触限额，评估 Workers Paid（$5/月）。
- **2026-10-18 list 429 实锤（免费版 1000 list/天用尽，控制台「KV 请求已被暂时阻止」）**：已上线免费治理——`getKV()` 返回绑定加 Proxy，`kv.list` 自动走 `safeListPage` 并默认 60s isolate 缓存；429 后熔断标记写入 KV（`sys:kv_list_blocked_until`，TTL 到下一个 UTC 0 点），多 isolate 共享；熔断期优先返回上次成功缓存（后台显示旧数据而非整页报错）。测试 `tools/kv-list-fuse-test.cjs` 10 PASS。免费额度 **UTC 0 点重置（北京 08:00）**，无需升级套餐；**长期根治=list 密集的管理端扫描迁 D1（免费 5M 读/10万写每天）或改索引键 get**，下一步可做。**第二步已上线（2026-10-18）**：新增 `functions/api/_middleware.js` 响应缓存中间件——白名单只读管理接口（admin-list 120s / admin-data-audit 600s / admin-risk 300s / admin-usage 300s / stats-funnel 600s）同 token+同参数 TTL 内只真扫一次，缓存存 KV 单键（不走 list）；401/非白名单/带 Set-Cookie 一律不缓存；`x-no-cache:1` 或 `?fresh=1` 可强制刷新；测试 `tools/api-cache-middleware-test.cjs` 12 PASS。**第三步（2026-10-18）**：缓存主存改为 **D1**（新表 `admin_resp_cache`，已 remote 建表；免费 5M 读/10万写/天），不再占用 KV 1000 写/天；KV 仅作旧缓存兼容读；缓存 key 含 token 哈希、401 不缓存、`x-no-cache`/`?fresh=1` 可强制刷新；D1 不可用时自动回退 KV。

---

## 任务卡模板（新增 OPEN 任务时复制）

```markdown
### Hn ｜优先级：高/中/低｜一句话标题
- 状态：OPEN / IN-PROGRESS（账号@机器，开始日期） / BLOCKED（阻塞物+找谁）
- 背景：现象/根因/数据（附文件:行号、日志 action、客户码可写脱敏前缀）
- 范围（做什么）/ 勿做（明确不碰的边界）
- 验收：测试命令 + 人工核对点 + 回归集
- 基线 commit：xxxxxxx　关联文档/PR：
```

---

## 环境前置（新账号 / 新机器必读）

- 系统约束：Windows + PowerShell 5（**禁 bash heredoc / && / cmd /c**）；git 加 `--no-pager`。
- 权威源铁律、17 道 pre-push、多端同步清单、热更/cv 流程：全在 `.trae/KNOWLEDGE.md`，开工先通读相关章节。
- 各机自备、**不在 Git** 的凭据：Cloudflare/`wrangler login`（一律 `--remote`）、Pages 的 `AUTH_SECRET` 等环境变量、app-local 热更 Ed25519 签名私钥（读取方式见 `tools/generate-app-hotupdate.cjs`，换机向负责人索取）。
- 管理员/测试账号与线上 BASE URL 见 KNOWLEDGE；临时验证脚本放根目录 `_*.mjs` 或 `e2e/.tmp/`，**测完即删**。
