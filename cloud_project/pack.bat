@echo off
setlocal enableextensions
chcp 65001 >nul 2>&1
cd /d "%~dp0"
title Huikang TCM Cloud - Packaging Module

echo ============================================
echo   Huikang TCM Cloud - Packaging Module
echo ============================================
echo.

REM [1] Check packaging.ps1 exists
set "PACK_PS1=%~dp0packaging.ps1"
if not exist "%PACK_PS1%" (
    echo [ERROR] packaging.ps1 not found!
    echo         Path: %PACK_PS1%
    pause
    exit /b 1
)
echo [OK] packaging.ps1 found

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

REM [3] Check config files
if exist "%~dp0cloud_desktop\package.json" (
    echo [OK] cloud_desktop/package.json found
) else (
    echo [WARN] cloud_desktop/package.json not found
)

echo.
echo Starting packaging module...
echo ============================================
echo.

REM Run packaging.ps1 with PowerShell
powershell -NoProfile -ExecutionPolicy Bypass -File "%PACK_PS1%"
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
