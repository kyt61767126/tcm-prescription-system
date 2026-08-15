@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

set "PACK_APP_BAT=%~dp0build-app.bat"

echo ============================================
echo   Cloud APP Builder (Standard)
echo ============================================
echo.

call "%PACK_APP_BAT%" standard
set "TEMP_RC=%errorlevel%"
if %TEMP_RC% neq 0 (
    echo.
    echo [ERROR] Build failed, exit code: %TEMP_RC%
    echo.
    pause
    exit /b %TEMP_RC%
)
echo.
echo ============================================
echo   [OK] 云端APP（标准版）打包完成
echo   APK: 惠康中医-云端.apk
echo ============================================
echo.
pause
exit /b 0
