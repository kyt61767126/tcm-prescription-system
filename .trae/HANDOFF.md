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

## 当前基线（2026-10-16 更新）

- **main HEAD：`67cd9b62`**（2026-10-16 P0 激活方案 WIP：服务端/落地页/桌面/离线App/**云App 深链接**完成，鸿蒙/双审查/热更未做，详见 OPEN H5）。
- **近 24h 已上线、**勿重复实施**：
  - KV list 1000/天告警根治（order_index + safeListPage 熔断/短缓存，`6601c943`，详见 KNOWLEDGE 2026-10-13 条目）。
  - 激活架构 **P1** 客户端「只填码」身份自动带出（`b7bf5530`）。
  - 激活架构 **P2** 服务端裸码「码+手机号」单锚点首激（`3a7a762f`，开关 `config:activation-phone-anchor`）。
  - 激活架构 **P3** claim/order 请求体收口 `buildActivationPayload`（`3498c5ba`，纯重构零行为变化）；auth-core cv=**ed835152**（云端刷新即达）；离线 App 热更 **2026.10.14-1，minAppCode 288 不抬**（退出重开第 2 次生效）。
  - 完整方案：`.trae/documents/activation-architecture-optimization_plan.md`（P1/P2/P3 全部闭环）。
  - 云 App bnzc:// 深链接实现（`67cd9b62`）：MainActivity.java 四方法 + NativeBridge 三 case + bnzcRedeemToken(productClass=cloud)，自审 PASS。
- 工作区有多个**未跟踪文件**（`_verify/`、`_verify-report.md`、`e2e/.tmp/*-test.*` 的一部分、`promo/`、`tools/_tmp/*` 等）：非本台账任务产物，**提交时精确 `git add`，禁止 `git add -A`**。

---

## OPEN 遗留任务

### H5 ｜优先级：高｜P0 激活方案·一键激活全端打通 + 链接安全化（在制品）
- **状态**：IN-PROGRESS（本账号@本机器，2026-10-16）
- **方案文档**：`.trae/documents/activation-streamline_plan.md`（已获批）
- **背景**：把旧 `bnzc://activate?code=裸码` 升级为 `?t=<一次性令牌>`（双参数并存兼容），令牌 32 字节 CSPRNG base64url、KV 权威、24h 有效、首兑机绑（同机幂等/异机 409）、兑换不发新码不写账号；落地页 `public/activate.html` 自包含零依赖 + CSP 严格 + 微信遮罩；后台生成器异步调 `/api/license/activation-token` issue。
- **已完成（本会话 WIP 将提交）**：
  - 服务端 `functions/api/license/activation-token.js`：路由 `POST /api/license/activation-token`，actions=issue/preview/redeem/revoke；单测 `tools/_tmp/activation-token-test.cjs` **42/42 PASS**（鉴权/签发/preview 不泄码/redeem 同机成功+异机409+幂等/端锁 preset 硬拦 device 观察期放行/过期/revoke 单+批量/fail-closed/频控429）。
  - 落地页 `public/activate.html` + `site-official/activate.html`（镜像）+ `tools/diff-cross-version.cjs` 新增 activate pair + `tools/.cross-version-baseline-activate.json` 基线。
  - 后台生成器 `public/admin/index.html` + `site-admin/admin/index.html`（双副本一致）：`generateActivationLink` 异步 issue，失败回退裸码。
  - 桌面双端 Electron：离线 `db-offline/desktop/electron/{main,preload,login}.js` + 云端 `db-yunduan/cloud_desktop/electron/{main,preload,login}.js`——`parseBnzcUrl` 支持 `t=`、`bnzc:redeem-token` IPC handler、6 处日志脱敏。
  - 离线 App 深链接：`db-offline/app/.../MainActivity.java`（parseBnzcDeepLink/onNewIntent/dispatchBnzcToWebView/NativeBridge 三 case/bnzcRedeemToken productClass=offline）+ manifest intent-filter。
  - 云端 HTML 权威源 `public/index.html`（bnzcGetPending 判 `code||token`、onBnzcPendingActivation 日志脱敏、showBnzcActivationNotice 令牌兑换分支 tokenConfirmed）→ `sync-html.ps1` 已同步到 cloud_desktop + cloud_app assets。
  - 云 App manifest intent-filter（`db-yunduan/cloud_app/.../AndroidManifest.xml`）。
  - 云 App 深链接 MainActivity（`67cd9b62`）：parseBnzcDeepLink/onNewIntent/dispatchBnzcToWebView/appendBnzcDebug 四方法 + NativeBridge 三 case + bnzcRedeemToken(productClass=cloud, getStableMachineId)；`isSensitiveOperation` 加 bnzcRedeemToken 敏感标记；自审 PASS（6/6 检查点）。
  - 云 App shim 补口（`7a1393f3`）：injectElectronApiShim 加 bnzc 五方法（getPending/clearPending/redeemToken/autoActivate/onBnzcPendingActivation）+ `__bnzcEmitFromNative`；NativeBridge 加 activateOnline case（Java 复刻桌面 activateManager.activateOnline claim 口径：cloud/app、connect 10s/read 40s、needClinicName 透传）；成功后 2600ms reload 兜底（App 无 license.restart）；isSensitiveOperation 加 activateOnline。
  - 鸿蒙端深链接（`7a1393f3`，与安卓/桌面同构）：module.json5 skills（browsable+viewData，bnzc://activate）+ launchType singleton；EntryAbility onCreate/onNewWant 双收口（code 大写优先/t/clinic/user，脱敏日志）；NativeBridge bnzcGetPending（读后不删）/bnzcClearPending/bnzcRedeemToken（JS fetch 兜底）+ appendBnzcDebug；Index.ets emitter→dispatchBnzcToWebView 直推；shared-inject/cloud-electron-api-shim.js bnzc 六方法（redeemToken/autoActivate 同源 fetch claim，productClass=cloud/clientClass=app、40s 超时、needClinicName 透传、成功 2600ms reload）+ 机器码三级口径抽 bnzcMachineId 共用（桥优先→localStorage browser-xxx→生成式，与 auth-core collectDeviceIdentity 同款）；copy-assets 追平 rawfile 6 落后文件 + vendor/pinyin-pro + voice-input.js（工具既定行为）。
  - **注意**：云端权威源 L6670 `bnzcAutoActivate` 无方法级守卫——现六端均提供该方法后实际缺口已消（浏览器无 bnzc scheme 不触发）；若未来新增端须带齐 shim 六方法。
- **未完成（下一步按序）**：
  1. **热更已完成（`058e378f` 已 push，线上核验通过）**：三渠道 2026.10.16-1（app-local minAppCode 288 继承不抬/probe 探测式降级安全；desktop/cloud 20 文件；desktop/local 19 文件），Ed25519 三包自验全过，线上 version.json 实拉三渠道全命中。
  2. **整包构建已完成（2026-10-16）**：离线 App v320（验包三重+分发两文件位，旧 v316 归档 %TEMP%）、云 App v323（构建+验包）；versionCode 改动已 commit+push（d9dc48ab）。下载页 APK v320 已随 v2026.10.16-1036 发布闭环（1e7d4717）。
  2b. **鸿蒙构建：暂停（用户指示 2026-10-16）**。已达成的进度，恢复时直接续：① 环境齐备——DevEco Studio 26.0 在 `D:\Program Files\Huawei\DevEco Studio`（hvigor 6.26.4/ohpm/SDK default），签名材料 9-04 全套在 `~/.ohos/config`（debug+release 两套 .p12/.cer/.p7b）；② **unsigned HAP 构建成功**（hvigorw --mode module -p module=entry@default -p product=default assembleHap，BUILD SUCCESSFUL 27s，产物 entry-default-unsigned.hap 2.2MB）；③ **审查 P1 emitter 修复获编译实证**。剩余仅一步：DevEco GUI（File > Project Structure > Signing Configs > 自动签名，密码在 material/ 加密分片命令行不可还原）→ 重跑同命令出 signed HAP → 真机 bnzc 链路验证。
  3. **线上核验（发版终验）**：activate.html 可访问 + bnzc:// 端到端真机（双 APK 安装后：链接唤起→兑换/装码→激活成功；鸿蒙真机部分随 2b 暂停）。
  - **✅ 真机核验已完成（2026-10-17，P40）**：**云端 App v324 全链闭环 ✅**（深链接唤起→兑换→装码→「激活成功！即将重启」弹窗，logcat activateOnline jsonLen=61 实证）。**离线 App v324 暴露关键 bug（已修，见下）**：装码成功（服务端 validate 实证 license pro 有效、devicesCount 绑定 P40）但重启回「管理员激活页」= 本地手机号账号缺失——根因：旧链 bnzcAutoActivate 直调装码，链接不带 user 时 App Java 激活收尾 syncCreateActivationUser 因 username 空直接 return 不建号、桌面 installLicense 建号 phone 空 → auth-core 启动闸弹回激活页。
  - **✅ 方案A修复已完成（2026-10-17 本会话，用户拍板全自动编排，业务铁律「本地需先注册再激活」）**：
    - `db-offline/desktop/index.html`（离线权威页）：showBnzcActivationNotice 改调 **bnzcOfflineAutoActivate**（已注册→getActivationUsers 桥优先取手机号直装码；未注册→DOM 弹窗 bnzcCollectRegParams 收手机号+密码→registerLocalUser 建号→镜像三步→activate.submit 带手机号装码）。Electron 不支持 window.prompt 故用 DOM 弹窗；失败/取消**不清 pending**（令牌一次性兑换，码不能丢）+ 报错回显激活码引导手动激活。
    - `db-offline/desktop/electron/login.js`（桌面登录窗冷启动消费 pending 的主路径）：同构编排；镜像①不回写 localStorage 用户表（XORv1 加密约定，config.json 已由桥写入）。
    - `shared/desktop-license-ipc.cjs`（双桌面副本 sync-all 分发）：**P1 修复**——submit-activate 多设备授权弹窗 `showMessageBoxSync(getMainWindow(),…)` 在登录窗冷启动时主窗未创建（null 父窗 Electron 35 抛参→激活成功却报失败），改「主窗存在才带父窗」。
    - 双独立审查（2 功能互不通气 + 1 安全二查）全过：A 无 P0/P1；B 报 P1（null 主窗弹窗，已修）+ deviceInfo 死代码（已删）；安全 PASS（密码链/注入/越权/热更混跑窗口均查过，已注册判定改桥优先）。
    - 校验链全绿：sync-index-app 32 变换命中 / sync-all VerifyOnly 0 drift / diff-cross-version 6 对全绿（desk 基线重冻结=离线专属编排合法分叉）/ check-interface 6 OK。
  - **下一步（2026-10-17 更新，按序）**：
    1. **热更签发**：App 页面改动→`node tools/generate-app-hotupdate.cjs -n <递增>`（app-local，minAppCode 288 继承）；桌面 index.html→desktop/local 渠道；**login.js + desktop-license-ipc.cjs 主进程域热更不可达→离线桌面 exe 重打包**（可攒批）。
    2. **离线 App 端到端复测**：先在后台**解绑 MG3B 码的 P40 绑定**（devicesCount 已计但本地未生效），再用 local 端型新码真机复测（深链接→注册弹窗→注册→装码→重启→手机号+密码登录进系统）。
    3. **桌面离线 exe 重打后复测**：冷启动深链接→登录窗注册弹窗→装码→重启登录。
    4. **遗留疑点**（复测时顺带观察）：两端冷启动首次 bnzcGetPending jsonLen=2（空）随后 probe 重试拿到码——probe 兜底结果正确，时序复盘待 release 包 bnzc-debug.log。
    5. **★ 2026-10-17 真机复测进展 + registrationInfo 分裂修复（待 push）**：
       - P40 实测：热更 2026.10.17-1 已生效（logcat「热版本已是最新 2026.10.17-1」+加载 hot-update/current/index.html）；深链接链路可达（bnzcRedeemToken→激活成功）；但**未弹注册窗**。
       - **根因（双份同构）**：bnzcOfflineAutoActivate 的「已注册」判定兜底读了 localStorage `license:registrationInfo`——P40 有历史测试残留（预填 13398628212 即其旁证）而账号表空 → 误判已注册跳过建号 → 装码成功但启动闸只认账号表 → 重启弹管理员激活页（状态分裂自断链）。
       - **修复**：主窗 `db-offline/desktop/index.html` + 登录窗 `db-offline/desktop/electron/login.js` 同构——registrationInfo 降级为**注册窗预填源**（regHintPhone/regHintClinic，码锚点优先），「已注册」唯一准绳=账号表（与 auth-core isLocalRegisteredAsync 同口径）。
       - **已办**：双渠道热更 2026.10.17-2 已签（app-local 15 文件/desktop-local 19 文件，Ed25519 自验过）；MG3B 码已解绑重置（后台 status API action=unbind，machineId 传脱敏前缀须带 `...` 后缀）；新令牌已签发。
       - **剩余**：P40 拉热更（联网打开→划掉→重开 2 次）→ adb 注入深链接 → 应弹注册窗（手机号预填）→ 注册并激活 → 重启 → 手机号+密码登录闭环；桌面 exe 重打；复测闭环后沉淀 KNOWLEDGE（六端矩阵离线 bnzc 状态更新）。
       - 复测命令：`adb shell am start -n com.benneng.pres.dingzhi/com.benneng.pres.MainActivity -a android.intent.action.VIEW -d 'bnzc://activate?t=<token>'`（微信点 bnzc:// 会被拦，用 adb 注入或网页版 activate.html 引导）。
  4. **✅ 优化建议阶段 2 已完成（2026-10-16，commit `3a2ca967` 已 push，服务端 Pages 自动部署全端刷新即达）**：① validate.js resolvedIdentity.phone 优先回带 record.phone 锚点（淘宝预置>record 11位校验>请求回显），杜绝错号建本地账号；② 换机自动解绑留痕 lastUnboundDevice（与 devices 移除原子同批落库，拒绝路径不落库），被踢设备下次 validate 撞配额无凭证返回 reason=unbound-by-new-device+明确中文（向后兼容）；③ 后台激活日志/设备列表/风控审计三处设备友好名徽标（and-=安卓APP/browser-=网页/其他=桌面离线，悬停口径说明）。
  5. **✅ 优化建议阶段 3 已完成（2026-10-17，commit `81ba2693` 已 push，pre-push 十七道校验全过）**：① 鸿蒙 rawfile 兜底页纳入 sync-html.ps1 分发链（$Targets 第 3 目标——实锤旧结论纠正：鸿蒙副本与 public 权威源 SHA256 字节一致，非独立权威源，bnzc 掉队根因=不在同步链靠人肉复制）；② diff-cross-version.cjs 新增第 6 对 harmony 基线（lines 模式），全 6 对重冻结（desk probeBnzcPending 同体纳入 Tier B）；③ KNOWLEDGE 第 2 章传播链加鸿蒙行 + 章末新增六端能力矩阵（含鸿蒙三件套必查清单）。**优化建议三阶段全部收官。**
- **✅ 双独立审查已完成（2026-10-16，commit `24c5925e` 已 push）**：2 独立功能审查（互不通气）+ 1 安全二查。关键成果：
  - **P0 断链（审查员 B 独报、主会话亲验坐实）**：页面解析期 `const IS_ELECTRON` 固化 false（App shim onPageFinished 才注入）→ 双安卓 App/鸿蒙兜底页 bnzc 块永不执行=端到端断链。修复：`probeBnzcPending` 延迟重试探测（250ms×20），权威源 public/index.html + **db-offline/desktop/index.html**（sync-index-app.cjs 证实它才是离线 App 页权威源，index-app.html 是生成产物）→ 7 副本分发全绿；同法覆盖鸿蒙 onPageBegin 注入竞态。
  - **P1 桌面令牌日志脱敏（A+安全双证实）**：parsed 新增 token 字段使存量序列化日志恶化为完整令牌落盘 bnzc-debug.log——双端 main.js 全部 brief 化（前 8 位）。
  - **P1 鸿蒙 emitter 泛型（A）**：API 12 EventData 非泛型（泛型重载 @since 23）→ Index.ets 改保守非泛型+判空，DevEco 编译仍需实证。
  - P2 顺手修：离线 App isSensitiveOperation 对齐 bnzcRedeemToken；双桌面 parseBnzcUrl 删二次 decode（含 % 诊所名 URIError 致深链失效）；needClinicName 注释改准确；siteadmin 基线刷新（admin 无 bnzc 桥的合法分叉）。
  - 安全二查结论 PASS-with-notes：注入链转义安全、redeem fail-closed、频控 CF-IP、manifest 无新增 exported。可接受不改（P3）：redeem 并发双花有界（maxDevices 兜底）、host null 放行（manifest 已限定）。
- **勿做**：不发热更、不打 APK、不做产品决策（如放宽安全锚点须显式批准）；禁止手改生成副本（cloud_desktop/cloud_app assets/index-app/offline assets），改权威源后跑生成器。
- **验证命令**：
  - `node tools/_tmp/activation-token-test.cjs`（42 PASS）
  - `powershell -File tools\sync-html.ps1 -VerifyOnly`（0 drift）
  - `powershell -File tools\check-index-consistency.ps1`（OK）
  - `node tools/sync-index-app.cjs --verify-only`（PASS）
  - `node --check` 7 个 JS（activation-token.js + 双桌面 main/preload/login）
- **基线 commit**：`24c5925e`（双独立审查修复完成，已 push）　关联文档：`.trae/documents/activation-streamline_plan.md`

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
  - 🟡 附带观察（低优，不阻塞）：existing 重激活响应 `resolvedIdentity.phone` 回显客户端号而非 record 锚点号（validate.js L1093），错号场景客户端会建本地错号账号；建议后续改为优先回带 record.phone。
  - ⏳ 待测：A2/A3/B 组（云端三端）/C 组（桌面）/D1+D2（设备 B）/E 组（裸码，需管理员备 unused 裸码）/F1/F3/F4。
- **摘要**：
  1. 离线 App（已注册账号）：版本页金色按钮进激活码页 → 手机号自动带出 → **只输码**激活成功。
  2. 离线 App：试用到期提醒入口同上；App 需彻底退出重开第 2 次拉到热更 2026.10.14-1。
  3. 换机：新设备输码，手机号带出为原绑定号 → 自动解绑最旧机恢复；故意改错手机号 → 必须被拒。
  4. 桌面（Electron，云/离各一）：激活窗 user/clinicName/phone 正确透传桥 submit。
  5. 云端 Web/桌面：刷新即达（cv ed835152），登录态用户手机号自动带出。
  6. 渠道裸码（无锁端 personal 码）首激：码+手机号 200，`identitySource=phone-anchor`；后台激活码日志可见 `phone-anchor-activation`。
  7. P3 零行为变化核对（任一版本即可）：抓包 claim body 仍含 productClass/clientClass（云端另含 pwdCap:'v2'）；Tab1 直建订单 order-submit 正常（字段未缺失）。
- **异常回流**：任何一项失败，把现象/机器/版本记入本任务并改 BLOCKED，附 license_log action。

### H3 ｜优先级：低（长期观察）｜KV 容量与套餐
- audit_log 前缀 880 键（2026-10-13 实测，总 1926），接近单页 1000；D1 迁移完成后安排清理。
- 用户此前决策「先削减不升级」；若 list/write 再触限额，评估 Workers Paid（$5/月）。

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
