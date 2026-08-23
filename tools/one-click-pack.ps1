# one-click-pack.ps1 - One-click packaging tool for all 4 versions
# All Chinese menu logic moved here from 一键打包.bat to avoid cmd GBK encoding issues
# .ps1 with BOM can correctly handle UTF-8 Chinese display
param(
    [string]$AutoMode = "",   # 非空时跳过菜单直接执行：1=云端 2=本地 3=全部，全程不暂停，完成后自动退出
    [switch]$AutoCommit,      # P1-B: 打包完成后自动收纳打包副作用（versionCode/version/hash-manifest 提交并推送；index.html 等其余变更仅列出待人工确认）
    [switch]$CollectSideEffectsOnly,  # P1-B: 仅执行打包副作用收纳（预览/测试用，不打包）
    [switch]$DryRun           # P1-B: 配合收纳逻辑，只打印将执行的 git 命令不实际执行（测试用）
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

# ★ [SELF-HEAL 2026-08-23] Fix LF line endings in ALL downstream build .bat files
# BEFORE invoking them. This script calls build-pack.bat directly (bypassing
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

# ============ P1-B 打包副作用收纳 ============
# 背景：全局审查 R3——打包副作用（build.gradle versionCode / package.json version /
#       hash-manifest.json）靠人工提交易遗漏，造成"本机有、仓库无"的基线偏差。
# 原则：宁漏检不可误报——只自动收纳确定性副作用文件；index.html 等可能含手工改动
#       的文件仅列出交人工确认，绝不盲目 git add -A。
function Invoke-PackSideEffectCollect {
    param(
        [switch]$Commit,
        [switch]$DryRun
    )
    Write-Host ""
    Write-Host "--- 打包副作用收纳 (P1-B) ---" -ForegroundColor Cyan
    $raw = & git -C $script:RootDir status --short 2>$null
    if (-not $raw) {
        Write-Host "  [OK] 工作区干净，无打包副作用" -ForegroundColor Green
        return
    }
    # 确定性副作用（打包自动递增/重写）：仅这些允许自动收纳
    $autoPatterns = @(
        '^app_project/.+/build\.gradle$',       # APP versionCode 递增
        '^app_project/.+/package\.json$',       # 桌面版本号递增
        '^public/hash-manifest\.json$',         # 产物哈希清单
        '^app_project/.+/hash-manifest\.json$'  # 产物哈希清单副本(若有)
    )
    # 可能含手工改动的文件：只列出，绝不自动收纳
    $manualPatterns = @(
        '^app_project/.+/index\.html$',
        '^app_project/.+/\.interface-lock\.json$'
    )
    $auto = @(); $manual = @(); $other = @()
    foreach ($line in $raw) {
        if ($line.Length -lt 4) { continue }
        $f = $line.Substring(3).Trim('"')
        $cls = $null
        foreach ($p in $manualPatterns) { if ($f -match $p) { $cls = 'manual'; break } }
        if (-not $cls) { foreach ($p in $autoPatterns) { if ($f -match $p) { $cls = 'auto'; break } } }
        if (-not $cls) { $cls = 'other' }
        switch ($cls) {
            'auto'   { $auto += $f }
            'manual' { $manual += $f }
            'other'  { $other += $f }
        }
    }
    if ($auto.Count -gt 0) {
        Write-Host "  确定性打包副作用（$($auto.Count) 个）:" -ForegroundColor Yellow
        $auto | ForEach-Object { Write-Host "    $_" }
        if ($Commit) {
            $msgLines = @(
                "build: 一键打包副作用自动收纳",
                "",
                "versionCode/version 递增与 hash-manifest 重写（one-click-pack.ps1 -AutoCommit 自动提交）。",
                "文件:"
            ) + @($auto | ForEach-Object { "- $_" })
            $msg = $msgLines -join "`n"
            if ($DryRun) {
                Write-Host "  [DryRun] 将执行: git add -- $($auto -join ' ')" -ForegroundColor Magenta
                Write-Host "  [DryRun] 将执行: git commit -m <收纳提交信息 $($auto.Count) 个文件>" -ForegroundColor Magenta
                Write-Host "  [DryRun] 将执行: git push" -ForegroundColor Magenta
            } else {
                & git -C $script:RootDir add -- $auto
                if ($LASTEXITCODE -ne 0) { Write-Host "  [WARN] git add 失败，请人工处理" -ForegroundColor Yellow; return }
                & git -C $script:RootDir commit -m $msg
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "  [OK] 副作用已提交，推送中..." -ForegroundColor Green
                    & git -C $script:RootDir push
                    if ($LASTEXITCODE -ne 0) { Write-Host "  [WARN] push 失败，请稍后手动 git push" -ForegroundColor Yellow }
                } else {
                    Write-Host "  [WARN] 提交失败，请人工处理" -ForegroundColor Yellow
                }
            }
        } else {
            Write-Host "  提示: 加 -AutoCommit 可自动提交推送以上副作用文件" -ForegroundColor DarkGray
        }
    }
    foreach ($grp in @(@('需人工确认-不自动收纳', $manual), @('其他变更-与本工具无关', $other))) {
        if ($grp[1].Count -gt 0) {
            Write-Host "  $($grp[0])（$($grp[1].Count) 个）:" -ForegroundColor Yellow
            $grp[1] | ForEach-Object { Write-Host "    $_" }
        }
    }
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
            return $rc
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
            return $rc
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
    # ★ 2026-08-23 复核修复：成功路径显式返回0（供 Build-All/-AutoMode 聚合退出码）
    return 0
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
            return $rc
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
            return $rc
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
    # ★ 2026-08-23 复核修复：成功路径显式返回0（供 Build-All/-AutoMode 聚合退出码）
    return 0
}

# ============ Build All ============
function Build-All {
    $allStart = Get-TimeStamp
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  全部2个版本打包开始: $allStart" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    # ★ 2026-08-23 复核修复：捕获各版本退出码（云端失败仍继续打本地版，但最终聚合上报）
    $rcCloud = Build-Cloud -Target "all"
    $rcOffline = Build-Offline -Version "dingzhi" -Target "all"
    # 防御性取值（若返回值被子进程输出意外污染成数组，取末元素=真实退出码）
    if ($rcCloud -is [array])   { $rcCloud = [int]$rcCloud[-1] }
    if ($rcOffline -is [array]) { $rcOffline = [int]$rcOffline[-1] }
    if (-not $rcCloud)   { $rcCloud = 0 }
    if (-not $rcOffline) { $rcOffline = 0 }
    $allEnd = Get-TimeStamp
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    if ($rcCloud -ne 0 -or $rcOffline -ne 0) {
        Write-Host "  全部2个版本打包结束（含失败项！）: $allEnd" -ForegroundColor Yellow
        if ($rcCloud -ne 0)   { Write-Host "  - 云端版打包失败，退出码: $rcCloud" -ForegroundColor Red }
        if ($rcOffline -ne 0) { Write-Host "  - 本地版打包失败，退出码: $rcOffline" -ForegroundColor Red }
    } else {
        Write-Host "  全部2个版本打包完成！" -ForegroundColor Green
        Write-Host "  开始: $allStart" -ForegroundColor Green
        Write-Host "  结束: $allEnd" -ForegroundColor Green
    }
    Write-Host "========================================" -ForegroundColor Green
    pause
    # 聚合退出码：任一版本失败即非0（供 -AutoMode / release-menu Invoke-Pack 判断成败）
    if ($rcCloud -ne 0)   { return [int]$rcCloud }
    if ($rcOffline -ne 0) { return [int]$rcOffline }
    return 0
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
            "1" { $null = Build-Cloud -Target $Mode; return }
            "2" { $null = Build-Offline -Version "dingzhi" -Target $Mode; return }
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
    Write-Host "    pack-app.bat           打包手机APP (严格模式)"
    Write-Host ""
    Write-Host "  本地版 (app_project/db-offline):" -ForegroundColor Yellow
    Write-Host "    pack-desktop.bat       打包桌面版"
    Write-Host "    pack-app.bat           打包手机APP (严格模式)"
    Write-Host ""
    Write-Host "  提示: 直接双击对应目录下的 bat 文件即可" -ForegroundColor DarkGray
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    pause
}

# ============ Main Menu ============
$menuStart = Get-TimeStamp

# P1-B: 仅执行打包副作用收纳（预览/测试用，不打包）
if ($CollectSideEffectsOnly) {
    Invoke-PackSideEffectCollect -Commit:$AutoCommit -DryRun:$DryRun
    exit 0
}

# 自动模式：跳过菜单直接执行对应打包，全部完成后提示结果并自动退出（不返回菜单）
if ($AutoMode) {
    # ★ 2026-08-23 复核修复：携带真实退出码退出（原先恒 exit 0，
    #   release-menu Invoke-Pack / Invoke-FullFlow 无法感知打包失败）
    #   防御性取值：返回值若被子进程输出污染成数组，取末元素=真实退出码
    switch ($AutoMode) {
        "1" {
            $rc = Build-Cloud -Target "all"
            if ($rc -is [array]) { $rc = [int]$rc[-1] }
            if (-not $rc) { $rc = 0 }
            Invoke-PackSideEffectCollect -Commit:$AutoCommit
            exit $rc
        }
        "2" {
            $rc = Build-Offline -Version "dingzhi" -Target "all"
            if ($rc -is [array]) { $rc = [int]$rc[-1] }
            if (-not $rc) { $rc = 0 }
            Invoke-PackSideEffectCollect -Commit:$AutoCommit
            exit $rc
        }
        "3" {
            $rc = Build-All
            if ($rc -is [array]) { $rc = [int]$rc[-1] }
            if (-not $rc) { $rc = 0 }
            Invoke-PackSideEffectCollect -Commit:$AutoCommit
            exit $rc
        }
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
    Write-Host "  - ★ 仅打包不上传; 如需发布到下载页/GitHub Release 请运行 一键发布.bat" -ForegroundColor Yellow
    Write-Host "--------------------------------------------"
    $choice = Read-Host "请选择 [0-7]"
    switch ($choice) {
        "1" { $null = Build-Cloud -Target "all"; Invoke-PackSideEffectCollect -Commit:$AutoCommit }
        "2" { $null = Build-Offline -Version "dingzhi" -Target "all"; Invoke-PackSideEffectCollect -Commit:$AutoCommit }
        "3" { $null = Build-All; Invoke-PackSideEffectCollect -Commit:$AutoCommit }
        "5" { Show-PickVersionMenu -Mode "desktop" }
        "6" { Show-PickVersionMenu -Mode "app" }
        "7" { Show-StandaloneUsage }
        "0" { exit 0 }
        default { Write-Host "无效选择，请重试" -ForegroundColor Red; Start-Sleep -Seconds 1 }
    }
}
