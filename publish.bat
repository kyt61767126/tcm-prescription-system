chcp 65001 >nul
@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Huikang TCM - One-Click Publish

echo ============================================
echo   Huikang TCM - One-Click Publish Tool
echo   (Auto check exe/apk changes -^> Upload to GitHub Release)
echo ============================================
echo.

REM Check node
where node >nul 2>nul
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] node not found. Please install Node.js first.'"
    if not defined NO_PAUSE pause
    exit /b 1
)

REM Check gh
where gh >nul 2>nul
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] gh CLI not found. Install: winget install GitHub.cli'"
    if not defined NO_PAUSE pause
    exit /b 1
)

echo [Tip] This tool auto-checks local exe/apk vs online version.
echo        - New build found -^> auto upload to GitHub Release
echo        - No changes -^> exit with "No update needed"
echo        - Force re-publish: node tools/auto-publish.js --force
echo.
echo Press any key to start checking...
pause >nul
echo.
node tools/auto-publish.js %*
set "RC=%errorlevel%"

echo.
echo ============================================
if "%RC%"=="0" (
    echo Done. All files up-to-date, or published successfully.
) else (
    echo Exit code: %RC%
    echo Publish failed. Please check error messages above.
)
echo ============================================
echo.
if not defined NO_PAUSE pause
exit /b %RC%