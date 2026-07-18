@echo off
setlocal enableextensions
chcp 65001 >nul 2>&1
cd /d "%~dp0"
title Huikang TCM Custom - Packaging Module

echo ============================================
echo   Huikang TCM Custom - Packaging Module
echo ============================================
echo.

REM [1] Check pack.ps1 exists
set "PACK_PS1=%~dp0..\..\tools\pack.ps1"
if not exist "%PACK_PS1%" (
    echo [ERROR] pack.ps1 not found!
    echo         Path: %PACK_PS1%
    echo         Please ensure the tools directory is intact.
    pause
    exit /b 1
)
echo [OK] pack.ps1 found

REM [2] Check Node.js environment
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found!
    echo         Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)
echo [OK] Node.js found: 
node --version

REM [3] Check config.json
if not exist "%~dp0config.json" (
    echo [WARN] config.json not found, will use defaults
) else (
    echo [OK] config.json found
)

echo.
echo Starting packaging module...
echo ============================================
echo.

REM Run pack.ps1 with -Interactive mode (shows menu)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PACK_PS1%" -Version dingzhi -Interactive
set "EXIT_CODE=%errorlevel%"

echo.
echo ============================================
if %EXIT_CODE% equ 0 (
    echo [OK] Packaging completed successfully!
) else (
    echo [ERROR] Packaging exited with code: %EXIT_CODE%
    echo         If encoding issues occur, run:
    echo           chcp 65001 ^&^& pack.bat
)
echo ============================================
echo.
pause
