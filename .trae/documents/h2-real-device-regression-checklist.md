# H2 真机回归清单（激活架构 P1 / P2 / P3）

> 对应台账：`.trae/HANDOFF.md` → H2。执行人：人工（真机/桌面，Agent 不可替代）。
> 基线代码：`3498c5ba`（P3）/ `9c48a49b`（热更与文档）。
> **通过标准**：P0/P1 用例 100% 通过；P2 裸码链路通过；P3 抓包字段核对全部符合。任何一项失败按文末模板记 BLOCKED 回流，**不要**带失败项关闭 H2。
> 安全：只用测试码，**禁止用真实客户码做换机/解绑实验**；本文档及回流信息中不写密码、完整手机号可写但激活码只写脱敏前缀（如 `BNZC-8BPH-…`）。

---

## 0. 版本核对（先确认设备上跑的是新版本，再开始）

| 载体 | 期望版本 | 生效方式 | 核对方法 |
|---|---|---|---|
| 云端网页 | auth-core **cv=`ed835152`** | 强制刷新（Ctrl+F5） | DevTools Network 看 `auth-core.js?cv=ed835152` 200 |
| 云端 App / 鸿蒙 WebView | 同上 | 彻底退出重开 | 激活页走通即可；必要时抓包确认加载新 cv |
| 云桌面 | cv=`ed835152` | 按既有更新方式重启 | 同上 |
| **离线 App（APK）** | 热更 **2026.10.14-1**，minAppCode 288 | **彻底杀进程重开，第 2 次启动生效** | 关于页热更版本号；或激活流程行为与本清单一致 |
| 离线桌面（Electron） | 含本次 auth-core 的新安装包 | 重新打包安装 | P3 为纯重构，旧包行为无变化；桌面用例可在新包就绪后补测 |

> 离线 App 若关于页仍显示 `2026.10.13-3`：再彻底退出重开一次；仍不变则检查网络后记录阻塞（不要继续 P3 抓包项，结论无效）。

## 1. 前置准备

- [ ] 管理员后台可登录（凭据从各机密码管理器取，**勿写进任何文档/聊天**），能看「激活码日志 / 设备管理 / 用户管理」。
- [ ] 测试码（提前向管理员申请并记录脱敏前缀）：
  - 淘宝预置码 ×1（带锁端 personal/pro，走自动开通）；
  - **裸码 ×1**（旧形态渠道码：码上无 productClass / 诊所名 / 姓名 / 手机号，unused）——P2 专用；
  - 试用（trial）码 ×1（可置为到期，测到期入口）；
  - 已绑定在设备 A 的码 ×1（personal 标准版，用于换机核验）。
- [ ] 手机号：该码绑定手机号的 SIM 可收短信/可知号码；另准备一个**未绑定的手机号**用于"故意输错"。
- [ ] 设备：设备 A（已激活）、设备 B（干净机或可清数据）；尽量覆盖 Android 真机 + 一个桌面端。
- [ ] 抓包（P3 用例 F 组必需）：Android 用 Reqable/Charles/Stream；网页用 DevTools；桌面用主进程网络日志或 DevTools。
- [ ] 每台设备记录：型号、系统版本、App versionCode（关于页，当前 APK 318/热更 288 兼容线）、网络（WiFi/4G）。

---

## 2. 用例

### A 组｜P1：已注册用户任意入口「只填激活码」（离线 App）

**A1 版本页金色按钮入口（P0）**
- [ ] 设备上已有注册账号（本机注册信息含手机号）。
- [ ] 首页/版本选择页点金色「输入激活码激活」按钮。
- [ ] 预期：直接落在激活码页；**手机号框自动带出本机注册手机号**，框下提示文案含"将使用本机注册手机号 138****（可修改）"；如本机有诊所/姓名，展开后也是带出值。
- [ ] 只输测试码 → 立即激活 → 成功；成功提示登录账号为该手机号；用该账号（激活时设置的密码 / 默认 admin）能登录。

**A2 到期提醒入口（P0）**
- [ ] 试用到期后，到期提醒弹窗点「去激活/立即激活」。
- [ ] 预期：同样自动带出手机号，只输码即可走通（补测时直接输码，不要求重填注册信息）。

**A3 注册成功页入口（回归项）**
- [ ] 新走完最小注册 → 注册成功页点「去输入激活码」→ 手机号/诊所/姓名仍正确带出，行为不回退。

**A4 未注册新机（防过度放行）**
- [ ] 干净设备（无注册信息、无桥账号）打开激活码页：手机号为空、无带出提示；走淘宝预置码时按既有最小注册引导，**不能**跳过必要身份建立。

### B 组｜P1：云端（网页 / 云 App / 云桌面）

- [ ] **B1** 登录态用户：登录后打开版本页金色按钮 → 激活码页手机号自动带出（来源为登录账号），只输码激活成功。
- [ ] **B2** 未登录/无记忆账号：手机号框为空，可手填；手填值激活后成为绑定手机号。
- [ ] **B3** 带出值可改：修改手机号框不被覆盖回自动值（切走再切回 Tab 也不覆盖手改值）。
- [ ] **B4** 云端码密码两分支：
  - [ ] 自设密码：激活后用该密码登录成功；
  - [ ] 密码留空：成功页**一次性**展示随机初始密码，复制按钮可用，首次登录走改密。

### C 组｜桌面 Electron 桥参透传（云桌面 / 离线桌面新包）

- [ ] **C1** 激活窗预填的 user / clinicName / phone 与激活结果一致：激活成功后后台「用户管理 / 诊所」中姓名、诊所名、手机号正确，后台设备「类型」列载体正确（`🖥️桌面·` 前缀，云/离与购买版本一致）。
- [ ] **C2** 邀请码（如带）：正常参与结算（邀请人/本机时长），大写化无误。
- [ ] **C3** 桌面密码能力位：自设密码 → 用自设密码登录；留空 → 收到随机初始密码；旧默认 admin 不留存为云端密码。

### D 组｜换机核验（P2 安全边界，必须验证"该拒的拒"）

- [ ] **D1 正确手机号自动恢复（P0）**：设备 B 输设备 A 已绑定的码，手机号带出/填为**原绑定手机号** → 自动解绑最旧机并在 B 激活成功；
  - [ ] personal 标准版：A 与 B 的最终授权状态符合"一号一机"（旧机释放）；
  - [ ] 机构版多设备：按既有配额，不应误踢仍在配额内的机器。
- [ ] **D2 错误手机号必须拒（P0 安全）**：设备 B 同码但手机号故意填**未绑定号码** → 明确 403 类提示（手机号核验不通过），**码状态不变、B 未绑机、无账号被开通**。后台日志无成功激活记录。
- [ ] **D3 回流**：D1/D2 完成后把测试设备占用情况恢复（后台解绑测试机或注明测试码可弃）。

### E 组｜P2：裸码首激「码 + 手机号」单锚点

- [ ] **E1 只带手机号放行（P0）**：设备无本机身份，裸码 + 合法手机号，**不填诊所名/姓名** → 200 激活成功；该手机号成为授权锚点（日后换机走 D1 可恢复）。
- [ ] **E2 后台留痕**：激活码日志可见 `phone-anchor-activation` 动作；记录上 phone 已落，无凭空诊所名。
- [ ] **E3 带诊所名升级 v3（可选）**：裸码 + 手机号 + 诊所名 → 成功，诊所名按提交值落库（不是系统生成）。
- [ ] **E4 开关回退（可选，需管理员配合）**：后台设 `config:activation-phone-anchor = {"mode":"off"}` 后，裸码无身份再激 → 回到要求补填身份的旧行为（400/needActivationInfo）；**测完务必删/恢复该 config**。
- [ ] **E5 淘宝码不受影响（回归）**：预置锁端码首激仍自动开通，身份来源仍是 taobao-auto，不被误标 phone-anchor。

### F 组｜P3：请求体零行为变化抓包核对

> 重构只改拼装位置，字段必须与旧版逐字一致。以下在各端实际激活/下单请求中核对。

- [ ] **F1 云端码 claim（云 App/网页）** body 恰含：`code, machineId, user, clinicName, phone, productClass:"cloud", clientClass:"app", pwdCap:"v2"`；
  - [ ] 自设密码时多一个 `password`；密码框留空时序列化 JSON 里**完全没有 password 键**（不是 `password:""`）。
- [ ] **F2 离线码 claim（离线 App 直连）**：`productClass:"offline"`、`clientClass:"app"`，且**没有** `pwdCap`、`password`。
- [ ] **F3 桌面主进程 claim（新包）**：`clientClass:"desktop"`，productClass 云/离正确；邀请码存在时为大写且通过 4–10 位校验。
- [ ] **F4 Tab1 直建订单 order-submit**：
  - [ ] 字段齐全：`orderNo, productKey(local|cloud), edition, price, clinicName, adminName, phone, machineId, note, inviteCode, dp, password`；
  - [ ] 离线订单：密码仅在"非 admin 且 8–32 位"时上送，否则 `password:""`；`dp` 在 App 为 `app`、桌面为 `desktop`（APP Java 桥存在时不得误判 desktop）；
  - [ ] 云端订单：密码非 admin 即上送（无长度门控，保持旧口径）；
  - [ ] 建单成功后付款链接为 `?orderNo=` 恢复模式；order-submit 失败时仍能静默降级 admin-submit 旧链路（可选：断网/弱网观察一次）。
- [ ] **F5 machineId 兜底**：异常环境下上报 `machineId:"unknown"` 而非 undefined（观察即可，不必造异常）。

---

## 3. 记录与回流

每条用例记录：结果（✅/❌/⚠️）、设备型号+系统、App versionCode/热更版本或 cv、网络、证据（截图 / 后台 license_log 的 action / requestId）。

出现 ❌ 时，在 HANDOFF.md 的 H2 下追加 BLOCKED 卡并通知开发，格式：

```
### BLOCKED H2-<用例ID> 日期
- 期望：
- 实际：
- 复现步骤：
- 设备/系统/载体（productClass/clientClass 看后台日志）：
- 版本：versionCode / 热更号 / cv：
- 证据：截图路径 + license_log action + requestId + 激活码脱敏前缀
- 发生时间（UTC+8）：
```

全部通过后：在 HANDOFF.md 把 H2 标记完成（结论+测试人+日期），从 OPEN 删除并把"真机回归通过"结论沉淀进 KNOWLEDGE 对应 P1/P2/P3 条目。

## 3.5 Agent 真机 CDP 实测记录（2026-10-14 11:xx，设备 A）

- **设备**：华为 ANA-AN00 ｜ 测试并存包 `com.benneng.pres.dingzhi.test`（applicationIdSuffix=.test）｜ APK V1.0.0.318（versionCode 318）｜ WiFi ｜ machineId `8a1d491ff44cecce92f2d8a2a2ea999b`。
- **取证方式**：ADB + WebView CDP（`e2e/.tmp/cdp-eval.cjs`，只读 JS/抓包，不碰患者数据）；截图存 `e2e/.tmp/phone-30-code-prefill.png`、`phone-31-samemachine-wrongphone.png`。
- **§0 版本核对 ✅**：私有目录 `files/hot-update/.hot-version` = `{"hotVersion":"2026.10.14-1"}`，minAppCode 288（318≥288）；热更 auth-core.js SHA256 `F5603A74…`、596984B 与仓库 `public/hot-update/app-local/auth-core.js` **逐字节一致**。
- **A1 ✅ PASS（P0）**：登录 13912341014（admin/yisheng）→ 打开管理员激活弹窗直达「激活码激活」Tab，约 0.5s 内自动带出：手机号 `13912341014`、诊所 `ceshi`、姓名 `yisheng`；提示「✓ 将使用本机注册手机号 13912341014（如需换机请改成原绑定手机号）」；只输码即可提交（未提交，避免重复激活）。
- **F2 ✅ PASS（P0）**：真机抓包 POST `/api/license/claim` body 恰为 `{"code","machineId","user","clinicName","phone","productClass":"offline","clientClass":"app"}`，**无 pwdCap、无 password 键**（空密码不序列化），machineId 正常非 unknown。
- **F5 ✅（静态）**：`buildActivationPayload` 内 `machineId: id.machineId || 'unknown'`（shared/auth-core/offline.js 约 L6035，设备包哈希已证同版）。
- **D2 ⚠️ 同机场景不适用，跨机仍待测**：用已绑本机的测试码 `BNZC-5UZ5-…` + 故意错号 13800138000 在**同一台已绑机**提交 → 服务端 200 放行。代码核实（validate.js L318/L447/L753-757）这是设计内幂等重放（existingDevice=true 免手机号核验），且实测**服务端锚点零改动**：重发 license 仍为 devicesCount=1、同 machineId、到期 2027-10-14 不变、`identitySource:"existing"`（非 phone-anchor）、record.phone 不重写。**真正的 D2（新机器错号必须 403）仍需设备 B 执行**。
  - 🟡 **附带观察（低优先级加固建议，非阻塞）**：existing 路径响应 `resolvedIdentity.phone` 回显的是**客户端提交值**而非 record 锚点号（validate.js L1093 `clientPhone || record.phone`）。同机重激活时若用户改错号，客户端据回显新建本地账号 13800138000 并提示用该号登录（实测弹窗文案），易误导；建议 existing 路径优先回带 record.phone。**仅影响测试包本地，服务端无任何变化**；原账号 13912341014 仍可正常登录。
- **A4 旁证**：今早全新安装、本机尚无身份时激活码 Tab 手机号为空、仅通用提示（截图 phone-18-tabview.png，10:46），无过度放行。
- **F4 部分证据**：上午人工下单流程落痕 orderNo `BNZC-DZ-202610141050-LL6H`、`productKey=local / dp=app / edition=pro`（activationFlowV1 快照）；order-submit 完整字段与密码门控未抓包，仍待补。
- **仍待人工/另一环境**：A2（到期入口）、A3（注册成功页入口）、B 组（云端三端）、C 组（桌面 Electron）、D1+D2（设备 B 换机/错号拒绝）、E 组（裸码 phone-anchor，需管理员备 unused 裸码）、F1/F3/F4。

## 4. 测后清理

- [ ] 恢复 E4 的 config 开关（默认 on）。
- [ ] 后台解绑/备注测试设备；测试订单标记测试用途。
- [ ] 不在设备上保留真实客户授权文件。
