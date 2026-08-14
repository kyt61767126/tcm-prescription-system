@echo off
setlocal enabledelayedexpansion

echo ============================================
echo Huikang TCM - Emergency Rollback Tool
echo (Cloud Web + Desktop EXE + APP)
echo ============================================
echo.

if "%1"=="" goto :menu
if "%1"=="web" goto :rollback_web
if "%1"=="exe" goto :rollback_exe
if "%1"=="all" goto :rollback_all
goto :menu

:menu
echo Select rollback operation:
echo.
echo 1. Cloud Web Rollback (revert last git commit, Cloudflare auto re-deploy)
echo 2. Desktop EXE Rollback (revert latest.json to previous version)
echo 3. Rollback ALL (Web + EXE, use for emergency)
echo 4. View recent 5 deployments
echo 5. Exit
echo.
set /p choice=" [1-5]: "

if "%choice%"=="1" goto :rollback_web
if "%choice%"=="2" goto :rollback_exe
if "%choice%"=="3" goto :rollback_all
if "%choice%"=="4" goto :show_deploys
if "%choice%"=="5" goto :eof
goto :menu

:rollback_web
echo.
echo [Web Rollback] Reverting last commit and pushing...
echo.

REM Show recent commits
git log --oneline -3
echo.

set /p confirm="Continue? (y/n): "
if /i not "%confirm%"=="y" (
echo Cancelled.
goto :eof
)

REM Revert last commit
git revert HEAD --no-edit
if errorlevel 1 (
echo.
echo [ERROR] git revert failed, possible conflicts
echo Please run manually: git revert HEAD
goto :eof
)

REM Push to GitHub to trigger Cloudflare Pages
git push origin main
if errorlevel 1 (
echo.
echo [ERROR] git push failed
echo Please run manually: git push origin main
goto :eof
)

echo.
echo [OK] Web rollback complete!
echo Cloudflare Pages will re-deploy in 1-2 minutes
echo Staging preview environment not affected
echo.
goto :eof

:rollback_exe
echo.
echo [Desktop EXE Rollback]
echo.
echo Available channels:
echo cloud - Cloud Desktop
echo dingzhi - Custom Desktop
echo geren - Personal Desktop
echo all - All Desktop
echo.
set /p channel="Channel (default=cloud): "
if "%channel%"=="" set channel=cloud

echo.
echo Querying available rollback versions...
node tools/rollback.js %channel%
echo.
set /p ver="Version number (e.g. 1.1.0): "
if "%ver%"=="" (
echo [ERROR] No version entered, cancelled.
goto :eof
)

set /p confirm="Rollback %channel% to %ver%? (y/n): "
if /i not "%confirm%"=="y" (
echo Cancelled.
goto :eof
)

node tools/rollback.js %channel% %ver% --push
echo.
goto :eof

:rollback_all
echo.
echo [ROLLBACK ALL - EMERGENCY MODE]
echo This action will:
echo 1. Revert last web commit
echo 2. Rollback all desktop EXE to previous version
echo.
set /p confirm="Confirm? (y/n): "
if /i not "%confirm%"=="y" (
echo Cancelled.
goto :eof
)

echo.
echo [1/2] Rolling back Web...
git revert HEAD --no-edit
git push origin main

echo.
echo [2/2] Rolling back Desktop EXE (all channels)...
for %%c in (cloud dingzhi geren) do (
echo.
echo Channel: %%c
node tools/rollback.js %%c 2>nul
set /p ver="Version for %%c (leave empty to skip): "
if not "!ver!"=="" (
node tools/rollback.js %%c !ver! --push
)
)

echo.
echo [OK] All rollback complete!
echo Web: Cloudflare Pages will re-deploy in 1-2 minutes
echo Desktop: Users will receive rolled-back version on next update check
echo.
goto :eof

:show_deploys
echo.
echo Recent 5 Cloudflare Pages deployments:
echo.
npx wrangler pages deployment list --project-name=tcm-prescription-system 2>&1 | findstr /R "Production.*main" | Select-Object -First 5
echo.
goto :menu
