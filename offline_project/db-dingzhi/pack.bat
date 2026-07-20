@echo off
setlocal enableextensions
chcp 65001 >nul 2>&1
cd /d "%~dp0"
title 惠康中医定制版 - 打包工具

echo ============================================
echo   惠康中医定制版 - 打包工具
echo   (桌面+APP 统一入口)
echo ============================================
echo.

REM [1] 检查 pack.ps1 是否存在
set "PACK_PS1=%~dp0..\..\tools\pack.ps1"
if not exist "%PACK_PS1%" (
    echo [错误] 未找到 pack.ps1！
    echo        路径: %PACK_PS1%
    echo        请确保 tools 目录完整。
    pause
    exit /b 1
)
echo [OK] 已找到 pack.ps1

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

REM [3] 检查 config.json
if not exist "%~dp0config.json" (
    echo [警告] 未找到 config.json，将使用默认值
) else (
    echo [OK] 已找到 config.json
)

echo.
echo 正在启动打包模块...
echo ============================================
echo.

REM 运行 pack.ps1，使用 -Interactive 模式（显示菜单）
powershell -NoProfile -ExecutionPolicy Bypass -File "%PACK_PS1%" -Version dingzhi -Interactive
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
