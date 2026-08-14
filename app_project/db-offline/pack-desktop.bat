@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo [pack-desktop.bat] Offline Desktop (Unified)...
echo.
call build-pack.bat desktop
exit /b %errorlevel%
