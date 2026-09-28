# 云端安卓 APP 指纹快速登录 实施计划

## 一、需求与范围（已与用户确认）

- **仅云端安卓 APP**（applicationId `com.tcm.prescription`，Capacitor 壳，当前 versionCode 307）。
- 云端桌面（Windows Hello）、云端网页（WebAuthn）**本期不做**。
- 安全口径与离线版**完全一致**：指纹只解密原密码 → 回填后走原始云端登录链（`AuthCore.loginWithUsernamePassword`，本地表 + 云端 `/users?login=true` 权威认证），**不新增任何放行路径、不写登录态**。
- 权威方法论全部复用 KNOWLEDGE.md 第 47 章（权限 C1 / 时序 C2 / 错误码 H1-M1 / 异常分类 / enroll 复用密钥 / M3 精确文案 / probe 重探 / 遮罩收口 / versionCode 基线坑）。

## 二、仓库调研结论

1. **云端 APP 架构**：[MainActivity.java](file:///d:/trae_projects/kyt-zy/app_project/db-yunduan/cloud_app/app/src/main/java/com/tcm/prescription/MainActivity.java) `extends BridgeActivity`（Capacitor），但同样在 WebView 上挂了自研桥 `window.AndroidNative.invoke(name,json)`（[L539](file:///d:/trae_projects/kyt-zy/app_project/db-yunduan/cloud_app/app/src/main/java/com/tcm/prescription/MainActivity.java#L539)、内部类 NativeBridge [L1598](file:///d:/trae_projects/kyt-zy/app_project/db-yunduan/cloud_app/app/src/main/java/com/tcm/prescription/MainActivity.java#L1598)），switch 分发 + `isSensitiveOperation` + `isCallerAllowed` 形态与离线版同构。
2. **页面是在线页**：APP 启动 `webView.loadUrl(CLOUD_URL + "?_v=时间戳")`（[L378](file:///d:/trae_projects/kyt-zy/app_project/db-yunduan/cloud_app/app/src/main/java/com/tcm/prescription/MainActivity.java#L378)），host=`tcm-prescription-system.pages.dev`。JS 改完随 Pages 部署即对所有云端 APP 生效（无本地热包机制）；**指纹 Java 桥必须发新 APK**。老 vc307 调 biometric* 返回 `unknown method` → JS 确定性 legacy no-op。
3. **登录链 DOM/文案与离线一致**：云端 [index.html handleLogin](file:///d:/trae_projects/kyt-zy/app_project/db-yunduan/cloud_app/app/src/main/assets/public/index.html#L3003) 用全局 `async function handleLogin()`、输入框 `loginUsername/loginPassword`、错误元素 `loginError`、容器 `.login-box`、成功判据 `loginOverlay.style.display='none'`；失败兜底文案同为「手机号/用户名或密码错误」（[cloud.js L1275/L1281](file:///d:/trae_projects/kyt-zy/shared/auth-core/cloud.js#L1275)）。→ 离线指纹 JS 模块可原样移植。
4. **cloud.js 同步 8 目标**：public（网页）、public/electron、云桌面×2、云端 APP assets、site-admin、shared 根镜像、**鸿蒙 rawfile**。模块平台双闸门（UA 含 Android + `AndroidNative.invoke` 存在）保证网页/桌面/鸿蒙/老 APP 全部 no-op：鸿蒙桥名不同且 UA 不含 Android；手机浏览器无桥。
5. **现存同款线程缺陷（必须随修）**：云端 [isCallerAllowed L1112](file:///d:/trae_projects/kyt-zy/app_project/db-yunduan/cloud_app/app/src/main/java/com/tcm/prescription/MainActivity.java#L1112) 在 JavaBridge 后台线程调 `webView.getUrl()`，华为新内核同样会静默吞异常→误拒（线上 deleteFile/readFileAsBase64 在华为机已受影响）。照离线版改 volatile URL 快照。
6. minSdk 24、compileSdk 36；androidx.biometric:1.1.0 要求 minSdk23 + FragmentActivity（BridgeActivity 链满足）。release 开 R8 混淆。
7. 云端无 verifyLoginGate 门裁决（账号删除/停用由云端服务端登录响应直接拒绝），故离线版 `purgeBiometricCredential` 门出口挂接点不存在；改密自清走 M3 文案检测；账号级删除文案需在实现时从 `login()`/服务端响应确认实际串后决定是否追加精确匹配（默认只保留密码错误精确串，方向 fail-safe：宁残留可见但必失败的入口，不误删）。
8. 与离线 APP applicationId 不同可同机并存；AndroidKeyStore 按 UID 隔离、files 沙箱隔离，别名/盐沿用 `hk-biometric-v1` 不冲突。

## 三、改动文件清单

### Java（云端 APP，4 改 + 1 新增）
1. **新增** `app_project/db-yunduan/cloud_app/app/src/main/java/com/tcm/prescription/BiometricUnlockManager.java`
   - 从离线版整文件复制，仅改 `package com.tcm.prescription;`（类内无其他 benneng 耦合）；HASH_SALT/密文格式/六动作/异常四档分类全部保留。
2. `app_project/db-yunduan/cloud_app/app/src/main/java/com/tcm/prescription/MainActivity.java`
   - NativeBridge.invoke switch 增加 6 case：biometricProbe/Status/List/Enroll/Unlock/Delete（照离线 [L2076-2092](file:///d:/trae_projects/kyt-zy/app_project/db-offline/app/app/src/main/java/com/benneng/pres/MainActivity.java#L2076) 写法）。
   - `isSensitiveOperation` 增加 `name.startsWith("biometric")`。
   - URL 快照三件套：新增 `private volatile String lastWebViewUrl`；WebViewClient onPageStarted/onPageFinished（[L578/L610](file:///d:/trae_projects/kyt-zy/app_project/db-yunduan/cloud_app/app/src/main/java/com/tcm/prescription/MainActivity.java#L578)）主线程写（null 不写）；`isCallerAllowed` 改为读快照 + `isCloudUrl`；onDestroy（L1568）置 null。
3. `cloud_app/app/build.gradle`：加 `implementation 'androidx.biometric:biometric:1.1.0'`；versionCode **307→308**（assets 内容变更，完整性/版本基线需要）。
4. `cloud_app/app/src/main/AndroidManifest.xml`：加 USE_BIOMETRIC、USE_FINGERPRINT(maxSdkVersion=28)、uses-feature fingerprint required=false（现有权限全保留）。
5. `cloud_app/app/proguard-rules.pro`：照离线加 `-keep class com.tcm.prescription.BiometricUnlockManager { *; }` 与 `-keep class androidx.biometric.** { *; }`。

### JS（1 权威源 + 8 同步副本）
6. `shared/auth-core/cloud.js`：
   - 新增 `androidNativeBridgeReady()`（与 offline.js 逐字一致）。
   - 新增 `installBiometricUnlock()`（移植 offline.js L2552-2825 全函数：bridge/setup 三态/ensureRow/refresh/遮罩 arm-close 看门狗/doUnlock/doDisable/offerEnroll/wrap/bindInput/visibility+轮询重探）；M3 自删精确串沿用「手机号/用户名或密码错误」。
   - 在主 IIFE 内 `global.AuthCore = {...}` 导出**之后、IIFE 结束之前**调用 `installBiometricUnlock();`（离线 L3038 同位置；跨 IIFE 不可见的坑已记录）。
7. 跑 `tools/sync-auth-core.ps1` 分发 8 目标（含云端 APP assets、鸿蒙 rawfile）。

### 测试
8. 指纹冒烟云端化：复用 `tools/biometric-smoke.cjs` 思路新增/参数化一套用例，harness 加载**云端分发产物**（cloud_app assets/public/auth-core.js），至少覆盖：legacy no-op / 入口可见 / 解锁回填走 handleLogin / invalidated 自清 / lockout 不删 / cancel 静默 / probe wait 重探 / 无桥环境 no-op。

### 不改
- 任何 index.html 静态 DOM/CSS（UI 全部运行时注入）；云端桌面、网页、鸿蒙代码零改动。

## 四、实施步骤（依赖序）

1. Java：复制 BiometricUnlockManager 改 package → MainActivity 接线 6 case + 敏感清单 + URL 快照 → Manifest 权限 → build.gradle 依赖与 vc308 → proguard keep。
2. JS：cloud.js 加平台闸门 + 指纹模块 + 引导调用 → `node --check`。
3. sync-auth-core 同步 8 副本；sync-all（Sync 后 VerifyOnly 必须全绿）；check-interface.bat 必须 6 OK。
4. 云端指纹 smoke 编写并跑通；必要时回归现有门金（biz/runtime）。
5. `gradlew :app:assembleDebug` 与 `assembleRelease`（cwd=cloud_app/app）；解包 release APK 验 assets/public/auth-core.js 含指纹标记、dex 不验方法名改验资源/字符串。
6. **双独立功能审查 + 安全审查**（3 个子代理互不通气，范围=未提交 diff；聚焦 fail-closed、8 副本 no-op 面、在线登录链包装、Capacitor 生命周期、R8 keep、URL 快照）。
7. 华为 P40 真机验收（com.tcm.prescription 与离线版可并存）：
   - 需要一个可用的**云端账号**（请用户提供/确认测试账号）；
   - 云端密码登录成功 → 弹开通引导 → 系统指纹 enroll；
   - 杀进程重进 → 选中账号 → 指纹解锁（遮罩登录层一隐藏即收）→ 云端主界面；
   - 关闭指纹链接生效；系统新增一枚指纹 → 解锁报 invalidated、入口自清；
   - 老 vc307 兼容性静态确认（unknown method no-op，无需真机降级）。
8. 发布：
   - JS：cloud.js 随 `public/` push → Cloudflare Pages 部署，线上拉取核验（网页/桌面/鸿蒙无桥 no-op）；
   - Java：release vc308 APK 走「一键发布.bat」（智能发布/指定发布云端 APP），同步 hash-manifest 的 cloud.apk（version V1.0.0.308、sha256、url）——按 HARD 规则上传动作需用户在发布菜单确认或明确指示；
   - KNOWLEDGE 第 47 章追加云端移植条目（含云端在线页无热更/8 副本 no-op/华为线程同修），提交推送（pre-push 十三道校验）。

## 五、依赖与注意

- cloud.js 一处改动八端分发，**no-op 论证是审查重点**（浏览器、云桌面、site-admin、鸿蒙）。
- 云端每次启动强制清登录态（index.html L1919 起），指纹解锁正是该痛点的补偿；指纹解锁仍需联网走云端认证。
- Capacitor WebView 的 addJavascriptInterface 时机在 loadUrl 前（L539 先于 L378 区域的 loadUrl），满足 C2 早注入前提。
- proguard release 必加 keep，否则 BiometricUnlockManager/回调被 R8 裁剪。
- APK308 与线上 JS 配套：装新 APK 前若 Pages 已部署新 JS，老 APP 探到 unknown method 静默 no-op，安全；反之新 APK + 旧 JS 则入口不出现，无副作用。

## 六、风险与处置

| 风险 | 处置 |
|---|---|
| 8 副本中某端误显示指纹入口 | 双闸门（UA+桥）+ smoke 无桥用例；审查逐副本确认 |
| 云端账号删除后指纹入口残留 | 实现时核实服务端删除/停用文案，仅在能拿到确定失效精确串时追加自清；否则保留红字失败提示（不放宽匹配，防误删） |
| Capacitor 生命周期/华为线程误拒 | 同离线 URL 快照方案；真机 P40 实测桥放行 |
| R8 裁剪/混淆导致 release 不可用 | proguard keep + release 解包+真机 release 包验收（不用 debug 包结论替代） |
| 在线页缓存导致 JS 不更新 | 启动 URL 已带时间戳；真机日志确认加载线上页与 biometricProbe 调用 |
| 测试云端账号数据被改 | 用专用测试账号，验收动作不含删除业务数据 |

## 七、验收标准

- 云端指纹 smoke 全绿；sync VerifyOnly 0 漂移；check-interface 6 OK；debug+release 双构建成功。
- 三方审查零阻断；安全审查确认无新增可利用风险。
- P40 真机（release vc308）：开通 / 指纹解锁进云端主界面 / 关闭 / H1 新增指纹自清 全部通过并有日志佐证。
- Pages 线上 auth-core.js 与本地一致且无桥环境 no-op。
