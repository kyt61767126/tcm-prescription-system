@echo off
setlocal enableextensions
cd /d "%~dp0"
title 惠康中医云端版 - 打包工具

echo ============================================
echo   惠康中医云端版 - 打包工具
echo   (桌面+APP 统一入口)
echo ============================================
echo.

REM [1] 检查 packaging.ps1 是否存在
set "PACK_PS1=%~dp0packaging.ps1"
if not exist "%PACK_PS1%" (
    echo [错误] 未找到 packaging.ps1！
    echo        路径: %PACK_PS1%
    pause
    exit /b 1
)
echo [OK] 已找到 packaging.ps1

REM [2] 检查 Node.js 环境
where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 Node.js！
    echo        请从 https://nodejs.org/ 安装 Node.js
    pause
    exit /b 1
)
echo [OK] 已找到 Node.js:
node --version

REM [3] 检查配置文件
if exist "%~dp0cloud_desktop\package.json" (
    echo [OK] 已找到 cloud_desktop/package.json
) else (
    echo [警告] 未找到 cloud_desktop/package.json
)

echo.
echo 正在启动打包模块...
echo ============================================
echo.

REM 运行 packaging.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File "%PACK_PS1%"
set "EXIT_CODE=%errorlevel%"

echo.
echo ============================================
if %EXIT_CODE% equ 0 (
    echo [完成] 打包流程已正常结束！
) else (
    echo [错误] 打包异常退出，退出码: %EXIT_CODE%
    echo        若出现编码乱码，请运行:
    echo          chcp 65001 ^&^& pack.bat
)
echo ============================================
echo.
pause
