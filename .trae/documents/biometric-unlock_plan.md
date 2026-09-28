# 安卓指纹快速登录 实施计划

## 一、调研结论

1. **现有登录链**：静态 `#loginOverlay`（用户名/密码）→ `handleLogin()`（index.html）：先 `AuthCore.loginWithUsernamePassword` 本地 PBKDF2 校验（含密码自动升级），再 `AuthCore.verifyLoginGate` 授权门（在线裁决/403 宽限/429 硬拒/断网 gate token 离线门/账号墓碑拦截），成功后隐藏登录层进入主界面。
2. **原生桥**：渲染端统一调 `window.AndroidNative.invoke(name, jsonStr)`（[MainActivity.java](file:///d:/trae_projects/kyt-zy/app_project/db-offline/app/app/src/main/java/com/benneng/pres/MainActivity.java#L1844) 内部类 NativeBridge，同步返回 JSON 字符串）。invoke 在桥线程执行；BiometricPrompt 必须在主线程——用 `CountDownLatch` + mainHandler 阻塞式返回（设超时与取消）。
3. **Keystore 先例**：[DeviceAttestationManager.java](file:///d:/trae_projects/kyt-zy/app_project/db-offline/app/app/src/main/java/com/benneng/pres/DeviceAttestationManager.java) 已用 AndroidKeyStore + KeyGenParameterSpec，沿用同风格。
4. **构建**：minSdk 24、compile/target 36；`androidx.biometric:biometric:1.1.0` 已在本机 Gradle 缓存（无需联网拉依赖）；versionCode 308 → **309**。
5. **资源优先级**：热包 current 覆盖 APK assets，assets 是永久兜底（[HotUpdateManager.resolveEntry](file:///d:/trae_projects/kyt-zy/app_project/db-offline/app/app/src/main/java/com/benneng/pres/HotUpdateManager.java#L330)）。⇒ **Java 桥靠 APK309；新 JS 必须签 app-local 热包 -5**，否则 309 仍执行热层旧 JS。
6. **界面铁律（KNOWLEDGE §3）**：禁止改 index.html 静态 DOM 结构。沿用既有「运行时 JS 注入」模式（先例 `__replaceTopClearWithStats`、hideUserTypeSelect），check-interface 基线零影响。全部渲染逻辑收口权威源 [shared/auth-core/offline.js](file:///d:/trae_projects/kyt-zy/shared/auth-core/offline.js)，经 sync-auth-core.ps1 分发 3 离线副本；云端 8 副本不受影响。
7. 测试机华为 P40（ANA-AN00）有屏下指纹，BIOMETRIC_STRONG 可达；其 2D 人脸一般不向第三方应用开放，指纹是实际可用因子。

## 二、安全设计（核心约束）

1. **指纹只替代「输密码」，绝不绕过授权**：解锁得到密码 → 填入原 `#loginPassword` → 调用原生 `handleLogin()`。登录自愈、授权门、吊销墓碑、心跳、试用只读全部原路径执行，零新增放行路径。
2. **密钥模型**：Android Keystore 内 AES-256-GCM 密钥；`setUserAuthenticationRequired(true)`、`setInvalidatedByBiometricEnrollment(true)`、不可导出。每账号一把，别名 `biou_<sha256(mid|username)>`；密文文件 = IV‖ciphertext，存私有目录 `files/biometric/<同哈希>.dat`（文件名不暴露用户名）。
3. **强生物级**：仅 `BIOMETRIC_STRONG` 才允许开通/解锁；`canAuthenticate` 不达标（无硬件/未录入/仅 WEAK）则功能完全隐藏。
4. **自动失效**：① 指纹库变更 → Keystore 密钥自动作废，解锁报错时 JS 清除入口并回退密码登录；② 改密（`renameUser` 桥）→ Java 同事务删除该账号指纹凭据；③ 授权门返回吊销/墓碑 → JS 立即删除凭据。
5. **开通确认文案明示**：本机已登记的所有指纹均可解锁该账号；私人手机适用，共用手机谨慎。
6. 密码始终保留兜底；登录页可一键关闭指纹登录（删除密钥+密文）。
7. 老 APK（288–308）即使拉到热包 -5，JS 探测到桥动作缺失即整体 no-op，不产生任何行为变化。

## 三、改动文件

| 文件 | 改动 |
|---|---|
| 新增 `app/.../com/benneng/pres/BiometricUnlockManager.java` | probe/enroll/unlock/delete/list；BiometricPrompt + CryptoObject；阻塞桥执行器（超时 45s）；改密联动删除 |
| [MainActivity.java](file:///d:/trae_projects/kyt-zy/app_project/db-offline/app/app/src/main/java/com/benneng/pres/MainActivity.java) | invoke() 增加 5 个 case：`biometricProbe/biometricEnroll/biometricUnlock/biometricDelete/biometricList`；`renameUser` case 内补 biometric 删除 |
| [app/build.gradle](file:///d:/trae_projects/kyt-zy/app_project/db-offline/app/app/build.gradle) | `implementation 'androidx.biometric:biometric:1.1.0'`；versionCode 309 |
| proguard-rules.pro | `-keep class com.benneng.pres.BiometricUnlockManager { *; }` |
| [shared/auth-core/offline.js](file:///d:/trae_projects/kyt-zy/shared/auth-core/offline.js) | 新增 `installBiometricUnlock()` 并在 Android 运行时启动：运行时注入「指纹解锁」按钮与「关闭」小链接、轮询包裹 `handleLogin`（密码登录成功且未开通→confirm 引导开通）、解锁成功后填密走原 handleLogin；门返吊销时删凭据 |
| 3 个离线副本 | sync-auth-core.ps1 自动分发（app assets / desktop / electron） |
| 热包 | generate-app-hotupdate 签 **2026.09.27-5**（minAppCode 继承 288 不抬） |
| KNOWLEDGE.md | 新增小节沉淀（设计+铁律+生效方式） |

## 四、实施步骤（依赖序）

1. 跑 check-interface 建基线；`git status` 确认干净（除既有 promo/）。
2. 新建 BiometricUnlockManager：先实现 probe/list（无 UI），再实现 enroll（加密时弹 BiometricPrompt）与 unlock（解密时弹窗，阻塞桥），再 delete 与 renameUser 联动。
3. MainActivity invoke() 注册 5 case；build.gradle 依赖 + versionCode 309；proguard keep。
4. `javac`/Gradle 编译通过（先 assembleDebug 快速验编译）。
5. offline.js 写 installBiometricUnlock：UI 注入（按钮样式用内联 style，沿用紫系配色，不改 `<style>`）、handleLogin 包裹与开通引导、解锁/关闭/吊销删除；node --check。
6. 新增白盒测试 tools/biometric-smoke.cjs：对 offline.js 做桩环境断言——桥缺失 no-op、unlock 成功填密并调原 handleLogin、吊销门删凭据、老 APK no-op。
7. sync-auth-core 分发；跑全门禁：biometric-smoke、login-gate-smoke 7/7、attestation 68、smoke-runtime 157、biz 93、sync-all VerifyOnly、check-interface 6 OK。
8. 双盲功能审查 + 安全对抗审查（指纹能否构造成绕过/降级、有无 fail-open、JS 桥返回异常处理）。
9. 签热包 -5；出 release APK 309；装机真机验证：密码登录→开通→杀进程→指纹解锁进主界面→关闭入口→改密联动→（模拟）吊销清除。
10. push 后轮询线上 version.json = -5；精确逐路径 commit（排除 promo/）。
11. KNOWLEDGE 沉淀 + 五端告知（仅离线 APP 需更新：装 APK309 + 联网拉 -5；其余零改动）。

## 五、依赖与注意

- androidx.biometric 1.1.0 提供 `BiometricPrompt`/`BiometricManager`/`Authenticators`，minSdk24 全覆盖；API 28 以下库自动回退指纹对话框。
- BiometricPrompt 的 FragmentActivity 宿主：MainActivity 继承 AppCompatActivity（需确认；若不是则用 androidx FragmentActivity 能力或直接用框架 FingerprintManager 兼容路径——实施时先核继承链）。
- 阻塞 invoke：JS 调用在桥线程，弹窗期间 WebView 不卡死（JS await 的是桥返回）；需处理 activity 不可见/配置变更导致的回调丢失（超时失败→JS 提示重试，fail-closed）。
- unlock 返回密码给 JS 与「手输密码」暴露面一致；不写日志、不持久化于 JS 侧。

## 六、验证

- 编译：Java/Gradle 全量 exit 0；node --check 权威源与副本。
- 自动化：biometric-smoke 新断言、login-gate-smoke 7/7、157/68/93 全绿、sync VerifyOnly、6 OK。
- 真机（P40）：开通→指纹解锁成功进入；指纹失败可回退密码；关闭后入口消失；改密后凭据失效；无指纹录入的环境按钮不出现（可借另一设备/模拟器）。
- 三审：双功能互盲 + 安全对抗全过。

## 七、风险

- ~~MainActivity 非 FragmentActivity~~ **已核实**：MainActivity extends Capacitor `BridgeActivity` extends `AppCompatActivity`，BiometricPrompt 直接可用，无此风险。
- **厂商 ROM 兼容**（部分华为/小米 STRONG 判定差异）：probe 不通过即隐藏，绝不降级到自研人脸或弱校验。
- **热包 -5 被旧 APK 拉取**：JS 桥探测 no-op，已在设计内；真机验证 308 设备无任何变化。
- **多指纹共用风险**：开通确认弹窗明示 + 用户可随时关闭。
