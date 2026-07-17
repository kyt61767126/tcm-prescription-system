@echo off
chcp 65001 >nul
setlocal

REM ============================================================
REM  Sync and Push - cloud_desktop -> public -> git commit -> push
REM
REM  Usage:
REM    sync-and-push.bat           (默认：同步 + 提交 + 推送)
REM    sync-and-push.bat --no-push (仅同步 + 提交，不推送)
REM
REM  流程：
REM    1) Sync frontend code to public/ directory
REM    2) Auto git add + commit
REM    3) Push to GitHub (除非 --no-push)
REM    4) Cloudflare Pages auto-deploys after push (1-2 min)
REM ============================================================

set "SRC=%~dp0"
set "DST=%~dp0..\..\public"
set "REPO=%~dp0..\..\"

REM 解析参数
set "NO_PUSH=0"
if /i "%~1"=="--no-push" set "NO_PUSH=1"

echo.
echo ================================================================
echo  Sync and Push - Cloud code synchronization
echo ================================================================
echo  Source: %SRC%index.html
echo  Target: %DST%index.html
if "%NO_PUSH%"=="1" echo  Mode:   Sync + Commit (no push)
if not "%NO_PUSH%"=="1" echo  Mode:   Sync + Commit + Push
echo.

if not exist "%DST%" (
    echo [ERROR] Target directory not found: %DST%
    pause
    exit /b 1
)

REM [1/4] Sync files
echo [1/4] Syncing index.html ...
copy /Y "%SRC%index.html" "%DST%index.html" >nul
if errorlevel 1 ( echo [ERROR] index.html sync failed & pause & exit /b 1 )

echo [2/4] Syncing xlsx.full.min.js ...
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

REM [3/4] Git add + commit
echo [3/4] git add ...
cd /d "%REPO%"
git add public/index.html public/xlsx.full.min.js cloud_project/cloud_desktop/index.html 2>nul
if errorlevel 1 ( echo [WARN] git add may have missed some files )

git diff --cached --quiet
if %errorlevel% equ 0 (
    echo.
    echo [INFO] No changes to commit, files may be unmodified
    pause
    exit /b 0
)

for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss' -ca") do set "NOW=%%t"
git commit -m "sync: cloud_desktop frontend sync (%NOW%)"
if errorlevel 1 ( echo [ERROR] git commit failed & pause & exit /b 1 )

REM [4/4] Push (unless --no-push)
if "%NO_PUSH%"=="1" (
    echo.
    echo [4/4] Skipped push (--no-push)
) else (
    echo [4/4] git push ...
    git push origin main
    if errorlevel 1 ( echo [ERROR] git push failed & pause & exit /b 1 )
)

echo.
echo ================================================================
echo  Completed
echo ================================================================
if "%NO_PUSH%"=="1" (
    echo  Changes committed locally. Run without --no-push to deploy.
) else (
    echo  Cloudflare Pages will auto-deploy in 1-2 minutes.
    echo  Visit https://tcm-prescription-system.pages.dev to verify.
)
echo.
pause
