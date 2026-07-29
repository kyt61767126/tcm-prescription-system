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

REM Record start time
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"

echo ============================================
echo   Huikang-TCM Build - Mobile APP (Capacitor)
echo   Version: geren (个人版)
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
    powershell -NoProfile -Command "Write-Host '========================================' -ForegroundColor Red; Write-Host '  [ERROR] Build failed, exit code: %EXIT_CODE%' -ForegroundColor Red; Write-Host '  Elapsed: %BUILD_ELAPSED%' -ForegroundColor Red; Write-Host '========================================' -ForegroundColor Red"
) else (
    powershell -NoProfile -Command "Write-Host '========================================' -ForegroundColor Yellow; Write-Host '  [OK] Mobile APP (Personal) build complete!' -ForegroundColor Yellow; Write-Host '  APK: %~dp0惠康中医-个人.apk' -ForegroundColor Yellow; Write-Host '  Start: %BUILD_START_TIME%' -ForegroundColor Yellow; Write-Host '  End: %BUILD_END_TIME%' -ForegroundColor Yellow; Write-Host '  Elapsed: %BUILD_ELAPSED%' -ForegroundColor Yellow; Write-Host '========================================' -ForegroundColor Yellow"
)
echo.
exit /b %EXIT_CODE%
