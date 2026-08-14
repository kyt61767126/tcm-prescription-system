@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "PACK_APP_BAT=%~dp0build-app.bat"

echo ============================================
echo   Cloud APP Builder (Institutional)
echo ============================================
echo.

call "%PACK_APP_BAT%" institutional
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
echo   [OK] Cloud APP (Institutional) completed
echo   APK: YJ.apk
echo ============================================
echo.
pause
exit /b 0
