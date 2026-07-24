@echo off
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

REM pack-desktop.bat - Desktop build entry (Electron exe)
set "PACK_PS1=%~dp0..\..\tools\pack.ps1"
if not exist "%PACK_PS1%" (
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
echo ============================================
echo   Huikang-TCM Build - Desktop (Personal)
echo ============================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%PACK_PS1%" -Version geren -Target desktop
set "EXIT_CODE=%errorlevel%"
echo.
if %EXIT_CODE% neq 0 (
    echo [ERROR] Build failed, exit code: %EXIT_CODE%
) else (
    echo [OK] Desktop build complete!
)
echo.
if not defined NO_PAUSE pause
