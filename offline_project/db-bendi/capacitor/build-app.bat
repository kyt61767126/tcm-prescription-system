@echo off
chcp 65001 >nul
title Huikang TCM Local - Capacitor APP Build
echo ============================================
echo   Huikang TCM Local - Capacitor APP
echo ============================================
echo.

cd /d "%~dp0"

set "CAP_PUBLIC=%~dp0app\src\main\assets\public"
set "CAP_ASSETS=%~dp0app\src\main\assets"
set "PARENT_DIR=%~dp0.."
set "SHARED_DIR=%~dp0..\..\_shared"
set "TOOLS_DIR=%~dp0..\..\..\tools"

echo [1/12] Configuring clinic info...
if /i "%1"=="--skip-config" (
    echo       [SKIP] --skip-config parameter detected
) else (
    if exist "..\edit-config.ps1" (
        powershell -NoProfile -ExecutionPolicy Bypass -File "..\edit-config.ps1"
        if errorlevel 1 (
            echo [WARN] edit-config.ps1 had issues, continuing
        ) else (
            echo [OK] Clinic config updated
        )
    ) else (
        echo [SKIP] edit-config.ps1 not found, using existing config
    )
)
echo.

echo [2/12] Syncing files to Capacitor public...
if not exist "%CAP_PUBLIC%" (
    echo [ERROR] Capacitor public directory not found: %CAP_PUBLIC%
    if not defined NO_PAUSE pause
    exit /b 1
)
echo   [1/6] Syncing config.json...
if exist "..\config.json" (
    copy /Y "..\config.json" "%CAP_PUBLIC%\config.json" >nul
    if errorlevel 1 ( echo [WARN] Failed to sync config.json ) else ( echo       config.json synced )
) else ( echo [SKIP] config.json not found )
echo   [2/6] Syncing index.html...
copy /Y "..\index.html" "%CAP_PUBLIC%\index.html" >nul
if errorlevel 1 (
    echo [ERROR] Failed to sync index.html
    if not defined NO_PAUSE pause
    exit /b 1
)
echo       index.html synced
echo   [3/6] Syncing vendor/xlsx.full.min.js...
if exist "..\vendor\xlsx.full.min.js" (
    if not exist "%CAP_PUBLIC%\vendor" mkdir "%CAP_PUBLIC%\vendor" >nul
    copy /Y "..\vendor\xlsx.full.min.js" "%CAP_PUBLIC%\vendor\xlsx.full.min.js" >nul
    if errorlevel 1 ( echo [WARN] Failed to sync xlsx.full.min.js ) else ( echo       xlsx.full.min.js synced )
) else ( echo [SKIP] vendor/xlsx.full.min.js not found )
echo   [4/6] Syncing core JS modules...
set "MODULES=auth-core.js db-adapter.js debug-logger.js medicine-dict.js patient-archive.js performance-utils.js permission.js prescription-core.js print-utils.js security-guard.js"
for %%m in (%MODULES%) do (
    if exist "..\%%m" (
        copy /Y "..\%%m" "%CAP_PUBLIC%\%%m" >nul
        if errorlevel 1 ( echo [WARN] Failed to sync %%m ) else ( echo       %%m synced )
    ) else ( echo [SKIP] %%m not found )
)
echo   [5/6] Syncing video-recorder-inject.js...
if exist "..\video-recorder-inject.js" (
    copy /Y "..\video-recorder-inject.js" "%CAP_ASSETS%\video-recorder-inject.js" >nul
    if errorlevel 1 ( echo [WARN] Failed to sync video-recorder-inject.js ) else ( echo       video-recorder-inject.js synced )
) else ( echo [SKIP] video-recorder-inject.js not found )
echo   [6/6] Syncing shared files from _shared...
if exist "%SHARED_DIR%\auth-core.js" (
    copy /Y "%SHARED_DIR%\auth-core.js" "%CAP_PUBLIC%\auth-core.js" >nul
    echo       shared auth-core.js synced
)
if exist "%SHARED_DIR%\permission.js" (
    copy /Y "%SHARED_DIR%\permission.js" "%CAP_PUBLIC%\permission.js" >nul
    echo       shared permission.js synced
)
echo.

echo [3/12] Checking environment (JDK/JAVA_HOME)...
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
        echo [ERROR] Java not found. Please install JDK 17+ and set JAVA_HOME
        if not defined NO_PAUSE pause
        exit /b 1
    )
    echo       java OK ^(JAVA_HOME not set, using PATH^)
)
if not exist "gradlew.bat" (
    echo [ERROR] gradlew.bat not found
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\signing.properties" (
    echo [ERROR] signing.properties not found
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\app-release.jks" (
    echo [ERROR] app-release.jks not found
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\src\main\assets\capacitor.config.json" (
    echo [ERROR] capacitor.config.json not found
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\src\main\assets\public\index.html" (
    echo [ERROR] index.html not found
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] Environment check passed
echo.

echo [3.5/12] Patching Capacitor Java version (21 to 17)...
if exist "%TOOLS_DIR%\patch-java-version.js" (
    call node "%TOOLS_DIR%\patch-java-version.js" "%~dp0..\..\.."
    if errorlevel 1 (
        echo [WARN] Java version patch had issues, continuing anyway
    ) else (
        echo [OK] Java version patched
    )
) else (
    echo [SKIP] patch-java-version.js not found
)
echo.

echo [4/12] Recording index.html hash (for APK verification)...
for /f "delims=" %%h in ('powershell -NoProfile -Command "(Get-FileHash 'app\src\main\assets\public\index.html' -Algorithm SHA256).Hash"') do set "INDEX_HASH=%%h"
echo       index.html hash: %INDEX_HASH%
echo.

echo [5/12] Auto-increment versionCode (with rollback protection)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='app\build.gradle'; $c=[System.IO.File]::ReadAllText($f); if($c -match 'versionCode\s+(\d+)'){ $old=[int]$matches[1]; $new=$old+1; $nc=$c -replace 'versionCode\s+\d+', ('versionCode '+$new); [System.IO.File]::WriteAllText($f,$nc,(New-Object System.Text.UTF8Encoding($false))); Set-Content -Path '%~dp0.build_vcode_prev' -Value $old -Encoding ASCII -NoNewline; Write-Host ('  [OK] versionCode: ' + $old + ' -> ' + $new + ' (prev saved)') } else { Write-Host '  [WARN] versionCode not found, skip' }"
echo.

echo [6/12] Current configuration...
findstr "versionName" "app\build.gradle"
echo.

echo [7/12] Stopping residual Gradle processes...
taskkill /F /IM java.exe /FI "WINDOWTITLE eq gradle*" >nul 2>&1
echo [OK] Cleanup completed
echo.

echo [8/12] Cleaning build cache (force full clean)...
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
    echo [OK] Old cache cleared (forced clean)
)
echo.

echo [9/12] Building signed APK...
call gradlew.bat assembleRelease
if errorlevel 1 (
    echo.
    echo [ERROR] Build failed! Rolling back versionCode...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$g='app\build.gradle'; $prevFile='%~dp0.build_vcode_prev'; if(Test-Path $prevFile){ $prev=Get-Content $prevFile -Raw; $c=Get-Content $g -Raw -Encoding UTF8; $nc=$c -replace 'versionCode\s+\d+', ('versionCode '+$prev); [System.IO.File]::WriteAllText($g,$nc,(New-Object System.Text.UTF8Encoding $false)); Remove-Item $prevFile -Force; Write-Host ('  [OK] versionCode rolled back to '+$prev) } else { Write-Host '  [WARN] No prev versionCode to rollback' }"
    if not defined NO_PAUSE pause
    exit /b 1
)
if exist "%~dp0.build_vcode_prev" del "%~dp0.build_vcode_prev"
echo [OK] Build successful
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
    if not defined NO_PAUSE pause
    exit /b 1
)
for %%A in ("%APK_FILE%") do (
    echo APK File: %%~nxA
    echo File Size: %%~zA bytes
)
echo.

echo [9.5/12] Verifying APK contains latest index.html...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; $apk='%CD%\%APK_FILE%'; $expected='%INDEX_HASH%'; try { $zip=[System.IO.Compression.ZipFile]::OpenRead($apk); $entry=$zip.Entries | Where-Object { $_.FullName -eq 'assets/public/index.html' }; if(-not $entry){ Write-Host '[ERROR] index.html not found in APK!'; $zip.Dispose(); exit 1 }; $temp=[System.IO.Path]::GetTempFileName(); [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$temp,$true); $zip.Dispose(); $actual=(Get-FileHash $temp -Algorithm SHA256).Hash; Remove-Item $temp -Force; if($actual -ne $expected){ Write-Host '[ERROR] APK index.html hash MISMATCH!'; Write-Host ('  Expected: '+$expected); Write-Host ('  Actual:   '+$actual); exit 1 } else { Write-Host '[OK] APK index.html verified (hash match)' } } catch { Write-Host ('[ERROR] '+$_.Exception.Message); exit 1 }"
if errorlevel 1 (
    echo [ERROR] APK content verification FAILED! Aborting to prevent shipping stale APK.
    if not defined NO_PAUSE pause
    exit /b 1
)
echo.

echo [10/12] Reading product name and copying APK...
set "PRODUCT_NAME="
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "(Get-Content '..\config.json' -Encoding UTF8 -Raw | ConvertFrom-Json).productName"`) do (
    set "PRODUCT_NAME=%%p"
)
if "%PRODUCT_NAME%"=="" set "PRODUCT_NAME=惠康中医-本地"

set "SRC_SIZE=0"
for %%A in ("%APK_FILE%") do set "SRC_SIZE=%%~zA"
if "%SRC_SIZE%"=="" set "SRC_SIZE=0"
if %SRC_SIZE% EQU 0 (
    echo [ERROR] Source APK is 0 bytes!
    if not defined NO_PAUSE pause
    exit /b 1
)
echo Source APK size: %SRC_SIZE% bytes

set "FINAL_APK=..\%PRODUCT_NAME%.apk"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $src='%APK_FILE%'; $dst='%FINAL_APK%'; $expected=%SRC_SIZE%; try { [System.IO.File]::Copy($src,$dst,$true); $actual=(New-Object System.IO.FileInfo $dst).Length; if($actual -ne $expected){ Write-Host ('[ERROR] Size mismatch: src='+$expected+' dst='+$actual); exit 1 }; Write-Host ('[OK] Copied '+$actual+' bytes to: '+$dst) } catch { Write-Host ('[ERROR] '+$_.Exception.Message); exit 1 }"
if errorlevel 1 (
    echo [WARN] Copy with productName failed, fallback to app-release.apk
    set "FINAL_APK=..\app-release.apk"
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $src='%APK_FILE%'; $dst='%FINAL_APK%'; $expected=%SRC_SIZE%; try { [System.IO.File]::Copy($src,$dst,$true); $actual=(New-Object System.IO.FileInfo $dst).Length; if($actual -ne $expected){ Write-Host ('[ERROR] Size mismatch'); exit 1 }; Write-Host ('[OK] Copied '+$actual+' bytes to: '+$dst) } catch { Write-Host ('[ERROR] '+$_.Exception.Message); exit 1 }"
    if errorlevel 1 (
        echo [ERROR] Copy failed, please manually get APK from:
        echo   %CD%\%APK_DIR%
        if not defined NO_PAUSE pause
        exit /b 1
    )
)

for %%F in ("%FINAL_APK%") do set "APK_FULL_PATH=%%~fF"
echo.
echo ============================================
echo   Packing completed!
echo   APK Path: %APK_FULL_PATH%
echo   SHA-256: %INDEX_HASH%
echo   This APK is signed and ready for installation
echo ============================================
echo.

echo [11/12] Calculating SHA-256 hash for download page...
if exist "%~dp0..\..\_shared\calculate-hash.js" (
    pushd "%~dp0.."
    node "%~dp0..\..\_shared\calculate-hash.js"
    if errorlevel 1 (
        echo [WARN] Hash calculation had issues, continuing anyway
    ) else (
        echo [OK] SHA-256 hash updated
    )
    popd
) else (
    echo [SKIP] calculate-hash.js not found
)
echo.

echo [12/12] Auto-updating download page...
if exist "%TOOLS_DIR%\auto-update-downloads.js" (
    node "%TOOLS_DIR%\auto-update-downloads.js" bendi
    if errorlevel 1 (
        echo [WARN] Download page auto-update had issues, continuing anyway
    ) else (
        echo [OK] Download page updated successfully
    )
) else (
    echo [SKIP] auto-update-downloads.js not found
)
echo.

if not defined NO_PAUSE pause
exit /b 0
