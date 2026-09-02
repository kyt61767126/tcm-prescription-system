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
} else {
    # ★ 2026-09-01 中文暂停提示：交互模式下覆盖内置 pause（英文 "Press Enter to continue..."）
    Remove-Item alias:pause -ErrorAction SilentlyContinue
    function global:pause {
        $null = Read-Host '按回车键继续...'
    }
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

# ★ 2026-08-29 打包全流程日志持久化：Start-Transcript 落盘到 .build-cache\logs\
#   背景：build-pack.bat 失败横幅只报退出码不含根因，控制台一关根因即丢失
#   （2026-08-29 14:37 一键打包 6→1 出现红色 === 横幅，事后无从回溯的教训）
#   子进程 cmd/gradle 输出同控制台，全部被转录；子 bat 通过 PACK_LOG_FILE 环境变量
#   在失败横幅处回显日志路径，实现"任何失败均可事后取证"
$script:LogDir = Join-Path $script:RootDir '.build-cache\logs'
if (-not (Test-Path $script:LogDir)) { New-Item -ItemType Directory -Path $script:LogDir -Force | Out-Null }
$script:LogFile = Join-Path $script:LogDir ("pack-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$env:PACK_LOG_FILE = $script:LogFile
try { Start-Transcript -Path $script:LogFile -ErrorAction Stop | Out-Null } catch { Write-Host "[WARN] 打包日志转录启动失败(不影响打包): $_" -ForegroundColor Yellow }
Write-Host "[LOG] 本次打包日志: $script:LogFile" -ForegroundColor DarkGray
# 只保留最近 20 份日志，避免无限膨胀
Get-ChildItem $script:LogDir -Filter 'pack-*.log' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -Skip 20 | Remove-Item -Force -ErrorAction SilentlyContinue

# ★ 2026-08-24 打包增量检测（tools/build-skip.ps1）：
#   本次会话实际执行了打包的单元（SKIP 的不计入），副作用 AutoCommit 后统一记录基线
$script:BuiltUnits = @()

# ★ 2026-08-24 打包验收门（tools/pack-gate.ps1）：语法/BOM/CRLF/编码 四道快检，
#   任一失败直接阻断（历史事故：release-menu.ps1 BOM丢失解析崩 / 双重替换语法错无人发现）
$gateTool = Join-Path $PSScriptRoot 'pack-gate.ps1'
if (Test-Path $gateTool) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $gateTool -Mode preflight
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "[FATAL] 打包验收门未通过，打包中止。请修复上述问题后重试。" -ForegroundColor Red
        Write-Host "  完整日志: $script:LogFile" -ForegroundColor Yellow
        if (-not $env:NO_PAUSE) { pause }
        exit 1
    }
}
# 检查某端是否可跳过打包（指纹=git HEAD+源码干净+产物哈希 三者一致 → true）
function Test-BuildSkip([string]$unit) {
    if ($env:NO_BUILD_SKIP -eq '1') { return $false }
    $skipTool = Join-Path $PSScriptRoot 'build-skip.ps1'
    if (-not (Test-Path $skipTool)) { return $false }
    & powershell -NoProfile -ExecutionPolicy Bypass -File $skipTool -Check -Unit $unit 2>&1 | ForEach-Object { Write-Host "  $_" }
    return ($LASTEXITCODE -eq 0)
}
# 记录本次已打包单元的基线（供下次 Check 跳过）。必须在"打包成功+副作用AutoCommit后"调用（HEAD 才稳定）
function Record-BuiltUnits {
    # ★ 2026-08-25 更新摘要状态：写入 .build-cache/last-run.json（built 数组，空=全部SKIP无更新），
    #   release-menu.ps1 Invoke-FullFlow 读取后实现"无更新自动跳过发布 / 部分更新明细提示"
    $stateDir = Join-Path $script:RootDir '.build-cache'
    if (-not (Test-Path $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }
    $stateFile = Join-Path $stateDir 'last-run.json'
    try {
        $payload = @{ time = (Get-TimeStamp); built = @($script:BuiltUnits) }
        ConvertTo-Json -InputObject $payload | Out-File -FilePath $stateFile -Encoding utf8
    } catch {
        Write-Host "  [WARN] 更新摘要状态写入失败(不影响打包): $_" -ForegroundColor Yellow
    }
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
    # ★ 2026-08-31 收敛为单一权威源：与源码落定门共用 tools/pack-side-effects.ps1
    #   （此前两份清单各自维护：门禁漏 hash-manifest.json 必再误拦——举一反三收口）
    if (-not (Get-Command Get-PackSideEffectAutoPatterns -ErrorAction SilentlyContinue)) {
        . (Join-Path $PSScriptRoot 'pack-side-effects.ps1')
    }
    $autoPatterns = @(Get-PackSideEffectAutoPatterns)
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
        # ★ 2026-08-24 增量检测：源码与产物指纹一致则跳过重复打包
        if (Test-BuildSkip 'cloud-desktop') {
            Write-Host "  [SKIP] 云端桌面产物已是最新，跳过打包" -ForegroundColor Green
        } else {
            $rc = Invoke-BatFile "$script:RootDir\app_project\db-yunduan\pack-desktop.bat" "$script:RootDir\app_project\db-yunduan" "cloud desktop build"
            if ($rc -ne 0) {
                Write-Host ""
                Write-Host "[ERROR] 云端桌面打包失败，退出码: $rc" -ForegroundColor Red
                Write-Host "  完整日志: $script:LogFile" -ForegroundColor Yellow
                pause
                return $rc
            }
            $script:BuiltUnits += 'cloud-desktop'
        }
    }

    if ($Target -eq "all" -or $Target -eq "app") {
        Write-Host ""
        if ($Target -eq "all") {
            Write-Host "[Step 3/3] 打包云端手机 APP (严格模式)..." -ForegroundColor Yellow
        } else {
            Write-Host "[Step 2/2] 打包云端手机 APP (严格模式)..." -ForegroundColor Yellow
        }
        # ★ 2026-08-24 增量检测：源码与产物指纹一致则跳过重复打包
        if (Test-BuildSkip 'cloud-app') {
            Write-Host "  [SKIP] 云端APP产物已是最新，跳过打包" -ForegroundColor Green
        } else {
            $rc = Invoke-BatFile "$script:RootDir\app_project\db-yunduan\build-pack.bat" "$script:RootDir\app_project\db-yunduan" "cloud app build" "app-strict"
            if ($rc -ne 0) {
                Write-Host ""
                Write-Host "[ERROR] 云端APP打包失败，退出码: $rc" -ForegroundColor Red
                Write-Host "  完整日志: $script:LogFile" -ForegroundColor Yellow
                pause
                return $rc
            }
            $script:BuiltUnits += 'cloud-app'
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
    # ★ 2026-08-25 全局取消成功路径确认回车：云端+本地 / 全部版本组合打包自动连续执行，
    #   全程无需人工回车；失败路径的 pause 保留（错误信息必须停留屏幕供人工排查）
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
        # ★ 2026-08-24 增量检测：源码与产物指纹一致则跳过重复打包
        if (Test-BuildSkip 'local-desktop') {
            Write-Host "  [SKIP] 本地桌面产物已是最新，跳过打包" -ForegroundColor Green
        } else {
            $rc = Invoke-BatFile "$verDir\pack-desktop.bat" $verDir "offline $verLabel desktop build"
            if ($rc -ne 0) {
                Write-Host ""
                Write-Host "[ERROR] 离线$verLabel 桌面打包失败，退出码: $rc" -ForegroundColor Red
                Write-Host "  完整日志: $script:LogFile" -ForegroundColor Yellow
                pause
                return $rc
            }
            $script:BuiltUnits += 'local-desktop'
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
        # ★ 2026-08-24 增量检测：源码与产物指纹一致则跳过重复打包
        if (Test-BuildSkip 'local-app') {
            Write-Host "  [SKIP] 本地APP产物已是最新，跳过打包" -ForegroundColor Green
        } else {
            $rc = Invoke-BatFile "$verDir\build-pack.bat" $verDir "offline $verLabel app build" "app-strict"
            if ($rc -ne 0) {
                Write-Host ""
                Write-Host "[ERROR] 离线$verLabel APP打包失败，退出码: $rc" -ForegroundColor Red
                Write-Host "  完整日志: $script:LogFile" -ForegroundColor Yellow
                pause
                return $rc
            }
            $script:BuiltUnits += 'local-app'
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
    # ★ 2026-08-25 全局取消成功路径确认回车（同 Build-Cloud，组合打包自动连续执行）
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
        Write-Host "  完整日志: $script:LogFile" -ForegroundColor Yellow
    } else {
        Write-Host "  全部2个版本打包完成！" -ForegroundColor Green
        Write-Host "  开始: $allStart" -ForegroundColor Green
        Write-Host "  结束: $allEnd" -ForegroundColor Green
    }
    Write-Host "========================================" -ForegroundColor Green
    # ★ 2026-08-25 更新摘要：本次实际重打的端 vs 增量跳过的端（BuiltUnits 此时未被 Record 清空）
    $allUnits = @('cloud-desktop','cloud-app','local-desktop','local-app')
    $unitLabel = @{ 'cloud-desktop' = '云端桌面'; 'cloud-app' = '云端APP'; 'local-desktop' = '本地桌面'; 'local-app' = '本地APP' }
    $built = @($script:BuiltUnits)
    $skipped = @($allUnits | Where-Object { $built -notcontains $_ })
    Write-Host ""
    if ($built.Count -eq 0) {
        Write-Host "  [提示] 没有检测到源码更新：四端产物均已是最新，无需重新打包/上传" -ForegroundColor Yellow
    } else {
        $builtNames = ($built | ForEach-Object { $unitLabel[$_] }) -join '、'
        if ($skipped.Count -gt 0) {
            $skippedNames = ($skipped | ForEach-Object { $unitLabel[$_] }) -join '、'
            Write-Host "  [提示] 部分更新：本次重打 $($built.Count) 端（$builtNames）" -ForegroundColor Yellow
            Write-Host "         跳过 $($skipped.Count) 端（$skippedNames）产物已是最新" -ForegroundColor Yellow
        } else {
            Write-Host "  [提示] 四端全部重新打包（$builtNames）" -ForegroundColor Yellow
        }
    }
    # ★ 2026-08-25 取消成功路径确认回车（全局自动完成；失败路径 pause 保留）
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
        Write-Host "  [3] 云端+本地"
        Write-Host "  [0] 返回主菜单"
        $choice = Read-Host "请选择 [0-3]"
        switch ($choice) {
            # ★ 2026-08-23 四轮复核修复：原 $null=Build-XXX 同时吞掉①失败退出码(打包失败用户
            #   看不到任何失败提示)②不调用 SideEffectCollect(versionCode/version 副作用
            #   不被收纳, 回到主菜单后也不再展示, 与 [1][2][3] 行为不一致)
            "1" {
                $prc = Build-Cloud -Target $Mode
                if ($prc -is [array]) { $prc = [int]$prc[-1] }
                if ($prc -ne 0) {
                    Write-Host ""
                    Write-Host "[ERROR] 云端$modeLabel打包失败，退出码: $prc（完整日志: $script:LogFile）" -ForegroundColor Red
                    pause
                }
                Invoke-PackSideEffectCollect -Commit:$AutoCommit; Record-BuiltUnits
                return
            }
            "2" {
                $prc = Build-Offline -Version "dingzhi" -Target $Mode
                if ($prc -is [array]) { $prc = [int]$prc[-1] }
                if ($prc -ne 0) {
                    Write-Host ""
                    Write-Host "[ERROR] 本地$modeLabel打包失败，退出码: $prc（完整日志: $script:LogFile）" -ForegroundColor Red
                    pause
                }
                Invoke-PackSideEffectCollect -Commit:$AutoCommit; Record-BuiltUnits
                return
            }
            # ★ 云端+本地 组合：先云端后本地，云端失败仍继续打本地（与 Build-All 聚合策略一致）
            "3" {
                $rcCloud = Build-Cloud -Target $Mode
                if ($rcCloud -is [array]) { $rcCloud = [int]$rcCloud[-1] }
                if (-not $rcCloud) { $rcCloud = 0 }
                $rcOffline = Build-Offline -Version "dingzhi" -Target $Mode
                if ($rcOffline -is [array]) { $rcOffline = [int]$rcOffline[-1] }
                if (-not $rcOffline) { $rcOffline = 0 }
                if ($rcCloud -ne 0) {
                    Write-Host ""
                    Write-Host "[ERROR] 云端$modeLabel打包失败，退出码: $rcCloud（完整日志: $script:LogFile）" -ForegroundColor Red
                    pause
                }
                if ($rcOffline -ne 0) {
                    Write-Host ""
                    Write-Host "[ERROR] 本地$modeLabel打包失败，退出码: $rcOffline（完整日志: $script:LogFile）" -ForegroundColor Red
                    pause
                }
                Invoke-PackSideEffectCollect -Commit:$AutoCommit; Record-BuiltUnits
                return
            }
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
    Invoke-PackSideEffectCollect -Commit:$AutoCommit -DryRun:$DryRun; Record-BuiltUnits
    exit 0
}

# 自动模式：跳过菜单直接执行对应打包，全部完成后提示结果并自动退出（不返回菜单）
if ($AutoMode) {
    # ★ 2026-08-31 源码落定门前置（1.2.194 事故防呆，与 ensure-build-env Step 1.5 同源）：
    #   打包开始前查 git 工作区，有未提交源码修改（白名单外的）立即中止——
    #   避免白跑几分钟才被下游 ensure-build-env 门禁拦住。
    #   检测逻辑单一权威源 tools/source-settled.ps1（三处共用，白名单含
    #   build.gradle 纯 versionCode/versionName 递增）。保险丝 ALLOW_DIRTY_BUILD=1。
    if ($env:ALLOW_DIRTY_BUILD -ne '1') {
        . (Join-Path $PSScriptRoot 'source-settled.ps1')
        $dirty = @(Get-SourceSettledBlockers)
        if ($dirty.Count -gt 0) {
            Write-Host "[ERROR] 源码未落定：检测到 $($dirty.Count) 个未提交修改，打包中止（先 commit 再打包）" -ForegroundColor Red
            Write-Host "  （1.2.194 事故防呆：AI 修改中打包=装走半成品代码）" -ForegroundColor Yellow
            $dirty | Select-Object -First 10 | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
            exit 1
        }
    }
    # ★ 2026-08-23 复核修复：携带真实退出码退出（原先恒 exit 0，
    #   release-menu Invoke-Pack / Invoke-FullFlow 无法感知打包失败）
    #   防御性取值：返回值若被子进程输出污染成数组，取末元素=真实退出码
    switch ($AutoMode) {
        "1" {
            $rc = Build-Cloud -Target "all"
            if ($rc -is [array]) { $rc = [int]$rc[-1] }
            if (-not $rc) { $rc = 0 }
            Invoke-PackSideEffectCollect -Commit:$AutoCommit; Record-BuiltUnits
            exit $rc
        }
        "2" {
            $rc = Build-Offline -Version "dingzhi" -Target "all"
            if ($rc -is [array]) { $rc = [int]$rc[-1] }
            if (-not $rc) { $rc = 0 }
            Invoke-PackSideEffectCollect -Commit:$AutoCommit; Record-BuiltUnits
            exit $rc
        }
        "3" {
            $rc = Build-All
            if ($rc -is [array]) { $rc = [int]$rc[-1] }
            if (-not $rc) { $rc = 0 }
            Invoke-PackSideEffectCollect -Commit:$AutoCommit; Record-BuiltUnits
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
    $choice = Read-Host "请选择 [0-3, 5-7]"
    switch ($choice) {
        "1" { $null = Build-Cloud -Target "all"; Invoke-PackSideEffectCollect -Commit:$AutoCommit; Record-BuiltUnits }
        "2" { $null = Build-Offline -Version "dingzhi" -Target "all"; Invoke-PackSideEffectCollect -Commit:$AutoCommit; Record-BuiltUnits }
        "3" { $null = Build-All; Invoke-PackSideEffectCollect -Commit:$AutoCommit; Record-BuiltUnits }
        # ★ 2026-08-23 三轮复核修复：[5][6] 单独打包同样产生 versionCode/package.json 副作用，
        #   补 SideEffectCollect 与 [1][2][3] 行为一致（否则单独打包的副作用靠人工提交易遗漏）
        "5" { Show-PickVersionMenu -Mode "desktop"; Invoke-PackSideEffectCollect -Commit:$AutoCommit; Record-BuiltUnits }
        "6" { Show-PickVersionMenu -Mode "app"; Invoke-PackSideEffectCollect -Commit:$AutoCommit; Record-BuiltUnits }
        "7" { Show-StandaloneUsage }
        "0" { exit 0 }
        default { Write-Host "无效选择，请重试" -ForegroundColor Red; Start-Sleep -Seconds 1 }
    }
}
