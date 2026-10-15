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

## 当前基线（2026-10-15 更新）

- **main HEAD：提交后见 `git log -1`**（2026-10-15 红米改名双端根治，见 OPEN H4；上一基线 `dad9e997`）。
- 2026-10-15 已随热更上线（Pages 部署后）：app-local 与 desktop/local 热更 **2026.10.15-1（minAppCode 288 不抬）**，含红米改名双端修复 + 补齐 10-13/10-14 已提交但未热发的激活链改进（auth-core 累积漂移随包）。
- 近 24h 已上线、**勿重复实施**：
  - KV list 1000/天告警根治（order_index + safeListPage 熔断/短缓存，`6601c943`，详见 KNOWLEDGE 2026-10-13 条目）。
  - 激活架构 **P1** 客户端「只填码」身份自动带出（`b7bf5530`）。
  - 激活架构 **P2** 服务端裸码「码+手机号」单锚点首激（`3a7a762f`，开关 `config:activation-phone-anchor`）。
  - 激活架构 **P3** claim/order 请求体收口 `buildActivationPayload`（`3498c5ba`，纯重构零行为变化）；auth-core cv=**ed835152**（云端刷新即达）；离线 App 热更 **2026.10.14-1，minAppCode 288 不抬**（退出重开第 2 次生效）。
  - 完整方案：`.trae/documents/activation-architecture-optimization_plan.md`（P1/P2/P3 全部闭环）。
- 工作区有多个**未跟踪文件**（`_verify/`、`_verify-report.md`、`e2e/.tmp/*-test.*` 的一部分、`.trae/documents/phase2-taobao-cloud-password_plan.md` 等）：非本台账任务产物，**提交时精确 `git add`，禁止 `git add -A`**。

---

## OPEN 遗留任务

### H4 ｜优先级：高｜红米改名修复云端 functions 部署 + 真机复验（2026-10-15）
- **代码已提交推送**：users.js（migratePrescriptionOwnership + formerUsernames 链 + 两改名端点）、prescriptions.js + _lib/auth.js（token `a` 别名签名与读侧别名过滤）、离线 5 副本 index.html（heal 双闸）、热更 2026.10.15-1 双端。双独立审查+安全二查已过，105 断言全绿（rename-cloud 36 / rename-heal-pwd 31 / owner-migrate 回归 38）。
- **⏳ BLOCKED 待办（需凭据/真机）**：
  1. **云端部署（必须）**：`npx wrangler deploy`（或项目既有发布脚本）部署 functions——本机无 Cloudflare 凭据，各机自备。部署后回归：诊所账号手机号改英文名 → 历史处方与回收站立即可见；`migrationWarning` 仅在单副本失败时 true；审计日志含 migrate 统计。
  2. **真机复验（红米）**：联网打开 App 拉到 2026.10.15-1 → 彻底划掉重进 → ①手机号登录一次（heal 修复英文名行）→ 英文名退出再登成功；②历史处方可见；③英文名身份改密后手机号+旧密码登录不得把新密码回滚（闸2）。
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
