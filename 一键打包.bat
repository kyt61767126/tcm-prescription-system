@echo off
setlocal enableextensions
cd /d "%~dp0"

REM Check one-click-pack.ps1 exists
set "PACK_PS1=%~dp0tools\one-click-pack.ps1"
if not exist "%PACK_PS1%" (
    echo [ERROR] one-click-pack.ps1 not found
    echo   Path: %PACK_PS1%
    if not defined NO_PAUSE pause
    exit /b 1
)

REM Launch one-click-pack.ps1 (UTF-8 Chinese menu with BOM)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PACK_PS1%"
set "EXIT_CODE=%errorlevel%"

if %EXIT_CODE% neq 0 (
    echo.
    echo [ERROR] One-click packaging exited with code: %EXIT_CODE%
)
echo.
if not defined NO_PAUSE pause
