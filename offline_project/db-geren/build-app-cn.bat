@echo off
title Huikang TCM Personal - Offline APP Build

echo ============================================
echo   Huikang TCM Personal - Offline APP
echo ============================================
echo.

cd /d "%~dp0"

echo [1/8] Configuring clinic info...
if /i "%1"=="--skip-config" (
    echo       [SKIP] --skip-config parameter detected
) else (
    powershell -ExecutionPolicy Bypass -File "edit-config.ps1"
)
echo.

echo [2/8] Synchronizing files to Android...
call "sync-to-app.bat"
echo.

cd /d "%~dp0\android"

echo [3/8] Checking environment...
if not exist "gradlew.bat" (
    echo [ERROR] gradlew.bat not found
    echo   Path: %CD%\gradlew.bat
    pause
    exit /b 1
)
if not exist "app\signing.properties" (
    echo [ERROR] signing.properties not found
    echo   Path: %CD%\app\signing.properties
    pause
    exit /b 1
)
if not exist "app\app-release.jks" (
    echo [ERROR] app-release.jks not found
    echo   Path: %CD%\app\app-release.jks
    pause
    exit /b 1
)
if not exist "app\src\main\assets\public\index.html" (
    echo [ERROR] index.html not found
    echo   Path: %CD%\app\src\main\assets\public\index.html
    pause
    exit /b 1
)
if not exist "app\src\main\assets\video-recorder-inject.js" (
    echo [WARN] video-recorder-inject.js not found
    echo   Path: %CD%\app\src\main\assets\video-recorder-inject.js
) else (
    echo       video-recorder-inject.js OK
)
echo [OK] Environment check passed
echo.

echo [3.5/8] Current configuration...
findstr "versionName" "app\build.gradle"
echo.

echo [4/8] Stopping residual Gradle processes...
taskkill /F /IM java.exe /FI "WINDOWTITLE eq gradle*" >nul 2>&1
echo [OK] Cleanup completed
echo.

echo [5/8] Cleaning build cache...
call gradlew.bat clean --no-daemon
if errorlevel 1 (
    echo [WARN] Clean failed, continuing with incremental build
) else (
    echo [OK] Old cache cleared
)
echo.

echo [6/8] Building signed APK...
echo.
call gradlew.bat assembleRelease --no-daemon
if errorlevel 1 (
    echo.
    echo [ERROR] Build failed! Please check error messages
    pause
    exit /b 1
)
echo.

echo [7/8] Build successful, locating APK...
echo.

set "APK_DIR=app\build\outputs\apk\release"
set "APK_FILE="
if exist "%APK_DIR%\app-release.apk" (
    set "APK_FILE=%APK_DIR%\app-release.apk"
) else (
    for %%f in ("%APK_DIR%\*.apk") do (
        set "APK_FILE=%%f"
    )
)

if "%APK_FILE%"=="" (
    echo [ERROR] APK file not found
    echo   Search dir: %CD%\%APK_DIR%
    pause
    exit /b 1
)

for %%A in ("%APK_FILE%") do (
    echo APK File: %%~nxA
    echo File Size: %%~zA bytes
    echo Full Path: %CD%\%%A
)
echo.

echo [8/8] Copying APK to output directory...
set "VERSION_STR="
for /f "tokens=2 delims=:" %%v in ('findstr "versionName" "app\build.gradle"') do (
    set "VERSION_STR=%%v"
)
set "VERSION_STR=%VERSION_STR: =%"
set "VERSION_STR=%VERSION_STR:"=%"
if "%VERSION_STR%"=="" set "VERSION_STR=1.0"

set "PRODUCT_NAME="
for /f "delims=" %%p in ('powershell -NoProfile -Command "(Get-Content '..\config.json' -Encoding UTF8 -Raw | ConvertFrom-Json).productName"') do (
    set "PRODUCT_NAME=%%p"
)
if "%PRODUCT_NAME%"=="" set "PRODUCT_NAME=HuikangTCM-Personal"
set "FINAL_APK=..\%PRODUCT_NAME%-v%VERSION_STR%.apk"

copy /Y "%APK_FILE%" "%FINAL_APK%" >nul
if errorlevel 1 (
    echo [WARN] Copy failed, please manually get APK from:
    echo   %CD%\%APK_DIR%
) else (
    echo [OK] Copied to: %CD%\%FINAL_APK%
)
echo.

echo ============================================
echo   Packing completed!
echo   APK Path: %CD%\%FINAL_APK%
echo   This APK is signed and ready for installation
echo ============================================
echo.
pause
