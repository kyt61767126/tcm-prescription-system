@echo off
chcp 65001 >nul
title Huikang TCM Local - Offline APP Build

echo ============================================
echo   Huikang TCM Local - Offline APP
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
        if not defined NO_PAUSE pause
        exit /b 1
    )
)
echo.

echo [2/8] Synchronizing files to Android...
set "ANDROID_PUBLIC=%~dp0android\app\src\main\assets\public"
set "ANDROID_ASSETS=%~dp0android\app\src\main\assets"
if not exist "%ANDROID_PUBLIC%" (
    echo [ERROR] Android target directory not found: %ANDROID_PUBLIC%
    if not defined NO_PAUSE pause
    exit /b 1
)
echo   [1/5] Syncing config.json...
if exist "config.json" (
    copy /Y "config.json" "%ANDROID_PUBLIC%\config.json" >nul
    if errorlevel 1 ( echo [WARN] Failed to sync config.json ) else ( echo       config.json synced )
) else ( echo [SKIP] config.json not found )
echo   [2/5] Syncing index.html...
copy /Y "index.html" "%ANDROID_PUBLIC%\index.html" >nul
if errorlevel 1 (
    echo [ERROR] Failed to sync index.html
    if not defined NO_PAUSE pause
    exit /b 1
)
echo       index.html synced
echo   [3/5] Syncing vendor/xlsx.full.min.js...
if exist "vendor\xlsx.full.min.js" (
    if not exist "%ANDROID_PUBLIC%\vendor" mkdir "%ANDROID_PUBLIC%\vendor" >nul
    copy /Y "vendor\xlsx.full.min.js" "%ANDROID_PUBLIC%\vendor\xlsx.full.min.js" >nul
    if errorlevel 1 ( echo [WARN] Failed to sync xlsx.full.min.js ) else ( echo       xlsx.full.min.js synced )
) else ( echo [SKIP] vendor/xlsx.full.min.js not found )
echo   [4/5] Syncing core JS modules...
set "MODULES=auth-core.js db-adapter.js debug-logger.js medicine-dict.js patient-archive.js performance-utils.js permission.js prescription-core.js print-utils.js"
for %%m in (%MODULES%) do (
    if exist "%%m" (
        copy /Y "%%m" "%ANDROID_PUBLIC%\%%m" >nul
        if errorlevel 1 ( echo [WARN] Failed to sync %%m ) else ( echo       %%m synced )
    ) else ( echo [SKIP] %%m not found )
)
echo   [5/5] Syncing video-recorder-inject.js...
if exist "video-recorder-inject.js" (
    copy /Y "video-recorder-inject.js" "%ANDROID_ASSETS%\video-recorder-inject.js" >nul
    if errorlevel 1 ( echo [WARN] Failed to sync video-recorder-inject.js ) else ( echo       video-recorder-inject.js synced )
) else ( echo [SKIP] video-recorder-inject.js not found )
echo.

cd /d "%~dp0\android"

echo [3/8] Checking environment...
if not exist "gradlew.bat" (
    echo [ERROR] gradlew.bat not found
    echo   Path: %CD%\gradlew.bat
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\signing.properties" (
    echo [ERROR] signing.properties not found
    echo   Path: %CD%\app\signing.properties
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\app-release.jks" (
    echo [ERROR] app-release.jks not found
    echo   Path: %CD%\app\app-release.jks
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\src\main\assets\public\index.html" (
    echo [ERROR] index.html not found
    echo   Path: %CD%\app\src\main\assets\public\index.html
    if not defined NO_PAUSE pause
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

echo [3.6/8] Patching Capacitor Java version (21 -> 17)...
call node "%~dp0..\..\tools\patch-java-version.js" "%~dp0..\.."
if errorlevel 1 (
    echo [WARN] Java version patch had issues, continuing anyway
) else (
    echo [OK] Java version patched
)
echo.
echo.

echo [3.5/8] Current configuration...
findstr "versionName" "app\build.gradle"
echo.

echo [4/8] Stopping residual Gradle processes...
taskkill /F /IM java.exe /FI "WINDOWTITLE eq gradle*" >nul 2>&1
echo [OK] Cleanup completed
echo.

echo [5/8] Cleaning build cache (force full clean)...
if defined TCM_GRADLE_SKIP_CLEAN (
    echo [SKIP] TCM_GRADLE_SKIP_CLEAN=1, skipping gradlew clean (debug only)
    REM ★ 双保险：即使跳过 gradlew clean，也必须清理 javac 和 assets 缓存
    REM 历史教训（2026-07-22）：跳过 clean 时若不清理 javac 缓存，MainActivity.java
    REM 修改会因 Gradle 增量构建使用旧缓存而未生效，导致 Autofill 修复失效。
    REM 历史教训（2026-07-23）：不清理 assets/merged_assets 缓存，index.html
    REM 修改会因 Gradle 增量构建使用旧缓存而未生效，导致旧版本页面内容闪动。
    if exist "app\build\intermediates\javac" (
        rmdir /S /Q "app\build\intermediates\javac" 2>nul
        echo       [OK] cleaned javac cache (forced even in skip-clean mode)
    )
    if exist "app\build\intermediates\assets" (
        rmdir /S /Q "app\build\intermediates\assets" 2>nul
        echo       [OK] cleaned assets cache (forced even in skip-clean mode)
    )
    if exist "app\build\intermediates\merged_assets" (
        rmdir /S /Q "app\build\intermediates\merged_assets" 2>nul
        echo       [OK] cleaned merged_assets cache (forced even in skip-clean mode)
    )
) else (
    if exist "app\build\intermediates\javac" (
        rmdir /S /Q "app\build\intermediates\javac" 2>nul
        echo       [OK] cleaned javac cache
    )
    if exist "app\build\intermediates\assets" (
        rmdir /S /Q "app\build\intermediates\assets" 2>nul
        echo       [OK] cleaned assets cache
    )
    if exist "app\build\intermediates\merged_assets" (
        rmdir /S /Q "app\build\intermediates\merged_assets" 2>nul
        echo       [OK] cleaned merged_assets cache
    )
    call gradlew.bat clean
    if errorlevel 1 (
        echo [WARN] Clean failed, continuing with incremental build
    ) else (
        echo [OK] Old cache cleared
    )
)
echo.

echo [5.5/8] Auto-increment versionCode...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='app\build.gradle'; $c=[System.IO.File]::ReadAllText($f); if($c -match 'versionCode\s+(\d+)'){ $old=$matches[1]; $new=[int]$old+1; $c=$c -replace 'versionCode\s+\d+', ('versionCode '+$new); [System.IO.File]::WriteAllText($f,$c,(New-Object System.Text.UTF8Encoding($false))); Write-Host ('  versionCode: ' + $old + ' -> ' + $new) } else { Write-Host '  [WARN] versionCode not found, skip' }"
echo.

echo [5.6/8] Obfuscating JavaScript (target=bendi)...
call node "%~dp0..\..\tools\obfuscate.js" --target=bendi
if errorlevel 1 (
    echo [ERROR] JS obfuscation failed
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] JS obfuscation complete
echo.

echo [6/8] Building signed APK...
echo.
call gradlew.bat assembleRelease
if errorlevel 1 (
    echo.
    echo [WARN] Restoring JavaScript due to build failure...
    call node "%~dp0..\..\tools\obfuscate.js" restore --target=bendi
    echo [ERROR] Build failed! Please check error messages
    if not defined NO_PAUSE pause
    exit /b 1
)
echo.

echo [6.5/8] Restoring JavaScript...
call node "%~dp0..\..\tools\obfuscate.js" restore --target=bendi
if errorlevel 1 (
    echo [WARN] JS restore failed - may need manual restore
) else (
    echo [OK] JS restored to original state
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
    if not defined NO_PAUSE pause
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
if "%PRODUCT_NAME%"==" set "PRODUCT_NAME=惠康中医-本地"

REM Verify source APK size (prevent copying empty file when Gradle fails or write incomplete)
set "SRC_SIZE=0"
for %%A in ("%APK_FILE%") do set "SRC_SIZE=%%~zA"
if "%SRC_SIZE%"=="" set "SRC_SIZE=0"
if %SRC_SIZE% EQU 0 (
    echo [ERROR] Source APK is 0 bytes or not accessible!
    echo   Source: %CD%\%APK_FILE%
    echo   Gradle build may have failed. Please check build log above.
    if not defined NO_PAUSE pause
    exit /b 1
)
echo Source APK size: %SRC_SIZE% bytes

REM Use PowerShell .NET File.Copy for reliable copy (supports unicode names, with size verification)
set "FINAL_APK=..\%PRODUCT_NAME%.apk"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $src='%APK_FILE%'; $dst='%FINAL_APK%'; $expected=%SRC_SIZE%; try { [System.IO.File]::Copy($src,$dst,$true); $actual=(New-Object System.IO.FileInfo $dst).Length; if($actual -ne $expected){ Write-Host ('[ERROR] Size mismatch: src='+$expected+' dst='+$actual); exit 1 }; Write-Host ('[OK] Copied '+$actual+' bytes to: '+$dst) } catch { Write-Host ('[ERROR] '+$_.Exception.Message); exit 1 }"
if errorlevel 1 (
    echo [WARN] Copy with productName failed, fallback to app-release.apk
    set "FINAL_APK=..\app-release.apk"
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $src='%APK_FILE%'; $dst='%FINAL_APK%'; $expected=%SRC_SIZE%; try { [System.IO.File]::Copy($src,$dst,$true); $actual=(New-Object System.IO.FileInfo $dst).Length; if($actual -ne $expected){ Write-Host ('[ERROR] Size mismatch: src='+$expected+' dst='+$actual); exit 1 }; Write-Host ('[OK] Copied '+$actual+' bytes to: '+$dst) } catch { Write-Host ('[ERROR] '+$_.Exception.Message); exit 1 }"
    if errorlevel 1 (
        echo [ERROR] Copy failed, please manually get APK from:
        echo   %CD%\%APK_DIR%
        if not defined NO_PAUSE pause
        exit /b 1
    )
)
echo.

REM Get absolute path of APK file (for display)
for %%F in ("%FINAL_APK%") do set "APK_FULL_PATH=%%~fF"

echo ============================================
echo   Packing completed!
echo   APK Path: %APK_FULL_PATH%
echo   This APK is signed and ready for installation
echo ============================================
echo.
if not defined NO_PAUSE pause
exit /b 0
