@echo off
setlocal enableextensions
cd /d "%~dp0"

REM pack-desktop.bat - 桌面版打包入口（Electron exe）
set "PACK_PS1=%~dp0..\..\tools\pack.ps1"
if not exist "%PACK_PS1%" (
    echo [ERROR] pack.ps1 not found
    pause
    exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found
    pause
    exit /b 1
)
echo ============================================
echo   惠康中医打包 - 桌面版 (个人版)
echo ============================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%PACK_PS1%" -Version geren -Target desktop
set "EXIT_CODE=%errorlevel%"
echo.
if %EXIT_CODE% neq 0 (
    echo [ERROR] 打包失败，退出码: %EXIT_CODE%
) else (
    echo [OK] 桌面版打包完成！
)
echo.
pause
