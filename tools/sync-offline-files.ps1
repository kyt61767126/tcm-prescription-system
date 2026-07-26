# ============================================================================
#  sync-offline-files.ps1 - Sync ALL shared files to all distribution dirs
#
#  Purpose:
#    One-click sync of _shared/ files to all 3 offline versions (bendi/geren/dingzhi)
#    + cloud versions. Includes MD5 verification and -VerifyOnly mode.
#
#  Usage:
#    cd D:\trae_projects\kyt-zy
#    .\tools\sync-offline-files.ps1              # Sync all
#    .\tools\sync-offline-files.ps1 -VerifyOnly  # Check only (exit 1 if out of sync)
#    .\tools\sync-offline-files.ps1 -IncludeCloud # Also sync to cloud_project
# ============================================================================
#Requires -Version 5.0
[CmdletBinding()]
param(
    [switch]$VerifyOnly = $false,
    [switch]$IncludeCloud = $false,
    [switch]$Force = $false
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$SharedDir = Join-Path $ProjectRoot 'offline_project\_shared'

# All shared JS files (root level)
$SharedJsFiles = @(
    'auth-core.js',
    'db-adapter.js',
    'prescription-core.js',
    'patient-archive.js',
    'medicine-dict.js',
    'print-utils.js',
    'performance-utils.js',
    'debug-logger.js',
    'permission.js',
    'security-guard.js',
    'calculate-hash.js'
)

# License module files
$LicenseFiles = @(
    'license\feature-guard.js',
    'license\license-manager.js',
    'license\prescription-counter.js'
)

# Vendor files
$VendorFiles = @(
    'vendor\xlsx.full.min.js'
)

# res/xml files
$ResXmlFiles = @(
    'res\xml\network_security_config.xml',
    'res\xml\data_extraction_rules.xml',
    'res\xml\file_paths.xml'
)

# Offline versions
$OfflineVersions = @('db-bendi', 'db-geren', 'db-dingzhi')

# Cloud targets (only with -IncludeCloud)
$CloudTargets = @(
    @{ Name = 'cloud_desktop';      Dir = 'cloud_project\cloud_desktop' },
    @{ Name = 'cloud_desktop_electron'; Dir = 'cloud_project\cloud_desktop\electron' },
    @{ Name = 'public_root';        Dir = 'public' },
    @{ Name = 'public_electron';    Dir = 'public\electron' }
)

# ============================================================================
# Helper: Get MD5 hash of a file
# ============================================================================
function Get-FileHash-MD5 {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    try {
        $bytes = [System.IO.File]::ReadAllBytes($Path)
        $md5 = [System.Security.Cryptography.MD5]::Create()
        $hash = $md5.ComputeHash($bytes)
        return [System.BitConverter]::ToString($hash).Replace('-', '').ToLower()
    } catch { return $null }
}

# ============================================================================
# Helper: Sync a single file with MD5 comparison
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
            return $false  # Missing target dir = out of sync
        }
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }

    $sourceHash = Get-FileHash-MD5 $Source
    $targetHash = Get-FileHash-MD5 $Target

    if ($sourceHash -eq $targetHash) {
        # Already in sync
        return $true
    }

    if ($VerifyOnly) {
        Write-Host "  [DIFF] $Label" -ForegroundColor Yellow
        return $false
    }

    # Copy file (binary mode, preserve encoding)
    Copy-Item -Path $Source -Destination $Target -Force
    Write-Host "  [SYNC] $Label" -ForegroundColor Green
    return $true
}

# ============================================================================
# Main
# ============================================================================
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Sync Offline Shared Files" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Project root: $ProjectRoot"
Write-Host "Shared dir:   $SharedDir"
Write-Host "Mode: $(if ($VerifyOnly) { 'Verify only' } else { 'Sync' })"
Write-Host "Include cloud: $IncludeCloud"
Write-Host ""

if (-not (Test-Path $SharedDir)) {
    Write-Host "FAIL: Shared directory not found: $SharedDir" -ForegroundColor Red
    exit 1
}

$allInSync = $true
$totalFiles = 0
$syncedFiles = 0

# ============================================================================
# 1. Sync to offline versions (3 versions x multiple directories)
# ============================================================================
foreach ($ver in $OfflineVersions) {
    Write-Host "--- [$ver] ---" -ForegroundColor Cyan

    $verRoot = Join-Path $ProjectRoot "offline_project\$ver"
    $electronDir = Join-Path $verRoot 'electron'
    $androidAssets = Join-Path $verRoot 'android\app\src\main\assets\public'
    $resXmlDir = Join-Path $verRoot 'android\app\src\main\res\xml'

    # Sync root JS files (to verRoot)
    foreach ($js in $SharedJsFiles) {
        $totalFiles++
        $src = Join-Path $SharedDir $js
        $dst = Join-Path $verRoot $js
        $result = Sync-File -Source $src -Target $dst -Label "$ver/$js" -VerifyOnly $VerifyOnly
        if ($result) { $syncedFiles++ } else { $allInSync = $false }
    }

    # Sync to electron/ (only permission.js needed by login.html)
    $totalFiles++
    $src = Join-Path $SharedDir 'permission.js'
    $dst = Join-Path $electronDir 'permission.js'
    $result = Sync-File -Source $src -Target $dst -Label "$ver/electron/permission.js" -VerifyOnly $VerifyOnly
    if ($result) { $syncedFiles++ } else { $allInSync = $false }

    # Sync to android/assets/public/
    if (Test-Path $androidAssets) {
        foreach ($js in $SharedJsFiles) {
            $totalFiles++
            $src = Join-Path $SharedDir $js
            $dst = Join-Path $androidAssets $js
            $result = Sync-File -Source $src -Target $dst -Label "$ver/android/$js" -VerifyOnly $VerifyOnly
            if ($result) { $syncedFiles++ } else { $allInSync = $false }
        }

        # Sync vendor
        foreach ($v in $VendorFiles) {
            $totalFiles++
            $src = Join-Path $SharedDir $v
            $dst = Join-Path $androidAssets $v
            $result = Sync-File -Source $src -Target $dst -Label "$ver/android/$v" -VerifyOnly $VerifyOnly
            if ($result) { $syncedFiles++ } else { $allInSync = $false }
        }

        # Sync license files to android/assets/public/license/
        foreach ($lf in $LicenseFiles) {
            $totalFiles++
            $src = Join-Path $SharedDir $lf
            $dst = Join-Path $androidAssets $lf
            $result = Sync-File -Source $src -Target $dst -Label "$ver/android/$lf" -VerifyOnly $VerifyOnly
            if ($result) { $syncedFiles++ } else { $allInSync = $false }
        }
    }

    # Sync to android/res/xml/
    if (Test-Path $resXmlDir) {
        foreach ($xml in $ResXmlFiles) {
            $totalFiles++
            $src = Join-Path $SharedDir $xml
            $dst = Join-Path $resXmlDir $xml
            $result = Sync-File -Source $src -Target $dst -Label "$ver/res/xml/$(Split-Path $xml -Leaf)" -VerifyOnly $VerifyOnly
            if ($result) { $syncedFiles++ } else { $allInSync = $false }
        }
    }

    # Sync license files to verRoot/license/ (for desktop Electron)
    foreach ($lf in $LicenseFiles) {
        $totalFiles++
        $src = Join-Path $SharedDir $lf
        $dst = Join-Path $verRoot $lf
        $result = Sync-File -Source $src -Target $dst -Label "$ver/$lf" -VerifyOnly $VerifyOnly
        if ($result) { $syncedFiles++ } else { $allInSync = $false }
    }

    # Sync vendor to verRoot/vendor/
    foreach ($v in $VendorFiles) {
        $totalFiles++
        $src = Join-Path $SharedDir $v
        $dst = Join-Path $verRoot $v
        $result = Sync-File -Source $src -Target $dst -Label "$ver/$v" -VerifyOnly $VerifyOnly
        if ($result) { $syncedFiles++ } else { $allInSync = $false }
    }

    Write-Host ""
}

# ============================================================================
# 2. Sync to cloud versions (optional)
# ============================================================================
if ($IncludeCloud) {
    Write-Host "--- [Cloud] ---" -ForegroundColor Cyan

    foreach ($target in $CloudTargets) {
        $targetDir = Join-Path $ProjectRoot $target.Dir
        if (-not (Test-Path $targetDir)) {
            Write-Host "  [SKIP] $($target.Name) (dir not found)" -ForegroundColor Gray
            continue
        }

        # Sync all JS files
        foreach ($js in $SharedJsFiles) {
            $totalFiles++
            $src = Join-Path $SharedDir $js
            $dst = Join-Path $targetDir $js
            $result = Sync-File -Source $src -Target $dst -Label "$($target.Name)/$js" -VerifyOnly $VerifyOnly
            if ($result) { $syncedFiles++ } else { $allInSync = $false }
        }

        # Sync license files
        foreach ($lf in $LicenseFiles) {
            $totalFiles++
            $src = Join-Path $SharedDir $lf
            $dst = Join-Path $targetDir $lf
            $result = Sync-File -Source $src -Target $dst -Label "$($target.Name)/$lf" -VerifyOnly $VerifyOnly
            if ($result) { $syncedFiles++ } else { $allInSync = $false }
        }
    }
    Write-Host ""
}

# ============================================================================
# Summary
# ============================================================================
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Total files checked: $totalFiles"
Write-Host "Files in sync:       $syncedFiles"

if ($VerifyOnly) {
    if ($allInSync) {
        Write-Host ""
        Write-Host "[OK] All files are in sync" -ForegroundColor Green
        exit 0
    } else {
        $diffCount = $totalFiles - $syncedFiles
        Write-Host ""
        Write-Host "[FAIL] $diffCount file(s) out of sync" -ForegroundColor Red
        Write-Host "Run without -VerifyOnly to sync" -ForegroundColor Yellow
        exit 1
    }
} else {
    $diffCount = $totalFiles - $syncedFiles
    if ($diffCount -gt 0) {
        Write-Host "Files updated:       $diffCount"
    }
    Write-Host ""
    Write-Host "[OK] Sync completed" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  - Run pack.ps1 to build updated packages"
    Write-Host "  - Or run sync-offline-files.ps1 -VerifyOnly to verify"
    exit 0
}
