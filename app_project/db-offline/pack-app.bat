@echo off
setlocal EnableExtensions
cd /d "%~dp0"

REM ============================================================
REM pack-app.bat - Offline APP (Standard)
REM Delegates to: build-pack.bat app
REM ============================================================

echo [pack-app.bat] Offline APP (Standard)...
call build-pack.bat app
exit /b %errorlevel%
