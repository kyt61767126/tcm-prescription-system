@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo [pack-desktop.bat] Cloud Desktop (Unified)...
echo.
call build-pack.bat desktop
exit /b %errorlevel%
