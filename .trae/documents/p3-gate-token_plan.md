# P3 服务端短周期 Gate Token + 设备证明 Implementation Plan

## Repository Research（研究结论）

### 1. M-2A 实验的决定性结论（2026-09-27 真机+模拟器实证）

- Android Keystore 密钥在「系统设置→清除数据（pm clear）」时被删除：华为真机（Android 16 基底）与 AOSP 原生模拟器（API 36 google_apis）表现一致——**不是华为定制，是 Android 16 的统一行为**；force-stop 重启密钥存活。本地锚点路线（Keystore 存「曾激活」事实）在新系统上不成立，M-2A 代码已全部回退，工作树与 M-2 发布版一致。
- 设备证明的碎片化现实：非 GMS 设备（华为、国内市场机型）无法产生链到 Google 根的 Play Integrity / Key Attestation 判定（[warden-supreme 平台说明](https://a-sit-plus.github.io/warden-supreme/latest/bg/platforms/)）；华为有自有信任域 Safety Detect / Device Security Kit（[华为文档](https://developer.huawei.com/consumer/en/hms/huawei-safetydetectkit/index.html)），其他国产厂商 TEE 根无公开稳定承诺。

### 2. 当前授权链权威结构（HEAD）

- 登录门唯一权威 = [shared/auth-core/offline.js](file:///d:/trae_projects/kyt-zy/shared/auth-core/offline.js)，经 sync-auth-core 分发到 3 个离线目标（desktop/auth-core.js、desktop/electron/auth-core.js、APP assets public/auth-core.js）。**离线 Electron 主进程无 verifyGate IPC**；APP Java 侧仅提供 `license.getStatus`（validateLicense 本地态）与装码桥，登录裁决与宽限全在 JS。
- 裁决：POST `https://tcm-prescription-system.pages.dev/api/license/entitlement`，体 `{machineId, code, username}`，15s 超时；返回四态 LICENSED/NO_LICENSE/LICENSE_EXPIRED/LICENSE_REVOKED + 403 设备封锁 + `accountState`（墓碑）+ `serverTime`。
- 宽限现状：成功写 `license:lastVerify`、清 `license:offlineStart`；断网时凭 `license:offlineStart` 给固定 7 天宽限（LOGIN_GATE_GRACE_MS）。
- 残余缺口（M-2A 实验确认）：**清除数据 + 断网** → 本地态全无 → `registerTrialOnline` 网络失败走宽限允许 → 可获新试用（7 天/30 张上限）；墓碑/宽限起点被重置。
- 服务端：Cloudflare Pages Functions（Workers 运行时，Web Crypto 可用，无 Node 模块）；KV 单绑定名 `KV`；现有会话凭证 [functions/api/_lib/auth.js](file:///d:/trae_projects/kyt-zy/functions/api/_lib/auth.js) 的 signToken=HMAC-SHA256 Bearer，TTL `AUTH_TOKEN_TTL_HOURS=8`；license-core v6 已用 ECDSA 非对称签名（有现成密钥管理模式）。
- 设备身份：APP mid=`SHA256(ANDROID_ID|pkg|versionName|manufacturer|model)` 前 32 位（清数据不变）；桌面 mid/硬件指纹（M-2 已锚入凭据管理器）。

### 3. 核心设计思想

宽限期的权威从「客户端固定 7 天窗口（用户清数据即可重置）」改为「**服务端签发、客户端可离线验证、无法伪造、过期即锁的短周期 gate token**」：

- 服务端在线裁决 LICENSED 时签发 ES256（EC P-256 ECDSA）token：payload 绑定 `mid`/`username`/`state`/`features`/`iat`/`exp`/`jti`；私钥仅存服务端（环境变量），**验证公钥内置客户端**（公开无妨）——离线验签不需要服务端、不需要共享密钥。
- 离线放行条件（全部满足）：内置公钥验签通过 **且** token.mid=本机 mid **且** exp 未到（用 serverTime 校正后的时钟）。
- fail-closed 天然成立：
  - 清除数据 → token 与本地态一起被删 → 无有效凭证 → 必须联网（服务端恢复：设备 KV + 墓碑真实裁决，被吊销用户依然被拒）；
  - 断网超过 token TTL → 自动锁定，宽限长度由服务端策略控制（默认建议 48h，可按 license/账号差异化）；
  - 篡改/重放：签名无法伪造；跨设备重放被 mid 绑定堵死。
- 时钟攻击：entitlement 已回 `serverTime`，客户端建立并持续更新本地时钟偏移（key `license:clockOffsetMs`）；偏移超阈值（如 >10 分钟）或无偏移基线 → 离线不放行；回拨触发既有 rollbackSuspected → fail-closed。
- 设备证明（attestation）是获取 token 的**纵深增强而非前置**：entitlement 本就要求设备 KV 存在有效 license 才返回 LICENSED，脚本无有效 mid 骗不到 token。attestation 放第二期。

### 4. 分层范围

- **P3-A（本次实施，高收益/小改动/厂商无关）**：ES256 gate token 签发、客户端验签与离线收口、时钟偏移校正。
- **P3-B（另立项）**：多通道设备证明（GMS 设备 Play Integrity；华为 Safety Detect/Device Security Kit；通用 Key Attestation + 多 trust anchors + 吊销列表），token 签发前校验证明，防脚本/篡改环境。
- **P3-C（另立项）**：桌面侧统一（Windows 维持 M-2 凭据管理器；Electron 同样消费 gate token，云端/离线桌面宽限一并收口）。

## Files and Modules（改动文件）

- [functions/api/license/entitlement.js](file:///d:/trae_projects/kyt-zy/functions/api/license/entitlement.js)：
  - 新增 `signGateToken(payload)`：Workers WebCrypto，EC P-256 私钥从环境变量 `GATE_SIGN_P8_B64`（PKCS#8）导入；header 带 `kid`（`GATE_SIGN_KID`，默认 v1）支持轮换；
  - 仅当裁决为放行态（LICENSED，含 free）时签发，TTL 由 `GATE_TOKEN_TTL_HOURS`（默认 48）控制，payload={v:1,mid,username,state,type,features,iat,exp,jti}；响应增加 `gateToken` 字段；其他状态不签发。
  - 私钥缺失/签名异常：不阻塞裁决（log + 不带 gateToken，兼容降级）。
- [shared/auth-core/offline.js](file:///d:/trae_projects/kyt-zy/shared/auth-core/offline.js)（权威源）：
  - 内置 gate 验签公钥集合（kid→SPKI P-256 常量），`verifyGateToken(token, mid)`：Web Crypto（APP WebView/桌面均支持 ECDSA P-256 SHA-256）验签 + kid 查找 + mid 绑定 + exp（校正时钟）；
  - 裁决成功（LICENSED）：保存 `license:gateToken`；更新 `license:clockOffsetMs`（serverTime-Date.now）；
  - 断网/HTTP 失败分支改为：读 token → verifyGateToken 通过 → 放行（沿用当前用户/账号墓碑语义）；失败 → fail-closed（文案「离线授权已到期，请连接网络后登录」）；旧 `license:offlineStart` 固定 7 天宽限逻辑删除（保留一次性迁移：无 token 的旧版用户首次升级时走一次在线裁决）；
  - 时钟偏移：无基线或 |偏移|>10min → 离线不放行；账号墓碑/accountState 逻辑不变。
- 分发：`tools/sync-auth-core.ps1`（3 离线目标，自动完成）。
- 私钥/环境变量配置：wrangler.toml 增加 `GATE_SIGN_KID`/`GATE_TOKEN_TTL_HOURS`（非敏感）；`GATE_SIGN_P8_B64` 作为 secret（`wrangler secret put`，不入库）；密钥对用本地脚本一次性生成（私钥仅入 secret、公钥写入 offline.js）。
- 测试工具：新建 `tools/gate-token-smoke.cjs`：Node crypto 签发/验签契约、过期、mid 不匹配、篡改、错误公钥、kid 轮换、时钟偏移边界。
- [.trae/KNOWLEDGE.md](file:///d:/trae_projects/kyt-zy/.trae/KNOWLEDGE.md)：沉淀 M-2A 实证结论（pm clear 删 Keystore 密钥）与 P3-A 机制、威胁模型边界。

## Implementation Steps（依赖顺序）

1. 一次性生成 EC P-256 gate 签名密钥对（临时脚本，用完即删）：私钥配置为 CF secret（先在测试环境/预览验证），公钥（SPKI base64）+kid 写入 offline.js。
2. entitlement.js 实现 signGateToken 并接入响应；本地/预览环境用构造请求验证字段与签名。
3. offline.js 实现 verifyGateToken、token 存取、时钟偏移、离线分支收口、旧版迁移。
4. node --check + sync-auth-core 分发；全门禁回归（见 Validation）。
5. gate-token-smoke 新增并跑通；真机+模拟器 E2E（核心证据）。
6. 双重独立审查（功能+安全）→ 修复 → 复审。
7. KNOWLEDGE 沉淀 → 精确逐路径 git add（禁 add ./-A，排除 promo/）→ commit/push（pre-push 门禁）。
8. 配置生产 secret 并确认生产函数生效；APK/桌面无需因 P3-A 重新打整包？——offline.js 在 APP assets/桌面 asar 内：
   - APP：若 auth-core 在 14 个热更白名单内，签发热包即可，旧版彻底重进生效；否则需重新打 APK（versionCode 305）。
   - 桌面（云/离 exe）：渲染层文件若在热更可达域走热更；确认是否被 asar 收录（auth-core.js 在 electron 目录，属渲染层，由 Electron 从 asar 读取→热更若支持该路径则热更，否则随下一版 exe）。发布前确认分发路径。

## Dependencies and Considerations

- Workers Web Crypto：`crypto.subtle.importKey('pkcs8',…,{name:'ECDSA',namedCurve:'P-256'})` 与 sign（hash SHA-256）均支持；JWT ES256 签名为 raw r||s（64B），手工编码 JWT 即可，不引依赖。
- Android WebView（minSdk24 对应 System WebView）与桌面 Chromium 的 WebCrypto ECDSA P-256 均可用。
- 降级红线：服务端签名异常不带 token，不阻塞在线登录；客户端验签环境异常按无 token 处理（fail-closed），但在线路径永远优先——正常联网用户零感知。
- TTL 策略：默认 48h（远短于 7 天），free 用户可给更长（业务无损失）；账号级吊销在下次在线时立即生效（墓碑 + 服务端裁决）。
- 旧版客户端（无 token 逻辑）升级：首次启动在线裁决拿 token；若升级后一直断网，则按 fail-closed——权衡后可接受（安装/升级本身是主动行为，可在升级说明提示联网打开一次）。
- 安全：公钥内置不降低安全（它只用于验证）；私钥一旦泄露可借 kid 轮换（客户端预置新旧两把公钥）。
- token 存储位置（Preferences/localStorage/userData）被读取不构成损失：签名防伪造、mid 防搬移、exp 防长期有效。

## Validation

- `node --check` 全部改动 JS；sync-auth-core VerifyOnly/同步；sync-all VerifyOnly。
- gate-token-smoke 全绿（≥10 组：正常验签、过期、mid 不符、签名篡改、payload 篡改、未知 kid、错公钥、时钟偏移边界、TTL 边界、降级缺字段）。
- 全门禁：license-config-sign 134、desktop-license 141、desktop-user 58、desktop-print 33、biz 93、credential-vault 60、smoke-runtime --all 157；check-interface 6 OK；diff-cross-version；copy-consistency。
- **真机 + 模拟器 E2E**：
  1. 联网登录成功 → 响应含 gateToken、本地保存、clockOffset 更新；
  2. 断网（飞行模式）token 有效期内 → 登录放行；
  3. 改 token 一字 / 换 mid / 等待（或临时缩短 TTL）过期 → fail-closed；
  4. pm clear 后断网启动 → fail-closed，无试用/宽限；
  5. pm clear 后联网 → 正常裁决恢复（被吊销账号仍拒绝、墓碑重下发）；
  6. 回拨系统时间超阈值 → 离线 fail-closed；
  7. 覆盖升级（旧版有 offlineStart、无 token）→ 首次在线裁决后正常。
- 双审：功能+安全独立审查并复审通过方可提交。

## Risks

- 离线可用性收紧误伤长期断网的真实诊所：默认 TTL 48h 且在线即用即续；文案引导联网；可按账号类型差异化 TTL。
- 私钥泄露：kid 轮换机制（预置多公钥）；secret 不入仓库。
- 客户端时钟被改：偏移基线 + 阈值拦截 + rollbackSuspected 既有机制。
- 热更遮蔽旧逻辑：按「源码+热包+整包」三位一体铁律，确认 auth-core 分发通道。
- 边界外残余（如实记录）：root/同用户代码执行可 hook 验签函数、模拟器自造 mid；由 P3-B 设备证明与服务端风控继续收敛。

## 五端生效方式（实施后告知）

- **离线 APP**：auth-core 热更（如在白名单）联网打开一次并彻底重进；否则安装新 APK。
- **离线桌面 / 云桌面**：渲染层热更可达则热更，否则随下一版 exe（P3-C 前桌面宽限逻辑本身在 JS，热更即可触达，发布时确认）。
- **云端网页 / 云端 APP / 鸿蒙**：零改动。
