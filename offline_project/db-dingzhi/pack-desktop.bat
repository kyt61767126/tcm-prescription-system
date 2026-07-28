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
echo   Huikang-TCM Build - Desktop (Custom)
echo ============================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%PACK_PS1%" -Version dingzhi -Target desktop
set "EXIT_CODE=%errorlevel%"
echo.
if %EXIT_CODE% neq 0 (
    echo [错误] 打包失败，退出码: %EXIT_CODE%
) else (
    echo [成功] 桌面版打包完成！
    echo.
    echo ============================================
    echo   打包成功！
    echo   产品: 惠康中医-定制（桌面版）
    echo ============================================
)
echo.
if not defined NO_PAUSE pause
