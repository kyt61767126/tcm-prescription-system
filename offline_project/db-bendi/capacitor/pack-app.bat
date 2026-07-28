@echo off
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

REM pack-app.bat - Capacitor APP Quick Build (Android APK)
REM Quick build: direct gradlew assembleRelease, no cache clean

echo ============================================
echo   Huikang-TCM Local - Capacitor APP Build
echo ============================================
echo.

if not exist "gradlew.bat" (
    echo [ERROR] gradlew.bat not found
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\signing.properties" (
    echo [ERROR] signing.properties not found
    if not defined NO_PAUSE pause
    exit /b 1
)

echo [1/3] Building Release APK (quick mode)...
call gradlew.bat assembleRelease
if errorlevel 1 (
    echo [ERROR] Build failed
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] Build successful
echo.

echo [2/3] Locating APK...
set "APK_FILE="
for %%f in (app\build\outputs\apk\release\*.apk) do set "APK_FILE=%%f"
if "%APK_FILE%"=="" (
    echo [ERROR] APK not found
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] Found: %APK_FILE%
echo.

echo [3/3] Copying to output...
set "FINAL_APK=惠康中医-本地-Capacitor.apk"
copy "%APK_FILE%" "%FINAL_APK%" /y >nul
for %%A in ("%FINAL_APK%") do echo Size: %%~zA bytes
echo.

echo ============================================
echo   [OK] APP build complete!
echo   APK: %CD%\%FINAL_APK%
echo ============================================
echo.
if not defined NO_PAUSE pause
exit /b 0
