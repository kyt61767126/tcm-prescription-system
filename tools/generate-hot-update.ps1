# ============================================================================
#  generate-hot-update.ps1 - Generate hot-update packages for offline apps
#
#  Purpose:
#    Generate version.json + package.zip for each offline version (geren/dingzhi)
#    Output to cloud_project/public/hot-update/<version>/
#    Push to GitHub → Cloudflare Pages auto-deploys → apps check for updates
#
#  Usage:
#    cd D:\trae_projects\kyt-zy
#    .\tools\generate-hot-update.ps1                    # Generate for all 3 versions
#    .\tools\generate-hot-update.ps1 -Version dingzhi   # Generate for dingzhi only
#    .\tools\generate-hot-update.ps1 -VersionNumber "2026-07-26-v1"
# ============================================================================
#Requires -Version 5.0
[CmdletBinding()]
param(
    [string]$Version = "",  # geren | dingzhi | "" (all)
    [string]$VersionNumber = ""  # Custom version number, auto-generated if empty
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$CloudHost = "tcm-prescription-system.pages.dev"

# All offline versions
$AllVersions = @('geren', 'dingzhi')

# Files to include in hot-update package (relative to assets/public/)
$UpdateFiles = @(
    'index.html',
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
    'calculate-hash.js',
    'license\feature-guard.js',
    'license\license-manager.js',
    'license\prescription-counter.js',
    'vendor\xlsx.full.min.js'
)

# ============================================================================
# Helper: Get MD5 hash of a file
# ============================================================================
function Get-FileHash-MD5 {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $md5 = [System.Security.Cryptography.MD5]::Create()
    $hash = $md5.ComputeHash($bytes)
    return [System.BitConverter]::ToString($hash).Replace('-', '').ToLower()
}

# ============================================================================
# Helper: Create ZIP from directory
# ============================================================================
function New-ZipFromDir {
    param([string]$SourceDir, [string]$ZipPath)
    if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory($SourceDir, $ZipPath)
}

# ============================================================================
# Generate hot-update for a single version
# ============================================================================
function Generate-VersionUpdate {
    param([string]$VerName, [string]$VerNumber)

    Write-Host "--- [$VerName] Generating hot-update ---" -ForegroundColor Cyan

    $sourceDir = Join-Path $ProjectRoot "offline_project\db-$VerName\android\app\src\main\assets\public"
    if (-not (Test-Path $sourceDir)) {
        Write-Host "  [SKIP] Source not found: $sourceDir" -ForegroundColor Yellow
        return $false
    }

    # Output directory
    $outputDir = Join-Path $ProjectRoot "cloud_project\public\hot-update\$VerName"
    if (Test-Path $outputDir) {
        Remove-Item $outputDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

    # Temp directory for staging files
    $tempDir = Join-Path $env:TEMP "hot-update-$VerName-$([System.Guid]::NewGuid().ToString('N').Substring(0,8))"
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    try {
        # Copy files to temp dir
        $fileList = @()
        foreach ($file in $UpdateFiles) {
            $srcFile = Join-Path $sourceDir $file
            if (Test-Path $srcFile) {
                $dstFile = Join-Path $tempDir $file
                $dstFileDir = Split-Path -Parent $dstFile
                if (-not (Test-Path $dstFileDir)) {
                    New-Item -ItemType Directory -Path $dstFileDir -Force | Out-Null
                }
                Copy-Item -Path $srcFile -Destination $dstFile -Force
                $md5 = Get-FileHash-MD5 $srcFile
                $fileList += [PSCustomObject]@{
                    name = $file -replace '\\', '/'
                    md5 = $md5
                }
                Write-Host "  [ADD] $file ($md5)" -ForegroundColor Gray
            }
        }

        # Create ZIP
        $zipPath = Join-Path $outputDir 'package.zip'
        New-ZipFromDir -SourceDir $tempDir -ZipPath $zipPath
        $zipSize = (Get-Item $zipPath).Length
        Write-Host "  [ZIP] package.zip ($([math]::Round($zipSize/1024, 1)) KB)" -ForegroundColor Green

        # Create version.json
        $versionJson = @{
            version = $VerNumber
            versionName = $VerName
            createdAt = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssZ")
            downloadUrl = "https://$CloudHost/hot-update/$VerName/package.zip"
            files = $fileList
        }

        $jsonPath = Join-Path $outputDir 'version.json'
        $jsonContent = $versionJson | ConvertTo-Json -Depth 5
        [System.IO.File]::WriteAllText($jsonPath, $jsonContent, (New-Object System.Text.UTF8Encoding $false))
        Write-Host "  [JSON] version.json (version=$VerNumber)" -ForegroundColor Green

        # Also create a latest.json (alias for version.json, for quick check)
        $latestPath = Join-Path $outputDir 'latest.json'
        $latestContent = @{
            version = $VerNumber
            url = "https://$CloudHost/hot-update/$VerName/package.zip"
        } | ConvertTo-Json -Compress
        [System.IO.File]::WriteAllText($latestPath, $latestContent, (New-Object System.Text.UTF8Encoding $false))

        Write-Host "  [OK] $VerName hot-update generated" -ForegroundColor Green
        return $true
    } finally {
        # Cleanup temp dir
        if (Test-Path $tempDir) {
            Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

# ============================================================================
# Main
# ============================================================================
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Generate Hot-Update Packages" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Project root: $ProjectRoot"
Write-Host "Cloud host:   $CloudHost"

# Auto-generate version number if not specified
if ([string]::IsNullOrEmpty($VersionNumber)) {
    $VersionNumber = "$(Get-Date -Format 'yyyy-MM-dd')-v1"
}
Write-Host "Version:      $VersionNumber"
Write-Host ""

# Determine which versions to process
if ([string]::IsNullOrEmpty($Version)) {
    $versions = $AllVersions
} else {
    $versions = @($Version)
}

# Generate for each version
$successCount = 0
foreach ($ver in $versions) {
    if (Generate-VersionUpdate -VerName $ver -VerNumber $VersionNumber) {
        $successCount++
    }
    Write-Host ""
}

# Summary
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Versions processed: $($versions.Count)"
Write-Host "Successfully generated: $successCount"
Write-Host ""

if ($successCount -gt 0) {
    Write-Host "[OK] Hot-update packages generated" -ForegroundColor Green
    Write-Host ""
    Write-Host "Output: cloud_project/public/hot-update/" -ForegroundColor Cyan
    Write-Host "  ├── geren/version.json + package.zip" -ForegroundColor Gray
    Write-Host "  └── dingzhi/version.json + package.zip" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. git add cloud_project/public/hot-update/"
    Write-Host "  2. git commit -m 'hot-update: $VersionNumber'"
    Write-Host "  3. git push (Cloudflare Pages auto-deploys)"
    Write-Host "  4. Apps will auto-check for updates on next launch"
    exit 0
} else {
    Write-Host "[FAIL] No hot-update packages generated" -ForegroundColor Red
    exit 1
}
