@echo off
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

REM pack-app-strict-geren.bat - Strict APP build (Capacitor APK + signature hash + repack)
REM Personal edition: calls app_geren/pack-app-strict.bat which handles full strict flow

REM Record start time
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"

set "CAP_DIR=%~dp0app_geren"
if not exist "%CAP_DIR%\pack-app-strict.bat" (
    echo [ERROR] Capacitor APP strict build script not found: %CAP_DIR%\pack-app-strict.bat
    if not defined NO_PAUSE pause
    exit /b 1
)

echo ============================================
echo   Huikang-TCM Build - Strict APP (Capacitor)
echo   Version: geren (?????)
echo   (APK + signature hash + repack)
echo   ???: %BUILD_START_TIME%
echo ============================================
echo.

set "NO_PAUSE=1"
call "%CAP_DIR%\pack-app-strict.bat"
set "EXIT_CODE=%errorlevel%"
set "NO_PAUSE="

for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
for /f "delims=" %%e in ('powershell -NoProfile -Command "$s=[DateTime]::Parse('%BUILD_START_TIME%'); $e=[DateTime]::Parse('%BUILD_END_TIME%'); $d=$e-$s; $d.ToString('hh\:mm\:ss')"') do set "BUILD_ELAPSED=%%e"

echo.
if %EXIT_CODE% neq 0 (
    powershell -NoProfile -Command "Write-Host '========================================' -ForegroundColor Red; Write-Host '  [????] ????????????: %EXIT_CODE%' -ForegroundColor Red; Write-Host '  ????: %BUILD_ELAPSED%' -ForegroundColor Red; Write-Host '========================================' -ForegroundColor Red"
) else (
    powershell -NoProfile -Command "Write-Host '========================================' -ForegroundColor Yellow; Write-Host '  [???] ?????APP???????' -ForegroundColor Yellow; Write-Host '  [¦Ë??] APK ???: %~dp0??????-????????.apk' -ForegroundColor Yellow; Write-Host '  ???: %BUILD_START_TIME%' -ForegroundColor Yellow; Write-Host '  ????: %BUILD_END_TIME%' -ForegroundColor Yellow; Write-Host '  ????: %BUILD_ELAPSED%' -ForegroundColor Yellow; Write-Host '========================================' -ForegroundColor Yellow"
)
echo.
if not defined NO_PAUSE (
    set "EXIT_KEY="
    set /p "EXIT_KEY=?? 0 ?????????: "
)
exit /b %EXIT_CODE%
