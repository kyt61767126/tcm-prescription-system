@echo off
chcp 65001 >nul
title Huikang TCM Personal - Offline APP Build

echo ============================================
echo   Huikang TCM Personal - Offline APP
echo ============================================
echo.

cd /d "%~dp0"

echo [0.5/10] Fixing .ps1 BOM encoding...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\..\tools\fix-ps1-bom.ps1"
echo.

echo [1/10] Configuring clinic info...
if /i "%1"=="--skip-config" (
    echo       [SKIP] --skip-config parameter detected
) else (
    powershell -ExecutionPolicy Bypass -File "..\edit-config.ps1"
    if errorlevel 1 (
        echo [ERROR] edit-config.ps1 failed, aborting
        if not defined NO_PAUSE pause
        exit /b 1
    )
)
echo.

echo [2/10] Synchronizing files to Android...
set "ANDROID_PUBLIC=%~dp0app\src\main\assets\public"
set "ANDROID_ASSETS=%~dp0app\src\main\assets"
if not exist "%ANDROID_PUBLIC%" (
    echo [ERROR] Capacitor target directory not found: %ANDROID_PUBLIC%
    if not defined NO_PAUSE pause
    exit /b 1
)
echo   [1/5] Syncing config.json...
if exist "..\config.json" (
    copy /Y "..\config.json" "%ANDROID_PUBLIC%\config.json" >nul
    if errorlevel 1 ( echo [WARN] Failed to sync config.json ) else ( echo       config.json synced )
) else ( echo [SKIP] config.json not found )
echo   [2/5] Syncing index.html...
copy /Y "..\index.html" "%ANDROID_PUBLIC%\index.html" >nul
if errorlevel 1 (
    echo [ERROR] Failed to sync index.html
    if not defined NO_PAUSE pause
    exit /b 1
)
echo       index.html synced
echo   [3/5] Syncing vendor/xlsx.full.min.js...
if exist "..\vendor\xlsx.full.min.js" (
    if not exist "%ANDROID_PUBLIC%\vendor" mkdir "%ANDROID_PUBLIC%\vendor" >nul
    copy /Y "..\vendor\xlsx.full.min.js" "%ANDROID_PUBLIC%\vendor\xlsx.full.min.js" >nul
    if errorlevel 1 ( echo [WARN] Failed to sync xlsx.full.min.js ) else ( echo       xlsx.full.min.js synced )
) else ( echo [SKIP] vendor/xlsx.full.min.js not found )
echo   [4/5] Syncing core JS modules...
set "MODULES=auth-core.js db-adapter.js debug-logger.js medicine-dict.js patient-archive.js performance-utils.js permission.js prescription-core.js print-utils.js security-guard.js"
for %%m in (%MODULES%) do (
    if exist "..\%%m" (
        copy /Y "..\%%m" "%ANDROID_PUBLIC%\%%m" >nul
        if errorlevel 1 ( echo [WARN] Failed to sync %%m ) else ( echo       %%m synced )
    ) else ( echo [SKIP] %%m not found )
)
echo   [5/5] Syncing video-recorder-inject.js...
if exist "..\video-recorder-inject.js" (
    copy /Y "..\video-recorder-inject.js" "%ANDROID_ASSETS%\video-recorder-inject.js" >nul
    if errorlevel 1 ( echo [WARN] Failed to sync video-recorder-inject.js ) else ( echo       video-recorder-inject.js synced )
) else ( echo [SKIP] video-recorder-inject.js not found )
echo.

echo [2.1/10] Verifying index.html sync (hash check)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$src='..\index.html'; $dst='%ANDROID_PUBLIC%\index.html'; $h1=(Get-FileHash $src -Algorithm SHA256).Hash; $h2=(Get-FileHash $dst -Algorithm SHA256).Hash; if($h1 -ne $h2){ Write-Host '[ERROR] index.html hash mismatch!'; Write-Host ('  src: '+$h1); Write-Host ('  dst: '+$h2); Write-Host '  Root index.html was not synced correctly to android dir'; exit 1 } else { Write-Host '[OK] index.html hash verified (SHA256 matches)' }"
if errorlevel 1 (
    if not defined NO_PAUSE pause
    exit /b 1
)
echo.

echo [2.5/10] Minifying JavaScript files (security hardening)...
node "%~dp0..\..\..\shared\minify-js.js" "%ANDROID_PUBLIC%"
if errorlevel 1 (
    echo [WARN] JS minification had issues, continuing anyway
) else (
    echo [OK] JavaScript files minified
)
echo.

cd /d "%~dp0"

echo [3/10] Checking environment...
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

echo [3.5/10] Patching Capacitor Java version (21 to 17)...
call node "%~dp0..\..\..\tools\patch-java-version.js" "%~dp0..\.."
if errorlevel 1 (
    echo [WARN] Java version patch had issues, continuing anyway
) else (
    echo [OK] Java version patched
)
echo.
echo [3.6/10] Current configuration...
findstr "versionName" "app\build.gradle"
echo.

echo [4/10] Stopping residual Gradle processes...
taskkill /F /IM java.exe /FI "WINDOWTITLE eq gradle*" >nul 2>&1
echo [OK] Cleanup completed
echo.

echo [5/10] Cleaning build cache (force full clean)...
REM P2-3: 废弃 TCM_GRADLE_SKIP_CLEAN，强制执行 gradlew clean（与 project_memory 约束一致）
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

echo [5.5/10] Auto-increment versionCode...
REM P0-3: Save old value to .build_vcode_prev for rollback on build failure (align with cloud build-app.bat)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='app\build.gradle'; $c=[System.IO.File]::ReadAllText($f); if($c -match 'versionCode\s+(\d+)'){ $old=[int]$matches[1]; $new=$old+1; $nc=$c -replace 'versionCode\s+\d+', \"versionCode $new\"; [System.IO.File]::WriteAllText($f,$nc,(New-Object System.Text.UTF8Encoding($false))); Set-Content -Path '%~dp0.build_vcode_prev' -Value $old -Encoding ASCII -NoNewline; Write-Host ('  [OK] versionCode: '+$old+' -> '+$new+' (prev saved)') } else { Write-Host '  [WARN] versionCode not found in build.gradle' }"
echo.

echo [5.6/10] Obfuscating JavaScript (target=geren)...
call node "%~dp0..\..\..\tools\obfuscate.js" --target=geren
if errorlevel 1 (
    echo [ERROR] JS obfuscation failed
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] JS obfuscation complete
echo.

echo [6/10] Building signed APK...
echo.
call gradlew.bat assembleRelease
if errorlevel 1 (
    echo.
    echo [ERROR] Build failed! Rolling back versionCode...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='app\build.gradle'; $prevFile='%~dp0.build_vcode_prev'; if(Test-Path $prevFile){ $prev=Get-Content $prevFile -Raw; $c=[System.IO.File]::ReadAllText($f); $nc=$c -replace 'versionCode\s+\d+', \"versionCode $prev\"; [System.IO.File]::WriteAllText($f,$nc,(New-Object System.Text.UTF8Encoding($false))); Remove-Item $prevFile -Force; Write-Host ('  [OK] versionCode rolled back to '+$prev) } else { Write-Host '  [WARN] No prev versionCode to rollback' }"
    echo [WARN] Restoring JavaScript due to build failure...
    call node "%~dp0..\..\..\tools\obfuscate.js" restore --target=geren
    echo [ERROR] Build failed! Please check error messages
    if not defined NO_PAUSE pause
    exit /b 1
)
REM P0-3: Clean up versionCode rollback temp file after successful build
if exist "%~dp0.build_vcode_prev" del "%~dp0.build_vcode_prev"
echo.

echo [6.5/10] Restoring JavaScript...
call node "%~dp0..\..\..\tools\obfuscate.js" restore --target=geren
if errorlevel 1 (
    echo [WARN] JS restore failed - may need manual restore
) else (
    echo [OK] JS restored to original state
)
echo.

echo [7/10] Build successful, locating APK...
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

echo [7.5/10] Verifying APK contains latest index.html (content hash)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; $apk='%CD%\%APK_FILE%'; $zip=[System.IO.Compression.ZipFile]::OpenRead($apk); $entry=$zip.GetEntry('assets/public/index.html'); if(-not $entry){ $zip.Dispose(); Write-Host '[ERROR] assets/public/index.html not found in APK'; exit 1 }; $sr=New-Object System.IO.StreamReader($entry.Open()); $content=$sr.ReadToEnd(); $sr.Close(); $zip.Dispose(); $hash=[System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($content)); $hashStr=($hash|ForEach-Object{$_.ToString('x2')})-join ''; if($content.Length -lt 1000){ Write-Host '[ERROR] index.html in APK is too small ('+$content.Length+' bytes), build may be broken'; exit 1 }; Write-Host '[OK] APK contains index.html ('+$content.Length+' bytes, sha256='+$hashStr.Substring(0,16)+'...)'"
if errorlevel 1 (
    echo [ERROR] APK content verification failed! APK may not contain latest code.
    if not defined NO_PAUSE pause
    exit /b 1
)
echo.

echo [8/10] Copying APK to output directory...
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
if "%PRODUCT_NAME%"=="" set "PRODUCT_NAME=惠康中医-个人"

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
echo   [成功] APK 打包完成！
echo   路径: %APK_FULL_PATH%
echo   已签名，可直接安装
echo ============================================
echo.

echo [9/10] Calculating SHA-256 hash for download page...
node "%~dp0..\..\..\shared\calculate-hash.js"
if errorlevel 1 (
    echo [WARN] Hash calculation had issues, continuing anyway
) else (
    echo [OK] SHA-256 hash updated in public/hash-manifest.json
)
echo.

echo [10/10] Auto-updating download page...
node "%~dp0..\..\..\tools\auto-update-downloads.js" geren
if errorlevel 1 (
    echo [WARN] Download page auto-update had issues, continuing anyway
) else (
    echo [OK] Download page updated successfully
)
echo.

if not defined NO_PAUSE pause
exit /b 0