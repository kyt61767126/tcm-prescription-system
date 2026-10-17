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

## 当前基线（2026-10-17 晚更新）

- **main HEAD：本次 docs 提交**（代码基线 `a9193675`；打包版本收纳 `adcd4ee8`；其后 push 由 Pages git 构建自动部署）。2026-10-17 P40 收尾：登录闸 NO_LICENSE 码错位自愈 + 热更 **2026.10.17-7** + 令牌幂等台账补写 + Java clinicName 透传入库；P40 真机已激活+登录闭环；**离线整包已构建（H7：exe 1.0.276 + APK 322，待发布/复测）**。
- **线上状态（已实测）**：
  - production 部署源=每次 push 的最新提交（**Pages git 构建自动部署已 Active**；本次直传 `0012e7a2` 与 git 构建 `f9e9ea16` 已等价验证，后续无需手动 wrangler）；app-local 热更 **2026.10.17-7**（minAppCode 288 继承；线上 version.json 实测，auth-core.js SHA256 `bb4dede2…45210` 与 manifest 逐字节一致，无 `DEBUG verifyLoginGate` 串）。
  - functions 已随部署更新（activation-token GET 405 / 坏码 POST 400 冒烟通过；令牌幂等台账补写 + validate 诊所名闸台账豁免均在线）。**git 构建配额可用 → 后续静态/functions 随 push 即达，wrangler 直传仅作配额耗尽/大文件超限兜底。**
  - **激活架构评审（2026-10-17）**：`.trae/documents/activation-architecture-review-2026-10-17.md`（六端 × 激活方式 × 版本全景 + P0/P1 问题清单 + O1-O7 优化建议 + S1-S4 路线 + 待拍板 5 项；见 OPEN H8）。
  - **P40 真机闭环（2026-10-17 晚，已实证）**：-7 热更生效（DEBUG alert 消失）→ 管理员激活框用 `BNZC-MG3B-…` + 手机号重新激活（预设诊所名经 `redeemedDevices` 台账豁免）→ KV 记录 `status=used、devices=[P40 mid]、productClass=offline、clientClass=app`，`entitlement(mid)=LICENSED（institution，永久）` → **登录正常**（license_log 有 `activate machineId=5784b5da...`）。此前 -7 后仍弹激活框的真因=上一会话手工重置码记录造成「本地有 license.dat / 服务端 unused」分裂，非客户端 bug。
  - **整包批次（2026-10-17 晚，已构建未发布）**：离线桌面 **1.0.276**（Setup/便携，E2E 6/6 + 签名 + fuse + .bnzc 三重 + 7 铁闸全过）、离线 APK **versionCode 322**（aapt2/apksigner 验过，签名哈希与注入期望一致）、desktop/local 热更 **2026.10.17-3**（app 1.0.276）。发布需人工 `--confirm`（硬规则禁止自动上传，见 H7）。
  - desktop/local 热更 **-3**（等整包发布）；cloud 热更 -5；三渠道版本表在发布时统一。
  - **勿重复实施**：-6 调试 alert 已移除并重签 -7 覆盖；P40 登录闸码错位自愈已上线；令牌 redeemedDevices 台账（首兑写 + 幂等短路补写）已上线；Java `activateLicense` clinicName 透传已入库（待 APK v325 生效）。
  - 完整方案：`.trae/documents/activation-architecture-optimization_plan.md` / `.trae/documents/activation-streamline_plan.md`（P0 方案A 全链已闭环，详见 KNOWLEDGE 2026-10-17 条目）。
- 工作区有多个**未跟踪文件**（`_verify/`、`_verify-report.md`、`promo/`、`tools/_tmp/*` 等）：非本台账任务产物，**提交时精确 `git add`，禁止 `git add -A`**。

---

## OPEN 遗留任务

### H7 ｜优先级：高｜整包批次：离线桌面 1.0.276 + 离线 APK 322（✅ 已构建，待发布/复测）
- **状态**：IN-PROGRESS（2026-10-17 晚：构建+验包完成并已 push `adcd4ee8`；剩「发布」与「桌面冷启动深链真机复测」）
- **已完成（本批次，全部通过）**：
  1. **离线桌面 1.0.276**：`dist/惠康中医-本地 Setup 1.0.276.exe` 79,305,920 B / `dist/惠康中医-本地 1.0.276.exe` 79,031,040 B；含 login.js 方案A冷启动编排 + `shared/desktop-license-ipc.cjs` 空主窗弹窗修复；E2E 6/6、fuse 5 项、.bnzc/asar 三重、7 铁闸、真机启动冒烟全过；交付核对单 `交付核对单_V1.0.276_离线桌面版.txt`。
  2. **离线 APK 322**：`app_project/db-offline/惠康中医-本地.apk` 3,576,866 B（SHA256 `B7D034BA…`）；aapt2 `versionCode=322 / versionName=1.0.0`，apksigner 证书 SHA-256 `e5b2b4b3…` 与注入 LicenseManager 期望一致；含 Java `activateLicense` clinicName 透传（纵深防御）。
  3. **desktop/local 热更 2026.10.17-3**（app 1.0.276，19 文件，Ed25519 已签；相对 -2 仅 auth-core.js/version.json 变化，含 NO_LICENSE 码错位自愈）。
  4. 版本副作用自动收纳并 push：`adcd4ee8`（desktop/package.json=1.0.276 + app build.gradle versionCode=322）。
- **剩余动作**：
  1. **发布（需人工显式确认；硬规则禁止自动上传官方站）**：`一键发布.bat` 或 `node tools/publish-release.js --changed-only --confirm --push`（更新 hash-manifest + updates/latest.json + GitHub Release + 下载页部署）。
  2. **桌面冷启动深链真机复测**（装 1.0.276）：`bnzc://activate?...` 冷启动唤起 → 兑换 → 自动注册/装码 → 登录；重点验登录窗冷启动主窗为 null 的弹窗路径。
  3. P40 继续用 app-local -7；可选覆盖安装 APK 322 验 Java clinicName 透传。
  4. 收口：六端矩阵/HANDOFF 更新后删除本卡。
- **勿做**：鸿蒙构建仍暂停（用户指示，恢复=DevEco GUI 自动签名一步，见 KNOWLEDGE 2026-10-16 2b）；发布前不再改源码（打包基线=`adcd4ee8`）。
- **验收**：发布后下载页/`hash-manifest.json` 版本=1.0.276/322；线上 `hot-update/desktop/local/version.json`=-3；桌面冷启动深链通过。
- **基线 commit**：`adcd4ee8`

### H8 ｜优先级：中（方案待拍板）｜激活流程全端架构收敛（评审文档已出，建议 S1 先行）
- **状态**：OPEN（待用户拍板；文档 `.trae/documents/activation-architecture-review-2026-10-17.md`）
- **结论**：六端 × 自动/手动 × 标准/机构功能已全覆盖，但架构仍是「**6 条服务端签发通道 × 8 条客户端落盘路径 × 6 类权威载体**」；2026-10-17 P40「本地有效 / 服务端 unused」分裂是该结构必然。建议优先 O1 激活会话收敛 / O2 签发原子化 / O3 reconcile+启动三向自检+后台诊断页。
- **S1 建议范围（1 迭代，待批准后执行）**：
  1. 服务端 `POST /api/license/reconcile`（默认只读；repair 需管理员 token/首兑令牌证据）；
  2. 客户端（离线 APP/桌面优先）启动三向自检：`license.dat × license:code × entitlement(mid)`——NO_LICENSE 且 mid 有绑定→重装 license；本地有 license 但服务端已停用/删除→明确失效+自助入口；残留码冲突→自动清理并记录诊断；
  3. 后台双副本新增「🔎 激活诊断」页（码/机码/手机号 → license+admin_req+order+device_version+license_log 时间线 + 一键报告）；
  4. 删除 `normalizeActivationPassword` 的「审批覆盖已改密码」行为（统一随机+mustChangePassword）；
  5. activation-session MVP：令牌核销时点后移到 claim 成功（失败可重试，不再"令牌已用码未激活"）。
- **勿做**：不动 35+ 端点历史语义；不改人工审核铁律/价格/端锁；**禁止手工改 KV 码记录**（业务级重置一律走 reconcile/repair 或 admin 工具——P40 事故直接教训）。
- **验收**：重现「KV 手改 unused + 本地有 license」→ 可一键诊断/修复，不再需要 wrangler 手查；旧客户端零回归；pre-push 17 道 + 新增 act-* mock 入库测试。
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
