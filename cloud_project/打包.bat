@echo off
chcp 65001 >nul
title TCM Prescription System - Cloud APP Packager

echo ============================================
echo   TCM Prescription System - Cloud APP Packager
echo ============================================
echo.

set "PROJECT_DIR=%~dp0cloud_app"
set "ANDROID_DIR=%PROJECT_DIR%"
set "APK_OUTPUT_DIR=%ANDROID_DIR%\app\build\outputs\apk\release"
set "FINAL_APK=%~dp0TCM-Prescription-Cloud.apk"

cd /d "%ANDROID_DIR%"

echo [1/6] Checking environment...
if not exist "gradlew.bat" (
    echo [ERROR] gradlew.bat not found
    echo   Path: %ANDROID_DIR%\gradlew.bat
    pause
    exit /b 1
)
if not exist "app\signing.properties" (
    echo [ERROR] signing.properties not found
    echo   Path: %ANDROID_DIR%\app\signing.properties
    pause
    exit /b 1
)
if not exist "app\app-release.jks" (
    echo [ERROR] app-release.jks not found
    echo   Path: %ANDROID_DIR%\app\app-release.jks
    pause
    exit /b 1
)
if not exist "app\src\main\assets\capacitor.config.json" (
    echo [ERROR] Capacitor config not found
    echo   Path: %ANDROID_DIR%\app\src\main\assets\capacitor.config.json
    pause
    exit /b 1
)
echo [OK] Environment check passed
echo.

echo [2/6] Current configuration...
findstr "url" "app\src\main\assets\capacitor.config.json"
findstr "versionName" "app\build.gradle"
echo.

echo [3/6] Stopping residual Gradle processes...
taskkill /F /IM java.exe /FI "WINDOWTITLE eq gradle*" >nul 2>&1
echo [OK] Cleanup completed
echo.

echo [4/6] Cleaning build cache...
call gradlew.bat clean --no-daemon
if errorlevel 1 (
    echo [WARN] clean failed, continuing with incremental build
) else (
    echo [OK] Old cache cleared
)
echo.

echo [5/6] Building signed APK...
echo.
call gradlew.bat assembleRelease --no-daemon
if errorlevel 1 (
    echo.
    echo [ERROR] Build failed! Please check error messages
    pause
    exit /b 1
)
echo.

echo [6/6] Build successful, copying APK...
set "APK_FILE="
if exist "%APK_OUTPUT_DIR%\app-release.apk" (
    set "APK_FILE=%APK_OUTPUT_DIR%\app-release.apk"
) else (
    for %%f in ("%APK_OUTPUT_DIR%\*.apk") do (
        set "APK_FILE=%%f"
    )
)

if "%APK_FILE%"=="" (
    echo [ERROR] APK file not found
    echo   Search dir: %APK_OUTPUT_DIR%
    pause
    exit /b 1
)

for %%A in ("%APK_FILE%") do (
    echo APK File: %%~nxA
    echo File Size: %%~zA bytes
)

copy /Y "%APK_FILE%" "%FINAL_APK%" >nul
if errorlevel 1 (
    echo [WARN] Copy failed, please manually get APK from:
    echo   %APK_OUTPUT_DIR%
) else (
    echo [OK] Copied to: %FINAL_APK%
)

echo.
echo ============================================
echo   Packing completed!
echo   APK Path: %FINAL_APK%
echo   This APK is signed and ready for installation
echo ============================================
echo.
pause
