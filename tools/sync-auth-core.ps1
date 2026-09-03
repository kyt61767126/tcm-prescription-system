# ============================================================================
#  sync-auth-core.ps1 - auth-core.js dual-source sync tool
#
#  Purpose:
#    auth-core.js has TWO legitimate content versions (offline/cloud),
#    so it CANNOT use the single-source sync in sync-all.ps1 Group 1
#    (that was the root cause of the 2026-08 drift: cloud copy overwrote
#    offline targets and silently removed trial-enforced-standard-edition).
#
#    This script is the ONLY authority for auth-core.js distribution:
#      shared/auth-core/offline.js (2187, trial + heartbeat)
#        -> 3 offline targets
#      shared/auth-core/cloud.js   (2123, validate, no trial)
#        -> 8 cloud targets (incl. shared/auth-core.js root mirror)
#
#  Usage:
#    powershell -File tools\sync-auth-core.ps1               # Sync
#    powershell -File tools\sync-auth-core.ps1 -VerifyOnly   # Check only (exit 1)
#
#  Wired into: app_project/db-offline/build-pack.bat (desktop/app/app-strict)
#              app_project/db-yunduan/build-pack.bat (desktop/app/app-strict)
#  NOTE: sync-all.ps1 no longer manages auth-core.js (see its Group 1 comment).
# ============================================================================
#Requires -Version 5.0
[CmdletBinding()]
param(
    [switch]$VerifyOnly = $false
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$SourceDir = Join-Path $ProjectRoot 'shared\auth-core'

# --- Fact sources -----------------------------------------------------------
$OfflineSource = Join-Path $SourceDir 'offline.js'   # offline full (trial)
$CloudSource   = Join-Path $SourceDir 'cloud.js'    # cloud (no trial)
# 2026-09-03 ActivationObserver：客户端激活统一观察者（KNOWLEDGE 架构 P2 客户端收敛）。
#   同步策略：把 observer 源码拼到 auth-core.js 文件头（prepend）→ 单文件
#   全局变量 ObserveActivationStatus 可用，避免改任何 HTML <script> 引入顺序
#   （KNOWLEDGE 铁律：禁止修改 HTML 结构/CSS）。
$ObserverSource = Join-Path $ProjectRoot 'shared\service\activation-observer.js'
$ObserverBanner = "/* PREPENDED activation-observer.js (see shared/service/activation-observer.js @ project root) */" + "`r`n"

function New-PrependedSource {
    param([string]$BaseSource, [string]$TmpPrefix)
    $observerContent = [System.IO.File]::ReadAllText($ObserverSource, [System.Text.UTF8Encoding]::new($false))
    $baseContent     = [System.IO.File]::ReadAllText($BaseSource, [System.Text.UTF8Encoding]::new($false))
    $tmp = Join-Path $env:TEMP ($TmpPrefix + "-" + [System.IO.Path]::GetFileName($BaseSource) + "-with-observer-prepended.tmp.js")
    $combined = $ObserverBanner + $observerContent + "`r`n`r`n" + $baseContent
    [System.IO.File]::WriteAllText($tmp, $combined, [System.Text.UTF8Encoding]::new($false))
    return $tmp
}
function Remove-PrependedTmp {
    param([string]$TmpFile)
    try { if ($TmpFile -and (Test-Path $TmpFile)) { Remove-Item -Path $TmpFile -Force -ErrorAction SilentlyContinue } } catch {}
}

# --- Targets (relative to project root, forward slashes for x-platform) -----
$OfflineTargets = @(
    'app_project/db-offline/desktop',                      # offline desktop main (index.html)
    'app_project/db-offline/desktop/electron',             # offline desktop login.html (fixed 2026-08 drift)
    'app_project/db-offline/app/app/src/main/assets/public'# offline APP assets (build-app.bat re-copies from ../desktop)
)

$CloudTargets = @(
    'public',                                              # cloud web (deployed by wrangler)
    'public/electron',                                     # cloud web electron mirror
    'app_project/db-yunduan/cloud_desktop',                # cloud desktop main
    'app_project/db-yunduan/cloud_desktop/electron',       # cloud desktop electron
    'app_project/db-yunduan/cloud_app/app/src/main/assets/public', # cloud APP assets
    'site-admin',                                          # admin console web
    'site-admin/electron',                                 # admin console electron
    'shared',                                              # shared/auth-core.js root mirror (canonical source for cloud variants)
    'app_project_harmony/huikang-cloud/entry/src/main/resources/rawfile' # ★ 2026-09-02 鸿蒙云端版 rawfile（原为手工同步盲区，曾漏付款按钮兜底修复）
)

# ============================================================================
# Helper: Get SHA256 hash of a file
# ============================================================================
function Get-FileSha256 {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    try {
        return (Get-FileHash $Path -Algorithm SHA256).Hash
    } catch { return $null }
}

# ============================================================================
# Helper: Sync a single file with SHA256 comparison
# ============================================================================
function Sync-File {
    param(
        [string]$Source,
        [string]$Target,
        [string]$Label,
        [bool]$VerifyOnly
    )

    if (-not (Test-Path $Source)) {
        Write-Host "  [ERROR] Fact source not found: $Source" -ForegroundColor Red
        return $false
    }

    $targetDir = Split-Path -Parent $Target
    if (-not (Test-Path $targetDir)) {
        if ($VerifyOnly) {
            Write-Host "  [MISS] $Label (target dir missing)" -ForegroundColor Yellow
            return $false
        }
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }

    $sourceHash = Get-FileSha256 $Source
    $targetHash = Get-FileSha256 $Target

    if ($sourceHash -eq $targetHash) {
        return $true
    }

    if ($VerifyOnly) {
        Write-Host "  [DIFF] $Label" -ForegroundColor Yellow
        return $false
    }

    # ★ 2026-08-19 防文件占用锁（CLOUD/offline 构建互踩）
    #   sync-auth-core 会同时同步 offline 与 cloud 两组目标；构建 cloud 时若
    #   之前残留的 node/gradle 进程仍占用 offline APP 的 auth-core.js，
    #   Copy-Item 会抛 IOException 导致整次构建中断。这里加短重试（间隔0.5s，
    #   至多5次），占用为瞬时态时可自动绕过；若持续占用则明确报错。
    $copied = $false
    for ($attempt = 1; $attempt -le 5; $attempt++) {
        try {
            Copy-Item -Path $Source -Destination $Target -Force -ErrorAction Stop
            $copied = $true
            break
        } catch [System.IO.IOException] {
            if ($attempt -lt 5) {
                Start-Sleep -Milliseconds 500
                continue
            }
        } catch {
            # 非占用类错误（路径/无权限等）直接抛出
            throw
        }
    }
    if (-not $copied) {
        Write-Host "  [ERROR] $Label 文件被占用且重试5次仍无法写入（可能是残留node/gradle进程）" -ForegroundColor Red
        Write-Host "         请结束后台 node/java 进程后重试构建" -ForegroundColor Yellow
        return $false
    }
    Write-Host "  [SYNC] $Label" -ForegroundColor Green
    return $true
}

# ============================================================================
# Helper: Sync one fact source to a list of target dirs (file kept as auth-core.js)
# ============================================================================
function Sync-Group {
    param(
        [string]$GroupName,
        [string]$Source,
        [string[]]$Targets,
        [bool]$VerifyOnly
    )

    Write-Host "--- [$GroupName] ---" -ForegroundColor Cyan
    $allOk = $true
    $checked = 0
    $inSync = 0

    foreach ($target in $Targets) {
        $checked++
        $dstPath = Join-Path (Join-Path $ProjectRoot $target) 'auth-core.js'
        $result = Sync-File -Source $Source -Target $dstPath -Label "$target/auth-core.js" -VerifyOnly $VerifyOnly
        if ($result) { $inSync++ } else { $allOk = $false }
    }
    Write-Host "  Checked: $checked, In sync: $inSync"
    return $allOk
}

# ============================================================================
# Main
# ============================================================================
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Sync auth-core.js (dual source)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Project root: $ProjectRoot"
Write-Host "Mode: $(if ($VerifyOnly) { 'Verify only' } else { 'Sync' })"
Write-Host ""

if (-not (Test-Path $SourceDir)) {
    Write-Host "[ERROR] Fact source dir not found: $SourceDir" -ForegroundColor Red
    exit 1
}

$allOk = $true

# ★ Prepare prepended temp sources (with activation-observer header)
#   单文件 ObserveActivationStatus 全局生效 — 0 HTML 改动
#   ★ VerifyOnly 模式同样构建 prepend 后的临时文件再对比（2026-09-03 交接修复：
#     原 verify 用纯源 SHA 对比前置后目标 → 永远 DIFF → pre-push 三道校验被卡死）
$tmpOffline = $null
$tmpCloud   = $null
$effectiveOffline = $OfflineSource
$effectiveCloud   = $CloudSource
if (Test-Path $ObserverSource) {
    $tmpOffline = New-PrependedSource -BaseSource $OfflineSource -TmpPrefix 'offline'
    $tmpCloud   = New-PrependedSource -BaseSource $CloudSource   -TmpPrefix 'cloud'
    $effectiveOffline = $tmpOffline
    $effectiveCloud   = $tmpCloud
    Write-Host "[PREPEND] activation-observer.js -> auth-core header (0 HTML change enabled)"
} else {
    Write-Host "[WARN] Observer source missing at: $ObserverSource — sync without prepend (observer fallback to legacy setInterval paths)" -ForegroundColor Yellow
}

try {
    $result = Sync-Group -GroupName 'OFFLINE offline.js -> 3 targets (trial edition)' -Source $effectiveOffline -Targets $OfflineTargets -VerifyOnly $VerifyOnly
    if (-not $result) { $allOk = $false }
    Write-Host ""

    $result = Sync-Group -GroupName 'CLOUD cloud.js -> 8 targets (no trial)' -Source $effectiveCloud -Targets $CloudTargets -VerifyOnly $VerifyOnly
    if (-not $result) { $allOk = $false }
    Write-Host ""
} finally {
    Remove-PrependedTmp $tmpOffline
    Remove-PrependedTmp $tmpCloud
}

# ============================================================================
# Summary
# ============================================================================
Write-Host "========================================" -ForegroundColor Cyan
if ($VerifyOnly) {
    if ($allOk) {
        Write-Host "[OK] All 11 auth-core.js copies in sync" -ForegroundColor Green
        exit 0
    } else {
        Write-Host "[FAIL] auth-core.js copies out of sync" -ForegroundColor Red
        Write-Host "Fix: edit shared/auth-core/offline.js or cloud.js," -ForegroundColor Yellow
        Write-Host "     then run this script WITHOUT -VerifyOnly" -ForegroundColor Yellow
        exit 1
    }
} else {
    if ($allOk) {
        Write-Host "[OK] auth-core.js sync completed (11 copies -> 2 content versions)" -ForegroundColor Green
        exit 0
    } else {
        Write-Host "[FAIL] auth-core.js sync had errors" -ForegroundColor Red
        exit 1
    }
}
