@echo off
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

REM pack-desktop.bat - Desktop Build Entry (Electron exe)
REM Capacitor version does not package desktop, redirect to original offline version

echo ============================================
echo   Huikang-TCM Local - Desktop Build
echo ============================================
echo.
echo [INFO] Capacitor version is APP-only.
echo [INFO] Desktop build uses original Electron version.
echo.

set "DESKTOP_PS1=%~dp0..\..\..\tools\pack.ps1"
if not exist "%DESKTOP_PS1%" (
    echo [ERROR] pack.ps1 not found
    if not defined NO_PAUSE pause
    exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found
    if not defined NO_PAUSE pause
    exit /b 1
)

echo [INFO] Redirecting to original Electron desktop build...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%DESKTOP_PS1%" -Version bendi -Target desktop
set "EXIT_CODE=%errorlevel%"
echo.
if %EXIT_CODE% neq 0 (
    echo [ERROR] Desktop build failed, exit code: %EXIT_CODE%
) else (
    echo [OK] Desktop build complete!
)
echo.
if not defined NO_PAUSE pause
exit /b %EXIT_CODE%
