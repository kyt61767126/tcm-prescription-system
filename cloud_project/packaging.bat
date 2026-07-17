@echo off
chcp 65001 >nul
title Cloud Packaging Tool

REM Run PowerShell packaging script with pause to prevent window closing on error
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0packaging.ps1"

REM Pause to show error messages if PowerShell exited unexpectedly
if %ERRORLEVEL% neq 0 (
    echo.
    echo ================================================================================
    echo  [ERROR] packaging.ps1 exited with code %ERRORLEVEL%
    echo  If no error message shown above, possible causes:
    echo    1. PowerShell execution policy restricted by system group policy
    echo    2. packaging.ps1 file encoding issue ^(should be UTF-8^)
    echo    3. PowerShell not installed or PATH issue
    echo ================================================================================
)

echo.
pause
