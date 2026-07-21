@echo off
setlocal enableextensions
cd /d "%~dp0"

REM Check packaging.ps1 exists
set "PACK_PS1=%~dp0packaging.ps1"
if not exist "%PACK_PS1%" (
    echo [ERROR] packaging.ps1 not found
    echo   Path: %PACK_PS1%
    pause
    exit /b 1
)

REM Check Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found
    echo   Please install from https://nodejs.org/
    pause
    exit /b 1
)

REM Launch packaging.ps1 (UTF-8 Chinese menu)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PACK_PS1%"
set "EXIT_CODE=%errorlevel%"

if %EXIT_CODE% neq 0 (
    echo.
    echo [ERROR] Packaging exited with code: %EXIT_CODE%
)
echo.
pause
