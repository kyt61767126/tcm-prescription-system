# 惠康中医项目 · 共享经验知识库（PROJECT KNOWLEDGE）

> 本项目**跨 work 账户共享的"统一大脑"**。任何账户打开本项目，第一步先 Read 本文件。
> 最后更新：2026-08-20
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