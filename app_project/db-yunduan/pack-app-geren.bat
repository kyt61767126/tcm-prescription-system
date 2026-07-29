@echo off
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

REM pack-app-geren.bat - Cloud Personal Edition APP Build (Android APK)
REM Personal edition: single admin user, no offline admin management
REM Package: com.tcm.prescription.geren
REM APP name: Huikang-TCM Cloud Personal
REM URL: https://tcm-prescription-system.pages.dev/?edition=personal

REM Record start time
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"

set "APP_DIR=%~dp0cloud_app_geren"
set "GRADLEW=%APP_DIR%\gradlew.bat"
set "APK_SRC=%APP_DIR%\app\build\outputs\apk\release\app-release.apk"
set "APK_DST=%~dp0惠康中医-云端个人版.apk"

echo ============================================
echo   Huikang-TCM Cloud Personal - APP Build
echo   Start: %BUILD_START_TIME%
echo ============================================
echo.

where java >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Java not found
    echo   Please install JDK 17+
    if not defined NO_PAUSE pause
    exit /b 1
)

REM Sync shared/ core files to db-yunduan/cloud_app_geren assets
set "SHARED_DIR=%~dp0..\..\shared"
set "PUBLIC_DIR=%APP_DIR%\app\src\main\assets\public"
if not exist "%PUBLIC_DIR%" mkdir "%PUBLIC_DIR%"

echo [1/4] Syncing core JS modules...
if exist "%SHARED_DIR%\auth-core.js" (
    copy /y "%SHARED_DIR%\auth-core.js" "%PUBLIC_DIR%\auth-core.js" >nul
    echo   [OK] auth-core.js
) else (
    echo   [WARN] auth-core.js not found
)
if exist "%SHARED_DIR%\permission.js" (
    copy /y "%SHARED_DIR%\permission.js" "%PUBLIC_DIR%\permission.js" >nul
    echo   [OK] permission.js
) else (
    echo   [WARN] permission.js not found
)
echo.

REM Build APK
echo [2/4] Building APK - personal edition com.tcm.prescription.geren...
cd /d "%APP_DIR%"
call "%GRADLEW%" assembleRelease --no-daemon
set "EXIT_CODE=%errorlevel%"
cd /d "%~dp0"

if %EXIT_CODE% neq 0 (
    echo.
    echo [ERROR] Build failed, exit code: %EXIT_CODE%
    if not defined NO_PAUSE pause
    exit /b %EXIT_CODE%
)

REM Copy and rename APK
echo.
echo [3/4] Copying APK...
if exist "%APK_SRC%" (
    copy /y "%APK_SRC%" "%APK_DST%" >nul
    echo   [OK] APK generated: %APK_DST%
) else (
    echo   [ERROR] APK file not found: %APK_SRC%
    if not defined NO_PAUSE pause
    exit /b 1
)

REM Auto-update download page
echo.
echo [4/4] Auto-updating download page...
node "%~dp0..\..\tools\auto-update-downloads.js" geren-cloud
if errorlevel 1 (
    echo [WARN] Download page auto-update geren-cloud had issues, continuing anyway
) else (
    echo [OK] Download page updated successfully - geren-cloud
)
echo.

for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
for /f "delims=" %%e in ('powershell -NoProfile -Command "$s=[DateTime]::Parse('%BUILD_START_TIME%'); $e=[DateTime]::Parse('%BUILD_END_TIME%'); $d=$e-$s; $d.ToString('hh\:mm\:ss')"') do set "BUILD_ELAPSED=%%e"
powershell -NoProfile -Command "Write-Host '========================================' -ForegroundColor Yellow; Write-Host '  [OK] Cloud Personal APP build complete!' -ForegroundColor Yellow; Write-Host '  APK: %APK_DST%' -ForegroundColor Yellow; Write-Host '  Start: %BUILD_START_TIME%' -ForegroundColor Yellow; Write-Host '  End: %BUILD_END_TIME%' -ForegroundColor Yellow; Write-Host '  Elapsed: %BUILD_ELAPSED%' -ForegroundColor Yellow; Write-Host '========================================' -ForegroundColor Yellow"
echo.
exit /b 0
