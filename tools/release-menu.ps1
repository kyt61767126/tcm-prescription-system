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
    # one-click-pack.ps1 自带交互菜单，直接调用即可
    & powershell -NoProfile -ExecutionPolicy Bypass -File $packScript
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

    $verDir = "$script:RootDir\app_project\db-$Version"
    if ($Version -eq "cloud") { $verDir = "$script:RootDir\app_project\db-yunduan" }

    if (-not (Test-Path $verDir)) {
        Write-Host "[ERROR] 版本目录不存在: $verDir" -ForegroundColor Red
        return 1
    }

    # 离线版需要先编辑配置
    if ($Version -ne "cloud" -and ($Mode -eq "all" -or $Mode -eq "app")) {
        Write-Host ""
        Write-Host "[配置] 编辑 $verLabel 版配置信息..." -ForegroundColor Yellow
        Push-Location $verDir
        try {
            & powershell -NoProfile -ExecutionPolicy Bypass -File "edit-config.ps1"
        } finally {
            Pop-Location
        }
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[ERROR] 配置编辑失败" -ForegroundColor Red
            return $LASTEXITCODE
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
        Write-Host "[APP] 打包 $verLabel 手机 APP..." -ForegroundColor Yellow
        $appBat = "$verDir\build-app.bat"
        if (Test-Path $appBat) {
            & cmd /c "$appBat" 2>&1 | ForEach-Object { Write-Host $_ }
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
    Write-Host ""

    if ($Target -eq "all") {
        return Invoke-NodeScript -ScriptPath $publishScript
    } else {
        return Invoke-NodeScript -ScriptPath $publishScript -Arguments "--target=$Target"
    }
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
        Write-Host "  [2] 离线定制版"
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
    Write-Host "  [4] 打包全部版本 (one-click-pack.ps1)"
    Write-Host "  [5] 发布全部版本 (auto-publish.js 智能检测)"
    Write-Host "  [6] 验证发布结果 (verify-release.js)"
    Write-Host "  [0] 退出"
    Write-Host ""
    Write-Host "  说明:" -ForegroundColor DarkGray
    Write-Host "  - [1][2][3] 先选版本(云端/定制/个人/全部)" -ForegroundColor DarkGray
    Write-Host "  - [1][3] 还需选范围(桌面/APP/全部)" -ForegroundColor DarkGray
    Write-Host "  - 发布使用 publish-release.js 上传到 GitHub Release" -ForegroundColor DarkGray
    Write-Host "  - git push 后 Cloudflare Pages 自动部署下载页" -ForegroundColor DarkGray
    Write-Host "--------------------------------------------"
    $choice = Read-Host "请选择 [0-6]"
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
            # 发布全部（智能检测）
            $autoPublish = "$script:RootDir\tools\auto-publish.js"
            if (Test-Path $autoPublish) {
                Write-Host ""
                Write-Host "========================================" -ForegroundColor Cyan
                Write-Host "  智能发布 (auto-publish.js)" -ForegroundColor Cyan
                Write-Host "  仅发布有变化的端" -ForegroundColor Cyan
                Write-Host "========================================" -ForegroundColor Cyan
                Invoke-NodeScript -ScriptPath $autoPublish | Out-Null
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
