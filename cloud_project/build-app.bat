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

cd /d "%ANDROID_DIR%"

echo [1/6] Checking environment...
REM P1-16: Check JDK/JAVA_HOME, required by Gradle build
if defined JAVA_HOME (
    if not exist "%JAVA_HOME%\bin\java.exe" (
        echo [ERROR] JAVA_HOME points to invalid path: %JAVA_HOME%
        if not defined NO_PAUSE pause
        exit /b 1
    )
    echo       JAVA_HOME: %JAVA_HOME%
) else (
    java -version >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Java not found. Please install JDK 17+ and set JAVA_HOME, or add java to PATH
        if not defined NO_PAUSE pause
        exit /b 1
    )
    echo       java OK ^(JAVA_HOME not set, using PATH^)
)
if not exist "gradlew.bat" (
    echo [ERROR] gradlew.bat not found
    echo   Path: %ANDROID_DIR%\gradlew.bat
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\signing.properties" (
    echo [ERROR] signing.properties not found
    echo   Path: %ANDROID_DIR%\app\signing.properties
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\app-release.jks" (
    echo [ERROR] app-release.jks not found
    echo   Path: %ANDROID_DIR%\app\app-release.jks
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\src\main\assets\capacitor.config.json" (
    echo [ERROR] Capacitor config not found
    echo   Path: %ANDROID_DIR%\app\src\main\assets\capacitor.config.json
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] Environment check passed
echo.

echo [1.5/6] Patching Capacitor Java version (21 -> 17)...
call node "%~dp0..\tools\patch-java-version.js" "%~dp0.."
if errorlevel 1 (
    echo [WARN] Java version patch had issues, continuing anyway
) else (
    echo [OK] Java version patched
)
echo.

echo [2/6] Syncing shared files...
set "SHARED_DIR=%~dp0..\shared"
set "ASSETS_PUBLIC=%ANDROID_DIR%\app\src\main\assets\public"
if exist "%SHARED_DIR%\auth-core.js" (
    copy /Y "%SHARED_DIR%\auth-core.js" "%ASSETS_PUBLIC%\auth-core.js" >nul
    echo [OK] auth-core.js synced
) else (
    echo [WARN] shared\auth-core.js not found
)
if exist "%SHARED_DIR%\permission.js" (
    copy /Y "%SHARED_DIR%\permission.js" "%ASSETS_PUBLIC%\permission.js" >nul
    echo [OK] permission.js synced
) else (
    echo [WARN] shared\permission.js not found
)
echo.

echo [2.5/6] Current configuration...
findstr "url" "app\src\main\assets\capacitor.config.json"
findstr "versionName" "app\build.gradle"
echo.

echo [2.6/6] Syncing APP version from index.html to MainActivity...
REM Read __APP_VERSION__ from cloud_desktop/index.html, inject into MainActivity.EXPECTED_APP_VERSION
REM Avoid cache clearing on every launch caused by MainActivity/index.html version mismatch
REM Use standalone .ps1 script to avoid cmd/PowerShell double-escape issues
set "CLOUD_DIR_TMP=%~dp0"
set "CLOUD_DIR_TMP=%CLOUD_DIR_TMP:~0,-1%"
set "ANDROID_DIR_TMP=%ANDROID_DIR%"
set "ANDROID_DIR_TMP=%ANDROID_DIR_TMP:~0,-1%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-app-version.ps1" "%CLOUD_DIR_TMP%" "%ANDROID_DIR%"
echo.

echo [2.7/6] Auto-incrementing versionCode...
REM Auto-increment versionCode in build.gradle to ensure monotonic increase per build
REM Avoid Android rejecting upgrade install due to duplicate versionCode
REM P1-12: Save old value to temp file before increment; rollback on build failure to avoid skipping numbers
powershell -NoProfile -ExecutionPolicy Bypass -Command "$g='%ANDROID_DIR%\app\build.gradle'; $c=Get-Content $g -Raw -Encoding UTF8; if($c -match 'versionCode\s+(\d+)'){ $old=[int]$matches[1]; $new=$old+1; $nc=$c -replace 'versionCode\s+\d+', \"versionCode $new\"; [System.IO.File]::WriteAllText($g,$nc,(New-Object System.Text.UTF8Encoding $false)); Set-Content -Path '%~dp0.build_vcode_prev' -Value $old -Encoding ASCII -NoNewline; Write-Host ('  [OK] versionCode: '+$old+' -> '+$new+' (prev saved)') } else { Write-Host '  [WARN] versionCode not found in build.gradle' }"
echo.

echo [3/6] Stopping residual Gradle processes...
REM P1-15: Only kill java processes with gradle window title (keep daemon alive for faster rebuild)
REM Do NOT call gradlew --stop (kills daemon, forces cold JVM start on next build)
taskkill /F /IM java.exe /FI "WINDOWTITLE eq gradle*" >nul 2>&1
echo [OK] Cleanup completed
echo.

echo [4/6] Cleaning build cache (force full clean)...
if defined TCM_GRADLE_SKIP_CLEAN (
    echo [SKIP] TCM_GRADLE_SKIP_CLEAN=1, skipping gradlew clean
    REM ★ 双保险：即使跳过 gradlew clean，也必须清理 javac 缓存
    REM 历史教训（2026-07-22）：跳过 clean 时若不清理 javac 缓存，MainActivity.java
    REM 修改会因 Gradle 增量构建使用旧缓存而未生效，导致 Autofill 修复失效。
    if exist "app\build\intermediates\javac" (
        rmdir /S /Q "app\build\intermediates\javac" 2>nul
        echo       [OK] cleaned javac cache (forced even in skip-clean mode)
    )
    REM ★ 清理 assets 缓存（对齐离线版，防止 index.html/JS 修改不生效）
    if exist "app\build\intermediates\assets" (
        rmdir /S /Q "app\build\intermediates\assets" 2>nul
        echo       [OK] cleaned assets cache
    )
    if exist "app\build\intermediates\merged_assets" (
        rmdir /S /Q "app\build\intermediates\merged_assets" 2>nul
        echo       [OK] cleaned merged_assets cache
    )
) else (
    if exist "app\build\intermediates\javac" (
        rmdir /S /Q "app\build\intermediates\javac" 2>nul
        echo       [OK] cleaned javac cache
    )
    REM ★ 清理 assets 缓存（对齐离线版，防止 index.html/JS 修改不生效）
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
        echo [WARN] clean failed, continuing with incremental build
    ) else (
        echo [OK] Old cache cleared
    )
)
echo.

echo [4.5/6] Obfuscating JavaScript (cloud target - includes cloud_app assets)...
REM P1: restore JS code after build
REM P1: Obfuscate JS to prevent reverse engineering of APK assets
call node "%~dp0..\tools\obfuscate.js" --target=cloud
if errorlevel 1 (
    echo [ERROR] JS obfuscation failed
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] JS obfuscation complete
echo.

echo [5/6] Building signed APK...
echo.
call gradlew.bat assembleRelease
if errorlevel 1 (
    echo.
    echo [ERROR] Build failed! Rolling back versionCode...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$g='%ANDROID_DIR%\app\build.gradle'; $prevFile='%~dp0.build_vcode_prev'; if(Test-Path $prevFile){ $prev=Get-Content $prevFile -Raw; $c=Get-Content $g -Raw -Encoding UTF8; $nc=$c -replace 'versionCode\s+\d+', \"versionCode $prev\"; [System.IO.File]::WriteAllText($g,$nc,(New-Object System.Text.UTF8Encoding $false)); Remove-Item $prevFile -Force; Write-Host ('  [OK] versionCode rolled back to '+$prev) } else { Write-Host '  [WARN] No prev versionCode to rollback' }"
    echo [WARN] Restoring JavaScript due to build failure...
    call node "%~dp0..\tools\obfuscate.js" restore --target=cloud
    echo [ERROR] Build failed! Please check error messages
    if not defined NO_PAUSE pause
    exit /b 1
)
REM P1-12: Clean up versionCode rollback temp file after successful build
if exist "%~dp0.build_vcode_prev" del "%~dp0.build_vcode_prev"
echo.

echo [5.5/6] Restoring JavaScript (cloud target)...
REM P1: restore JS code after build
call node "%~dp0..\tools\obfuscate.js" restore --target=cloud
if errorlevel 1 (
    echo [WARN] JS restore failed - may need manual restore: node tools\obfuscate.js restore --target=cloud
) else (
    echo [OK] JS restored to original state
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
    if not defined NO_PAUSE pause
    exit /b 1
)

for %%A in ("%APK_FILE%") do (
    echo APK File: %%~nxA
    echo File Size: %%~zA bytes
)

echo [6.5/6] Reading product name and version...
set "PRODUCT_NAME="
for /f "delims=" %%p in ('powershell -NoProfile -Command "(Get-Content '..\cloud_desktop\package.json' -Encoding UTF8 -Raw | ConvertFrom-Json).build.productName"') do (
    set "PRODUCT_NAME=%%p"
)
if "%PRODUCT_NAME%"=="" set "PRODUCT_NAME=惠康中医-云端"

set "VERSION_STR="
for /f "tokens=2 delims=:" %%v in ('findstr "versionName" "app\build.gradle"') do (
    set "VERSION_STR=%%v"
)
set "VERSION_STR=%VERSION_STR: =%"
set "VERSION_STR=%VERSION_STR:"=%"
if "%VERSION_STR%"=="" set "VERSION_STR=1.0"

set "FINAL_APK=%~dp0%PRODUCT_NAME%.apk"

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

echo [7/6] Auto-updating download page...
node "%~dp0..\tools\auto-update-downloads.js" cloud
if errorlevel 1 (
    echo [WARN] Download page auto-update had issues, continuing anyway
) else (
    echo [OK] Download page updated successfully
)
echo.

if not defined NO_PAUSE pause
exit /b 0
