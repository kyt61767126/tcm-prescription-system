@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

REM ============================================================
REM pack-app-strict.bat - Cloud APP (Standard Strict, 严格模式)
REM 委托到 build-pack.bat app-strict（前置 node/java 检查 + auth-core 同步）
REM 严格模式包含签名哈希刷新 + Java 层混淆 + 签名校验
REM ============================================================

echo ============================================
echo   Cloud APP Builder (Standard Strict)
echo ============================================
echo.

echo [pack-app-strict.bat] Cloud APP (Standard Strict)...
call build-pack.bat app-strict
exit /b %errorlevel%
