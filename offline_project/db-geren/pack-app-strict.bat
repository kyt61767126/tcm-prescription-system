@echo off
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

REM pack-app-strict.bat - Strict APP build (Capacitor APK + signature hash + repack)
REM Calls capacitor/pack-app-strict.bat which handles full strict flow

set "CAP_DIR=%~dp0capacitor"
if not exist "%CAP_DIR%\pack-app-strict.bat" (
    echo [ERROR] Capacitor APP strict build script not found: %CAP_DIR%\pack-app-strict.bat
    if not defined NO_PAUSE pause
    exit /b 1
)

echo ============================================
echo   Huikang-TCM Build - Strict APP (Capacitor)
echo   Version: geren (个人版)
echo   (APK + signature hash + repack)
echo ============================================
echo.

call "%CAP_DIR%\pack-app-strict.bat"
set "EXIT_CODE=%errorlevel%"

echo.
if %EXIT_CODE% neq 0 (
    echo [ERROR] Build failed, exit code: %EXIT_CODE%
) else (
    echo [OK] Strict APP build complete!
    echo [INFO] APK located in: %~dp0惠康中医-个人.apk
)
echo.
if not defined NO_PAUSE pause
exit /b %EXIT_CODE%
