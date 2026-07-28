@echo off
chcp 65001 >nul
title Huikang TCM Local - Capacitor APP Build
echo ============================================
echo   惠康中医-本地 Capacitor APP
echo ============================================
echo.

cd /d "%~dp0"

echo [1/8] Checking environment...
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
if not exist "app\src\main\assets\public\index.html" (
    echo [ERROR] index.html not found
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] Environment check passed
echo.

echo [2/8] Recording index.html hash (for APK verification)...
for /f "delims=" %%h in ('powershell -NoProfile -Command "(Get-FileHash 'app\src\main\assets\public\index.html' -Algorithm SHA256).Hash"') do set "INDEX_HASH=%%h"
echo       index.html hash: %INDEX_HASH%
echo.

echo [3/8] Auto-increment versionCode...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='app\build.gradle'; $c=[System.IO.File]::ReadAllText($f); if($c -match 'versionCode\s+(\d+)'){ $old=$matches[1]; $new=[int]$old+1; $c=$c -replace 'versionCode\s+\d+', ('versionCode '+$new); [System.IO.File]::WriteAllText($f,$c,(New-Object System.Text.UTF8Encoding($false))); Write-Host ('  versionCode: ' + $old + ' -> ' + $new) } else { Write-Host '  [WARN] versionCode not found, skip' }"
echo.

echo [4/8] Stopping residual Gradle processes...
taskkill /F /IM java.exe /FI "WINDOWTITLE eq gradle*" >nul 2>&1
echo [OK] Cleanup completed
echo.

echo [5/8] Cleaning build cache (force full clean)...
REM Critical caches must be cleaned to prevent stale code being packaged
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

echo [6/8] Building signed APK...
call gradlew.bat assembleRelease
if errorlevel 1 (
    echo [ERROR] Build failed! Please check error messages
    if not defined NO_PAUSE pause
    exit /b 1
)
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

echo [7/8] Verifying APK contains latest index.html...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; $apk='%CD%\%APK_FILE%'; $expected='%INDEX_HASH%'; try { $zip=[System.IO.Compression.ZipFile]::OpenRead($apk); $entry=$zip.Entries | Where-Object { $_.FullName -eq 'assets/public/index.html' }; if(-not $entry){ Write-Host '[ERROR] index.html not found in APK!'; $zip.Dispose(); exit 1 }; $temp=[System.IO.Path]::GetTempFileName(); [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$temp,$true); $zip.Dispose(); $actual=(Get-FileHash $temp -Algorithm SHA256).Hash; Remove-Item $temp -Force; if($actual -ne $expected){ Write-Host '[ERROR] APK index.html hash MISMATCH!'; Write-Host ('  Expected: '+$expected); Write-Host ('  Actual:   '+$actual); exit 1 } else { Write-Host '[OK] APK index.html verified (hash match)' } } catch { Write-Host ('[ERROR] '+$_.Exception.Message); exit 1 }"
if errorlevel 1 (
    echo [ERROR] APK content verification FAILED! Aborting to prevent shipping stale APK.
    if not defined NO_PAUSE pause
    exit /b 1
)
echo.

echo [8/8] Copying APK to output directory...
set "FINAL_APK=惠康中医-本地-Capacitor.apk"
set "SRC_SIZE=0"
for %%A in ("%APK_FILE%") do set "SRC_SIZE=%%~zA"
if %SRC_SIZE% EQU 0 (
    echo [ERROR] Source APK is 0 bytes!
    if not defined NO_PAUSE pause
    exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $src='%APK_FILE%'; $dst='%FINAL_APK%'; $expected=%SRC_SIZE%; try { [System.IO.File]::Copy($src,$dst,$true); $actual=(New-Object System.IO.FileInfo $dst).Length; if($actual -ne $expected){ Write-Host ('[ERROR] Size mismatch'); exit 1 }; Write-Host ('[OK] Copied '+$actual+' bytes to: '+$dst) } catch { Write-Host ('[ERROR] '+$_.Exception.Message); exit 1 }"
if errorlevel 1 (
    echo [ERROR] Copy failed
    if not defined NO_PAUSE pause
    exit /b 1
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
if not defined NO_PAUSE pause
exit /b 0
