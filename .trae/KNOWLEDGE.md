# 惠康中医项目 · 共享经验知识库（PROJECT KNOWLEDGE）

> 本项目**跨 work 账户共享的"统一大脑"**。任何账户打开本项目，第一步先 Read 本文件。
> 最后更新：2026-08-21
> 配套脚本：`学习经验.bat`（灌入本地记忆实现自动学习）、`同步推送经验.bat`（优化完推回共享库）

---

## 0. 跨账户共享使用说明（新人必读）

### 为什么需要这个文件
- AI 的本地记忆 `project_memory.md` 存放在 `C:\Users\<当前Windows用户>\.trae-cn\memory\projects\...`，**绑定 Windows 账户**。
- 换一个 work 账户登录，AI 看不到旧经验，等于从零开始。
- **本仓库文件跟随 Git**（会 commit + push 到 GitHub），任何账户、任何电脑打开同一个项目，都能读到同一份经验。
- 因此：**以仓库内 `KNOWLEDGE.md` 为准（单一权威源），本地记忆只是它的刷新副本。**

### 三个动作
1. **学习共享经验**（新账户首次登录必做，之后每次会话自动生效）：
   双击 `.trae\学习经验.bat` → 把本文件同步到当前账户的本地 AI 记忆（`project_memory.md`）。
   之后每次打开本项目，AI 都会自动加载这份经验。
2. **读取**：每次会话开始，先 Read 本文件 + 按需读 `.trae/project_rules.md`、`.trae/decisions.md`、`.trae/history_bug_summary.md`、`.trae/documents/`。
3. **沉淀经验**（每次优化/修复完成后）：
   - 把本次「结论 + 生效方式」追加到本文件相应章节，然后 `git add` + `commit` + `push`（AI 默认自动执行）；
   - 也可手动双击 `.trae\同步推送经验.bat` 一键推送到 GitHub，其它账户即可拉到。

> 约定：**本地记忆永远由仓库 `KNOWLEDGE.md` 派生**，不要反向往仓库里抄已过期的旧内容。

### 已建立的跨账户共享机制（2026-08-20）
- 单一权威源 = 仓库 `.trae/KNOWLEDGE.md`（随 Git 走）；各账户本地 `project_memory.md` 只是它的刷新副本。
- 新账户首次学习：运行 `学习经验.bat`（把 KNOWLEDGE.md 同步到当前账户 `%USERPROFILE%\.trae-cn\memory\projects\<本项目记忆目录>\project_memory.md`）。
- 优化完成沉淀：更新本文件 → `git commit` + `push`（或用 `同步推送经验.bat`）。
- ⚠️ 记忆目录定位坑：这台机器上 `kyt-zy` 存在**多个路径哈希变体**（如 `-d-trae-projects-kyt-zy--p2-7eaa1b1ed0ff6e40dc09` 是当前正式目录；旧的 `-D-trae-projects-kyt-zy`、`-c-Users-61767-Documents-trae-projects-kyt-zy`、`-d-trae-projects-kyt-zy-offline-project` 等是历史残留）。定位必须用**精确哈希名**，禁止用 `*-trae-projects-kyt-zy*` 通配（会误匹配到 `offline-project` 等另一个子项目）。

---

## 1. 开工铁律（每轮优化前必读，宁可漏检不可误报）

### 1.1 界面保护（最高优先级铁律）
- 禁止改动界面 HTML 结构和 CSS 样式；只允许改逻辑文件（main.js / auth-core.js / cloud-api.js / build.gradle / proguard / build.*.bat 等）。
- **优化前先运行 `check-interface.bat` 建立基线，优化后再运行它验证界面未被破坏。**
  - 若报告 WARN：立即 `git checkout` 恢复，或告知用户确认后再重新生成基线。
- APP/桌面/网页三端操作界面已基本适配，`index.html` 的 `<body>` DOM、`<style>`、`mobileNav/mobileActionBar` 按钮配置、`login.html/login.js` 的 UI 部分一律禁止改。

### 1.2 版本标识 8 处联动（改版本文本必查）
| # | 位置 | 文件 | Grep 关键词 |
|---|------|------|-----------|
| 1 | 登录页 version-tag | index.html | `class="version-tag"` |
| 2 | 顶部 tab-hint | index.html | `tab-hint` 内版本文本 |
| 3 | JS IIFE textContent | index.html | `tag.textContent` |
| 4 | console.log | index.html | 版本号 |
| 5 | showHelp() alert | index.html | `showHelp` 内版本 |
| 6 | exportInfo.version | index.html | `exportInfo` |
| 7 | 登录框 version-tag | electron/login.html | `class="version-tag"` |
| 8 | HTML `<title>` | index.html | 版本号 |
**每次 Edit 后必须用 Grep 验证 8 处全部生效（并行 Edit 可能静默失败）。**

### 1.3 CSP `connect-src 'self'` 拦截云端 API（高频坑，必查）
- 判定某 index.html 是否会被拦，看三件事：①是否 file:// 本地 WebView / Electron loadFile 加载（非 pages.dev 同源）；②渲染进程是否有 fetch 到 `pages.dev` 的云端 API；③`connect-src` 是否含 pages.dev。三者具备才是 bug。
- 修复：head 的 `connect-src 'self';` 追加 `https://tcm-prescription-system.pages.dev https://*.pages.dev;`（只改 head 安全策略，不动 body/样式，check-interface 仍 6/6 OK）。

### 1.4 桌面/APP 打包前自检
- 桌面版(Electron)问题排查：**先运行 `build.bat` 确认打包成功**（pre-build-check.js 能发现 package.json build.files 缺失），成功后再查代码逻辑。
- 每次在 index.html 新增 `<script src="xxx.js">`，必须同步检查所有桌面版 `package.json` 的 `build.files` 列表是否包含该文件，避免打包后 exe 缺脚本导致函数未定义。
- PE 区段嵌入类修改（pe-guard）验证必须实际启动被嵌入的 exe，仅跑哈希校验不查布局会放过 "not a valid application" 级损坏。
- 改 `shared/pe-guard.cjs` 后用 `git diff --no-index` 验证三处副本一致（shared + db-offline/desktop/electron + db-yunduan/cloud_desktop/electron）。
- 离线桌面打包固定两段式：`--dir`(rcedit 完成) → `pe-zone-sign embed+verify` 阻塞门禁 → `--prepackaged` 出 nsis/portable（electron-builder 顺序为 afterPack→rcedit，afterPack 内嵌入的哈希必被 rcedit 作废）。

### 1.5 多副本同步纪律
- `auth-core.js` 有 **9 处副本**（public/shared/site-admin/cloud_desktop/db-offline 各端），改挂载/调用必须保证全部副本一致。
- `cloud-api.js` 有 **8 处位置** 需同步；APP 版 cloud-api.js 必须含 `typeof window._cloudReachable === 'undefined'` 防御性初始化。
- 全局变量一律 `window.xxx` 访问；跨脚本/跨 IIFE 调用一律 `typeof fn === 'function' && fn(...)` / `global.fn && global.fn()` 防御式写法。
- 改云端 APP 界面必须在 `public/` 改并推 GitHub（APP 是 WebView 壳，内容取自线上 public/）；改 APK 内 assets/public 无效。

### 1.6 模型调度（hard）
- 方案/链路/审查/风险评估 → `Seed-2.1-Pro`（强制，禁 Auto）；简单实现 → `Seed-Code`；复杂后端/登录激活 → `DeepSeek-V4-Flash`；深层疑难/大重构 → `DeepSeek-V4-Pro`；批量扫描 → `Seed-2.1-Turbo`（仅扫描）。
- 每轮代码修改完成，**必须切回 `Seed-2.1-Pro` 独立审查**，通过后才能 commit。

### 1.7 Git / 打包合规
- 修改完成自动 commit + push（Cloudflare Pages 依赖 GitHub 推送自动部署）。
- `.bat` 含中文：UTF-8 无 BOM + `chcp 65001`；`.bat` 必须 CRLF；`if()else()` 内 echo 禁止未转义英文括号（括）。
- 打包产物（程序/APK）禁止自动上传官方下载网站，必须人工检查合规后手动上传。
- API 打包输出统一到各项目根目录；一键打包默认启用严格模式，无需回车确认。
- 基线（interface-lock）必须随代码一起 git 提交，杜绝"本机有、别人没有"。

---

## 2. 2026-08-20 关键经验（含 root cause + 举一反三）

### 2.1 离线系"管理员激活后手机号登不进去" 最终根因（提交 cf28e711）
- 现象：重装新 APK、走完管理员激活(密码留空)、用 手机号+admin 登录仍报"手机或密码错误"。
- 根因：`addLocalActivationUser` 只在 index-app.html 定义，且 `onAdminActivated` 只在 `installAdminLicense` 成功分支调用；离线桌面用 desktop/index.html 未定义它；license 空/写 license 抛异常走 else/catch 分支同步也不执行 → local_systemUsers 里没有手机号账号 → 登录必然失败。
- 修复：`onAdminActivated` 入口**无条件**同步手机号账号到前端登录表（不再放 install 成功分支内），password 留空默认 admin；desktop/index.html 也补 `window.addLocalActivationUser`。
- 举一反三：激活码激活(试用转正)是已有账号操作无此隐患；云端各端登录走云端 token 不依赖 local_systemUsers，onAdminActivated 不同步也不影响，无需推广。
- 生效：离线 APP=重装 `惠康中医-本地.apk` 并重新走管理员激活(密码留空则登录输 admin)；离线桌面=重打包 exe 并重新走管理员激活。

### 2.2 离线 APP 管理员激活修复两连（重打包 惠康中医-本地.apk）
- 问题1：标准版"管理员激活"提交报 "Failed to fetch"。根因：离线 APP 内置 index.html 的 CSP `connect-src 'self'` 拦 fetch 到 pages.dev。**离线 APP 打包真正源是 `db-offline/index-app.html`**（build-app.bat 第97行 copy 覆盖 assets/public/index.html），只改 assets 会被覆盖，必须改 index-app.html。
- 问题2：激活后登入框用户名只读显示医师姓名，无法输入手机号。根因：标准版(personal)单用户设计把 loginUsername 设 readonly=doctorName，与"管理员激活=手机号登录"冲突。修复：移除 readonly，保留 doctorName 默认回填(可覆盖)，同步改 index-app.html + assets/public/index.html。
- 生效：仅离线 APP 重装 APK；用 手机号+密码(默 admin) 登录。

### 2.3 云端桌面历史处方空白根因 = CSP `connect-src 'self'`（提交 e5445c1f，重打1.2.70）
- 现象：桌面历史处方空白，网页/APP正常；此前修过 token 链路(login.js 补拉 token / preload getForceToken / config wgj token)均正确且 token 已持有，仍空白。
- 铁证：安装目录 `D:\Program Files\tcm-prescription-cloud\data\login_debug.json`（saveUserData 写这里，不是 AppData!）只记录到 `getAllUserPrescriptions_token`，缺 `_resp` → `fetch('https://tcm-prescription-system.pages.dev/api/prescriptions')` 被拦从未返回。
- 根因：`cloud_desktop/index.html` 首行 CSP `connect-src 'self'`；桌面是 electron loadFile(file:// 来源) 判跨域被拦。
- 修复：connect-src 追加 pages.dev 域名 + getAllUserPrescriptions 的 catch 加 login_debug 记录 fetch 错误。验证用 7za 解 portable exe 内 app.asar 读 index.html（注意 `dist/win-unpacked/resources/app.asar` 可能是锁住的旧残留，以 exe 内实际为准）。
- 生效：仅云端桌面重打包重装 1.2.70 Setup exe 并重新登录一次。

### 2.4 云端 APP 历史处方空白根因 = 本地登录分支不写 token（提交 16743e80）
- 现象：云端 APP 登录 wgj 历史空，网页同账号 19 条；三端各不同。
- 根因：云端 APP handleLogin「本地用户匹配成功」分支从不写 auth:currentUser/currentUser 的 token（仅写 user_login_data）；读处方必须从 localStorage token 才走云端 API，全空则回退本地空缓存。
- 修复：本地登录成功后检测无 token 时，用输入账号调 `AuthCore.login(matchedIdentifier, password, {adapter: AuthCore.cloudAdapter})` 换云端 token，写 currentUser/cloud_currentUser/auth:currentUser/sessionStorage。同步 public/index.html（线上运行）与 cloud_app/assets/public/index.html（打包源码）。
- 举一反三：本地登录直通分支绕过云端认证导致 token 永远缺失，属「跨端登录路径不一致」隐患；若再遇"某端数据空、他端正常"，优先查该端登录分支是否写 token。云端 APP 是 WebView 载入线上 public/，逻辑必须在 public/index.html 验证。

### 2.5 一号码只能注册一次（提交 57ffb018）
- `functions/api/_lib/auth.js` 新增 `findPhoneOccupancy(kv, phone)`（register-clinic/check-register/admin-submit 共用）：admin_phone 索引优先、admin_req_index 兜底。kind=pending_activation / activated。
- 三道拦截（409）：手机号已有账号→"已注册，请直接登录"；已有 pending→"激活申请正在审核中"；已 activated→"已激活开通，请直接登录"。admin-submit：已 activated 短路复用；已有 pending 拦截。
- 关键边界：admin-submit 不因"手机号已有云端账号"而拦截——支持云端+本地多端共享同一手机号；拦截仅针对重复注册/重复激活申请。
- 生效：仅后端 functions，推 GitHub 自动部署；网页/APP 在线生效；桌面/离线不受影响。

### 2.6 云端注册审核制（提交 a55d08c5）
- 模式：注册即建号+审核闸门（无试用）。登录框"软件激活"→"注册开通"（云端三端统一注入），一页式表单（诊所名/姓名/手机号/密码），手机号即登录账号，注册即时建号 status=test。
- 收费=审核动作：后台"审核通过"确认线下收款后 test→active 自动写 expiresAt=+365天；"续费1年"=renewDays:365 顺延。后台显示剩余天数（≤30 黄 / 已到期 红）。
- 登录闸门（密码验证成功后检查）：clinicStatus=test→403 PENDING_APPROVAL；clinicExpiresAt 过期→403 CLINIC_EXPIRED；disabled→CLINIC_DISABLED。
- 存量兼容：旧 active 无 expiresAt=长期有效；旧激活流程的 admin_phone 自愈/密码归一化补丁保留。

### 2.7 工程优化（提交 a1efda05 + 5a89ffd2）
- 登录锁定：前4次输错不锁定，第5次起渐进锁定（5 分钟起步逐步增至 1h 封顶）；正确登录自动清零。后台诊所管理/用户管理新增 🔓解锁按钮（unlock 接口 + 操作日志）。
- 诊所管理密码修改：按输入的管理员账号精确定位用户，不再改第一个管理员密码；编辑弹窗"管理员账号"字段必填。

### 2.8 注册/登入/试用/激活全链路体检（2026-08-20 晚，一次修2个回归）
- **回归1（严重）：bd5d9cf5"docs交接"提交误删 cf28e711 的修复**——三处离线 auth-core（desktop/ + desktop/electron/ + app assets/public/）的 `onAdminActivated` 内 `addLocalActivationUser` 无条件同步被整体删除，"管理员激活后手机号登不进去"会复现。本次已恢复（onAdminActivated 入口处无条件同步，install/else/catch 哪支都先补入本地登录表）。
  - **教训：交接/docs 类提交严禁夹带代码删除；每次提交后必须 `git show --stat` 核对改动文件清单，防止"顺手回滚"。**
- **回归2（隐蔽）：matchedIdentifier 块级作用域 bug 让"本地登录补拉token"修复从未生效**——public/index.html 与 cloud_desktop/index.html 中 `const matchedIdentifier` 声明在 for 循环体内，循环外 `AuthCore.login(matchedIdentifier||username,...)` 引用必抛 ReferenceError，被外层 try-catch 吞掉 → 云端网页版/云端桌面的补拉 token 静默失败（历史处方空白在该场景仍会复现）。云端APP（cloud_app assets）最初写法就正确（`let` 循环外声明）。本次两端统一改为循环外 `let matchedIdentifier = username;`。
  - **举一反三：for 循环内 const/let 声明的变量，循环外引用是 ReferenceError 不是 undefined；被 try-catch 包裹时完全静默。审查跨作用域引用必须看声明位置。**
- 全链路体检结论（均无问题，无需改动）：①CSP 各端已放行 pages.dev（public/ 为线上同源无需放行）；②permission.js INST_ED（含 cloud）11 副本一致，site-admin 为后台精简版无版本按钮概念（差异合理）；③auth-core 云端组 5 副本一致、离线组 3 副本一致；④后端登录闸门（PENDING_APPROVAL/CLINIC_EXPIRED/CLINIC_DISABLED）错误消息经 cloudAdapter `(data&&data.error)||默认文案` 透传展示正常；⑤安全防护符合"宁可漏检不可误报"（Root/调试器/Frida/Xposed/模拟器仅 Log.w，仅 APK 签名校验 toastAndExit；NDK securityguard 失败自动回退 Java 不闪退）；⑥试用期链路可靠（trial-denied.dat + 服务端 hwFp 一次性登记 + 无网宽限 + 试用强制 personal 标准版）；⑦标准版=修改密码/机构版=用户管理 规范已由 2e8af3a2 落地并经 enforceStandardEditionButtons 兜底。
- 生效：云端网页版=推 GitHub 自动部署；云端桌面=需重新 build.bat 打包 exe 重装；离线桌面=需重新打包 exe 并重走管理员激活；离线APP=需重打 APK 并重走管理员激活；云端APP=线上加载 public/ 自动生效（无需重打）。

### 2.9 后台管理 P0-P2 全量优化（2026-08-20 深夜，提交 64ffc422 + 260dcec6）
- **P0 收费安全**：clinic=update 收费动作（test→active 审核 / 续费 renewDays>0）强制 `payNote`(≥4字符) + `confirmPassword` 平台管理员密码复核，复核失败写审计 `fee_confirm_failed`；停用/退回待审核必填 `reason`。**收费=动钱的动作必须有二次凭证（备注留痕+密码复核），纯 confirm 不可接受。**
- **P0 用户接口**：`action=update-user`（disabled/role/name，platform_admin 拒改防锁死，停用撤销全部 token）；`action=reset-password`（按 username/phone 精确定位+自动 clearLoginFailures）。登录前用户级停用闸门 `USER_DISABLED`（403）。
- **P1 后台 UI**：待办中心（三卡聚合+60s 轮询角标+双轨手机号交叉提示）；用户管理从只读升级（搜索+诊所/角色筛选+改密🎲随机/启停/角色/解锁）；四个模态框（收费确认/状态原因/诊所编辑/重置密码）替代 confirm/prompt。
- **P2 会话安全**：后台 token 迁 `sessionStorage`（关标签即失效）+一次性清理旧 localStorage 键；2 小时无操作自动登出（任意点击/键盘重置计时）。
- **P2 审计日志**：`GET /api/audit-logs?dateFrom&dateTo&username&action&limit`（仅平台管理员；KV 分片 `audit_log:{clinicId}:{date}` TTL 90 天；≤31 天跨度；分批 20 键并发；UA 截 120）。后台"操作日志"Tab 展示，诊所 ID 经 `_clinicsCache` 映射名称。
- **修复2个 bug**：①`openClinicEditModal` 从未设置 `_editClinicId`，保存必失败（模态框打开函数与保存函数间的隐藏全局状态，必须在 open 时赋值）；②HTML 新写的 `userResetPwdModal` 与 JS 起初写的 `userPwdModal` 两套 ID 不匹配——**续写前轮中断的大文件，先 Grep 已有模态框 HTML 再写 JS，禁止重新发明同名组件**。
- **拦截1次回归**：提交前 `git diff --stat` 发现三处离线 auth-core.js 各 -13 行（又是 addLocalActivationUser 无条件同步被删，2.8 回归1 第三次出现）。`git checkout --` 恢复。**教训：每次提交前必须核对 diff 文件清单中是否混入与本次任务无关的删除。**
- **2.9.1 解锁/重置密码合并为统一账号救援（提交 890e5e07）**：删除后端 `action=unlock` 独立分支，`reset-password` 的 `body.password` 改为可选（留空=仅解锁，填写=重置并自动解锁），统一返回 `reset/wasLocked/message`；前端用户管理「🔓解锁+🔑改密」两按钮合并为「🔓/🔑 解锁重置」一个弹窗入口，诊所管理行的 🔓解锁 也走同一弹窗（openUserResetPwdModal 支持用户缓存未命中时 `{username}` 兜底）；删除 unlockAccount/unlockUserAccount 两个重复函数，净减 70 行。审计仍按实际动作分别记 unlock_account / reset_password。
  - **教训重演：同消息内 3 个并行 Edit 中 1 个静默丢失**（诊所行按钮改动被后续编辑覆盖回旧值），Grep 复查才发现。**同一文件的多个 Edit 必须串行执行，且每个 Edit 后立即 Grep 验证生效——这不是版本号专属规则，是所有 Edit 的通用规则。**
- **2.9.2 【严重】后台双副本失同步——P0-P2 与 2.9.1 从未上线（提交 a0e2710d 修复）**：`wrangler.toml pages_build_output_dir="public"`，线上 `/admin/` 部署的是 **`public/admin/index.html`**；而 64ffc422(P0-P2) 和 890e5e07(解锁重置合并) 只改了源码 `site-admin/admin/index.html`，两副本自 b5ac10f1 后失同步，用户线上一直看旧界面（独立"🔓 解锁 🔑 重置密码"按钮）。修复=全量同步 site-admin→public/admin，并补部署 index.html 顶部链接的 build-queue.html / ticket-approval.html（此前线上 404）；activation-codes.html 无引用不部署。
  - **新硬约束：后台双副本纪律（同 auth-core 9 副本）——凡改 site-admin/admin/*.html 必须同步 public/admin/*.html，提交前 `git diff --no-index site-admin/admin public/admin` 核对一致。**
  - **举一反三：凡是"改完推 GitHub 自动生效"的断言，必须先确认改动文件真的在部署目录（public/ 或 functions/）内；改了非部署目录的源码副本=白改。2.9/2.9.1 的"生效方式"段全部作废，以 a0e2710d 为准。**
- **2.9.3 双向分叉第二刀：整文件覆盖又丢了旧版独有功能（提交 b8626456 修复）**：2.9.2 用 site-admin 整文件覆盖 public 时，把旧线上版独有的 **🖥 测试机管理 Tab、🔓 设备绑定 Tab、用户表"允许模式"列** 一并覆盖丢失（旧版这些功能直接写在 public 副本里，site-admin 副本从未有过）。本次自 b5ac10f1 移植回归：卡片式 CSS + fmtEndTag + 6 个函数（loadTestMachines/addTestMachine/removeTestMachine/loadDeviceBindings/queryDeviceBinding/unbindDeviceBinding）+ 2 个 Tab 区 + switchTab 分支；后端 /license/admin-test-machine、/license/admin-device-version 接口未变无需改。最终导航：待办中心/激活码管理/激活审核/诊所管理/用户管理/测试机管理/设备绑定/操作日志。
  - **教训：双副本合并永远禁止整文件覆盖方向单一化——必须先 `git diff --no-index` 双向比对，确认两侧各自独有改动都保留后再同步（等价于手动 merge）。旧版审计日志 Tab（诊所下拉+CSV导出+动作中文下拉）比新版操作日志 Tab 略强，暂保留新版，后续可补 CSV 导出。**
- **2.9.4 【最严重】CI 构建全挂一整天，所有"已上线"全是假的（提交 4730efa9 修复）**：`functions/api/license/admin-submit.js:34` 的 `import { findPhoneOccupancy } from '../../_lib/auth.js'` 路径错误（license/ 出发 ../../ 到 functions/_lib 不存在，正确为 ../_lib/auth.js），由 3a3905cd 引入。此后 **Cloudflare Pages 连续 24+ 个部署全部 Failure**（esbuild Could not resolve），生产一直停留在旧版本——2.4 云端APP token 补拉、2.5 一号码注册一次、2.6 注册审核制、2.7 渐进锁定、2.8 体检修复、P0-P2 后台全套、2.9.x 全部**从未真正上线**，但当时都断言"已生效"。修复后 `npx wrangler pages functions build functions` 本地复现验证（修复前报错/修复后成功），push 后部署 9500c995 上线。
  - **诊断工具链（重要沉淀）**：`npx wrangler pages deployment list --project-name=tcm-prescription-system` 查部署状态（本地已 OAuth 登录 61767126@qq.com）；`npx wrangler pages functions build functions --outdir=_tmp` 本地复现 CI 的 functions 打包。**凡"推 GitHub 自动部署生效"的改动，必须查 deployment list 确认 Success 才算上线。**
  - **新硬约束：改 functions/ 任何 import 后，提交前必须跑 `npx wrangler pages functions build functions` 本地打包验证（node --check 只查语法不查路径解析）。**
  - **上线后连锁生效**：注册审核制闸门（clinicStatus=test 登录被拒 403 PENDING_APPROVAL）、一号码注册一次、渐进锁定（前4次不锁第5次起锁）、收费复核弹窗等全部随本次部署激活。存量 test 状态诊所（XXX中医诊所）需在待办中心审核通过后才能登录。
  - **工作区遗留**：一批软著材料删除（v*_*.png / source-code-document.txt 等 18 文件）为前会话未提交的工作区改动，与本次无关未纳入提交。
- 验证手段沉淀：`new Function(内联script)` 做语法检查 + 正则比对「HTML onclick 引用函数 vs JS function 定义」（87 引用全命中）；check-interface.bat 6/6 OK（site-admin 不在界面保护基线内，属本次授权改动范围）。
- 生效：仅 functions/ + site-admin/，推 GitHub 自动部署即生效；后台 https://tcm-prescription-system.pages.dev/admin/ 直接可用；云/离线客户端零改动无需重打包。

### 2.10 软著鉴别材料定稿（提交 f7200bd4）
- **判定：必须重新生成源码 PDF**——auth-core.js 重构+新增 security-guard/permission/patient-archive 等模块属实质改动，超出 BUG 修复范围。产出 60 页（前30+后30连续）源码 PDF + 31 页说明书 PDF + 人工核对清单，全部在 `software_copyright/`。
- **截图采集工具链**（可复用）：`shot-server.cjs` 起本地静态服务（`/__seed` 写种子数据、`/__demo?st=xxx` 状态化演示路由、服务端内存注入 DEMO_BOOTSTRAP 绕过加密登录直接复置登录态）+ `cdp-shot.cjs` 用 CDP 真实时间截图（headless 虚拟时间下 crypto.subtle/IndexedDB 挂起是根因，CDP+真等待解决）。截图每张顶部注入演示标题条保证"惠康中医诊所管理系统 V1.0.0"完整可见。
- **三个高频坑**：①index.html 内打印模板字符串含多个 `</body>`，注入必须用 `lastIndexOf('</body>')`；②npm install 在根目录会污染 package.json/package-lock.json（用后 `git checkout --` 恢复，或装到子目录）；③PowerShell 不支持 bash heredoc（`$(cat <<'EOF')`），git commit 多行 message 用 `$msg = @'...'@; git commit -m $msg`。
- **源码 PDF 每页≥50行达标法**：清理注释空行后对超宽行（>116 视觉列，中文算2列）做物理折行（续行缩进2空格、优先空格处断），分页器每行成本恒为1，每页恰好58行；HTML 层验证（页数/页眉/页码连续/行宽）+ 渲染层验证（Puppeteer 查每页 scrollHeight≤clientHeight 防溢出截断）双层把关。
- **PDF 视觉终检法**（无 poppler 环境）：Edge headless 打开 file:///*.pdf（PDFium viewer，`waitUntil:'domcontentloaded'`+手动等待，networkidle0 会超时）截图，再 base64 data URL 画 canvas 按行统计墨迹（file:// 直接画会 taint canvas）——页眉带/页脚带墨量+图片页墨量骤增可证实页眉页脚与截图真实渲染。
- 敏感信息：11 个自研模块程序化扫描 0 处硬编码密钥/密码/长常量，无需涂黑（涂黑规则保留在 build-source-pdf.cjs 的 maskSecrets，供未来有密钥时用）。
- **2.10.1 售卖合规终稿（提交 06d4551e，兼容拼多多对外售卖）**：①说明书 4 处"适用于单/多医师诊所"→"适用于单/多医师业务数据记录场景"（去诊所绑定）；②附录 E.1 软件用途换定稿文本，删"仅用于本单位/不对外销售分发"限制商用语句（**软著材料禁止出现约束商业行为的表述，否则与对外售卖实际业务冲突**）；③源码 PDF 剔除 afterPack.js（引用第三方 asarmor 属构建层）、重排模块使后 30 页收尾于 permission+db-adapter（权限校验+数据保存）、新增 scrubPath 兜底清洗 git 路径/github 链接/TODO/FIXME。改动纪律：说明书 md 仅 10 行最小 diff，忠于原文不大规模改写。
- 生效：纯文档产出，各端零改动无需重打包；软著材料提交前按 `software_copyright/提交前自检核对清单.md` 人工逐项打勾。

### 2.12 auth-core 四次"神秘回退"根因 = sync-auth-core.ps1 权威源机制（提交 f2925cb9，2026-08-20 晚）
- **机制**：`tools/sync-auth-core.ps1` 是 auth-core 唯一权威分发器，权威源=`shared/auth-core/offline.js`（→离线3副本）与 `shared/auth-core/cloud.js`（→云端8副本），`db-offline|db-yunduan 的 build-pack.bat` 每次打包都会用它**强制覆盖**目标副本。
- **事故链**：AI 直接改三副本（或恢复修复）却没回写 `shared/auth-core/offline.js` → 用户下次打包 → 旧权威源把副本打回原形 → addLocalActivationUser/客服按钮等新代码静默消失。**历史上"bd5d9cf5 误删""三次反复丢失"其实都是此机制，不是人为误删！**
- **铁律（新增）**：改任何 auth-core 副本，必须把最终版**回写 shared/auth-core/offline.js 或 cloud.js**，然后跑 `powershell -File tools\sync-auth-core.ps1` 验证 11/11 in sync。只改副本=白改，下次打包必回退。
- **连带教训**：打包产物异常时先看时间戳定位是哪次打包（如 20:56 离线打包 1.0.78 内含旧 auth-core）；云端 build.bat 不会碰 db-offline，跨端改动需查对方打包日志。
- **installer.nsh 升级卡死修复**（同提交）：双端桌面 installer.nsh customInit 加 taskkill 先温和后强制关旧版，解决"惠康中医-云端无法关闭请手动关闭"安装弹窗（旧版后台常驻：开机自启 --hidden 参数实际无隐藏处理逻辑，照常弹登录窗）。
- 生效：云端桌面=装 1.2.74+ Setup；离线桌面=需重打包（20:58 自打的 1.0.78 含旧 auth-core，客服按钮/激活同步修复缺失）。

### 2.13 "无法关闭"弹窗真正根因 = electron-builder 内置检查 + customCheckAppRunning 接管（提交 41b6f3df，Setup 1.2.75）
- **为什么 1.2.74 的 customInit taskkill 无效**：弹窗出自 electron-builder 模板 `templates/nsis/include/allowOnlyOneInstallerInstance.nsh:110` 的内置 `_CHECK_APP_RUNNING`（安装节 installSection.nsh:33 插入，非 .onInit）：内置逻辑 taskkill 两轮后仍检测到进程 → MB_RETRYCANCEL 死循环框。customInit 在 .onInit 确实先跑，但若 taskkill 后内置 FIND_PROCESS（nsProcess）仍报存活（Electron 多进程/权限/误报），框照弹。
- **根治 = 官方替换钩子**：`!macro customCheckAppRunning`（allowOnlyOneInstallerInstance.nsh:33 `!ifmacrodef customCheckAppRunning` 优先走用户宏）。双端 installer.nsh 定义之：`taskkill /f /t`（连子进程树）两轮 + Sleep，**无 MessageBox 无 Quit，永不阻塞安装**（宁漏检不可误报；极端文件锁由 NSIS 复制原生重试兜底）。
- **宏可见性依据**：NsisTarget.js:615 `scriptGenerator.build() + originalScript` → 用户 installer.nsh 排在所有模板 include 之前，`!ifmacrodef` 判定时宏已定义。
- **验证方法（makensis 编译级）**：搭最小 .nsi（用户 nsh 在前 + include allowOnlyOneInstallerInstance.nsh + 插 CHECK_APP_RUNNING）用 electron-builder 缓存的 makensis 编译：①顺序错误时出现 `_GetProcessInfo not referenced`/`Var pid` 警告（走内置分支）；②顺序正确时警告消失 = 走接管分支。7za 无法解 NSIS 安装包脚本（Files: 0），字节搜索也无效（数据块压缩）。
- 生效：云端桌面=**Setup 1.2.75**（dist 已产出，81.6MB）；离线桌面=下次重打包自动带上（此前自打的 1.0.78 为旧 nsh+旧 auth-core，建议重打）。

### 2.14 F1 基础设置双激活入口合并（提交 52fe6905，2026-08-20 晚）
- **现象**：基础设置弹窗同时出现「🔑 激活软件/管理员激活」（index.html 静态按钮→license.show 独立激活窗）与授权区「📋 管理员激活」（auth-core 注入→openAdminActivate 内嵌弹窗），均为 8-19 改动叠加所致。
- **修复**：auth-core injectLicenseStatusSection 的 hasLicenseApi 分支追加 `modalBody.querySelector('button[onclick*="openActivationFromSettings"]').style.display='none'`——授权区为唯一入口；**不改 index.html**（界面基线 6/6 OK）；无 license 桥的纯网页环境不注入按钮，静态按钮保留兜底。
- **流程**：改 shared/auth-core/{cloud,offline}.js 两权威源 → sync-auth-core.ps1 同步 11 副本 → node --check + check-interface.bat → 提交。**改 auth-core 必须走此流程**（2.12 铁律）。
- 生效：云端网页版=推 GitHub 自动生效；云端桌面/离线桌面/离线APP=需重打包（各自 auth-core 内置）；云端APP=在线自动生效（WebView 载线上 public/）。

### 2.15 版本按钮反复失灵终根因 = 版本状态双轨制（提交 8eedc2dc，2026-08-20 晚）
- **现象**：云端桌面机构版管理员（王桂杰）登录后显示【修改密码】而非【用户管理】；顶部标签却正确显示"云端机构版"。
- **根因（双轨制）**：版本标签走 `CONFIG.edition`（登录后 getAppConfig/refreshVersionTags 更新为 cloud_clinic）；按钮权限走 `Permission._edition`（**页面加载时 init 锁死**为 index.html 硬编码的 cloud_personal，且 init 的"漂移防护"还会反向把旧值写回 CONFIG）。→ isInstitutional()=false → shouldShowUserManage=false → 用户管理隐藏、改密显示。
- **修复（shared/permission.js 权威源，8 客户端副本同步）**：
  1. 新增 `_currentEdition()` 动态读取链：CONFIG.edition → window.EDITION → this._edition，每次判定实时读取，登录/激活/配置同步任何一处更新立即生效；
  2. isCloud/isOffline/isPersonal/isInstitutional/_isStandardEditionForced/applyRuntimePermissions/applyLoginPermissions 全部改用动态值；
  3. init 漂移防护方向反转：CONFIG.edition 权威 → Permission 采纳（不再反向覆盖）；
  4. 新增 setEdition(ed) 三处同写（_edition/_config/CONFIG）。
- **为什么这次能根治**：桌面 tab 按钮（updateUserDisplay）与 APP 底部按钮（updateMobileActionButtons）**全部**经 Permission.shouldShowUserManage → 修一处=桌面+APP 全端生效；标签与权限从此读同一来源，永不分道扬镳。
- **副本纪律**：permission.js 权威源=shared/permission.js，客户端 8 副本（public×2/cloud_desktop×2/cloud_app/db-offline×3）必须同步；**site-admin 2 副本是后台精简版，不同步**（无版本按钮需求）。
- 生效：云端网页版=推 GitHub 自动生效；云端APP=在线自动生效；云端桌面/离线桌面/离线APP=需重打包（permission.js 各自内置）。

### 2.16 版本按钮缺失第二层根因 = 本地表 role 与云端不同步（提交 f198252b，Setup 1.2.77）
- **现象**：装 1.2.76（含 2.15 permission 动态判定）后机构版管理员【用户管理】【修改密码】**两个按钮都没了**——比之前更糟。
- **双层层因**：①云端桌面 handleLogin 是**纯本地 local_systemUsers 校验**（index.html 无独立云端登录分支，1441 else 直接报密码错误），账号进本地表时 role 是默认值（user），不是云端后台设置的 clinic_admin → isClinicAdmin=false → canManage=false；②2.15 修复让 isInstitutional()=true 生效 → canChangePwd=！isClinicAdmin=false（机构版管理员正确隐藏改密）→ 两按钮全隐藏。**改密消失恰是 permission 修复生效的证明**，断点在 role。
- **修复（public/index.html + cloud_desktop + cloud_app assets 三副本同步）**：本地登录后的云端补拉分支——①补拉条件 `!hasToken` → `(!hasToken || !user._cloudRoleSynced)`（旧短路使第二次登录起补拉永远跳过，role 永无同步机会）；②补拉成功用云端权威 cloudUser 的 role/clinicId/name 覆盖 user 并**回写 local_systemUsers**（下次登录直接正确）；③_cloudRoleSynced 标记保证每账号仅首次多一次 login 调用，规避渐进锁定计数风险。
- **举一反三**：本地表登录直通云端版时，**身份字段（role/clinicId）必须以云端为权威同步**，不能只同步 token（2.4 历史处方同理：token 缺失历史空白；role 缺失按钮空白）。
- 生效：云端网页版/云端APP=推 GitHub 自动生效；云端桌面=**Setup 1.2.77**；存量用户下次登录自动触发一次角色同步，无需清数据。

### 2.17 版本按钮缺失第三层（真正）根因 = window.CLOUD_API_BASE 未定义，2.16 角色同步从未执行（Setup 1.2.79）
- **现象**：装 1.2.77（含 2.16 角色同步修复）后机构版管理员依旧只显示【修改密码】、无【用户管理】。
- **根因**：云端桌面/云端APP 的 index.html **从未加载 cloud-api.js**（仅 684/694 行注释提及），而 `window.CLOUD_API_BASE` 只在 cloud-api.js 定义；auth-core.js 内部的 `const CLOUD_API_BASE` 是 IIFE 作用域。→ 2.16 的补拉判据 `typeof window.CLOUD_API_BASE !== 'undefined'` **三端中两端永假**（仅云端网页版加载了 cloud-api.js 幸免），rescue 从未执行过，role 永无同步机会。同被判据卡死的还有：云端改密 isCloudMode、云处方拉取（index.html 5370/5404）。
- **修复（auth-core.js 4 副本同步：shared/public/cloud_desktop/cloud_app assets）**：导出节增加 `try { global.CLOUD_API_BASE = CLOUD_API_BASE; } catch (e) {}`——auth-core 三端均加载，一处挂全局全端生效；网页版 cloud-api.js 同值覆盖/被覆盖均无害。CSP 已放行 `connect-src https://tcm-prescription-system.pages.dev`，网络层无障碍。
- **教训（三层根因叠加的复盘）**：2.15 修 permission 动态判定、2.16 修 role 同步逻辑，都正确但都没生效——**写 `typeof window.X !== 'undefined'` 判据前必须先 grep 确认 X 在本端真的有定义点**（脚本加载矩阵：public 有 cloud-api.js，另两端没有）。修完必须验证"修复代码路径可达"，而非仅验证"修复代码逻辑正确"。
- 验证：build.bat 打包 1.2.79 + asar 解包确认 `global.CLOUD_API_BASE = CLOUD_API_BASE` 已进 exe；check-interface.bat 6/6 通过。
- 生效：云端桌面=**Setup 1.2.79 重装**；云端网页版/云端APP=推 GitHub 自动生效（APP 从 URL 加载无需重打包）。

### 2.18 【底层重构】云端身份权威登录（Setup 1.2.80）——根治"本地 role 与云端不同步"整类问题
- **背景**：2.15/2.16/2.17 三层修复后用户仍见【修改密码】。用户明确要求"重新优化设计，底层优化比改来改去靠谱"。
- **架构决策**：云端版（网页/桌面/APP）身份**单一权威=云端登录响应**。本地表 local_systemUsers 从"身份权威"降级为"缓存+离线容错"。三层结构：
  1. **云端 API 优先**：本地表未匹配输入凭据时，直接 `AuthCore.login(username, password, cloudAdapter)`；成功即以云端 user（权威 role/clinicId/token）为登录身份，并 upsert 本地表缓存（password 置空=本地永不通路径，该账号后续登录始终云端权威）。
  2. **本地表校验回退**：云端失败（网络不可用/云端无此账号的旧本地账号/密码不同的旧激活账号）不阻断，回退原有本地表校验——**零回归**，旧激活本地账号（installLicense 建的 phone+admin）照常可登录。
  3. **rescue 标识符回退链**（本地成功路径）：本地用户名（如中文姓名"王桂杰"）云端常无对应账号（云端注册账号=手机号），补拉依次尝试 matchedIdentifier → user.phone → user.username；云端失败计数按输入串分开记，不叠加锁定风险。
- **登录失败提示升级**：最终失败时，云端返回的账号状态类错误（锁定/禁用/到期）优先于通用"用户名或密码错误"展示。
- **落地矩阵**：cloud_desktop/index.html + cloud_app assets/index.html（新增云端优先块+回退链+错误优先级）；public/index.html（已有云端回退，补本地缓存 upsert+回退链，保留其工作正常的早返回结构）。
- **修复覆盖场景**：新装机/换机无本地账号→云端直通✓；本地中文姓名账号+云端手机号账号→回退链同步✓；用手机号+云端密码登录任意端→云端直通+role 权威✓；纯本地旧账号→行为不变✓；离线→本地表容错✓。**唯一不覆盖**：本地账号与云端账号既无标识符交集、密码也不同——需用户用云端凭据登录一次。
- 生效：云端桌面=**Setup 1.2.80 重装**；云端网页版/云端APP=推 GitHub 自动生效。

### 2.19 【两大隐藏根因】1.2.80~1.2.82 全部"空包"（Setup 1.2.83 终版，提交 a49148d1）
- **根因A（打包链路）**：`dist/win-unpacked/resources/app.asar` 被系统级句柄锁定（杀毒/索引器，无用户进程可查，杀 explorer 无效，删/改名均 EBUSY）。electron-builder 打包 1.2.82 时**静默复用旧 asar**→exe 时间戳是新的（23:54）但 asar 还是 1.2.80 的（23:18），用户装的三版全部不含修复。**验证法**：`[System.IO.File]::ReadAllText(asar, ISO-8859-1).Contains('__appConfigReady')`（英文标识可靠；中文注释须 UTF8 读）。**对策**：打不进去就换输出目录 `npx electron-builder --win --config.directories.output=dist_new`，不跟锁死磕。
- **根因B（工作区脏改动）**：上次重构后工作区 auth-core.js 4 副本被删了 `global.CLOUD_API_BASE = CLOUD_API_BASE` 挂载（未提交、未记录），而 index.html 有 5 处判据 `typeof window.CLOUD_API_BASE !== 'undefined'`（rescue 登录 1382、角色同步 1442、云端改密 1773、云处方 5470/5504）→ 全部永假，2.17 的修复被无声废掉。**教训**：打包用的是**工作区**代码而非 HEAD！每次打包前必须 `git status` 看有没有未提交的 .js 改动；解包验证必须查"本次修复的标识串"是否在 asar 里。
- **1.2.83 asar 五项验证全过**：①__appConfigReady ②isCloudProduct ③global.CLOUD_API_BASE 挂载 ④竞态自愈×2 ⑤1.2.83。
- 生效：云端桌面=**Setup 1.2.83 重装**（dist_new 目录）；云端网页版/APP=推 GitHub 自动生效。

### 2.20 【举一反三】1.2.83 后全量副本审计——3 处漂移同步（提交 5c8323f5，2026-08-21）
- **审计法**：`Get-FileHash` MD5 对比全部源码副本 vs shared 权威版，10 分钟定位漂移，比逐文件 grep 快且无遗漏。
- **副本矩阵**（源码级，排除 build intermediates）：permission.js×11 / auth-core.js×11。**加载路径真相**：各端 index.html 均加载**根目录**副本（`<script src="auth-core.js">`），electron/ 子目录是冗余备份；云端APP 从线上 pages.dev 加载（MainActivity CLOUD_URL），assets/public/ 仅本地容错。
- **同步 3 处**（整文件复制+哈希验证）：①cloud_app assets/permission.js 缺判据3 云端保护（容错路径隐患）②cloud_desktop/electron/auth-core.js ③public/electron/auth-core.js（②③缺 CLOUD_API_BASE 挂载）。
- **不动项（设计如此，勿"修复"）**：site-admin 双副本（API 硬编码不依赖 window 变量）；db-offline 全系 auth-core（离线无云端概念，无挂载=正确）；db-offline permission 已与 shared 一致（云端保护对离线版 `isCloudProd=false` 不生效，无害）。
- **教训**：每次 shared/ 修复后必须全量哈希审计分发副本——本次 2.17 挂载修复只同步了 4 副本，2 个 electron 冗余副本漏网；若未来打包 files 配置改为加载 electron/ 路径就会复现"空修复"。

### 2.21 【离线桌面版同款竞态】Setup 1.0.79（提交 cd972ae6，2026-08-21）
- **根因**：与云端 1.2.83 同源但漏修——`checkLoginStatus` 自动登录跑在 `getAppConfig` 回调前，CONFIG.edition 仍为 asar 默认 personal → `enforceStandardEditionButtons` 命中 `IS_DESKTOP_LOCAL` 权威模式（离线版合法权威，云端保护不适用）→ role 降级 + 【用户管理】隐藏；配置就绪后豁免生效但**降级无人恢复**。
- **修复三件套**（db-offline/desktop/index.html）：①785 行挂 `__appConfigReady`（复用同一 Promise，800ms 兜底）②自动登录分支 await ③回调机构版自愈（localStorage 恢复 role + updateUserDisplay 刷新）。
- **排查确认无需改**：主进程 `get-app-config` 对正式机构版 license 正确返回 clinic+admin；**离线APP 版无此 bug**（config.json 走同步 XHR，无异步竞态，且每次手动登录）；permission.js 的 2026-08-19 机构版豁免已就位。
- **打包坑**：PowerShell `Set-Content -Encoding UTF8` 会写 BOM → electron-builder 报 `readObjectStart: expect { or n, but found ﻿`。改用 `[System.IO.File]::WriteAllText($f, $c, [UTF8Encoding]::new($false))`。
- **方法论**：跨端同源 bug 修一头后，必须审计其它端"同结构代码路径"（本项目：自动登录+异步配置+enforce 三要素组合在离线桌面版完整复刻了云端 bug）。

### 2.22 【按钮单隐根因+双保险正向兜底】Setup 1.0.80（提交 8d695b88 + 6c7dae45，2026-08-21）
- **现象**：1.0.79 修复后依旧两个按钮都没显示，但【处方查阅】显示。代码层面 userManageBtn 与 clinicPrescriptionBtn 用**同一 canManage 变量同赋值**，理论必须同显同隐——单隐只可能是"后续异步代码单独改了 userManageBtn.display 却不碰 clinicPrescriptionBtn"。
- **根因**：`Permission.applyRuntimePermissions()`（shared/permission.js 280-285 行）在 `isPersonal()` 时只隐藏 `userManageBtn`，完全不操作 `clinicPrescriptionBtn`。该回调在 Permission.init.then（异步）中触发，若发生在 `updateUserDisplay` 之后（微任务调度相对顺序未定），就把已经 `canManage→block` 的 `userManageBtn` 单独打回 `none`，而 `clinicPrescriptionBtn` 因从未被本函数触碰保持显示——**造成处方查阅=有、用户管理/改密码=全无的诡异三按钮不一致**。
- **修复策略（双保险正向兜底，单一入口）**：定义 `__healInstitutionBtns()` 作为机构版按钮"最终正确态"的单一落地函数，在 enforceStandardEditionButtons 的**7个出口**全部调用：三处豁免 return（configEdition/globalEdition/Permission._edition 机构版）、mustEnforce=false return、强制正常尾巴、catch 异常尾巴、函数最末尾终极对齐。同时在 `applyRuntimePermissions`（shared/permission.js）追加 `isInstitutional()` 分支——反方向兜底：机构版时显式恢复三件套 display/visibility 与权限对齐。
- **打包又一坑（asar 缓存复用）**：同一个 `output=dist_new` 目录重打 1.0.79→1.0.80，electron-builder 静默复用 appOutDir 下的旧 asar。验证显示版本号升了但修复标识（②自动登录await、⑤机构版正向兜底）全 False。**解方：每次重打必须 `Remove-Item -Recurse dist_new` 清空输出目录。**
- **修复六标识（asar 必含）**：①__appConfigReady ②自动登录await ③竞态自愈×2 ④__healInstitutionBtns ⑤permission.js 机构版正向兜底×2 ⑥1.0.80。1.0.80 清空 dist_new 后重打全部 True。
- **教训**：
  1. 只要"同一变量同步赋值"的两个按钮出现显示不一致，必是**有第三段代码单独操作其一**——grep 那个 id 的所有 `style.display` 赋值点（9次命中就能定位 applyRuntimePermissions 这个不对称隐藏）。
  2. 兜底策略必须"正反都覆盖"：不能只写 isPersonal→隐藏的单向路径，机构版反向恢复必须作为对称分支存在。
  3. electron-builder 相同 outputDir 重打包必然 asar 复用，必须清目录后重打。
- **举一反三**：本修复同步覆盖 shared→10 份 permission.js 副本（哈希一致）+ 云端版 enforceStandardEditionButtons 副本（public/index.html / cloud_desktop/index.html）需按同样结构补 __healInstitutionBtns 兜底（如尚未修复）。

### 2.23 【架构重构·四层根治】Setup 1.0.81 / 1.2.84（一劳永逸杜绝版本按钮类似问题）
- **历史代价**：1.2.77 → 1.2.80 → 1.0.79 → 1.0.80，四轮补丁后分别又出现【改密码】/【两按钮全无】反方向现象。每次只解决"最近一条赋值路径"，但**架构级六大设计缺陷**不根除，新 bug 必然复发：
  1. **多点写入竞态（最后写入赢）**：userManageBtn/changePwdBtn/clinicPrescriptionBtn 的 display 被 updateUserDisplay/enforce D 层 / applyRuntimePermissions / enforce catch 四处独立赋值，微任务调度顺序不定 → 按钮最终态是"随机函数"。
  2. **edition 三处状态分道**：CONFIG.edition / window.EDITION / Permission._edition 三写不同读、异步时序不同步（2.18 节"显示离线标准版但改密按钮缺失"的根因）。
  3. **代码副本膨胀人工点对**：11 permission.js + 11 auth-core.js + 3 个内嵌 enforceStandardEditionButtons，shared 修改后靠"人工哈希审计+整文件复制"，漏副本是必然事件（2.20 节检出 3 处漂移）。
  4. **打包后无自动验证**：electron-builder 静默缓存/复用旧 asar（1.2.80 和 1.0.80 第一次重打）——修复代码未落位、用户却安装以为修复。
  5. **两套强制逻辑打架**：`enforceStandardEditionButtons`（Setup 权威对齐）和 `Permission.applyRuntimePermissions`（运行时权限）彼此无通信、无优先级。
  6. **DOM 锚点判据与权威模式混淆**：`_force_standard_edition_marker_` HTML 锚点与 Setup 权威 IS_DESKTOP_LOCAL 并列 OR → 2.19 节"云端机构版被误伤"。

---

#### A 层：Single-Writer 按钮写入源（shared/button-manager.js）
- **设计原则**：三件套按钮的 display/visibility 只允许一个函数写入——`__applyUserButtons(user, edition)`。
- 实现：内部计算 `canManage/canChangePwd`（优先 Permission 类，降级兼容）后统一落 DOM，移动端 btn2 图标/标签/action 一并重设。
- **补丁入口**：`__patchOldCallers()`（DOMContentLoaded 后运行，确保内嵌函数已定义）运行时覆盖三个多写源：
  1. 覆盖 `window.enforceStandardEditionButtons` → 新内部版先做 edition/role 纠正（不动 DOM）→ 最后统一 `__applyUserButtons`。
  2. 覆盖 `Permission.applyRuntimePermissions` → 旧函数执行后再用 Single-Writer 对齐三件套（覆盖其不对称隐藏副作用），同步入口屏蔽（非按钮）保留。
  3. Wrapper `updateUserDisplay` → 旧函数跑业务逻辑（用户名显示等）后再 Single-Writer 覆盖三件套，消掉其内部的多写赋值。
- **结果**：任何异步回调执行顺序如何打乱，最终按钮永远由 `__applyUserButtons` 这同一计算逻辑落 DOM——**消除"最后写入赢"竞态**。

#### B 层：Edition 归一化锁（shared/edition-lock.js，Object.defineProperty 拦截）
- **设计原则**：CONFIG.edition 是唯一真源；setter 自动三写同步（CONFIG 存储槽 + window.EDITION + Permission._edition）。任何代码读取 edition 值永远同源。
- 实现：`Object.defineProperty(CONFIG, 'edition', {get, set})`。
  - getter 优先返回 `CONFIG.__authoritativeEdition`（由 electronAPI.getAppConfig 回调回写的权威插槽）→ 回落存储槽。
  - setter 三写同步后主动 `__applyUserButtons()` 刷新按钮。
  - CONFIG 是 `const` 对象但属性描述符默认可 configurable（对象字面量），拦截不抛错。
- **降级兜底**：拦截抛异常时（极少）退化为 2s×10 轮询把三处值对齐，不崩溃。

#### C 层：零 HTML 改动的入口注入（shared/permission.js 头部 + 构建文件复制）
- **硬约束**：用户 profile 要求"禁止修改 index.html（界面基线 SHA256）"——因此不能加 `<script src>`。
- **解决**：permission.js（index.html 已有 entry、已入库 files）最开头 `document.write` 同步插入两个脚本 `<script src="edition-lock.js">` + `<script src="button-manager.js">`。执行时 document.readyState==='loading'，补丁正确绑定 DOMContentLoaded。
- **脚本分发**：从 shared/ 复制到 3 个桌面版根目录 + cloud_app/offline_app assets/public（与 permission.js 同目录），并加入 3 个 package.json build.files 列表。

#### D 层：构建硬校验（tools/postbuild-asar-verify.cjs，失败即 exit 1 阻断 Setup 产出）
- **9 项标识清单**（任何缺失=EXIT 1）：①Single-Writer ②__patchOldCallers ③Edition 锁 ④拦截 get/set ⑤__appConfigReady ⑥竞态自愈×2+ ⑦机构版兜底×1+ ⑧自动登录 await ⑨asar 版本号。云端机构版附加 `_isCloudProd` 锚点保护。
- npm scripts.build 追加 `node ../../../tools/postbuild-asar-verify.cjs .`；builder 之后自动跑。支持 `--asar <path>` 覆盖默认 app.asar 路径（builder 自定义 output 时用）。
- 本次 1.0.81 回归 9 项全部 PASS。零修改 HTML → check-interface 6 OK。
- **生效**：cloud_desktop 升 1.2.84 / db-offline 升 1.0.81 / public 升 1.0.1；三张 package.json build.files + scripts.build 全部更新。

---

**结论**：六层设计缺陷全部闭环。后续新增任何按钮/版本相关功能：
1. 禁止直接 `getElementById('userManageBtn').style.display` → 必须调 `window.__applyUserButtons()`。
2. 禁止直接写 `window.EDITION = x` 或 `Permission._edition = x` → 必须 `CONFIG.edition = x`（走 setter 三写同步）。
3. permission.js 结构修改后，10 份副本哈希一致验证（KNOWLEDGE 2.20 方法论）。
4. 打包必须跑 postbuild-asar-verify.cjs，失败即不交付。
违反以上任一 = 架构"红线"，可直接在代码 CR 时打回。

### 2.11 激活流程一键微信客服（提交 2e6fcee8）
- **功能**：试用到期→激活提交全流程增加"一键联系微信客服"（复制微信号 hktzy1688 + 唤起微信 + 三步指引），等待审核面板与底部客服栏双入口。
- **复刻矩阵**（5 处，一处都不能少）：①离线桌面 activate-window.html+activate.js；②云端桌面 activate-window.html+activate.js（同款文件双项目各自改）；③auth-core.js 离线三副本（desktop/、desktop/electron/、app assets/public/，用 Copy-Item 整文件同步+fc /b 验证字节一致）；④MainActivity.java shouldOverrideUrlLoading 加 weixin:// 单 scheme 白名单 → Intent 唤起（未装微信仅 Log.w 不闪退）。
- **唤起链路按端**：桌面激活窗口=activate.js 给 activateWindow 加 setWindowOpenHandler（白名单 weixin:///https:// → shell.openExternal，主窗口已有无需改）；auth-core 内嵌弹窗=主窗口 main.js 既有 handler 直接过；APP=MainActivity 放行。
- **教训**：PowerShell 无 bash heredoc，多行 commit message 用临时文件 `git commit -F`（首条命令 parse error 时**整条命令含前面的 git add 都不执行**，重跑必须从 add 开始）。
- 生效：离线桌面/云端桌面=重打包 exe；离线 APP=重打 APK（MainActivity+assets 都改了）；云端网页版零改动。

### 2.24 【2026-08-21 全天】机构版按钮三连事故 → 最小充分集 T1-T4 根治（Setup 1.2.110，提交 f91e52c7/443c054c/d7d2e41d/674b7b8c）

**事故链（按时间）**：
- ①1.2.89 假包：dist 被 4 个旧惠康进程锁定 → asar 写失败 → NSIS 用旧 win-unpacked 打出"新版号+旧内容"。教训：打包前必杀 `Get-Process *惠康*`；用户报"新版无效"先看按钮 tooltip 的 Arch 水印，水印旧=假包/旧进程，别改代码；交付版本号必须跳号。
- ②1.2.96：7 道铁闸（copy-consistency 哈希、CONFIG.edition 写入端归一化、GATE-KEEPER 9 项、asar 备份恢复、final-verify 红线等）。
- ③1.2.98/Arch 2.26：登录页三元组（版本|Build时间|Arch水印）两行紧凑显示，登录窗 400→430px，fetch 3 路径重试，双挂载点。用户靠三元组自辨包真伪。
- ④1.2.101 用户管理按钮打不开：`getDefaultUsers()` 对 CONFIG.users 弱检查（`&& length>0`），非数组时 `.map` 抛 TypeError 且四层调用链无兜底 → 静默失败。

**最小充分集方案（T1-T4，全部完成）**：
- T1 构建冒烟闸：`tools/smoke-runtime.cjs`（铁闸8），零依赖 vm 沙箱 + 毒数据注入（C1-C7：非数组字符串/伪数组对象/undefined/毒 localStorage/坏 base64/往返）。
- T4 e2e×3：`e2e/run-e2e.cjs` Playwright，E1 登录、E2 用户管理开合、E3 毒数据注入后 modal 仍渲染兜底管理员。已接构建红线。
- T2 入口归一化：`shared/normalize-config.js`（`__normalizeIncomingConfig`），users/edition/maxUsers 单一收口净化，N1-N8 用例。
- T3 UserStore 权威源：`shared/user-store.js` + **标记块内联分发**（详见下）。

**T3 标记块架构（本次核心）**：
- 权威源 `shared/user-store.js` 生成自包含块（IIFE+薄包装），以 `// >>> USER-STORE` / `// <<< USER-STORE-END` 行首注释锚点内联到 **7 份 index.html**（根/index-app/public/离线桌面/离线APP/云端桌面/云端APP），替换散落的 getDefaultUsers/getUsers/saveUsers/simpleEncrypt/simpleDecrypt。
- `tools/sync-shared-blocks.cjs`：`--check` 校验 / 默认同步；`copy-consistency.cjs` 铁闸1 已扩展——标记块哈希≠权威源即构建失败（总副本 38）。
- `smoke-runtime.cjs` 新路径：检测到标记块→整块 vm 执行（自包含），旧路径兼容未同步产物。

**T3 两个坑（务必牢记）**：
- asar 内 index.html 用 latin1 读 → 中文注释乱码 → extractBlock 匹配失败。**必须 utf8 读**。
- 权威源文档注释里出现锚点文字（括号说明）→ 裸 `indexOf` 误匹配截断块。**必须用行首注释形式的 ASCII 锚点**（`'\n        // >>> USER-STORE'`）精确匹配。

**验证矩阵（T3 交付前）**：copy-consistency 38/38 ✓；smoke 18/18（html+asar 双通道）✓；e2e 3/3（含 E3 毒数据）✓；Setup 1.2.110 产出 ✓。

**生效**：云端网页/云端APP=推 GitHub 自动；云端桌面=装 Setup 1.2.110（核对三元组 V1.2.110|Build 2026/8/21|Arch 2.26）；离线桌面/离线APP=需重打包（标记块已入源码）。

### 2.25 【P1 登录窗口旁路收编】login.js 委托 UserStore（Setup 1.2.112 / 1.0.83，提交 0f3a1e0d）

**审计结论（全库扫 local_systemUsers + XORv1 实现）**：
- 真旁路仅一处家族：**两份 electron/login.js**（云端+离线桌面）独立实现 XORv1 加解密 + 3 处直读 local_systemUsers（读解密 getUsersFromStorage / 登录后写 / 启动清理遗留账号）——主界面与登录窗数据逻辑分裂的根源（"激活后登录窗读不到账号"类问题的隐患模式）。
- 判定为合法的：main.js node 侧 cfg.users（Array.isArray 守卫齐全，config.json 管护域）；auth-core XORv2/PWDv2（密码哈希域，不碰 users 列表存储）。

**修复（双路径分发，都锚定 shared/user-store.js）**：
- index.html 路径 = 标记块内联（T3 已建）；登录窗口路径 = **独立文件**分发到两处 electron/（login.html `<script src="user-store.js">`，package.json `electron/**/*` 通配自动打包，无需改 build.files）。
- 两份 login.js 的 simpleDecrypt/simpleEncrypt 函数体改为**优先委托 window.UserStore**，本地实现降级为加载失败兜底（行为逐字节等价，防御式惯例）。getUsers 合并语义（config 主+localStorage 补）保持不变，只收编加解密原语。

**新关卡**：
- copy-consistency 第 5 文件组 user-store.js（2 副本），总副本 39→41。
- smoke-runtime 新增 `--login` 模式（L1-L4 ×2：委托解密/委托加密/html 加载/文件存在），接入 final-verify 成**铁闸8b**，每次构建自动跑，旁路复发即红线删 exe。

**新坑（务必牢记）**：final-verify.cjs 里引用 try 块内的 `const smoke` 会 `smoke is not defined`（块级作用域）——首个 1.2.111 构建被自己红线拦下（机制按设计工作：FAIL 即删 exe 杜绝假包）。修复：铁闸8b 独立 `require('./smoke-runtime.cjs')`。**教训：给 final-verify 加检测时，别引用上面 try 块内的局部变量。**

**验证矩阵**：一致性 41/41；冒烟 18/18（html）+ 8/8（login）；界面基线 6/6（script 标签不算 UI 变更，不触发 WARN）；e2e 3/3（E1 登录 PASS=委托改造未破坏链路）；asar 独立抽查两端 login.js 委托 + user-store.js 文件双确认。

**生效**：云端桌面=装 Setup **1.2.112**（三元组 V1.2.112）；离线桌面=装 Setup **1.0.83**；APP/网页端不涉及（login.js 仅桌面端），无需操作。

### 2.26 【P2 全表面冒烟进红线】铁闸8c（2026-08-21）

- smoke-runtime 新增 `--all` 模式：**复用 sync-shared-blocks.cjs 的 HTML_FILES 单一清单**循环 7 份 index.html（新增表面只改一处），聚合 login 旁路检测，输出只打 FAIL 行+每表面一行汇总防刷屏。
- final-verify 新增**铁闸8c**（紧随 8b）：每次构建自动跑 7 表面 + login = 134 用例，任一表面 fail 即红线删 exe。final-verify 用**环境变量** VERIFY_ASAR_PATH/VERIFY_PKG_DIR 传参（不是 --asar 命令行参数，手工验证时注意）。
- **--all 首跑即抓到漏网**：db-offline/index-app.html 旁边缺 normalize-config.js（与根目录 index.html 同款问题，两处都是"html 有标签但文件没分发"）→ 补分发 + 入 copy-consistency（总副本 42）。证明关卡价值：这类漏网靠人肉记忆必漏，机器一扫就出。
- 纯构建工具层改动（tools/），不影响 exe 产物内容，**无需重打包**；下次任何端构建自动生效。
- 手工跑法：`node tools/smoke-runtime.cjs --all`（134/134）；final-verify 单测：设 VERIFY_ASAR_PATH/VERIFY_PKG_DIR 环境变量后 `node tools/final-verify.cjs`。

### 2.27 【P3 离线桌面 e2e 变体】Setup 1.0.85（提交 b6bed310）

**用例（按试用标准版行为断言，与云端版互补）**：
- E1 本地账号登录：明文密码链路（login.js isHash=false 明文比对）+ 主窗口加载 + 改密按钮可见
- E2 试用期强制降级反向断言：config 写 clinic+admin 也会被 ensureTrialStandardEdition 降级 → 【用户管理】必须隐藏
- E3 毒数据：CONFIG.users 非数组 → window.UserStore.get() 必须返回兜底数组 → 点改密弹窗仍打开
- 已接入离线 build.bat 步骤 [9.6/9]，与云端同款红线（FAIL 删 exe）。

**★ 关键坑：E2E 旁路必须打穿三层安全防线（首跑 3 条全超时的真根因）**：
1. blockRemoteDebugging 拦 `--remote-debugging-port`（Playwright CDP 必传）→ 加 BNZC_E2E+marker 双条件旁路（与云端同款）
2. **license-manager.js `isDebuggerAttached()` 也拦 CDP 参数** → license 判 invalid → `_isLicensed=false` → 弹"到期提示"窗而非 loginWindow → e2e 等 login.html 永远超时（表面症状毫无线索，必须读启动链路定位）
3. `registerTrialWithServer()` 联网登记试用：e2e 会消耗构建机真实设备试用次数/被 denied 误杀 → 旁路直接返回 offline 宽限语义

**旁路安全设计**：main.js 双条件校验通过后置 `global.__BNZC_E2E_BYPASS=true`；license 侧只认该标志（标志置位前提=控制环境变量+exe 目录写权限，生产包不携带 marker）。e2e 隔离 userData 内 license.dat/trial.dat 全新生成，试用期照常发放。

**验证**：Setup 1.0.85 首个带 e2e 的离线构建，E2E 3/3 PASS（登录 8s 内完成三用例）；7 铁闸 + 铁闸8c 134/134 照常全过。

**生效**：离线桌面=装 Setup **1.0.85**（此前 1.0.83/84 因红线删包已不可交付，属正确行为）；云端/APP 不涉及。

### 2.28 【P4 交付核对单自动化】tools/delivery-report.cjs（2026-08-21）

- 打包成功路径末尾（两套桌面 build.bat 步骤 [9.7/9]）自动生成一页纸：`dist\交付核对单_V{版本}_{端名}.txt`（UTF-8 BOM，记事本直开）。
- 内容八板块：版本自证三元组 / 产物清单+sha256 / 真 asar 二进制独立抽查（版本号+Arch+USER-STORE 三标记）/ 冒烟 134 实时复算 / 关卡清单（桌面铁闸制 or APP 严格流程，按端类型分支）/ **安装自检三步**（杀旧进程→核对三元组→悬停水印）/ 各端生效方式速查 / 排障速查（"装新版还报旧问题"先看三元组）。
- **失败策略**：报告是辅助产物（exe 已过全部铁闸），生成失败仅 WARN + exit 0，绝不阻断交付、绝不删 exe。
- 通用支持：`--pkg` 指向桌面项目目录（dist\*.exe）或 APP 根目录（*.apk，自动探测端类型；APK 无 build-meta.json 时降级提示手工核对）。
- 手工生成：`node tools/delivery-report.cjs --pkg app_project\db-yunduan\cloud_desktop`。
- 交付习惯（新）：向用户交付 exe/APK 时，把同目录核对单一起交付，用户照"安装自检三步"30 秒自证真假包。

### 2.29 【症状快捷录入首版】舌脉体征词典+快捷面板（提交 4142c8a4，2026-08-21）

- 需求：病史症状输入框快速录入中医症状学舌脉等体征。方案文档 `.trae/documents/symptom-quick-input-impl.md`（经 Seed-2.1-Pro 独立审查后定稿）。
- 交付物：`shared/symptom-dict.js` 权威源（6 分类 120 词条：组合模板/舌质/舌苔/脉象/望诊/问诊）+ 简码前缀搜索 + 分组拼接（同分类顿号、跨分类逗号）+ 频次记忆 + Alt+S 快捷面板。
- **界面零改动铁律落地**：面板完全运行时注入 DOM（无任何 index.html `<body>`/`<style>` 结构改动），check-interface 6/6 通过；script 引用行追加在既有 `<script src>` 链尾部（medicine-dict.js 之后），不破坏基线特征。
- 分发矩阵：symptom-dict.js 共 8 处副本（shared 权威源 + public/public.electron + cloud_desktop/cloud_desktop.electron + db-offline.desktop + 两个 APP assets）；7 份 index.html/index-app.html 加引用行（注意 index-app.html 文件名不匹配 `**/index.html` glob，Grep 统计时易漏）。
- 配套：sync-all.ps1 BusinessJsFiles 注册；两处桌面 package.json build.files 纳入；public/_headers 给 symptom-dict.js 单独 1 天缓存（区别于业务 JS 的 max-age=0，修订词条时 bump `SYMPTOM_DICT.version` 破缓存）。
- 铁闸：smoke-runtime 新增 S1-S8（词典结构/简码搜索/拼接/排序/毒频次+无 DOM 加载）26/26；copy-consistency 42/42；e2e 3/3；check-interface 6/6。
- 排序坑（Y6）：`(order[a.cat] || 99)` 在 order=0 时 falsy 变 99 导致首分类排错；必须用 `cat in _orderIndex` 显式判存在。
- 生效：云端网页/云端APP 推 GitHub 自动生效；云端桌面/离线桌面/离线APP 需重打包。

### 2.30 【S1 模板表面误杀构建】final-verify FAIL 1 项→误删 exe（提交 5ff60118，2026-08-21）

- 现象：离线桌面打包 `FINAL GATE FAIL 1 项`，红线删掉所有 exe。复现定位为铁闸8c 全表面冒烟对根 `index.html` 和 `index-app.html`（源模板表面）报 `S1 产物中缺少 symptom-dict.js`。
- 根因：`runAll()` 对 7 份 index.html 逐份 htmlPath S1 校验要求**同目录**有 symptom-dict.js；但根 index.html/index-app.html 是**源模板/母版表面**，同目录连 medicine-dict.js 都不存在（词典由 sync-all.ps1 分发到产物目录 desktop/public/APP assets）。5 份产物表面本就 26/26 过，模板表面误报 FAIL 触发红线误删 exe。
- 修复：smoke-runtime.cjs S 区块若**同目录无 medicine-dict.js** 即判为模板表面，S1 降级 SKIP（不参与 fail 统计）；随包交付硬校验仍由 asarPath 产物闸门保证。final-verify 176/176 全绿。
- 通用判别法：对"产物存在性"类校验，先确认目标文件在哪些表面是**同目录交付**、哪些是**分发到产物目录**；模板/母版表面路径与产物目录路径不一致时，不能直接要求同目录存在，须降级 SKIP 由产物闸门兜底。
- 重打产物：`惠康中医-本地 1.0.87.exe` + `Setup 1.0.87.exe`，symbol 三闸门+e2e 3/3+交付核对单全 PASS。
- 生效：离线桌面版需重装新版；离线APP/云端桌面/云端APP 按各自生效方式重打包或待部署。

### 2.31 【云端注册管理全链路】设备授权2台+单设备在线互斥+安全加固（提交 ee8e80e0，2026-08-21）

- **需求闭环**：云端无试用；注册（标准版/机构版意向）→ 后台激活 → 登录使用；一个云端管理员最多授权 2 台设备（桌面/APP），仅 1 台在线；数据存储安全。
- **注册版本意向闭环**：auth-core.js 注册表单新增版本选择卡片（regEdPersonal/regEdInstitution），提交带 edition 参数；users.js 注册存储 requestedEdition；管理员审核转正时优先采用意向。早期无 edition 用户兜底 cloud_clinic（2.20 节延续）。
- **设备授权（KV）**：`user_devices:{username}` 存 `{maxDevices:2, devices:[{machineId, clientClass, boundAt, lastSeenAt}]}`；登录时 bindUserDevice 校验，超限返回 403 `DEVICE_LIMIT`（提示"请先在已绑定设备上解绑，或联系管理员"）。网页版 machineId 为 unknown/短指纹时不计入名额（宽松放行，宁漏检不可误报）。管理端点：`GET /users?action=list-devices`（本人查看）、`POST /users?action=unbind-device`（本人自助解绑）。
- **单设备在线互斥**：`user_session:{username}` 存当前会话 tokenHash（SHA-256）；每次登录 writeUserSession 覆盖写（新踢旧）；verifyToken 比对 tokenHash 不匹配返回 401 → 前端 cloud-api.js 对任何 401 统一清登录态弹登录框，提示"登录已失效（账号可能在其他设备登录）"。旧设备的下一次 API 调用即被踢，无需心跳。
- **数据安全清单**：PBKDF2-SHA256 100000轮+salt（兼容旧SHA-256迁移）；HMAC token fail-closed（AUTH_SECRET 缺失即拒绝签发）；token 黑名单+version 撤销（改密全端下线）+session 互斥；登录防枚举（USER_NOT_FOUND 与 WRONG_PASSWORD 同文案计时一致）+失败锁定（login_fail:{username} 计数）+IP 限流；审计日志 writeAuditLog 记录 login_success/login_failed/device_limit。
- **部署后实测（线上 6/6）**：①设备A登录绑定 ②list-devices 显示 2/2 ③设备C登录 403 DEVICE_LIMIT ④设备A二次登录后旧token 401 被踢/新token 200 ⑤解绑后设备C登录 200 名额释放 ⑥解绑状态 list-devices 正确。
- **排查坑**：测试账号连续错密码会累积 login_fail 计数（提示"剩余尝试次数 N 次"），剩 2 次时立即停手换已知密码账号（wgj/admin123），勿盲试触发锁定。
- **生效方式**：云端网页版/APP=推 GitHub 自动生效（已验证）；云端桌面版=需重打 Setup 并重装；离线版=需重打包（不受此云端策略影响）。

### 2.32 【激活工单审批】后端 4 API 全缺失致列表加载失败（提交 00e64290，2026-08-21）

- **现象**：后台工单审批页报 `工单列表加载失败：Unexpected token '<'`。
- **根因**：前端页面（public/admin + site-admin/admin + _build_sites.cjs 模板三副本）早已部署，但后端 4 个 API 路由**从未实现**（`ticket/submit`、`ticket/list`、`ticket/reject`、`activate-from-ticket`）。Cloudflare Pages 无函数无静态资源 → 回退返回 HTML（SPA fallback/404 页）→ 前端 `r.json()` 解析到 `<` 报错。**`Unexpected token '<'` = 期望 JSON 收到 HTML = API 路由不存在/异常，这是固定判别法。**
- **新增 4 API**（KV `ticket:{no}` + `ticket_index` 最新在前上限 500，与 admin_req 模式对齐）：
  - `POST /api/license/ticket/submit`：公开+IP 限流 10 次/时+字段清洗截断+必填校验；ticketNo=`TK-YYYYMMDD-6位随机`；提交时间以服务端为准。
  - `GET /api/license/ticket/list`：platform_admin Bearer；**服务端脱敏** machineId 前后 6 位+打码（规则 3 双保险，前端被篡改也不泄露完整哈希）。
  - `POST /api/license/ticket/reject`：platform_admin；写客户可见拒绝原因。
  - `POST /api/license/activate-from-ticket`：**复用 admin-approve 全链路**——edition 意向映射 type（机构系→pro，标准系→personal，管理员可覆盖）、checkDeviceVersion、生成激活码（默认 365 天/2 台设备）、provisionCloudAccount 开云端账号（compatRecord: phone=contactPhone, adminName=contactName）、normalizeActivationPassword、setDeviceVersion、licenseBase64、回写工单管理员最终决策。
- **前端 3 副本补鉴权**：token 取 `sessionStorage.admin_console_token`（与 admin/index.html P2-7 口径一致，兼容旧 localStorage 迁移）；401/403 友好提示重新登录；未登录引导到激活码管理页登录；XSS 转义 esc()；审批 confirm 二次确认+alert 显示激活码。
- **import 路径三连坑（本次连续踩 2 次，全靠 build 门禁拦下）**：ticket/ 子目录到 `functions/api/_lib/auth.js` 是 `../../_lib/auth.js`（不是三层）；activate-from-ticket.js 在 license/ 根与 admin-approve 同层（`../_lib/auth.js` + `./_lib/*`）。**先写文件再跑 `npx wrangler pages functions build functions` 验证，且修正路径后必须重跑**（首次验证通过的快照不覆盖后续修改）。
- **模板字符串转义坑**：_build_sites.cjs 内嵌 HTML 模板中 JS 源码的 `\n` 必须写 `\\n`，否则模板求值后生成 HTML 里 JS 字符串跨行=语法错误。
- **线上实测 6/6**：①提交工单 200（TK-20260821-FSME9C）②无 token list 403 ③clinic_admin list 403（权限分层正确）④clinic_admin 审批 403 ⑤无 token 审批 403 ⑥页面新版鉴权 JS 已上线。审批"一键通过"完整链路（生成激活码+开通账号）由用户在后台页面点击实测。
- **遗留**：客户端 UI 尚无 submitActivationTicket 调用入口（规则 3 对接最后一步，后续接入时随包更新）；邮件/短信通知未接（alert 显示激活码由操作员人工通知，与 admin-approve 现状一致）。
- **生效方式**：云端后台/网页=推 GitHub 自动部署生效（已上线）；离线桌面/APP=待客户端接入提交入口时随包更新。

### 2.33 【注册支持用户名登录】注册表单新增用户名选填（提交 6d79b318，2026-08-21）

- **需求**：登录框早已支持"手机号/用户名"双模式（placeholder 即"请输入手机号或用户名"，后端 findUserForLogin 按 username 优先+phone 兜底），但注册弹窗只有手机号、后端写死 `username: phone`，导致只能手机号注册。用户选定方案：**用户名选填**（填了用户名则以用户名为登录账号，不填默认手机号）。
- **前端（cloud.js 权威源，运行时注入不改 index.html）**：注册表单在手机号上方新增"用户名（选填，登录账号）"输入框；提交读取并校验格式（2-30 字符，仅允许中文/字母/数字/下划线/连字符，与服务端规则一致）；`adapter.registerClinic` 与直连 fetch 两条提交路径都透传 `username`；成功页"登录账号"显示 `uname || phone`（用户名优先）；`AuthCore.registerClinic` 也接收 username 并做同规则客户端校验。
- **后端（users.js register-clinic）**：接收 `username` 参数 → 格式校验（选填，规则同上）→ **用户名全局唯一校验**（`findUserForLogin(kv, regUsername)` 命中即拒绝，防止与其他用户 username/phone 冲突）→ `adminUser.username = regUsername || phone`、`name = adminName || regUsername || phone` → nextStep 提示"登录账号（用户名或手机号）"。
- **双模式登录兼容**：登录匹配链路两端均已支持——后端 `findUserForLogin`（username 优先+phone 兜底）、客户端 `findUserByIdentifier`（username/phone 双匹配），故注册存 username 后无需改登录逻辑，用户用用户名或手机号都能登录。
- **同步**：改权威源 `shared/auth-core/cloud.js` 后必须跑 `tools/sync-auth-core.ps1`（云 8 副本 + 根镜像；离线 3 副本不受影响，注册弹窗为云端专用）。任何一次 cloud.js 改动后都要重跑 sync，勿只改单一副本（2026-08 打包回退教训）。
- **生效方式**：云端网页版/云端APP=推 GitHub 自动生效；云端桌面版=需重打 Setup 并重装；离线版不受影响（无注册弹窗）。

### 2.34 【用户管理角色显示】机构版管理员(clinic_admin)被误显"普通用户"（提交 7e066365，2026-08-22）

- **表象**：云端网页/桌面/APP 三端用户管理界面，机构版管理员 wgj（角色 clinic_admin）明明能进入【用户管理】，角色栏却显示"普通用户"，用户困惑"都是普通管理员"。admin 显示"管理员"正常。
- **根因**：三端 `renderUserList` 的角色显示逻辑只认 `role === 'admin'` 才显示"管理员"，其余一律"普通用户"；编辑弹窗角色下拉选中、查看他人处方权限、删除用户权限、导出数据 userRoleDisplay 共 6 处同样是"只认 admin"的单角色判断，未覆盖 clinic_admin / platform_admin。
- **判定铁证**：能进【用户管理】= 必为 admin 或 clinic_admin（permission.js canManageUsersByRole 只放行这两类+机构版），而旧逻辑又显示其"普通用户"，二者矛盾 → 数据端角色必是 clinic_admin，是显示逻辑漏判而非数据问题。
- **修复**：6 处角色判断统一扩展为"platform_admin→平台总管理员；clinic_admin||admin→管理员；其余→普通用户"，并同步到查看/删除权限、下拉选中、导出角色。仅改 JS 逻辑，HTML 结构零改动（check-interface 6/6 OK）。
- **举一反三**：涉及"角色显示/权限"的修改，必须全端（public/ + cloud_desktop/ + cloud_app assets）同步，且用 Grep 全量扫 `role === 'admin'` / `role !== 'admin'` 单角色判断，逐处确认是否需扩展 clinic_admin/platform_admin；三端副本必须一致（本次 3 文件各 6 处完全对齐）。
- **生效方式**：云端网页版 public/index.html=推 GitHub 自动部署即时生效；云端桌面版 cloud_desktop/index.html=需重新 build.bat 打包 exe 并重装；云端 APP assets/public/index.html=需重新打包 APK。

### 2.35 【唯一管理员设计】桌面登入多个注册管理员致角色混乱 → 内置 admin 过滤三端同步（2026-08-22）

- **表象**：云端桌面用户管理界面出现"管理员(admin)[正] + 普通用户:王桂杰(wgj)"并排，机构版管理员(wgj, clinic_admin)被误显"普通用户"，用户困惑"都是普通管理员"。
- **用户定调**：要求恢复早期设计——"一个注册账户唯一的管理员，可以编辑增加普通用户的模式"。用户自诊"是一个桌面登入了多个注册管理员造成的"。
- **根因**：云端桌面用户管理读取**本地用户表**（localStorage local_systemUsers），云端登录用户会被补拉进本地表（见 handleLogin 云端身份权威登录）。本地内置默认 admin（username='admin', role='admin', 无 _cloudRoleSynced）+ 多个云端注册 clinic_admin 登录过后，本地表堆积多个"管理员"账号 → 角色显示混乱。
- **修复（三端各 5 处，完全对齐）**：新增 `isBuiltinDefaultAdmin(u)` = `u.username==='admin' && u.role==='admin' && !u._cloudRoleSynced`（云端注册的 clinic_admin 带 _cloudRoleSynced=true 不会被误判）。①UserStore.get() 过滤内置 admin 并落盘清理；②renderUserList 显式 filter（双保险，覆盖未加密旧数据 fallback 路径）；③UserStore export + 兼容薄包装。云端注册的 clinic_admin 仍显示"管理员"（2.34 角色显示修复），普通用户显示"普通用户"，本地内置 admin 不再出现。仅改 JS 逻辑，HTML 结构零改动（check-interface 6/6 OK）。
- **教训（并行 Edit 静默失败复现）**：同一文件并行两次 Edit，一处成功一处被吞——cloud_app 的 UserStore export 行、cloud_desktop 的薄包装 wrapper 行均首轮"显示成功"实则丢失。**三端同步修改禁止并行 Edit 同一文件，且每次 Edit 后必须 Grep 全量验证 5 处全部到位**。
- **生效方式**：云端网页版 public/index.html=推 GitHub 自动部署即时生效（强制刷新 Ctrl+F5）；云端桌面版 cloud_desktop/index.html=需重新 build.bat 打包 exe 并重装；云端 APP assets/public/index.html=需重新打包 APK。

### 2.36 【彻底锁死唯一管理员】7端全局禁止把普通用户改成管理员（提交 9559f2ed，2026-08-22）

- **需求**：用户要求"彻底禁止在添加/编辑用户时把普通用户改成管理员，彻底锁死唯一管理员"，并统一全局、更新离线各端。
- **实现（7 端完全对齐）**：云端网页(public)、云端桌面(cloud_desktop)、云端APP(cloud_app assets)、离线桌面(desktop)、离线APP(index-app + app assets)、根目录版(index.html) 共 7 个 index.html，三重保障：
  1. **运行时移除选项**：`showUserManageModal()` 打开时循环删除 `#newUserRole` 下拉里 `value==='admin'` 的 option（DOM 操作，不改静态 HTML）；
  2. **编辑只读**：编辑弹窗 `#editUserRole` 加 `disabled` 属性（readonly 展示，已存在的 admin/clinic_admin/platform_admin 只是展示不变）；
  3. **代码硬编码**：`handleAddUser()` 中 `const newRole = 'user'`（新增一律普通用户）；`confirmEditUser()` 保存时 `role = (已是admin/clinic_admin/platform_admin) ? 原角色 : 'user'`（普通用户永远无法被改成管理员）。
- **验证**：check-interface 6/6 OK（仅 JS 逻辑改动，静态 body 零变化）；全部 7 文件 acorn 语法全量解析通过（marker 块均 OK）。
- **教训（语法校验工具自身 bug 引发误报）**：`_check_js_tmp.cjs` 初版用 `html.indexOf('<script', i)` 找脚本块，会命中 **HTML 注释内的字面 `<script>` 字符串**（如 `<!-- ★ 双重保障：通过 <script> 标签加载... -->`），把大段 HTML 误当 JS 提取导致 "Unexpected token (1:6)" 假报错。修复：扫描循环里取最近的 `<!--` 与 `<script` 位置，注释优先跳过（注意注释前常有换行，`startsWith('<!--')` 会漏判，必须用 `indexOf` 比较位置）。**写 HTML 内联脚本提取工具必须先跳过 HTML 注释，否则注释里含 `<script>` 字样必误报**。
- **生效方式**：云端网页版=推 GitHub 自动部署即时生效（Ctrl+F5 强刷）；云端桌面版=重新 build.bat 打包 exe 重装；云端APP=重新打包 APK 重装；离线桌面版=重新 build.bat 打包 exe；离线APP=重新打包 惠康中医-本地.apk 重装。

### 2.37 【多账户/多用户同设备数据隔离】月度统计串号泄露 → 复用权限过滤（提交 d0b91310，2026-08-22）

- **表象**：用户"隐隐感觉同一设备多账户登入后历史处方混乱"。摸底结论：**历史处方列表本就隔离安全**（后端按用户过滤 + 前端 `filterPrescriptionsByPermission` 双重隔离），真正漏洞在**统计页的月度统计**。
- **根因**：`analyzeMonthlyStats()` 用 `getAllUserPrescriptions()` **不带用户名参数**读取全量数据。离线版确定串号（直接读共享本地库全量）；云端版在**云端 GET 失败/断网回退本地缓存**时串号（admin 登录会把全诊所数据写入本地缓存，普通用户断网统计时读取全量）。
- **修复（7 份副本同步，仅 JS 逻辑）**：`analyzeMonthlyStats` 改为 `filterPrescriptionsByPermission(await getAllUserPrescriptions())`，与历史列表口径 100% 一致（普通用户仅统计 `createdBy===username`，admin/clinic_admin/AuthCore.isAdmin 统计全部，无"回退全量"陷阱）。涉及：根 index.html、public/index.html、cloud_desktop、cloud_app assets、db-offline desktop、db-offline index-app、db-offline app assets。
- **举一反三（数据隔离审计清单）**：①任何"全量读取"的统计/导出/查阅入口必须套 `filterPrescriptionsByPermission` 或等价过滤；②`filterPrescriptionsByPermission` 是权限过滤唯一权威函数（admin/clinic_admin/AuthCore.isAdmin 看全部，其他只看本人）；③登出/切换账户只清登录态 key，**不清 `all_prescription_list`/IndexedDB 处方缓存** → 断网回退路径必查是否过滤；④site-admin 用 `prescriptionHistory`（已过滤）不在此漏洞范围。⑤**决策：登出清缓存不做**（2026-08-22 用户确认）——离线版所有用户共享同一本地库，清空会删他人数据（灾难性）；云端版即使缓存残留也被权限过滤挡住，泄露面为 0，收益小于风险。
- **生效方式**：云端网页版 public/index.html=推 GitHub 自动部署（Ctrl+F5 强刷）；云端桌面版=重新 build.bat 打包 exe 重装；云端APP=重新打包 APK 重装；离线桌面版=重新 build.bat 打包 exe；离线APP=重新打包 惠康中医-本地.apk 重装。

### 2.38 【E2E 被调试器检测误拦】license-manager 旁路标志（提交 ca5ae735，2026-08-22）

- **表象**：E2E 通过 Playwright 以 `--remote-debugging-port` 启动 exe，被 `license-manager.js` 的 `isDebuggerAttached()` 误判为调试攻击，弹"检测到调试器已连接，软件无法运行"拦截窗口，阻断测试。
- **修复**：4 处 license-manager.js 副本（离线桌面、离线桌面 license、云端桌面、离线APP 资源）的 `isDebuggerAttached()` 开头消费 `global.__BNZC_E2E_BYPASS` 旁路标志；云端 main.js 补标志置位（离线版已有）。
- **安全边界**：旁路仅在 E2E 环境变量 + exe 同级 marker 文件**双条件**同时满足时放行（仅本地构建测试场景）；正常用户运行或攻击者 `--inspect` 启动仍被拦截。
- **生效方式**：重新 build.bat 打包后生效（V1.2.126 已含）。

### 2.39 【云端桌面安装后自动退出】三根因叠加事故链（混淆冲突 + 未定义函数 + 僵尸进程混合产物，2026-08-22）

- **表象**：用户手动 pack-desktop.bat 打包云端桌面 V1.2.125，安装后双击运行一会自动退出；期间 E2E 曾 E1/E3 点击超时失败触发红线删产物。
- **根因1（混淆脚本全局变量冲突，概率性地雷）**：javascript-obfuscator 的 stringArray 输出在模块顶层生成 `function g(){...}`（字符串数组）与 `function h(a,b){...}`（解码器），浏览器 `<script>` 顶层 function 挂 window——同一页面加载多个混淆脚本（permission/debug-logger/print-utils/medicine-dict/performance-utils/prescription-core/patient-archive/security-guard）时后加载的覆盖先加载的 g/h，运行时用自己的索引查别人的数组 → 解码乱码 → `this[乱码] is not a function` → 概率性闪退（某次构建恰好不撞名则侥幸通过）。
  修复：`tools/obfuscate.js` 整个混淆产物包一层 IIFE `(function(){...})();`，g/h 成为闭包局部变量（46 文件混淆 OK，E2E 打包产物模式复测通过）。
- **根因2（isBuiltinDefaultAdmin 未定义 → alert 阻塞渲染进程）**：2.35 的 renderUserList 调用 `isBuiltinDefaultAdmin(u)`，但 UserStore 当时未导出该方法 → ReferenceError → catch 块执行 `alert()`——**Electron 原生 alert 同步阻塞渲染进程**，点击【用户管理】后页面假死、E2E evaluate 永久超时（症状像死循环，实为阻塞弹窗）。
  修复：`shared/user-store.js` 补 `isBuiltinDefaultAdmin` 实现并入 UserStore 导出；`tools/sync-shared-blocks.cjs` WRAPPERS 加薄包装，同步 7 端 index.html。E3 断言同步对齐 2.35 设计：毒数据兜底 admin=内置默认会被隐藏，列表为空属预期，只断言容器存在。
- **根因3（E2E 僵尸进程 → 旧 exe + 新 asar 混合产物）**：run-e2e.cjs killApp 的 `p.kill()`（TerminateProcess）**只杀主进程**，Electron 的 gpu/renderer/utility/crashpad 子进程幸存——每轮 E2E 残留 ~15 个（3 用例×5 进程），多轮 diag 排查累计 36 个。这些进程锁住 `dist\win-unpacked`，下次构建 prepare-win-unpacked 无法覆盖被锁文件 → **旧 exe(12:37) + 新 asar(12:43) 混合产物**（asar 版本铁闸只校验 asar 不校验 exe 时间戳，照样 PASS）→ E2E 在混合产物上崩溃、用户安装即闪退。
  修复：killApp 改 `taskkill /PID <pid> /T /F` 整树强杀（验证：单跑 E2E 3/3 后零残留进程）。
- **附带修复**：cloud_desktop 与 db-offline desktop 的 package.json `build.files` 加 `"!**/*.bak"`，防混淆备份源码泄露进 asar。
- **排查工具沉淀（cloud_desktop/_diag/ + tools/）**：`list-asar.cjs`/`extract-asar.cjs` 解析 asarmor 处理后的 asar 并提取指定文件；`e2e/diag4-alert-proof.cjs` 用 Playwright dialog 事件监听拿渲染进程 alert 抛错铁证（区分"死循环"与"阻塞弹窗"的关键手法）。
- **教训**：①"安装后自动退出"先查产物一致性——`Get-ChildItem dist\win-unpacked` 对比 exe 与 resources\app.asar 时间戳是否同构建周期，再查代码；②Electron 渲染进程 catch 里用 alert() 是调试大忌，同步阻塞让一切 evaluate 超时；③Windows 杀 Electron 必须整树杀（taskkill /T），单杀主进程留下孤儿子进程锁文件；④build.bat 开头的 taskkill 清理只保构建启动时干净，**E2E 收尾不杀进程就会跨构建累积**，清理要两头做。
- **验证**：V1.2.126 完整构建（pack-desktop.bat 入口，3分49秒）E2E 3/3 PASS；单独复跑 `node e2e\run-e2e.cjs`（packaged-win-unpacked 模式）3/3 PASS + 零残留进程；源码混淆已由构建自动还原（git status 干净）。
- **生效方式**：云端桌面版=安装 `dist\惠康中医-云端 Setup 1.2.126.exe`（或 portable）；云端网页版=public/index.html 推 GitHub 自动部署（Ctrl+F5 强刷）；云端APP=重新打包 APK；离线桌面/离线APP=各自重新打包（user-store 修复已同步其 index.html/electron 副本）。

### 2.40 【已激活设备登录框"注册开通"按钮重现】三层根因（新客户A全流程实测，提交 787a61b6/d05f84d7，2026-08-22）

- **表象**：新客户A全流程（注册→后台审核→激活申请→后台激活→自动装license→登录成功）全部通过后，退出登录重开程序，登录框又出现"📝 注册开通"绿色按钮，误导已开通用户重复注册。
- **取证手法（直接读磁盘 leveldb，一锤定音）**：登录窗口/主窗口共 `SESSION_PARTITION='persist:tcm-prescription-dingzhi'`，localStorage 落在 `%APPDATA%\tcm-prescription-cloud\Partitions\tcm-prescription-dingzhi\Local Storage\leveldb`。用 FileStream(Share=ReadWrite) 读 000003.ldb/000004.log 字节流，ASCII+UTF-16 双编码搜关键词：`isLoggedIn`/`rememberedUser` 命中、`activationDone` **缺失** → 标记从未落盘（注意：leveldb 的 key/value 是 UTF-16，纯 ASCII 搜会假阴性）。根目录 `Local Storage\leveldb` 是默认 session 的空库（本项目全部窗口走 partition），别扫错位置。
- **根因1（代码缺陷，必现）**：auth-core `onAdminActivated` 仅"无本地安装桥"分支（云端APP）调 `setCloudActivationDone()`，**桌面安装分支（installAdminLicense 成功→重启）漏调** → 激活成功的桌面设备标记永缺失。
- **根因2（强杀丢写入，概率）**：`restartApp()` 用 `app.exit(0)` 立即强杀进程，渲染进程 localStorage（leveldb WAL）最近写入未 flush 即丢失——客户A注册时（第一步）写的标记在激活重启时被杀丢。
- **根因3（设计缺陷）**：login.js 注册入口注入仅依赖易失 localStorage 标记单点判断，无持久事实兜底。
- **修复（16 文件，仅 JS 逻辑，check-interface 6/6 OK）**：①`onAdminActivated` 开头统一 `setCloudActivationDone()+hideActivateLoginEntry()`（权威源 cloud.js/offline.js + 12 副本，片段逐字节一致性已脚本验证）；②login.js `injectAdminActivateEntry(config)` 加 `hasAdminUser(config)` 兜底——config 已有管理员即隐藏（双条件任一满足）；③`restartApp` 改 `app.quit()` 优雅退出 + 2 秒 `app.exit` 兜底（本项目无 before-quit/close 拦截，已核实安全）。
- **同步纪律更新**：auth-core 云端权威源=`shared/auth-core/cloud.js`（8 副本）、离线权威源=`shared/auth-core/offline.js`（3 副本）+根 `shared/auth-core.js`；copy-consistency.cjs **不校验 auth-core**（手工纪律），批量同步用模式脚本（每文件两处 patch 必须各命中1次才写入），改完跑片段一致性校验。
- **举一反三**：①凡"按状态显隐入口"的功能，必须有非易失持久事实（config/文件）兜底，localStorage 标记只作加速；②Electron 需要重启的路径禁止裸 `app.exit(0)`（强杀丢渲染进程存储写入），统一 `app.relaunch()+app.quit()+延迟 exit 兜底`；③排 localStorage 问题直接读 partition leveldb 字节（UTF-16），比连 CDP 快且不受生产无调试端口限制。
- **验证**：16 文件语法 OK、12 副本片段一致、check-interface 6/6、V1.2.127 完整构建 E2E 3/3 PASS（3分34秒）。
- **生效方式**：云端桌面版=安装 `dist\惠康中医-云端 Setup 1.2.127.exe`；云端网页版=推 GitHub 自动部署（Ctrl+F5）；云端APP=线上 public/ 自动生效；离线桌面=重新 build.bat 打包；离线APP=重新打包 APK。

---

### 2.41 【基础设置→管理员激活看不到工单Tab】两套激活界面入口分流缺陷 + 桥名写错返工（提交 77e7ca6c/9c509f9c，2026-08-22）

- **表象**：已登录用户从 基础设置→授权状态→「📋 管理员激活」打开的是**无版本选择、无Tab的简化弹窗**（密码提示"固定admin"），永远到不了工单申请/激活码激活Tab。用户实测两轮"问题依旧"。
- **根因1（入口分流缺陷）**：项目存在**两套激活界面**——①完整版：主进程独立窗口 activate-window.html（版本选择+📋管理员激活/🔑激活码激活/📨工单申请 三Tab，未激活时自动弹出）；②简化版：auth-core.js `openAdminActivate` DOM 弹窗。2026-08-20"双入口合并"决策把基础设置授权区按钮指向了简化版（`openAdminActivate`），并隐藏了指向完整版的静态按钮（`openActivationFromSettings`）→ 已登录用户被锁死在简化版。
- **根因2（桥名写错，返工一轮）**：第一版修复调用 `electronAPI.license.show()`——但 preload 实际结构是 `electronAPI.activate.show()`（preload.js:132-133，IPC通道名 `license:show-activate` 误导性地带 license 前缀，但挂载对象是 `activate`）→ 条件永远 false → 落回旧弹窗。**教训：引用 electronAPI 桥前必须先 grep 该端 preload.js 确认对象结构，不能凭 IPC 通道名语义猜挂载对象名。**
- **修复（13 文件：云端离线两权威源 + 11 副本）**：adminBtn 点击处理改为——有 `electronAPI.activate.show` 桥（桌面版）优先打开主进程完整激活窗口（三Tab齐全）；无桥（云端网页/APP）走 auth-core DOM 弹窗兜底。云端/离线桌面 preload 结构一致已验证。
- **验证方法论升级（关键）**：不能只看源码就宣布修复——**必须从打包产物 asar 提取实际文件实证**（`_diag/extract-asar.cjs dist\win-unpacked\resources\app.asar auth-core.js` → grep 桥名字符串）。本轮产物级验证：正确桥名 `electronAPI.activate.show` 在 asar 内 ✓、旧桥名 `electronAPI.license.show` 已消失 ✓。源码正确但产物陈旧/产物正确但源码未同步，都只有产物实证能抓住。
- **验证结果**：13 文件语法+标记唯一性、check-interface 6/6、V1.2.129 E2E 3/3 PASS、用户实测三Tab完整显示 ✓。
- **生效方式**：云端桌面版=安装 `Setup 1.2.129.exe`（用户已验证 ✓）；云端网页/APP=无桥环境走 DOM 弹窗兜底（行为不变）；离线桌面版=重新 build.bat 打包 exe；离线APP=重新打包 APK（仅副本一致性）。

### 2.42 【手动打包闪退】build-pack.bat 行尾 LF→CRLF + 工单审批 sessionStorage 跨标签页（提交 211d0226/b017afbf，2026-08-22）

- **表象1**：用户双击 pack-desktop.bat 手动打包，窗口一闪而过，无任何新产物（version 停在 1.0.92）。复现：cmd 逐行报 `'Host'/'制' is not recognized`、`| was unexpected`（exit 255）——UTF-8 中文多字节按 LF 断行错位解析。
- **根因1**：工作区 build-pack.bat 行尾全 LF（315行孤立LF/0 CRLF），违反 ".bat 必须 CRLF" 铁律（.gitattributes 早有 `*.bat text eol=crlf`）。上一小时打包成功时还是 CRLF，某次 git 操作把该文件以 LF 写回工作区。**db-yunduan/build-pack.bat 同为中招**（下次云端手动打包必然同样闪退）。全仓库 41 个 bat 复查仅这 2 个中招。
- **修复**：两文件字节级 LF→CRLF（内容零变化，git 无 diff——仓库本来就 LF 存储，这是**工作区检出层**的问题）。下次某文件再出现"双击闪退+无产物"，先查行尾再查逻辑。
- **表象2**：工单审批页永远"未登录：请先在激活码管理页登录平台管理员"，用户反复登录无效。
- **根因2**：登录 token 按 P2-7 安全口径只写 sessionStorage（不跨标签页），而工单审批入口 `<a target="_blank">` 新开标签页 → 永远读不到 token。修复：链接去 `_blank` 改同标签页跳转（sessionStorage 同标签页导航保留），build-queue 是公共页无需会话保持 `_blank`。site-admin 源 + public 部署副本两处同步。
- **教训**：sessionStorage 作登录态存储时，站内所有入口链接禁止 `target="_blank"`（新开即丢会话）；排查此类"反复登录仍无效"优先查链接打开方式。

### 2.43 【离线版用户管理显示"2个管理员"】2.36 过滤漏同步离线4副本 + 试用期降级设计链（提交 211d0226，2026-08-22）

- **表象**：离线客户B激活码激活后，用户管理列表显示两行——"管理员(admin)[正式] 普通用户" + "测试医生B(13800138002)[正式] 管理员"，用户误读为"2个管理员"。
- **真相**：数据层完全正确。第1行"管理员"是**姓名字段**（displayName 恰好叫"管理员"），其角色实为"普通用户"；唯一管理员是激活者。完整设计链：①试用期无 license 强制标准版、全员降 user（main.js:235）②激活码激活时激活者手机号建为 role=admin（license-manager.js:2061）③机构版仅保证≥1管理员、不回提旧 admin（license-manager.js:2166，2026-08-20规范）。
- **缺口**：2.36 的 renderUserList 过滤 `getUsers().filter(u => !isBuiltinDefaultAdmin(u))` 只同步了云端3副本（public/cloud_desktop/cloud_app），**离线4副本**（db-offline/desktop、根目录、index-app、离线APP assets）全部漏掉 → 内置默认 admin 仍显示，与角色标签撞词引发误读。
- **修复**：4 副本补齐过滤（脚本 sync-236-offline.cjs，模式唯一命中替换，前置校验 isBuiltinDefaultAdmin 已由 USER-STORE 块提供）。check-interface 6/6 OK。
- **教训**：跨端同步类修复，完成云端后必须用同款 grep 扫**离线系**副本是否同样适用——"云端先行、离线跟进"的节奏最容易漏离线。
- **生效方式**：离线桌面版=装 Setup 1.0.93（用户已验证 ✓）；离线APP=重新打包惠康中医-本地.apk；云端3端无变化（已有过滤）。

### 2.44 【平台管理员调整账号设备数量配额】admin-get/set-device-quota 接口 + 后台「设备配额」弹窗（提交 1f07a20e/54957be5，2026-08-22）
- **需求**：设置平台管理员可增加/修改账号设备数量上限，解决 wgj 等账号被"每账号 2 台设备"限制拦截的问题。
- **实现**：①`functions/api/users.js` 新增 `GET admin-get-device-quota` / `POST admin-set-device-quota`（仅 `isPlatformAdmin` 可调），`bindUserDevice` 保留 KV 中已有 `maxDevices` 不强制覆盖；特殊豁免名单 `DEVICE_LIMIT_EXEMPT_ACCOUNTS=['wgj']` 默认配额 99（实际不限，避免前端对 -1 显示异常）；②后台 `site-admin/admin/index.html` 用户管理操作列加「📱 设备配额」按钮 + 弹窗（显示当前配额/已绑定设备明细/输入 1~100，99=不限），`public/admin/index.html` 双副本同步。
- **验证**：`node --check users.js` OK；生产接口未登录调用返回 401「未授权：仅平台总管理员可查询设备配额」→ 证明路由已随 Cloudflare Pages 自动部署且权限守卫生效。完整功能需平台管理员登录后台点「设备配额」实测。
- **生效方式**：纯后端+云端网页版后台=push GitHub 自动部署即时生效（本次已推送）；桌面/APP 端用户管理后台未改、无影响。

### 2.45 【离线桌面试用（标准版）显示"用户管理"而非"修改密码"】标准版强制守护已锁定改密按钮（build 1.0.94，2026-08-22）
- **表象**：离线桌面试用（标准版）登入后操作界面显示"用户管理"，规范要求显示"修改密码"。
- **根因确认**：button-manager.js `__computePermissions` 的 Arch 2.26 断言：`isInst && _isAdminRole → 用户管理`；`isPersonal → canManage=false, canChangePwd=true`（改密按钮）。permission.js `canManageUsersByRole` 对标准版强制 `return false`、`canChangePassword` 对标准版强制 `return true`。试用期 `ensureTrialStandardEdition` 强制 edition=personal + 全员 role=user → 逻辑上必显示「修改密码」。
- **验证**：离线 E2E（run-e2e.cjs）E1/E2/E3 3/3 全过——E2 反向注入 role:'admin'+edition:'clinic' 也会被强制降级为「修改密码」可见 +「用户管理」隐藏。
- **生效方式**：离线桌面版=装/更新到 Setup 1.0.94（含本修复）；离线APP=重新打包惠康中医-本地.apk。

### 2.46 【手动严格打包闪退·根治】consolidation move 嵌套 + E2E 静默兜底双缺陷（build 1.0.96/1.2.130，2026-08-22）
- **表象**：手动严格打包"成功"（含 E2E 3/3 绿灯），安装后却闪退/启动异常，同类问题反复出现（1.0.95 实锤）。
- **根因1（嵌套污染）**：dist 被 Defender/句柄锁定时，consolidation 预清空只删掉一半（`dist\win-unpacked\resources\app.asar` 锁定残留空壳），随后 `move /Y build_output_<ts>\win-unpacked dist\win-unpacked`——**Windows move 在目标目录已存在时会把源移入目标内部**，生成 `dist\win-unpacked\win-unpacked\` 嵌套，且 move 返回 0（errorlevel 0）→ 误报 Consolidated 成功。主 exe 藏进二级目录、一级只剩半删除残留。实锤：`dist\win-unpacked\win-unpacked\惠康中医-本地.exe`。
- **根因2（E2E 假绿灯）**：run-e2e.cjs 硬编码 `dist\win-unpacked`，找不到主 exe 时**静默兜底** dev electron + 备份 asar（mode B），绿灯根本没测真实打包产物；若一级残留旧 exe 则测的是旧包。两种情况都会"绿灯放行坏包"。
- **修复（4 文件）**：①两端 build.bat consolidation 改防嵌套三铁律——move 前先删目标→删不掉则 rename 让路（`*_old_<BUILD_START_STAMP>`）→ 仍失败则 MOVE_OK=0 产物完整留 fallback，**绝不 move 进已存在目录、绝不 xcopy 合并出新旧混合包**；②两端 run-e2e.cjs 新增 `--dir <path>` 参数（指定后无主 exe 即红线 FAIL，绝不兜底）+ mode B 兜底打醒目 WARN；③两端 build.bat E2E 调用改为 `node "e2e\run-e2e.cjs" --dir "%OUTPUT_DIR%\win-unpacked"`（跟随 fallback 目录），marker 清理同步修正。
- **验证（真实锁定场景实测）**：离线 1.0.96——dist 锁定触发 fallback，exe 交付物成功 move 进 dist、锁定空壳不强并、无嵌套，E2E 3/3（真实产物 packaged-dir-arg 模式），exe 启动 10s 存活 RUNNING_OK；云端 1.2.130——正常路径，无嵌套，E2E 3/3，启动 RUNNING_OK。
- **举一反三**：Windows bat 里 `move dir target\dir` 目标存在≠报错而是**移入内部**，所有 move 合并目录的脚本都要"目标不存在才 move"；打包验证链（final-verify/E2E）必须显式指向**真实交付产物路径**并禁止静默降级兜底，否则绿灯=假绿灯。
- **生效方式**：离线桌面版=安装 `db-offline\desktop\dist\惠康中医-本地 Setup 1.0.96.exe`（锁定残留时产物也可能在 `build_output_*\`，按构建日志 Output directory 行为准）；云端桌面版=安装 `db-yunduan\cloud_desktop\dist\惠康中医-云端 Setup 1.2.130.exe`；打包脚本修复本身随 git 生效，无需额外操作。

### 2.47 【手动打包闪退·复发根治】入口自愈防线：.bat 行尾在解析前自动修复（build 1.0.98，2026-08-22）
- **表象**：双击 pack-desktop.bat 手动打包桌面程序，窗口一闪而过、无任何输出——与 2.42 完全同症状**再次复发**（用户明确："不是安装闪退，是手动打包桌面程序闪退"）。
- **根因（为什么 2.42 修完还会复发）**：2.42 只做了**一次性手工修复**（把当时 2 个 LF 文件字节级改回 CRLF），没有堵住源头：①AI/Edit 工具仍会把含中文的 .bat 直接以 LF 行尾写盘；②git 仓库内部本就按 LF 存储（`.gitattributes *.bat text eol=crlf` 只保证检出），工作区被写坏后 **git status 完全不可见**；③既有的行尾自愈逻辑藏在 ensure-build-env.ps1/build.bat **内部**，而闪退发生在 cmd **解析** build-pack.bat/build.bat 的瞬间——受害脚本永远执行不到自己的修复代码。
- **修复（结构性防复发，7 文件）**：①新增 `tools/fix-bat-crlf.ps1` 自愈卫士：只重写含孤立 LF 的文件（CRLF 文件不碰）、仅动严格 UTF-8 内容（GBK 等非 UTF-8 [SKIP] 跳过绝不写坏）、内容零变化只改行尾、永远 exit 0 不阻塞调用方；②6 个手动打包入口（db-offline / db-yunduan 各自的 pack-desktop.bat、pack-app.bat、pack-app-strict.bat）在 `call` 下游之前先跑自愈，把下游 build-pack.bat / build.bat / build-app.bat 的行尾当场恢复 CRLF；③入口 bat 自身保持纯 ASCII（对行尾问题天然免疫）。桌面链路 `pack-desktop.bat → build-pack.bat → build.bat` 已 grep 确认无其他 .bat 环节，自愈覆盖完整。
- **验证（双保险实测）**：①污染注入：故意把 build-pack.bat 写成 311 个孤立 LF → 跑入口自愈 → loneLF=0、后续解析正常不再闪退；②端到端真实打包：完整跑通 db-offline 手动桌面打包 4 分 10 秒，E2E 3/3（真实产物 packaged-dir-arg 模式）、铁闸终验 12 PASS、交付 `Setup 1.0.98` + portable 落 dist、无嵌套；云端入口自愈路径同样实测 [OK]。
- **沙箱跑打包注意**：TRAE 沙箱内收尾会遇 "Input redirection is not supported"（pause 无 stdin）与 Defender 拦截 exe 初始化写系统路径（SogouPY 等）——均出现在 "[OK] 打包完成" 横幅**之后**，属沙箱限制非脚本问题；用户双击不受影响（判定依据：错误位置在全部打包输出完成之后）。
- **教训**：①"一次性修复"必须升级为"结构性防复发"，修复代码必须放在受害脚本**被解析之前**执行（入口前置防线）；②工作区行尾污染 git 不可见，防行尾问题只能靠运行时自愈，不能指望 git 检查发现；③本次还实锤 dist 旧 `win-unpacked\resources\app.asar` 被 Defender 锁定（无任何僵尸进程占用、taskkill 无对象）→ 构建按 2.46 三铁律 WARN 并把新产物完整留在 fallback 目录，属设计内行为，交付物（安装包）不受影响。
- **生效方式**：打包脚本修复随 git 生效，用户直接双击 pack-desktop.bat / pack-app.bat / pack-app-strict.bat 即可（即使 AI 再写坏行尾也会当场自动修复）；本次真实产物=离线桌面版 `db-offline\desktop\dist\惠康中医-本地 Setup 1.0.98.exe`（win-unpacked 因旧残留锁定完整留在 `build_output_20260822_192911\`，安装包已正常落 dist，与 1.0.96 功能等价、仅打包链路加固）。

### 2.48 【下载页哈希不一致·根治】calculate-hash.js 构建期改写发布清单 + manifest 恢复为已发布真值（2026-08-23）
- **表象**：hash-manifest.json 的 sha256/size/fileName 描述的是本地最新构建（如 Setup 1.0.97 / 1.2.131），但 url 仍指向旧 GitHub Release（1.0.56 / 1.2.36）→ 线上下载页"校验值"与用户实际下载的文件**必然对不上**；dingzhi.apk 同病（manifest 记录构建输出 APK 2851502 字节，downloads/ 实际服务 2786835 字节）。此问题自 v2026.08.18 发布起持续存在、每次构建复发。
- **根因（三环复发链）**：①`shared/calculate-hash.js` 在每次打包后（build-app.bat:455）把本地 dist/apk 输出的哈希写进 `public/hash-manifest.json`，但 url 字段保留旧值（"避免 url 丢失"）——写入的哈希**没有任何 url 指向它**；②`one-click-pack.ps1 -AutoCommit` 把 hash-manifest.json 列入"打包副作用"自动 commit+push 上线（如提交 260dcec6）；③推上 Cloudflare 后下载页 download.html 把 sha256 显示在下载按钮旁。另外 `auto-publish.js` 依赖 manifest 记录"已发布哈希"做变更检测，被构建期改写后 local-vs-local 恒等 → "无需发布"误报，检测静默失效。
- **修复（数据 + 源头双管齐下，5 文件）**：①**manifest 恢复已发布真值**——dingzhi 三条目恢复自发布提交 415f6ebf（v2026.08.18，APK 哈希与 public/downloads/ 实际文件实测一致 8f08c7f0…/2786835），cloud exe/portable 恢复自 20209bbc（v2026.08.17，1.2.36 真值），并找回 version/releaseTag/releaseFileName 字段；cloud.apk 原本就一致未动；②**源头堵死**——calculate-hash.js 改只读：仍扫描+计算+打印（并新增"与已发布版本对比"提示：一致/本地新构建待人工发布），**绝不写 manifest**；3 副本（shared/ + db-offline/ + APP assets）同步一致；③build-app.bat:459 成功提示文案同步修正（不再宣称"updated to hash-manifest.json"）。
- **验证**：`node tools/verify-release.js` 6/6 全过（4 个 GitHub Release URL + 2 个 pages.dev downloads URL，200）；只读版 calculate-hash.js 实测运行后 `git diff` 证明 manifest 零触碰；build-app.bat 行尾 CRLF 完好（loneLF=0）。
- **教训**：①"发布清单"类文件（hash-manifest/latest.json）只能由**发布动作**写入——构建期写入 = 状态必然漂移，因为构建产物 url 不存在；②git 历史里的发布提交是哈希真值的权威来源（publish-release.js 上传时记录的就是所传文件的哈希）；③排查"下载页校验值不对"先跑 verify-release.js（本项目自带 URL+Content-Length 校验）。
- **生效方式**：云端网页版=推 GitHub 自动部署即时生效（下载页校验值立即恢复正确）；打包脚本变更随 git 生效，**下次任何打包都不再改写 manifest**（构建日志会打印"本地新构建，尚未发布"提示，属正常）；如需发布新产物（离线 1.0.98 / 云端 1.2.131 / 新 APK），人工核验后走 `一键发布.bat`（EXE→GitHub Release + manifest + latest.json）或 `node tools/auto-update-downloads.js <target> --confirm --push`（APK→downloads/）。

### 2.49 【云端桌面打包 dist 空】并发构建冲突根治：全局构建互斥锁（build-lock.ps1，2026-08-23）
- **表象**：用户双击云端手动桌面打包，跑完后 `cloud_desktop\dist` **完全为空**（无 Setup、无 win-unpacked、连 build_output_* fallback 也没有），但 package.json 版本已 bump（1.2.132）——打包启动过但产物消失。
- **根因（时间线铁证）**：**两个构建并发冲突**。20:02-20:04 AI 沙箱在跑云端 APP 打包（其混淆步骤 20:03:37 正在写 cloud_desktop\debug-logger.js 等共享文件）；20:03 用户双击的云端桌面打包同时启动（version bump + dist 清理重建 20:03:08）。两者争抢同一批源文件（obfuscate 共享目标）/node_modules/git index，桌面构建在 electron-builder 产出前被打断 → dist 只剩空壳。排除项：无进程残留、无 .bak 污染、electron 源码 git status 干净、APP 构建链不碰 dist（仅复制 config.json）。
- **修复（恢复 + 根治，两层）**：①**恢复产物**：无并发重跑云端桌面打包成功，`dist\惠康中医-云端 Setup 1.2.133.exe` + portable + 交付核对单全部就位（E2E 3/3 PASS）；②**根治：全局构建互斥锁** `tools/build-lock.ps1`——6 个构建脚本全部接入（build-pack.bat ×2 的 :main acquire / :finalize release + build.bat ×2 + build-app.bat ×2 的头尾），任何两个构建（桌面/APP/跨端）并发时后者被清晰拦截并退出，杜绝冲突复发。
- **锁设计要点（防误报优先）**：①锁记录**调用方 cmd.exe PID**（非 powershell 短命进程），构建崩溃→cmd 退出→PID 死亡→下次自动"陈旧接管"，无需人工清理；②双条件陈旧判定：PID 死亡 **或** 锁龄>45min → 接管；③**可重入**：build-pack.bat → build.bat/build-app.bat 是同一 cmd 链条（call），下游 acquire 检测锁 PID==自身 cmd PID → 放行不覆盖；release 按 owner 校验——下游 release 因 owner 不匹配被 Skip，链条入口（build-pack :finalize）才是真正释放者（所有失败/成功路径都经过 :finalize）；④release 幂等 + 非 owner 不误删他人锁。
- **验证**：单元测试 6/6（acquire/占用 exit 2/陈旧接管/防误删/释放/幂等）+ 链条模拟 4/4（Acquired→Reentrant→Skip→Released）+ 真实构建两轮端到端（离线 APP：Acquired by offline-app…Released 全日志序列 + 构建结束 .build.lock 不存在；云端 APP：build-pack 层 Acquired by cloud-pack 出现在 node/java 检查之前=前置段也受保护）。期间发现并修复一个关键 bug：重入判断初版放在 BUSY 判断之后导致永远不可达（同 PID 活锁先 exit 2），必须放在 BUSY 判断**之前**。
- **举一反三**：①"AI 沙箱跑构建期间用户同时双击打包"是真实高频场景，所有会写共享文件的脚本（构建/混淆/同步）都要考虑互斥；②batch 跨进程互斥用"锁文件+记录调用方 PID+存活检测+陈旧接管"模式，不用 flock（Windows batch 无原生支持）；③入口 bat 拦截提示必须告诉用户怎么自救（等待/删除锁文件）。
- **生效方式**：打包脚本随 git 生效；云端桌面最新安装包=`db-yunduan\cloud_desktop\dist\惠康中医-云端 Setup 1.2.133.exe`（重跑产物，含 2.48 哈希修复+2.47 打包链路加固）；此后同时双击两个打包脚本时，后启动的会显示"检测到另一个构建正在运行"并安全退出，等先前的跑完再双击即可。

### 2.50 【一键打包/一键发布同步优化】自愈防线覆盖编排器直调路径（2026-08-23）
- **缺口**：2.47 的自愈防线只护住了 6 个 pack-*.bat 入口，但两条**绕过入口的直调路径**未被覆盖：①`one-click-pack.ps1` 第 249/341 行直接 `Invoke-BatFile build-pack.bat app-strict`（不经 pack-app-strict.bat）；②`release-menu.ps1` 第 104 行直接 `cmd /c build-app.bat standard`。若这些 .bat 被 AI 写坏 LF 行尾，一键打包/一键发布的对应步骤会解析闪退。
- **修复（4 文件双层防线）**：①`一键打包.bat` / `一键发布.bat` 入口前置自愈——调用 fix-bat-crlf.ps1 一次性修复全部 8 个下游构建 .bat（两端 pack-desktop/build-pack/build-app/build.bat），入口保持纯 ASCII；②`one-click-pack.ps1` / `release-menu.ps1` 开头各加同款自愈块（protect 直接调用 ps1 的场景，如 release-menu 调 one-click-pack）。入口层 + 编排器层双保险，对 CRLF 文件零开销（no-op）。
- **并发锁说明（为何编排器不加锁）**：`Invoke-BatFile` 用 `cmd /c` 每次起新 cmd 进程，若 one-click-pack.ps1 层 acquire 锁，其调用的 build-pack.bat 链条 cmd PID ≠ 锁 PID → 可重入检测失败 → **自锁死锁**。故锁保持在 build-pack.bat/build.bat/build-app.bat 层（一键打包的每个构建链条内部各自 acquire/release，串行执行天然安全；与手动打包并发时由链条内锁拦截）。编排器前置阶段（菜单/配置）不写构建共享文件，无需锁。
- **验证**：①污染注入——把 db-yunduan\build-pack.bat 写坏为 324 loneLF → 跑 `one-click-pack.ps1 -CollectSideEffectsOnly -DryRun`（不打包模式）→ 自愈块当场修复，且 `git diff` 证明修复后与 HEAD 逐字节一致（只改行尾零内容损坏）；②入口实测——`一键打包.bat nosuchmode`（无效模式）：cmd 正确解析 8 参数长命令行、自愈执行（日志两遍 all CRLF=入口+ps1 双保险）、无效模式正确报错 exit 1、无闪退无挂起。
- **教训**：①`-CollectSideEffectsOnly -DryRun` 是 one-click-pack.ps1 的"不打包冒烟测试"参数，验证编排器改动时优先用它（完整打包一轮 7 分钟太久）；②Edit 编辑带 BOM 的 .ps1 必剥 BOM（本轮 one-click-pack.ps1/release-menu.ps1 双双中招，已用 UTF8Encoding($true) 补回）；③检查脚本含中文路径字面量时，无 BOM 的临时 ps1 会被 PS5.1 按 ANSI 误读报"Illegal characters in path"——临时脚本要么加 BOM 要么用 Get-ChildItem 枚举避开中文字面量。
- **生效方式**：随 git 生效。用户双击 `一键打包.bat` / `一键发布.bat` 时，即使下游 .bat 行尾被写坏也会当场自动修复（日志显示 [FIX]/all CRLF）；若同时有手动打包在跑，一键打包的对应构建步骤会显示"检测到另一个构建正在运行"并跳过该步（等手动构建结束后重跑一键打包即可）。

### 2.51 【双管理员根因】激活开通无"一诊所一管理员"约束 + 删除用户不同步云端（提交 0d12a778，2026-08-23）
- **表象**：云端桌面用户管理显示两个管理员：王桂杰(13398628756)[正式] + 王桂(13398628212)[测试]。
- **根因**：两次"管理员激活"申请均审核通过，`admin-account.js` 的 `ensureClinicUser` 每次都无条件补 clinic_admin（role 固定，无"诊所已有管理员"判断）→ 云端同诊所两个 clinic_admin → 桌面端登录后云端权威 role 落地本地表 → 双管理员。连带缺陷：三端用户管理"删除"只删本地 localStorage 表、云端账户仍在，被删账户下次云端登录又会落地回来（"删不干净"）。
- **修复（后端2+前端3共5文件）**：①`users.js` 新增 `POST /users?action=delete-user`（platform_admin 任意诊所/clinic_admin 仅本诊所；禁删自己/禁删 platform_admin/最后一个 clinic_admin 不可删；移除记录+revokeAllUserTokens 立即下线+审计日志；云端处方保留）；②`admin-account.js` 唯一管理员加固——诊所已有 clinic_admin 时，再次激活的新手机号开通为 doctor（换管理员手机号走平台后台 update-user 角色互转）；③三端 index.html（cloud_desktop/public/cloud_app assets）`handleDeleteUser` 先删云端再删本地：400/403 云端拒绝则阻断并显示原因、网络失败 confirm 询问是否仅删本地、404=本地账户正常继续、无 token 离线场景跳过云端直删本地。
- **数据处置（已执行）**：用 wgj/admin123 登录（正确端点=`POST /api/users?login=true`，body 带 clientClass）获取 token → 调 delete-user 删除云端王桂(13398628212) → GET /api/users 验证列表已无该账户、王桂杰(13398628756)/wyx/zsy 完好。
- **遗留提示（已处置 2026-08-23）**：应用户要求再删 13398628756、保留 wgj——云端现为唯一管理员 wgj（clinic_admin）+ wyx/zsy 两个 doctor；13398628756 的 token 已全部撤销（立即下线）。若用户桌面端本地表残留 13398628756 条目，在用户管理里手动删除即可（云端已无此账户，不会再同步回来）。
- **教训**：①"删除/修改"类操作在"本地缓存+云端权威"双数据源架构下必须两端同步，否则状态必然回漂；②开通/注册类接口要考虑"重复执行"的幂等语义边界——同名诊所第二次激活≠需要第二个管理员；③云端 API 正确登录端点是 `/api/users?login=true`（POST，body 含 username/password/machineId/clientClass），不是 /api/auth 或 /api/users?action=login。
- **生效方式**：云端网页版+云端APP=已推送自动部署即时生效（APP 为 WebView 壳取线上 public/）；云端桌面版=需重新 build.bat 打包 exe（不重装也可用：云端王桂账户已删，用户在当前版本用户管理里删王桂本地条目即可，云端已无此账户不会回来）。

---

## 3. Hard Constraints（全项目硬约束）

- 跨作用域/跨文件调用审计：`node tools/audit-cross-scope.js` 预防 `setCloudActivationDone` 类 "is not defined"。auth-core 9 副本一致；恢复备份（restoreFromBackup）后改用实际存在的 `renderHistoryList(数据)` 刷新，跨脚本函数一律 `typeof fn === 'function' && fn(...)` 防御。
- 云端静态资源缓存：public/_headers 业务 JS 一律 `max-age=0+must-revalidate`（etag 304）；仅 qrcode.min.js / xlsx.full.min.js 第三方库 7 天长缓存；config.json 单独 no-cache。教训：曾 /*.js max-age=86400 导致云端 APP(LOAD_DEFAULT)最长 24h 不拉新版，auth-core 更新不生效。
- 云端 APP 的 clinicName 等部署配置来自线上 `public/`（pages_build_output_dir="public"），**根目录 index.html/config.json 是离线/桌面版源码，与线上云端网页版无关**！
- 线上云端版诊所名：public/config.json(clinicName+doctorName)，public/index.html 同步 XHR 读取覆盖，auth-core syncLoginClinicName 注入登录框。
- 对所有硬约束的通用原则：否决用工具误伤正常打包；宁漏检不可误报；失败要有"为什么"，报错要带处置路径。

---

## 4. 生效方式速查（改完必告之用户各端如何生效）

| 改动范围 | 如何生效 |
|---|---|
| 云端网页版（public/ 或 functions/） | push GitHub 自动部署，网页/APP 在线即时生效 |
| 云端桌面版 | 必须重新 build.bat 打包 exe，重装/更新后重新登录一次 |
| 离线桌面版 | 必须重新 build.bat 打包 exe |
| 云端 APP | 若改的是线上 public/ → 推 GitHub 自动生效（无需重打 APK）；若改 APK 内 assets → 需重打 APK |
| 离线 APP | 必须重打 `惠康中医-本地.apk` 并重装 |
| 纯后端 functions | push GitHub 自动部署即生效 |

---

## 5. 教训速记（Lessons Learned）
- ⚠️ `.bat` 用 UTF-8 + `chcp 65001` 时，**echo 含中文多字节 + 特定空格位置会触发 cmd 解析 bug**（双击全新 GBK 控制台时报 `'xxx' is not recognized`）。本项目 `学习经验.bat` / `同步推送经验.bat` 因此**输出全部用纯 ASCII**（文件名仍是中文），逻辑不变且任何系统代码页双击都稳定。**不要往这两个脚本里加中文 echo**。
- `Edit` 编辑 `.ps1` 会剥掉 BOM，需重新补 BOM。
- `git diff` 对含中文的 bat 显示为乱码（`惠康`→`鎯犲悍`）**不一定是损坏**，是 GBK/UTF-8 字节渲染伪象；判定以字节级为准（`node -e` 读 UTF-8）。
- 打包产物目录 `build_output_*`、`_build_run*.err` 为构建噪音，勿 git add。
- 登录/API/数据均已实测正确时勿再盲改代码，应加运行时诊断日志（如 login_debug.json）拿铁证。wgj 云端测试密码 = **admin123**（勿用 admin 反复试，会触发锁定）。