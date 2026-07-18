@echo off
chcp 65001 >nul
title Huikang TCM Custom - Offline APP Build

echo ============================================
echo   Huikang TCM Custom - Offline APP
echo ============================================
echo.

cd /d "%~dp0"

echo [1/8] Configuring clinic info...
if /i "%1"=="--skip-config" (
    echo       [SKIP] --skip-config parameter detected
) else (
    powershell -ExecutionPolicy Bypass -File "edit-config.ps1"
    if errorlevel 1 (
        echo [ERROR] edit-config.ps1 failed, aborting
        pause
        exit /b 1
    )
)
echo.

echo [2/8] Synchronizing files to Android...
call "sync-to-app.bat"
if errorlevel 1 (
    echo [ERROR] sync-to-app.bat failed, aborting
    pause
    exit /b 1
)
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

echo [5.5/8] Auto-increment versionCode...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='app\build.gradle'; $c=[System.IO.File]::ReadAllText($f); if($c -match 'versionCode\s+(\d+)'){ $old=$matches[1]; $new=[int]$old+1; $c=$c -replace 'versionCode\s+\d+', ('versionCode '+$new); [System.IO.File]::WriteAllText($f,$c,(New-Object System.Text.UTF8Encoding($false))); Write-Host ('  versionCode: ' + $old + ' -> ' + $new) } else { Write-Host '  [WARN] versionCode not found, skip' }"
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

for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "(Get-Content '..\config.json' -Encoding UTF8 -Raw | ConvertFrom-Json).productName"`) do (
    set "PRODUCT_NAME=%%p"
)
if "%PRODUCT_NAME%"=="" set "PRODUCT_NAME=HuikangTCM-Custom"

REM 验证源 APK 文件大小（防止 Gradle 失败或文件未写入完成时复制空文件）
set "SRC_SIZE=0"
for %%A in ("%APK_FILE%") do set "SRC_SIZE=%%~zA"
if "%SRC_SIZE%"=="" set "SRC_SIZE=0"
if %SRC_SIZE% EQU 0 (
    echo [ERROR] Source APK is 0 bytes or not accessible!
    echo   Source: %CD%\%APK_FILE%
    echo   Gradle build may have failed. Please check build log above.
    pause
    exit /b 1
)
echo Source APK size: %SRC_SIZE% bytes

REM 用 PowerShell .NET File.Copy 可靠复制（支持中文文件名，带大小验证）
set "FINAL_APK=..\%PRODUCT_NAME%.apk"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $src='%APK_FILE%'; $dst='%FINAL_APK%'; $expected=%SRC_SIZE%; try { [System.IO.File]::Copy($src,$dst,$true); $actual=(New-Object System.IO.FileInfo $dst).Length; if($actual -ne $expected){ Write-Host ('[ERROR] Size mismatch: src='+$expected+' dst='+$actual); exit 1 }; Write-Host ('[OK] Copied '+$actual+' bytes to: '+$dst) } catch { Write-Host ('[ERROR] '+$_.Exception.Message); exit 1 }"
if errorlevel 1 (
    echo [WARN] Copy with productName failed, fallback to app-release.apk
    set "FINAL_APK=..\app-release.apk"
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $src='%APK_FILE%'; $dst='%FINAL_APK%'; $expected=%SRC_SIZE%; try { [System.IO.File]::Copy($src,$dst,$true); $actual=(New-Object System.IO.FileInfo $dst).Length; if($actual -ne $expected){ Write-Host ('[ERROR] Size mismatch: src='+$expected+' dst='+$actual); exit 1 }; Write-Host ('[OK] Copied '+$actual+' bytes to: '+$dst) } catch { Write-Host ('[ERROR] '+$_.Exception.Message); exit 1 }"
    if errorlevel 1 (
        echo [ERROR] Copy failed, please manually get APK from:
        echo   %CD%\%APK_DIR%
        pause
        exit /b 1
    )
)
echo.

echo ============================================
echo   Packing completed!
echo   APK Path: %CD%\%FINAL_APK%
echo   This APK is signed and ready for installation
echo ============================================
echo.
pause
