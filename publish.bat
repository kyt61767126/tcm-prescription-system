@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
title 惠康中医 - 一键发布工具

echo ============================================
echo   惠康中医 · 一键发布工具
echo   （自动检查 exe/apk 变化 → 上传 GitHub Release）
echo ============================================
echo.

REM 检查 node 是否可用
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] 未找到 node，请先安装 Node.js
    pause
    exit /b 1
)

REM 检查 gh 是否可用
where gh >nul 2>nul
if errorlevel 1 (
    echo [ERROR] 未找到 gh CLI，请安装: winget install GitHub.cli
    pause
    exit /b 1
)

echo [提示] 本脚本会自动检查本地 exe/apk 文件是否比线上版本更新
echo        - 如果有新打包的文件，会自动上传到 GitHub Release
echo        - 如果没有变化，会提示"无需发布"并退出
echo        - 如需强制重新发布，用: node tools/auto-publish.js --force
echo.
echo 按任意键开始检查...
pause >nul
echo.

REM 调用 auto-publish.js
node tools/auto-publish.js %*
set "RC=%errorlevel%"

echo.
echo ============================================
if "%RC%"=="0" (
    echo  完成！所有文件都是最新，或已成功发布
) else (
    echo  退出码: %RC%
    echo  如发布失败，请检查上方错误信息
)
echo ============================================
echo.
pause
exit /b %RC%
