# one-click-pack.ps1 - One-click packaging tool for all 4 versions
# All Chinese menu logic moved here from 一键打包.bat to avoid cmd GBK encoding issues
# .ps1 with BOM can correctly handle UTF-8 Chinese display
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$script:RootDir = $PSScriptRoot | Split-Path -Parent | Split-Path -Parent
if (-not (Test-Path $script:RootDir)) {
    $script:RootDir = Split-Path $PSScriptRoot -Parent
}

# Set NO_PAUSE=1 so child build.bat / build-app.bat don't pause at end
$env:NO_PAUSE = '1'

# Run external .bat file and return exit code
function Invoke-BatFile {
    param(
        [string]$BatPath,
        [string]$WorkDir,
        [string]$Context = "external command"
    )
    if (-not (Test-Path $BatPath)) {
        Write-Host "[ERROR] File not found: $BatPath" -ForegroundColor Red
        return 1
    }
    Push-Location $WorkDir
    try {
        & cmd /c "$BatPath" 2>&1 | ForEach-Object {
            if ($_ -is [System.Management.Automation.ErrorRecord]) {
                Write-Host $_.Exception.Message -ForegroundColor Yellow
            } else {
                Write-Host $_
            }
        }
        return $LASTEXITCODE
    } finally {
        Pop-Location
    }
}

function Get-TimeStamp {
    return (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
}

# ============ Cloud Build ============
function Build-Cloud {
    param([string]$Target = "all")
    $startTime = Get-TimeStamp
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  开始打包云端版 (模式: $Target)..." -ForegroundColor Cyan
    Write-Host "  开始: $startTime" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan

    if ($Target -eq "all" -or $Target -eq "desktop") {
        Write-Host ""
        Write-Host "[Step 1/2] 打包云端桌面 exe..." -ForegroundColor Yellow
        $rc = Invoke-BatFile "$script:RootDir\cloud_project\cloud_desktop\build.bat" "$script:RootDir\cloud_project\cloud_desktop" "cloud desktop build"
        if ($rc -ne 0) {
            Write-Host ""
            Write-Host "[ERROR] 云端桌面打包失败，退出码: $rc" -ForegroundColor Red
            pause
            return
        }
    }

    if ($Target -eq "all" -or $Target -eq "app") {
        Write-Host ""
        Write-Host "[Step 2/2] 打包云端手机 APP..." -ForegroundColor Yellow
        $rc = Invoke-BatFile "$script:RootDir\cloud_project\build-app.bat" "$script:RootDir\cloud_project" "cloud app build"
        if ($rc -ne 0) {
            Write-Host ""
            Write-Host "[ERROR] 云端APP打包失败，退出码: $rc" -ForegroundColor Red
            pause
            return
        }
    }

    $endTime = Get-TimeStamp
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  云端版打包完成！" -ForegroundColor Green
    Write-Host "  开始: $startTime" -ForegroundColor Green
    Write-Host "  结束: $endTime" -ForegroundColor Green
    Write-Host "  桌面: cloud_project\cloud_desktop\dist\*.exe" -ForegroundColor Green
    Write-Host "  APP:  cloud_project\*.apk" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    pause
}

# ============ Offline Build ============
function Build-Offline {
    param(
        [string]$Version,
        [string]$Target = "all"
    )
    $verLabel = switch ($Version) {
        "bendi"   { "本地" }
        "dingzhi" { "定制" }
        "geren"   { "个人" }
        default   { $Version }
    }

    $startTime = Get-TimeStamp
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  开始打包离线$verLabel 版 (模式: $Target)..." -ForegroundColor Cyan
    Write-Host "  开始: $startTime" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan

    $verDir = "$script:RootDir\offline_project\db-$Version"

    # Step 1: Edit config (for all / app modes)
    if ($Target -eq "all" -or $Target -eq "app") {
        Write-Host ""
        if ($Target -eq "all") {
            Write-Host "[Step 1/3] 编辑配置信息..." -ForegroundColor Yellow
        } else {
            Write-Host "[Step 1/2] 编辑配置信息..." -ForegroundColor Yellow
        }
        Push-Location $verDir
        try {
            & powershell -NoProfile -ExecutionPolicy Bypass -File "edit-config.ps1"
            $rc = $LASTEXITCODE
        } finally {
            Pop-Location
        }
        if ($rc -ne 0) {
            Write-Host ""
            Write-Host "[ERROR] 配置信息编辑失败，退出码: $rc" -ForegroundColor Red
            pause
            return
        }
    }

    # Step 2: Desktop
    if ($Target -eq "all" -or $Target -eq "desktop") {
        Write-Host ""
        if ($Target -eq "all") {
            Write-Host "[Step 2/3] 打包离线$verLabel 桌面 exe..." -ForegroundColor Yellow
        } else {
            Write-Host "[Step 1/1] 打包离线$verLabel 桌面 exe..." -ForegroundColor Yellow
        }
        $rc = Invoke-BatFile "$verDir\build.bat" $verDir "offline $verLabel desktop build"
        if ($rc -ne 0) {
            Write-Host ""
            Write-Host "[ERROR] 离线$verLabel 桌面打包失败，退出码: $rc" -ForegroundColor Red
            pause
            return
        }
    }

    # Step 3: APP
    if ($Target -eq "all" -or $Target -eq "app") {
        Write-Host ""
        if ($Target -eq "all") {
            Write-Host "[Step 3/3] 打包离线$verLabel 手机 APP..." -ForegroundColor Yellow
        } else {
            Write-Host "[Step 2/2] 打包离线$verLabel 手机 APP..." -ForegroundColor Yellow
        }
        $rc = Invoke-BatFile "$verDir\build-app.bat" $verDir "offline $verLabel app build"
        if ($rc -ne 0) {
            Write-Host ""
            Write-Host "[ERROR] 离线$verLabel APP打包失败，退出码: $rc" -ForegroundColor Red
            pause
            return
        }
    }

    $endTime = Get-TimeStamp
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  离线$verLabel 版打包完成！" -ForegroundColor Green
    Write-Host "  开始: $startTime" -ForegroundColor Green
    Write-Host "  结束: $endTime" -ForegroundColor Green
    Write-Host "  桌面: offline_project\db-$Version\dist\*.exe" -ForegroundColor Green
    Write-Host "  APP:  offline_project\db-$Version\*.apk" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    pause
}

# ============ Build All ============
function Build-All {
    $allStart = Get-TimeStamp
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  全部4个版本打包开始: $allStart" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Build-Cloud -Target "all"
    Build-Offline -Version "bendi" -Target "all"
    Build-Offline -Version "dingzhi" -Target "all"
    Build-Offline -Version "geren" -Target "all"
    $allEnd = Get-TimeStamp
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  全部4个版本打包完成！" -ForegroundColor Green
    Write-Host "  开始: $allStart" -ForegroundColor Green
    Write-Host "  结束: $allEnd" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    pause
}

# ============ Pick Version Menu ============
function Show-PickVersionMenu {
    param([string]$Mode)
    $modeLabel = if ($Mode -eq "desktop") { "桌面" } else { "APP" }
    while ($true) {
        Clear-Host
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  请选择版本 - 打$modeLabel" -ForegroundColor Cyan
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  [1] 云端版"
        Write-Host "  [2] 离线本地版"
        Write-Host "  [3] 离线定制版"
        Write-Host "  [4] 离线个人版"
        Write-Host "  [0] 返回主菜单"
        $choice = Read-Host "请选择"
        switch ($choice) {
            "1" { Build-Cloud -Target $Mode; return }
            "2" { Build-Offline -Version "bendi" -Target $Mode; return }
            "3" { Build-Offline -Version "dingzhi" -Target $Mode; return }
            "4" { Build-Offline -Version "geren" -Target $Mode; return }
            "0" { return }
        }
    }
}

# ============ Interactive Menu ============
function Show-InteractiveMenu {
    while ($true) {
        Clear-Host
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  请选择版本进入交互式菜单" -ForegroundColor Cyan
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  [1] 云端版 (逐版本配置/严格模式等)"
        Write-Host "  [2] 离线本地版"
        Write-Host "  [3] 离线定制版"
        Write-Host "  [4] 离线个人版"
        Write-Host "  [0] 返回主菜单"
        $choice = Read-Host "请选择"
        switch ($choice) {
            "1" {
                Push-Location "$script:RootDir\cloud_project"
                try {
                    & powershell -NoProfile -ExecutionPolicy Bypass -File "packaging.ps1"
                } finally { Pop-Location }
            }
            "2" {
                Push-Location "$script:RootDir\offline_project\db-bendi"
                try {
                    & powershell -NoProfile -ExecutionPolicy Bypass -File "pack.bat"
                } finally { Pop-Location }
            }
            "3" {
                Push-Location "$script:RootDir\offline_project\db-dingzhi"
                try {
                    & powershell -NoProfile -ExecutionPolicy Bypass -File "pack.bat"
                } finally { Pop-Location }
            }
            "4" {
                Push-Location "$script:RootDir\offline_project\db-geren"
                try {
                    & powershell -NoProfile -ExecutionPolicy Bypass -File "pack.bat"
                } finally { Pop-Location }
            }
            "0" { return }
        }
    }
}

# ============ Main Menu ============
$menuStart = Get-TimeStamp
while ($true) {
    Clear-Host
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  惠康中医 - 一键打包工具" -ForegroundColor Cyan
    Write-Host "  (4版本统一入口 - 桌面+APP 一键搞定)" -ForegroundColor Cyan
    Write-Host "  当前: $menuStart" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  [1] 云端版 (桌面+APP)"
    Write-Host "  [2] 离线本地版 (桌面+APP)"
    Write-Host "  [3] 离线定制版 (桌面+APP)"
    Write-Host "  [4] 离线个人版 (桌面+APP)"
    Write-Host "  [5] 全部4个版本 (耗时较长)"
    Write-Host "  [0] 退出"
    Write-Host ""
    Write-Host "  --- 更多选项 ---"
    Write-Host "  [6] 单独某个版本打包 exe"
    Write-Host "  [7] 单独某个版本打 APP"
    Write-Host "  [8] 进入交互式菜单 (逐版本配置/签名/严格模式)"
    Write-Host ""
    Write-Host "  菜单说明:"
    Write-Host "  - 桌面程序: 各版本目录\dist\*.exe"
    Write-Host "  - APP 输出: 各版本目录\*.apk"
    Write-Host "  - 离线版会弹出配置编辑 (诊所名/医生等)"
    Write-Host "  - 全部打包全自动顺序执行"
    Write-Host "  - 耗时统计会在结束时显示"
    Write-Host "--------------------------------------------"
    $choice = Read-Host "请选择 [0-8]"
    switch ($choice) {
        "1" { Build-Cloud -Target "all" }
        "2" { Build-Offline -Version "bendi" -Target "all" }
        "3" { Build-Offline -Version "dingzhi" -Target "all" }
        "4" { Build-Offline -Version "geren" -Target "all" }
        "5" { Build-All }
        "6" { Show-PickVersionMenu -Mode "desktop" }
        "7" { Show-PickVersionMenu -Mode "app" }
        "8" { Show-InteractiveMenu }
        "0" { exit 0 }
        default { Write-Host "无效选择，请重试" -ForegroundColor Red; Start-Sleep -Seconds 1 }
    }
}
