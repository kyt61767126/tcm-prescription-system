@echo off
chcp 65001 >nul
setlocal

REM ============================================================
REM  Sync Script - cloud_desktop -> public (Cloudflare Pages source)
REM
REM  Usage:
REM    1) Run this script after modifying cloud_desktop/index.html
REM    2) Then run sync-and-push.bat to commit and push
REM    3) Cloudflare Pages auto-deploys after push (1-2 min)
REM ============================================================

set "SRC=%~dp0"
set "DST=%~dp0..\..\public"

echo.
echo ================================================================
echo  Sync - cloud_desktop -^> public (Cloudflare Pages source)
echo ================================================================
echo  Source: %SRC%
echo  Target: %DST%
echo.

if not exist "%DST%" (
    echo [ERROR] Target directory not found: %DST%
    echo Please run from the correct project structure
    pause
    exit /b 1
)

echo [1/3] Syncing index.html ...
copy /Y "%SRC%index.html" "%DST%index.html" >nul
if errorlevel 1 (
    echo [ERROR] index.html sync failed
    pause
    exit /b 1
)
echo       index.html synced

echo [2/3] Syncing xlsx.full.min.js ...
if exist "%SRC%xlsx.full.min.js" (
    copy /Y "%SRC%xlsx.full.min.js" "%DST%xlsx.full.min.js" >nul
    if errorlevel 1 (
        echo [WARN] xlsx.full.min.js sync failed, continue
    ) else (
        echo       xlsx.full.min.js synced
    )
) else (
    echo [SKIP] xlsx.full.min.js not found
)

echo [3/3] Verifying MD5 ...
powershell -NoProfile -Command "$src='%SRC%'; $dst='%DST%'; $f1='index.html'; $f2='xlsx.full.min.js'; foreach ($f in @($f1,$f2)) { if ((Test-Path \"$src$f\") -and (Test-Path \"$dst$f\")) { $h1=(Get-FileHash \"$src$f\" -Algorithm MD5).Hash; $h2=(Get-FileHash \"$dst$f\" -Algorithm MD5).Hash; if ($h1 -eq $h2) { Write-Host \"  [OK]   $f  $h1\" } else { Write-Host \"  [FAIL] $f  src=$h1 dst=$h2\" } } }"

echo.
echo ================================================================
echo  Sync completed
echo ================================================================
echo.
echo  Next Steps:
echo   - Run sync-and-push.bat to commit and push to GitHub
echo   - Cloudflare Pages will auto-deploy in 1-2 minutes
echo.
pause
