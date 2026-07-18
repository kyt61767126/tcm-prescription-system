@echo off
setlocal enabledelayedexpansion

set "SELF_DIR=%~dp0"
set "PROJECT_ROOT=%SELF_DIR%.."

if "%1"=="" (
    echo Usage: build-common.bat ^<target^> ^<product_name^> ^<output_dir^> [--skip-config] [--skip-encoding]
    echo   target: cloud ^| bendi ^| geren ^| dingzhi
    exit /b 1
)

set "TARGET=%1"
set "PRODUCT_NAME=%2"
set "OUTPUT_DIR=%3"

set "SKIP_CONFIG=0"
set "SKIP_ENCODING=0"
for %%A in (%4 %5 %6 %7 %8 %9) do (
    if /i "%%A"=="--skip-config" set "SKIP_CONFIG=1"
    if /i "%%A"=="--skip-encoding" set "SKIP_ENCODING=1"
)

set "TARGET_PATH="
set "PROCESS_LIST="
set "WMIC_PATTERN="
set "OLD_DIR_PREFIX="
set "ANDROID_DIR="

if "%TARGET%"=="cloud" (
    set "TARGET_PATH=cloud_project\cloud_desktop"
    set "PROCESS_LIST=HuikangTCM.exe"
    set "WMIC_PATTERN=cloud_desktop"
    set "OLD_DIR_PREFIX=build_output_old_"
) else if "%TARGET%"=="bendi" (
    set "TARGET_PATH=offline_project\db-bendi"
    set "PROCESS_LIST=app-local.exe"
    set "WMIC_PATTERN=db-bendi"
    set "OLD_DIR_PREFIX=dist_old_"
    set "ANDROID_DIR=%TARGET_PATH%\android"
) else if "%TARGET%"=="geren" (
    set "TARGET_PATH=offline_project\db-geren"
    set "PROCESS_LIST=app-personal.exe"
    set "WMIC_PATTERN=db-geren"
    set "OLD_DIR_PREFIX=dist_old_"
    set "ANDROID_DIR=%TARGET_PATH%\android"
) else if "%TARGET%"=="dingzhi" (
    set "TARGET_PATH=offline_project\db-dingzhi"
    set "PROCESS_LIST=app-custom.exe"
    set "WMIC_PATTERN=db-dingzhi"
    set "OLD_DIR_PREFIX=dist_old_"
    set "ANDROID_DIR=%TARGET_PATH%\android"
) else (
    echo [ERROR] Invalid target: %TARGET%
    pause
    exit /b 1
)

set "BUILD_DIR=%PROJECT_ROOT%\%TARGET_PATH%"
set "LOG_DIR=%BUILD_DIR%\logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
for /f "tokens=2 delims==" %%a in ('wmic os get localdatetime /value 2^>nul ^| find "="') do set "ldt=%%a"
set "LOG_FILE=%LOG_DIR%\packaging-%ldt:~0,8%-%ldt:~8,6%.log"

chcp 65001 >nul

cd /d "%BUILD_DIR%"

echo.
echo ============================================
echo   TCM Prescription Packaging Module
echo   Version: %TARGET% ^| Product: %PRODUCT_NAME%
echo   Log: %LOG_FILE%
echo ============================================
echo.

echo [1/7] Encoding verification...
if not "%SKIP_ENCODING%"=="1" (
    powershell -ExecutionPolicy Bypass -Command "$files = @('%BUILD_DIR%\index.html', '%BUILD_DIR%\config.json'); foreach ($f in $files) { if (Test-Path $f) { $bytes = [System.IO.File]::ReadAllBytes($f); $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF); if ($hasBom) { Write-Host \"  [FIX] $($f | Split-Path -Leaf): BOM found, stripping...\"; [System.IO.File]::WriteAllBytes($f, $bytes[3..($bytes.Length - 1)]) } else { Write-Host \"  [OK] $($f | Split-Path -Leaf): no BOM\" } } else { Write-Host \"  [SKIP] $($f | Split-Path -Leaf): not found\" } }"
) else (
    echo       [SKIP] --skip-encoding parameter detected
)
echo.

echo [2/7] Closing remaining processes...
taskkill /F /IM electron.exe >nul 2>&1
taskkill /F /IM java.exe >nul 2>&1
taskkill /F /IM gradle.exe >nul 2>&1
for %%P in (%PROCESS_LIST%) do (
    taskkill /F /IM "%%P" >nul 2>&1
)
powershell -ExecutionPolicy Bypass -Command "Get-Process | Where-Object { $_.Path -like '*%WMIC_PATTERN%*' } | Stop-Process -Force" 2>nul
timeout /t 2 /nobreak >nul
echo [OK] Processes cleaned
echo.

if not "%TARGET%"=="cloud" (
