@echo off
setlocal enabledelayedexpansion

echo ============================================
echo Huikang TCM - Pre-release Branch Manager
echo ============================================
echo.

if "%1"=="merge" goto :merge
if "%1"=="sync" goto :sync
if "%1"=="preview" goto :preview
goto :help

:merge
echo [1/4] Switching to main branch...
git checkout main
echo.
echo [2/4] Pulling latest code...
git pull origin main
echo.
echo [3/4] Merging staging into main...
git merge staging --no-ff -m "merge: staging -> main"
if errorlevel 1 (
echo.
echo [ERROR] Merge conflict! Please resolve manually then run:
echo git add .
echo git commit
echo git push origin main
goto :eof
)
echo.
echo [4/4] Pushing to GitHub (triggering Cloudflare Pages production deploy)...
git push origin main
echo.
echo [OK] Merge complete! Cloudflare Pages will auto-deploy to production.
goto :eof

:sync
echo [1/3] Syncing main latest code to staging...
git checkout staging
echo.
echo [2/3] Pulling latest code...
git pull origin main
echo.
echo [3/3] Pushing to staging...
git push origin staging
echo.
echo [OK] staging synced with main.
git checkout main
goto :eof

:preview
echo.
echo ============================================
echo Cloudflare Pages Preview Deployment Guide
echo ============================================
echo.
echo 1. Configure in Cloudflare Dashboard:
echo Pages project -^> Settings -^> Builds ^& deployments
echo -^> Preview branches -^> Add staging
echo.
echo 2. Push code to staging branch, Cloudflare auto deploys preview:
echo https://[hash].tcm-prescription-system.pages.dev
echo.
echo 3. After verification passes, run:
echo staging-merge.bat merge
echo This merges staging into main, triggering production deploy.
echo.
goto :eof

:help
echo Usage:
echo staging-merge.bat merge - Merge staging into main (after preview verified)
echo staging-merge.bat sync - Sync main latest code to staging
echo staging-merge.bat preview - Show Preview deployment guide
echo.
echo Workflow:
echo 1. git checkout staging (switch to pre-release branch)
echo 2. Make changes and test
echo 3. git push origin staging (push, Cloudflare auto deploys preview)
echo 4. Verify on preview URL
echo 5. staging-merge.bat merge (merge to main, trigger production deploy)
echo.
