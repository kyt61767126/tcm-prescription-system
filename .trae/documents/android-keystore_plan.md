# P3-B Android 设备证明（Key Attestation + POP）实施计划

> 本文件取代旧「M-2A Keystore 存在性锚点」方案——该方案核心假设（密钥不随清除数据删除）已被真机实证推翻（见下）。

## Repository Research（仓库研究结论）

### 1. 旧方案失效的决定性实证（2026-09-27，p3-gate-token_plan.md §1 存档）

- **pm clear 删除 Android Keystore 密钥**：华为真机（ANA-AN00，Android 16 基底）与 AOSP 原生模拟器（API 36 google_apis）表现一致——非厂商定制，是 Android 统一行为；force-stop 后密钥存活。
- 故「Keystore 存『曾激活』布尔事实、清数据后 fail-closed」路线不成立；M-2A 实验代码已全部回退。
- 非 GMS 设备（华为国行、国内市场机型）的证明碎片化：Play Integrity 不适用；Google Key Attestation 要求设备出厂通过 Google 认证（TEE 预置 Google 签发的 attestation 密钥链），未认证设备调用会失败或只出 Software 级链。

### 2. 当前 P3-A 基线（本方案的地基）

- Gate token（ES256，TTL 48h，钳制 [1h,168h]）已上线：commit 5e16a03f；热包 app-local 2026.09.27-1。
- **工作区当前有未提交的 P3-A 修复**（E2E 真机发现）：启动闸主线程 `NetworkOnMainThreadException` 回归——
  [LicenseManager.java](file:///d:/trae_projects/kyt-zy/app_project/db-offline/app/app/src/main/java/com/benneng/pres/LicenseManager.java)
  `validateLicense(mid, allowNetworkTrial)` 三参化 + `trial_first_check`；[MainActivity.java](file:///d:/trae_projects/kyt-zy/app_project/db-offline/app/app/src/main/java/com/benneng/pres/MainActivity.java) 启动闸放行全新态、首次试用注册下沉 binder 线程；versionCode 已 304→**306**，release APK 已构建装真机。
- P3-B 开工前须先把该修复随 P3-A E2E 收尾提交（两批改动分开 commit）。

### 3. 关键技术约束

- **minSdk = 24**（[variables.gradle](file:///d:/trae_projects/kyt-zy/app_project/db-offline/app/variables.gradle)）：Key Attestation 自 API 24 可用；但 **packageName/appSignatureDigests 写入 attestation 扩展需 API 31+**（`setDevicePropertiesAttestation`）——API 24–30 设备证书链不含 app 身份，重打包理论上可出合法链，只能靠 mid/hwFp 服务端判重。
- **Google 新 attestation 根自 2026-02-01 开始签署证书链**：服务端信任根必须同时收录旧根与新根；RKP 时代证书链可能含 Provisioning 信息扩展，解析须容忍。
- 官方有证书吊销状态列表（验链时需检查）；密钥安全级别 = TrustedEnvironment（TEE）/ StrongBox / Software。
- **Cloudflare Workers 的 Web Crypto 无 X.509 路径验证 API**：证书链验证须自写最小 DER 解析（取每节 tbs/签名/签发者公钥，逐节用 Web Crypto 验签至内置根）；项目无 ASN.1 依赖（package.json 仅 Capacitor/puppeteer），按项目惯例自建小模块、不引重依赖。
- 发布签名：release 走 v1/v2/v3，密钥由 [signing.properties](file:///d:/trae_projects/kyt-zy/app_project/db-offline/app/app/signing.properties) 配置；服务端 appSignatureDigests 白名单 = 发布证书 SHA256（实施时 keytool 读取，不入库密码）。

### 4. 接入点清单

- Java：[LicenseManager.java](file:///d:/trae_projects/kyt-zy/app_project/db-offline/app/app/src/main/java/com/benneng/pres/LicenseManager.java)（本地裁决/试用注册/装码）；MainActivity 的 `AndroidNative.invoke` 桥（L1954 附近 case 分发）+ JS shim 注入（L1469 `license:*`）。
- JS 权威源 [shared/auth-core/offline.js](file:///d:/trae_projects/kyt-zy/shared/auth-core/offline.js)（sync-auth-core.ps1 → 3 离线目标）：登录门 entitlement 调用在 L2041；心跳 heartbeat 调用 L2531（断网回退 evaluateOfflineGate L2542）；IIFE 已有 `__gateTest` 钩子模式可仿。
- 服务端：[entitlement.js](file:///d:/trae_projects/kyt-zy/functions/api/license/entitlement.js)（adjudicate 纯只读 + gate token 签发 L320-350）；新端点可仿 [trial/register.js](file:///d:/trae_projects/kyt-zy/functions/api/trial/register.js) 结构；复用 [license-core.js](file:///d:/trae_projects/kyt-zy/functions/api/license/_lib/license-core.js)（getKV/checkRateLimit/getDevices…）。
- 用户在线登录端点已存在：`POST /api/users?login=true`（users.js，返 Bearer sessionToken）。

## 目标与非目标

**目标**：

1. 每台设备在 Android Keystore（TEE）生成**非导出 EC P-256 证明密钥**；激活/注册时向服务端出示 **Key Attestation 证书链**，服务端验真后登记公钥（登记在服务端 KV，**清数据删不掉**）。
2. Gate token 签发绑定 **POP（Proof of Possession）**：服务端一次性 nonce，须由 TEE 私钥签名才签发 token。
3. 「清除数据 + 重播」主路径（**无需 root**）被根治：pm clear 删本地密钥与 token → 重新注册时服务端识别「该 mid 已登记、公钥已变」→ 无账号级凭证一律拒绝。
4. 设备分层：可证明设备（Tier A）完整生效；不可证明设备（Tier B）回退 P3-A 现状，零误伤；observe/enforce 灰度开关。

**非目标（backlog，另立项）**：华为 Device Security Kit（P3-B2，需 AGC/HMS 投入）；StrongBox 强制；Play Integrity（无 GMS 不适用）；桌面端证明（P3-C）；root 窗口内重放的彻底消除（见 Risks）。

## 方案设计

### A. 设备证明密钥（Android Keystore）

- 别名 `bnzc_dev_v1`：EC P-256，`PURPOSE_SIGN|VERIFY`，`DIGEST_SHA256`，non-exportable，TEE 支持（不先要求 StrongBox）；keygen 时带服务端 challenge 与（API31+）device properties。
- 密钥只签名不加密；不替代任何现有文件密钥（license.dat TRIAL1 等不动）。

### B. 注册协议：`POST /api/license/attestation/register`

两个 action（同一端点，限流每 IP 20/h）：

1. `{action:'challenge', mid}` → 生成一次性随机 challenge（KV `att_ch:{mid}` = {challenge, exp}，10 分钟），返 `{challenge}`。
2. `{action:'register', mid, certChain:[b64...], resetAuth?}`：
   - 验证书链到 Google 根（含 2026 新根；attestationSecurityLevel 必须 TEE/StrongBox）；
   - 解析 attestation 扩展：challenge 匹配、（API31+）packageName=`com.benneng.pres.dingzhi` 且 appSignatureDigests 含官方发布指纹、deviceLocked=true、verifiedBootState=Verified（Soft-fail 可配置）；
   - 查 KV `device_att:{mid}`：
     - **不存在 → 首次登记**：`{pub:SPKI b64, kid, secLevel, boot, apiLevel, registeredAt, history:[]}`；
     - **存在且公钥相同 → 幂等成功**；
     - **存在但公钥不同（密钥已被 pm clear 重置）→ 重置裁决**（见 D）。

### C. POP 绑定 gate token（entitlement 两步式）

- 请求体新增可选 `proof:{kid, nonce, sig}`；签名内容约定串 `bnzc_poc_v1|{mid}|{nonce}`（ECDSA P-256 SHA-256）。
- 服务端：
  1. **无 proof 请求**：adjudicate 后，若该 mid 已登记且开关 enforce → 返回 `needProof:true` + 一次性 `proofNonce`（KV `proof_nonce:{jti}`，10 分钟），**不签 gate token**；未登记设备返回 `needAttestation:true` + challenge。
  2. **带 proof 请求**：消费 nonce（读后即删，防重放）→ 用登记公钥验签 → 通过才签发 gate token（签发逻辑不变）。
- observe 模式（默认）：无 proof 照常签发，仅在响应标注 `proofState:'missing|present|bad'`，积累数据后再切 enforce（改 KV `config:attestation`，零部署回滚）。

### D. 清数据后的密钥重置策略

`register` 识别公钥变更时，按账号身份裁决（客户端编排顺序：重置被要求时，用用户刚输入的账号密码调 `/api/users?login=true` 取 sessionToken，作为 resetAuth 重放）：

| 身份 | 裁决 |
|---|---|
| 付费档 + resetAuth 有效（sessionToken 对应该账号且设备归属一致） | **允许轮换**：旧公钥入 `history[{pub,rotatedAt}]`，登记新公钥；随后 POP + 装码一键恢复 |
| free 永久免费 | **放行轮换**（产品承诺免费，无经济损失；记录轮换次数供风控） |
| trial / 无凭证 / resetAuth 不匹配 | **拒绝**（`device_reset_denied`，文案引导联网登录已注册账号或联系客服） |
| 断网 | 无法注册 → P3-A fail-closed（无 token 即锁定） |

### E. 设备分层

- **Tier A**（出 Google 链、TEE 级）：注册 + POP 完整生效。
- **Tier B**（keygen/attestation 失败、Software 级、模拟器）：客户端本地标 `license:attState.tier='B'`，跳过注册与 proof，走 P3-A 原流程；服务端对从未登记的 mid 行为不变——存量用户与不支持设备零影响。

### F. 心跳续签

- POP 只在 entitlement 单点签发；心跳（10min）成功后，若本地 gate token 剩余有效期 <12h，客户端自动走一次带 proof 的 entitlement 续签（不在 heartbeat.js 重复签发逻辑）。

## Files and Modules（改动文件）

- **新建** `app_project/db-offline/app/app/src/main/java/com/benneng/pres/DeviceAttestationManager.java`：
  `probe()` / `ensureDeviceKey(challenge)`（keygen + 取证书链；TEE 失败/未配置 → 结构化 unsupported，绝不抛出）/ `signProof(nonce)` / `getKeyId()` / `getPublicKeySpki()`；全程异常捕获 + 日志。
- [MainActivity.java](file:///d:/trae_projects/kyt-zy/app_project/db-offline/app/app/src/main/java/com/benneng/pres/MainActivity.java)：
  `AndroidNative.invoke` 增 case `attestationProbe|attestationEnsureKey|attestationSign`；JS shim 的 `license` 对象增 `attestation:{probe, ensureKey, signProof}`（Java 字符串注入铁律：单引号、转义检查）。
- **新建** `functions/api/license/attestation/register.js`（challenge/register 两 action，CORS 同构，限流）。
- **新建** `functions/api/license/_lib/attestation-core.js`：
  Google 根证书/根公钥常量（旧+2026 新）、最小 DER 解析器、`verifyCertChain`、`parseAttestationExtension`、`verifyProof`、attestation 配置读取（observe/enforce、boot 软失败项）。
- [entitlement.js](file:///d:/trae_projects/kyt-zy/functions/api/license/entitlement.js)：
  proof 解析与验签、proofNonce/needProof/needAttestation、查 `device_att:{mid}`、模式开关；保持 adjudicate 纯只读与签发失败降级语义。
- [shared/auth-core/offline.js](file:///d:/trae_projects/kyt-zy/shared/auth-core/offline.js)（权威源）：
  `ensureDeviceAttested()` 编排（probe→challenge→ensureKey→register；重置时 users 登录取 resetAuth）；entitlement 调用包两步式（needProof/needAttestation 重试）；attState 本地持久化（`license:attState`）；心跳续签阈值；Tier B 回退；测试钩子。
- 分发：`tools/sync-auth-core.ps1`（offline → 3 离线目标）。
- **新建** `tools/attestation-smoke.cjs`：DER 解析/证书链/扩展字段/proof/nonce 一次性/重置裁决四策略/开关模式（证书夹具：实施首步真机采集一条真实链存档为测试夹具，与真实载荷同构）。
- build.gradle：versionCode 306 → **307**（P3-A 修复先提交后再 bump）。
- proguard：保留 DeviceAttestationManager；系统安全 API 默认 keep。
- [.trae/KNOWLEDGE.md](file:///d:/trae_projects/kyt-zy/.trae/KNOWLEDGE.md)：新章沉淀（机制 + 实证 + 边界 + 生效方式）。

## Implementation Steps（依赖顺序）

1. **P3-A 收尾**：完成真机/模拟器 E2E → v306 修复单独 commit（不含 P3-B 任何内容）。
2. **可行性探针（最高优先）**：先写 DeviceAttestationManager 的 probe/ensureKey 最小版 + 临时桥，在华为真机实测能否出 Google 链——结果决定 Tier A 测试设备来源；模拟器同步确认 Tier B。
3. 实现 DeviceAttestationManager 完整方法 + MainActivity 桥与 shim。
4. attestation-core.js（DER/验链/扩展/proof）→ register.js（两 action + 重置裁决）。
5. entitlement.js 接入 proof/nonce/开关；本地先以预览或 curl 对拍契约。
6. offline.js 编排：注册流程、entitlement 两步式、重置 users 登录、attState、心跳续签、Tier B、测试钩子。
7. sync-auth-core 分发；attestation-smoke + 全门禁基线回归（见 Validation）。
8. versionCode 307 → release APK → 真机+模拟器 E2E 全场景。
9. 双重独立审查（功能 + 安全，互不通气；仿 M-2/P3-A 流程）→ 修复 → 复审。
10. KNOWLEDGE 沉淀 → 精确逐路径 git add（禁 `add ./-A`，排除 `promo/`）→ commit/push（pre-push 十三道门）→ 热包序号递增（app-local 2026.09.27-2）→ APK 按固定文件名分发。

## Validation（验证）

- 新增 attestation-smoke 全绿并连跑稳定；真机采集的证书链夹具可被验链/扩展解析正确识别；负例：challenge 不匹配、根不符、Software 级、签名篡改、nonce 重放、公钥不符、包名/签名不符（API31+）、四类重置裁决。
- 全门禁基线复跑：gate-token-smoke 25、license-config-sign 134、desktop-license 141、desktop-user 58、desktop-print 33、biz 93、credential-vault 60、smoke-runtime --all 157；check-interface 6 OK；sync-all/copy-consistency ALL PASS；diff-cross-version；sync-all -VerifyOnly exit 0。
- **真机 E2E**（v307）：
  1. 首启 probe：Tier 判定符合探针结论；
  2. 全新账号注册 → challenge → keygen → register 成功 → entitlement POP → gate token 签发；
  3. 断网 token 窗口内 → 放行；
  4. **pm clear + 断网 → fail-closed，无试用/宽限**；
  5. **pm clear + 联网（付费）→ users 登录 → 密钥轮换 → POP + 装码恢复；被吊销账号仍被拒、墓碑重下发**；
  6. pm clear + 联网（trial 小号）→ device_reset_denied；
  7. enforce/observe 开关切换零部署生效；心跳续签；覆盖升级（不清数据）密钥持续有效。
- 模拟器 E2E：Tier B 回退全流程 + 过期/时钟场景沿用 P3-A 结论。
- 验包：release dex 用中文字符串常量核验；assets JS 直接 zip 读取。

## Risks（风险与处置）

- **华为真机可能是 Tier B**（无法出 Google 链）：步骤 2 优先实证；若成立，Tier A 完整 E2E 需另借 GMS 设备，华为覆盖走 P3-B2 评估——不得跳过实证只信文档。
- **DER 解析器兼容性**（RKP provisioning 扩展、新旧根、RSA/EC 混合链、厂商链长差异）：解析失败一律 fail-closed 且记日志；夹具覆盖真实采集链；审查专项盯解析边界。
- **误伤正常付费用户**：默认 observe；enforce 后恢复路径全自动（账号登录→轮换→装码），保留激活码与客服通道；开关即时回滚。
- **P3-A root 窗口内重放残留不消除**：POP 是在线签发时的证明，token 签出后的 root 离线重放（删锚点+回拨至 token 窗口）结构上仍在；P3-B 根治的是**无需 root 的清数据重播**，root 残余如实记录。
- **降级安装旧 APK 残留不消除**：旧客户端不发 proof 也不验 token，服务端无法阻止其本地运行；未来以覆盖率 + 强制 clientVersion 地板收敛。
- API 24–30 无 app 身份绑定：服务端 mid/hwFp 判重兜底，如实标注。
- 热包/APK 版本错配：遵循「源码+热包+整包」三位一体，热包序号递增先发再发 APK。

## 五端生效方式（实施后告知）

- **离线 APP**：Java（证明密钥+桥）须安装新 APK（versionCode 307）；JS 编排走 app-local 热包——联网打开一次、彻底划掉重进。
- **离线桌面 / 云桌面 exe**：零改动（本方案 Android 专属；M-2 已发布）。
- **云端网页 / 云端 APP / 鸿蒙**：零改动。
