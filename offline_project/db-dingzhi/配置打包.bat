@echo off
title Configure and Build - Custom Edition
setlocal

set "HTML_FILE=%~dp0android\app\src\main\assets\public\index.html"
set "BUILD_BAT=%~dp0build-app.bat"
set "PS_SCRIPT=%~dp0config_script.ps1"

echo ============================================
echo  Configure and Build - Custom Edition
echo ============================================
echo.

echo [1/2] Checking configuration files...
if not exist "%HTML_FILE%" (
    echo [ERROR] HTML file not found:
    echo   %HTML_FILE%
    echo.
    echo [INFO] Running sync-to-app.bat to synchronize files...
    call "%~dp0sync-to-app.bat"
    if not exist "%HTML_FILE%" (
        pause
        exit /b 1
    )
) else (
    echo       HTML file OK
)

if not exist "%PS_SCRIPT%" (
    echo [ERROR] PS script not found:
    echo   %PS_SCRIPT%
    pause
    exit /b 1
) else (
    echo       PS script OK
)

echo [OK] Configuration check passed
echo.

echo [2/2] Running configuration script...
set "CONFIG_HTML_FILE=%HTML_FILE%"
set "CONFIG_BUILD_BAT=%BUILD_BAT%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "& '%PS_SCRIPT%'"

if errorlevel 1 (
    echo.
    echo [ERROR] PowerShell script execution failed.
    pause
) else (
    echo.
    echo [OK] Configuration completed
    echo.
    echo ============================================
    echo  Next steps:
    echo   - Run sync-to-app.bat to sync changes
    echo   - Run build-app.bat to build APK
    echo ============================================
)
pause