@echo off
title Configure and Build - Local Edition
setlocal

set "BUILD_BAT=%~dp0build-app.bat"
set "PS_SCRIPT=%~dp0edit-config.ps1"

echo ============================================
echo  Configure and Build - Local Edition
echo ============================================
echo.

echo [1/3] Running configuration script...
if not exist "%PS_SCRIPT%" (
    echo [ERROR] Configuration script not found:
    echo   %PS_SCRIPT%
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%"

if errorlevel 1 (
    echo.
    echo [ERROR] Configuration script execution failed.
    pause
    exit /b 1
)
echo.

echo [2/3] Synchronizing files to Android...
call "%~dp0sync-to-app.bat"
echo.

echo [3/3] Building APK...
call "%BUILD_BAT%" --skip-config
echo.

echo ============================================
echo  All tasks completed!
echo ============================================
echo.
pause
