# 淘宝云端码二期：客户自设密码 + 随机初始密码 + 首登强制改密 实施计划

> 一期（KNOWLEDGE §60，commit 495fa2be）已上线：云端备货码首激自动开通，初始密码固定 admin。
> 二期目标：买家在激活窗可直接设置登录密码；不设则由服务端生成随机初始密码（一次性下发），
> 首次登录强制改密。消除固定 admin 的抢登窗口，售后不再需要口头告知默认密码。

## 一、调研结论（Repository Research）

1. **激活弹窗 DOM 由 JS 动态构建**：`shared/auth-core/cloud.js` L4204 附近以 innerHTML 拼出
   「填码激活」弹窗（adminCodePhone/adminCodeIdentityFields 等），静态 HTML 中不存在这些元素。
   → **加密码输入框只改 JS，不碰任何 index.html 结构/CSS 文件，check-interface 基线保持 6 OK。**
2. **两条 claim 传输路径**：
   - 云网页/云 APP/鸿蒙 WebView：cloud.js L5071 直接 `fetch /api/license/claim`，body 现含
     code/machineId/user/clinicName/phone/productClass/clientClass，无 password。
   - 云/离线桌面 Electron：渲染进程走 `electronAPI.activate` → 主进程
     `electron/activate.js activateOnline(code,machineId,user,clinicName,phone,password,...)`
     —— **password 参数已存在**（两步订单流在用，且用于本地 installLicense 建本地账号），
     但 L101-113 组装云端 claim body 时**不带 password**；二期补一行透传即可。
3. **服务端密码处理已有成熟先例**：`order-submit.js` L176-184 明文经 HTTPS 收 `password`
   （8-32 位、须同时含字母和数字）→ PBKDF2 `hashPassword()` 落 passwordHash/salt，KV 不存明文；
   `ensureClinicUser`（admin-account.js L79-86）已优先消费 cred，无 cred 才回退 admin。
   → 二期复用同一套，不发明新加密/传输方案。
4. **mustChangePassword 全仓零实现**（已全量 grep 确认）；`sanitizeUser`（users.js L464-486）
   是登录/用户接口统一出字段处；`change-password` 端点已存在（users.js L2672+，校验旧密码、
   PBKDF2 改密、支持改名），二期在其成功路径上清 mustChangePassword 标记。
5. **auth-core 双源分发**：`tools/sync-auth-core.ps1` 管理
   `shared/auth-core/cloud.js`（8 个云端目标）与 `offline.js`（3 个离线路目标），
   sync-all 不再管 auth-core。热更渠道 `public/hot-update/desktop/cloud/` 已含 auth-core.js，
   **云桌面 auth-core 改动可热更**；electron 主进程目录不热更（KNOWLEDGE L1138-1142），
   `activate.js` 透传改动需随下次整包生效（但不阻断安全收益，见兼容矩阵）。

## 二、新旧客户端兼容矩阵（核心安全设计）

服务端按请求是否携带能力位 `pwdCap:'v2'` 分流，**旧客户端行为与一期完全一致**：

| 客户端 | claim 携带 | 服务端开通密码 | mustChangePassword | 客户体验 |
|---|---|---|---|---|
| 旧客户端（全部 5 端旧包） | 无 pwdCap | 固定 admin（一期行为） | 否 | 与现在完全相同，零回归 |
| 新客户端·客户设了密码 | pwdCap + password | 客户密码（PBKDF2） | 否 | 激活后直接用自设密码登录 |
| 新客户端·密码留空 | pwdCap | **随机初始密码**（10 位字母数字，CSPRNG） | **是** | 成功页一次性展示+复制按钮，首登强制改密 |

- 能力位只信「请求体带 pwdCap 且 versionLabel/端形态正常」；随机密码只在该分支生成，
  从根上杜绝「旧客户端不展示随机密码 → 客户锁死」。
- 随机初始密码随 validate 响应**只返回一次**（与 license 文件同信道同密级，HTTPS + CORS 白名单；
  不落 admin_req、不写日志、响应后服务端只存哈希）。
- 随机密码字符集沿用易读集 `abcdefghjkmnpqrstuvwxyz23456789`，强制含字母+数字。

## 三、改动文件与模块

### 服务端（functions，push 即部署）
- `functions/api/license/validate.js`
  - 解析 body.password / body.pwdCap；pwdCap 分支校验密码（复用 order-submit 的 8-32 字母数字规则，
    非法直接 400 中文提示）；通过则 `hashPassword`，把 cred 传入 commitTaobaoCloudAuto；
  - pwdCap 且无密码 → 通知 commit 生成随机密码；响应新增 `initialPassword`（仅当次、仅随机分支）
    与 `mustChangePassword`；不随 licenseInfo 之外的任何轮询/状态接口二次下发。
- `functions/api/license/_lib/admin-account.js`
  - `commitTaobaoCloudAuto`：入参加 passwordCred/needInitialPassword；随机密码生成器；
    buildRecord 带 passwordHash/passwordSalt/mustChangePassword；返回值带 initialPassword（仅一次）；
    自愈/半成态补开沿用记录里的哈希，随机密码不重置。
  - `ensureClinicUser`：用户行写入 `mustChangePassword`（仅随机分支 true）。
  - `attachLicenseToAutoRequest`：不写明文密码。
- `functions/api/users.js`
  - `sanitizeUser` 透传 `mustChangePassword: user.mustChangePassword === true`；
  - `change-password` 成功改密后把该用户行 mustChangePassword 删除/置 false；
  - 登录自愈 maybeProvisionFromActivation 透传 cred（一期已具雏形，随记录字段自然贯通）。
- `functions/api/license/admin-approve.js`：无行为改变（人工通道记录不带该标记），仅确认透传不报错。

### 客户端（auth-core 双源 + Electron 主进程）
- `shared/auth-core/cloud.js`（同步到 8 个云端目标）
  1. 填码激活弹窗内加「登录密码（选填）」password + 确认密码两个 input（innerHTML，
     内联样式沿用弹窗既有风格），提示「留空则系统生成随机初始密码，首次登录需修改」；
     实时校验与两步弹窗现有密码校验同口径（8-32 字母数字、两次一致）。
  2. claim body（L5071 fetch 与 Electron IPC 入参）增加 `pwdCap:'v2'` 及通过校验的 password。
  3. 成功分支：响应含 initialPassword 时，成功页用醒目块一次性展示初始密码 + 一键复制 +
     「请立即复制保存，关闭后无法再查看」；自设密码分支提示用自设密码登录。
  4. 登录成功处理：登录响应 user.mustChangePassword=true 时，阻断进入主界面，弹强制改密框
     （复用现有 change-password 调用，旧密码=初始密码），改密成功清标后放行；cancel 不放行。
- `shared/auth-core/offline.js`（同步到 3 个离线目标）：同构改动（离线端也可能激活云端码），
  与 cloud.js 的差异保持既有 Tier C 分叉基线口径，改动后更新 diff-cross-version 基线。
- `app_project/db-yunduan/cloud_desktop/electron/activate.js` 与
  `app_project/db-offline/desktop/electron/activate.js`：
  claim body 增加 `if (password) body.password = password;` 与 pwdCap 透传；
  主进程不打印密码日志。两个 8 副本同步目录由 sync 工具分发。
- 不改任何 index.html/login.html 静态文件，不改 CSS 文件。

### 范围外（请在审批时确认）
- **离线 APP（Java 激活链）**：APP 激活/注册走 Java 不经 WebView fetch（KNOWLEDGE §59 已确认），
  传密码需改 Java + 重签 APK。建议二期不纳入：离线 APP 客户买云端码属极少数，旧行为（admin）保留。
- **鸿蒙端**：rawfile 用 cloud.js（WebView fetch 同链），随 auth-core 同步即覆盖，无原生改动；
  但无真机验证条件，列入「同步覆盖+不专项验收」。
- pro 机构附号（第 2-5 台）开通仍走客服，不在本期。

## 四、实施步骤（依赖顺序）

1. 服务端 validate + admin-account：pwdCap 分流、cred 贯通、随机密码生成器、一次性响应。
2. users.js：sanitizeUser 出标记 + change-password 清标记。
3. 扩充 e2e/.tmp/taobao-cloud-auto-test.mjs：自设密码/随机密码/旧客户端无 pwdCap/
   mustChangePassword 落行与清除/随机密码不二次下发/弱密码 400 等用例，全绿。
4. cloud.js：密码框→claim body→成功页一次性密码块→登录强制改密闸。
5. offline.js 同构；两台桌面 activate.js 透传。
6. 运行 sync-auth-core.ps1 同步 11 目标 + sync-all VerifyOnly。
7. 全校验链：node --check、check-interface.bat（须 6 OK）、diff-cross-version（更新经确认的基线）、
   biz-smoke、双独立功能审查 + TRAE-security-review 安全二查（授权链流程）。
8. 白名单提交推送：functions 先行（CF 70s 部署，新旧客户端兼容立即生效）；
   auth-core 经热更渠道发布云桌面热包；activate.js 随下次桌面整包（云网页即时生效、
   云 APP 走 APP 热更工具链发布）。KNOWLEDGE §60 补二期小节。

## 五、验证（Validation）

- mockKV 服务端用例：三种客户端矩阵、随机密码强度/一次性、mustChangePassword 生命周期、
  弱密码 400、旧包回归（无 pwdCap 全程 admin）。
- 手工对拍：云网页（pages.dev 即时）走一遍自设密码与随机密码两条链，用真实手机号验证
  登录/强制改密/改密后标记清除（测试 KV 用测试码，验完清理）。
- 桌面端在热包发布后用 e2e 探针验证 claim body 含字段、成功页展示。
- 全量校验链绿灯 + 双审 + 安全二查。

## 六、风险与处置

| 风险 | 处置 |
|---|---|
| 旧客户端收到随机密码却不会展示 → 锁死登录 | pwdCap 能力位硬分流，旧包永远走 admin 分支 |
| 随机密码传输/留存泄露 | 仅 HTTPS 响应一次、不落 KV 明文/不进日志/不进轮询接口；KV 只存 PBKDF2 |
| 强制改密被篡改客户端绕过 | 一阶段客户端拦截（与现有客户端闸门同水位）；篡改自己客户端风险自担。**可选加固（审批决定）**：服务端对 mustChangePassword 用户的写处方等写接口返回 403 MUST_CHANGE_PASSWORD，只读放行 |
| 随机密码客户没记住 | 激活成功页强提示+复制按钮；客服后台已有「重置密码」能力可兜底（重置后仍带 mustChangePassword） |
| auth-core 热包遮蔽整包旧坑（KNOWLEDGE L1154） | 触达热更白名单即按热包流程同步重签发布，不夹带未发布整包版本 |
| 离线 APP/鸿蒙覆盖不全 | 明确范围外/仅同步不专项验收，话术不向该渠道宣传自设密码 |

## 七、待确认事项

1. 离线 APP（Java）确认本期不做？（建议：不做）
2. 服务端「强制改密期间写接口硬闸 403」是否本期就做？（建议：做，只加 1 个写处方/保存类总闸，
   工作量小、把客户端绕过风险一并关掉）
3. 发布节奏：服务端+云网页先上，桌面整包/APK 热包紧随——还是集齐一起发？
