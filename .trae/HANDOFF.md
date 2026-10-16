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

- **main HEAD：`14ce52ce`**（2026-10-15 docs(handoff): H4 functions 随 Pages 自动部署已上线）。
- 工作区有大量**未提交改动**（P0 激活方案·一键激活全端打通 + 链接安全化），将在本会话以 WIP commit 推送；未发热更、未打 APK、未双独立审查。
- 近 24h 已上线、**勿重复实施**：
  - KV list 1000/天告警根治（order_index + safeListPage 熔断/短缓存，`6601c943`，详见 KNOWLEDGE 2026-10-13 条目）。
  - 激活架构 **P1** 客户端「只填码」身份自动带出（`b7bf5530`）。
  - 激活架构 **P2** 服务端裸码「码+手机号」单锚点首激（`3a7a762f`，开关 `config:activation-phone-anchor`）。
  - 激活架构 **P3** claim/order 请求体收口 `buildActivationPayload`（`3498c5ba`，纯重构零行为变化）；auth-core cv=**ed835152**（云端刷新即达）；离线 App 热更 **2026.10.14-1，minAppCode 288 不抬**（退出重开第 2 次生效）。
  - 完整方案：`.trae/documents/activation-architecture-optimization_plan.md`（P1/P2/P3 全部闭环）。
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
- **未完成（下一步按序）**：
  1. **云 App MainActivity 深链接**（最高优）：`app_project/db-yunduan/cloud_app/app/src/main/java/com/tcm/prescription/MainActivity.java` 当前**无** bnzc 处理——参照离线 App 实现 parseBnzcDeepLink/onNewIntent/dispatchBnzcToWebView/NativeBridge(bnzcGetPending/bnzcClearPending/bnzcRedeemToken productClass=**cloud**)/shim 注入。
  2. **鸿蒙端核查**：`app_project_harmony/huikang-cloud/entry/src/main/resources/rawfile/index.html` 是否已含 bnzc 令牌兼容分支；若需同步，确认鸿蒙权威源与同步链。
  3. **双独立审查 + 安全二查**：激活/安全链路铁律——Seed-2.1-Pro 独立审查 + GLM-5.3 安全二查（当前自审未过）。
  4. **热更生成**：app-local + desktop/cloud + desktop/local，需抬序号（当前 minAppCode 288）。
  5. **线上核验**：version.json + functions 部署 + activate.html 可访问 + token 端到端真机。
- **勿做**：不发热更、不打 APK、不做产品决策（如放宽安全锚点须显式批准）；禁止手改生成副本（cloud_desktop/cloud_app assets/index-app/offline assets），改权威源后跑生成器。
- **验证命令**：
  - `node tools/_tmp/activation-token-test.cjs`（42 PASS）
  - `powershell -File tools\sync-html.ps1 -VerifyOnly`（0 drift）
  - `powershell -File tools\check-index-consistency.ps1`（OK）
  - `node tools/sync-index-app.cjs --verify-only`（PASS）
  - `node --check` 7 个 JS（activation-token.js + 双桌面 main/preload/login）
- **基线 commit**：本会话 WIP commit（待生成）　关联文档：`.trae/documents/activation-streamline_plan.md`

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
