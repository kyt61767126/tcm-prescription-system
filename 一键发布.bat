@echo off
setlocal enableextensions
cd /d "%~dp0"

REM One-Click Publish (Chinese name entry, symmetric with one-click-pack.bat)
REM Calls tools\release-menu.ps1 (pack / publish / verify menu)

set "RELEASE_PS1=%~dp0tools\release-menu.ps1"
if not exist "%RELEASE_PS1%" (
    powershell -NoProfile -Command "Write-Host '[ERROR] release-menu.ps1 not found'"
    echo   Path: %RELEASE_PS1%
    if not defined NO_PAUSE pause
    exit /b 1
)

REM Launch release-menu.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File "%RELEASE_PS1%"
set "EXIT_CODE=%errorlevel%"

if %EXIT_CODE% neq 0 (
    echo.
    powershell -NoProfile -Command "Write-Host '[ERROR] One-click publish exited with code: %EXIT_CODE%'"
)
echo.
if not defined NO_PAUSE pause
