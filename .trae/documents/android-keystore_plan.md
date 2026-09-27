# Android Keystore 授权锚点方案 Implementation Plan（M-2A，离线 APP 专属）

## Repository Research（仓库研究结论）

### 1. 离线 APP 授权链权威结构（与桌面完全不同）

- APP 是 **Capacitor + WebView** 架构。[shared/license/license-manager.js](file:///d:/trae_projects/kyt-zy/shared/license/license-manager.js) 虽经 sync-all Group 分发到 APP assets，但**全 APP 无任何文件引用/执行它**（纯同步占位）。
- APP 授权链真正权威 = Java [LicenseManager.java](file:///d:/trae_projects/kyt-zy/app_project/db-offline/app/app/src/main/java/com/benneng/pres/LicenseManager.java)（5130 行），通过 `MainActivity` 的 `AndroidNative.invoke` 桥暴露给渲染层。
- 渲染层登录门 `verifyLoginGate`（权威源 [shared/auth-core/offline.js](file:///d:/trae_projects/kyt-zy/shared/auth-core/offline.js)，sync-auth-core.ps1 分发）：
  - 在线裁决 `/api/license/entitlement`（LICENSED/NO_LICENSE/LICENSE_REVOKED/LICENSE_EXPIRED/DEVICE_DISABLED + accountState 墓碑）；
  - **账号墓碑 map / 宽限起点 offlineStart / lastVerify 全部存 `StorageAdapter`** = Capacitor Preferences（Android 后端 SharedPreferences）或裸 localStorage（WebView leveldb）。
- Java 侧状态文件全部在 `context.getFilesDir()`（`/data/data/com.benneng.pres.dingzhi/files/`）：license.dat（ENC2）/trial.dat（TRIAL1）/last-run.dat（LASTRUN1）/prescription-count.dat/verify-state.dat（VSTATE1）/activation-record.dat（ACTREC1）；配置在 SharedPreferences `license_config`。
- 设备身份：`getMachineId()` = `SHA256(ANDROID_ID|pkg|versionName|manufacturer|model)` 前 32 位；`getHwFingerprint()` = ANDROID_ID + SERIAL/MODEL/FINGERPRINT。
- 云端 APP（app_project/db-yunduan/cloud_app）只有 MainActivity/SecurityGuard/NativeGuard，**无 LicenseManager**，本方案不涉及。

### 2. Android 侧威胁模型（对照桌面 M-2）

- 普通用户**无法用文件管理器触及沙箱**（filesDir/SharedPreferences/leveldb 均不可达），所以桌面那种「del gate.dat」教程攻击在 Android 不存在。
- 普通用户唯一等价入口 = **系统设置 → 应用 → 清除存储/清除数据**（及卸载重装）：filesDir + SharedPreferences + localStorage **一次性全灭**。
  - 清除数据后：license/trial 丢失 → validateLicense 读成全新态 → 登录门可重新走「试用/免费领取」路径；
  - 服务端虽有 ANDROID_ID 判重（trial/register 硬件指纹）与设备 KV，但**本地「已激活/已拒绝」事实被重置**：被吊销用户断网启动可获新 7 天宽限/试用窗口——与桌面 M-2 修复前同构的锚点灭失缺口。
- root 用户：可任意删文件、hook Java 方法、重置/删除 Keystore（与桌面「同用户代码执行残余」对等，超出本方案边界）。

### 3. Android Keystore 关键能力（决定方案形态）

- 非导出（non-exportable）对称密钥，系统级存储于 keystore 守护进程，硬件支持（TEE；StrongBox 需 API 28）。
- **核心特性：密钥不随「清除应用数据」删除（UID 不变）；卸载 APP 才删除** —— 这正是「无法被清除数据/文件操作移除的锚点」，等价桌面 M-2 的 Windows 凭据管理器。
- minSdk=24 支持 AndroidKeyStore 的 AES/GCM、HMAC-SHA256（Keystore Ed25519 不可用，无需）。
- 限制：Keystore **只能存密钥不能存任意 blob**；完整状态密文仍在沙箱内、清除数据必灭 → 故本地可保留的只有「密钥存在性」这一布尔事实，而非墓碑/宽限全态。

## 方案目标与分层

**总目标**：把「本机曾激活/曾装码」这一事实锚入 Android Keystore，使「清除数据」无法重置激活身份；锚点存在但本地授权态缺失时一律 fail-closed（不播试用/不播种宽限），必须在线证明后由服务端恢复，墓碑由 entitlement 重新下发。

- **P1（MVP，本次实施）**：Keystore 激活存在密钥 + 清除数据后 fail-closed 再验证。
- **P2（增强，本次可一并实施或紧随其后）**：Keystore AES-GCM 保护渲染层锚点（防伪造/篡改）+ Keystore 证书指纹作为稳定 mid 候选（解决 versionName/ANDROID_ID 漂移）。
- **P3（backlog，不在本次）**：Play Integrity API 设备证明 + 服务端短周期 token（与桌面设备证明路线合并）。

## Files and Modules（改动文件与模块）

- `app_project/db-offline/app/app/src/main/java/com/benneng/pres/KeyVaultManager.java`（**新建**，小而专）：
  - 激活密钥别名 `bnzc_act_v1`（AES-256-GCM，non-exportable，Keystore）；
  - `ensureActivationKey()`：不存在则生成（KeyGenParameterSpec：PURPOSE_ENCRYPT|DECRYPT、BLOCK_MODE_GCM、setRandomizedEncryptionRequired(true)）；
  - `hasActivationKey()`：仅查别名（不抛异常）；
  - 锚点密钥别名 `bnzc_anchor_v1`（P2，AES-GCM）+ `seal(plain)/open(blob)`（格式 `AKV1:b64(iv):b64(ct)`）；
  - 稳定身份：读取激活密钥证书链 SHA256（P2，`stableKeyId()`）；
  - 全程异常 → 返回 false/空并日志，**绝不抛异常导致闪退**（红线：宁可漏检不可误报）。
- [LicenseManager.java](file:///d:/trae_projects/kyt-zy/app_project/db-offline/app/app/src/main/java/com/benneng/pres/LicenseManager.java)：
  - 激活成功的两个落账点（在线激活 activateOnline、installAdminLicense、claimFreeLicense）调用 `KeyVaultManager.ensureActivationKey()`；
  - `validateLicense`：无 license/trial（全新态）但 `hasActivationKey()`=true → 失败态返回特殊原因 `must_revalidate`（valid=false + 文案「本机授权记录已重置，请联网后自动恢复，或重新输入激活码」）；
  - P2：`getMidVariants()`（仿桌面）追加 stableKeyId 对应候选，供装码/裁决兼容（不替换主 mid，服务端零影响）。
- [MainActivity.java](file:///d:/trae_projects/kyt-zy/app_project/db-offline/app/app/src/main/java/com/benneng/pres/MainActivity.java)：
  - getLicenseStatus 返回值增加 `everActivated`（=hasActivationKey）字段；
  - P2：新增/复用桥方法 `anchor.seal/open`（或挂在 license.* 下），供渲染层加密墓碑/宽限。
- [shared/auth-core/offline.js](file:///d:/trae_projects/kyt-zy/shared/auth-core/offline.js)（**权威源**）：
  - `__verifyLoginGateInner` 全新态分支：`status.everActivated===true` 时按「必须在线证明」处理（与桌面 uncertain 同口径：不允许 trial、不播种宽限），在线 LICENSED 后自动恢复（优先走 installLicenseFromServer 凭 ANDROID_ID 一键装码）；
  - P2：墓碑 map/offlineStart/lastVerify 读写改经 `anchor.seal/open` 包装（失败回退明文现状，保可用）。
- 分发：`tools/sync-auth-core.ps1`（offline → APP assets 等 3 离线目标）；Java 无副本（仅此一份）。
- `app_project/db-offline/app/app/build.gradle`：versionCode 304 → **305**（versionName 保持 "1.0.0"，APP 文件名版本由发布脚本/清单处理）。
- `app_project/db-offline/app/app/proguard-rules.pro`：确认 `java.security`/`javax.crypto` 系统类与新类不被混淆破坏（默认 keep 系统 API，只需保留 KeyVaultManager）。
- 工具：新增 `tools/android-keystore-smoke`（仅静态/契约层：JS↔桥字段契约、P1 分支逻辑，Keystore 真机行为走 instrumented/E2E）。
- [.trae/KNOWLEDGE.md](file:///d:/trae_projects/kyt-zy/.trae/KNOWLEDGE.md)：新增章节沉淀（结论+生效方式+威胁模型边界）。

## Implementation Steps（依赖顺序）

1. 新建 `KeyVaultManager.java`（P1：激活密钥 ensure/has；P2：anchor seal/open + stableKeyId）。
2. LicenseManager：三个激活落账点挂 ensureActivationKey；validateLicense 全新态增 must_revalidate 分支；（P2）mid 候选。
3. MainActivity：状态字段透传 everActivated；（P2）anchor 桥。
4. shared/auth-core/offline.js：登录门全新态 fail-closed 分支；（P2）锚点加密封装。
5. sync-auth-core.ps1 分发；node --check 改动 JS；本地全门禁回归（见 Validation）。
6. versionCode bump → 真机 instrumented/E2E 验证（关键证据）→ release 构建。
7. 双重独立审查（功能+安全，仿 M-2 流程）→ 修复 → 复审。
8. KNOWLEDGE 沉淀 → 精确逐路径 git add（禁 add ./-A）→ commit/push（pre-push 门禁）→ 按既有 APK 分发流程复制固定文件名包。

## Dependencies and Considerations（依赖与注意）

- minSdk 24：Keystore AES/GCM、HMAC 全部支持；StrongBox（API 28）不使用或仅探测不强依赖。
- 「清除数据密钥存活、卸载密钥删除」是方案成立的前提，真机 E2E 必须实证（不可只信文档）。
- Keystore 在极少数设备异常（厂商 ROM bug/系统存储损坏）→ 回退现状行为并日志，**绝不阻塞正常用户**（红线）。
- 不替换主 machineId（服务端设备 KV、装码链路均以 mid 为身份）；stableKeyId 仅作追加候选。
- 卸载重装场景：Keystore 密钥随之删除（弱于桌面凭据管理器「卸载软件凭据保留」）——如实记录残余；缓解=服务端 ANDROID_ID 判重 + 设备 KV + 客服恢复。
- 渲染层锚点 Keystore 化（P2）只防伪造/篡改，不防删除（密文在沙箱）；删除后按缺失 fail-closed，与 P1 语义一致。
- 热更新白名单：offline.js 属渲染层；若通过热更分发，须遵循「发版=源码+热包+整包」铁律（generate-app-hotupdate 递增序号），避免旧热包遮蔽。确认 auth-core 是否在 14 个热更白名单内并据此处理。

## Validation（验证）

- `node --check` shared/auth-core/offline.js 及全部改动 JS；sync-auth-core VerifyOnly/同步、sync-all VerifyOnly。
- 本地冒烟回归：license-config-sign 134、desktop-license 141、desktop-user 58、desktop-print 33、biz 93、smoke-runtime --all 157、credential-vault 60；check-interface 6 OK；diff-cross-version；copy-consistency。
- **真机 instrumented/E2E（核心）**：
  1. 全新安装 → 无激活密钥（everActivated=false）→ 试用/领取路径正常；
  2. 激活/claimFree 成功 → Keystore 密钥生成；
  3. 「清除数据」后断网启动 → must_revalidate/fail-closed，**不获试用/宽限**；
  4. 「清除数据」后联网 → 在线裁决 + 一键装码恢复，账号墓碑由服务端重新下发、被删账号仍被拒；
  5.（P2）篡改/伪造锚点密文 → open 失败按缺失处理；墓碑 seal/open 往返一致；
  6. APP 覆盖升级（不清数据）→ 密钥持续有效、mid 候选可解析旧态。
- 验包铁律：release dex 方法名被 R8 混淆，改用未混淆中文字符串/常量验证；assets JS 可直接 zip 读取。
- 审查：功能+安全双代理独立审查并复审通过后方可提交。

## Risks（风险与处置）

- 误将「曾激活密钥存在」的正常老用户锁死：密钥只在激活成功后生成；must_revalidate 文案明确且联网即可自动恢复，不需客服；仍保留输入激活码路径。
- Keystore 设备兼容异常：全链路异常回退现状，绝不闪退（红线）。
- P2 加密锚点导致读失败：seal/open 失败即回退明文存储，保可用性。
- mid 候选改动外溢：仅追加不替换，服务端与存量设备零影响。
- 旧热包遮蔽 auth-core 新逻辑：按热更三位一体铁律先签推热包再发 APK。
- root/卸载重装残余：如实记录，靠服务端判重与未来 Play Integrity/短周期 token 根治。

## 五端生效方式（实施后告知）

- **离线 APP（APK）**：安装新 APK（versionCode 305）生效；如触发热更白名单需联网打开一次并彻底重进。
- **云桌面 / 离线桌面 exe**：零改动（M-2 已发布）。
- **云端网页 / 云端 APP / 鸿蒙**：零改动。
