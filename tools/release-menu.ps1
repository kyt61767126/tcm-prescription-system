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

$env:NO_PAUSE = '1'

# ★ 2026-08-24 打包验收门（tools/pack-gate.ps1）：语法/BOM/CRLF/编码 四道快检，
#   任一失败直接阻断（历史事故：本文件 BOM 丢失被 GBK 误读解析崩 / 打包链脚本语法错无人发现）
$gateToolRm = Join-Path $PSScriptRoot 'pack-gate.ps1'
if (Test-Path $gateToolRm) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $gateToolRm -Mode preflight
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "[FATAL] 打包验收门未通过，发布/打包中止。请修复上述问题后重试。" -ForegroundColor Red
        pause
        exit 1
    }
}

# ★ 2026-08-24 打包增量检测（tools/build-skip.ps1）：
#   源码自上次打包后未变化+产物完好 → 跳过重复打包；打包成功且副作用AutoCommit后记录基线
$script:BuiltUnits = @()
function Test-BuildSkip([string]$unit) {
    if ($env:NO_BUILD_SKIP -eq '1') { return $false }
    $skipTool = Join-Path $PSScriptRoot 'build-skip.ps1'
    if (-not (Test-Path $skipTool)) { return $false }
    & powershell -NoProfile -ExecutionPolicy Bypass -File $skipTool -Check -Unit $unit 2>&1 | ForEach-Object { Write-Host "  $_" }
    return ($LASTEXITCODE -eq 0)
}
function Record-BuiltUnits {
    if (-not $script:BuiltUnits -or $script:BuiltUnits.Count -eq 0) { return }
    $skipTool = Join-Path $PSScriptRoot 'build-skip.ps1'
    if (-not (Test-Path $skipTool)) { return }
    Write-Host ""
    Write-Host "--- 打包增量基线记录 ---" -ForegroundColor Cyan
    foreach ($u in $script:BuiltUnits) {
        & powershell -NoProfile -ExecutionPolicy Bypass -File $skipTool -Record -Unit $u 2>&1 | ForEach-Object { Write-Host "  $_" }
    }
    $script:BuiltUnits = @()
}

# ★ [SELF-HEAL 2026-08-23] Fix LF line endings in ALL downstream build .bat files
# BEFORE invoking them. This script calls build-app.bat directly (bypassing
# pack-app-strict.bat entries), so the entry-level self-heal does NOT cover us.
# LF-corrupted Chinese .bat aborts cmd at parse time (window flash-close).
$fixTool = Join-Path $PSScriptRoot 'fix-bat-crlf.ps1'
if (Test-Path $fixTool) {
    $buildBats = @(
        'app_project\db-yunduan\pack-desktop.bat',
        'app_project\db-yunduan\build-pack.bat',
        'app_project\db-yunduan\build-app.bat',
        'app_project\db-yunduan\cloud_desktop\build.bat',
        'app_project\db-offline\pack-desktop.bat',
        'app_project\db-offline\build-pack.bat',
        'app_project\db-offline\app\build-app.bat',
        'app_project\db-offline\desktop\build.bat'
    ) | ForEach-Object { Join-Path $script:RootDir $_ }
    & powershell -NoProfile -ExecutionPolicy Bypass -File $fixTool @buildBats
}

function Get-TimeStamp {
    return (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
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
    # ★ 2026-08-23 修复：接管道显示输出，防止子进程stdout混入函数返回值（返回值污染）
    & powershell -NoProfile -ExecutionPolicy Bypass -File $packScript -AutoMode 3 | ForEach-Object { Write-Host $_ }
    return $LASTEXITCODE
}

# ============ 单个版本打包（直接调用对应项目脚本，绕过 one-click-pack 菜单）============
function Invoke-SinglePack {
    param(
        [string]$Version,   # cloud / dingzhi
        [string]$Mode       # desktop / app / all
    )
    $verLabel = switch ($Version) {
        "cloud"    { "云端" }
        "dingzhi"  { "本地" }
        default    { $Version }
    }
    $modeLabel = switch ($Mode) {
        "desktop" { "桌面exe" }
        "app"     { "手机APP" }
        "all"     { "桌面+APP" }
        default   { $Mode }
    }

    $startTime = Get-TimeStamp
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  开始打包 $verLabel 版 ($modeLabel)..." -ForegroundColor Cyan
    Write-Host "  开始: $startTime" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan

    # ★ 2026-08-23 修复：dingzhi（本地版）目录映射缺失
    #   原代码仅映射 cloud→db-yunduan，选"本地版"时拼成不存在的 db-dingzhi，
    #   导致 [ERROR] 版本目录不存在，打包流程中止。
    #   实际本地版目录为 app_project\db-offline（下有 pack-desktop.bat/build-app.bat/edit-config.ps1，
    #   与 db-yunduan 调用接口一致，见 db-offline\build-app.bat 头注释）。
    $verDir = "$script:RootDir\app_project\db-$Version"
    if ($Version -eq "cloud")   { $verDir = "$script:RootDir\app_project\db-yunduan" }
    if ($Version -eq "dingzhi") { $verDir = "$script:RootDir\app_project\db-offline" }

    if (-not (Test-Path $verDir)) {
        Write-Host "[ERROR] 版本目录不存在: $verDir" -ForegroundColor Red
        return 1
    }

    # ★ 2026-08-31 源码落定门前置（1.2.194 事故防呆，与 ensure-build-env Step 1.5 同源）：
    #   发布链路在"开始打包"前先查 git 工作区——有未提交的源码修改立即中止，
    #   杜绝两件事：①白跑几分钟打包才被下游 ensure-build-env 门禁拦住（发布流程
    #   还有后续步骤，浪费更明显）；②发布出"无法追溯版本"的产物。
    #   检测逻辑单一权威源 tools/source-settled.ps1（三处共用，白名单含
    #   build.gradle 纯 versionCode/versionName 递增）。
    #   保险丝：ALLOW_DIRTY_BUILD=1 跳过。
    if ($env:ALLOW_DIRTY_BUILD -ne '1') {
        . (Join-Path $PSScriptRoot 'source-settled.ps1')
        $dirty = @(Get-SourceSettledBlockers)
        if ($dirty.Count -gt 0) {
            Write-Host "[ERROR] 源码未落定：检测到 $($dirty.Count) 个未提交修改，发布中止（先 commit 再发布）" -ForegroundColor Red
            Write-Host "  （1.2.194 事故防呆：AI 修改中打包=装走半成品代码）" -ForegroundColor Yellow
            $dirty | Select-Object -First 10 | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
            return 1
        }
    }

    # 离线版使用 config.json 默认值（XXX中医诊所/XXX医生），跳过配置编辑窗口
    # 设置 SKIP_CONFIG=1，使桌面 build.bat 与 APP build-app.bat 整轮跳过后台配置编辑
    # ★ 2026-08-23 三轮复核修复：SKIP_CONFIG 环境变量泄漏——菜单会话中先打本地版再打
    #   云端版时，残留变量导致云端版 build-app.bat 的 edit-config -AutoConfirm 配置
    #   同步被跳过（本函数对云端不做 Step1 同步，子进程 AutoConfirm 是唯一同步途径）。
    #   云端版进入时显式清除（对齐 pack.ps1:963 的清理模式）。
    if ($Version -ne "cloud") {
        $env:SKIP_CONFIG = "1"
    } else {
        Remove-Item Env:\SKIP_CONFIG -ErrorAction SilentlyContinue
    }

    # 离线版同步默认配置（跳过交互编辑）
    if ($Version -ne "cloud" -and ($Mode -eq "all" -or $Mode -eq "app")) {
        Write-Host ""
        Write-Host "[配置] 同步 $verLabel 版默认配置 (跳过编辑)..." -ForegroundColor Yellow
        Push-Location $verDir
        try {
            # ★ 2026-08-23 修复：接管道显示输出。原裸调用时子进程stdout（edit-config的Write-Host行）
            #   会混入 Invoke-SinglePack 的返回值，导致 return $rc 变成 [字符串数组..., 0]，
            #   调用方 ($rc -ne 0) 对数组判真 → 打包明明成功却误报"打包失败，流程中止"。
            & powershell -NoProfile -ExecutionPolicy Bypass -File "edit-config.ps1" -SkipConfig | ForEach-Object { Write-Host $_ }
        } finally {
            Pop-Location
        }
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[WARN] 配置同步出现警告(继续打包)" -ForegroundColor Yellow
        }
    }

    $rc = 0
    if ($Mode -eq "all" -or $Mode -eq "desktop") {
        Write-Host ""
        Write-Host "[桌面] 打包 $verLabel 桌面 exe..." -ForegroundColor Yellow
        $desktopBat = "$verDir\pack-desktop.bat"
        if (Test-Path $desktopBat) {
            # ★ 2026-08-24 增量检测：源码与产物指纹一致则跳过重复打包
            $skipUnit = if ($Version -eq "cloud") { 'cloud-desktop' } else { 'local-desktop' }
            if (Test-BuildSkip $skipUnit) {
                Write-Host "  [SKIP] $verLabel 桌面产物已是最新，跳过打包" -ForegroundColor Green
            } else {
                & cmd /c "$desktopBat" 2>&1 | ForEach-Object { Write-Host $_ }
                $rc = $LASTEXITCODE
                if ($rc -ne 0) {
                    Write-Host "[ERROR] $verLabel 桌面打包失败，退出码: $rc" -ForegroundColor Red
                    return $rc
                }
                $script:BuiltUnits += $skipUnit
            }
        } else {
            Write-Host "[WARN] 未找到桌面打包脚本: $desktopBat" -ForegroundColor Yellow
        }
    }

    if ($Mode -eq "all" -or $Mode -eq "app") {
        Write-Host ""
        Write-Host "[APP] 打包 $verLabel 手机 APP (严格模式)..." -ForegroundColor Yellow
        $appBat = "$verDir\build-app.bat"
        if (Test-Path $appBat) {
            # ★ 2026-08-24 增量检测：源码与产物指纹一致则跳过重复打包
            $skipUnit2 = if ($Version -eq "cloud") { 'cloud-app' } else { 'local-app' }
            if (Test-BuildSkip $skipUnit2) {
                Write-Host "  [SKIP] $verLabel APP产物已是最新，跳过打包" -ForegroundColor Green
            } else {
                # 与 one-click-pack.ps1 的 app-strict 一致，APP 统一走严格模式（签名哈希+Java混淆+签名校验）
                & cmd /c "$appBat standard" 2>&1 | ForEach-Object { Write-Host $_ }
                $rc = $LASTEXITCODE
                if ($rc -ne 0) {
                    Write-Host "[ERROR] $verLabel APP打包失败，退出码: $rc" -ForegroundColor Red
                    return $rc
                }
                $script:BuiltUnits += $skipUnit2
            }
        } else {
            Write-Host "[WARN] 未找到APP打包脚本: $appBat" -ForegroundColor Yellow
        }
    }

    $endTime = Get-TimeStamp
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  $verLabel 版 ($modeLabel) 打包完成！" -ForegroundColor Green
    Write-Host "  开始: $startTime" -ForegroundColor Green
    Write-Host "  结束: $endTime" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    return $rc
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

# ============ 调用 node 脚本（用 Start-Process 继承控制台，避免 stdout 缓冲）============
function Invoke-NodeScript {
    param(
        [Parameter(Mandatory=$true)][string]$ScriptPath,
        [string[]]$Arguments = @()
    )
    Push-Location $script:RootDir
    try {
        $argList = @($ScriptPath) + $Arguments
        $proc = Start-Process -FilePath "node" -ArgumentList $argList -Wait -NoNewWindow -PassThru
        return $proc.ExitCode
    } finally {
        Pop-Location
    }
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
        & powershell -NoProfile -ExecutionPolicy Bypass -File $complianceScript
        return $LASTEXITCODE
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
        $choice = Read-Host "请选择 [0-3]"
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
        $choice = Read-Host "请选择 [0-3]"
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
        Write-Host "  [1/3] 打包全部版本 (云端+本地，自动执行)" -ForegroundColor Cyan
        Write-Host "========================================" -ForegroundColor Cyan
        $rc = Invoke-Pack -Target "all"
    } else {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  [1/3] 打包单个版本" -ForegroundColor Cyan
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

    # ★ 2026-08-25 更新检测：读取 one-click-pack 写入的 .build-cache/last-run.json
    #   built 空 = 四端全部 SKIP（无源码更新）→ 自动跳过发布与验证
    #   部分更新 → 显示明细提示后继续发布（产物已是最新的一并幂等覆盖，无副作用）
    $builtUnits = $null
    $stateFile = "$script:RootDir\.build-cache\last-run.json"
    if (Test-Path $stateFile) {
        try { $builtUnits = (Get-Content $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json).built } catch { $builtUnits = $null }
    }
    if ($Version -eq "all" -and $null -ne $builtUnits) {
        $builtArr = @($builtUnits)
        $allUnitLabels = @{ 'cloud-desktop' = '云端桌面'; 'cloud-app' = '云端APP'; 'local-desktop' = '本地桌面'; 'local-app' = '本地APP' }
        if ($builtArr.Count -eq 0) {
            Write-Host ""
            Write-Host "========================================" -ForegroundColor Yellow
            Write-Host "  [提示] 没有检测到任何源码更新" -ForegroundColor Yellow
            Write-Host "  四端产物均已是最新，自动跳过发布与验证" -ForegroundColor Yellow
            Write-Host "  （上一次发布即为最新版本，无需重复上传）" -ForegroundColor DarkGray
            Write-Host "  强制重新打包: 设 NO_BUILD_SKIP=1 后重跑" -ForegroundColor DarkGray
            Write-Host "========================================" -ForegroundColor Yellow
            return 0
        }
        if ($builtArr.Count -lt 4) {
            $builtNames = ($builtArr | ForEach-Object { $allUnitLabels[$_] }) -join '、'
            $skippedNames = (@('cloud-desktop','cloud-app','local-desktop','local-app') | Where-Object { $builtArr -notcontains $_ } | ForEach-Object { $allUnitLabels[$_] }) -join '、'
            Write-Host ""
            Write-Host "[提示] 本次更新 $($builtArr.Count) 端（$builtNames），跳过 $(4-$builtArr.Count) 端（$skippedNames）已是最新" -ForegroundColor Yellow
        }
    }

    # Step 2: 发布
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  [2/3] 发布" -ForegroundColor Cyan
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
        } else {
            $rc = Invoke-Publish -Target "all" -Mode "all"
        }
    } else {
        $rc = Invoke-Publish -Target $Version -Mode $Mode
    }
    if ($rc -ne 0) {
        Write-Host ""
        Write-Host "[ERROR] 发布失败，流程中止" -ForegroundColor Red
        return $rc
    }
    Write-Host ""
    Write-Host "[OK] 发布完成" -ForegroundColor Green

    # Step 3: 验证
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  [3/3] 验证 (verify-release.js)" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    $rc = Invoke-Verify
    if ($rc -ne 0) {
        Write-Host ""
        Write-Host "[ERROR] 验证失败，请检查 URL 是否可访问" -ForegroundColor Red
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
    Write-Host "  [0] 退出"
    Write-Host ""
    Write-Host "  说明:" -ForegroundColor DarkGray
    Write-Host "  - [1] 全流程: 增量打包(无改动端自动跳过) → 副作用自动收纳 → 智能发布 → 验证" -ForegroundColor DarkGray
    Write-Host "  - [2] 仅打包: 先选版本(云端/本地/全部)，单版本再选范围(桌面/APP/全部)" -ForegroundColor DarkGray
    Write-Host "  - 发布双通道: [3]智能发布=比对hash仅上传变化产物(推荐日常)" -ForegroundColor DarkGray
    Write-Host "               [4]指定发布=全量上传所选版本+范围产物(补传/修复)" -ForegroundColor DarkGray
    Write-Host "  - ★发布规范: 所有发布均为人工确认发布(菜单手动触发+内置合规门禁)" -ForegroundColor Yellow
    Write-Host "    系统绝不自动上传产物到官方下载网站(必守HARD规则)" -ForegroundColor Yellow
    Write-Host "  - git push 后 Cloudflare Pages 自动部署下载页" -ForegroundColor DarkGray
    Write-Host "--------------------------------------------"
    $choice = Read-Host "请选择 [0-6]"
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
            if ($version -eq "all") {
                $rcA = Invoke-Pack -Target "all"
                if ($rcA -is [array]) { $rcA = [int]$rcA[-1] }
                if ($rcA -ne 0) {
                    Write-Host ""
                    Write-Host "[ERROR] 打包全部版本失败，退出码: $rcA（详见上方日志）" -ForegroundColor Red
                }
                # all 走子进程 one-click-pack -AutoMode 3（内部不带 -AutoCommit），
                # 打包副作用由本进程统一收纳提交（与菜单[1] all 分支之后的处理一致）
                $packPs1A = "$script:RootDir\tools\one-click-pack.ps1"
                if (Test-Path $packPs1A) {
                    & powershell -NoProfile -ExecutionPolicy Bypass -File $packPs1A -CollectSideEffectsOnly -AutoCommit 2>&1 | ForEach-Object { Write-Host $_ }
                }
                # Version=all 子进程已在内部记录基线，本处 BuiltUnits 为空自动跳过
                Record-BuiltUnits
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
            }
            # ★ 2026-08-23 四轮复核修复：Invoke-SinglePack 直链子 bat（绕过 one-click-pack），
            #   打包完成后需手动调 SideEffectCollect 收纳 versionCode/version 副作用
            #   （[3][4] 发布不打包，无需收纳）
            $packPs1 = "$script:RootDir\tools\one-click-pack.ps1"
            if (Test-Path $packPs1) {
                & powershell -NoProfile -ExecutionPolicy Bypass -File $packPs1 -CollectSideEffectsOnly -AutoCommit 2>&1 | ForEach-Object { Write-Host $_ }
            }
            # ★ 2026-08-24 打包增量基线记录（必须在副作用 AutoCommit 之后，HEAD 才稳定）
            Record-BuiltUnits
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
            # ★ 2026-08-23 四轮复核修复：Step1 打包同样产生副作用，打包成功与否均列示收纳
            #   （FullFlow走 Invoke-SinglePack 或 Invoke-Pack-AutoMode 3）
            $packPs1 = "$script:RootDir\tools\one-click-pack.ps1"
            if (Test-Path $packPs1) {
                & powershell -NoProfile -ExecutionPolicy Bypass -File $packPs1 -CollectSideEffectsOnly -AutoCommit 2>&1 | ForEach-Object { Write-Host $_ }
            }
            # ★ 2026-08-24 打包增量基线记录（必须在副作用 AutoCommit 之后，HEAD 才稳定；
            #   Version=all 走子进程 one-click-pack -AutoMode 3 已在内部记录，本处 BuiltUnits 为空自动跳过）
            Record-BuiltUnits
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
                # ★ 2026-08-23 复核修复：原 | Out-Null 丢弃退出码，失败静默无提示
                $rc5 = Invoke-NodeScript -ScriptPath $autoPublish -Arguments @('--publish')
                if ($rc5 -is [array]) { $rc5 = [int]$rc5[-1] }
                # ★ 2026-09-01 统一结果汇总（明确中文提示；auto-publish.js 内部已列
                #   上传产物清单，此处菜单层给成败大字块兜底）
                Show-PublishResult -ExitCode $rc5 -Label "智能发布（仅上传有变化的产物）"
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
            if ($rc6 -ne 0) {
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
