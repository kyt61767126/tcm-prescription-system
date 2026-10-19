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

## 当前基线（2026-10-19 更新）

- **main HEAD：本次 docs 提交**（代码基线 `a9193675`；打包版本收纳 `adcd4ee8`；其后 push 由 Pages git 构建自动部署）。2026-10-17 P40 收尾：登录闸 NO_LICENSE 码错位自愈 + 热更 **2026.10.17-7** + 令牌幂等台账补写 + Java clinicName 透传入库；P40 真机已激活+登录闭环；**离线整包已构建（H7：exe 1.0.276 + APK 322，待发布/复测）**。
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
  - desktop/local 热更 **2026.10.18-3**、desktop/cloud 热更 **2026.10.18-1**、app-local **2026.10.18-4**（发布时三渠道版本表统一）。
  - **勿重复实施**：-6 调试 alert 已移除并重签 -7 覆盖；P40 登录闸码错位自愈已上线；令牌 redeemedDevices 台账（首兑写 + 幂等短路补写）已上线；Java `activateLicense` clinicName 透传已入库（待 APK v325 生效）。
  - 完整方案：`.trae/documents/activation-architecture-optimization_plan.md` / `.trae/documents/activation-streamline_plan.md`（P0 方案A 全链已闭环，详见 KNOWLEDGE 2026-10-17 条目）。
- **2026-10-18 构建现场已清理（已决）**：外部会话 09:45 打包因版本基线漂移中止——产物 1.0.277/1.2.269/cloud APK 325 已归档到 `%TEMP%\kyt-build-archive-20261018-102617`，工作区残留已从 `stash@{0}` 丢弃并删 dist 残留；`verify-version-baseline` 复核通过（HEAD 1.0.276/1.2.268/322/324，dist 无残留）。下次打包将按**最新代码**（含 S1b-③ gate token/会话）重新递增到 277/269/325；产物发布仍为独立人工闸。
- 工作区有多个**未跟踪文件**（`_verify/`、`_verify-report.md`、`promo/`、`tools/_tmp/*` 等）：非本台账任务产物，**提交时精确 `git add`，禁止 `git add -A`**。

---

## OPEN 遗留任务

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
