@echo off
chcp 65001 >nul
REM P0: Auto-fix .ps1 BOM encoding before packaging
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\fix-ps1-bom.ps1" >nul 2>&1
title TCM Prescription System - Cloud APP Packager

REM Record start time for elapsed calculation
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"

echo ============================================
echo   TCM Prescription System - Cloud APP Packager
echo   开始: %BUILD_START_TIME%
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

echo [1.5/6] Patching Capacitor Java version (21 to 17)...
call node "%~dp0..\..\tools\patch-java-version.js" "%~dp0..\.."
if errorlevel 1 (
    echo [WARN] Java version patch had issues, continuing anyway
) else (
    echo [OK] Java version patched
)
echo.

echo [2/6] Syncing shared files...
set "SHARED_DIR=%~dp0..\..\shared"
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

REM P1: Cloud APP loads index.html from URL, no sync hash check needed

echo [2.5/6] Current configuration...
findstr "url" "app\src\main\assets\capacitor.config.json"
findstr "versionName" "app\build.gradle"
echo.

echo [2.6/6] Syncing APP version from index.html to MainActivity...
REM Read __APP_VERSION__ from cloud_desktop/index.html, inject into MainActivity.EXPECTED_APP_VERSION
REM Avoid cache clearing on every launch caused by MainActivity/index.html version mismatch
REM sync-app-version.ps1 自动同步 cloud_app 和 cloud_app_geren 两个 APP
set "CLOUD_DIR_TMP=%~dp0"
set "CLOUD_DIR_TMP=%CLOUD_DIR_TMP:~0,-1%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-app-version.ps1" "%CLOUD_DIR_TMP%"
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
REM P2-3: 废弃 TCM_GRADLE_SKIP_CLEAN，强制执行 gradlew clean（与离线版 build-app.bat 一致）
REM Historical lesson (2026-07-22): javac cache must be cleaned to ensure MainActivity.java changes take effect
REM Historical lesson (2026-07-23): assets/merged_assets cache must be cleaned to ensure index.html changes take effect
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
echo.

echo [4.5/6] Obfuscating JavaScript (cloud target - includes cloud_app assets)...
REM P1: restore JS code after build
REM P1: Obfuscate JS to prevent reverse engineering of APK assets
call node "%~dp0..\..\tools\obfuscate.js" --target=cloud
if errorlevel 1 (
    echo [ERROR] JS obfuscation failed
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] JS obfuscation complete
echo.

echo [4.6/6] Java pre-compile check...
REM Pre-compile check: catch Java errors early before full APK build
call gradlew.bat compileReleaseJavaWithJavac --quiet
if errorlevel 1 (
    echo [ERROR] Java pre-compile check failed
    echo [WARN] Restoring JavaScript due to pre-compile failure...
    call node "%~dp0..\..\tools\obfuscate.js" restore --target=cloud
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] Java pre-compile check passed
echo.

echo [5/6] Building signed APK...
echo.
call gradlew.bat assembleRelease
if errorlevel 1 (
    echo.
    echo [ERROR] Build failed! Rolling back versionCode...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$g='%ANDROID_DIR%\app\build.gradle'; $prevFile='%~dp0.build_vcode_prev'; if(Test-Path $prevFile){ $prev=Get-Content $prevFile -Raw; $c=Get-Content $g -Raw -Encoding UTF8; $nc=$c -replace 'versionCode\s+\d+', \"versionCode $prev\"; [System.IO.File]::WriteAllText($g,$nc,(New-Object System.Text.UTF8Encoding $false)); Remove-Item $prevFile -Force; Write-Host ('  [OK] versionCode rolled back to '+$prev) } else { Write-Host '  [WARN] No prev versionCode to rollback' }"
    echo [WARN] Restoring JavaScript due to build failure...
    call node "%~dp0..\..\tools\obfuscate.js" restore --target=cloud
    echo [ERROR] Build failed! Please check error messages
    if not defined NO_PAUSE pause
    exit /b 1
)
REM P1-12: Clean up versionCode rollback temp file after successful build
if exist "%~dp0.build_vcode_prev" del "%~dp0.build_vcode_prev"
echo.

echo [5.5/6] Restoring JavaScript (cloud target)...
REM P1: restore JS code after build
call node "%~dp0..\..\tools\obfuscate.js" restore --target=cloud
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

echo [6.2/6] Verifying APK contains latest index.html...
REM P3: Extract index.html from APK and verify it exists and has reasonable size
powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; try { $zip=[System.IO.Compression.ZipFile]::OpenRead('%APK_FILE%'); $entry=$zip.GetEntry('assets/public/index.html'); if($entry){ $sz=$entry.Length; if($sz -lt 1000){ Write-Host '[ERROR] APK index.html too small:' $sz 'bytes'; exit 1 }; $reader=New-Object System.IO.StreamReader($entry.Open()); $content=$reader.ReadToEnd(); $reader.Close(); $hash=(Get-FileHash -InputStream ([System.IO.MemoryStream]::new([System.Text.Encoding]::UTF8.GetBytes($content))) -Algorithm SHA256).Hash; Write-Host '[OK] APK index.html:' $sz 'bytes SHA256:' $hash.Substring(0,16) } else { Write-Host '[ERROR] index.html not found in APK'; exit 1 }; $zip.Dispose() } catch { Write-Host '[ERROR] APK verify failed:' $_.Exception.Message; exit 1 }"
if errorlevel 1 (
    echo [ERROR] APK content verification failed! APK may not contain latest code.
    if not defined NO_PAUSE pause
    exit /b 1
)
echo.

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
node "%~dp0..\..\tools\auto-update-downloads.js" cloud
if errorlevel 1 (
    echo [WARN] Download page auto-update had issues, continuing anyway
) else (
    echo [OK] Download page updated successfully - cloud
)
echo.

echo [7.5/6] Auto-updating download page (geren-cloud)...
node "%~dp0..\..\tools\auto-update-downloads.js" geren-cloud
if errorlevel 1 (
    echo [WARN] Download page auto-update geren-cloud had issues, continuing anyway
) else (
    echo [OK] Download page updated successfully geren-cloud
)
echo.

for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
for /f "delims=" %%e in ('powershell -NoProfile -Command "$s=[DateTime]::Parse('%BUILD_START_TIME%'); $e=[DateTime]::Parse('%BUILD_END_TIME%'); $d=$e-$s; $d.ToString('hh\:mm\:ss')"') do set "BUILD_ELAPSED=%%e"
powershell -NoProfile -Command "Write-Host '============================================' -ForegroundColor Yellow; Write-Host '  APK 打包完成!' -ForegroundColor Yellow; Write-Host '  路径: %FINAL_APK%' -ForegroundColor Yellow; Write-Host '  开始: %BUILD_START_TIME%' -ForegroundColor Yellow; Write-Host '  结束: %BUILD_END_TIME%' -ForegroundColor Yellow; Write-Host '  总耗时: %BUILD_ELAPSED%' -ForegroundColor Yellow; Write-Host '============================================' -ForegroundColor Yellow"
if not defined NO_PAUSE (
    set "EXIT_KEY="
    set /p "EXIT_KEY=按 0 或回车键退出: "
)
exit /b 0
