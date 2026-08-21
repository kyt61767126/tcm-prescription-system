@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

REM ============================================================
REM pack-app.bat - Offline APP (Standard Strict mode)
REM Delegates to: build-pack.bat app-strict (same standard as one-click pack)
REM 2026-08-21: manual pack unified to STRICT standard
REM   (signature hash refresh failure = hard abort)
REM ============================================================

echo [pack-app.bat] Offline APP (Standard Strict)...
call build-pack.bat app-strict
exit /b %errorlevel%
