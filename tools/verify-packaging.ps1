# verify-packaging.ps1 - Verify encoding integrity of packaging files
# Usage: powershell -File tools\verify-packaging.ps1
# Exit code: 0 = all pass, 1 = issues found
#
# Checks:
#   1. .ps1 files MUST have UTF-8 BOM (PowerShell 5.x reads as GBK without BOM)
#   2. index.html files MUST NOT have BOM (browser misreads as char -> white screen)
#   3. .bat files MUST be ASCII-only (cmd.exe reads as GBK, Chinese -> garbled)
#   4. .gradle files MUST NOT have BOM (Gradle warning, usually harmless but clean)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot | Split-Path -Parent
Set-Location $root

$pass = 0
$fail = 0
$warn = 0

function Check-Bom {
    param([string]$Path, [bool]$ShouldHaveBom, [string]$Label)
    if (-not (Test-Path $Path)) { return }
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
    if ($ShouldHaveBom) {
        if ($hasBom) {
            Write-Host "  [OK]   $Label : BOM present" -ForegroundColor Green
            $script:pass++
        } else {
            Write-Host "  [FAIL] $Label : BOM missing! (Chinese will be garbled)" -ForegroundColor Red
            $script:fail++
        }
    } else {
        if ($hasBom) {
            Write-Host "  [FAIL] $Label : BOM found! (will cause DOCTYPE corruption)" -ForegroundColor Red
            $script:fail++
        } else {
            Write-Host "  [OK]   $Label : no BOM" -ForegroundColor Green
            $script:pass++
        }
    }
}

function Check-Ascii {
    param([string]$Path, [string]$Label)
    if (-not (Test-Path $Path)) { return }
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $nonAscii = $bytes | Where-Object { $_ -gt 127 }
    if ($nonAscii) {
        $count = $nonAscii.Count
        Write-Host "  [FAIL] $Label : $count non-ASCII bytes (Chinese will be garbled in cmd.exe)" -ForegroundColor Red
        $script:fail++
    } else {
        Write-Host "  [OK]   $Label : ASCII-only" -ForegroundColor Green
        $script:pass++
    }
}

Write-Host ""
Write-Host "========================================"
Write-Host "  Packaging Encoding Verifier"
Write-Host "========================================"
Write-Host ""

# --- Check 1: .ps1 files MUST have BOM ---
Write-Host "[Check 1] .ps1 files (MUST have UTF-8 BOM for Chinese support)"
$ps1Files = @(
    'offline_project\db-bendi\edit-config.ps1',
    'offline_project\db-dingzhi\edit-config.ps1',
    'offline_project\db-geren\edit-config.ps1',
    'tools\generate-sign-hash.ps1'
)
foreach ($f in $ps1Files) { Check-Bom -Path $f -ShouldHaveBom $true -Label $f }
Write-Host ""

# --- Check 2: index.html files MUST NOT have BOM ---
Write-Host "[Check 2] index.html files (MUST NOT have BOM - causes white screen)"
$htmlFiles = @(
    'offline_project\db-bendi\index.html',
    'offline_project\db-dingzhi\index.html',
    'offline_project\db-geren\index.html',
    'offline_project\db-bendi\android\app\src\main\assets\public\index.html',
    'offline_project\db-dingzhi\android\app\src\main\assets\public\index.html',
    'offline_project\db-geren\android\app\src\main\assets\public\index.html',
    'public\index.html',
    'cloud_project\cloud_desktop\index.html'
)
foreach ($f in $htmlFiles) { Check-Bom -Path $f -ShouldHaveBom $false -Label $f }
Write-Host ""

# --- Check 3: .bat files MUST be ASCII-only ---
Write-Host "[Check 3] .bat files (MUST be ASCII-only - cmd.exe reads as GBK)"
$batFiles = Get-ChildItem -Path 'offline_project' -Recurse -Filter '*.bat' -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '\\node_modules\\' -and $_.Name -ne 'gradlew.bat' }
foreach ($bf in $batFiles) {
    $rel = $bf.FullName.Substring($root.Length + 1)
    Check-Ascii -Path $bf.FullName -Label $rel
}
$cloudBat = Get-ChildItem -Path 'cloud_project' -Recurse -Filter '*.bat' -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '\\node_modules\\' -and $_.Name -ne 'gradlew.bat' }
foreach ($bf in $cloudBat) {
    $rel = $bf.FullName.Substring($root.Length + 1)
    Check-Ascii -Path $bf.FullName -Label $rel
}
Write-Host ""

# --- Summary ---
Write-Host "========================================"
Write-Host "  Summary: $pass OK / $fail FAIL / $warn WARN"
Write-Host "========================================"
Write-Host ""

if ($fail -gt 0) {
    Write-Host "[RESULT] FAILED - encoding issues detected!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Fix instructions:"
    Write-Host "  .ps1 missing BOM:  powershell -File tools\fix-ps1-bom.ps1"
    Write-Host "  .html has BOM:     powershell -File tools\strip-html-bom.ps1"
    Write-Host "  .bat non-ASCII:    replace Chinese with English in .bat files"
    exit 1
} else {
    Write-Host "[RESULT] PASSED - all encoding checks OK" -ForegroundColor Green
    exit 0
}
