# 离线版激活付费链路重构 - 实施计划

> 依赖顺序：T1（服务端订单接口）→ T2（官网订单号恢复页）→ T3（Java/桌面桥能力）→ T4（弹窗状态机重构）→ T5（装码路径收敛）→ T6（桌面桥补齐）→ T7（同步门禁打包）→ T8（全流程实测）。
> 界面保护：所有弹窗 DOM 变更仅限 auth-core JS 动态生成部分；受保护 HTML/CSS 一律不动。

## Task 1: 服务端 order-submit/order-status 开放客户端直调 + 订单幂等
- **Status**: `pending`
- **Priority**: high
- **Depends On**: None
- **Description**:
  - `functions/api/license/order-submit.js`：CORS 回退对齐 admin-submit/admin-status——Origin 为 null（file:// WebView）时放行 `'null'`（ALLOWED_ORIGINS 增加 null 回退逻辑，保持 pages.dev 为浏览器默认）。
  - 同文件增加建单幂等：校验通过后、生成新记录前，按 machineId（+phone 一致）扫描最近 admin_req 记录（复用 findPaidOrderForPhoneOrMachine 同类扫描），若存在 status ∈ {pending_payment, pending} 的订单记录，直接返回 `{success:true, orderNo, requestId, status, idempotent:true}`，不新建。
  - `functions/api/license/order-status.js`：CORS 同步放行 null（APP 直查备用）。
  - 不删 admin-submit、不改旧 cn/n 官网回填（FR-10 兼容）。
- **Acceptance Criteria Addressed**: AC-1, AC-3, AC-13
- **Test Requirements**:
  - `rule` TR-1.1: 用 curl/fetch 模拟 `Origin: null` POST order-submit（合法 body）返回 200 且响应头 `Access-Control-Allow-Origin: null`；证据：命令输出。
  - `rule` TR-1.2: 同 machineId+phone 连续 2 次提交返回同一 requestId/orderNo 且 KV admin_req_index 条数不增加；证据：两次响应对比 + wrangler kv get admin_req_index。
  - `rule` TR-1.3: 已激活（activated）订单存在时再次提交不被幂等拦截（允许新下单走原有支付前置校验逻辑）；证据：代码审查 + 测试记录状态分支。
  - `rule` TR-1.4: 浏览器（pages.dev Origin）与旧官网链路行为不变；证据：代码审查仅新增 null 分支与幂等分支。

## Task 2: 官网 download.html 支持 ?orderNo= 恢复模式
- **Status**: `pending`
- **Priority**: high
- **Depends On**: T1
- **Description**:
  - `public/download.html` 与 `site-official/download.html` 两副本同步：
    - 页面加载检测 URL `orderNo`（或 `o`）参数：存在则进入"订单恢复模式"——调 order-status 拉取订单，直接 goStep 到付款步骤（Step3 二维码/金额/订单信息只读展示：诊所名、医师名、手机号、版本、金额），隐藏/跳过 Step1/Step2 表单；启动既有轮询；activated 时展示激活码/成功态；rejected 展示原因。
    - 恢复模式下不读取 cn/n/p 回填、不自动 submitOrder（订单已存在）；"我已付款"按钮（order-paid）保持可用。
    - 拉取失败（订单不存在/网络错）：显示"订单不存在或已失效"+ 返回首页（正常购买入口）按钮。
  - 无 orderNo 参数时行为完全不变（旧 cn/n 回填+自动提交保留）。
- **Acceptance Criteria Addressed**: AC-4, AC-13
- **Test Requirements**:
  - `rule` TR-2.1: 浏览器打开 `download.html?orderNo=<真实待付款订单>` 直接显示付款二维码步骤，无任何可编辑客户信息输入框；证据：截图。
  - `rule` TR-2.2: 恢复页轮询到 activated 后显示成功/激活码；证据：后台激活后页面截图。
  - `rule` TR-2.3: 不存在的 orderNo 显示失效提示且可返回正常购买流程；证据：截图。
  - `rule` TR-2.4: 无参数旧链接（含 cn/n/p）行为与重构前一致；证据：代码审查 + 手动验证。
  - `rule` TR-2.5: public 与 site-official 两副本该段代码一致（diff 仅无关行）；证据：文件对比。

## Task 3: APP Java 桥暴露单一装码入口 + 流程状态持久化
- **Status**: `pending`
- **Priority**: high
- **Depends On**: None
- **Description**:
  - `LicenseManager.java`：
    - 新增 `@JavascriptInterface installLicenseFromServer(String machineIdJson)`（或复用 MainActivity 桥注册风格）：内部复用 `syncLicenseFromServer` 内核（凭 machineId 查 admin-status → activated 则 installAdminLicense 落盘），返回 `{success, status, error?}` JSON 字符串供 JS 同步/异步获取；装码全程持 sInstallLock。
    - 新增 flowState 持久化：`setActivationFlowState(json)` / `getActivationFlowState()`，写入 filesDir config.json 的独立字段（如 `activationFlow: {orderNo, requestId, status, edition, updatedAt}`），不参与 configSignature 签名内容（避免签名失配——签名内容维持 clinicName|doctorName|edition|configIssuedAt）。
    - 冷启动 `syncLicenseFromServer` 保留为兜底（注册门控不放松）。
  - MainActivity 桥注册新方法（与既有 activate.* 同风格）。
- **Acceptance Criteria Addressed**: AC-5, AC-6, AC-7
- **Test Requirements**:
  - `rule` TR-3.1: Java 编译通过（gradle assembleRelease 成功）；证据：打包日志。
  - `rule` TR-3.2: JS 调 `electronAPI.activate.installLicenseFromServer(machineId)` 在服务端已激活时返回 success:true 且 license.dat 落盘；未激活时返回 status:pending 类结果且不报错；证据：logcat + 代码审查。
  - `rule` TR-3.3: set/getActivationFlowState 写入 config.json 后 verifyConfigIntegrity 仍通过（新字段不进签名）；证据：代码审查 + 激活后启动无完整性告警 logcat。
  - `rule` TR-3.4: 并发调用 installLicenseFromServer 不产生双写（sInstallLock 串行）；证据：代码审查。

## Task 4: auth-core 激活弹窗状态机重构（直建订单 + 状态驱动 + 桥数据源）
- **Status**: `pending`
- **Priority**: high
- **Depends On**: T1, T3
- **Description**:
  - `shared/auth-core/offline.js` 弹窗重构（DOM 仍 JS 生成，不动受保护 HTML）：
    - **开弹窗即查态**：openAdminActivate 后异步调 admin-status（machineId 模式，桥 checkAdminStatus 优先/fetch 兜底）：activated→装码成功步；pending_payment→付款步；pending→等待步；无记录→版本选择步。首屏显示加载态，查询不阻塞弹窗打开。
    - **版本选择 → 直建订单**：选版本后直接 POST order-submit（ORDER_SUBMIT_URL 新增常量）；body：orderNo=客户端生成（BNZC-DZ-yyyyMMddHHmm-XXXX 规则同官网）、productKey='local'、edition、price 按版本文本、clinicName=桥/注册诊所名、adminName=桥/注册医师名、phone=注册手机号、machineId、dp、note='客户端直建订单'。成功（含幂等 idempotent）→ 付款步；失败→内联错误+重试。
    - **付款步**：主按钮"去官网付款"跳转 `download.html?orderNo=<orderNo>&ed=<...>&dp=<...>`（**仅 orderNo/ed/dp，不传 cn/n/p/r**）；同屏启动既有 observer 轮询（admin-status machineId 兜底）。
    - **等待步**：轮询进度文案；activated→调桥装码（T5）；rejected→拒绝步（可回版本选择重新下单）。
    - **数据源切换**：注册资料/流程状态一律优先读桥（getActivationUsers + config.clinicName/doctorName + getActivationFlowState），localStorage registrationInfo/adminReqPending 降为缓存（读到则用、读不到静默走桥）；移除"localStorage 缺失即落表单页"的单点逻辑。
    - **失败 UX**：所有网络/服务端错误在当前步骤内联红条 + 重试按钮；删除 showFormAndAlert 回退 adminStepPwd/adminStepForm 的路径（表单步仅次级入口/手动下单场景保留可达）。
    - **次级入口**：弹窗底部小字链接"已有激活码？激活码激活 / 联系客服（工单申请）"，点击展开原 Tab 功能（DOM 复用既有表单，默认折叠）。
    - 旧 admin-submit 调用链保留不删（旧包/桌面兼容路径），新流程不再走它。
- **Acceptance Criteria Addressed**: AC-1, AC-2, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11
- **Test Requirements**:
  - `rule` TR-4.1: node --check 通过；证据：命令输出。
  - `rule` TR-4.2: 删数据全新注册→选版本后无任何填写表单直接出现付款步（点击 ≤2）；证据：实测录屏。
  - `rule` TR-4.3: 建单请求 body 中 clinicName/adminName 为分离的注册值（抓包/日志），KV 记录无 " / "；证据：服务端日志 + KV 记录。
  - `rule` TR-4.4: 跳转官网 URL 仅含 orderNo/ed/dp 参数（无 cn/n/p）；证据：代码审查 + 实测 URL。
  - `rule` TR-4.5: 杀进程重进弹窗直接恢复付款/等待步且不重建订单；证据：实测。
  - `rule` TR-4.6: 清 localStorage 后流程不断（桥数据源生效）；证据：实测。
  - `rule` TR-4.7: 飞行模式下建单/轮询显示内联错误+重试，恢复后成功；全程无密码表单；证据：实测。
  - `rule` TR-4.8: 底部次级链接可展开激活码表单与工单表单并成功使用；证据：实测。
  - `rubric` TR-4.9: 流程顺畅度；scale 1-5；anchors 同 AC-10；threshold >= 4；证据：完整录屏评分。

## Task 5: 装码路径收敛为桥单一入口
- **Status**: `pending`
- **Priority**: high
- **Depends On**: T3, T4
- **Description**:
  - offline.js 中所有"检测到 activated → 装码"的位置（observer onActivated、_resumeCompleteActivation、healMissingDesktopLicenseFile、admin-submit 立即领码分支）统一改为：调用 `electronAPI.activate.installLicenseFromServer(machineId)`（桌面 preload 等价方法），按返回结果呈现成功/失败重试；JS 不再自行 fetch licenseBase64 并调 submit 写盘。
  - healMissingDesktopLicenseFile（JS 自愈）保留注册门控与触发时机，但内部装码动作改调桥；冷启动 Java 原生自愈为唯一兜底装码者。
  - 桌面 preload 若无对应方法，走 T6 补齐；过渡期桌面可保留原 submit 装码但包一层统一入口函数。
- **Acceptance Criteria Addressed**: AC-5, AC-11
- **Test Requirements**:
  - `rule` TR-5.1: 全局检索 offline.js 装码调用点均经统一桥入口（无散落 fetch license→submit 写盘）；证据：grep 清单 + 代码审查。
  - `rule` TR-5.2: APP logcat 一次激活周期内 license 安装仅桥路径一次（无并发写警告/重复安装日志）；证据：logcat。
  - `rule` TR-5.3: 桥装码失败时弹窗内联提示+可重试，不静默；证据：断网模拟实测。

## Task 6: 桌面 Electron preload 等价桥能力 + 桌面流程验证
- **Status**: `pending`
- **Priority**: medium
- **Depends On**: T3, T4, T5
- **Description**:
  - 检查 `app_project/db-offline/desktop/electron/` preload/license 模块：补齐 installLicenseFromServer（可复用主进程 checkAdminStatus+submit 链路封装）与 activationFlow 状态读写（落桌面 config）。
  - 桌面 auth-core 副本同步后走同一状态机；验证 dp=desktop 标识正确。
- **Acceptance Criteria Addressed**: AC-9(桌面), AC-12
- **Test Requirements**:
  - `rule` TR-6.1: preload 暴露 installLicenseFromServer / setActivationFlowState / getActivationFlowState（或等价），JS 可调；证据：preload 代码审查。
  - `rule` TR-6.2: 桌面打包（build.bat）成功；证据：打包输出。
  - `rule` TR-6.3: 桌面实测选版本→直建订单→官网付款→后台激活→自动装码成功；证据：桌面实测记录。

## Task 7: 多端同步、门禁与打包
- **Status**: `pending`
- **Priority**: high
- **Depends On**: T4, T5, T6
- **Description**:
  - 运行 sync-auth-core.ps1（11 副本）+ grep 关键新字符串验证落盘；sync-all.ps1 -VerifyOnly 全绿；check-interface.bat 6 OK；node --check 权威源与副本。
  - 服务端改动随 push 由 Pages 自动部署（functions/）。
  - APP 严格模式打包（build-pack.bat app-strict），APK 输出 db-offline 根；解包验证新代码字符串在 assets。
  - 桌面打包（desktop-strict）。
  - KNOWLEDGE.md 沉淀条目十九（新架构决策+链路图+教训）。
- **Acceptance Criteria Addressed**: AC-13, AC-12
- **Test Requirements**:
  - `rule` TR-7.1: sync-all -VerifyOnly 全一致、check-interface 6 OK；证据：命令输出。
  - `rule` TR-7.2: APK 解包 auth-core.js 含 order-submit 直建订单与桥装码新字符串；证据：解包 grep。
  - `rule` TR-7.3: 桌面安装包构建成功；证据：构建输出。

## Task 8: 全流程实测回归 + 测试数据治理
- **Status**: `pending`
- **Priority**: high
- **Depends On**: T7
- **Description**:
  - 测试机（白名单 machineId 5784b5da...）删数据→注册（诊所名/医师名分离值）→选版本→验证零表单到付款步→官网 orderNo 恢复页扫码模拟付款→后台核对激活→验证 ≤60s 自动装码→重启 APP 验证已激活状态 + 注册手机号登入。
  - 幂等验证：待付款状态杀进程重进、重复点版本，确认不产生重复订单。
  - 次级入口验证：激活码激活、工单各一次。
  - 实测后清理本轮测试 KV 数据（备份→删 admin_req/phone 索引/order 映射→索引重建），保留测试机白名单。
  - 旧链路兼容验证：旧 cn/n URL 在官网仍回填。
- **Acceptance Criteria Addressed**: AC-1~AC-13 全量收尾
- **Test Requirements**:
  - `rule` TR-8.1: 端到端录屏：零表单→付款→自动激活→登入成功；证据：录屏/记录。
  - `rule` TR-8.2: KV 订单字段无拼接、无重复订单；证据：wrangler 查询记录。
  - `rule` TR-8.3: 激活后 APP 界面诊所名/医师名分别正确；证据：截图。
  - `rule` TR-8.4: 测试数据清理后 admin_req_index 恢复且备份留存 logs/；证据：清理脚本输出。
  - `rubric` TR-8.5: 对照 AC-10/AC-11 终评 ≥4；证据：评审记录。
