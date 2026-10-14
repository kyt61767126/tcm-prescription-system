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

## 当前基线（2026-10-14 更新）

- **main HEAD：`2ea44f71`**（已 push，Cloudflare Pages 自动部署已验证）。
- 近 24h 已上线、**勿重复实施**：
  - KV list 1000/天告警根治（order_index + safeListPage 熔断/短缓存，`6601c943`，详见 KNOWLEDGE 2026-10-13 条目）。
  - 激活架构 **P1** 客户端「只填码」身份自动带出（`b7bf5530`，auth-core cv=`9d0de10a`，离线 App 热更 **2026.10.13-3，minAppCode 288 不抬**）。
  - 激活架构 **P2** 服务端裸码「码+手机号」单锚点首激（`3a7a762f`，开关 `config:activation-phone-anchor`）。
  - 完整方案：`.trae/documents/activation-architecture-optimization_plan.md`。
- 工作区有多个**未跟踪文件**（`_verify/`、`_verify-report.md`、`e2e/.tmp/*-test.*` 的一部分、`.trae/documents/phase2-taobao-cloud-password_plan.md` 等）：非本台账任务产物，**提交时精确 `git add`，禁止 `git add -A`**。

---

## OPEN 遗留任务

### H1 ｜优先级：低（纯重构，等用户立项再做）｜激活架构 P3：各入口请求体拼装收口
- **背景**：Tab1 付款购买 / Tab2 激活码 / 桌面 activate-window / 到期直通 四处各自拼 claim·order 请求体，字段口径靠注释维持、易漂移。P1/P2 已解决用户体感，本项无功能变化。
- **范围**：在 shared/auth-core/offline.js 与 cloud.js 内收敛为单一 `buildActivationPayload(identity)`（离线不带密码、云端 pwdCap:'v2'、桌面桥参透传 user/clinicName/phone）。
- **勿做**：不改服务端字段契约、不改 HTML/CSS、不抬 minAppCode。
- **验收**：sync-auth-core 11 副本；activation-identity-prefill 20 + phone-anchor 25 + 存量回归全绿；`check-interface.bat` 6 OK。
- **基线**：`2ea44f71`。关联：activation-architecture-optimization_plan.md §四 P3。

### H2 ｜优先级：中（需人工真机，Agent 不可替代）｜激活 P1/P2 真机回归
- **清单**：
  1. 离线 App（已注册账号）：版本页金色按钮进激活码页 → 手机号自动带出 → **只输码**激活成功。
  2. 离线 App：试用到期提醒入口同上；App 需彻底退出重开第 2 次拉到热更 2026.10.13-3。
  3. 换机：新设备输码，手机号带出为原绑定号 → 自动解绑最旧机恢复；故意改错手机号 → 必须被拒。
  4. 桌面（Electron，云/离各一）：激活窗 user/clinicName/phone 正确透传桥 submit。
  5. 云端 Web/桌面：刷新即达（cv 9d0de10a），登录态用户手机号自动带出。
  6. 渠道裸码（无锁端 personal 码）首激：码+手机号 200，`identitySource=phone-anchor`；后台激活码日志可见 `phone-anchor-activation`。
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
