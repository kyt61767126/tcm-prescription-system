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
    'shared'                                               # shared/auth-core.js root mirror (packaging.ps1 source)
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

    Copy-Item -Path $Source -Destination $Target -Force
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

$result = Sync-Group -GroupName 'OFFLINE offline.js -> 3 targets (trial edition)' -Source $OfflineSource -Targets $OfflineTargets -VerifyOnly $VerifyOnly
if (-not $result) { $allOk = $false }
Write-Host ""

$result = Sync-Group -GroupName 'CLOUD cloud.js -> 8 targets (no trial)' -Source $CloudSource -Targets $CloudTargets -VerifyOnly $VerifyOnly
if (-not $result) { $allOk = $false }
Write-Host ""

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
