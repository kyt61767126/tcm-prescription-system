@echo off
chcp 65001 >nul 2>&1
setlocal

set "HTML_FILE=%~dp0android\app\src\main\assets\public\index.html"
set "BUILD_BAT=%~dp0build-app.bat"
set "PS_SCRIPT=%~dp0config_script.ps1"

if not exist "%HTML_FILE%" (
    echo [ERROR] HTML file not found:
    echo   %HTML_FILE%
    pause
    exit /b 1
)

if not exist "%PS_SCRIPT%" (
    echo [ERROR] PS script not found:
    echo   %PS_SCRIPT%
    pause
    exit /b 1
)

set "CONFIG_HTML_FILE=%HTML_FILE%"
set "CONFIG_BUILD_BAT=%BUILD_BAT%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "& '%PS_SCRIPT%'"

if errorlevel 1 (
    echo.
    echo [ERROR] PowerShell script execution failed.
    pause
)
