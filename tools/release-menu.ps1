# release-menu.ps1 - 交互式发布菜单（支持选择单个版本发布）
# 用 PowerShell 替代 release-all.bat，避免 .bat 中文 GBK 编码问题
# 支持选择单个版本（云端/定制/个人 × 桌面/APP/全部）进行发布
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$script:RootDir = $PSScriptRoot | Split-Path -Parent
if (-not (Test-Path "$script:RootDir\tools\publish-release.js")) {
    $script:RootDir = Split-Path $PSScriptRoot -Parent
}

# ★ 2026-09-08 红字降噪（单一权威源 tools/noise-reduce.ps1）：PS 5.1 host 把未捕获的
#   子进程 stderr 一律渲染红色（小白高频误报"发布失败"）。本脚本所有子 PowerShell /
#   cmd / node 调用统一经 Write-HostLine / Invoke-QuietProcess 渲染，stderr 转黄/白，
#   真失败仍由 [ERROR]/[FATAL]/发布失败横幅显式标红。
. (Join-Path $PSScriptRoot 'noise-reduce.ps1')

$env:NO_PAUSE = '1'

# ★ 2026-10-29 发布日志持久化（对齐 one-click-pack 的 Start-Transcript）：
#   背景：用户「一键发布失败」时窗口一关即无任何取证材料（发布菜单此前不落盘），
#   无法判断是打包跳过、上传失败还是验证网络问题。现全程转录到
#   .build-cache\logs\publish-<时间戳>.log（保留最近 20 份），失败横幅回显路径。
$script:LogDir = Join-Path $script:RootDir '.build-cache\logs'
if (-not (Test-Path $script:LogDir)) { New-Item -ItemType Directory -Path $script:LogDir -Force | Out-Null }
$script:LogFile = Join-Path $script:LogDir ("publish-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$env:PUBLISH_LOG_FILE = $script:LogFile
try { Start-Transcript -Path $script:LogFile -ErrorAction Stop | Out-Null } catch { Write-Host "[WARN] 发布日志转录启动失败(不影响发布): $_" -ForegroundColor Yellow }
Write-Host "[LOG] 本次发布日志: $script:LogFile" -ForegroundColor DarkGray
Get-ChildItem $script:LogDir -Filter 'publish-*.log' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -Skip 20 | Remove-Item -Force -ErrorAction SilentlyContinue

# ★ 2026-09-01 中文暂停提示：覆盖内置 pause（英文 "Press Enter to continue..."），
#   本脚本所有 pause 调用点自动变为中文提示，无需逐处修改。
Remove-Item alias:pause -ErrorAction SilentlyContinue
function global:pause {
    $null = Read-Host '按回车键继续...'
}

# ★ 2026-09-05 防僵尸菜单（15:40 事故根因架构修复）：
#   非交互环境（stdin 被管道/重定向/自动化宿主关闭）调用交互菜单时，Read-Host 恒返回
#   $null → switch default → 死循环 Clear-Host+Read-Host，每秒刷一屏产生 170MB+ 僵尸日志。
#   统一菜单读入口：EOF 即明确报错退出并指引非交互入口。
#   注意：用户直接按回车返回 ""（空串，正常重显菜单）；EOF 才是 $null，二者严格区分。
function Read-MenuChoice([string]$Prompt) {
    $c = Read-Host $Prompt
    if ($null -eq $c) {
        Write-Host ""
        Write-Host "[FATAL] 标准输入已关闭：交互菜单在非交互环境（管道/自动化调用）中运行。" -ForegroundColor Red
        Write-Host "  非交互发布请用: node tools\publish-release.js --confirm --push --changed-only" -ForegroundColor Yellow
        Write-Host "  非交互打包请用: one-click-pack.ps1 -AutoMode 1|2|3|4 （1=云端 2=本地 3=全部 4=智能）" -ForegroundColor Yellow
        exit 1
    }
    return $c
}
# ★ 2026-08-24 打包验收门（tools/pack-gate.ps1）：语法/BOM/CRLF/编码 四道快检，
#   任一失败直接阻断（历史事故：本文件 BOM 丢失被 GBK 误读解析崩 / 打包链脚本语法错无人发现）
$gateToolRm = Join-Path $PSScriptRoot 'pack-gate.ps1'
if (Test-Path $gateToolRm) {
    $gateRc = Invoke-QuietProcess -FilePath 'powershell' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$gateToolRm,'-Mode','preflight')
    if ($gateRc -ne 0) {
        Write-Host ""
        Write-Host "[FATAL] 打包验收门未通过，发布/打包中止。请修复上述问题后重试。" -ForegroundColor Red
        pause
        exit 1
    }
}

# ★ 2026-10-30 P0 去重：打包增量基线/时间戳统一到 tools/pack-core.ps1（单一权威源）。
#   本菜单不再自带 Test-BuildSkip/Record-BuiltUnits：打包一律走子进程 one-click-pack.ps1
#   -AutoMode，基线（含 .build-cache/last-run.json）由子进程写入；父进程若再调用 Record
#   会用空 built 覆盖真值，导致打包菜单摘要失真。
. (Join-Path $PSScriptRoot 'pack-core.ps1')

# ★ [SELF-HEAL 2026-08-23] Fix LF line endings in ALL downstream build .bat files
# BEFORE invoking them. This script calls build-app.bat directly (bypassing
# pack-app-strict.bat entries), so the entry-level self-heal does NOT cover us.
# LF-corrupted Chinese .bat aborts cmd at parse time (window flash-close).
$fixTool = Join-Path $PSScriptRoot 'fix-bat-crlf.ps1'
if (Test-Path $fixTool) {
    # ★ 2026-10-30 P0 去重：下游 bat 清单单一权威源 tools/build-bat-list.ps1
    . (Join-Path $PSScriptRoot 'build-bat-list.ps1')
    $buildBats = @($DownstreamBuildBats | ForEach-Object { Join-Path $script:RootDir $_ } | Where-Object { Test-Path $_ })
    $null = Invoke-QuietProcess -FilePath 'powershell' -ArgumentList (@('-NoProfile','-ExecutionPolicy','Bypass','-File',$fixTool) + $buildBats)
}

# ============ 打包 ============
function Invoke-Pack {
    param([string]$Target)
    $packScript = "$script:RootDir\tools\one-click-pack.ps1"
    if (-not (Test-Path $packScript)) {
        Write-Host "[ERROR] 未找到打包脚本: $packScript" -ForegroundColor Red
        return 1
    }
    # ★ 2026-08-23 优化：传 -AutoMode 3 非交互执行"全部版本"打包（云端+本地顺序构建），
    #   完成后自动返回本菜单。原直接调用会弹出 one-click-pack 的嵌套交互菜单（菜单套菜单），
    #   用户需在子菜单选完再退出才能回到发布菜单，体验混乱。
    # ★ 2026-09-08 改 Invoke-QuietProcess：stdout 直连控制台不混入返回值（原管道方案颜色丢失），
    #   stderr 在 cmd 层合并进 stdout（PS host 不再染红）
    # ★ 2026-10-30 P0 去重：加 -AutoCommit，让子进程独占收纳版本副作用 + 写增量基线
    #   （.build-cache/last-run.json）。父进程不再事后 CollectSideEffectsOnly（会覆盖基线）。
    $packArgs = @('-NoProfile','-ExecutionPolicy','Bypass','-File',$packScript,'-AutoMode','3')
    if ($env:NO_AUTOCOMMIT -ne '1') { $packArgs += '-AutoCommit' }
    return Invoke-QuietProcess -FilePath 'powershell' -ArgumentList $packArgs
}

# ============ 单个版本打包（★ 2026-10-30 P0 去重：委托 one-click-pack -AutoMode）============
#   原 144 行自实现（编辑配置 / 源码落定门 / 增量检测 / 子 bat 调用）是 one-click-pack
#   -AutoMode 的第二份副本，且不写 .build-cache/last-run.json → 打包菜单摘要失真。
#   现统一委托（source-settled / pack-gate / skip / 副作用 / 基线 全部回归单一实现）。
function Invoke-SinglePack {
    param(
        [string]$Version,   # cloud / dingzhi
        [string]$Mode       # desktop / app / all
    )
    $packScript = "$script:RootDir\tools\one-click-pack.ps1"
    if (-not (Test-Path $packScript)) {
        Write-Host "[ERROR] 未找到打包脚本: $packScript" -ForegroundColor Red
        return 1
    }
    $autoMode = switch ("$Version/$Mode") {
        "cloud/desktop"   { '1d' }
        "cloud/app"       { '1a' }
        "cloud/all"       { '1' }
        "dingzhi/desktop" { '2d' }
        "dingzhi/app"     { '2a' }
        "dingzhi/all"     { '2' }
        default           { $null }
    }
    if (-not $autoMode) {
        Write-Host "[ERROR] 不支持的版本/范围组合: $Version / $Mode" -ForegroundColor Red
        return 1
    }
    $packArgs = @('-NoProfile','-ExecutionPolicy','Bypass','-File',$packScript,'-AutoMode',$autoMode)
    if ($env:NO_AUTOCOMMIT -ne '1') { $packArgs += '-AutoCommit' }
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  打包 $Version / $Mode（委托 one-click-pack -AutoMode $autoMode）..." -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    return Invoke-QuietProcess -FilePath 'powershell' -ArgumentList $packArgs
}


# ============ 发布 ============
function Invoke-Publish {
    param(
        [string]$Target,
        [string]$Mode = "all"   # desktop / app / all —— 发布范围（透传 --artifact 给 publish-release.js）
    )
    $publishScript = "$script:RootDir\tools\publish-release.js"
    if (-not (Test-Path $publishScript)) {
        Write-Host "[ERROR] 未找到发布脚本: $publishScript" -ForegroundColor Red
        return 1
    }

    $modeLabel = switch ($Mode) {
        "desktop" { "桌面 exe" }
        "app"     { "手机 APP" }
        default   { "全部产物" }
    }

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  发布到 GitHub Release + 下载页..." -ForegroundColor Cyan
    Write-Host "  Target: $Target  范围: $modeLabel" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  提示: 上传 75MB exe 需要 5-10 分钟，请耐心等待..." -ForegroundColor Yellow
    Write-Host "  提示: 若卡住无输出，可能是在上传大文件，请勿关闭窗口..." -ForegroundColor Yellow
    Write-Host "  提示: 发布前会自动执行合规检查，未通过则禁止上传（必守HARD规则）" -ForegroundColor Yellow
    Write-Host ""

    # ★ 必守HARD规则：手动发布 = --confirm（人工确认，内置跑合规门禁）+ --push（手动提交部署）
    # ★ 2026-08-23 修复：透传产物类型维度（--artifact）。原实现只传版本维度（--target），
    #   发布菜单选"本地版"时 dist/ 里上次构建的旧桌面 exe 也会被一并扫描上传
    #   （用户只打包 APP 却发布出旧 exe）。Mode=app → 仅 APK；Mode=desktop → 仅 exe。
    $publishArgs = @('--confirm', '--push')
    if ($Target -ne "all") { $publishArgs += "--target=$Target" }
    if ($Mode -eq "app")     { $publishArgs += "--artifact=app" }
    if ($Mode -eq "desktop") { $publishArgs += "--artifact=desktop" }
    return Invoke-NodeScript -ScriptPath $publishScript -Arguments $publishArgs
}

# ============ 调用 node 脚本（继承控制台实时输出，避免 stdout 缓冲）============
function Invoke-NodeScript {
    param(
        [Parameter(Mandatory=$true)][string]$ScriptPath,
        [string[]]$Arguments = @()
    )
    Push-Location $script:RootDir
    try {
        # ★ 2026-09-08 红字降噪：node 的 stderr（console.error / git / curl 进度等）在 PS host
        #   下渲染红色，被小白用户当成"发布失败"。经 cmd /c "node ... 2>&1" 合并进 stdout 后
        #   由 cmd 层渲染（白色）；Start-Process 直连控制台保留实时输出与彩色。
        return Invoke-QuietProcess -FilePath 'node' -ArgumentList (@($ScriptPath) + $Arguments)
    } finally {
        Pop-Location
    }
}

# ============ 热更签发（阶段 1.5，★ 2026-10-30 P1 新增）============
# 背景：此前发布链全流程不生成热更包（one-click-pack / publish-release / auto-publish 均无），
#   全靠人工记得重签；漏签 → 线上 hotVersion 未变 → 客户端判定"已是最新"，不下载、无横幅
#   （2026-10-29 实测）。本函数把「检查→按需重签→校验→提交推送」固化进流程，幂等：
#   内容一致即跳过，不留无意义提交。
# 保险丝：SKIP_HOTUPDATE=1 跳过（仅限明确知道线上已最新时）。
function Invoke-HotUpdateSign {
    param(
        [string]$Scope = "all",   # all / cloud / dingzhi
        [switch]$CheckOnly,
        [switch]$Commit
    )
    if ($env:SKIP_HOTUPDATE -eq '1') {
        Write-Host "[SKIP] SKIP_HOTUPDATE=1 —— 跳过热更签发" -ForegroundColor Yellow
        return 0
    }
    $stage = "$script:RootDir\tools\hotupdate-stage.ps1"
    if (-not (Test-Path $stage)) {
        Write-Host "[WARN] 未找到 tools\hotupdate-stage.ps1，跳过热更签发（不阻断）" -ForegroundColor Yellow
        return 0
    }
    $channelArgs = switch ($Scope) {
        "cloud"   { @('desktop/cloud') }
        "dingzhi" { @('desktop/local', 'app-local') }
        default   { @('desktop/cloud', 'desktop/local', 'app-local') }
    }
    # ★ 注意：hotupdate-stage 的 -Channels 用**逗号分隔单字符串**（powershell -File 模式
    #   不接受空格分隔的 [string[]] 多值，会报 PositionalParameterNotFound）
    $hotArgs = @('-Mode', $(if ($CheckOnly) { 'Check' } else { 'Sign' }), '-Channels', ($channelArgs -join ','))
    if ($Commit -and -not $CheckOnly) { $hotArgs += '-Commit' }

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    if ($CheckOnly) {
        Write-Host "  热更包检查（只读，判断是否需要重签）" -ForegroundColor Cyan
    } else {
        Write-Host "  热更签发（按需重签三通道 + 校验 + 推送）" -ForegroundColor Cyan
    }
    Write-Host "  范围: $Scope    通道: $($channelArgs -join ', ')" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    $rc = Invoke-QuietProcess -FilePath 'powershell' -ArgumentList (@('-NoProfile','-ExecutionPolicy','Bypass','-File',$stage) + $hotArgs)
    if ($rc -is [array]) { $rc = [int]$rc[-1] }
    if ($CheckOnly) {
        if ($rc -eq 0) { Write-Host "[OK] 热更包已是最新，无需重签" -ForegroundColor Green }
        elseif ($rc -eq 2) { Write-Host "[需签发] 热更内容落后于源码（全流程会自动重签）" -ForegroundColor Yellow }
        else { Write-Host "[WARN] 热更检查退出码 $rc（非预期）" -ForegroundColor Yellow }
        return $rc
    }
    if ($rc -ne 0) {
        Write-Host "[ERROR] 热更签发失败，退出码 $rc —— 继续发布会让客户端收不到本次更新" -ForegroundColor Red
        return $rc
    }
    Write-Host "[OK] 热更签发完成" -ForegroundColor Green
    return 0
}

# ============ 验证 ============
function Invoke-Verify {
    $verifyScript = "$script:RootDir\tools\verify-release.js"
    if (-not (Test-Path $verifyScript)) {
        Write-Host "[ERROR] 未找到验证脚本: $verifyScript" -ForegroundColor Red
        return 1
    }
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  验证发布结果..." -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    return Invoke-NodeScript -ScriptPath $verifyScript
}

# ============ 发布前体检（严格模式；★ 2026-10-30 P1 新增）============
# 背景：check-release-readiness.cjs 一直只在入口 bat 里 informational 跑（从不阻断），
#   而它本身会把「热更内容落后于源码（HOT-STALE）」「版本回退（REGRESS）」
#   「热更 minAppCode 高于 APK（HOT-MINAPP）」判为 BLOCK。发布链此前不消费这个判定，
#   于是能看到"热更包降级却照常发布"。此处作为上传前的硬门（--strict）。
# 保险丝：READINESS_SOFT=1 降级为提示（仅限已人工确认阻断项可接受时）。
function Invoke-ReadinessGate {
    if ($env:READINESS_SOFT -eq '1') {
        Write-Host "[SKIP] READINESS_SOFT=1 —— 体检降级为提示（阻断项不会中止流程）" -ForegroundColor Yellow
        return 0
    }
    $readiness = "$script:RootDir\tools\check-release-readiness.cjs"
    if (-not (Test-Path $readiness)) {
        Write-Host "[WARN] 未找到 tools\check-release-readiness.cjs，跳过发布前体检" -ForegroundColor Yellow
        return 0
    }
    $rc = Invoke-NodeScript -ScriptPath $readiness -Arguments @('--strict')
    if ($rc -is [array]) { $rc = [int]$rc[-1] }
    return $rc
}

# ============ 发布前合规检查（必守HARD规则）============
function Invoke-ComplianceCheck {
    $complianceScript = "$script:RootDir\tools\compliance-check.ps1"
    if (-not (Test-Path $complianceScript)) {
        Write-Host "[ERROR] 未找到合规检查脚本: $complianceScript" -ForegroundColor Red
        return 1
    }
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  发布前合规检查（只读，全部通过才允许手动上传）..." -ForegroundColor Cyan
    Write-Host "  必守HARD规则：打包产物禁止自动上传官方下载网站" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Push-Location $script:RootDir
    try {
        # ★ 2026-09-08 改 Invoke-QuietProcess：stderr 白化（PS host 不再染红）；
        #   Start-Process 不更新 $LASTEXITCODE，退出码用返回值
        return Invoke-QuietProcess -FilePath 'powershell' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$complianceScript)
    } finally {
        Pop-Location
    }
}

# ============ 统一发布结果汇总（明确中文提示）============
# ★ 2026-09-01 新增：发布环节结束后统一输出成败大字块 + 产物入口 + 生效提示，
#   替代原先"只有下一步指引、成败要回翻日志"的弱提示。
function Show-PublishResult {
    param(
        [int]$ExitCode,
        [string]$Label = "发布"
    )
    Write-Host ""
    if ($ExitCode -eq 0) {
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "  [发布成功] $Label" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "  下载页: https://tcm-prescription-system.pages.dev/download"
        Write-Host "  Release: https://github.com/kyt61767126/tcm-prescription-system/releases"
        Write-Host "  Cloudflare Pages 将在 1-2 分钟内自动部署下载页" -ForegroundColor Yellow
    } else {
        Write-Host "========================================" -ForegroundColor Red
        Write-Host "  [发布失败] $Label （退出码: $ExitCode）" -ForegroundColor Red
        Write-Host "========================================" -ForegroundColor Red
        Write-Host "  完整原因与补救方法见上方 [ERROR] 明细块；常见原因:"
        Write-Host "  - 网络超时（上传 75MB exe 需 5-10 分钟，可重跑恢复）"
        Write-Host "  - 源码未落定（先 commit 再发布）"
        Write-Host "  - 合规检查未通过（按提示修复后重试）"
        Write-Host "  重跑入口: 本菜单 [3] 智能发布（产物 hash 未变会自动续传）"
    }
}

# ============ 最终结果汇总（结束前明确中文提示）============
# ★ 2026-09-01 新增：菜单动作结束后、返回菜单/暂停前，统一输出最终汇总块——
#   产物位置 + 发布状态 + 下一步指引，用户不需回翻日志即知"结果如何、东西在哪、
#   接下来做什么"（此前副作用收纳后直接 Press Enter，结果提示弱）。
function Show-FinalSummary {
    param([string]$ActionLabel = "本次操作")
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "  $ActionLabel 已结束" -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "  产物位置（本机最新打包版本）:"
    Write-Host "    云端桌面 exe : app_project\db-yunduan\cloud_desktop\dist\"
    Write-Host "    云端手机 APP : app_project\db-yunduan\惠康中医-云端.apk"
    Write-Host "    离线桌面 exe : app_project\db-offline\desktop\dist\"
    Write-Host "    离线手机 APP : app_project\db-offline\惠康中医-本地.apk"
    Write-Host "  发布状态: 打包产物不会自动上传官网（安全规范，需人工确认）" -ForegroundColor Yellow
    Write-Host "  如需发布 : 双击 一键发布.bat → 选 [3] 智能发布（仅上传有变化的产物）"
    Write-Host "  下载页   : https://tcm-prescription-system.pages.dev/download"
    Write-Host "============================================" -ForegroundColor Cyan
}

# ============ 显示版本选择菜单 ============
function Show-VersionMenu {
    param(
        [string]$Action,   # pack / publish / full
        [string]$Mode      # desktop / app / all （仅 pack 和 full 用）
    )
    while ($true) {
        Clear-Host
        $actionLabel = switch ($Action) {
            "pack"    { "打包" }
            "publish" { "发布" }
            "full"    { "打包 + 发布 + 验证" }
        }
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  选择版本 - $actionLabel" -ForegroundColor Cyan
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  [1] 云端版"
        Write-Host "  [2] 本地版"
        Write-Host "  [3] 全部2个版本"
        Write-Host "  [0] 返回主菜单"
        Write-Host ""
        $choice = Read-MenuChoice "请选择 [0-3]"
        switch ($choice) {
            "1" { return "cloud" }
            "2" { return "dingzhi" }
            "3" { return "all" }
            "0" { return "" }
            default { Write-Host "无效选择" -ForegroundColor Red; Start-Sleep -Seconds 1 }
        }
    }
}

# ============ 显示打包模式菜单 ============
# $ScopeTitle: "打包" / "发布" —— 同一菜单复用于打包与发布范围选择（返回值语义一致：desktop/app/all）
function Show-PackModeMenu {
    param([string]$ScopeTitle = "打包")
    while ($true) {
        Clear-Host
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  选择$ScopeTitle范围" -ForegroundColor Cyan
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  [1] 桌面 exe"
        Write-Host "  [2] 手机 APP"
        Write-Host "  [3] 桌面 + APP (全部)"
        Write-Host "  [0] 返回主菜单"
        Write-Host ""
        $choice = Read-MenuChoice "请选择 [0-3]"
        switch ($choice) {
            "1" { return "desktop" }
            "2" { return "app" }
            "3" { return "all" }
            "0" { return "" }
            default { Write-Host "无效选择" -ForegroundColor Red; Start-Sleep -Seconds 1 }
        }
    }
}

# ============ 执行打包+发布+验证完整流程 ============
function Invoke-FullFlow {
    param(
        [string]$Version,   # cloud / dingzhi / all
        [string]$Mode       # desktop / app / all
    )
    # Step 1: 打包
    if ($Version -eq "all") {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  [1/4] 打包全部版本 (云端+本地，自动执行)" -ForegroundColor Cyan
        Write-Host "========================================" -ForegroundColor Cyan
        $rc = Invoke-Pack -Target "all"
    } else {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  [1/4] 打包单个版本" -ForegroundColor Cyan
        Write-Host "========================================" -ForegroundColor Cyan
        $rc = Invoke-SinglePack -Version $Version -Mode $Mode
    }
    # ★ 2026-08-23 修复：防御性提取真实退出码。打包函数若被意外污染（子进程输出混入返回值），
    #   return $rc 总是把退出码追加在数组末尾，取最后一个元素即真实退出码。
    if ($rc -is [array]) { $rc = [int]$rc[-1] }
    if ($rc -ne 0) {
        Write-Host ""
        Write-Host "[ERROR] 打包失败，流程中止" -ForegroundColor Red
        return $rc
    }
    Write-Host ""
    Write-Host "[OK] 打包完成" -ForegroundColor Green

    # Step 1.5: 热更签发（★ 2026-10-30 P1：把漏签缺口固化进流程；内容一致自动跳过）
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  [1.5/4] 热更签发（按需重签三通道 + 校验 + 推送）" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    $rc = Invoke-HotUpdateSign -Scope $Version -Commit
    if ($rc -is [array]) { $rc = [int]$rc[-1] }
    if ($rc -ne 0) {
        Write-Host "[ERROR] 热更签发失败，流程中止（避免发布后客户端收不到更新）" -ForegroundColor Red
        return $rc
    }

    # ★ 2026-10-29 修复「打包全 SKIP → 全流程误跳过发布」：
    #   旧逻辑：last-run.json 的 built=[]（本次无端重打）→ 判定"无源码更新，跳过发布"。
    #   但 built=[] 只说明"本次没重打"，不代表官网已最新：09:54 构建完成、10:07 再跑一次
    #   智能打包（四端全 SKIP）就会把 built 覆盖为 []，此时官网仍落后 4 端，
    #   发布被错误跳过（check-release-readiness 已以 [BLOCK] 警示该陷阱）。
    #   新逻辑：以 auto-publish.js --check（本地产物 hash vs hash-manifest）为客观依据：
    #     rc=2 → 有待发布产物 → 继续发布；rc=0 → 官网已最新 → 才允许跳过；其他 → WARN 继续。
    $builtUnits = $null
    $stateFile = "$script:RootDir\.build-cache\last-run.json"
    if (Test-Path $stateFile) {
        try { $builtUnits = (Get-Content $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json).built } catch { $builtUnits = $null }
    }
    $allUnitLabels = @{ 'cloud-desktop' = '云端桌面'; 'cloud-app' = '云端APP'; 'local-desktop' = '本地桌面'; 'local-app' = '本地APP' }
    if ($Version -eq "all" -and $null -ne $builtUnits) {
        $builtArr = @($builtUnits)
        if ($builtArr.Count -eq 0) {
            Write-Host ""
            Write-Host "[提示] 本次打包四端全 SKIP（产物已是最新），继续核对官网是否需要发布..." -ForegroundColor Yellow
        } elseif ($builtArr.Count -lt 4) {
            $builtNames = ($builtArr | ForEach-Object { $allUnitLabels[$_] }) -join '、'
            $skippedNames = (@('cloud-desktop','cloud-app','local-desktop','local-app') | Where-Object { $builtArr -notcontains $_ } | ForEach-Object { $allUnitLabels[$_] }) -join '、'
            Write-Host ""
            Write-Host "[提示] 本次更新 $($builtArr.Count) 端（$builtNames），跳过 $(4-$builtArr.Count) 端（$skippedNames）已是最新" -ForegroundColor Yellow
        }
    }
    if ($Version -eq "all") {
        $pendingPublish = $true
        $autoPublishCheckJs = "$script:RootDir\tools\auto-publish.js"
        if (Test-Path $autoPublishCheckJs) {
            Write-Host ""
            Write-Host "[检查] 比对本地产物与官网 manifest（auto-publish.js --check）..." -ForegroundColor Cyan
            $chkRc = Invoke-NodeScript -ScriptPath $autoPublishCheckJs -Arguments @('--check')
            if ($chkRc -is [array]) { $chkRc = [int]$chkRc[-1] }
            if ($chkRc -eq 0 -or $chkRc -eq 3) {
                $pendingPublish = $false
            } else {
                if ($chkRc -ne 2) {
                    Write-Host "[WARN] 发布体检退出码 $chkRc（非预期），按待发布继续；发布工具会再次校验" -ForegroundColor Yellow
                }
                $pendingPublish = $true
            }
        }
        if ($pendingPublish -eq $false) {
            Write-Host ""
            Write-Host "========================================" -ForegroundColor Cyan
            Write-Host "  [无需发布] 官网已是最新版本" -ForegroundColor Cyan
            Write-Host "  本地产物与官网 hash-manifest 完全一致，自动跳过上传与验证" -ForegroundColor Cyan
            Write-Host "========================================" -ForegroundColor Cyan
            return 0
        }
    }

    # Step 1.8: 发布前体检（★ 2026-10-30 P1：热更/版本回退/产物缺失等阻断项升级为硬门）
    #   此前 check-release-readiness 只在入口 bat 里 informational 跑一遍，BLOCK 项无人拦。
    #   现值此签发后、上传前严格复核（--strict：有 BLOCK 即 exit 1），避免"带着降级热包发布"。
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  [1.8/4] 发布前体检（严格模式，阻断项即中止）" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    $rc = Invoke-ReadinessGate
    if ($rc -is [array]) { $rc = [int]$rc[-1] }
    if ($rc -ne 0) {
        Write-Host "[ERROR] 发布前体检存在阻断项，流程中止（详见上方 → 行提示）" -ForegroundColor Red
        Write-Host "  仅在确认要跳过体检时设置 READINESS_SOFT=1 重跑" -ForegroundColor Yellow
        return $rc
    }

    # Step 2: 发布
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  [2/4] 发布" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    # ★ 2026-08-28 优化打包与发布的关系：Version=all 走智能发布（auto-publish.js
    #   比对 hash 仅上传有变化的产物，publish-release.js --changed-only 过滤），
    #   替代原全量发布——增量打包常只有部分端更新，全量发布会把无变化产物也重传
    #   （75MB×N，每个 5-10 分钟，纯浪费）。单版本保持指定发布（透传版本+范围，
    #   用户意图明确）。★ 2026-08-23 修复（保留）：单版本透传 Mode（产物类型维度）。
    if ($Version -eq "all") {
        $autoPublishJs = "$script:RootDir\tools\auto-publish.js"
        if (Test-Path $autoPublishJs) {
            Write-Host "  智能发布: 仅上传有变化的产物 (auto-publish.js --publish)" -ForegroundColor Cyan
            $rc = Invoke-NodeScript -ScriptPath $autoPublishJs -Arguments @('--publish')
            # ★ 2026-09-01 退出码 3 = 无需发布（官网已是最新）——视为成功继续验证，
            #   但提示明确"未上传"，不再显示笼统的"发布完成"。
            if ($rc -is [array]) { $rc = [int]$rc[-1] }
            if ($rc -eq 3) {
                Write-Host ""
                Write-Host "[OK] 官网已是最新版本，本次未上传任何文件" -ForegroundColor Cyan
                $rc = 0
            }
        } else {
            $rc = Invoke-Publish -Target "all" -Mode "all"
        }
    } else {
        $rc = Invoke-Publish -Target $Version -Mode $Mode
    }
    if ($rc -is [array]) { $rc = [int]$rc[-1] }
    if ($rc -ne 0) {
        Write-Host ""
        Write-Host "[ERROR] 发布失败，流程中止" -ForegroundColor Red
        Write-Host "  完整日志: $script:LogFile" -ForegroundColor Yellow
        return $rc
    }
    Write-Host ""
    Write-Host "[OK] 发布完成" -ForegroundColor Green

    # Step 3: 验证
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  [3/4] 验证 (verify-release.js)" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    $rc = Invoke-Verify
    if ($rc -is [array]) { $rc = [int]$rc[-1] }
    if ($rc -eq 2) {
        # ★ 2026-10-29 网络不可达 ≠ 发布失败（本机 hosts 把 github 域名指向本地代理，
        #   代理抖动时 curl rc=6/35/超时）。上传已成功，验证仅"无法判定"。
        Write-Host ""
        Write-Host "[WARN] 验证受阻：部分 URL 因网络不可达无法判定（上传已完成，并非发布失败）" -ForegroundColor Yellow
        Write-Host "  网络恢复后重跑 一键发布.bat 选 [5] 验证 复核即可" -ForegroundColor Yellow
        Write-Host "  完整日志: $script:LogFile" -ForegroundColor DarkGray
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Yellow
        Write-Host "  发布已完成（验证待网络恢复复核）" -ForegroundColor Yellow
        Write-Host "========================================" -ForegroundColor Yellow
        Write-Host "  下载页: https://tcm-prescription-system.pages.dev/download"
        Write-Host "  Release: https://github.com/kyt61767126/tcm-prescription-system/releases"
        return 0
    }
    if ($rc -ne 0) {
        Write-Host ""
        Write-Host "[ERROR] 验证失败，请检查 URL 是否可访问" -ForegroundColor Red
        Write-Host "  完整日志: $script:LogFile" -ForegroundColor Yellow
        return $rc
    }
    Write-Host ""
    Write-Host "[OK] 验证通过" -ForegroundColor Green

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  全流程完成！" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  下载页: https://tcm-prescription-system.pages.dev/download"
    Write-Host "  Release: https://github.com/kyt61767126/tcm-prescription-system/releases"
    Write-Host "  Cloudflare Pages 将在 1-2 分钟内自动部署"
    Write-Host "========================================" -ForegroundColor Green
    return 0
}

# ============ 主菜单 ============
$menuStart = Get-TimeStamp
while ($true) {
    Clear-Host
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "  惠康中医 · 自动官网上架流水线" -ForegroundColor Cyan
    Write-Host "  (支持选择单个版本打包发布)" -ForegroundColor Cyan
    Write-Host "  当前: $menuStart" -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  [1] 一键全流程: 打包 + 发布 + 验证 (推荐日常)"
    Write-Host "  [2] 仅打包 - 选版本和范围 (不上传)"
    Write-Host "  [3] 智能发布 - 仅上传有变化的产物 (已打包好时用)"
    Write-Host "  [4] 指定发布 - 选版本和范围全量上传 (补传/修复用)"
    Write-Host "  [5] 验证发布结果 (verify-release.js)"
    Write-Host "  [6] 合规检查 (compliance-check，发布前可自查)"
    Write-Host "  [7] 热更签发 - 检查三通道并按需重签 (不打包/不发布)"
    Write-Host "  [0] 退出"
    Write-Host ""
    Write-Host "  说明:" -ForegroundColor DarkGray
    Write-Host "  - [1] 全流程: 增量打包(无改动端自动跳过) → 热更签发 → 智能发布 → 验证" -ForegroundColor DarkGray
    Write-Host "  - [2] 仅打包: 先选版本(云端/本地/全部)，单版本再选范围(桌面/APP/全部)；完成后按需重签热更" -ForegroundColor DarkGray
    Write-Host "  - [7] 热更签发: 比对源码与线上热更清单，内容落后才重签(幂等)；云桌面/离线桌面/离线APP 三通道" -ForegroundColor DarkGray
    Write-Host "  - 发布双通道: [3]智能发布=比对hash仅上传变化产物(推荐日常)" -ForegroundColor DarkGray
    Write-Host "               [4]指定发布=全量上传所选版本+范围产物(补传/修复)" -ForegroundColor DarkGray
    Write-Host "  - ★发布规范: 所有发布均为人工确认发布(菜单手动触发+内置合规门禁)" -ForegroundColor Yellow
    Write-Host "    系统绝不自动上传产物到官方下载网站(必守HARD规则)" -ForegroundColor Yellow
    Write-Host "  - git push 后 Cloudflare Pages 自动部署下载页" -ForegroundColor DarkGray
    Write-Host "--------------------------------------------"
    $choice = Read-MenuChoice "请选择 [0-7]"
    switch ($choice) {
        "2" {
            # 仅打包 - 选版本和范围 (选"全部"= 全量打包，原[4]打包全部已并入本项)
            $version = Show-VersionMenu -Action "pack"
            if ($version -eq "") { break }
            # ★ 2026-08-24 修复：选"全部2个版本"原误入 Invoke-SinglePack，拼出不存在的
            #   db-all 目录直接 [ERROR] 中止。改走 Invoke-Pack（one-click-pack -AutoMode 3
            #   双端全量），与 Invoke-FullFlow 的 all 分支保持一致；all 为全量打包，无需再选范围。
            # ★ 2026-08-28 合并原菜单[4]：all 路径已含副作用 AutoCommit 收纳，
            #   修复原[4]打包全部后副作用滞留工作区的问题（P1）。
            # ★ 2026-10-30 P0 去重：副作用/增量基线均已由子进程（-AutoCommit）完成，
            #   父进程不再 CollectSideEffectsOnly / Record-BuiltUnits（会以空值覆盖 last-run.json）。
            if ($version -eq "all") {
                $rcA = Invoke-Pack -Target "all"
                if ($rcA -is [array]) { $rcA = [int]$rcA[-1] }
                if ($rcA -ne 0) {
                    Write-Host ""
                    Write-Host "[ERROR] 打包全部版本失败，退出码: $rcA（详见上方日志）" -ForegroundColor Red
                } else {
                    # ★ 2026-10-30 P1：打包成功后按需重签热更（内容一致自动跳过）
                    $null = Invoke-HotUpdateSign -Scope $version -Commit
                }
                Write-Host ""
                pause
                break
            }
            $mode = Show-PackModeMenu
            if ($mode -eq "") { break }
            # ★ 2026-08-23 复核修复：原 | Out-Null 丢弃退出码，失败静默无提示
            $rc1 = Invoke-SinglePack -Version $version -Mode $mode
            if ($rc1 -is [array]) { $rc1 = [int]$rc1[-1] }
            if ($rc1 -ne 0) {
                Write-Host ""
                Write-Host "[ERROR] 单版本打包失败，退出码: $rc1（详见上方日志）" -ForegroundColor Red
            } else {
                # ★ 2026-10-30 P1：打包成功后按需重签热更（内容一致自动跳过）
                $null = Invoke-HotUpdateSign -Scope $version -Commit
            }
            # ★ 2026-09-01 最终结果汇总（明确中文提示）
            Show-FinalSummary -ActionLabel "仅打包（未发布）"
            Write-Host ""
            pause
        }
        "4" {
            # 指定发布 - 选版本和范围全量上传（补传/修复用；与[3]智能发布的区别：
            #   不论产物是否有变化，所选版本+范围的全部产物一律重新上传）
            $version = Show-VersionMenu -Action "publish"
            if ($version -eq "") { break }
            # ★ 2026-08-23 修复：发布也需选范围（桌面/APP/全部）。原实现只选版本，
            #   选"本地版"后该版本 dist/ 里上次构建的旧桌面 exe 也被一并上传。
            $mode2 = Show-PackModeMenu -ScopeTitle "发布"
            if ($mode2 -eq "") { break }
            # ★ 2026-10-30 P1：全量补传前仍先过发布前体检（热更降级/版本回退不放过）
            $rcG = Invoke-ReadinessGate
            if ($rcG -is [array]) { $rcG = [int]$rcG[-1] }
            if ($rcG -ne 0) {
                Write-Host "[ERROR] 发布前体检存在阻断项，指定发布已中止（READINESS_SOFT=1 可跳过）" -ForegroundColor Red
                Write-Host ""
                pause
                break
            }
            # ★ 2026-08-23 复核修复：原 | Out-Null 丢弃退出码，失败静默无提示
            $rc2 = Invoke-Publish -Target $version -Mode $mode2
            if ($rc2 -is [array]) { $rc2 = [int]$rc2[-1] }
            # ★ 2026-09-01 统一结果汇总（明确中文提示）
            Show-PublishResult -ExitCode $rc2 -Label "指定发布（$version / $mode2）"
            Write-Host ""
            Write-Host "--------------------------------------------"
            Write-Host "  下一步指引:" -ForegroundColor Yellow
            Write-Host "  - 建议运行 [5] 验证 URL"
            Write-Host "  - 下载页: https://tcm-prescription-system.pages.dev/download"
            Write-Host "  - Release: https://github.com/kyt61767126/tcm-prescription-system/releases"
            Write-Host "--------------------------------------------"
            pause
        }
        "1" {
            # 一键全流程: 打包 + 发布 + 验证 (推荐日常，可选全部/云端/本地)
            $version = Show-VersionMenu -Action "full"
            if ($version -eq "") { break }
            $mode = Show-PackModeMenu
            if ($mode -eq "") { break }
            # ★ 2026-08-23 复核修复：原 | Out-Null 丢弃退出码，失败静默无提示
            $rc3 = Invoke-FullFlow -Version $version -Mode $mode
            if ($rc3 -is [array]) { $rc3 = [int]$rc3[-1] }
            if ($rc3 -ne 0) {
                Write-Host ""
                Write-Host "[ERROR] 打包+发布+验证 流程失败，退出码: $rc3（详见上方日志）" -ForegroundColor Red
            }
            # ★ 2026-10-30 P0 去重：Step1 打包的副作用收纳与增量基线均由子进程
            #   （one-click-pack -AutoCommit）完成；热更签发在 FullFlow Step1.5 内部完成。
            #   父进程不再 CollectSideEffectsOnly / Record-BuiltUnits（会以空值覆盖 last-run.json）。
            # ★ 2026-09-01 最终结果汇总（明确中文提示）
            Show-FinalSummary -ActionLabel "打包 + 发布 + 验证全流程"
            Write-Host ""
            pause
        }
        "3" {
            # 智能发布 - 仅上传有变化的产物（auto-publish.js --publish；内置合规门禁）
            #   "智能"= 自动比对 hash 检测变化，上传动作仍由本菜单人工触发（HARD规则）
            $autoPublish = "$script:RootDir\tools\auto-publish.js"
            if (Test-Path $autoPublish) {
                Write-Host ""
                Write-Host "========================================" -ForegroundColor Cyan
                Write-Host "  智能发布 (auto-publish.js --publish)" -ForegroundColor Cyan
                Write-Host "  仅上传有变化的产物；发布前自动跑合规检查" -ForegroundColor Cyan
                Write-Host "========================================" -ForegroundColor Cyan
                # ★ 2026-10-30 P1：智能发布前先过发布前体检（阻断项即中止）
                $rcG = Invoke-ReadinessGate
                if ($rcG -is [array]) { $rcG = [int]$rcG[-1] }
                if ($rcG -ne 0) {
                    Write-Host "[ERROR] 发布前体检存在阻断项，智能发布已中止（READINESS_SOFT=1 可跳过）" -ForegroundColor Red
                    Write-Host ""
                    pause
                    break
                }
                # ★ 2026-08-23 复核修复：原 | Out-Null 丢弃退出码，失败静默无提示
                $rc5 = Invoke-NodeScript -ScriptPath $autoPublish -Arguments @('--publish')
                if ($rc5 -is [array]) { $rc5 = [int]$rc5[-1] }
                # ★ 2026-09-01 统一结果汇总（明确中文提示；auto-publish.js 内部已列
                #   上传产物清单，此处菜单层给成败大字块兜底）
                #   退出码 3 = 无需发布（官网已是最新）——显示信息块而非"发布成功"，
                #   杜绝"没传任何东西却报成功+Cloudflare 将部署"的误导。
                if ($rc5 -eq 3) {
                    Write-Host ""
                    Write-Host "========================================" -ForegroundColor Cyan
                    Write-Host "  [无需发布] 官网已是最新版本" -ForegroundColor Cyan
                    Write-Host "========================================" -ForegroundColor Cyan
                    Write-Host "  本地产物与官网 hash 完全一致，未上传任何文件"
                    Write-Host "  下载页: https://tcm-prescription-system.pages.dev/download"
                } else {
                    Show-PublishResult -ExitCode $rc5 -Label "智能发布（仅上传有变化的产物）"
                }
            } else {
                $rc5 = Invoke-Publish -Target "all"
                if ($rc5 -is [array]) { $rc5 = [int]$rc5[-1] }
                Show-PublishResult -ExitCode $rc5 -Label "发布全部版本"
            }
            Write-Host ""
            Write-Host "--------------------------------------------"
            Write-Host "  下一步指引:" -ForegroundColor Yellow
            Write-Host "  - 建议运行 [5] 验证 URL"
            Write-Host "  - 下载页: https://tcm-prescription-system.pages.dev/download"
            Write-Host "  - Release: https://github.com/kyt61767126/tcm-prescription-system/releases"
            Write-Host "--------------------------------------------"
            pause
        }
        "5" {
            # 验证发布结果
            # ★ 2026-08-23 复核修复：原 | Out-Null 丢弃退出码，失败静默无提示
            $rc6 = Invoke-Verify
            if ($rc6 -is [array]) { $rc6 = [int]$rc6[-1] }
            if ($rc6 -eq 2) {
                Write-Host ""
                Write-Host "[WARN] 部分 URL 因网络不可达无法判定（已重试；上传可能已成功）" -ForegroundColor Yellow
                Write-Host "  这不是发布失败，网络恢复后重跑本项即可" -ForegroundColor Yellow
            } elseif ($rc6 -ne 0) {
                Write-Host ""
                Write-Host "[ERROR] 验证失败，退出码: $rc6（详见上方日志）" -ForegroundColor Red
            }
            Write-Host ""
            pause
        }
        "6" {
            # 合规检查（发布前可自查；发布流程内也自动跑）
            # ★ 2026-08-23 复核修复：原 | Out-Null 丢弃退出码，失败静默无提示
            $rc7 = Invoke-ComplianceCheck
            if ($rc7 -is [array]) { $rc7 = [int]$rc7[-1] }
            if ($rc7 -ne 0) {
                Write-Host ""
                Write-Host "[ERROR] 合规检查未通过，退出码: $rc7（详见上方日志）" -ForegroundColor Red
            }
            Write-Host ""
            pause
        }
        "7" {
            # 热更签发（不打包/不发布）：先只读检查，落后才询问是否签发
            # ★ 2026-10-30 P1：给"已打好包、只想补热更"的场景一个独立入口
            Write-Host ""
            $rcH = Invoke-HotUpdateSign -Scope "all" -CheckOnly
            if ($rcH -is [array]) { $rcH = [int]$rcH[-1] }
            if ($rcH -eq 2) {
                $ans = Read-MenuChoice "是否立即重签并提交推送热更包 [1=是 0=否]"
                if ($ans -eq "1") {
                    $rcS = Invoke-HotUpdateSign -Scope "all" -Commit
                    if ($rcS -is [array]) { $rcS = [int]$rcS[-1] }
                    if ($rcS -ne 0) {
                        Write-Host "[ERROR] 热更签发失败，退出码: $rcS（详见上方日志）" -ForegroundColor Red
                    }
                }
            } elseif ($rcH -ne 0) {
                Write-Host "[WARN] 热更检查异常（退出码 $rcH），未做任何改动" -ForegroundColor Yellow
            }
            Write-Host ""
            pause
        }
        "0" {
            Write-Host ""
            Write-Host "再见！" -ForegroundColor Cyan
            exit 0
        }
        default {
            Write-Host "无效选择，请重试" -ForegroundColor Red
            Start-Sleep -Seconds 1
        }
    }
}
