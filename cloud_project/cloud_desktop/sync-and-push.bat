@echo off
chcp 65001 >nul
setlocal

REM ============================================================
REM  Sync and Push - cloud_desktop -> public -> git commit -> push
REM
REM  Usage:
REM    Run this script after modifying cloud_desktop/index.html:
REM    1) Sync frontend code to public/ directory
REM    2) Auto git add + commit + push
REM    3) Cloudflare Pages auto-deploys after push (1-2 min)
REM ============================================================

set "SRC=%~dp0"
set "DST=%~dp0..\..\public"
set "REPO=%~dp0..\..\"

echo.
echo ================================================================
echo  Sync and Push - Cloud code synchronization
echo ================================================================
echo.

if not exist "%DST%" (
    echo [ERROR] Target directory not found: %DST%
    pause
    exit /b 1
)

REM Sync files
echo [1/4] Syncing index.html ...
copy /Y "%SRC%index.html" "%DST%index.html" >nul
if errorlevel 1 ( echo [ERROR] index.html sync failed & pause & exit /b 1 )

echo [2/4] Syncing xlsx.full.min.js ...
if exist "%SRC%xlsx.full.min.js" (
    copy /Y "%SRC%xlsx.full.min.js" "%DST%xlsx.full.min.js" >nul
)

REM Git operations
echo [3/4] git add ...
cd /d "%REPO%"
git add public/index.html public/xlsx.full.min.js cloud_project/cloud_desktop/index.html 2>nul
if errorlevel 1 ( echo [WARN] git add may have missed some files )

REM Check for changes
git diff --cached --quiet
if %errorlevel% equ 0 (
    echo.
    echo [INFO] No changes to commit, files may be unmodified
    pause
    exit /b 0
)

echo [4/4] git commit + push ...
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss' -ca") do set "NOW=%%t"
git commit -m "sync: cloud_desktop frontend sync (%NOW%)"
if errorlevel 1 ( echo [ERROR] git commit failed & pause & exit /b 1 )

git push origin main
if errorlevel 1 ( echo [ERROR] git push failed & pause & exit /b 1 )

echo.
echo ================================================================
echo  Completed
echo ================================================================
echo  Cloudflare Pages will auto-deploy in 1-2 minutes.
echo  Visit https://tcm-prescription-system.pages.dev to verify.
echo.
pause
