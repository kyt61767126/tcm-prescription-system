@echo off
chcp 65001 >nul
title Sync to APP - Local Edition
setlocal

set "SRC=%~dp0"
set "ANDROID_PUBLIC=%~dp0android\app\src\main\assets\public"
set "ANDROID_ASSETS=%~dp0android\app\src\main\assets"

echo.
echo ================================================================
echo  Sync to APP - Local Edition
echo ================================================================
echo  Source: %SRC%
echo  Android Target: %ANDROID_PUBLIC%
echo.

if not exist "%ANDROID_PUBLIC%" (
    echo [WARN] Android target directory not found: %ANDROID_PUBLIC%
    echo        Android packaging may not be supported, skip sync
    pause
    exit /b 0
)

echo [1/5] Syncing config.json ...
if exist "%SRC%config.json" (
    copy /Y "%SRC%config.json" "%ANDROID_PUBLIC%\config.json" >nul
    if errorlevel 1 (
        echo [WARN] Failed to sync config.json
    ) else (
        echo       config.json synced
    )
) else (
    echo [SKIP] config.json not found
)

echo [2/5] Syncing index.html ...
copy /Y "%SRC%index.html" "%ANDROID_PUBLIC%\index.html" >nul
if errorlevel 1 (
    echo [ERROR] Failed to sync index.html
    pause
    exit /b 1
)
echo       index.html synced

echo [3/5] Syncing vendor/xlsx.full.min.js ...
if exist "%SRC%vendor\xlsx.full.min.js" (
    if not exist "%ANDROID_PUBLIC%\vendor" mkdir "%ANDROID_PUBLIC%\vendor" >nul
    copy /Y "%SRC%vendor\xlsx.full.min.js" "%ANDROID_PUBLIC%\vendor\xlsx.full.min.js" >nul
    if errorlevel 1 (
        echo [WARN] Failed to sync xlsx.full.min.js, continue
    ) else (
        echo       xlsx.full.min.js synced
    )
) else (
    echo [SKIP] vendor/xlsx.full.min.js not found
)

echo [4/5] Syncing core JS modules...
set "MODULES=auth-core.js db-adapter.js debug-logger.js medicine-dict.js patient-archive.js performance-utils.js permission.js prescription-core.js print-utils.js"
for %%m in (%MODULES%) do (
    if exist "%SRC%%%m" (
        copy /Y "%SRC%%%m" "%ANDROID_PUBLIC%\%%m" >nul
        if errorlevel 1 (
            echo [WARN] Failed to sync %%m, continue
        ) else (
            echo       %%m synced
        )
    ) else (
        echo [SKIP] %%m not found
    )
)

echo [5/5] Syncing video-recorder-inject.js ...
if exist "%SRC%video-recorder-inject.js" (
    copy /Y "%SRC%video-recorder-inject.js" "%ANDROID_ASSETS%\video-recorder-inject.js" >nul
    if errorlevel 1 (
        echo [WARN] Failed to sync video-recorder-inject.js
    ) else (
        echo       video-recorder-inject.js synced
    )
) else (
    echo [SKIP] video-recorder-inject.js not found in source
)

echo.
echo ================================================================
echo  Sync completed
echo ================================================================
echo.
echo  Next Steps:
echo   - Run build-app.bat to build APK
echo   - Or run gradlew assembleRelease in android directory
echo.
pause
