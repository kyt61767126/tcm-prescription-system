# 激活方案全端优化（简洁·高效·安全·稳定）实施计划

> 2026-10-15 ｜状态：待审批 ｜性质：授权链改动，执行时走 license-chain-release 流水线（双审+安全二查+校验链）

## 一、调研结论（现状诊断，均有代码实据）

### 1. 已有的「一键激活」捷径只通了一半（本次最大发现）
- **后台已具备生成器**：[public/admin/index.html](file:///d:/trae_projects/kyt-zy/public/admin/index.html#L5644-L5696) 纯前端拼 `bnzc://activate?code=…&clinic=…&user=…` + 二维码，文案写明"微信/短信发客户，点击自动激活，无需手输码"。
- **桌面双端完整实现**：云/离线 Electron 已注册协议（setAsDefaultProtocolClient + 冷启动 argv + second-instance/open-url + 登录窗时序门闩 + `bnzc:auto-activate` IPC），2026-10-02 还做过启动性能与调试门控优化（main.js L67-215）。
- **安卓双端完全没接通**：[离线 App AndroidManifest](file:///d:/trae_projects/kyt-zy/app_project/db-offline/app/app/src/main/AndroidManifest.xml#L29-L32) 与云 App manifest 均**只有 LAUNCHER intent-filter，未注册 bnzc scheme**；MainActivity 无 getIntent/onNewIntent 深链处理。→ **红米等安卓客户收到客服发的"一键激活链接"点击毫无反应**，仍得手抄 20 位码（这正是需要 4 张教程卡的原因）。
- 链接是**裸激活码**：无签名、无时效、非一次性，转发即可能在他人设备消耗（激活绑设备+码锁端兜底，但机构码 maxDevices>1 时有实际风险）。

### 2. 客户当前路径偏长（以红米淘宝/官网单为例）
复制 BNZC-XXXX-… 长码 → 打开 App → 找激活入口/选 Tab → 粘贴码 → 填手机号/诊所名/密码 → 等审核或 claim → 重启。官网购买本身还有 4 步（选版本→填信息→扫码→等审核领码，download.html Step1-4）。

### 3. 两个已在案的遗留口子
- **云端账号初始密码固定 admin**：备货码"填码即开通"一期权宜（KNOWLEDGE §1843 二期遗留：随机初始密码 + mustChangePassword 未做）。
- 激活成功后建号在三端各走一套（离线 Java Single-Writer syncCreateActivationUser / 云端 provisionCloudAccount），链接激活路径未串联建号信息。

### 4. 不动的部分（明确边界，避免高风险重构）
- 服务端 35+ 个 license 端点虽多，但每个都对应历史事故收敛（唯一写服务 license-write-service、端锁定防套利、P0 账户接管铁律等），**不合并、不重写**。
- 不改"人工审核把关发码"（AUTO 只匹配不通过是铁律）；不改两套授权模型（机器码 license / 云端订阅）；不改价格与端锁定。
- 免费试用、心跳降写、KV 日限治理、Observer 轮询、FSM v2 等已完成优化不重复动。

## 二、优化目标与方案（分阶段，可按预算勾选）

### 阶段 P0｜一键激活全端打通 + 链接安全化（简洁+安全，最高杠杆）
**客户最终路径：客服微信发 1 条链接 → 客户手机点开 → 确认页 → 自动激活/建号 → 设密码进系统。全程零手输码。**

1. **https 短链落地页（通吃五端+未安装+微信内不拦截）**
   - 新增 `public/activate.html?token=…`（静态页，Pages 部署即达）：展示"即将激活：版本/诊所/有效期"确认信息 → 已安装则跳 `bnzc://activate?t=<token>`，未安装则按端显示下载按钮；微信内置浏览器引导"…在浏览器打开"。
   - 客服发的是 https 链接（微信不拦、谁都能开），不再直接发自定义 scheme。
2. **服务端一次性激活令牌（替代裸码入链接）**
   - 新增 `functions/api/license/activation-token.js`：仅管理员鉴权调用，入参 code（+可选手机号/诊所名/建号信息）→ Ed25519/HMAC 签名短令牌，载荷=码指纹+端类型+签发时间（24h 有效）+一次性；兑换端点 `redeem` 匿名可调（凭令牌），返回 claim 所需信息后立即标记作废；客服侧可作废旧令牌。
   - **旧裸码 bnzc 链接继续兼容**（桌面已发给客户的链接不得失效）：App/桌面解析时 `code=` 走原路、`t=` 走令牌兑换。
3. **Android 双 App 注册协议+深链接处理（参照桌面成熟实现）**
   - manifest 加 `<intent-filter><data android:scheme="bnzc"/></intent-filter>`；MainActivity 处理冷启动 `getIntent()` 与运行时 `onNewIntent`（singleTask 已具备），解析参数后透传给 JS 已有的 `showBnzcActivationNotice`（index-app L6879 已存在，桌面/login.js L997 有完整 UI 参照）。
   - 加与桌面 `bnzc-debug.log` 同级的诊断日志（红米"点了没反应"可远程取证）。
4. **鸿蒙端**对齐注册（若当前仍在维护；rawfile/index.html 已有 bnzc 字样，仅缺 Ability 侧注册）。

### 阶段 P1｜激活即建号、消灭固定 admin（安全+简洁）
5. 令牌/claim 携带手机号：云端版 claim 成功即 `provisionCloudAccount`（函数已存在，淘宝三期链路复用），**初始密码改为服务端随机 8 位 + mustChangePassword=true**，首登强制改密；落地页/激活成功页只展示一次随机密码并提示客服话术（不再固定 admin/admin）。
6. 离线版链接激活成功后经 Java `syncCreateActivationUser`（Single-Writer 铁律 §7.6）自动建本机账号，客户无需在激活窗再填一遍注册信息。
7. 今天上线的改名修复（formerUsernames 别名/twin 密码双闸）天然为"手机号→自定义英文名"兜底，无需额外动。

### 阶段 P2｜客服运营提效（高效）
8. 后台审核通过/发码成功动作旁加【发客户】按钮：一键复制"https 短链+激活码+初始密码+话术"并出二维码，免进独立生成器页面。
9. 各端激活窗首帧检测待处理令牌/链接时直达确认态，减少 Tab 切换；失败文案统一（过期/已用/端不符三类明确提示）。
10. 官网 download.html Step4"等领码"完成后，已在手机上的客户直接展示"点此激活本设备"按钮（同令牌链路），省掉"回 App 输码"。

## 三、涉及文件与模块

**服务端（push 即达，五端零重打包）**
- 新增 `functions/api/license/activation-token.js`（签发/兑换/作废，频控+审计，写操作走 license-write-service 同层规范）
- `public/activate.html` 新增落地页（两份镜像约定按 download.html 执行）
- `public/admin/index.html` + `site-admin/admin/index.html`：生成器改调令牌端点+【发客户】按钮
- 复用：validate.js/claim.js 兑换后链路、admin-account.js provisionCloudAccount、_lib 签名能力

**安卓（Java/manifest，必须重打双 APK，热更不可达）**
- 离线：`app_project/db-offline/app/app/src/main/AndroidManifest.xml`、`MainActivity.java`
- 云端：`app_project/db-yunduan/cloud_app/` 对应两文件
- JS 侧复用现有 showBnzcActivationNotice / bnzcAutoActivate（5+1 副本经 sync-index-app / sync-all 分发，不手改产物）

**桌面/Electron**：协议链路已完整，仅在 login.js/index.html 解析处兼容 `t=` 令牌参数（随热更，无需重打 exe；旧版对裸码链接行为不变）

**鸿蒙**（如在维护）：Ability 注册 + rawfile 对齐

## 四、依赖顺序
1. 服务端令牌端点 + 落地页（可独立上线、独立验证；裸码链路并存零影响）
2. 桌面/JS 层令牌参数兼容（热更先行，为安卓发布铺路）
3. 安卓双端 manifest+Java 深链接 → 重打双 APK → 真机验收
4. P1 随机密码+mustChangePassword + 激活即建号（服务端为主，随 1 同批或紧随）
5. P2 后台/官网触点收口
6. 全链真机回归 + KNOWLEDGE/HANDOFF 沉淀

## 五、验证
- 服务端：node vm 单测覆盖令牌签发/兑换一次性/过期/端不符/旧裸码兼容/频控；双独立功能审查+安全二查（重点：令牌伪造、重放、匿名兑换端点是否构成绕过发码、账户接管 P0 铁律）。
- 安卓：真机矩阵（红米/MIUI、华为、荣耀各一台）冷启动点链接、运行中点链接、未安装跳转、微信内打开、过期/已用链接提示；验证激活后 license 自验三层防线不回退。
- 回归：check-interface 6 OK、sync-all/sync-auth-core VerifyOnly、pre-push 十七道门、既有 owner/license 测试全绿。
- 桌面：裸码旧链接与新令牌链接双路径各验一次。

## 六、风险与处理
- **令牌端点变"匿名发码通道"**：兑换不发码只换 claim 上下文，码仍只在 validate/claim 设备绑定处消耗；令牌一次性+24h+码指纹，复用既有频控桶惯例（IP 后缀）；安全二查必查项。
- **重打 APK 周期**：Java 改动无法热更；可先上线 1/2/4（服务端+桌面热更）立刻改善桌面与官网客群，安卓随下一版 APK 发布，不强制同日。
- **微信拦截**：用 https 落地页而非裸 scheme 规避；落地页跳 scheme 失败有"复制链接去浏览器"兜底。
- **旧链接兼容**：code/t 双参数并存，裸码永不拒；后台生成器切换后老二维码仍可用至码被消耗。
- **机构码转发**：一次性令牌激活即废；未激活前 24h 短窗+客服可作废；落地页展示诊所名让客户自检。

## 七、需拍板的两个决策点
1. **执行范围**：仅 P0（一键激活全端+令牌，推荐先做）／P0+P1（加随机密码建号）／P0-P2 全做。
2. **令牌载荷是否含建号信息**（手机号/初始密码）：含=客户零手输但客服要先收手机号；不含=最短上线，客户激活后自己注册建号（现状水平）。
