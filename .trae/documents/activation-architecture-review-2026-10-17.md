# 激活流程全端架构梳理与优化建议（2026-10-17）

> 范围：全端口（云端网页/云桌面/云 APP/离线桌面/离线 APP/鸿蒙）× 激活方式（激活码自动 / 后台手动审核 / 一键令牌链接 / 免费领取 / 试用）× 版本（标准版 personal / 机构版 pro / 语音版 voice / 免费 free / 试用 trial）。
> 性质：**架构评审文档，不含代码改动**；结论按"现状（有代码实据）→ 问题清单 → 优化建议 → 分阶段落地"组织。
> 基线：`d042fac6`（2026-10-17 晚，整包 1.0.276/APK 322、热更 app-local -7 / desktop-local -3 已上线）。
> 关联：`.trae/documents/activation-streamline_plan.md` / `activation-architecture-optimization_plan.md` / `license域数据防御架构.md`、`.trae/KNOWLEDGE.md`（六端矩阵、激活铁律）、`.trae/HANDOFF.md`。

---

## 0. 一句话结论

当前激活体系**功能已覆盖全端全版本**（P0"一键激活全端打通"、P1"只填码/身份预填"、P2 phone-anchor、淘宝自动开通、免费领取、令牌一次性兑换均已落地），但**架构层面仍是"多写入口 × 多副本 × 多状态机"**：同一个"激活成功"可由 6 条服务端通道产生、由 8 条客户端路径落盘，权威状态分散在 KV 记录 / license.dat / config.json / localStorage / 派生索引 / 申请单 6 类载体，缺乏**单一激活编排、单一对账入口、统一可观测**。2026-10-17 P40 事故（服务端码记录 unused、本机 license.dat 有效 → 登录闸 NO_LICENSE → 反复弹激活框）正是这一结构的必然产物。

**建议的主线只有三条**：
1. **激活编排收敛**：新增"激活会话（activation-session）"门面，把 令牌兑换 → 身份解析 → claim → license 签发 → 账号开通 → 设备绑定 串成唯一幂等状态机；旧端点降级为适配器保留兼容。
2. **授权对账收敛**：服务端唯一裁决（entitlement）为权威，新增 `/reconcile` 只读对账 + 客户端启动三向自检 + 后台"激活诊断"页，把今天靠人肉 wrangler 查 KV 的排障变成一键诊断/一键修复。
3. **设备与密码生命周期收敛**：devices[] 数组 + 4 份派生索引重构为设备绑定投影表（active/kicked/revoked）；密码写点从 4 处收敛为单一 AccountProvisioningService（随机/自设/强制改密三态），禁止审批链二次覆盖已改密码。

---

## 1. 现状梳理

### 1.1 两大授权模型（并存，且同一"云版"在不同端实现不一致）

| 模型 | 适用端 | 权威判定 | 本地载体 | 离线能力 | 关键实现 |
|---|---|---|---|---|---|
| **A. 机器码 license 模型** | 离线桌面、离线 APP（含云桌面部分复用） | KV `license:{code}` 记录（status/devices/expiresAt）+ 服务端 `entitlement` 四态 | `license.dat`（Ed25519 签名、AES 机器绑定）、`trial.dat`（加密非签名） | 有（gate token 48h + 离线宽限） | `shared/license/license-manager.js`（双桌面，哈希 `E256D216…` 同源）、`LicenseManager.java`（离线 APP） |
| **B. 云端账号订阅模型** | 云 APP（云端桌面为 A+B 双链） | 云端诊所/账号（`clinic:{id}:users` + clinics.edition/status/expiresAt）+ `users.js` 登录/get-profile | 账号 token（JWT）+ `license:code`（仅作码查询凭据） | 有登录缓存，无本地 license 文件 | `functions/api/users.js`（login/get-profile）、`shared/auth-core/cloud.js`（`performHeartbeatCheck` L2342、`checkLicenseAndShowActivate` L2464） |

> **不一致点（P1 建议收敛）**：云桌面保留 Electron `license-manager.js` + `license.dat` + 主进程 `license:verify-gate` IPC（`shared/desktop-license-ipc.cjs` L509）；云 APP **没有原生 LicenseManager**（`app_project/db-yunduan/cloud_app/.../com/tcm/prescription/` 仅 MainActivity/Biometric/NativeGuard/SecurityGuard/Startup），授权判定完全依赖 JS 心跳 + entitlement，`license:code` 只是查询凭据。即"云版"两端实际上用两套本地授权盘。

### 1.2 六端 × 激活方式能力矩阵（2026-10-17 实测口径）

| 能力 | 云端网页 | 云桌面 | 云 APP | 离线桌面 | 离线 APP | 鸿蒙 |
|---|---|---|---|---|---|---|
| 激活码自动激活（claim） | ✅ 页面内弹窗 | ✅ 激活窗 → claim（Electron 桥） | ✅ Java 直连 claim（`MainActivity.activateOnline` L2930） | ✅ 激活窗 → claim | ✅ Java claim（`LicenseManager.activateOnline` L4082） | ⏸ 源码就绪未发版 |
| 后台手动激活（申请→审核→轮询装码） | ✅ 申请/轮询 | ✅ 申请 + `admin-status` + `installAdminLicenseDesktop` | ✅ 申请 + 轮询；**无本地装码**（账号已云端开通，提示登录） | ✅ 申请 + 轮询 + `installAdminLicense` 落 license.dat | ✅ 申请 + 轮询 + Java `installAdminLicense`（L4297） | ⏸ |
| 一键令牌深链（`bnzc://activate?t=`） | ✗（落地页 `activate.html` 展示/复制） | ✅ main.js 解析 + 登录窗冷启消费（`login.js`） | ✅ v324（方案A：先注册再激活） | ✅ 桌面方案A 编排（`index.html` bnzcOfflineAutoActivate + login.js） | ✅ app-local -7（方案A） | ⏸ 源码就绪 |
| 免费版领取（claim-free） | ✗（云端无 free） | ✗ | ✗ | ✅ `activate.claimFree` 桥 | ✅ `claimFreeLicense` 桥 | ✗ |
| 试用（trial） | 以诊所 status=test 承接（待审核/试用态） | ✅ 本地 `trial.dat` + `/api/trial/register` 指纹一次 | 以云端账号 clinicStatus 承接 | ✅ `trial.dat` + 指纹 | ✅ `trial.dat` + 指纹（Java `registerTrialOnline` L415） | ⏸ |
| 领码自愈 / 授权文件导入 | — | ✅ 主进程断点续传 + `install-from-server` + 导入 license 文件 | ✅ JS 轮询/`admin-status`（无文件） | ✅ 主进程续传 + `license:select-offline-file` | ✅ Java 冷启动 `syncLicenseFromServer`（L492）+ JS `installLicenseFromServerBridge`（L595） | ⏸ |
| 版本（标准/机构） | 账号 edition | license.dat type + 账号 edition | 账号 edition | license.dat type | license.dat type | 同云 APP |

### 1.3 服务端激活通道（6 条"能产生激活成功"的写入口）

| 通道 | 端点 | 触发方 | 结果形态 | 关键实现 |
|---|---|---|---|---|
| ① 激活码自动 | `claim.js` → `validate.js` | 客户填码 | 生成/复用 license 记录 + 设备绑定 + licenseBase64 + 账号预开 | validate L164-471（必填/端锁/诊所名闸/换机/淘宝自动开通） |
| ② 后台审核（付款申请） | `admin-approve.js` | 平台管理员 | **生成新码 + 直接 activate + 绑定申请机 + 云端账号 + 密码归一 + 设备版本** | L224-269 记录构造、L319 saveLicense、L346-408 provision/密码/deviceVersion/审计、L410-461 license + activatePatch |
| ③ 客服工单审批 | `activate-from-ticket.js` | 平台管理员/客服 | CAS 占用→发码→占机绑定→工单 approved | L215-258 CAS、L420-472 终写复核 + 审计 |
| ④ 免费领取 | `claim-free.js` | 客户点免费使用 | type=free、expiresAt=2099、机器绑定 license | 同 claim 体系（不进激活码库存） |
| ⑤ 领码自愈 | `admin-status.js`（GET requestId / machineId） | 客户端轮询/冷启 | 按本机**重签** license 下发（含机构版附属设备） | L280-341 续费/V7/封锁闸、L344-401 多设备重签、L405-430 activated 响应 |
| ⑥ 客服导出/发放 | `export-license.js` / `generate.js` / `batch.js` | 管理员/客服 | 导出 license 文件 / 批量发码 / 一键令牌签发（`activation-token.js`） | 导出路径含满额换机 + 频控（文件头契约） |

**派生侧写**：`heartbeat.js`（设备 lastHeartbeat/productClass 观察 + 过期改状态）、`status.js`（心跳 + unbind/disable/enable/delete/device block）、`extend.js`（延期）、`update.js`、`admin-device-reset.js`（测试设备清理）。

### 1.4 客户端安装/恢复路径（8 条，已部分收口但仍多入口）

1. 激活窗 Tab2 claim 直连 → 成功回 `license` → 装机（离线 Java `activateOnline` 内置写盘；桌面走 `activateManager.activateOnline`）。
2. 激活窗 Tab1 直建订单 → 付款 → 轮询 `admin-status` → `onAdminActivated` → `installAdminLicense`（离线 APP/桌面）。
3. ActivationObserver 断点续传 `resumeAdminPendingRequest`（会话恢复）。
4. 主进程/Java 冷启自愈：桌面 `license:install-from-server`、APP `syncLicenseFromServer`（节流 + 同机同号门 + 注册门控）。
5. JS 显式装码：APP `installLicenseFromServerBridge`（单一装码入口，注册门控）。
6. 授权文件导入：桌面 `license:select-offline-file`（客服导出的 license 文件）。
7. 免费领取 `claim-free` → 装 free license。
8. 已激活设备重装：`lookup.js` 预填 + 手机号核验换机恢复。

> **收口评价**：离线 APP/桌面已把"装码"收口到 `installAdminLicense`（Java L4297 / 桌面 `installAdminLicenseDesktop`），并有注册门控与同机同号门，是本轮架构里做得最扎实的部分；但**触发源仍有 4-5 个并发**（轮询/自愈/JS 显式/桌面续传/文件导入），且每个触发源各自决定"何时装、装什么、失败怎么办"。

### 1.5 状态与权威源全景（核心复杂度来源）

| 状态 | 权威源 | 副本/派生 | 同步/写入方 | 失配后果 |
|---|---|---|---|---|
| 激活码状态 | KV `license:{code}`（status unused/used/disabled/expired） | `system:license_index`、后台列表快照 | validate/claim、admin-approve、status.js、heartbeat | 码已停用但本地仍可用（宽限）；测试重置后分裂（P40 实锤） |
| 设备绑定/额度 | `license.devices[]`（+ 旧 `machineId`） | `mid_owners:{mid}`、`mid_idx:{mid}`、`device_version:{mid}`、`license_clinic_index` | claim/admin-approve/heartbeat/status unbind/admin-device-reset | 4 份派生索引，任一未同步 → entitlement 错误（NO_LICENSE） |
| license 文件 | KV 记录经 Ed25519 签发 | 客户端 `license.dat`（机器绑定 AES） | 6 条签发通道 | 本地文件与 KV 分裂（今天事故形态） |
| 本地登录账号 | 离线：`config.json users`；云端：`clinic:{id}:users` | 前端 `local_systemUsers`（XORv1）、`license:registrationInfo` | `registerLocalUser`/`syncCreateActivationUser`/`ensureClinicUser`/`normalizeActivationPassword`/改密 | "激活成功≠可登录"（方案A 前 P40 就是此因） |
| 登录闸裁决 | `/api/license/entitlement` 四态 | 客户端 `license:gateToken`（离线 ES256）、`license:code/machineId/lastHeartbeat` | 客户端心跳 + 冷启 | 码错位/记录重置 → 误拒；离线宽限策略 |
| 激活流程状态 | 客户端 FSM v2 `license:state:v2` | 旧键 `license:adminReqPending` / `activatedDoneFlag` / `approvalStatus` | JS 各节点 | 多键并存（v2 迁移已做，仍有旧写点） |
| 后台申请状态 | KV `admin_req:{rid}` | `admin_phone:{phone}`、`admin_req_index`、`order:{orderNo}`、`active_order:{mid}` | admin-submit/order-submit/order-paid/admin-approve/admin-cancel | 5 类键 4 处原子序列；测试/OBS 有 CAS，其余无（并发双击风险） |
| 端形态/版本绑定 | `devices[].productClass/clientClass` + `device_version:{mid}` | clinics.edition/offlineCarrier、admin_req.appMode/appModeCarrier | claim/admin-approve/heartbeat | 端锁误拒（PRODUCT_CLASS_UNKNOWN 实锤）、后台类型列漂移 |
| 版本展示 | `build-meta.json` / `package.json` / BuildConfig / hot version | 8 处 UI token、cv 哈希、minAppCode | 打包工具 | 假包误判（本次 build-meta 低 1 的已知现象） |

---

## 2. 问题清单（按严重度，均有实据）

### P0（已造成真实事故/直接卡客户）

**P0-1 码记录与设备本地授权"无声分裂"，无可用的对账/诊断通道**
- 实据（2026-10-17）：P40 设备本地 `license.dat` 有效、登录闸却收到 `NO_LICENSE`；根因是服务端 `license:BNZC-MG3B…` 被手工重置为 `unused/devices=[]`，而设备侧 `license:code/license.dat/本地账号` 未清 → 自愈重裁也拿不到授权，只能弹激活框。全局只有 `entitlement(mid)` 可判，客服需 wrangler 手查 KV。
- 结构原因：§1.5 六类载体无一致性检查；无"服务端 → 本地"的权威回写/清理协议；`admin-device-reset` 只面向测试设备清理，非业务对账。

**P0-2 后台审核/工单/自动开通三条签发链"非原子 + 副作用被吞"**
- `admin-approve` 一次做 8 件事（saveLicense/detach/provision/normalizePassword/setDeviceVersion/邀请结算/构建 license/写 activatePatch），其中 `provisionCloudAccount`、`normalizeActivationPassword`、`setDeviceVersion` 全部 `try/catch` **失败仅告警**（L370-393）→ 可能出现"license 有效但无云端账号/密码被重置/设备版本未绑"的半成态，且后台无状态标记、客户侧表现为登录 401 或版本错乱。
- `activate-from-ticket` 对工单做了 CAS（L215-258）与终写复核（L420-472），但 `admin-approve`/`admin-submit` 仍是 LWW——双击/重复审批的并发窗口未统一收口。
- `admin-account.normalizeActivationPassword`（L280-321）会**遍历全部诊所**把该手机号账号密码改回"注册密码或 admin"——违反"密码写点唯一"铁律，客户改过密码后再次审批会被静默回滚。

**P0-3 同一激活语义存在多套"激活成功"定义，客户端各自落盘**
- 服务端 6 条通道（§1.3）+ 客户端 8 条安装/恢复路径（§1.4）→ 同一客户在不同通道下"激活成功"的完成标准不同：①claim 通道=license 下发即成功（账号可能未建）；②admin-approve 通道=服务端已激活（客户端可能未装）；③云端 APP=账号已建（无本地 license）；④云桌面=license.dat + 账号双链。**没有"激活完成"的统一判据与统一回执。**

**P0-4 端形态/端锁字段上报不一致，产生"裸拒"错误码**
- 实据：`license_log` 里 2026-10-17 07:07/07:18 两条 `product-class-denied … 请求端=(缺失/无法识别) reason=PRODUCT_CLASS_UNKNOWN`（旧 APK/手动路径未带 productClass，被 preset 端锁硬拦）。
- 现有兼容（preset 硬拦 / device 观察 / INVALID 降级）已缓解，但**客户端上报契约未统一**：离线 APP Java 固定 offline/app（L4108）、云 APP 固定 cloud/app（L2941）、桌面/网页由 JS 拼装（`buildActivationPayload`），只要老包/桥异常就会漏字段。

### P1（架构性债/可稳态恶化）

**P1-1 令牌核销与 claim 双轨：令牌已消耗但激活未完成（P40 曾"令牌 redeemed 但码 unused"）**
- `activation-token.js` redeem 只交还码明文（不写码记录绑定），真正激活仍走 validate/claim；令牌一次性 → 激活失败后码已交还但令牌不可重兑，只能客服重发。今天用 `redeemedDevices` 台账 + 幂等补写兜住"客户拿 Token 但诊所名闸 400"的单点，但状态机仍是"令牌系统 / 激活系统"两套。

**P1-2 后台手动激活三态的"中间态黑洞"**：pending_payment/pending/processing/approved/activated/rejected/cancelled 分散在 order/admin_req/ticket 三套记录，客户端轮询无退避/无推送、后台无统一 SLA/超时策略（仅 pending_payment 7 天惰性清理、ticket processing 10 分钟 TTL）。

**P1-3 试用/免费与激活的边界**：试用=本地 `trial.dat`（AES 加密、非签名，可被清数据/工具重置）+ 服务端 `/api/trial/register` 指纹一次；免费=服务端签名 free license。二者与付费 license 在客户端 gate 上分属三套判定，缺统一"授权等级"模型。

**P1-4 云端与离线端的"版本/edition"多源**：客户端 `window.EDITION` / `CONFIG.edition` / `__authoritativeEdition` / config.json / 服务端 clinics.edition / license.type 至少 6 处参与判定（`permission.js` L39-97、`edition-lock.js`、`buildLicenseData`、`mapActivationTypeToEdition`）；8 处版本展示 + build-meta 偏移（本次 APK 322 内静态 meta=321）靠 Java SSOT 兜。

**P1-5 可观测性不足**：`license_log` 有 action 但无统一 traceId 串联"令牌→申请单→码→设备→账号→日志"；客户端激活失败只弹中文文案，无诊断包；后台缺"一次查询看全链路"页面（今天排障靠 wrangler + 猜测 + 反复真机）。

**P1-6 多设备额度/解绑策略分散**：devices[] 数组 + `lastUnboundDevice` + auto-unbind + cross-code-detach + `device_version` 版本绑定 + `admin-device-reset`；换机规则（手机号核验/clinicName 精确匹配/配额踢最旧）散在 validate L441-523，客户端也有 UI 级规则。

### P2（体验/维护效率）

- **P2-1 六端能力矩阵靠人工勾稽**（KNOWLEDGE 矩阵是文档，没有自动门禁）——鸿蒙/APP 桥方法漏配仍靠人眼。
- **P2-2 旧端点双轨**：`validate` vs `claim`、`status.js` 心跳 vs `heartbeat.js`、旧裸码 `bnzc://activate?code=` vs `?t=`、旧版客户端无 pwdCap——没有退役路线图。
- **P2-3 客服/客户文案不统一**：同一语义多套中文（NO_LICENSE=「该诊所/激活码已被删除」/「授权信息无效」/「请重新激活」），错误码未标准化。
- **P2-4 测试与真机回归成本高**：H2 清单 7 组用例大量依赖人工；mock 测试分散在 `tools/_tmp`、`e2e/.tmp`（临时目录、不入库），缺可长期维护的 act-* 回归套件。

---

## 3. 优化建议（按"架构收敛"分组，均给出改动点/风险/验收）

> 原则：**不动 35+ 端点的历史语义**（每个端点都对应过事故收敛），只做"门面/编排/对账/可观测"层的收敛；旧端点保留兼容并标注废弃路线。不替用户做产品决策（价格、端锁、审核铁律不变）。

### O1｜激活编排收敛：新增 `activation-session` 单一状态机（P0 建议首发）

**目标**：把"令牌兑换 → 身份解析 → claim → license 签发 → 账号开通 → 设备绑定"从 6 条通道收敛为 1 个可恢复会话；"激活成功"只有一个定义（session `completed` + entitlement `LICENSED` + 本地回执）。

**设计**：
- 新增 `functions/api/license/activation-session.js`（纯编排层，内部复用现有 claim/validate/admin-approve 逻辑，不重写业务）：
  - `POST {action:'start', code|token, productClass, clientClass, machineId, identity}` → 创建/复用 `act_session:{sid}`（幂等键 = token/code + machineId + 6h TTL）。
  - `POST {action:'advance', sid, step}` → 按步骤推进（token_redeemed → identity_ready → license_claimed → account_provisioned → device_bound → completed）；每步幂等 + 记录 lastError/retryCount。
  - `GET {action:'status', sid|machineId}` → 供客户端/后台查询（含 completed 回执：licenseCode/edition/expiresAt/账号/设备数）。
  - **令牌核销时点后移**：redeem 只标记 `session-linked`，claim 成功（license 写入 + 设备绑定成功）才 mark token consumed；失败可重试，不会再出现"令牌已用、码未激活"。
- 旧端点保持：`claim/validate/admin-status` 行为不变，内部统一走同一 `IssuanceService`（见 O2），session 是新增快路。

**改动点**：新增 `functions/api/license/activation-session.js`、`_lib/license-issuance-service.js`（从 validate/admin-approve/activate-from-ticket 抽公共"签发+绑定+审计"原子序列）；`activation-token.js` 增加 `session-linked/consumed` 状态；客户端新增 `activate.submitSession` 能力位（新包/热更优先走 session，旧包继续旧路）。
**风险**：编排层引入新状态；兼容旧客户端期间双轨并存（用 capability 位硬分流，旧请求零影响）。
**验收**：mock 用例覆盖 start/advance 幂等、令牌失败重试、并发双击、6h 过期；旧 claim/validate 对拍零行为差异；真机覆盖离线 APP/桌面各一次。

### O2｜签发原子化：`LicenseIssuanceService`（P0）

**目标**：消灭"审批成功但账号/设备/密码半成态"。
- 抽出 `issueAndBind({code|newCode, machineId, identity, type, days, maxDevices, passwordCred, productClass, clientClass})`：内部固定顺序 `saveLicense → deviceBind → accountProvision → audit`，每步失败进入 `issuancePending` 补偿队列（后台可见"待补"状态，支持一键重试），而不是 try/catch 吞掉。
- `admin-approve` / `activate-from-ticket` / `claim` 全部改为调用该服务；返回统一 `activationReceipt`（含 licenseCode/edition/expiresAt/account/initialPassword?/devicesCount/maxDevices/identitySource）。
- **密码策略统一**：`selfset`（客户自设，PBKDF2）/`random`（随机+CSPRNG，明文仅本次回执下发）/`legacy-admin`（仅无 pwdCap 的旧客户端）三态；删除 `normalizeActivationPassword` 的"审批重置已存在密码"行为（保留迁移期只读校验），密码写入点收敛到 `AccountProvisioningService`。
**改动点**：`_lib/admin-account.js`（拆 ensureClinicUser/normalize）、`validate.js`（改调服务）、`admin-approve.js`、`activate-from-ticket.js`、`admin-status.js`（回执）。
**验收**：模拟 provision 失败 → 记录 `issuancePending` 且后台可见、重试后成功；密码四场景（自设/随机/注册密码/admin 旧包）各端登录成功；禁止审批覆盖已改密码的回归用例。

### O3｜授权对账与诊断：`/reconcile` + 客户端启动三向自检 + 后台诊断页（P0，直接堵今天的事故）

**目标**：把"本地/服务端分裂"从"靠人查 KV"变成"自动发现 + 一键修复"。
- 服务端新增 `POST /api/license/reconcile`（**只读为默认**）：入参 `machineId (+code/phone 可选)` → 返回 `{entitlementState, licenseRecord摘要(status/edition/expiresAt/devices), localExpected:{code, licenseBase64 是否需重签}, actions:[...], traceId}`；`action:'repair'`（需管理员 token 或首兑令牌证据）才执行受控修复（补 mid 索引、重签 license、回写 code 台账），**绝不伪造激活**。
- 客户端启动/登录前"三向自检"（离线 APP/桌面）：`license.dat 可解密?` × `license:code?` × `entitlement(mid)`；不一致时：
  - NO_LICENSE 且 mid 有绑定 → 自动重装 license（今天 -7 的 machineId 重裁升级为通用 reconcile）；
  - 本地有 license 但服务端已删除/停用 → 明确"授权已失效"，给自助"重新激活/联系客服"入口，不再反复弹激活框；
  - 本地残留码/机器码/registrationInfo 冲突 → 自动清理并记录诊断日志。
- 后台新增"🔎 激活诊断"页（复用 admin 双副本增量做法）：输 码/机码/手机号 → 合并展示 license + admin_req + order + device_version + license_log 时间线 + 一键 `reconcile` 结果 + 复制诊断报告。
**改动点**：新增 `functions/api/license/reconcile.js`、`auth-core/offline.js`/`cloud.js` 启动自检（新增能力位，旧包不影响）、`public/admin/index.html` + `site-admin/admin/index.html` 增量页、`license-core.js` 复用 getLicense/findLicensesByMachine。
**风险**：只读/修复权限边界必须严格（安全二查必查项）；旧客户端不调 reconcile 时仍依赖现有自愈。
**验收**：重现"KV 手改 unused + 本地有 license"场景 → 客户端自检给出明确状态并可一键修复；后台诊断页对三类目标（码/机码/手机号）5 秒内出时间线。

### O4｜设备与额度模型重构：绑定投影表（P1）

- 新增 `device_binding:{machineId}`（`{code, status:active|kicked|revoked, productClass, clientClass, boundAt, lastSeenAt, operator}`）与 `license_devices:{code}` 投影；`devices[]` 保留兼容期双写。
- `entitlement` 按 `mid_idx` O(1) 命中后直接查投影表，不再扫 `devices[]`；`mid_owners` 自动重建（读侧回填已有）。
- 换机/解绑/踢机政策收敛为服务端单一函数 `evaluateDevicePolicy({operation, type, edition, devices, phoneVerified, ...})`，客户端只展示服务端返回的 `reason` 与 `actions`（不再自算"最旧一台"）。
- 后台"设备管理"页合并 display：码/绑定/版本/最后在线/操作按钮（unbind/kick/revoke）一屏。
**验收**：个人版 2 台、机构版 5 台、换机 5 种场景回归（D1/D2 清单）；投影表与旧 devices[] 对拍一致；性能（entitlement P95 不升）。

### O5｜端形态/版本/能力协商统一（P1）

- 所有激活/心跳/entitlement 请求统一携带 `clientInfo:{productClass, clientClass, versionName, versionCode, build, edition, platform, capabilities[]}`；服务端 `schema-guard` 校验并落 `device_version`。
- 服务端响应统一带 `minClientVersion` / `capabilities` / 标准错误码（`PRODUCT_CLASS_MISSING`、`NEED_CLINIC_NAME`、`TOKEN_CONSUMED` 等）——旧包按缺失字段降级推定，不再裸 400。
- 六端能力矩阵工具化：`tools/activation-matrix-check.cjs`（grep manifest scheme/Java bridge case/JS shim 方法/hot FILES 清单/minAppCode）接入 pre-push（第 18 道门）——把人工勾稽变机器门禁。
**验收**：矩阵工具在"删一个桥方法"时 1 秒内报「六端缺失」；老 APK（不带 clientInfo）激活回归零差异。

### O6｜可观测性与自助（P1）

- **traceId 贯穿**：`activation-session`/令牌/申请单/码/设备日志统一 `traceId`（客户端生成或服务端 start 返回）；所有 license 写操作 appendLicenseLog 带 traceId。
- 客户端激活失败自动上报脱敏摘要（action/clientInfo/错误码/traceId，最多 1 条/次），后台聚合"激活失败榜"。
- 客服后台"一键诊断报告"（复制文本：码脱敏/机型/版本/时间轴/建议动作），替代 wrangler 手查。
- 告警：激活失败率（>5%）、审核积压（>24h pending）、异常状态（同一码 1h 内 >3 次 denied）、entitlement 5xx。
**验收**：一次完整激活在后台可凭 traceId 串联 ≥8 条事件；失败率看板可用。

### O7｜文档/流程层（P2，低成本）

- 建立《激活错误码与客服处置手册》（错误码 → 客户文案 → 客服动作 → 是否可自助修复），与 O3 诊断页联动。
- 明确"禁止手工改 KV 码记录"运维红线：所有业务级重置必须走 O3 reconcile/repair 或 admin 工具（今天 P40 事故的直接教训）。
- 版本/edition 单一来源：服务端 `mapActivationTypeToEdition` 为唯一映射，客户端只消费；8 处版本展示收敛为 `build-meta`（Java SSOT）单一出口。

---

## 4. 建议实施顺序（按 ROI/风险）

| 阶段 | 内容 | 预估 | 依赖 | 回滚 |
|---|---|---|---|---|
| **S1（P0，1 个迭代）** | O3 reconcile（只读版）+ 客户端启动三向自检 + 后台诊断页；删除密码归一覆盖；O1 session MVP（令牌核销后移 + 幂等，先离线 APP/桌面）；**云 APP 签名 gate token 缓存 + 离线宽限**（已拍板） | 4-6 天 | 无（新端点/新能力位） | 服务端开关 `config:activation-session`；客户端能力位缺失走旧路 |
| **S2（P0/P1）** | O2 LicenseIssuanceService 全量替换 admin-approve/ticket/claim 内部；O1 session 扩到云端四端；后台"半成态"重试 | 5-7 天 | S1 | 按端点灰度（分 action） |
| **S3（P1）** | O4 设备投影表 + O5 clientInfo/矩阵门禁 + O6 traceId/诊断报告 | 1-2 周 | S2 | 双写兼容期，旧字段只读 |
| **S4（P2）** | 旧端点退役路线（validate/status.js 心跳/裸码链接）+ 错误码手册 + 版本单一出口 | 持续 | S3 | 版本下线前保留 2 年兼容 |

**每阶段验收统一要求**：pre-push 17 道门 + 新增 act-* mock 测试（替代 tools/_tmp 一次性脚本，入库维护）+ H2 真机对应用例 +（服务端改动）双独立审查 + 安全二查（license 链铁律）。

---

## 5. 已收敛/勿重复实施（避免回退与重复投入）

- ✅ `claim` 统一门面 + machineId schema-guard（`claim.js`）；激活入口已收口 claim（6 处）。
- ✅ `pwdCap:'v2'` 密码能力位硬分流 + 随机初始密码 + `mustChangePassword` 首登强制改密（`validate.js` L132-153、`admin-account.js` L528-543）——旧客户端固定 admin 行为保留（零回归）。
- ✅ 淘宝预置码自动开通（`validate.js` L331-439）+ 同手机号重复购买顺延（`renewClinicForRepeatPurchase`）+ 幂等。
- ✅ 诊所名闸 + P40 令牌兑换设备台账豁免（`validate.js` L447-453、`activation-token.js` L352-369）+ 幂等短路补写。
- ✅ 登录闸 NO_LICENSE 码错位自愈（`verifyLoginGate` machineId 重裁 + 权威码回写，热更 -7）。
- ✅ 工单审批 CAS + 终写复核（`activate-from-ticket.js` L215-258/L420-472）、`admin-delete` 索引联动、`admin-data-audit` 数据体检。
- ✅ 多设备附属设备重签（`admin-status.js` L344-401）、V7 license 重签自愈（L336-341）。
- ✅ 轻量自愈：`lookup` 预填、`syncLicenseFromServer` 同机同号门 + 注册门控、`installLicenseFromServerBridge` 单一装码入口。
- ✅ 六端能力矩阵（KNOWLEDGE §182-194）——**保留为人工勾稽基线，O5 再工具化**。

---

## 6. 已拍板决策（2026-10-17）

| # | 决策点 | 结论 | 对方案/路线的影响 |
|---|---|---|---|
| 1 | 是否新增"激活会话层"（O1） | ✅ **接受，S1 先做 MVP** | 新客户端走 session、旧端点保留兼容；令牌核销时点后移到 claim 成功；S1 增加 session MVP 项 |
| 2 | 云 APP 是否补本地授权载体 | ✅ **补签名 gate token 缓存（不引入 license.dat）** | 云端两端口径统一为「账号权威 + 签名 gate token 离线宽限」；复用现成 GATE_SIGN/离线宽限实现，S1 增加客户端小项 |
| 3 | 设备投影表迁移双写窗口（O4） | ✅ **2 个整包周期** | S3 执行；双写期覆盖存量客户端升级窗口，期满后旧 `devices[]` 只读 |
| 4 | 旧端点退役时间表（P2-2） | ✅ **冻结新客户端 → 观察 12 个月 → 公告 6 个月 sunset（约 18 个月）** | 即日起新客户端只调 session/claim 新链；`validate`/旧裸码链接/`status.js` 心跳按 12+6 月路线退役 |
| 5 | 历史默认 admin 强制改密 | ✅ **仅新开通/重置强制**（随机密码路径的 `mustChangePassword` 保持） | 历史账号不强制、避免客服风暴；后台可提供"批量标记强制改密"运营工具（可选，另行评估） |

**决策后的 S1 待开工范围（等指令即开工）**：
1. `POST /api/license/reconcile`（默认只读；repair 需管理员 token/首兑令牌证据）；
2. 客户端（离线 APP/桌面优先）启动三向自检 `license.dat × license:code × entitlement(mid)`；
3. 后台双副本「🔎 激活诊断」页（码/机码/手机号 → 全链时间线 + 一键报告）；
4. 删除 `normalizeActivationPassword` 的"审批覆盖已改密码"行为；
5. activation-session MVP（令牌核销后移 + 幂等/可重试）；
6. **云 APP 签名 gate token 缓存 + 离线宽限**（读取 entitlement 已下发 gateToken，判定逻辑与 offline 同源）。

> 以上 5 项决策已同步到 HANDOFF H8 与 KNOWLEDGE；S2-S4 按本决策调整（详见 §4）。

---

## 附：本文关键代码索引（便于评审/实施）

- 服务端：`functions/api/license/claim.js`、`validate.js`（L120 限流/L132-153 pwdCap/L331-439 淘宝自动/L441-471 诊所名闸/L483-523 换机）、`admin-approve.js`（L224-269/L319/L346-408/L410-461）、`admin-status.js`（L280-341/L344-401/L405-430）、`admin-submit.js`（L278-288/L344-374/L516-538）、`activate-from-ticket.js`（L215-258/L420-472）、`activation-token.js`（L246-377）、`entitlement.js`（L114-201）、`heartbeat.js`（L201+）、`status.js`（L59-76/L242/L327/L343）、`_lib/admin-account.js`（L52-110/L113-230/L280-321/L528-543/L615-697）、`_lib/license-core.js`（L60-100/L899-1000/L1385-1394）。
- 客户端：`shared/auth-core/offline.js`（L228 FSM/L2455-2697 登录闸/L3311 心跳/L4486 取码/L5592-5607 端点/L6075 payload/L6124 身份提供器/L7049 免费/L7322/L7453 claim/L8173 onAdminActivated）、`shared/auth-core/cloud.js`（L1099 login/L2342 心跳/L2464 授权检查/L5197 activate.submit/L5589 申请/L5844 onAdminActivated/L5905-5917 云端装码分支）、`shared/desktop-license-ipc.cjs`（L293-332 submit-activate/L580 install-admin-license/L509 verify-gate）、`shared/license/license-manager.js`（LICENSE_TYPE_CONFIG L194-210）、`app_project/db-offline/.../LicenseManager.java`（L289-299 URL/L415-465 试用/L492-579 领码自愈/L595 装码桥/L4082-4296 activateOnline/L4297 installAdminLicense/L4843-4916 syncCreateActivationUser）、`MainActivity.java`（L2188-2283 桥 case/L3458-3494 activateLicense/L1550+ 版本注入）、`cloud_app/.../MainActivity.java`（L2930-2987 云端 claim）。
- 后台：`public/admin/index.html`（L1845 generateCodes/L2036 batchGenerate/L2635 unbindDevice/L5476 unbindDeviceBinding/L5696 generateActivationLink）+ `site-admin/admin/index.html` 双副本。
