@echo off
chcp 65001 >nul
REM Auto-fix .ps1 BOM (prevent Chinese garbled text due to BOM loss)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\fix-ps1-bom.ps1" >nul 2>&1
title Huikang TCM Personal - Offline APP Build

echo ============================================
echo   Huikang TCM Personal - Offline APP
echo ============================================
echo.

cd /d "%~dp0"

echo [1/10] Configuring clinic info...
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

echo [2/10] Synchronizing files to Android...
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
REM ★ 防护1：同步后 hash 校验，确保 android 目录与根目录 index.html 完全一致
REM 杜绝"根目录修改了但 android 目录未同步"导致打包用旧代码的问题
powershell -NoProfile -ExecutionPolicy Bypass -Command "$h1=(Get-FileHash 'index.html' -Algorithm SHA256).Hash; $h2=(Get-FileHash '%ANDROID_PUBLIC%\index.html' -Algorithm SHA256).Hash; if($h1 -ne $h2){ Write-Host '[ERROR] index.html sync verification FAILED! Root and Android hashes differ.'; Write-Host ('  Root:    '+$h1); Write-Host ('  Android: '+$h2); exit 1 } else { Write-Host '      index.html synced and verified (hash match)' }"
if errorlevel 1 (
    echo [ERROR] Sync verification failed, aborting build to prevent stale code
    if not defined NO_PAUSE pause
    exit /b 1
)
echo   [3/5] Syncing vendor/xlsx.full.min.js...
if exist "vendor\xlsx.full.min.js" (
    if not exist "%ANDROID_PUBLIC%\vendor" mkdir "%ANDROID_PUBLIC%\vendor" >nul
    copy /Y "vendor\xlsx.full.min.js" "%ANDROID_PUBLIC%\vendor\xlsx.full.min.js" >nul
    if errorlevel 1 ( echo [WARN] Failed to sync xlsx.full.min.js ) else ( echo       xlsx.full.min.js synced )
) else ( echo [SKIP] vendor/xlsx.full.min.js not found )
echo   [4/5] Syncing core JS modules...
set "MODULES=auth-core.js db-adapter.js debug-logger.js medicine-dict.js patient-archive.js performance-utils.js permission.js prescription-core.js print-utils.js security-guard.js"
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

echo [2.5/10] Minifying JavaScript files (security hardening)...
node "%~dp0..\_shared\minify-js.js" "%ANDROID_PUBLIC%"
if errorlevel 1 (
    echo [WARN] JS minification had issues, continuing anyway
) else (
    echo [OK] JavaScript files minified
)
echo.

cd /d "%~dp0\android"

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
call node "%~dp0..\..\tools\patch-java-version.js" "%~dp0..\.."
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
REM * Critical caches must be cleaned in BOTH modes (skip-clean and normal)
REM Historical lesson (2026-07-22): if javac cache not cleaned, MainActivity.java changes
REM won't take effect due to Gradle incremental build using stale cache, breaking Autofill fix.
REM Historical lesson (2026-07-23): without cleaning assets/merged_assets cache, index.html
REM changes won't take effect due to Gradle incremental build using stale cache, causing old page flicker.
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
REM ★ 防护2：强制 gradlew clean，杜绝 Gradle 增量缓存导致旧代码被打包
REM 历史教训：TCM_GRADLE_SKIP_CLEAN=1 跳过 clean 曾导致修改不生效，已废弃该选项
if defined TCM_GRADLE_SKIP_CLEAN (
    echo [WARN] TCM_GRADLE_SKIP_CLEAN is deprecated and ignored. Forcing gradlew clean.
)
call gradlew.bat clean
if errorlevel 1 (
    echo [WARN] Clean failed, continuing with incremental build
) else (
    echo [OK] Old cache cleared (forced clean)
)
echo.

echo [5.5/10] Auto-increment versionCode...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='app\build.gradle'; $c=[System.IO.File]::ReadAllText($f); if($c -match 'versionCode\s+(\d+)'){ $old=$matches[1]; $new=[int]$old+1; $c=$c -replace 'versionCode\s+\d+', ('versionCode '+$new); [System.IO.File]::WriteAllText($f,$c,(New-Object System.Text.UTF8Encoding($false))); Write-Host ('  versionCode: ' + $old + ' -> ' + $new) } else { Write-Host '  [WARN] versionCode not found, skip' }"
echo.

echo [5.6/10] Obfuscating JavaScript (target=geren)...
call node "%~dp0..\..\tools\obfuscate.js" --target=geren
if errorlevel 1 (
    echo [ERROR] JS obfuscation failed
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] JS obfuscation complete
REM ★ 防护3-pre：保存混淆后 android 目录 index.html 的 hash，用于打包后 APK 内容验证
REM 打包用的就是 android 目录的文件，APK 中的 index.html hash 必须与此一致
for /f "delims=" %%h in ('powershell -NoProfile -Command "(Get-FileHash 'app\src\main\assets\public\index.html' -Algorithm SHA256).Hash"') do set "OBFUSCATED_INDEX_HASH=%%h"
echo       Obfuscated index.html hash: %OBFUSCATED_INDEX_HASH%
echo.

echo [6/10] Building signed APK...
echo.
call gradlew.bat assembleRelease
if errorlevel 1 (
    echo.
    echo [WARN] Restoring JavaScript due to build failure...
    call node "%~dp0..\..\tools\obfuscate.js" restore --target=geren
    echo [ERROR] Build failed! Please check error messages
    if not defined NO_PAUSE pause
    exit /b 1
)
echo.

echo [6.5/10] Restoring JavaScript...
call node "%~dp0..\..\tools\obfuscate.js" restore --target=geren
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

echo [7.5/10] Verifying APK contains latest index.html...
REM ★ 防护3：从 APK 提取 index.html，校验 hash 与混淆后保存的 hash 是否一致
REM 这是最终保险，防止任何环节出错导致旧代码被打包
REM 如果 APK 中的 index.html hash 与打包前 android 目录的不一致，说明打包用了旧代码
powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; $apk='%CD%\%APK_FILE%'; $expected='%OBFUSCATED_INDEX_HASH%'; try { $zip=[System.IO.Compression.ZipFile]::OpenRead($apk); $entry=$zip.Entries | Where-Object { $_.FullName -eq 'assets/public/index.html' }; if(-not $entry){ Write-Host '[ERROR] index.html not found in APK!'; $zip.Dispose(); exit 1 }; $temp=[System.IO.Path]::GetTempFileName(); [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$temp,$true); $zip.Dispose(); $actual=(Get-FileHash $temp -Algorithm SHA256).Hash; Remove-Item $temp -Force; if($actual -ne $expected){ Write-Host '[ERROR] APK index.html hash MISMATCH! APK may contain stale code.'; Write-Host ('  Expected (obfuscated): '+$expected); Write-Host ('  Actual (in APK):       '+$actual); exit 1 } else { Write-Host '[OK] APK index.html verified (hash match)' } } catch { Write-Host ('[ERROR] '+$_.Exception.Message); exit 1 }"
if errorlevel 1 (
    echo [ERROR] APK content verification FAILED! Aborting to prevent shipping stale APK.
    echo   The APK does NOT contain the latest index.html. Do NOT install this APK.
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
echo   Packing completed!
echo   APK Path: %APK_FULL_PATH%
echo   This APK is signed and ready for installation
echo ============================================
echo.

echo [9/10] Calculating SHA-256 hash for download page...
node "%~dp0..\_shared\calculate-hash.js"
if errorlevel 1 (
    echo [WARN] Hash calculation had issues, continuing anyway
) else (
    echo [OK] SHA-256 hash updated in public/hash-manifest.json
)
echo.

echo [10/10] Auto-updating download page...
node "%~dp0..\..\tools\auto-update-downloads.js" bendi
if errorlevel 1 (
    echo [WARN] Download page auto-update had issues, continuing anyway
) else (
    echo [OK] Download page updated successfully
)
echo.

if not defined NO_PAUSE pause
exit /b 0
