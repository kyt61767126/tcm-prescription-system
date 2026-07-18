<#
.SYNOPSIS
    Unified Packaging Module for TCM Prescription System
.DESCRIPTION
    Self-contained, robust packaging engine.
    Solves recurring issues: encoding corruption, error propagation, versionCode management.
    Future-proof: pattern-based file sync, isolated from project code changes.
.PARAMETER Version
    Target version: bendi | dingzhi | geren
.PARAMETER Target
    Build target: desktop | app | all | sync | config | encoding
.PARAMETER SkipConfig
    Skip clinic config modification
.PARAMETER SkipEncodingCheck
    Skip pre-packaging encoding verification
.PARAMETER Interactive
    Show interactive menu (for launcher use)
.EXAMPLE
    .\pack.ps1 -Version bendi -Target app
    .\pack.ps1 -Version bendi -Target app -SkipConfig
    .\pack.ps1 -Version bendi -Interactive
#>

param(
    [Parameter()]
    [ValidateSet('bendi','dingzhi','geren')]
    [string]$Version,
    [Parameter()]
    [ValidateSet('desktop','app','all','sync','config','encoding')]
    [string]$Target,
    [switch]$SkipConfig,
    [switch]$SkipEncodingCheck,
    [switch]$Interactive
)

# ============================================================================
# Section 1: Setup and Utility Functions
# ============================================================================

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

$script:ProjectRoot = $PSScriptRoot | Split-Path -Parent
$script:LogFile = $null
$script:VersionDir = $null
$script:AndroidDir = $null
$script:ElectronDir = $null
$script:OldVersionCode = $null

# UTF-8 encoders (reusable)
$script:UTF8WithBom = New-Object System.Text.UTF8Encoding($true)
$script:UTF8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$timestamp] [$Level] $Message"
    if ($script:LogFile) {
        [System.IO.File]::AppendAllText($script:LogFile, "$line`n", $script:UTF8NoBom)
    }
    $color = switch ($Level) {
        "ERROR" { "Red" }
        "WARN"  { "Yellow" }
        "OK"    { "Green" }
        default { "White" }
    }
    Write-Host $Message -ForegroundColor $color
}

function Write-Step {
    param([string]$Step, [string]$Message)
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  $Step" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Log $Message
}

function Stop-OnError {
    param([string]$Context)
    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne $null) {
        Write-Log "[FAIL] $Context (exit code: $LASTEXITCODE)" "ERROR"
        throw "$Context failed with exit code $LASTEXITCODE"
    }
}

# Run external command safely. Java/Gradle/npm write warnings to stderr which
# PowerShell 5.x with ErrorActionPreference=Stop treats as terminating errors.
# This helper temporarily switches to Continue so only $LASTEXITCODE matters.
function Invoke-External {
    param(
        [Parameter(Mandatory=$true)]
        [scriptblock]$Command,
        [string]$Context = "external command"
    )
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Command 2>&1 | ForEach-Object {
            if ($_ -is [System.Management.Automation.ErrorRecord]) {
                # stderr line - print as warning (yellow), don't throw
                Write-Host $_.Exception.Message -ForegroundColor Yellow
            } else {
                Write-Host $_
            }
        }
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prevEAP
    }
    if ($code -ne 0 -and $code -ne $null) {
        Write-Log "[FAIL] $Context (exit code: $code)" "ERROR"
        throw "$Context failed with exit code $code"
    }
    Write-Log "[OK] $Context (exit code: $code)"
}

# ============================================================================
# Section 2: Encoding Verification
# ============================================================================

function Test-FileBom {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    return ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
}

function Repair-FileBom {
    param([string]$Path, [bool]$ShouldHaveBom)
    $hasBom = Test-FileBom -Path $Path
    if ($hasBom -eq $null) { return $false }
    if ($ShouldHaveBom -and -not $hasBom) {
        $content = [System.IO.File]::ReadAllText($Path, $script:UTF8NoBom)
        [System.IO.File]::WriteAllText($Path, $content, $script:UTF8WithBom)
        return $true
    }
    if (-not $ShouldHaveBom -and $hasBom) {
        $bytes = [System.IO.File]::ReadAllBytes($Path)
        [System.IO.File]::WriteAllBytes($Path, $bytes[3..($bytes.Length - 1)])
        return $true
    }
    return $false
}

function Invoke-EncodingCheck {
    Write-Step "Encoding Check" "Verifying file encoding integrity..."

    $fixed = 0

    # Check .ps1 files: MUST have BOM
    $ps1Files = @(
        "$script:VersionDir\edit-config.ps1"
    ) | Where-Object { Test-Path $_ }

    foreach ($f in $ps1Files) {
        if (Test-FileBom -Path $f) {
            Write-Host "  [OK]   $($f | Split-Path -Leaf) : BOM present" -ForegroundColor Green
        } else {
            Write-Host "  [FIX]   $($f | Split-Path -Leaf) : BOM missing, repairing..." -ForegroundColor Yellow
            Repair-FileBom -Path $f -ShouldHaveBom $true | Out-Null
            $fixed++
        }
    }

    # Check index.html: MUST NOT have BOM
    $htmlFiles = @(
        "$script:VersionDir\index.html",
        "$script:AndroidDir\app\src\main\assets\public\index.html"
    ) | Where-Object { Test-Path $_ }

    foreach ($f in $htmlFiles) {
        $hasBom = Test-FileBom -Path $f
        if ($hasBom) {
            Write-Host "  [FIX]   $($f | Split-Path -Leaf) : BOM found, stripping..." -ForegroundColor Yellow
            Repair-FileBom -Path $f -ShouldHaveBom $false | Out-Null
            $fixed++
        } else {
            Write-Host "  [OK]   $($f | Split-Path -Leaf) : no BOM" -ForegroundColor Green
        }
    }

    if ($fixed -gt 0) {
        Write-Log "[OK] Encoding check: $fixed file(s) auto-repaired" "OK"
    } else {
        Write-Log "[OK] Encoding check: all files OK" "OK"
    }
}

# ============================================================================
# Section 3: Config Modification
# ============================================================================

function Edit-ClinicConfig {
    Write-Step "Config Modification" "Modifying clinic configuration..."

    $configPath = "$script:VersionDir\config.json"
    $htmlPath = "$script:VersionDir\index.html"

    if (-not (Test-Path $configPath)) {
        Write-Log "[WARN] config.json not found, skipping config" "WARN"
        return
    }

    # Read config
    $config = [System.IO.File]::ReadAllText($configPath, $script:UTF8NoBom) | ConvertFrom-Json
    $currentClinic = $config.clinicName

    Write-Host "  Current clinic name: $currentClinic"
    Write-Host "  (Press Enter to keep current value)"
    $newClinic = Read-Host "  Enter clinic name"

    if ([string]::IsNullOrWhiteSpace($newClinic)) {
        $newClinic = $currentClinic
        Write-Host "  [SKIP] Using current name: $newClinic" -ForegroundColor Yellow
    } else {
        # Update config.json (with BOM for JSON compatibility)
        $config.clinicName = $newClinic
        $json = $config | ConvertTo-Json -Depth 10
        [System.IO.File]::WriteAllText($configPath, $json, $script:UTF8WithBom)

        # Update index.html (NO BOM - critical!)
        # Use single-quoted strings and concatenation to avoid quote-in-string issues
        $html = [System.IO.File]::ReadAllText($htmlPath, $script:UTF8NoBom)

        # Pattern: clinicName: 'xxx' -> clinicName: 'newClinic'
        $pattern1 = "clinicName:\s*'[^']*'"
        $replacement1 = "clinicName: '$newClinic'"
        $html = $html -replace $pattern1, $replacement1

        # Pattern: clinic-info-name">xxx< -> clinic-info-name">newClinic<
        # Use single-quoted string + concatenation to avoid " inside " issue
        $pattern2 = 'clinic-info-name">[^<]*<'
        $replacement2 = 'clinic-info-name">' + $newClinic + '<'
        $html = $html -replace $pattern2, $replacement2

        # Pattern: clinicNameDisplay">xxx< -> clinicNameDisplay">newClinic<
        $pattern3 = 'clinicNameDisplay">[^<]*<'
        $replacement3 = 'clinicNameDisplay">' + $newClinic + '<'
        $html = $html -replace $pattern3, $replacement3

        [System.IO.File]::WriteAllText($htmlPath, $html, $script:UTF8NoBom)

        Write-Host "  [OK] Config updated: $newClinic" -ForegroundColor Green
    }
    Write-Log "Config: clinic name = $newClinic"
}

# ============================================================================
# Section 4: File Sync (Pattern-based, future-proof)
# ============================================================================

function Copy-FileWithLog {
    param([string]$Src, [string]$Dst)
    if (Test-Path $Src) {
        Copy-Item -Path $Src -Destination $Dst -Force
        Write-Host "  [OK]   $(Split-Path $Src -Leaf) synced" -ForegroundColor Green
    } else {
        Write-Host "  [SKIP] $(Split-Path $Src -Leaf) not found" -ForegroundColor Yellow
    }
}

function Sync-FilesToApp {
    Write-Step "File Sync" "Syncing web files to Android assets..."

    $publicDir = "$script:AndroidDir\app\src\main\assets\public"
    $assetsDir = "$script:AndroidDir\app\src\main\assets"

    # Ensure target directory exists
    if (-not (Test-Path $publicDir)) {
        New-Item -ItemType Directory -Path $publicDir -Force | Out-Null
    }

    # Sync config.json
    Copy-FileWithLog "$script:VersionDir\config.json" "$publicDir\config.json"

    # Sync index.html (CRITICAL: no BOM)
    Copy-FileWithLog "$script:VersionDir\index.html" "$publicDir\index.html"
    # Strip BOM if present (belt-and-suspenders)
    Repair-FileBom -Path "$publicDir\index.html" -ShouldHaveBom $false | Out-Null

    # Sync all .js modules in version root (pattern-based, auto-discovers new files)
    # Exclude: main.js (electron entry point, not for Android)
    $excludeJs = @('main.js')
    Get-ChildItem -Path $script:VersionDir -Filter "*.js" -File | Where-Object { $_.Name -notin $excludeJs } | ForEach-Object {
        Copy-FileWithLog $_.FullName "$publicDir\$($_.Name)"
    }

    # Sync vendor/ directory
    $vendorSrc = "$script:VersionDir\vendor"
    if (Test-Path $vendorSrc) {
        $vendorDst = "$publicDir\vendor"
        if (-not (Test-Path $vendorDst)) {
            New-Item -ItemType Directory -Path $vendorDst -Force | Out-Null
        }
        Get-ChildItem -Path $vendorSrc -Filter "*.js" -File | ForEach-Object {
            Copy-FileWithLog $_.FullName "$vendorDst\$($_.Name)"
        }
    }

    # Sync video-recorder-inject.js to assets/ (not public/)
    $injectSrc = "$script:VersionDir\video-recorder-inject.js"
    if (Test-Path $injectSrc) {
        Copy-FileWithLog $injectSrc "$assetsDir\video-recorder-inject.js"
    } else {
        Write-Host "  [SKIP] video-recorder-inject.js not found" -ForegroundColor Yellow
    }

    Write-Log "[OK] File sync completed"
}

# ============================================================================
# Section 5: VersionCode Management (with rollback)
# ============================================================================

function Get-VersionCode {
    $gradlePath = "$script:AndroidDir\app\build.gradle"
    $content = [System.IO.File]::ReadAllText($gradlePath, $script:UTF8NoBom)
    $pattern = 'versionCode\s+(\d+)'
    if ($content -match $pattern) {
        return [int]$matches[1]
    }
    return $null
}

function Set-VersionCode {
    param([int]$Code)
    $gradlePath = "$script:AndroidDir\app\build.gradle"
    $content = [System.IO.File]::ReadAllText($gradlePath, $script:UTF8NoBom)
    $pattern = 'versionCode\s+\d+'
    $replacement = "versionCode $Code"
    $content = $content -replace $pattern, $replacement
    [System.IO.File]::WriteAllText($gradlePath, $content, $script:UTF8NoBom)
}

function Increment-VersionCode {
    Write-Step "VersionCode" "Incrementing versionCode..."

    $script:OldVersionCode = Get-VersionCode
    if ($script:OldVersionCode -eq $null) {
        Write-Log "[WARN] versionCode not found in build.gradle, skipping" "WARN"
        return
    }

    $newCode = $script:OldVersionCode + 1
    Set-VersionCode -Code $newCode
    Write-Host "  [OK] versionCode: $($script:OldVersionCode) -> $newCode" -ForegroundColor Green
    Write-Log "versionCode: $($script:OldVersionCode) -> $newCode"
}

function Restore-VersionCode {
    if ($script:OldVersionCode -ne $null) {
        Write-Log "[ROLLBACK] Restoring versionCode to $($script:OldVersionCode)" "WARN"
        Set-VersionCode -Code $script:OldVersionCode
        Write-Host "  [ROLLBACK] versionCode restored to $($script:OldVersionCode)" -ForegroundColor Yellow
    }
}

# ============================================================================
# Section 6: Desktop Build (Electron)
# ============================================================================

function Build-Desktop {
    Write-Step "Desktop Build" "Building Electron desktop application..."

    # Kill old process
    $processNames = @("app-local", "app-custom", "app-personal", "HuikangTCM-Local", "HuikangTCM-Custom", "HuikangTCM-Personal")
    foreach ($proc in $processNames) {
        $running = Get-Process -Name $proc -ErrorAction SilentlyContinue
        if ($running) {
            Write-Host "  Stopping process: $proc" -ForegroundColor Yellow
            $running | Stop-Process -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 1
        }
    }

    # Check node_modules
    if (-not (Test-Path "$script:VersionDir\node_modules")) {
        Write-Host "  Installing npm dependencies..." -ForegroundColor Yellow
        Push-Location $script:VersionDir
        try {
            Invoke-External { npm install } "npm install"
        } finally {
            Pop-Location
        }
    }

    # Obfuscate JS
    Write-Host "  Obfuscating JavaScript..." -ForegroundColor Yellow
    Push-Location $script:ProjectRoot
    try {
        Invoke-External { node "tools\obfuscate.js" --target=$Version } "JS obfuscation"
    } finally {
        Pop-Location
    }

    # Build with electron-builder
    Write-Host "  Running electron-builder..." -ForegroundColor Yellow
    Push-Location $script:VersionDir
    try {
        $env:ELECTRON_MIRROR = "https://registry.npmmirror.com/-/binary/electron/"
        $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://registry.npmmirror.com/-/binary/electron-builder-binaries/"
        Invoke-External { npm run build } "electron-builder"
    } finally {
        Pop-Location
    }

    # Restore JS (de-obfuscate)
    Write-Host "  Restoring JavaScript..." -ForegroundColor Yellow
    Push-Location $script:ProjectRoot
    try {
        Invoke-External { node "tools\obfuscate.js" restore --target=$Version } "JS restore"
    } finally {
        Pop-Location
    }

    Write-Log "[OK] Desktop build completed"
}

# ============================================================================
# Section 7: APP Build (Android Gradle)
# ============================================================================

function Build-App {
    Write-Step "APP Build" "Building Android APK..."

    # Kill residual Gradle processes
    Write-Host "  Stopping residual Gradle processes..." -ForegroundColor Yellow
    Get-Process -Name "java","gradle" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1

    # Clean build cache
    Write-Host "  Cleaning build cache..." -ForegroundColor Yellow
    Push-Location $script:AndroidDir
    try {
        Invoke-External { & ".\gradlew.bat" clean --no-daemon } "gradlew clean"
    } finally {
        Pop-Location
    }

    # Increment versionCode
    Increment-VersionCode

    # Build APK
    Write-Host "  Building signed APK..." -ForegroundColor Yellow
    Push-Location $script:AndroidDir
    try {
        Invoke-External { & ".\gradlew.bat" assembleRelease --no-daemon } "gradlew assembleRelease"
    } catch {
        Restore-VersionCode
        throw
    } finally {
        Pop-Location
    }

    # Copy APK to version directory
    $apkPath = Get-ChildItem -Path "$script:AndroidDir\app\build\outputs\apk\release" -Filter "*.apk" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($apkPath) {
        $destPath = "$script:VersionDir\$($apkPath.Name)"
        Copy-Item -Path $apkPath.FullName -Destination $destPath -Force
        $sizeMB = [math]::Round($apkPath.Length / 1MB, 2)
        Write-Host ""
        Write-Host "  ====================================" -ForegroundColor Green
        Write-Host "  APK Generated Successfully!" -ForegroundColor Green
        Write-Host "  ====================================" -ForegroundColor Green
        Write-Host "  File:  $($apkPath.Name)"
        Write-Host "  Size:  $sizeMB MB"
        Write-Host "  Path:  $destPath"
        Write-Host "  ====================================" -ForegroundColor Green
        Write-Log "[OK] APK: $($apkPath.Name) ($sizeMB MB)"
    } else {
        Restore-VersionCode
        throw "APK not found in output directory"
    }
}

# ============================================================================
# Section 8: Main Logic
# ============================================================================

function Show-Menu {
    param([string]$Ver)
    Clear-Host
    $versionLabel = switch ($Ver) {
        'bendi'   { 'Local Edition (bendi)' }
        'dingzhi' { 'Custom Edition (dingzhi)' }
        'geren'   { 'Personal Edition (geren)' }
    }
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Packaging Module - $versionLabel" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  [1] Build Desktop App (Electron exe)"
    Write-Host "  [2] Build Mobile App (Android APK)"
    Write-Host "  [3] Build Both (Desktop + Mobile)"
    Write-Host "  [4] Sync files to Android only"
    Write-Host "  [5] Modify clinic config only"
    Write-Host "  [6] Encoding check only"
    Write-Host "  [0] Exit"
    Write-Host ""
    $choice = Read-Host "  Select option"
    return $choice
}

function Invoke-Packaging {
    param(
        [string]$Ver,
        [string]$Tgt,
        [bool]$SkipCfg,
        [bool]$SkipEnc
    )

    # Setup paths
    $script:VersionDir = "$script:ProjectRoot\offline_project\db-$Ver"
    $script:AndroidDir = "$script:VersionDir\android"
    $script:ElectronDir = "$script:VersionDir\electron"

    # Validate paths
    if (-not (Test-Path $script:VersionDir)) {
        throw "Version directory not found: $($script:VersionDir)"
    }

    # Setup log
    $logDir = "$script:VersionDir\logs"
    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
    $script:LogFile = "$logDir\packaging-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"

    $startTime = Get-Date
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Magenta
    Write-Host "  TCM Prescription Packaging Module" -ForegroundColor Magenta
    Write-Host "  Version: $Ver | Target: $Tgt" -ForegroundColor Magenta
    Write-Host "  Started: $($startTime.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor Magenta
    Write-Host "  Log:     $($script:LogFile)" -ForegroundColor Magenta
    Write-Host "========================================" -ForegroundColor Magenta

    try {
        # Step 1: Pre-packaging encoding check (skip if target is 'encoding' to avoid duplicate with Step 6)
        if (-not $SkipEnc -and $Tgt -ne 'encoding') {
            Invoke-EncodingCheck
        }

        # Step 2: Config modification
        if (-not $SkipCfg -and ($Tgt -eq 'app' -or $Tgt -eq 'all' -or $Tgt -eq 'config')) {
            Edit-ClinicConfig
        }

        # Step 3: File sync (for app target)
        if ($Tgt -eq 'app' -or $Tgt -eq 'all' -or $Tgt -eq 'sync') {
            Sync-FilesToApp
        }

        # Step 4: Desktop build
        if ($Tgt -eq 'desktop' -or $Tgt -eq 'all') {
            Build-Desktop
        }

        # Step 5: APP build
        if ($Tgt -eq 'app' -or $Tgt -eq 'all') {
            Build-App
        }

        # Step 6: Encoding check only
        if ($Tgt -eq 'encoding') {
            Invoke-EncodingCheck
        }

        $elapsed = (Get-Date) - $startTime
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "  Packaging Completed!" -ForegroundColor Green
        Write-Host "  Elapsed: $($elapsed.ToString('mm\:ss'))" -ForegroundColor Green
        Write-Host "  Log:     $($script:LogFile)" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Green
        Write-Log "[OK] Packaging completed in $($elapsed.ToString('mm\:ss'))"

    } catch {
        $elapsed = (Get-Date) - $startTime
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Red
        Write-Host "  Packaging FAILED!" -ForegroundColor Red
        Write-Host "  Error: $_" -ForegroundColor Red
        Write-Host "  Elapsed: $($elapsed.ToString('mm\:ss'))" -ForegroundColor Red
        Write-Host "  Log:     $($script:LogFile)" -ForegroundColor Red
        Write-Host "========================================" -ForegroundColor Red
        Write-Log "[ERROR] Packaging failed: $_" "ERROR"
        return 1
    }
    return 0
}

# ============================================================================
# Entry Point
# ============================================================================

if ($Interactive) {
    if (-not $Version) {
        Write-Host "Usage: pack.ps1 -Version <bendi|dingzhi|geren> -Interactive"
        exit 1
    }

    while ($true) {
        $choice = Show-Menu -Ver $Version
        switch ($choice) {
            '1' { Invoke-Packaging -Ver $Version -Tgt 'desktop' -SkipCfg $false -SkipEnc $false }
            '2' { Invoke-Packaging -Ver $Version -Tgt 'app' -SkipCfg $false -SkipEnc $false }
            '3' { Invoke-Packaging -Ver $Version -Tgt 'all' -SkipCfg $false -SkipEnc $false }
            '4' { Invoke-Packaging -Ver $Version -Tgt 'sync' -SkipCfg $true -SkipEnc $true }
            '5' { Invoke-Packaging -Ver $Version -Tgt 'config' -SkipCfg $false -SkipEnc $true }
            '6' { Invoke-Packaging -Ver $Version -Tgt 'encoding' -SkipCfg $true -SkipEnc $false }
            '0' { exit 0 }
            default { Write-Host "Invalid option, try again" -ForegroundColor Red }
        }
        if ($choice -ne '0') {
            Write-Host ""
            Read-Host "Press Enter to continue"
        }
    }
} else {
    # Direct execution mode
    if (-not $Version -or -not $Target) {
        Write-Host "Usage: pack.ps1 -Version <bendi|dingzhi|geren> -Target <desktop|app|all>"
        Write-Host "       pack.ps1 -Version bendi -Interactive"
        exit 1
    }
    $exitCode = Invoke-Packaging -Ver $Version -Tgt $Target -SkipCfg $SkipConfig -SkipEnc $SkipEncodingCheck
    exit $exitCode
}
