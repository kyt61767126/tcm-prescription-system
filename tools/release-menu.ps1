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
        "dingzhi"  { "离线定制" }
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

    # 离线版使用 config.json 默认值（XXX中医诊所/XXX医生），跳过配置编辑窗口
    # 设置 SKIP_CONFIG=1，使桌面 build.bat 与 APP build-app.bat 整轮跳过后台配置编辑
    if ($Version -ne "cloud") { $env:SKIP_CONFIG = "1" }

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
            & cmd /c "$desktopBat" 2>&1 | ForEach-Object { Write-Host $_ }
            $rc = $LASTEXITCODE
            if ($rc -ne 0) {
                Write-Host "[ERROR] $verLabel 桌面打包失败，退出码: $rc" -ForegroundColor Red
                return $rc
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
            # 与 one-click-pack.ps1 的 app-strict 一致，APP 统一走严格模式（签名哈希+Java混淆+签名校验）
            & cmd /c "$appBat standard" 2>&1 | ForEach-Object { Write-Host $_ }
            $rc = $LASTEXITCODE
            if ($rc -ne 0) {
                Write-Host "[ERROR] $verLabel APP打包失败，退出码: $rc" -ForegroundColor Red
                return $rc
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
    param([string]$Target)
    $publishScript = "$script:RootDir\tools\publish-release.js"
    if (-not (Test-Path $publishScript)) {
        Write-Host "[ERROR] 未找到发布脚本: $publishScript" -ForegroundColor Red
        return 1
    }

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  发布到 GitHub Release + 下载页..." -ForegroundColor Cyan
    Write-Host "  Target: $Target" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  提示: 上传 75MB exe 需要 5-10 分钟，请耐心等待..." -ForegroundColor Yellow
    Write-Host "  提示: 若卡住无输出，可能是在上传大文件，请勿关闭窗口..." -ForegroundColor Yellow
    Write-Host "  提示: 发布前会自动执行合规检查，未通过则禁止上传（必守HARD规则）" -ForegroundColor Yellow
    Write-Host ""

    # ★ 必守HARD规则：手动发布 = --confirm（人工确认，内置跑合规门禁）+ --push（手动提交部署）
    $publishArgs = @('--confirm', '--push')
    if ($Target -ne "all") { $publishArgs += "--target=$Target" }
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
function Show-PackModeMenu {
    while ($true) {
        Clear-Host
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  选择打包范围" -ForegroundColor Cyan
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
        Write-Host "  [1/3] 打包全部版本 (one-click-pack.ps1)" -ForegroundColor Cyan
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

    # Step 2: 发布
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  [2/3] 发布 (publish-release.js)" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    $rc = Invoke-Publish -Target $Version
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
    Write-Host "  [1] 仅打包 - 选择单个版本"
    Write-Host "  [2] 仅发布 - 选择单个版本 (已打包好)"
    Write-Host "  [3] 打包 + 发布 + 验证 - 选择单个版本 (推荐)"
    Write-Host "  [4] 打包全部版本 (云端+本地，自动执行)"
    Write-Host "  [5] 发布全部版本 (auto-publish.js 智能检测)"
    Write-Host "  [6] 验证发布结果 (verify-release.js)"
    Write-Host "  [7] 合规检查 (compliance-check，发布前必跑)"
    Write-Host "  [0] 退出"
    Write-Host ""
    Write-Host "  说明:" -ForegroundColor DarkGray
    Write-Host "  - [1][2][3] 先选版本(云端/定制/个人/全部)" -ForegroundColor DarkGray
    Write-Host "  - [1][3] 还需选范围(桌面/APP/全部)" -ForegroundColor DarkGray
    Write-Host "  - 发布使用 publish-release.js 上传到 GitHub Release" -ForegroundColor DarkGray
    Write-Host "  - git push 后 Cloudflare Pages 自动部署下载页" -ForegroundColor DarkGray
    Write-Host "  - ★必守HARD规则: 发布前自动跑合规检查，未通过禁止上传" -ForegroundColor Yellow
    Write-Host "--------------------------------------------"
    $choice = Read-Host "请选择 [0-7]"
    switch ($choice) {
        "1" {
            # 仅打包 - 单个版本
            $version = Show-VersionMenu -Action "pack"
            if ($version -eq "") { break }
            $mode = Show-PackModeMenu
            if ($mode -eq "") { break }
            Invoke-SinglePack -Version $version -Mode $mode | Out-Null
            Write-Host ""
            pause
        }
        "2" {
            # 仅发布 - 单个版本
            $version = Show-VersionMenu -Action "publish"
            if ($version -eq "") { break }
            Invoke-Publish -Target $version | Out-Null
            Write-Host ""
            Write-Host "--------------------------------------------"
            Write-Host "  下一步指引:" -ForegroundColor Yellow
            Write-Host "  - 建议运行 [6] 验证 URL"
            Write-Host "  - 下载页: https://tcm-prescription-system.pages.dev/download"
            Write-Host "  - Release: https://github.com/kyt61767126/tcm-prescription-system/releases"
            Write-Host "--------------------------------------------"
            pause
        }
        "3" {
            # 打包+发布+验证 - 单个版本
            $version = Show-VersionMenu -Action "full"
            if ($version -eq "") { break }
            $mode = Show-PackModeMenu
            if ($mode -eq "") { break }
            Invoke-FullFlow -Version $version -Mode $mode | Out-Null
            Write-Host ""
            pause
        }
        "4" {
            # 打包全部
            Write-Host ""
            Write-Host "========================================" -ForegroundColor Cyan
            Write-Host "  [1/1] 打包全部版本 (one-click-pack.ps1)" -ForegroundColor Cyan
            Write-Host "========================================" -ForegroundColor Cyan
            Invoke-Pack -Target "all" | Out-Null
            Write-Host ""
            pause
        }
        "5" {
            # 发布全部（智能检测，手动 --publish；内置合规门禁）
            $autoPublish = "$script:RootDir\tools\auto-publish.js"
            if (Test-Path $autoPublish) {
                Write-Host ""
                Write-Host "========================================" -ForegroundColor Cyan
                Write-Host "  智能发布 (auto-publish.js --publish)" -ForegroundColor Cyan
                Write-Host "  仅发布有变化的端；发布前自动跑合规检查" -ForegroundColor Cyan
                Write-Host "========================================" -ForegroundColor Cyan
                Invoke-NodeScript -ScriptPath $autoPublish -Arguments @('--publish') | Out-Null
            } else {
                Invoke-Publish -Target "all" | Out-Null
            }
            Write-Host ""
            Write-Host "--------------------------------------------"
            Write-Host "  下一步指引:" -ForegroundColor Yellow
            Write-Host "  - 建议运行 [6] 验证 URL"
            Write-Host "  - 下载页: https://tcm-prescription-system.pages.dev/download"
            Write-Host "  - Release: https://github.com/kyt61767126/tcm-prescription-system/releases"
            Write-Host "--------------------------------------------"
            pause
        }
        "6" {
            # 验证
            Invoke-Verify | Out-Null
            Write-Host ""
            pause
        }
        "7" {
            # 合规检查
            Invoke-ComplianceCheck | Out-Null
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
