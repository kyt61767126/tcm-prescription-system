# ============================================================================
#  sync-all.ps1 - Unified sync script for all shared modules
#
#  Purpose:
#    Single entry point to sync shared/ to ALL distribution directories.
#    Replaces: sync-all.bat, sync-auth-core.ps1, sync-license.ps1,
#              sync-offline-files.ps1
#
#  Usage:
#    cd D:\trae_projects\kyt-zy
#    .\tools\sync-all.ps1              # Sync all
#    .\tools\sync-all.ps1 -VerifyOnly  # Check only (exit 1 if out of sync)
#
#  Source: shared/ (unified master directory)
#  Targets: 13+ distribution directories (cloud + offline)
#  Cross-platform: Works on Windows (powershell) and Linux (pwsh, for CI)
# ============================================================================
#Requires -Version 5.0
[CmdletBinding()]
param(
    [switch]$VerifyOnly = $false
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$SharedDir = Join-Path $ProjectRoot 'shared'

# ============================================================================
# Configuration: file groups and their sync targets
# Note: Use forward slashes (/) in paths for cross-platform compatibility
#       (PowerShell on Windows and Linux both accept / as separator)
# ============================================================================

# Group 1: 10 business JS files (cloud + offline)
$BusinessJsFiles = @(
    'auth-core.js',
    'db-adapter.js',
    'debug-logger.js',
    'medicine-dict.js',
    'patient-archive.js',
    'performance-utils.js',
    'permission.js',
    'prescription-core.js',
    'print-utils.js',
    'security-guard.js'
)

# 10 directories for business JS (cloud + offline root + app assets)
$BusinessJsTargets = @(
    'public',
    'public/electron',
    'app_project/db-yunduan/cloud_desktop',
    'app_project/db-yunduan/cloud_desktop/electron',
    'app_project/db-geren/desktop',
    'app_project/db-dingzhi/desktop',
    'app_project/db-geren/app/app/src/main/assets/public',
    'app_project/db-dingzhi/app/app/src/main/assets/public'
)

# Group 2: permission.js extra targets (3 offline electron/, beyond Group 1)
$PermissionExtraTargets = @(
    'app_project/db-geren/desktop/electron',
    'app_project/db-dingzhi/desktop/electron'
)

# Group 3: calculate-hash.js targets (6 offline directories)
$CalculateHashTargets = @(
    'app_project/db-geren',
    'app_project/db-geren/app/app/src/main/assets/public',
    'app_project/db-dingzhi',
    'app_project/db-dingzhi/app/app/src/main/assets/public'
)

# Group 4: license files (3 files)
$LicenseFiles = @(
    'license/feature-guard.js',
    'license/license-manager.js',
    'license/prescription-counter.js'
)

# license targets (4 electron/ + 3 root/license/ + 3 nndroidicense/)
$LicenseTargets = @(
    'app_project/db-yunduan/cloud_desktop/electron',
    'app_project/db-geren/desktop/electron',
    'app_project/db-dingzhi/desktop/electron',
    'app_project/db-geren/desktop/license',
    'app_project/db-dingzhi/desktop/license',
    'app_project/db-geren/app/app/src/main/assets/public/license',
    'app_project/db-dingzhi/app/app/src/main/assets/public/license'
)

# Group 5: electron/hot-update.js targets (3 offline electron/)
$HotUpdateTargets = @(
    'app_project/db-geren/desktop/electron',
    'app_project/db-dingzhi/desktop/electron'
)

# Group 6: res/xml files (3 XML)
$ResXmlFiles = @(
    'res/xml/network_security_config.xml',
    'res/xml/data_extraction_rules.xml',
    'res/xml/file_paths.xml'
)

# res/xml targets (2 app/res/xml/)
$ResXmlTargets = @(
    'app_project/db-geren/app/app/src/main/res/xml',
    'app_project/db-dingzhi/app/app/src/main/res/xml'
)

# Group 7: vendor files
$VendorFiles = @(
    'vendor/xlsx.full.min.js'
)

# vendor targets (2 root/vendor/ + 2 app/vendor/)
$VendorTargets = @(
    'app_project/db-geren/desktop/vendor',
    'app_project/db-dingzhi/desktop/vendor',
    'app_project/db-geren/app/app/src/main/assets/public/vendor',
    'app_project/db-dingzhi/app/app/src/main/assets/public/vendor'
)

# Group 8: cloud-only modules (cloud-api.js, local-db.js, sync-engine.js)
# 仅同步到云端版目录，离线版不需要这些文件
$CloudModuleFiles = @(
    'cloud-api.js',
    'local-db.js',
    'sync-engine.js'
)

$CloudModuleTargets = @(
    'app_project/db-yunduan/cloud_desktop'
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
        Write-Host "  [WARN] Source not found: $Source" -ForegroundColor Yellow
        return $false
    }

    # Create target directory if needed
    $targetDir = Split-Path -Parent $Target
    if (-not (Test-Path $targetDir)) {
        if ($VerifyOnly) {
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
# Helper: Sync a group of files to a list of targets
# ============================================================================
function Sync-Group {
    param(
        [string]$GroupName,
        [string[]]$Files,
        [string[]]$Targets,
        [bool]$VerifyOnly
    )

    Write-Host "--- [$GroupName] ---" -ForegroundColor Cyan

    $allInSync = $true
    $totalChecked = 0
    $syncedCount = 0

    foreach ($file in $Files) {
        $srcPath = Join-Path $SharedDir $file
        $fileName = Split-Path $file -Leaf

        foreach ($target in $Targets) {
            $totalChecked++
            $targetDir = Join-Path $ProjectRoot $target
            $dstPath = Join-Path $targetDir $fileName
            $label = "$target/$fileName"

            $result = Sync-File -Source $srcPath -Target $dstPath -Label $label -VerifyOnly $VerifyOnly
            if ($result) { $syncedCount++ } else { $allInSync = $false }
        }
    }

    Write-Host "  Checked: $totalChecked, In sync: $syncedCount"
    return $allInSync
}

# ============================================================================
# Main
# ============================================================================
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Sync All Shared Modules" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Project root: $ProjectRoot"
Write-Host "Shared dir:   $SharedDir"
Write-Host "Mode: $(if ($VerifyOnly) { 'Verify only' } else { 'Sync' })"
Write-Host ""

if (-not (Test-Path $SharedDir)) {
    Write-Host "FAIL: Shared directory not found: $SharedDir" -ForegroundColor Red
    exit 1
}

$allInSync = $true

# Group 1: 10 business JS -> 10 directories
$result = Sync-Group -GroupName 'Business JS (10 files -> 10 dirs)' -Files $BusinessJsFiles -Targets $BusinessJsTargets -VerifyOnly $VerifyOnly
if (-not $result) { $allInSync = $false }
Write-Host ""

# Group 2: permission.js -> 3 offline electron/ (extra)
$result = Sync-Group -GroupName 'permission.js -> 3 offline electron/' -Files @('permission.js') -Targets $PermissionExtraTargets -VerifyOnly $VerifyOnly
if (-not $result) { $allInSync = $false }
Write-Host ""

# Group 3: calculate-hash.js -> 6 offline directories
$result = Sync-Group -GroupName 'calculate-hash.js -> 6 offline dirs' -Files @('calculate-hash.js') -Targets $CalculateHashTargets -VerifyOnly $VerifyOnly
if (-not $result) { $allInSync = $false }
Write-Host ""

# Group 4: license files -> 10 targets
$result = Sync-Group -GroupName 'License (3 files -> 10 dirs)' -Files $LicenseFiles -Targets $LicenseTargets -VerifyOnly $VerifyOnly
if (-not $result) { $allInSync = $false }
Write-Host ""

# Group 5: hot-update.js -> 3 offline electron/
$result = Sync-Group -GroupName 'hot-update.js -> 3 offline electron/' -Files @('electron/hot-update.js') -Targets $HotUpdateTargets -VerifyOnly $VerifyOnly
if (-not $result) { $allInSync = $false }
Write-Host ""

# Group 6: res/xml files -> 2 app/res/xml/
$result = Sync-Group -GroupName 'res/xml (3 files -> 2 app/res/xml/)' -Files $ResXmlFiles -Targets $ResXmlTargets -VerifyOnly $VerifyOnly
if (-not $result) { $allInSync = $false }
Write-Host ""

# Group 7: vendor files -> 4 targets
$result = Sync-Group -GroupName 'vendor (1 file -> 4 dirs)' -Files $VendorFiles -Targets $VendorTargets -VerifyOnly $VerifyOnly
if (-not $result) { $allInSync = $false }
Write-Host ""

# Group 8: cloud-only modules -> 1 target (cloud_desktop only)
$result = Sync-Group -GroupName 'cloud modules (3 files -> 1 cloud dir)' -Files $CloudModuleFiles -Targets $CloudModuleTargets -VerifyOnly $VerifyOnly
if (-not $result) { $allInSync = $false }
Write-Host ""

# ============================================================================
# Summary
# ============================================================================
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

if ($VerifyOnly) {
    if ($allInSync) {
        Write-Host "[OK] All files are in sync" -ForegroundColor Green
        exit 0
    } else {
        Write-Host "[FAIL] Some files out of sync" -ForegroundColor Red
        Write-Host "Run without -VerifyOnly to sync" -ForegroundColor Yellow
        exit 1
    }
} else {
    Write-Host "[OK] Sync completed" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  - Run sync-all.ps1 -VerifyOnly to verify"
    Write-Host "  - Run build-app.bat in each version to build"
    exit 0
}
