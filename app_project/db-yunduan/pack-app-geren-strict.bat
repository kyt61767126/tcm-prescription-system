chcp 65001 >nul
@echo off
setlocal enableextensions
cd /d "%~dp0"
title Huikang-TCM Build Tool

REM pack-app-geren-strict.bat - Cloud Personal Edition Strict Mode APP Build
REM Flow: Step A (build APK) -> Step B (extract signature hash) -> Step C (rebuild strict)
REM Package: com.tcm.prescription (db-yunduan/cloud_app_geren project)
REM Output:  惠康中医-YJ.apk

set "GEN_HASH_PS1=%~dp0..\..\tools\generate-sign-hash.ps1"
set "PACK_APP_BAT=%~dp0pack-app-geren.bat"
set "APP_DIR=%~dp0cloud_app_geren"
set "EXIT_CODE=0"

REM Record start time
for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"

echo ============================================
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '惠康中医云端APP打包工具（标准版·严格模式）'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '开始: %BUILD_START_TIME%'"
echo ============================================
echo.

REM Pre-flight checks
where node >nul 2>nul
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] Node.js not found'"
    echo   Please install from https://nodejs.org/
    if not defined NO_PAUSE pause
    exit /b 1
)

where java >nul 2>nul
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] Java not found'"
    echo   Please install JDK 17+
    if not defined NO_PAUSE pause
    exit /b 1
)

if not exist "%PACK_APP_BAT%" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] pack-app-geren.bat not found'"
    echo   Path: %PACK_APP_BAT%
    if not defined NO_PAUSE pause
    exit /b 1
)

if not exist "%GEN_HASH_PS1%" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] generate-sign-hash.ps1 not found'"
    echo   Path: %GEN_HASH_PS1%
    if not defined NO_PAUSE pause
    exit /b 1
)

REM ==========================================================
REM Step 0: Java packaging.ps1
REM ==========================================================
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[Step 0] Java 预编译检查中（提前发现编译错误）...'"
echo.
pushd "%APP_DIR%"
call gradlew.bat javaPreCompileRelease compileReleaseJavaWithJavac --quiet 2>&1
set "PRECOMPILE_RC=%errorlevel%"
popd
if %PRECOMPILE_RC% neq 0 (
    echo.
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] Java 预编译检查失败，终止打包'"
    set "EXIT_CODE=1"
    goto :end
)
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] Java 预编译检查通过'"
echo.

REM ==========================================================
REM Step A: Build APK (default mode, no signature strictness)
REM ==========================================================
echo [Step A] Building APK - default mode...
echo.
set "NO_PAUSE=1"
call "%PACK_APP_BAT%"
set "EXIT_CODE=%errorlevel%"
set "NO_PAUSE="
if %EXIT_CODE% neq 0 (
    echo.
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] Step A failed, exit code: %EXIT_CODE%'"
    goto :end
)

echo.

REM ==========================================================
REM Step B: Extract signature hash and inject into SecurityGuard.java
REM ==========================================================
echo [Step B] Extracting signature hash and injecting into SecurityGuard.java...
echo.
set "NO_PAUSE=1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%GEN_HASH_PS1%" -Version geren-cloud
set "EXIT_CODE=%errorlevel%"
set "NO_PAUSE="
if %EXIT_CODE% neq 0 (
    echo.
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] Step B failed, exit code: %EXIT_CODE%'"
    goto :end
)

echo.

REM ==========================================================
REM Step C: Stop Gradle daemon + Rebuild APK (strict signature mode)
REM ==========================================================
echo [Step C] Stopping Gradle daemon and rebuilding - strict mode...
echo.

REM Stop residual Gradle daemon from Step A to free memory for R8
if exist "%APP_DIR%\gradlew.bat" (
    echo   [INFO] Stopping Step A Gradle daemon...
    pushd "%APP_DIR%"
    call gradlew.bat --stop 2>nul
    popd
    timeout /t 2 /nobreak >nul
    echo   [OK] Gradle daemon stopped
)

set "NO_PAUSE=1"
call "%PACK_APP_BAT%"
set "EXIT_CODE=%errorlevel%"
set "NO_PAUSE="
if %EXIT_CODE% neq 0 (
    echo.
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] Step C failed, exit code: %EXIT_CODE%'"
    goto :end
)

:end
REM Calculate elapsed time
for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
for /f "delims=" %%e in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $s=[DateTime]::Parse('%BUILD_START_TIME%'); $e=[DateTime]::Parse('%BUILD_END_TIME%'); $d=$e-$s; $d.ToString('hh\:mm\:ss')"') do set "BUILD_ELAPSED=%%e"

echo.
if %EXIT_CODE% neq 0 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '========================================' -ForegroundColor Red; Write-Host '  [错误] 构建失败，退出码: %EXIT_CODE%' -ForegroundColor Red; Write-Host '  开始: %BUILD_START_TIME%' -ForegroundColor Red; Write-Host '  结束: %BUILD_END_TIME%' -ForegroundColor Red; Write-Host '  耗时: %BUILD_ELAPSED%' -ForegroundColor Red; Write-Host '========================================' -ForegroundColor Red"
) else (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '========================================' -ForegroundColor Yellow; Write-Host '  [OK] APP构建完成!' -ForegroundColor Yellow; Write-Host '  APK: 惠康中医-YJ.apk' -ForegroundColor Yellow; Write-Host '  开始: %BUILD_START_TIME%' -ForegroundColor Yellow; Write-Host '  结束: %BUILD_END_TIME%' -ForegroundColor Yellow; Write-Host '  耗时: %BUILD_ELAPSED%' -ForegroundColor Yellow; Write-Host '========================================' -ForegroundColor Yellow"
)
echo.
if not defined NO_PAUSE (
    set "EXIT_KEY="
    set "EXIT_KEY="
    set /p "EXIT_KEY=Press 0 or Enter to exit: "
)
exit /b %EXIT_CODE%
