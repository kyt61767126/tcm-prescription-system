@echo off
setlocal EnableExtensions
cd /d "%~dp0"

REM ============================================================
REM pack-app-institutional.bat - Offline APP Institutional
REM Delegates to: build-pack.bat institutional
REM ============================================================

echo [pack-app-institutional.bat] Offline APP Institutional...
call build-pack.bat institutional
exit /b %errorlevel%
