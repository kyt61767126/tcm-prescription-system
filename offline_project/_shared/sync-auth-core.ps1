# ============================================================================
#  sync-auth-core.ps1 - Sync auth-core.js to all distribution directories
#
#  Purpose:
#    After modifying _shared/auth-core.js, run this script to sync to all
#    distribution directories (13 targets). Avoids the limitation that
#    GitHub Action sync-shared-modules.yml only syncs shared/*.js.
#
#  Usage:
#    cd D:\trae_projects\kyt-zy\offline_project\_shared
#    .\sync-auth-core.ps1                # Sync to all targets
#    .\sync-auth-core.ps1 -VerifyOnly    # Verify only (for CI/CD)
# ============================================================================

param(
    [switch]$VerifyOnly = $false
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)

# Master source file
$SourceFile = Join-Path $ScriptDir 'auth-core.js'

# All distribution targets (13)
$Targets = @(
    # GitHub Action sync-shared-modules.yml source
    @{ Name = 'shared_root';              Dir = 'shared' },
    # Cloud web (Cloudflare Pages deployment root)
    @{ Name = 'public_root';              Dir = 'public' },
    @{ Name = 'public_electron';          Dir = 'public\electron' },
    # Cloud desktop (Electron)
    @{ Name = 'cloud_desktop_root';       Dir = 'cloud_project\cloud_desktop' },
    @{ Name = 'cloud_desktop_electron';   Dir = 'cloud_project\cloud_desktop\electron' },
    # Offline desktop x 3 (Electron)
    @{ Name = 'db-bendi_root';           Dir = 'offline_project\db-bendi' },
    @{ Name = 'db-bendi_electron';        Dir = 'offline_project\db-bendi\electron' },
    @{ Name = 'db-geren_root';           Dir = 'offline_project\db-geren' },
    @{ Name = 'db-geren_electron';        Dir = 'offline_project\db-geren\electron' },
    @{ Name = 'db-dingzhi_root';         Dir = 'offline_project\db-dingzhi' },
    @{ Name = 'db-dingzhi_electron';      Dir = 'offline_project\db-dingzhi\electron' },
    # Offline APP x 3 (Capacitor WebView assets/public)
    @{ Name = 'db-bendi_app';            Dir = 'offline_project\db-bendi\android\app\src\main\assets\public' },
    @{ Name = 'db-geren_app';            Dir = 'offline_project\db-geren\android\app\src\main\assets\public' },
    @{ Name = 'db-dingzhi_app';          Dir = 'offline_project\db-dingzhi\android\app\src\main\assets\public' }
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Sync auth-core.js to all distribution dirs" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Project root: $ProjectRoot"
Write-Host "Master file:  $SourceFile"
Write-Host "Mode: $(if ($VerifyOnly) { 'Verify only' } else { 'Sync' })"
Write-Host ""

if (-not (Test-Path $SourceFile)) {
    Write-Host "FAIL: Master file not found: $SourceFile" -ForegroundColor Red
    exit 1
}

$srcHash = (Get-FileHash $SourceFile -Algorithm SHA256).Hash
$mismatchCount = 0
$syncCount = 0

foreach ($target in $Targets) {
    $targetDir = Join-Path $ProjectRoot $target.Dir
    $dstPath = Join-Path $targetDir 'auth-core.js'

    if (-not (Test-Path $targetDir)) {
        Write-Host "  FAIL [$($target.Name)] target dir not found: $($target.Dir)" -ForegroundColor Red
        $mismatchCount++
        continue
    }

    if (Test-Path $dstPath) {
        $dstHash = (Get-FileHash $dstPath -Algorithm SHA256).Hash
    } else {
        $dstHash = $null
    }

    if ($srcHash -eq $dstHash) {
        Write-Host "  OK   [$($target.Name)] in sync" -ForegroundColor Green
    } else {
        if ($VerifyOnly) {
            Write-Host "  FAIL [$($target.Name)] mismatch (needs sync)" -ForegroundColor Red
            $mismatchCount++
        } else {
            try {
                Copy-Item -Path $SourceFile -Destination $dstPath -Force
                $newHash = (Get-FileHash $dstPath -Algorithm SHA256).Hash
                if ($newHash -eq $srcHash) {
                    Write-Host "  OK   [$($target.Name)] synced (overwritten)" -ForegroundColor Green
                    $syncCount++
                } else {
                    Write-Host "  FAIL [$($target.Name)] still mismatch after sync" -ForegroundColor Red
                    $mismatchCount++
                }
            } catch {
                Write-Host "  FAIL [$($target.Name)] sync error: $($_.Exception.Message)" -ForegroundColor Red
                $mismatchCount++
            }
        }
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
if ($VerifyOnly) {
    if ($mismatchCount -eq 0) {
        Write-Host " PASS: All targets in sync" -ForegroundColor Green
        exit 0
    } else {
        Write-Host " FAIL: $mismatchCount targets mismatched. Run sync-auth-core.ps1 to sync." -ForegroundColor Red
        exit 1
    }
} else {
    if ($mismatchCount -eq 0) {
        if ($syncCount -eq 0) {
            Write-Host " PASS: All targets up-to-date (no sync needed)" -ForegroundColor Green
        } else {
            Write-Host " PASS: Synced $syncCount files to targets" -ForegroundColor Green
        }
        exit 0
    } else {
        Write-Host " WARN: Partial failure: $mismatchCount targets" -ForegroundColor Yellow
        exit 1
    }
}
Write-Host "========================================" -ForegroundColor Cyan
