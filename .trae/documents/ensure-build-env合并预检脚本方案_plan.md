# ensure-build-env.ps1 合并预检脚本 实施计划

> 背景：P0 方案，把分散在 4 个打包入口里的 7 套独立预检脚本（fix-ps1-bom、verify-packaging、verify-version-display、verify-app-version-consistency、verify-no-hardcoded-clinic、pre-build-check、pre-flight-check）+ 磁盘空间检查，
> 合并成一个统一入口脚本 `tools/ensure-build-env.ps1`，彻底消除"一个脚本漏了但另一个脚本没跑"的错序/漏跑/参数错位问题。

---

## 一、仓库研究结论（脚本现状与调用点盘点）

### 1.1 当前 7+2 套预检/检查脚本

| # | 脚本 | 语言 | 退出码 | 参数 | 当前调用位置 | 检查对象 |
|---|------|------|--------|------|-------------|----------|
| 1 | `tools/fix-ps1-bom.ps1` | PS | 0 | 无 | 云端APP build-app.bat:L6、离线APP build-app.bat:L4（桌面 build.bat **根本没跑**！） | 给所有 .ps1 补 UTF-8 BOM |
| 2 | `tools/verify-packaging.ps1` | PS | 0/1 | 无 | **从未在任何打包脚本中被调用**（只在手动发布前跑） | .ps1 BOM / .html 禁BOM / .bat ASCII+chcp65001 / .gradle 禁BOM / index 副本一致性 |
| 3 | `tools/verify-version-display.ps1` | PS | 0/1 | 无 | **从未在任何打包脚本中被调用** | 8 处版本标识（V1.0.0 token）全界面副本是否一致 |
| 4 | `tools/verify-app-version-consistency.ps1` | PS | 0/1 | `-Target cloud/offline/all -RepoRoot` | 云端APP [0/10] (L46-52)、离线APP [0/10] (L47-49)；**桌面 build.bat 完全漏跑！** | __APP_VERSION__ 三要素/两要素一致性 |
| 5 | `tools/verify-no-hardcoded-clinic.ps1` | PS | 0/1 | `-RepoRoot` | 云端APP [0.5/10] (L58-64)、离线APP [0.5/10] (L55-57)；**桌面 build.bat 完全漏跑！** | 诊所名/医师名硬编码反模式 3 类 |
| 6 | `tools/pre-build-check.js` | Node | 0/1 | `<project-dir>` | 云端桌面 [6/9] (L124-132)、离线桌面 [6/9] (L124-132)；**APP build-app.bat 不适用**（无 package.json build.files 概念） | package.json files × index.html 引用 / 磁盘存在性 / 版本标签身份 / IPC 一致性 |
| 7 | `tools/pre-flight-check.ps1` | PS | 0 | `-Target -AppDir -DesktopDir` | 云端桌面 L148（传 DesktopDir）、离线桌面 L148（传 DesktopDir）、云端APP L136（传 AppDir）、离线APP L73（传 AppDir） | .build_vcode_prev / .bak 还原 / certbak / dist_old_* / .gradle configuration-cache / 残留进程文件 |
| 8 | 磁盘空间检查（内嵌） | CMD + PS | 1 / 0 | 无参数 | 云端桌面 L135-144、离线桌面 L135-144；**APP 完全漏跑**！ | 剩余磁盘空间 ≥ 1 GB |
| 9 | `.gitattributes` renormalize（四十二） | `git reset --mixed HEAD` + `git add -u` | - | - | **从未在打包前被强制执行**，靠手工偶尔跑 | 清陈旧 LF/CRLF 索引，杜绝假改动 |

### 1.2 四个打包入口的脚本调用顺序现状

```
cloud_desktop/build.bat（9步）
 ├─ [5/9] bump-version
 ├─ [6/9] pre-build-check.js       ←  只有 6 号
 ├─ disk-space                     ←  只有 8 号
 └─ pre-flight-check.ps1 (Desktop) ←  只有 7 号
 → 1/2/3/4/5/9 全部 **漏跑**

db-offline/desktop/build.bat（9步）  同上，漏跑 1/2/3/4/5/9

db-yunduan/build-app.bat（10步）
 ├─ fix-ps1-bom                     ←  只有 1 号
 ├─ [0/10]  verify-app-version(cloud)   ←  4号
 ├─ [0.5/10] verify-no-hardcoded-clinic  ←  5号
 └─ pre-flight-check (AppDir)          ←  7号
 → 2/3/6(不适用)/8/9 漏跑

db-offline/app/build-app.bat（10步）
 ├─ fix-ps1-bom                     ←  只有 1 号
 ├─ [0/10]  verify-app-version(offline)  ←  4号
 ├─ [0.5/10] verify-no-hardcoded-clinic  ←  5号
 └─ pre-flight-check (AppDir)          ←  7号
 → 2/3/6(不适用)/8/9 漏跑
```

### 1.3 问题总览（合并的必要性）

1. **桌面 build.bat 从未跑 fix-ps1-bom**：Edit 工具改桌面 .ps1（如 packaging.ps1）会剥 BOM，后续打包直接 PowerShell 5.x 解析失败 → 曾导致多个"Unexpected token '}'"类解析错误。
2. **桌面 build.bat 从未跑 3 项（版本三要素 / 诊所名反模式 / 版本展示8处）**：
   - 曾在记忆四十九出现"云端桌面被打成标准版标签"（版本身份校验应更早 fail-fast，pre-build-check.js 已经有这部分但它**只在 [6/9] 跑**，前面 bump-version 已经根据旧标签涨版本了）；
   - 诊所名硬编码反模式（记忆三十七）理论上桌面打包前也应该阻断，但从未被检查；
   - 8 处版本展示不一致（记忆十二）纯靠手工回忆，根本无法强制。
3. **APP build-app.bat 从未检查磁盘空间**：`.gradle configuration-cache 残留已清理` 就是因为 APP 打包磁盘不足触发中断 → 用户刚遇到的 pre-flight 输出。
4. **LF/CRLF renormalize（记忆四十二）从未在打包前执行**：导致 git diff 出现一堆"看上去改动实际没改"的假改动，混淆发布审核。
5. **verify-packaging.ps1（BOM/.bat ASCII/.gradle BOM）从未被任何打包入口触发**：.bat 加了中文注释没加 chcp 65001 → CMD 下乱码报错（记忆 50.5）。
6. **入口顺序不统一**：桌面先 bump-version，身份校验却在 pre-build-check.js（6/9）里最后才做——**涨完版本才发现是旧包等于白涨**。正确顺序必须先"版本/身份/反模式"门禁，通过后才 bump。

---

## 二、合并设计方案

### 2.1 新脚本接口与参数

```powershell
# tools/ensure-build-env.ps1
param(
    [ValidateSet('cloud-desktop','offline-desktop','cloud-app','offline-app')]
    [Parameter(Mandatory=$true)]
    [string]$Target,              # 当前正在打包哪个端（决定子项启用/跳过）
    [string]$DesktopDir = "",     # 桌面 build 目录（对应桌面 Target 必填，APP 可空）
    [string]$AppDir     = "",     # Android 项目目录（对应 APP Target 必填，桌面可空）
    [string]$RepoRoot   = "",     # 默认自动向上找 .git
    [double]$MinDiskSpaceGB = 1.0,# 磁盘空间阈值（桌面 1G、APP 建议 5G）
    [switch]$SkipBomFix,          # 纯校验环境，不修复 BOM（只报 FAIL）
    [switch]$SkipRenormalizeGit   # 跳过 LF/CRLF renormalize（供 CI/手动调试用）
)
```

### 2.2 统一 8 步执行顺序（严格按"越早 fail-fast 越靠前"原则）

```
步骤 0  ── 初始化 & 参数规范化（复用五十一：DesktopDir/AppDir Trim 引号和尾反斜杠、RepoRoot 自动定位）
步骤 1  ── Git LF/CRLF renormalize 预检 + 清陈旧索引（四十二，不做 commit 仅 reset+add -u --renormalize）
步骤 2  ── UTF-8 BOM 修复（fix-ps1-bom 逻辑内嵌；.ps1=必须有、.html/gradle=必须无；BOM 缺失默认修复，-SkipBomFix 则只 FAIL）
步骤 3  ── 编码校验（verify-packaging Check 3 逻辑内嵌：.bat ASCII-only 或 UTF-8+chcp65001）
步骤 4  ── 版本身份&版本号门禁（**按 Target 裁剪**）：
            4a. verify-no-hardcoded-clinic（诊所名/医师名反模式扫描 — 所有 Target 都跑）
            4b. verify-version-display（8 处版本展示 V token 一致性 — 所有 Target 都跑）
            4c. verify-app-version-consistency（按 Target 跑 cloud 组/offline 组）
            4d. 桌面 Target：内嵌 pre-build-check.js 的"版本标签身份校验段"(L208-254) — APP 不适用跳过
步骤 5  ── 包完整性门禁（**按 Target 裁剪**）：
            桌面 Target：调 node tools/pre-build-check.js <DesktopDir>（包含 files 覆盖 / 磁盘存在 / IPC）
            APP   Target：APP 资源存在性 quick-check（signing.properties / app-release.jks / capacitor.config.json / gradlew.bat）
步骤 6  ── 残留清理（pre-flight-check 全部逻辑内嵌，按 Target 决定 AppDir/DesktopDir 传哪路）
步骤 7  ── 磁盘空间检查（桌面端 1 GB / APP 端 5 GB；APP 侧之前从未有此门禁）
步骤 8  ── 汇总输出（PASS / FAIL × 数量 / WARN × 数量 / 修复指引）
         exit 0 = 全通过；exit 1 = 至少 1 项 FAIL（无任何 FAIL 即使有 WARN 也 exit 0 = 分级宁漏检不误报）
```

### 2.3 **关键顺序变更说明（对比现状的纠正）**

| 现状 | 问题 | 合并后纠正 |
|------|------|------------|
| 桌面 build.bat 先 bump-version（5/9） → 后身份校验（嵌在 pre-build-check.js 6/9 尾部） | 身份错了版本号白涨，下次 sync-app-version 可能把错版本同步到 APP | 4c/4d 身份门禁放在 bump-version 之前（调用方把 ensure-build-env 放在 [x/9] 的 bump-version 之前） |
| 桌面 build.bat 不跑 fix-ps1-bom → 打包后 packaging.ps1 BOM 丢失导致 50.5 类解析错 | BOM 问题在"最后一步才触发"时已经把打包跑了 20 分钟 | 放在步骤 2 最前面，任何 BOM 问题先修复再做任何事 |
| APP build-app.bat 不跑磁盘空间 → Gradle 构建中途磁盘不足 .cxx cache 损坏 | 必须清 cache 重来；pre-flight 还要清理 configuration-cache | 步骤 7 在任何 gradlew 之前先 fail-fast |
| verify-packaging / verify-version-display 从未被打包入口触发 → 8 处版本标识/编码规范全靠自觉 | 出现过"改了 4 处漏了 4 处"用户反馈后反复修正 | 纳入步骤 3/4b 全量强制门禁 |
| `.gitattributes` renormalize 从未执行 → git add 出现数百文件假改动，`git add -u` 无法判断真实改动（三十九） | 发布审核时"不敢提交" | 步骤 1 在任何预检之前先 `git reset --mixed HEAD`（清陈旧索引）→ `git add -u --renormalize`（按 .gitattributes 重新索引），不提交不改工作区文件，**只更新 index** |

---

## 三、影响范围与文件改动

### 3.1 新增文件（1 个）

- **`tools/ensure-build-env.ps1`**：8 步统一预检脚本（详见 2.2）。内部以"函数封装子步骤 + 汇总状态表"实现：
  - 函数：`Step-BomFix`、`Step-EncodingCheck`、`Step-VersionGate`、`Step-PackageIntegrity`、`Step-PreflightCleanup`、`Step-DiskSpace`、`Step-GitRenormalize`
  - 状态表：`$script:Steps = @([PSCustomObject]@{Id;Name;Status='PENDING';Failures=@();Warnings=@();Duration})`
  - 输出格式与现有各脚本风格一致（`[OK]/[WARN]/[FAIL]`），避免用户视觉割裂

### 3.2 修改文件（4 个 build.bat + 2 个备选打包入口 + 4 个 APP/桌面 build.bat 已覆盖；one-click-pack.ps1 / pack.ps1 已在 Grep 结果里调用零散脚本，本次一并改）

共需修改 **6~8 个调用点**：

| 文件 | 替换说明 |
|------|---------|
| `app_project/db-yunduan/cloud_desktop/build.bat` | **删除**当前 L6 的"pre-build-check.js 独立调用"、L135-144 磁盘空间、L147-148 pre-flight-check 三处散调用。在 [5/9] auto-bump 之前插入：`powershell ... ensure-build-env.ps1 -Target cloud-desktop -DesktopDir "%~dp0"`；退出码非 0 → exit /b 1。|
| `app_project/db-offline/desktop/build.bat` | 同上，Target = `offline-desktop`。在 [5/9] auto-bump 之前插入。|
| `app_project/db-yunduan/build-app.bat` | **删除**L5-6 fix-ps1-bom、L46-52 verify-app-version、L58-64 verify-no-hardcoded-clinic、L135-136 pre-flight-check 四处散调用。在配置诊所/环境检查（[0.6/10] 之后）之前插入：`powershell ... ensure-build-env.ps1 -Target cloud-app -AppDir "%ANDROID_DIR%" -MinDiskSpaceGB 5.0`。|
| `app_project/db-offline/app/build-app.bat` | 同上，Target = `offline-app`，MinDiskSpaceGB = 5。|
| `tools/one-click-pack.ps1` | 已通过 build.bat / build-app.bat 间接触发，无需改；但需检查其内部是否有直接调用 7 脚本中的任何一个 → 若有一并删除改为 ensure-build-env（用 grep 已确认 `one-click-pack.ps1` 现在调用了 edit-config 和 packaging 等，但没有直接调用 7 脚本，故不用改）。|
| `tools/pack.ps1` | 直接调用 pre-flight-check.ps1 两次（L601 / L930），这两处**替换为** ensure-build-env 相应 Target（L601 对应 desktop、L930 对应 app）。|

> **保守原则**：原 7 个散脚本 **都不删除**，只不再被打包入口调用。一来 ensure-build-env 内嵌了它们的逻辑但用户仍可手动 `pwsh -File fix-ps1-bom.ps1` / `verify-*` 快速单跑；二来出问题时能直接回退调用点，不用恢复脚本文件。

### 3.3 不改动文件

- 7 套原有预检脚本本体（`fix-ps1-bom.ps1`、`verify-packaging.ps1`、`verify-version-display.ps1`、`verify-app-version-consistency.ps1`、`verify-no-hardcoded-clinic.ps1`、`pre-build-check.js`、`pre-flight-check.ps1`）——保留为"单跑入口"。
- 不改动任何 index.html / .css / DOM 结构（硬约束五/二十六条）。
- 不改动 login.html UI / 界面脚本（硬约束五）。

---

## 四、实现步骤（严格依赖顺序）

1. **Step 1（编码保障前置）**：先写 ensure-build-env.ps1 骨架（param、UTF-8 BOM、步骤状态表、总 exit 逻辑），**立刻运行 fix-ps1-bom.ps1 保证新脚本有 BOM 再继续填充逻辑**（防范五十一类 BOM 丢失陷阱）。
2. **Step 2（内嵌子步骤函数）**：把 7 套脚本和 2 项检查的逻辑**搬入为函数**（不做功能增强，1:1 等价嵌入，避免改动引入 bug）——函数内部直接复用原有正则/退出条件/扫描文件列表，必要时把 node `pre-build-check.js` 和 git renormalize 用 `& node` / `& git` 子进程调（这样不用 1:1 翻译 JS 到 PS，风险最低）。
3. **Step 3（Target 分流逻辑）**：根据 `-Target` 决定 4a/4b/4c/4d 和 步骤 5 哪些跑、哪些 SKIP 并打 [SKIP] 日志。
4. **Step 4（汇总与退出码分级）**：
   - FAIL > 0 → `exit 1` 并打印"修复指引：对应哪个原脚本如何手动修"
   - WARN ≥ 0 且 FAIL = 0 → `exit 0`（分级原则：宁漏检不可误报，与所有 verify-* 一致）
5. **Step 5（调用点替换·批处理 4 个）**：
   - 桌面 2 个 build.bat：把 bump-version 行之前插入 ensure-build-env，删除散的 pre-build-check.js / 磁盘空间 / pre-flight 三段
   - APP 2 个 build-app.bat：删除 fix-ps1-bom / verify-app-version / verify-no-hardcoded / pre-flight 四段，插入 ensure-build-env 一段
6. **Step 6（调用点替换·pack.ps1 2 处）**：pack.ps1 L601/L930 直接调 pre-flight-check → 改为 ensure-build-env -Target xxx。
7. **Step 7（语法验证）**：跑 `tools/_check-syntax.ps1` 对新 ensure-build-env.ps1 和 4 个 build.bat 做语法检查；跑 `verify-packaging.ps1` 确认 .bat 合规。
8. **Step 8（端到端 dry-run 验证）**：
   - 对 4 个 Target 分别 dry-run：`powershell -NoProfile -ExecutionPolicy Bypass -File tools/ensure-build-env.ps1 -Target cloud-desktop -DesktopDir "app_project/db-yunduan/cloud_desktop/"`（故意传尾部反斜杠路径，验证五十一规范化生效）
   - 验证顺序是否严格按 2.2 的 0~8 步、退出码正确。
9. **Step 9（BOM 保险 + 提交）**：再跑一遍 fix-ps1-bom.ps1 确认新 .ps1 BOM 仍存在，提交。

---

## 五、依赖关系与注意事项

1. **必须遵守"1:1 嵌入逻辑，不增强功能"原则**：本次合并目的是统一入口，不是改规则。任何预检的判定条件、扫描文件列表、WARN/FAIL 分级全部照搬原脚本。只有一个例外——步骤顺序的重排（bump-version 前先做身份门禁），这属于修复流程 bug，不改变任何校验本身。
2. **原 7 个散脚本保留文件**：ensure-build-env 内嵌其逻辑但不替代掉"手动单跑入口"，避免老用户肌肉记忆敲 `fix-ps1-bom.ps1` 时报找不到。
3. **pack.ps1 中 2 处直接调 pre-flight-check.ps1** 可能被包装在 `& "$PSScriptRoot\pre-flight-check.ps1"` 的 try/catch 里；替换为 ensure-build-env 后要保留同等 try/catch 语义。
4. **对步骤 1 的 git renormalize**：只做 index 更新（`git reset --mixed HEAD` + `git add -u --renormalize`），**绝不 `git commit`**，因为记忆四十二明确"此步只清陈旧索引，不做提交"，改动留待用户/下一次脚本自己决定提交时机（如 one-click-pack.ps1 最后有自己的 git add/push）。
5. **`-MinDiskSpaceGB` 默认 1 GB 但 APP 端强制用 5 GB**（在调用点传 5），Gradle 冷构建 + NDK 编译确实需要 3~4 GB 空闲（记忆里"configuration-cache 残留"就是磁盘不足）。
6. **.gitattributes 先检查文件是否存在**（仓库根下），不存在则跳过步骤 1 并 WARN，不误报（符合分级原则）。

---

## 六、验证（完成后必跑清单）

### 6.1 脚本自身语法与编码验证
- `powershell -File tools/fix-ps1-bom.ps1` → ensure-build-env.ps1 显示 `[OK] BOM present`
- `powershell -File tools/verify-packaging.ps1` → Check1/3 对 ensure-build-env.ps1 与 4 个修改后的 build.bat 均 PASS
- `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content tools/ensure-build-env.ps1 -Raw | Out-Null"` → 无 `Unexpected token` 解析错误

### 6.2 四 Target dry-run（退出码 = 0，日志里 8 步按序输出）
```powershell
powershell ... ensure-build-env.ps1 -Target cloud-desktop    -DesktopDir "app_project/db-yunduan/cloud_desktop/"
powershell ... ensure-build-env.ps1 -Target offline-desktop  -DesktopDir "app_project/db-offline/desktop\"
powershell ... ensure-build-env.ps1 -Target cloud-app        -AppDir     "app_project/db-yunduan/cloud_app" -MinDiskSpaceGB 0.001 # 磁盘阈值极小，强制 FAIL 验证分支走得到
powershell ... ensure-build-env.ps1 -Target offline-app      -AppDir     "app_project/db-offline/app/app" -MinDiskSpaceGB 0.001
```
- 第一二项 exit 0；第三四项 exit 1（磁盘不足 FAIL 分支必须能正确走）。

### 6.3 异常参数健壮性（五十一修复验证）
```powershell
powershell ... ensure-build-env.ps1 -Target cloud-desktop -DesktopDir 'D:\trae_projects\kyt-zy\app_project\db-yunduan\cloud_desktop\"'
```
- 必须**不报** `Test-Path: Illegal characters in path`；退出码 0。

### 6.4 发布前 interface baseline 保护（硬约束八）
- 实现完后跑 `check-interface.bat` 两次：第一次生成基线、第二次对比，确保 `ensure-build-env.ps1` 与 4 个 build.bat 改动**不碰任何 index.html**，WARN = 0。

---

## 七、风险与回滚

| 风险 | 发生概率 | 处理方式 |
|------|---------|---------|
| 1:1 嵌入时某个 verify-* 的正则/扫描范围被改错，导致预检与之前行为不一致（P0 合并最怕"看起来一样实际不一样"） | 中 | 每嵌入完一个子步骤，用 `git diff` 对比 ensure-build-env 内该段与原脚本的**扫描文件列表、正则、FAIL 条件是否完全一致**；不一致立即修。 |
| git renormalize 步骤导致 `git diff` 出现大量"已 stage 未 commit"的假改动，让打包脚本最后的 git push 把不该推的文件推上去 | 中 | 只做 `git reset --mixed HEAD` 清 index → `git add -u --renormalize` 更新 index → 最后**立即 `git reset --mixed HEAD` 再次清 index**（双重保险，只做"验证 .gitattributes 能正常 renormalize"不保留 staged）。记忆四十二也推荐这种"reset 清陈旧索引后再 renormalize"。 |
| Desktop 端突然出现 `verify-no-hardcoded-clinic / verify-app-version-consistency FAIL`（之前从未跑过，合并后第一跑可能就拦住打包） | 高（预期！） | 这**就是合并要达到的效果**——本来就该 fail-fast 拦截。在计划审批阶段就告知用户：合并后第一次手动打包若出现"新的 FAIL"，请按提示修复源码再跑，不要怀疑是预检脚本的 bug。 |
| APP 端 5 GB 磁盘阈值一上来就拦住老电脑（用户构建盘空间不足） | 低 | -MinDiskSpaceGB 由调用点传入，紧急时用户可以手动在 APP build-app.bat 的调用行里改成 3 GB 临时绕过；同时 ensure-build-env 失败提示里加一行"紧急时改脚本 MinDiskSpaceGB 参数可临时放宽"。 |
| 把散脚本删除/调用点清理不干净 → 某脚本既在 ensure 里跑、又在调用点里重复跑一次（多花时间但不会错） | 低 | 在 6.3 干跑后 grep 调用点的散脚本调用（`pre-build-check\.js|fix-ps1-bom|verify-app-version-consistency|verify-no-hardcoded-clinic|pre-flight-check`），除了 tools/ 目录下"脚本本体"的文件匹配外，**build*.bat / pack*.ps1 中匹配必须为 0**。 |

### 回滚方案（单条命令即可全部还原）
```powershell
git checkout HEAD -- `
  app_project/db-yunduan/cloud_desktop/build.bat `
  app_project/db-offline/desktop/build.bat `
  app_project/db-yunduan/build-app.bat `
  app_project/db-offline/app/build-app.bat `
  tools/pack.ps1 `
  ; git clean -f tools/ensure-build-env.ps1
```
所有改动只限定在 5 个调用点 + 1 个新增脚本，全部还原后打包行为与当前版本完全一致（散脚本都保留在 tools/，调用点恢复为散调用）。
