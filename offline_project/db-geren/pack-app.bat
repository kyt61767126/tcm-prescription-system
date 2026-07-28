@echo off
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

REM pack-app.bat - APP build entry (Capacitor Android APK)
REM Calls capacitor/build-app.bat which handles full 10-step flow including APK copy to parent dir

set "CAP_DIR=%~dp0capacitor"
if not exist "%CAP_DIR%\build-app.bat" (
    echo [ERROR] Capacitor APP build script not found: %CAP_DIR%\build-app.bat
    if not defined NO_PAUSE pause
    exit /b 1
)

echo ============================================
echo   Huikang-TCM Build - Mobile APP (Capacitor)
echo   Version: geren (个人版)
echo ============================================
echo.

set "NO_PAUSE=1"
call "%CAP_DIR%\build-app.bat"
set "EXIT_CODE=%errorlevel%"
set "NO_PAUSE="

echo.
if %EXIT_CODE% neq 0 (
    echo [ERROR] Build failed, exit code: %EXIT_CODE%
) else (
    echo [OK] Mobile APP build complete!
    echo [INFO] APK located in: %~dp0惠康中医-个人.apk
)
echo.
if not defined NO_PAUSE pause
exit /b %EXIT_CODE%
