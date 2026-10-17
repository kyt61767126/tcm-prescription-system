# 独立复核报告 —— 云端激活/续费后主窗口仍显示「未激活/已缓存」

复核员：teammate `verifier`（只读审计 + 跑门禁；未修改任何被测源码）
复核时间：2026-10-10 15:00–15:15
被测修订（复核时哈希，工作区）：

| 文件 | sha256（前16） | 大小 |
|---|---|---|
| `shared/auth-core/cloud.js`（源） | `A7759481831C0112` | 366,209 B |
| `shared/auth-core.js`（上线包） | `3C407488D03E819D` | 388,819 B |
| `functions/api/license/_lib/admin-account.js` | `D7B478D32DA6CBC4` | — |
| `public/index.html` | `F720B27CF7372E7A` | — |
| `app_project/db-offline/desktop/index.html` | `10E03DB5775B9C40` | — |

> 复核期间 Lead 仍在改离线端 `index.html`（15:02:55 落盘），D 项已按最终修订复跑。

## 结论（TL;DR）

- **A 全绿**：两个文件语法通过，`scan-undefined-consts` 全绿；旧语义分支（`!cu.clinicExpiresAt` 才自愈 / 只补空 patch）在云端口与 8 个 `auth-core.js` 副本中**已无残留**。
- **B 核心 5 项（B1–B5）全部 PASS**：旧缓存被覆盖、旧缓存形态能渲染「✅ 已激活」、「test」安全修复未回退、401/网络失败不写缓存、换账号竞态不写缓存。**用修复前的 `HEAD` 包做对照同一套用例 21/44 通过**（B1/B2/B3b 全 FAIL），说明修复确实命中问题。
- **C 29/29 PASS**：`license:{code}.clinicName` 回填、`license_clinic_index` 新增本码、已绑定他所不覆盖、KV 读写异常不影响顺延。
- **D 全绿（exit 0）**：`biz-smoke 93/93`、`prescriptions-db-diff 16/16`、`diff-cross-version` 4 对基线全绿。
- **发现 1 处整包级残留**：`public/hot-update/desktop/cloud/auth-core.js` 仍是**修复前**版本（381,996 B，sha `9C6A6254…`，与 `version.json` manifest 完全一致），云端桌面热更通道若原样推送即下发旧逻辑。
- **发现 3 处窄窗残留**（均不改变"服务端权威值最终落缓存"，但界面会短暂/持久停在旧文案）：网络失败吃掉 6h 窗口（注释与实现不符）、首屏自愈在途时重开设置界面停在 stale、登录缓存无 token 时不做任何自愈。

---

## A. 语法 / 静态

```
$ node --check shared/auth-core/cloud.js                     → exit 0
$ node --check functions/api/license/_lib/admin-account.js    → exit 0
$ node tools/scan-undefined-consts.cjs
[scan-undefined-consts][OK] functions/ 65 个文件扫描完毕，无未定义 KV_* 常量   → exit 0
```

旧语义残留搜索（`grep: __lastProfileFetchAt|&& !cu.clinicStatus|if \(!cu.clinicExpiresAt\)|!target.clinicExpiresAt && cu.clinicExpiresAt`）：
命中仅在注释中（`cloud.js:3320、3323`：描述"原实现"的历史说明）与 8 个**已修复**的副本；
唯一含活代码旧语义的文件是 `public/hot-update/desktop/cloud/auth-core.js`（L3748–3835：`< 24*60*60*1000` 节流、`!cu.clinicStatus` 只补空、`if (!cu.clinicExpiresAt)` 早退）→ 见 E-1。

源码 ↔ 上线包一致性（`node tools/_verify-bundle-sync.cjs`，逐字节比对本次改动区间）：
```
[OK] refreshCloudProfile/__refreshCloudProfileInner 区段（6335 字节）源↔上线包逐字节一致
[OK] getCloudAccountLicenseHtml 本体（3177 字节）源↔上线包逐字节一致
[OK] syncClinicExpiryFromInvite 本体（2044 字节）源↔上线包逐字节一致
```
8 个 `auth-core.js` 副本（`shared/`、`public/`、`public/electron/`、`site-admin/`、`cloud_desktop/`×2、`cloud_app/assets/`、`harmony rawfile/`）**同一 sha256** → 无副本漂移（含此前"不在同步工具范围内"的鸿蒙 rawfile 也已是新版）。

**A = PASS**（除 E-1 的热更产物）。

## B. 行为（独立测试：`tools/_verify-profile-refresh.cjs`，node:vm 加载真实上线包）

方法：`vm` 加载 `shared/auth-core.js`，打桩 `window/document/localStorage/fetch/AbortController`，调 `window.updateLicenseStatusText()`，断言 `#licenseStatusText.innerHTML` 与 5 个缓存键。
```
$ node tools/_verify-profile-refresh.cjs        （当前修订）  → 44 通过 / 7 失败，exit 1
$ VERIFY_BUNDLE=tools/_verify-old-auth-core.js  （git HEAD 旧包）→ 21 通过 / 30 失败
```
（旧包导出命令：`node -e "require('fs').writeFileSync('tools/_verify-old-auth-core.js', require('child_process').execSync('git show HEAD:shared/auth-core.js',{maxBuffer:1e9}))"`；复核结束后该临时文件已删除。）

| 用例 | 断言 | 新包 | 旧包 | 关键输出 |
|---|---|---|---|---|
| B1 缓存 2027-10-08 / 服务端 2028-10-07 | 缓存被覆盖 + 渲染新天数 | **PASS** | FAIL（仍 363 天、缓存仍 2027-10-08） | `✅ 已激活（机构版）剩余 728 天`；`auth:currentUser / currentUser / cloud_currentUser / user_login_data.user / local_currentUser` 5 键全部 = `2028-10-07T00:00:00.000Z`，`loginTime` 结构未破 |
| B2 缓存 `clinicStatus=''` 无到期日 / 服务端 active | 必须「✅ 已激活」 | **PASS** | FAIL（`⏳ 未激活/旧缓存`，且旧代码 0 次 get-profile） | `✅ 已激活（机构版）剩余 728 天`；缓存补出 `clinicStatus=active`、`clinicName` |
| B3 本地 test + 服务端 test | 必须仍「⏳ 试用期/待审核」 | **PASS** | PASS | `⏳ 试用期/待审核`，无「✅ 已激活」 |
| B3b 本地 active + 服务端 test | 必须被覆盖为试用期 | **PASS** | FAIL（显示 ✅ 已激活） | `⏳ 试用期/待审核`；缓存 `clinicStatus=test` |
| B4a fetch reject | 0 写 + 未激活形态 | **PASS** | PASS（无提示语） | `⏳ 未激活/旧缓存` + `（授权状态联网校验未完成…）`；5 键与种子逐字节相同 |
| B4b HTTP 401 | 0 写 + 未激活形态 | **PASS** | PASS | 同上，**但无「联网校验未完成」提示**（见 E-6） |
| B5 服务端 username 不同 | 0 写 | **PASS** | PASS | 5 键均保持原值 |
| E 单调回写（`syncClinicExpiryFromInvite`） | 更旧的值不回写 | **PASS**（值相等/更新分支亦 PASS） | FAIL（旧值把 2028-10-07 覆盖回 2027-10-08 并重渲） | E1 缓存保持 `2028-10-07`、重渲 0 次 |
| B6a 同 tick 并发两次渲染 | 去重 + 最终非 stale | PASS 去重（get-profile=1）/ **FAIL 渲染** | FAIL | 最终 `⏳ 未激活/旧缓存` |
| B6b 首屏请求在途时重开设置 | 成功响应后界面应更新 | **FAIL** | FAIL（旧代码根本不发请求） | `#1 完成后仍显示 = ⏳ 未激活/旧缓存`；缓存已是 `2028-10-07`；**第 3 次打开设置才变 ✅** |
| B7 网络失败后再渲染 | 应重试 | **FAIL** | FAIL | get-profile 尝试次数 `1 → 1`（窗口未回滚） |
| B10 两版都走到的自愈路径 + 网络失败 | 应重试 | **FAIL** | **FAIL（与新版完全相同 1→1）** | 证明"失败吃掉窗口"是**既有行为**，非本次引入；注释声称已修但未修 |
| B8 服务端 `clinicExpiresAt=null` + 本地旧值 | 观察 | 旧值**未被清**（`2027-10-08`，显示"剩余 363 天"） | 同 | 服务端显式清空时本地旧到期日保留 |
| B9 登录缓存无 token | 观察 | 0 次 get-profile，恒显示 `⏳ 未激活/旧缓存` | 同 | 需重新登录（补 token）才可能自愈 |

**B = 核心 PASS；追加用例暴露 3 处残留（B6b / B7·B10 / B9）。**

## C. 服务端续费索引（mock KV：`e2e/.tmp/verify-renew-license-backfill.mjs`）

```
$ node e2e/.tmp/verify-renew-license-backfill.mjs   → 29 通过 / 0 失败，exit 0
```
- C1（`clinicName:''`）→ `license:BNZC-RNW1-…clinicName = "中医诊所·9705"`；`license_clinic_index = {"其他诊所·0000":["BNZC-OTHR-…"],"中医诊所·9705":["BNZC-RNW1-…"]}`；诊所 `expiresAt = 2028-10-07T00:00:00.000Z`；返回 `licenseBackfilled:true`；码记录其余字段（devices/status/note）未被破坏。
- C2（字段缺失 undefined）→ 同上，PASS。
- C3（已绑定 `别的诊所·9999`）→ `clinicName` 保持 `别的诊所·9999`、索引未把本码挂到本诊所、顺延仍生效、`licenseBackfilled:false`，并输出 `[TaobaoRenew] 该码已绑定其他诊所，跳过 clinicName 回填（防越权改归属）`。
- C4 `kv.get('license:{code}')` 抛异常 → `{ok:true, renewed:true, licenseBackfilled:false}`，顺延已生效（`2028-10-07`）。
- C5 `kv.put('license:{code}')` 抛异常 → 同上，且码记录未被写坏。**注意 C4 路径无任何 warn**（`.catch(()=>null)` 先把异常吞了，见 E-8）。
- C6（观察）`license_clinic_index` 键**整体缺失**时：码记录 `clinicName` 仍被回填，但**索引不会被新建**（`maintainClinicIndexOnSave` 对脏/缺失索引整体跳过）→ 依赖读侧全扫兜底。
- C7 幂等：二次调用 `already:true`、到期时间不再叠加、零 KV 写。

静态佐证：`git show HEAD:functions/api/license/_lib/admin-account.js | Select-String 'licenseBackfilled|getLicense\(|updateLicense\('` → **0 命中**，第 ⑤ 步确为新增。

**C = PASS。**

## D. 回归门禁（最终修订，15:09 复跑）

```
$ node tools/biz-smoke.cjs                     → [BIZ-SMOKE] 结果: 93/93 通过 ✓   exit 0
$ node tools/prescriptions-db-diff-test.cjs    → === 结果: 16 通过, 0 失败 ===     exit 0
$ node tools/diff-cross-version.cjs            → 全部 4 对基线检查完成            exit 0
  [desk]       Tier A 32/11 | Tier B 213 | Tier C 55（= 基线）[OK] 三层基线全绿
  [siteadmin]  Tier A 160/111 | Tier B 63 | Tier C 77（= 基线）[OK] 三层基线全绿
  [download] / [adminconsole] 仅 A/B 侧行 0 → [OK]
```
**15:00 左右的同一条门禁曾是 RED，如实记录**（当时 Lead 正在改离线端 `index.html`）：
```
[cross-version:desk][RED] 1 项：[Tier B] getGlobalMaxSerial — 同体函数单边改动
[cross-version:siteadmin][RED] 2 项：[Tier A] initPrescriptionsReadyGate / markPrescriptionsReady 仅 public/index.html 存在
```
- desk 项**已真正收敛**：我自写脚本抽取两侧函数体比对 → `public/index.html:6310` 与 `app_project/db-offline/desktop/index.html:5846` 的 `getGlobalMaxSerial` **115 行逐字节相同**（`node tools/_verify-gms-diff.cjs` → `函数体逐字节相同 = true`）。
- siteadmin 项**是被"重冻结基线"关掉的，不是移植掉的**：`site-admin/index.html` 至今 `initPrescriptionsReadyGate=0 / markPrescriptionsReady=0 / syncPrescriptionsDBDiff=0`，而 `tools/.cross-version-baseline-siteadmin.json`（mtime **15:03:25**，git 显示 M）已把这三个函数列入接受清单；`tools/.cross-version-baseline.json`（mtime 15:03:09，M）同步 +4/-2。报告只陈述事实：该对的绿=**已确认分叉**，非"双侧一致"。
- 两处 RED 均落在 `index.html`（P1-④ 处方就绪闸），与本次审计的 `cloud.js` / `admin-account.js` **无交集**。

**D = 当前修订 PASS（附上述基线重冻结说明）。**

## E. 未能证实 / 疑点（按影响排序）

1. **【整包残留·最需处置】热更产物仍是修复前版本。**
   `public/hot-update/desktop/cloud/auth-core.js`：381,996 B、sha256 `9C6A6254…`、mtime `2026-10-10 10:46:23`，与 `public/hot-update/desktop/cloud/version.json`（hotVersion `2026.10.10-6` / appVersion 1.2.267）里 `auth-core.js` 的 sha256 **完全一致**，且含旧语义（24h 节流 / 只补空 / `!cu.clinicExpiresAt` 早退）。
   我**未能证实**该目录是否会在本轮发布流程中被 `tools/generate-desktop-hotupdate.cjs` 重新生成——但**当前仓库状态就是旧包**：若不重建并推送，走热更的云桌面用户会继续看到「未激活/已缓存」。
2. **【注释与实现不符】** 函数头 `cloud.js:3330-3331 / 3355-3356 / 3378` 声称"网络失败/401 不吃掉 6h 窗口"。实测：**fetch reject 时 `__lastProfileFetchAt` 不回滚**（异常从内层 `try` 直穿外层 `catch`，跳过 L3379），同一页面会话内后续渲染一律 throttled 不再重试（B7/B10：`1 → 1`）。401 确实回滚（但见 6）。对照旧包行为相同（B10 新旧一致）→ **既有缺陷，注释不该声称已修**。
3. **【在途重开设置会停在 stale】** 首次自愈未返回时用户关闭/重开基础设置：第 2 次渲染因节流命中 `{ok:false,throttled:true}` 且用的是**未回写缓存前的 `cu`**，而第 1 次渲染因 `reqId` 被丢弃 → 服务端已成功、缓存已回写，界面仍停在「⏳ 未激活/旧缓存」+ 误导性"请检查网络"提示，需**再开一次**设置才正确（B6b）。
   同 tick 并发两次渲染也会出现同样结果（B6a：get-profile 只 1 次，去重有效，但获胜的那次渲染 stale）。
   `public/index.html` 只有 1 个调用点（`showModal('settingsModal')`，L9196），**未证实**真实用户能在同一会话里稳定触发；但"第一次打开设置 → 网络慢 → 关掉重开"是常见动作。
4. **【无 token 即不自愈】** `refreshCloudProfile` 要求 `cu.token`；`handleLogin` 的本地表登录路径在"云端补拉 token 失败"时不写 `auth:currentUser`（`public/index.html:3329`），若 localStorage 命中无 token 的用户对象，则**一次请求都不发**，恒显示「⏳ 未激活/旧缓存」（B9）。我**未证实**目标客户（15200069705）属于该形态（其缓存里有 `clinicExpiresAt`，说明有 token）。
5. **【服务端显式清空不会同步】** 服务端 `clinicExpiresAt=null` 时 `__set` 跳过 → 本地旧到期日保留，界面显示「✅ 已激活 剩余 363 天」（B8）。不是"未激活"文案，但仍是旧值；`__set` 对 `null/''` 一律"不覆盖"的语义边界在此暴露。
6. **【401 的 ok 语义反了】** `cloud.js:3438` 在 `data.success=false`（401）时返回 `{ok:true, changed:false}`，于是 401 不显示"联网校验未完成"提示（B4b 观察 = false），与网络失败路径表现不一致；且 401 时窗口会被回滚 → 每次打开设置都会重打一次 401 接口（未加验证的推断，基于 L3372/L3379 逻辑）。
7. **【索引缺失不自建】** C6：`license_clinic_index` 键整体不存在时，第 ⑤ 步只回填码记录的 `clinicName`，不会重建索引（依赖读侧全扫兜底）。若线上该键曾被清空，本次回填后索引仍为空。
8. **【异常静默】** C4 的 KV 读异常被 `getLicense(...).catch(()=>null)` 吞掉，外层 catch 的 warn 不会触发 → 线上无任何日志线索（`admin-account.js:795、808`）。
9. **未验证的运行环境**：B/C 全部为 node:vm + mock（零网络/零真实 KV）。**未做**：真实生产 KV 抽查（本轮客户 `clinic_o67d5eqv1r` 的 `license_clinic_index` 是否已含其码）、真实 Cloudflare Pages `get-profile` 端到端、Electron/APP 三端真机、`e2e/taobao-auto-activate.cjs` 等其它 e2e。
10. **复核窗口内的文件变动**：复核期间 `app_project/db-offline/desktop/index.html`（15:02:55）与两个 `.cross-version-baseline*.json`（15:03:09 / 15:03:25）被改写，我的 D 项结论只对上面列出的哈希修订负责。

## 残留路径清单：客户是否仍可能看到「未激活/已缓存」

| # | 路径 | 证据 | 自愈条件 | 是否本次引入 |
|---|---|---|---|---|
| 1 | 热更包仍是旧代码（`hot-update/desktop/cloud/auth-core.js`） | E-1 | 重建并推送热更包 | 否（发布流程缺口） |
| 2 | 首次自愈网络失败/超时 → 同会话 6h 内不再重试 | B7、B10 | 重开页面/重启客户端；或 6h 后 | 否（既有，注释误称已修） |
| 3 | 自愈在途时重开设置 → 界面停在 stale | B6b、B6a | 再开一次设置（缓存其实已修好） | 否（新逻辑扩大了暴露面：现在登录用户都会发起自愈） |
| 4 | 登录缓存无 token | B9 | 重新登录 | 否 |
| 5 | 服务端 `clinicExpiresAt=null` 时本地旧值不被清 | B8 | 服务端给出有效值 | 否（新语义的边界） |

**"服务端成功 → 缓存被覆盖 → 后续渲染正确"这条主链路已由 B1/B2 证明成立**，本次修复对原始投诉是有效的；上述 5 条均为边界/环境/发布产物问题，其中 **#1 是唯一"整包旧逻辑"级别**的残留。

## 复核产生的临时文件（未提交，Lead 决定去留）

- 测试/工具：`tools/_verify-profile-refresh.cjs`（B/E 用例，44 项）、`e2e/.tmp/verify-renew-license-backfill.mjs`（C，29 项）、`tools/_verify-bundle-sync.cjs`（源↔包一致性）、`tools/_verify-gms-diff.cjs`（desk 漂移归因）
- 证据输出：`_verify-out-new-bundle.txt`、`_verify-out-old-bundle.txt`、`_verify-out-biz-smoke.txt`、`_verify-out-dbdiff.txt`、`_verify-out-crossver.txt`
- 已删除：`tools/_verify-old-auth-core.js`（HEAD 旧包副本，避免旧代码污染仓库检索）

---

# 附：Lead 处置与复审记录（复核之后，2026-10-10）

复核报告按原样保留在上方（历史事实），以下是**逐条处置结果**。最终状态以最新一轮门禁为准。

## 处置结果

| 复核项 | 处置 | 证据（可复跑） |
|---|---|---|
| E-1 热更包仍是旧代码 | ✅ **已重建**：`node tools/generate-desktop-hotupdate.cjs -c cloud` / `-c local` → cloud 最新 `hotVersion 2026.10.10-10`、auth-core sha `045b2b7e…`（含 `gotServerAnswer` / `isCacheAuthoritativeFor`，与磁盘逐字节一致）；并重刷 `cv` 参数 + `sync-html` + `sync-auth-core` 全链路。热版本号会随重建递增，**以 auth-core 的 sha 为准** | `Select-String -Path public/hot-update/desktop/cloud/auth-core.js -Pattern gotServerAnswer` → 3 处命中；`version.json` 的 sha == 磁盘 sha |
| E-2 注释与实现不符（窗口未回滚） | ✅ **已真修**：窗口占用与回滚并入同一对 `try/finally`，以 `gotServerAnswer` 判定 | 门禁 ⑰ P8「失败后第二次渲染会重试」PASS |
| E-3 在途重开设置/同 tick 并发停在 stale | ✅ **已真修**（根因有两层）：① 新增 `isCacheAuthoritativeFor`，在"节流命中"与"共享在途请求"两条路径上都先判定缓存是否已比本地快照权威；② joiner **必须等 owner 落地后**再回读缓存；③ 渲染前按缓存归一授权字段 | 门禁 ⑰ P7（同 tick 并发 + 在途重开两条）PASS |
| E-4 无 token 不自愈 | ✅ **已缓解**：`getCloudAccountLicenseHtml` 定向补读 `auth:currentUser` 的 token；仍无 token 才放弃 | 门禁 ⑰ P9 明确记录该残留（需重新登录） |
| E-5 服务端 `clinicExpiresAt=null` 不清本地旧值 | ⏸ **有意保留**：服务端"未提供"不能证明"应清空"（平台管理员本无到期时间），清空反而会把已激活用户打回未激活 | 已在文档 11.2b 记录为语义边界 |
| E-6 401 返回 ok:true → 不显示提示 | ✅ 已修：`!__srvUser` 时返回 `ok:false` | 门禁 ⑰ P4 401 分支 |
| E-7 索引键整体缺失时不重建索引 | ⏸ **不改**：`maintainClinicIndexOnSave` 对脏/缺失索引整体跳过属既有"绝不写假索引"安全设计，读侧全扫回填 | 门禁 ⑯ C6/C7 记录边界 |
| E-8 KV 读异常静默 | ✅ 已修：显式 warn（`[TaobaoRenew] 读回码记录失败…`） | 门禁 ⑯ C1/C2（跑测试时可见该 warn） |

## 复审证据（全部可复跑，均 exit 0）

```
node tools/auth-status-refresh-test.cjs        # 新增门禁 ⑰：授权状态自愈行为（真实上线包，vm）
node tools/license-renew-backfill-test.cjs     # 新增门禁 ⑯：续费回填 clinicName + 诊所→码索引（mock KV）
node tools/prescriptions-ready-gate-test.cjs   # 新增门禁 ⑮：P1-④ 收口点 fail-closed（六端）
node tools/biz-smoke.cjs                       # 93/93
node tools/prescriptions-db-diff-test.cjs      # 16/16
node tools/diff-cross-version.cjs --quiet      # 4 对基线全绿
node tools/check-cv-hashes.cjs                 # 15 个业务 JS cv 全一致
powershell -File tools/sync-auth-core.ps1 -VerifyOnly   # 11 副本一致
powershell -File tools/sync-all.ps1 -VerifyOnly         # shared 模块一致
powershell -File tools/html-sync-check.ps1              # HTML 副本一致
node tools/copy-consistency.cjs                # 100 副本 0 失败
```

## 复核临时文件的去留

- 复核员的 `tools/_verify-profile-refresh.cjs`（44+7 项）→ 已归档到 **`_verify/_verify-profile-refresh.cjs`**（保留原始证据脚本，不进门禁）。
- 复核员的 `e2e/.tmp/verify-renew-license-backfill.mjs`（29 项）→ 保留在 `e2e/.tmp/`（该目录本就未跟踪）。
- `tools/_verify-bundle-sync.cjs` / `_verify-gms-diff.cjs` / `_verify-out-*.txt` → **已删除**（其结论已固化为上面的永久门禁 ⑯⑰；证据脚本本身可复现）。
- 其覆盖的语义已**升级为永久门禁**：⑯（服务端续费回填）+ ⑰（授权状态自愈行为）。
