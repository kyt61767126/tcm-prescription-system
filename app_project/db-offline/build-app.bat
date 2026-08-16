@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

REM ============================================================
REM build-app.bat - Offline APP 统一入口（代理到 app\build-app.bat）
REM 顶层菜单 one-click-pack.ps1 / release-menu.ps1 统一调用本文件，
REM 与云端版 db-yunduan\build-app.bat 保持一致的调用接口。
REM 用法: build-app.bat [standard|institutional]
REM ============================================================

if not exist "%~dp0app\build-app.bat" (
    echo [ERROR] app\build-app.bat not found
    echo   Path: %~dp0app\build-app.bat
    if not defined NO_PAUSE pause
    exit /b 1
)

call "%~dp0app\build-app.bat" %*
exit /b %errorlevel%