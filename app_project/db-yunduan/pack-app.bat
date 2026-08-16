@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

REM ============================================================
REM pack-app.bat - Cloud APP (Standard, 普通模式)
REM 委托到 build-pack.bat app（普通模式，无 standard 参数）
REM 严格模式请使用 pack-app-strict.bat
REM ============================================================

echo ============================================
echo   Cloud APP Builder (Standard)
echo ============================================
echo.

echo [pack-app.bat] Cloud APP (Standard)...
call build-pack.bat app
exit /b %errorlevel%
