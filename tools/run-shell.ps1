# run-shell.ps1 - 入口脚本启动壳（日志转录 / 验收门 / 漂移门 / 下游 bat 自愈）
# ★ 2026-10-30 P4 去重：one-click-pack.ps1 与 release-menu.ps1 此前各自复制同一套
#   启动壳（Start-Transcript + 保留 20 份 / pack-gate 调用 / 版本基线漂移门 /
#   fix-bat-crlf 自愈），任一处加门禁都要双改，且两份 pause 语义已出现分叉
#   （release-menu 的验收门失败无条件 pause，one-click-pack 受 NO_PAUSE 控制）。
#   现统一到本模块，差异只用参数表达：
#     Start-RunLog -Prefix pack|publish -RootDir <repo>        → 返回日志路径
#     Invoke-PackGate [-Capture] [-LogFile] [-FailHint] [-PauseOnFail]
#     Invoke-VersionDriftGate [-SkipPause]
#     Repair-DownstreamBats [-RootDir] [-Capture]
#     Get-ExitCode $value                                    → 防御性取真实退出码
#   依赖：调用方需先 dot-source noise-reduce.ps1（本模块用 Invoke-QuietProcess）。

function Get-ExitCode {
    param($Value)
    # 子进程输出混入返回值时 PowerShell 会把退出码追加成数组末元素；统一在此提取。
    if ($Value -is [array]) { return [int]$Value[-1] }
    return $Value
}

# ============ 日志持久化（.build-cache\logs\<prefix>-<时间戳>.log，保留最近 N 份）============
function Start-RunLog {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('pack', 'publish')][string]$Prefix,
        [string]$RootDir = (Split-Path $PSScriptRoot -Parent),
        [int]$Keep = 20
    )
    $label = if ($Prefix -eq 'pack') { '打包' } else { '发布' }
    $logDir = Join-Path $RootDir '.build-cache\logs'
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    $logFile = Join-Path $logDir ("{0}-{1}.log" -f $Prefix, (Get-Date -Format 'yyyyMMdd-HHmmss'))
    if ($Prefix -eq 'pack') { $env:PACK_LOG_FILE = $logFile } else { $env:PUBLISH_LOG_FILE = $logFile }
    try { Start-Transcript -Path $logFile -ErrorAction Stop | Out-Null }
    catch { Write-Host "[WARN] ${label}日志转录启动失败(不影响${label}): $_" -ForegroundColor Yellow }
    Write-Host "[LOG] 本次${label}日志: $logFile" -ForegroundColor DarkGray
    Get-ChildItem $logDir -Filter "$Prefix-*.log" -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep | Remove-Item -Force -ErrorAction SilentlyContinue
    return $logFile
}

# ============ 打包验收门（tools/pack-gate.ps1）：语法/BOM/CRLF/编码/热更完整性 ============
function Invoke-PackGate {
    param(
        [string]$FailHint = '打包验收门未通过，打包中止。请修复上述问题后重试。',
        [string]$LogFile = '',
        [switch]$Capture,
        [switch]$PauseOnFail
    )
    $gateTool = Join-Path $PSScriptRoot 'pack-gate.ps1'
    if (-not (Test-Path $gateTool)) { return }
    $gateArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $gateTool, '-Mode', 'preflight')
    if ($Capture) {
        $gateRc = Invoke-QuietProcess -FilePath 'powershell' -ArgumentList $gateArgs -Capture
    } else {
        $gateRc = Invoke-QuietProcess -FilePath 'powershell' -ArgumentList $gateArgs
    }
    if ($gateRc -ne 0) {
        Write-Host ""
        Write-Host "[FATAL] $FailHint" -ForegroundColor Red
        if ($LogFile) { Write-Host "  完整日志: $LogFile" -ForegroundColor Yellow }
        if ($PauseOnFail -and -not $env:NO_PAUSE) { pause }
        exit 1
    }
}

# ============ 版本基线漂移门（1.0.253/254 重名覆盖事故防呆）============
#   上次打包版本号副作用未入库 / 被还原时，HEAD 基线落后于现存产物，
#   本次 bump 会与旧产物同名覆盖且版本号错位。4 单元（2 桌面+2 APP）预检。
#   保险丝 ALLOW_VERSION_DRIFT=1。退出码 2=漂移必拦；1=工具自身异常→WARN 放行。
function Invoke-VersionDriftGate {
    param([switch]$SkipPause)
    if ($env:ALLOW_VERSION_DRIFT -eq '1') { return }
    $vbTool = Join-Path $PSScriptRoot 'verify-version-baseline.ps1'
    if (-not (Test-Path $vbTool)) { return }
    & $env:ComSpec /c "powershell -NoProfile -ExecutionPolicy Bypass -File `"$vbTool`" 2>&1" | ForEach-Object { Write-HostLine $_ }
    $vbRc = $LASTEXITCODE
    if ($vbRc -eq 2) {
        Write-Host ""
        Write-Host "[FATAL] 版本基线漂移，打包中止（修复指引见上方）。" -ForegroundColor Red
        if (-not $SkipPause) { pause }
        exit 2
    }
    if ($vbRc -eq 1) {
        Write-Host "[WARN] 版本基线检测工具异常，已跳过（不阻断打包）" -ForegroundColor Yellow
    }
}

# ============ 下游构建 bat 换行自愈（LF 会让 cmd 解析期直接闪退）============
# ★ [SELF-HEAL 2026-08-23] 在调用下游 build*.bat 之前统一修 CRLF。
#   下游 bat 清单单一权威源 tools/build-bat-list.ps1（P0 已收口）。
function Repair-DownstreamBats {
    param(
        [string]$RootDir = (Split-Path $PSScriptRoot -Parent),
        [switch]$Capture
    )
    $fixTool = Join-Path $PSScriptRoot 'fix-bat-crlf.ps1'
    if (-not (Test-Path $fixTool)) { return }
    . (Join-Path $PSScriptRoot 'build-bat-list.ps1')
    $buildBats = @($DownstreamBuildBats | ForEach-Object { Join-Path $RootDir $_ } | Where-Object { Test-Path $_ })
    $fixArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $fixTool) + $buildBats
    if ($Capture) {
        $null = Invoke-QuietProcess -FilePath 'powershell' -ArgumentList $fixArgs -Capture
    } else {
        $null = Invoke-QuietProcess -FilePath 'powershell' -ArgumentList $fixArgs
    }
}
