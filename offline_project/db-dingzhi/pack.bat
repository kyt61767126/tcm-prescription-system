@echo off
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"
title 惠康中医定制版 - 打包工具

REM [1] 检查 pack.ps1 是否存在
set "PACK_PS1=%~dp0..\..\tools\pack.ps1"
if not exist "%PACK_PS1%" (
    echo [错误] 未找到 pack.ps1
    echo   路径: %PACK_PS1%
    pause
    exit /b 1
)

REM [2] 检查 Node.js 环境
where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 Node.js，请从 https://nodejs.org/ 安装
    pause
    exit /b 1
)

REM [3] 启动 pack.ps1（UTF-8 中文菜单）
powershell -NoProfile -ExecutionPolicy Bypass -File "%PACK_PS1%" -Version dingzhi -Interactive
set "EXIT_CODE=%errorlevel%"

if %EXIT_CODE% neq 0 (
    echo.
    echo [错误] 打包异常退出，退出码: %EXIT_CODE%
    echo   提示: 请尝试 chcp 65001 ^&^& pack.bat
)
echo.
pause
