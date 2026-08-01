@echo off
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

REM pack-app-geren.bat - APP build entry (Capacitor Android APK, personal edition)
REM Calls app_geren/build-app.bat which handles full 10-step flow including APK copy to parent dir

set "CAP_DIR=%~dp0app_geren"
if not exist "%CAP_DIR%\build-app.bat" (
    echo [ERROR] Capacitor APP build script not found: %CAP_DIR%\build-app.bat
    if not defined NO_PAUSE pause
    exit /b 1
)

REM Record start time
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"

echo ============================================
echo   Huikang-TCM Build - Mobile APP (Capacitor)
echo   Version: geren (Personal)
echo   Start: %BUILD_START_TIME%
echo ============================================
echo.

set "NO_PAUSE=1"
call "%CAP_DIR%\build-app.bat"
set "EXIT_CODE=%errorlevel%"
set "NO_PAUSE="

for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
for /f "delims=" %%e in ('powershell -NoProfile -Command "$s=[DateTime]::Parse('%BUILD_START_TIME%'); $e=[DateTime]::Parse('%BUILD_END_TIME%'); $d=$e-$s; $d.ToString('hh\:mm\:ss')"') do set "BUILD_ELAPSED=%%e"

echo.
if %EXIT_CODE% neq 0 (
    echo ========================================
    echo   [ERROR] Build failed, exit code: %EXIT_CODE%
    echo   Elapsed: %BUILD_ELAPSED%
    echo ========================================
) else (
    echo ========================================
    echo   [OK] Mobile APP (Personal) build complete!
    echo   APK: %~dp0惠康中医-离线标准版.apk
    echo   Start: %BUILD_START_TIME%
    echo   End:   %BUILD_END_TIME%
    echo   Elapsed: %BUILD_ELAPSED%
    echo ========================================
)
echo.
if not defined NO_PAUSE (
    set "EXIT_KEY="
    set /p "EXIT_KEY=Press 0 or Enter to exit: "
)
exit /b %EXIT_CODE%
