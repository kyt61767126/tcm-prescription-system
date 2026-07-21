@echo off
setlocal enableextensions
cd /d "%~dp0"
title 惠康中医云端版 - 打包工具（兼容入口）

echo ============================================
echo   惠康中医云端版 - 打包工具
echo   (此为兼容入口，推荐使用 pack.bat)
echo ============================================
echo.

REM [1] 检查 packaging.ps1 是否存在
set "PACK_PS1=%~dp0packaging.ps1"
if not exist "%PACK_PS1%" (
    echo [错误] 未找到 packaging.ps1
    echo        路径: %PACK_PS1%
    pause
    exit /b 1
)
echo [OK] 找到 packaging.ps1

REM [2] 检查 Node.js 环境
where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 Node.js
    echo        请访问 https://nodejs.org/ 安装 Node.js
    pause
    exit /b 1
)
echo [OK] 找到 Node.js:
node --version

echo.
echo 启动云端打包模块...
echo ============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%PACK_PS1%"
set "EXIT_CODE=%errorlevel%"

echo.
echo ============================================
if %EXIT_CODE% equ 0 (
    echo [完成] 云端打包流程已结束
) else (
    echo [错误] 程序异常退出，退出码: %EXIT_CODE%
    echo        若中文显示乱码，请运行:
    echo          chcp 65001 ^&^& packaging.bat
)
echo ============================================
echo.
pause
