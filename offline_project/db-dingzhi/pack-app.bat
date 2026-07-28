@echo off
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

REM pack-app.bat - APP build entry (Capacitor Android APK)
REM Capacitor APP: stable architecture, unified with cloud APP

set "CAP_DIR=%~dp0capacitor"
if not exist "%CAP_DIR%\build-app.bat" (
    echo [ERROR] Capacitor APP build script not found: %CAP_DIR%\build-app.bat
    if not defined NO_PAUSE pause
    exit /b 1
)

echo ============================================
echo   Huikang-TCM Build - Mobile APP (Capacitor)
echo   Version: dingzhi (定制版)
echo ============================================
echo.

call "%CAP_DIR%\build-app.bat"
set "EXIT_CODE=%errorlevel%"

if %EXIT_CODE% equ 0 (
    if exist "%CAP_DIR%\惠康中医-定制-Capacitor.apk" (
        copy "%CAP_DIR%\惠康中医-定制-Capacitor.apk" "%~dp0惠康中医-定制-Capacitor.apk" /y >nul
        echo [OK] APK copied to: %~dp0惠康中医-定制-Capacitor.apk
    )
)

echo.
if %EXIT_CODE% neq 0 (
    echo [ERROR] Build failed, exit code: %EXIT_CODE%
) else (
    echo [OK] Mobile APP build complete!
)
echo.
if not defined NO_PAUSE pause
exit /b %EXIT_CODE%
