@echo off
setlocal enableextensions
cd /d "%~dp0"

REM pack-app.bat - 手机APP打包入口（Android APK）
REM 直接打包，无菜单交互

set "PACK_PS1=%~dp0packaging.ps1"
if not exist "%PACK_PS1%" (
    echo [ERROR] packaging.ps1 not found
    echo   Path: %PACK_PS1%
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found
    echo   Please install from https://nodejs.org/
    pause
    exit /b 1
)

echo ============================================
echo   惠康中医打包 - 手机APP (Android APK)
echo ============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%PACK_PS1%" -AutoApp
set "EXIT_CODE=%errorlevel%"

echo.
if %EXIT_CODE% neq 0 (
    echo [ERROR] 打包失败，退出码: %EXIT_CODE%
) else (
    echo [OK] 手机APP打包完成！
)
echo.
pause
