# License 验签加固实施计划（HMAC 兜底收敛 + 端口对齐）

> **归档状态（2026-09-12）**：本计划为 2026-09-11 验签加固的**实施前调研与设计稿**，以下内容**已实施完毕**（实施细节、坑位与单测坐标以 `.trae/KNOWLEDGE.md` §9 各条目为准，冲突时以 KNOWLEDGE 为准）：
> - 阶段 0（安卓 V5 fail-closed）+ 阶段 1a/1b/1c（ensureLicenseV7 重签自愈 + HMAC_SUNSET_DATE 六端截断 + 下发出口审计）。实施时出口清单有调整：接入 admin-status / admin-submit 两短路点；validate 等为新鲜签发无需接入。
> - P1（V7 验签 NDK 下沉双路互检）、P1（桌面完整性上报闭环）、P2（安全画像设备封锁）。
> - 「阶段 2」实施时升级为**对称密钥轮换**（LICENSE_HMAC_KEYS V1/V2 双档 + V1 档 2026-08-01 提前日落 + masterKey 分支截断），超出本计划原范围（原阶段 2「宽限期到期无代码动作」语义由日落常量吸收）。
>
> **仍待执行**：①到期前 30 天（2027-03-01 起）的一次性升级提醒未实现（可选增强）；②阶段 3 清理期（约 2028-03，删四端 HMAC 验签代码 + 硬编码密钥 + LEGACY 公钥，前置条件见「三、阶段 3」）；③桌面 Authenticode 代码签名为采购决策非代码项；④P3 asar bytenode 维持「出现实际破解案例后再考虑」。
>
> 以下为原始计划全文，未做改动。

> 制定日期：2026-09-11 ｜ 依据：全链路调研（服务端 license-core.js / 安卓 LicenseManager.java / 桌面 license-manager.js / NDK securityguard.cpp）
> 原则：遵守项目红线「宁可漏检不可误报、不允许正常用户闪退」

---

## 一、现状盘点（调研结论，修正初判）

### 已实现的防护（比预想完整）

| 机制 | 状态 | 位置 |
|---|---|---|
| V7 Ed25519 非对称验签（含 sigSerial/sigNonce 防重放） | ✅ 已上线，fail-closed | 服务端 license-core.js L307/L512；四端验签 |
| V6 ECDSA 防重放签名 | ✅ 已上线，fail-closed | 同上 |
| V5 ECDSA 非对称验签 | ⚠️ 桌面 fail-closed（2026-08-16）；**安卓仍降级 HMAC** | 安卓 LicenseManager.java L1865 |
| 密钥轮换兼容（新→旧公钥依次尝试） | ✅ 2026-08-26 | 四端 + LEGACY 公钥常量 |
| masterKey 一致性校验（防删除/替换降级攻击） | ✅ | verifyMasterKeyConsistency |
| APK 签名自校验 Java+NDK 双路 + 云端仲裁 | ✅ | securityguard.cpp（JNI 动态注册、常量时间比对） |
| 安卓 Ed25519 纯 Java 实现 | ✅（minSdk 24 不支持原生 EdDSA） | LicenseManager.java Ed25519 类 |
| 服务端签发全带 V5/V6/V7 | ✅ | buildLicenseData L454-L512 |
| 激活码在线验证 + 过期拦截 | ✅（2026-09-11 P0 已修） | validate.js / admin-status.js |
| 机器码+硬件指纹绑定 | ✅ | licenseBinding / HKDF 派生 |

### 真实缺口（按攻击路径排序）

**缺口 A（端不一致，直接修）**：安卓端 V5 验签失败降级 HMAC，桌面端已 fail-closed。攻击路径：构造含垃圾 signatureV5 + 重算 HMAC signature 的 license → 安卓端 V5 验不过 → 降级 HMAC → 通过。

**缺口 B（核心结构问题）**：HMAC 兜底链路（硬编码 `bnzc_tcm_license_key_v1_2026` + masterKey 派生 + v1/v2/v3）对所有「无 V5/V6/V7 字段」的 license 开放。攻击路径（两端通杀）：从零伪造 license，删掉全部 V 字段，用 APK 解包提取的硬编码密钥重算 signature → 绕过全部非对称保护。**只要此路径在，非对称体系整体被架空。**

**缺口 C（深挖空间）**：安卓 Ed25519 验签在 Java 层（纯 Java 实现），Frida hook verifyEd25519SignatureV7 返回 true 即可绕过（NDK 双路校验只覆盖 APK 签名比对，不覆盖 license 验签）。

### 无法根治的残余风险（接受）
HMAC 密钥已随历史 APK 泄露（撤不回）。收敛后攻击者仍可伪造「issuedAt=旧日期」的 HMAC-only license（对称签名无法证明真实签发时间），但：宽限期后此类 license 仅在「永不联网」时可瞒过客户端，任何联网动作（激活/验证/同步）都会被服务端 KV 真实记录仲裁。这是对称密钥泄露后的最优收敛，非彻底根除。

---

## 二、目标与非目标

**目标**
1. 堵死「删 V 字段走 HMAC」的伪造路径（分阶段收敛，不误伤存量付费用户）
2. 消除四端验签行为差异（V5 fail-closed 对齐）
3. 提升深挖成本（license 验签关键路径 NDK 化）

**非目标**
- 不引入商用加固/壳（与自研 NDK 体系冲突，价值重叠）
- 不追求根除 HMAC 历史密钥泄露（物理不可能，只收敛可达路径）
- 不改 license 文件格式 v1-v7 字段定义（保持四端兼容）

---

## 三、分阶段实施

### 阶段 0：安卓 V5 fail-closed 对齐（立即，随下次打包）

| 项 | 内容 |
|---|---|
| 改动 | LicenseManager.java L1865：`Log.w("v5 验签失败，降级为 HMAC")` 后不再落入 HMAC，改为 `return false`（fail-closed），与桌面版 2026-08-16 修复对齐 |
| 依据 | 服务端自 V5 上线起签发必带 signatureV5；「有 V5 字段但验不过」= 被篡改后重算 HMAC，唯一解释是攻击。存量合法 V5 license 由 LEGACY 公钥轮换链保护，无误报路径 |
| 文件 | `app_project/db-offline/app/app/src/main/java/com/benneng/pres/LicenseManager.java`（唯一；APP assets 的 JS 副本无 V5 逻辑，核对即可） |
| 验收 | 构造「垃圾 V5+正确 HMAC」license 单测被拒；正常激活全流程 E2E 通过 |
| 生效 | 需重打离线 APP APK |

### 阶段 1：HMAC 兜底收敛——服务端重签自愈 + 客户端宽限截断（本迭代）

**1a. 服务端：存量 license 重签自愈（下发出口统一升级）**

| 项 | 内容 |
|---|---|
| 改动点 | `functions/api/license/admin-status.js`（轮询下发）与 `functions/api/license/validate.js`（激活下发）出口：解码 KV 中 licenseBase64，若无 `signatureV7` 字段（存量旧记录）→ 用 licenseRecord 重新 `buildLicenseData()`（自动全签 V5/V6/V7）→ 回写 KV + 下发。已有 V7 的直接下发（幂等，二次调用无副作用） |
| 辅助 | `_lib/license-core.js` 新增 `ensureLicenseV7(kv, record)` 封装「检查-重签-回写」，两个出口共用，防第三出口再漏（举一反三：下发出口必须走同一函数） |
| 注意 | 重签不改变 expiresAt/机器绑定（buildLicenseData 按 record 字段原样重签）；与 2026-09-11 P0 的过期拦截兼容——重签前置检查 license 过期，过期仍走 license_expired 拒绝 |
| 生效 | 服务端 push 即部署；存量用户**联网一次即被自愈升级**（激活轮询/在线验证/同步均触发） |

**1b. 客户端：HMAC 兜底加「签发时间硬截断」**

| 项 | 内容 |
|---|---|
| 改动点 | 四端 verifySignature 的 HMAC 兜底入口（V5/V6/V7 全部缺失时）：解析 `issuedAt`，若 `issuedAt >= HMAC_SUNSET_DATE`（新常量，建议 `2027-03-31` = 发版日+约 180 天）→ 直接拒绝并提示「授权文件格式过旧，请联网验证一次以自动升级」（引导走在线验证换 V7 license）；早于截断日的存量 license 照旧走 HMAC（不误伤） |
| 常量 | `HMAC_SUNSET_DATE` 四端统一（安卓 Java / 桌面 shared/license/license-manager.js），值写入 KNOWLEDGE 便于轮换时查 |
| 文件 | ① `shared/license/license-manager.js`（权威源）② 云桌面 `db-yunduan/cloud_desktop/electron/license-manager.js` ③ 离线桌面 `db-offline/desktop/license/license-manager.js` + `db-offline/desktop/electron/license-manager.js`（构建双副本，改后跑桌面 build.bat 确认同步）④ 离线 APP assets `db-offline/app/app/src/main/assets/public/license/license-manager.js` ⑤ 安卓 `LicenseManager.java`（Java 端独立实现同逻辑） |
| 提示 | 拒绝时区分文案：离线版弹「请联网完成一次在线验证，授权文件将自动升级」（服务端自愈已就绪，联网即解决） |
| 验收 | 单测矩阵：V7✓、V7 篡改✗、V5 fail-closed✗、HMAC-only+issuedAt<截断日✓、HMAC-only+issuedAt≥截断日✗（带升级引导文案） |
| 生效 | 服务端立即；客户端随各端下次发版（离线 APP 需重打 APK，桌面需重打包，云端桌面/APP 随打包） |

**1c. 配套：服务端同步文件出口核查**

激活轮询、admin-status、数据同步等所有「向客户端发 license 内容」的出口统一过 `ensureLicenseV7`（rg 全查 `licenseBase64` 下发点，逐个核对，防止新增出口绕过）。

### 阶段 2：宽限期到期（2027-03-31，无代码动作）

截断常量自动生效。到期前 30 天（2027-03-01 起）客户端对「HMAC-only 且临近截断」license 弹一次性升级提醒（可选：阶段 1 一起埋好，按 issuedAt 与截断日差值触发）。

### 阶段 3：清理期（截断日 + 一个授权周期后，约 2028-03）

| 项 | 内容 |
|---|---|
| 删除 | 四端 HMAC 验签代码 + 硬编码密钥常量 + masterKey 派生 HMAC 路径（注意：CONFIG_SIGN_KEY 与 masterKey 派生**暂保留**——config.json 签名是独立用途，另行评估）|
| 删除 | LEGACY ECDSA/Ed25519 公钥（存量轮换兼容期结束） |
| 前提 | 服务端 KV 全量 license 记录已 V7（wrangler 遍历统计确认）；客服渠道公告存量长周期离线用户 |

---

## 四、后续增强（P1/P2，独立排期）

| 优先级 | 项 | 设计要点 |
|---|---|---|
| P1 | license 验签 NDK 下沉（补缺口 C） | securityguard.cpp 扩展：V7 签名内容的 SHA-256 下沉 native 计算 + 验签结果 XOR 脱敏返回（复用 APK 签名校验同款动态注册/常量时间架构），Java 层 Ed25519 保留为交叉校验第二路（双路分叉→云端仲裁，复用现有 arbitrateIntegrityViaCloud 机制） |
| P1 | JS 层零信任审计 | 审计 APP assets 副本（auth-core.js/license-manager.js）：确保 JS 层无「信任自身返回值即放行」路径，所有授权门在 Java 层二次把关 |
| P2 | 安全画像上报 | 联网时机（验证/同步）顺带上报 frida 痕迹/root/签名分叉计数，服务端标记可疑设备并拒绝下发 license（本地不阻塞维持红线，在线能力全部卡死） |
| P2 | 桌面 Authenticode 代码签名证书 | .bnzc 已防篡改，签名解决 SmartScreen 拦截与官方包辨识（预算 ~$200-500/年） |
| P3 | asar 关键模块 bytenode 字节码化 | 性价比一般，已绑机器码+PE 校验，仅在出现实际破解案例后考虑 |

---

## 五、测试计划

1. **单元矩阵（四端同跑）**：V7 正常 / V7 字段篡改 / 删 V7 留 V6 / 删 V6V7 留 V5（安卓验证 fail-closed）/ 全删走 HMAC（issuedAt 三档：旧/截断日当天/新）/ masterKey 替换
2. **服务端**：ensureLicenseV7 幂等（连调两次）、过期 license 不重签仍拒、KV 回写校验
3. **E2E**：离线 APP 激活全流程（新签 V7）；存量 HMAC license 模拟（本地植入旧格式文件）联网自愈升级；宽限期外 HMAC-only 拒绝+引导文案
4. **回归**：六道门禁 + 桌面 E2E 6 条 + 昨日 P0 场景（过期 license 重激活被拒）不回退

## 六、风险与回滚

| 风险 | 概率 | 缓解/回滚 |
|---|---|---|
| 存量未联网用户被截断误伤 | 低（180 天宽限+联网即自愈+到期提醒） | 截断常量在客户端，后续版本可放宽；客服通道人工续发 V7 |
| 重签改变 license 语义引发误报 | 低（按 record 原样重签，不改 expiresAt/绑定） | ensureLicenseV7 失败时直接下发原 license（fail-open 旧文件，维持现状不升级也不拒绝） |
| 安卓 V5 fail-closed 误报 | 极低（V5 上线后的合法 license 必带 V5 且密钥轮换有 LEGACY 双公钥） | 回滚 = 恢复降级逻辑一行 |
| KV 写冲突（重签并发） | 低（KV 单键 last-write-wins，重签内容确定性相同） | 幂等设计，冲突无害 |

## 七、工作量估计

| 阶段 | 内容 | 估时 |
|---|---|---|
| 0 | 安卓 V5 对齐 + 单测 | 0.5h |
| 1a | 服务端 ensureLicenseV7 + 两出口接入 + 幂等测试 | 2-3h |
| 1b | 四端截断常量+判定+文案 + 副本同步 + 单测矩阵 | 3-4h |
| 1c | 下发出口全查 | 0.5h |
| 验收 | 门禁 + E2E + 场景回归 + KNOWLEDGE 沉淀 | 1-2h |
| 合计 | | **约 1 个工作日**（阶段 3 清理另计 0.5 天，2028 年执行） |
