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


### 2.11 激活流程一键微信客服（提交 2e6fcee8）
- **功能**：试用到期→激活提交全流程增加"一键联系微信客服"（复制微信号 hktzy1688 + 唤起微信 + 三步指引），等待审核面板与底部客服栏双入口。
- **复刻矩阵**（5 处，一处都不能少）：①离线桌面 activate-window.html+activate.js；②云端桌面 activate-window.html+activate.js（同款文件双项目各自改）；③auth-core.js 离线三副本（desktop/、desktop/electron/、app assets/public/，用 Copy-Item 整文件同步+fc /b 验证字节一致）；④MainActivity.java shouldOverrideUrlLoading 加 weixin:// 单 scheme 白名单 → Intent 唤起（未装微信仅 Log.w 不闪退）。
- **唤起链路按端**：桌面激活窗口=activate.js 给 activateWindow 加 setWindowOpenHandler（白名单 weixin:///https:// → shell.openExternal，主窗口已有无需改）；auth-core 内嵌弹窗=主窗口 main.js 既有 handler 直接过；APP=MainActivity 放行。
- **教训**：PowerShell 无 bash heredoc，多行 commit message 用临时文件 `git commit -F`（首条命令 parse error 时**整条命令含前面的 git add 都不执行**，重跑必须从 add 开始）。
- 生效：离线桌面/云端桌面=重打包 exe；离线 APP=重打 APK（MainActivity+assets 都改了）；云端网页版零改动。

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