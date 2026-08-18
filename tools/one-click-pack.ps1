# one-click-pack.ps1 - One-click packaging tool for all 4 versions
# All Chinese menu logic moved here from 一键打包.bat to avoid cmd GBK encoding issues
# .ps1 with BOM can correctly handle UTF-8 Chinese display
param(
    [string]$AutoMode = ""   # 非空时跳过菜单直接执行：1=云端 2=本地 3=全部，全程不暂停，完成后自动退出
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# 自动模式（AutoMode 非空）下跳过所有 pause 交互暂停，实现"一键完成、无需确定"
$script:SkipPause = $false
if ($AutoMode) { $script:SkipPause = $true }

# 自动模式下覆盖 pause：移除内置别名并定义空函数，使所有 pause 调用变为空操作
if ($script:SkipPause) {
    Remove-Item alias:pause -ErrorAction SilentlyContinue
    function global:pause {}
}

# 脚本位于 <仓库根>\tools\，仓库根 = $PSScriptRoot 的上级
$script:RootDir = Split-Path $PSScriptRoot -Parent
# 若该层无 app_project（脚本被移动/复制），向上找包含 app_project 的目录
$probe = $script:RootDir
while ($probe -and -not (Test-Path (Join-Path $probe "app_project"))) {
    $probe = Split-Path $probe -Parent
}
if ($probe) { $script:RootDir = $probe }

# Set NO_PAUSE=1 so child build.bat / build-app.bat don't pause at end
$env:NO_PAUSE = '1'

# Run external .bat file and return exit code
function Invoke-BatFile {
    param(
        [string]$BatPath,
        [string]$WorkDir,
        [string]$Context = "external command",
        [string]$Arguments = ""
    )
    if (-not (Test-Path $BatPath)) {
        Write-Host "[ERROR] File not found: $BatPath" -ForegroundColor Red
        return 1
    }
    Push-Location $WorkDir
    try {
        & cmd /c "$BatPath $Arguments" 2>&1 | ForEach-Object {
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

# 显示最新 APK 实际信息（文件名/版本号/versionCode/文件时间），供一键打包总结记录
# 直接在打包完成后读取产物文件时间，确保展示的是"最新一次打包"的真实记录
function Show-LatestApk {
    param(
        [string]$Dir,        # APK 所在目录（如 db-yunduan）
        [string]$GradleFile, # 对应 app\build.gradle（读取 versionName/versionCode）
        [string]$Label       # 显示标签，如 "云端APP"
    )
    $apk = Get-ChildItem (Join-Path $Dir '*.apk') -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $apk) {
        Write-Host "  ${Label}: (未找到 APK)" -ForegroundColor Yellow
        return
    }
    $vname = '?'
    $vcode = '?'
    if (Test-Path $GradleFile) {
        $c = Get-Content $GradleFile -Raw -Encoding UTF8
        if ($c -match 'versionName\s+"([^"]+)"') { $vname = $matches[1] }
        if ($c -match 'versionCode\s+(\d+)')     { $vcode = $matches[1] }
    }
    $ftime = $apk.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
    Write-Host ("  {0}: {1}  版本 {2} (versionCode {3})  文件时间 {4}" -f $Label, $apk.Name, $vname, $vcode, $ftime) -ForegroundColor Green
}

# 显示最新 EXE 实际信息（文件名/文件时间），供一键打包总结记录
function Show-LatestExe {
    param(
        [string]$Dir,   # dist 目录
        [string]$Label  # 显示标签，如 "云端桌面"
    )
    $exe = Get-ChildItem (Join-Path $Dir '*.exe') -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $exe) {
        Write-Host "  ${Label}: (未找到 EXE)" -ForegroundColor Yellow
        return
    }
    $ftime = $exe.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
    Write-Host ("  {0}: {1}  文件时间 {2}" -f $Label, $exe.Name, $ftime) -ForegroundColor Green
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

    # 云端版直接使用 config.json 默认值（XXX中医诊所/XXX医生），不弹配置编辑窗口
    # 设置 SKIP_CONFIG=1，使桌面 cloud_desktop\build.bat 与 build-app.bat 整轮跳过后台配置编辑
    $env:SKIP_CONFIG = "1"

    # Step 1: Edit config (for all / app modes) - 跳过后台配置编辑，仅同步 config.json 到 Capacitor
    if ($Target -eq "all" -or $Target -eq "app") {
        Write-Host ""
        if ($Target -eq "all") {
            Write-Host "[Step 1/3] 同步默认配置 (跳过编辑)..." -ForegroundColor Yellow
        } else {
            Write-Host "[Step 1/2] 同步默认配置 (跳过编辑)..." -ForegroundColor Yellow
        }
        Push-Location "$script:RootDir\app_project\db-yunduan"
        try {
            & powershell -NoProfile -ExecutionPolicy Bypass -File "edit-config.ps1" -SkipConfig
            $rc = $LASTEXITCODE
        } finally {
            Pop-Location
        }
        if ($rc -ne 0) {
            Write-Host ""
            Write-Host "[WARN] 配置同步出现警告(继续打包)，退出码: $rc" -ForegroundColor Yellow
        }
    }

    if ($Target -eq "all" -or $Target -eq "desktop") {
        Write-Host ""
        if ($Target -eq "all") {
            Write-Host "[Step 2/3] 打包云端桌面 exe..." -ForegroundColor Yellow
        } else {
            Write-Host "[Step 1/1] 打包云端桌面 exe..." -ForegroundColor Yellow
        }
        $rc = Invoke-BatFile "$script:RootDir\app_project\db-yunduan\pack-desktop.bat" "$script:RootDir\app_project\db-yunduan" "cloud desktop build"
        if ($rc -ne 0) {
            Write-Host ""
            Write-Host "[ERROR] 云端桌面打包失败，退出码: $rc" -ForegroundColor Red
            pause
            return
        }
    }

    if ($Target -eq "all" -or $Target -eq "app") {
        Write-Host ""
        if ($Target -eq "all") {
            Write-Host "[Step 3/3] 打包云端手机 APP (严格模式)..." -ForegroundColor Yellow
        } else {
            Write-Host "[Step 2/2] 打包云端手机 APP (严格模式)..." -ForegroundColor Yellow
        }
        $rc = Invoke-BatFile "$script:RootDir\app_project\db-yunduan\build-pack.bat" "$script:RootDir\app_project\db-yunduan" "cloud app build" "app-strict"
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
    Write-Host "  --- 最新产物记录 ---" -ForegroundColor Cyan
    Show-LatestExe -Dir "$script:RootDir\app_project\db-yunduan\cloud_desktop\dist" -Label "云端桌面"
    Show-LatestApk -Dir "$script:RootDir\app_project\db-yunduan" -GradleFile "$script:RootDir\app_project\db-yunduan\cloud_app\app\build.gradle" -Label "云端APP"
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
        "dingzhi" { "本地" }
        default   { $Version }
    }

    $startTime = Get-TimeStamp
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  开始打包离线$verLabel 版 (模式: $Target)..." -ForegroundColor Cyan
    Write-Host "  开始: $startTime" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan

    $verDir = "$script:RootDir\app_project\db-offline"

    # 离线版直接使用 config.json 默认值（XXX中医诊所/XXX医生），不弹配置编辑窗口
    # 设置 SKIP_CONFIG=1，使桌面 build.bat 与 APP build-app.bat 整轮跳过后台配置编辑
    $env:SKIP_CONFIG = "1"

    # Step 1: Edit config (for all / app modes) - 跳过后台配置编辑，仅同步 config.json 到 Capacitor
    if ($Target -eq "all" -or $Target -eq "app") {
        Write-Host ""
        if ($Target -eq "all") {
            Write-Host "[Step 1/3] 同步默认配置 (跳过编辑)..." -ForegroundColor Yellow
        } else {
            Write-Host "[Step 1/2] 同步默认配置 (跳过编辑)..." -ForegroundColor Yellow
        }
        Push-Location $verDir
        try {
            & powershell -NoProfile -ExecutionPolicy Bypass -File "edit-config.ps1" -SkipConfig
            $rc = $LASTEXITCODE
        } finally {
            Pop-Location
        }
        if ($rc -ne 0) {
            Write-Host ""
            Write-Host "[WARN] 配置同步出现警告(继续打包)，退出码: $rc" -ForegroundColor Yellow
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
        $rc = Invoke-BatFile "$verDir\pack-desktop.bat" $verDir "offline $verLabel desktop build"
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
            Write-Host "[Step 3/3] 打包离线${verLabel} 手机 APP (严格模式)..." -ForegroundColor Yellow
        } else {
            Write-Host "[Step 2/2] 打包离线${verLabel} 手机 APP (严格模式)..." -ForegroundColor Yellow
        }
        $rc = Invoke-BatFile "$verDir\build-pack.bat" $verDir "offline $verLabel app build" "app-strict"
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
    Write-Host "  --- 最新产物记录 ---" -ForegroundColor Cyan
    Show-LatestExe -Dir "$script:RootDir\app_project\db-offline\desktop\dist" -Label "离线桌面"
    Show-LatestApk -Dir "$script:RootDir\app_project\db-offline" -GradleFile "$script:RootDir\app_project\db-offline\app\app\build.gradle" -Label "离线APP"
    Write-Host "========================================" -ForegroundColor Green
    pause
}

# ============ Build All ============
function Build-All {
    $allStart = Get-TimeStamp
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  全部2个版本打包开始: $allStart" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Build-Cloud -Target "all"
    Build-Offline -Version "dingzhi" -Target "all"
    $allEnd = Get-TimeStamp
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  全部2个版本打包完成！" -ForegroundColor Green
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
        Write-Host "  [2] 本地版"
        Write-Host "  [0] 返回主菜单"
        $choice = Read-Host "请选择"
        switch ($choice) {
            "1" { Build-Cloud -Target $Mode; return }
            "2" { Build-Offline -Version "dingzhi" -Target $Mode; return }
            "0" { return }
        }
    }
}

# ============ Show Standalone Usage ============
function Show-StandaloneUsage {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  各版本独立打包入口" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  云端版 (app_project/db-yunduan):" -ForegroundColor Yellow
    Write-Host "    pack-desktop.bat       打包桌面版"
    Write-Host "    build-app.bat          打包手机APP"
    Write-Host "    pack-app-strict.bat    严格模式APP"
    Write-Host ""
    Write-Host "  本地版 (app_project/db-offline):" -ForegroundColor Yellow
    Write-Host "    pack-desktop.bat       打包桌面版"
    Write-Host "    build-app.bat          打包手机APP"
    Write-Host "    pack-app-strict.bat    严格模式APP"
    Write-Host ""
    Write-Host "  提示: 直接双击对应目录下的 bat 文件即可" -ForegroundColor DarkGray
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    pause
}

# ============ Main Menu ============
$menuStart = Get-TimeStamp

# 自动模式：跳过菜单直接执行对应打包，全部完成后提示结果并自动退出（不返回菜单）
if ($AutoMode) {
    switch ($AutoMode) {
        "1" { Build-Cloud -Target "all"; exit 0 }
        "2" { Build-Offline -Version "dingzhi" -Target "all"; exit 0 }
        "3" { Build-All; exit 0 }
        default {
            Write-Host "[ERROR] 无效自动模式: $AutoMode（应为 1=云端 2=本地 3=全部）" -ForegroundColor Red
            exit 1
        }
    }
}

while ($true) {
    Clear-Host
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  惠康中医 - 一键打包工具" -ForegroundColor Cyan
    Write-Host "  (2版本统一入口 - 桌面+APP 一键搞定)" -ForegroundColor Cyan
    Write-Host "  当前: $menuStart" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  [1] 云端版 (桌面+APP)"
    Write-Host "  [2] 本地版 (桌面+APP)"
    Write-Host "  [3] 全部2个版本 (耗时较长)"
    Write-Host "  [0] 退出"
    Write-Host ""
    Write-Host "  --- 更多选项 ---"
    Write-Host "  [5] 单独某个版本打包 exe"
    Write-Host "  [6] 单独某个版本打 APP"
    Write-Host "  [7] 查看各版本独立打包入口"
    Write-Host ""
    Write-Host "  菜单说明:"
    Write-Host "  - 桌面程序: 各版本目录\dist\*.exe"
    Write-Host "  - APP 输出: 各版本目录\*.apk"
    Write-Host "  - 离线版默认使用配置(XXX中医诊所/XXX)直接打包, 不弹配置编辑"
    Write-Host "  - 全部打包全自动顺序执行, 手机APP默认严格模式(签名校验+混淆)"
    Write-Host "  - 耗时统计会在结束时显示"
    Write-Host "--------------------------------------------"
    $choice = Read-Host "请选择 [0-7]"
    switch ($choice) {
        "1" { Build-Cloud -Target "all" }
        "2" { Build-Offline -Version "dingzhi" -Target "all" }
        "3" { Build-All }
        "5" { Show-PickVersionMenu -Mode "desktop" }
        "6" { Show-PickVersionMenu -Mode "app" }
        "7" { Show-StandaloneUsage }
        "0" { exit 0 }
        default { Write-Host "无效选择，请重试" -ForegroundColor Red; Start-Sleep -Seconds 1 }
    }
}
