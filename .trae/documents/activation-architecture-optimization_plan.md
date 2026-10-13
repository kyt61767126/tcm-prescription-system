# 注册→激活全链路架构梳理与"填码即激活"优化 实施计划

> 目标：全设备（桌面/App/Web）× 全版本（淘宝码自动开通 / 付款后人工开通 / 试用·免费到期）下，
> **已注册信息不再重复填写，激活只要求"激活码 + 确实缺失的最小字段"**；激活判定收口为单一权威，消除多入口重复表单。
> 本文档先梳理现状（含文件/行号），再给出按风险分级的优化步骤。**审批后才动代码。**

---

## 一、仓库调研结论（现状全景）

### 1. 身份与激活的分层（2026-09-04 方案B 已确立的铁律）
- **注册 = 本地/云端建账号**：离线端写本地台账 `config.json users` + `localStorage['license:registrationInfo']={phone,clinicName,adminName,...}`（[offline.js L5091](file:///d:/trae_projects/kyt-zy/shared/auth-core/offline.js#L5091)）；云端写平台账号。
- **激活 = 纯 license 操作**：`POST /api/license/claim`（门面 [claim.js](file:///d:/trae_projects/kyt-zy/functions/api/license/claim.js) → [validate.js](file:///d:/trae_projects/kyt-zy/functions/api/license/validate.js)），激活收尾不覆盖已注册密码（密码写点唯一）。

### 2. 四个激活入口（客户端，权威源 offline.js / cloud.js）
| 入口 | 触发 | 提交链路 | 收集字段 |
|---|---|---|---|
| Tab1 管理员激活（付款购买） | 版本选择页版本卡 | order-submit/admin-submit→付款→轮询 | 手机号（版本页）+ 注册信息 + 邀请码 |
| **Tab2 激活码激活** | 金色按钮/注册成功页/到期 | **claim 直连**（App）或桌面 Java 桥 submit | 码 + **手机号** + 密码选填 +（按需）诊所/姓名 |
| Tab3 工单申请 | 无码客户 | admin-submit | 全表单 |
| 桌面 activate-window | Electron 独立窗 | activate.js→claim | 码+user+clinicName+phone |

Tab2 表单结构（[offline.js L6117-6171](file:///d:/trae_projects/kyt-zy/shared/auth-core/offline.js#L6117)）：
- 激活码（必填）、绑定手机号（红星必填）、登录密码（选填）、
- 诊所名+管理员姓名（`adminCodeIdentityFields` **默认隐藏**，仅服务端回 `needClinicName/needActivationInfo` 才展开）。

### 3. 服务端 claim 对字段的真实要求（validate.js）
- 硬必填只有 `code` + `machineId`（[L164-169](file:///d:/trae_projects/kyt-zy/functions/api/license/validate.js#L164)）。
- **同机重激活**（machineId 已在 devices）：免诊所名、免身份核验 → 仅凭码+机即可（[L447](file:///d:/trae_projects/kyt-zy/functions/api/license/validate.js#L447)）。
- **换机**（used 码+新机）：手机号一致 `phoneVerified` 自动解绑恢复；否则要诊所名或原 user 凭证（[L483-523](file:///d:/trae_projects/kyt-zy/functions/api/license/validate.js#L483)）。
- **全新码首激（无 clinicName/user 锚点）**：必须给诊所名或姓名，否则回 `needActivationInfo`（[L474-481](file:///d:/trae_projects/kyt-zy/functions/api/license/validate.js#L474)）。
- **淘宝预置码**（`__pcGate.source==='preset'`，personal/pro）：码+合法手机号即自动开诊所/账号（cloud/offline 双格，[L331-439](file:///d:/trae_projects/kyt-zy/functions/api/license/validate.js#L331)），无需诊所名/姓名。

### 4. 各版本开通路径
- **淘宝激活码自动开通**：预置码首激，99 personal / 299 pro，`taobao-local/cloud-auto-provisioned`；同手机号重复购买走顺延（`renewClinicForRepeatPurchase`）；失败 `...-pending-manual`。
- **管理员后台确认付款手动开通**：买家 order-submit 建单（pending_payment）→ [order-paid.js](file:///d:/trae_projects/kyt-zy/functions/api/license/order-paid.js) `markOrderPaid` 入 admin_req_index 待审 → 管理员 admin-approve 生成码/绑定（客户已在下单时提交过手机号，后台不再向客户索要）。
- **免费版**：开方永久免费，无需激活；备份/导入/拍照为标准版，随时输码升级（无 free claim）。
- **7 天试用**：trial 型码 + `trial_fp:{hwFp}` 指纹计数；verify.js 90 天未在线验证降级试用；到期走 Tab1 版本页（2026-09-15 已做"到期直通"，本地有诊所/医师名，仅补手机号，[L6066-6075](file:///d:/trae_projects/kyt-zy/shared/auth-core/offline.js#L6066)）。

### 5. 关键缺口（"重复填已注册信息"的根因）
1. **Tab2 手机号预填只在 `initialTab==='code'`（注册成功页进入）生效**（[L6852-6863](file:///d:/trae_projects/kyt-zy/shared/auth-core/offline.js#L6852)）；从**版本选择页金色按钮**或**到期弹窗**进入时，不主动从 `license:registrationInfo` / 桥 `getActivationUsers` 回填 `adminCodePhone` → 已注册用户仍要手输手机号。
2. `state` 初始化为空（[L6021](file:///d:/trae_projects/kyt-zy/shared/auth-core/offline.js#L6021)），弹窗打开时没有统一从本地注册源灌入 `phone/clinicName/adminName`；现有 `__bridgePrefillPromise` 主要服务 Tab1 自动提交。
3. 全新码首激缺身份锚点时，客户端展开的诊所/姓名框**不预填本地注册值**，用户要再打一遍。
4. cloud.js 同构窗口存在相同问题（需同步改造）。
5. 多入口（Tab1/Tab2/桌面窗/到期）各自拼 claim/order 请求体，字段口径靠注释维持，无单一"本地身份提供器"，易漂移。

---

## 二、设计原则（不破坏既有安全语义）

- **码 + machineId 仍是授权硬锚点**；身份信息只做"预填/自动带出"，**不放宽**换机与首激的核验：
  - 换机仍需手机号核验通过（手机号=登录账号，仅本人知晓），不接受"仅凭机内自报诊所名"自动接管他人授权。
  - 全新码首激仍需建立身份锚点，但默认从本地注册信息带出、用户一键确认，而非手填。
- 纯 JS 运行时注入/DOM 预填，**不改 HTML 结构、不改 CSS**（界面保护铁律）；auth-core 双权威源改完跑 sync。
- 服务端改动保持**旧客户端零回归**（新增能力以"客户端带来了可直接用"为主，不新增必填）。

---

## 三、文件与模块

- [shared/auth-core/offline.js](file:///d:/trae_projects/kyt-zy/shared/auth-core/offline.js)：新增统一"本地身份提供器"，Tab2 全入口预填；sync 到 3 副本。
- [shared/auth-core/cloud.js](file:///d:/trae_projects/kyt-zy/shared/auth-core/cloud.js)：云端同构改造；sync 到 8 副本。
- [functions/api/license/validate.js](file:///d:/trae_projects/kyt-zy/functions/api/license/validate.js)：（P2，可选）身份锚点解析增强 + 新增只读"码状态预检"字段复用。
- 测试：`e2e/.tmp/activation-identity-prefill-test.mjs`（新增）。
- 产物：app-local 热更签发（离线 App 免重打包）；云端 Web/桌面刷新即达。

---

## 四、实施步骤（按风险分级，建议 P1 必做，P2 评估后做）

### P1：客户端"本地身份统一提供 + 全入口预填"（低风险，纯前端，解决主诉）
1. 在 offline.js / cloud.js 各加一个 **`resolveLocalIdentity()`**（单一来源，合并）：
   - 数据源按优先级：`getLocalRegistrationInfo()`（registrationInfo）→ 桥 `getActivationUsers()`（取含手机号账号）→ 云端 token 账号 → `CONFIG.clinicName`/`local_clinicName`；
   - 返回 `{ phone, clinicName, adminName, source }`，任一字段缺失即为 null，带 2s 超时与异常容错（沿用 `__bridgePrefillPromise` 模式）。
2. **弹窗打开 / 切到 Tab2 时**统一预填（不只 initialTab='code'）：
   - `adminCodePhone`：有合法本地手机号且框为空 → 回填（红星仍在，用户可见可改）；
   - 收到 `needActivationInfo` 展开诊所/姓名框时，用本地身份预填 `adminCodeClinicName/adminCodeAdminName`；
   - claim 请求体的 `user/clinicName` 已支持从 state/本地带（L7111/L7146），确认走统一提供器，去掉分散兜底。
3. 视觉上：已预填手机号时在框下提示"将使用本机注册手机号 138****0000，可修改"，保持用户知情。
4. cloud.js 做同构改造（云端登录态用户更易获取；未登录则仍要求手机号）。
5. 改完 `node tools/sync-auth-core.ps1`；`check-interface.bat` 前后各一次；cv hash 按钩子要求更新；签发 app-local 热更（minAppCode 288 不抬）。

**P1 效果**：已注册用户在任意入口（金色按钮/到期/注册成功页/桌面窗）激活，**只需输激活码**（手机号自动带出、诊所/姓名首激自动带出），密码保持选填。

### P2：服务端身份锚点解析增强（中风险，评估安全后做）
6. validate.js 首激 `needActivationInfo` 判定前，增加一条**仅建议、不自动授权**的解析：当客户端带了合法手机号（哪怕码无锚点），允许以"手机号"作为身份锚点建立 user（当前 L474 只认 clinicName/user，不认 phone 字段），使淘宝渠道外的**裸码 + 手机号**也能一步激活，不必再补诊所/姓名。
   - 安全边界：仅 `record.status==='unused'` 首激；不改变 used 码换机核验；clinicName 缺省时由既有命名/台账规则生成（与淘宝自动开通同口径），不产生空名诊所。
7. （可选）claim 成功响应里回带 `resolvedIdentity:{phone,clinicName,adminName}` 与 `identitySource`，客户端装码/建本地账号时直接消费，减少各入口猜测字段。

### P3：入口与请求体收口（低优先，重构向，可后续单独立项）
8. 把 Tab1/Tab2/桌面窗/到期 的 claim·order 请求体拼装收敛为一个 `buildActivationPayload(identity)`，字段口径单点维护（本计划仅在触碰文件内做最小收口，不做大范围搬迁）。

---

## 五、依赖与注意事项
- auth-core 双权威源铁律：offline.js 3 副本、cloud.js 8 副本，改完必须 sync；改 admin 双副本跑 `diff-cross-version.cjs`。
- 离线 App claim body 不带密码（本地密码走 installAdminLicense）；云端带 `pwdCap:'v2'`——维持不变。
- 桌面端走 Electron 桥 submit(code,user,clinicName,phone,password,...)：预填的 user/clinicName/phone 需正确透传到桥参（L7121），需桌面回归。
- 热更生效=App 彻底退出重开第 2 次；minAppCode 288 不抬（纯 JS 无新桥依赖）。
- 不碰订单/支付/审批既有状态机（order-paid/markOrderPaid/admin-approve 语义不变）。

## 六、验证
- 新增 mock/单元：resolveLocalIdentity 来源优先级与超时容错；Tab2 三入口（金色按钮/到期/注册成功页）预填断言；needActivationInfo 展开后预填；claim body 字段正确（离线无密码/云端 v2）。
- 存量回归：first-activation-perf 15、kv-list-quota 28、mid-owners 30 等全绿；`node --check`；pre-push 17 道。
- 真机/桌面手测清单：①已注册→金色按钮→仅输码激活；②试用到期→仅输码；③换机→手机号带出自动恢复；④未注册新机→仍引导最小注册；⑤云端 Web/桌面刷新即达。

## 七、风险与回退
- **风险**：预填错误手机号导致激活绑错账号 → **缓解**：预填仅回填输入框（用户可见可改），首激/换机仍以服务端手机号核验为硬门；提交前界面明示将使用的手机号。
- **风险**：桥 getActivationUsers 慢/异常 → 2s 超时 + registrationInfo 优先 + 留空手填（现有兜底路径不变）。
- **风险（P2）**：放宽裸码首激锚点 → 严格限定 unused 首激、不触碰换机核验，可独立开关/灰度，必要时回退 P2 仅保留 P1。
- **回退**：纯前端改动可直接 revert auth-core + 发旧版热更；服务端 P2 默认保守、可加 config 开关一键关。
