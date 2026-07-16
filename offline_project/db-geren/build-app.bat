@echo off
title Build APP - Personal Edition

echo ============================================
echo   Build APP - Personal Edition
echo ============================================
echo.

cd /d "%~dp0\android"

echo [1/5] Checking environment...
if not exist "gradlew.bat" (
    echo [ERROR] gradlew.bat not found
    pause
    exit /b 1
)
if not exist "app\signing.properties" (
    echo [ERROR] signing.properties not found
    pause
    exit /b 1
)
if not exist "app\app-release.jks" (
    echo [ERROR] app-release.jks not found
    pause
    exit /b 1
)
if not exist "app\src\main\assets\public\index.html" (
    echo [ERROR] index.html not found
    pause
    exit /b 1
)
echo [OK] Environment check passed
echo.

echo [1.5/5] Stopping Gradle processes...
taskkill /F /IM java.exe /FI "WINDOWTITLE eq gradle*" >nul 2>&1
echo [OK] Cleanup done
echo.

echo [2/5] Cleaning build cache...
call gradlew.bat clean --no-daemon
if errorlevel 1 (
    echo [WARN] Clean failed, continuing with incremental build
) else (
    echo [OK] Cache cleaned
)
echo.

echo [3/5] Building signed APK...
echo.
call gradlew.bat assembleRelease --no-daemon
if errorlevel 1 (
    echo.
    echo [ERROR] Build failed! Please check error messages
    pause
    exit /b 1
)
echo.
echo [4/5] Build successful, locating APK...
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
    pause
    exit /b 1
)

for %%A in ("%APK_FILE%") do (
    echo APK File: %%~nxA
    echo File Size: %%~zA bytes
    echo Full Path: %CD%\%%A
)
echo.

echo [5/5] Copying APK to output directory...
set "FINAL_APK=..\app-personal-v1.0.apk"
copy /Y "%APK_FILE%" "%FINAL_APK%" >nul
if errorlevel 1 (
    echo [WARN] Copy failed, please manually get APK from %APK_DIR%
) else (
    echo [OK] Copied to: %CD%\%FINAL_APK%
)
echo.
echo ============================================
echo   Build Complete!
echo   APK Path: %CD%\%FINAL_APK%
echo   APK is signed, ready for installation
echo ============================================
echo.
pause