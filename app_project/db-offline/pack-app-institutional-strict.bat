@echo off
setlocal EnableExtensions
cd /d "%~dp0"

REM ============================================================
REM pack-app-institutional-strict.bat - Offline APP Institutional (Strict)
REM Delegates to: build-pack.bat institutional-strict
REM ============================================================

echo [pack-app-institutional-strict.bat] Offline APP Institutional (Strict)...
call build-pack.bat institutional-strict
exit /b %errorlevel%
