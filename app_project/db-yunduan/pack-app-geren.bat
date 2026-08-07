chcp 65001 >nul
@echo off
REM P0: .ps1 BOM
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\fix-ps1-bom.ps1" >nul 2>&1
setlocal enableextensions
cd /d "%~dp0"
title Huikang-TCM Build Tool

REM pack-app-geren.bat - APP Android APK
REM
REM : com.tcm.prescription.geren
REM APP :
REM URL: https://tcm-prescription-system.pages.dev/?edition=personal

REM
for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"

set "APP_DIR=%~dp0cloud_app_geren"
set "GRADLEW=%APP_DIR%\gradlew.bat"
set "APK_SRC=%APP_DIR%\app\build\outputs\apk\release\app-release.apk"
set "APK_DST=%~dp0惠康中医-YJ.apk"

echo ============================================
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '惠康中医云端APP打包工具（标准版）'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '开始: %BUILD_START_TIME%'"
echo ============================================
echo.

where java >nul 2>nul
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] 未找到 Java'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '请安装 JDK 17+'"
    if not defined NO_PAUSE pause
    exit /b 1
)

REM Pre-flight check: 检测上次非正常退出残留（configuration-cache/Gradle daemon）
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\pre-flight-check.ps1" -AppDir "%APP_DIR%"
echo.

REM shared/ db-yunduan/cloud_app_geren assets
set "SHARED_DIR=%~dp0..\..\shared"
set "PUBLIC_DIR=%APP_DIR%\app\src\main\assets\public"
if not exist "%PUBLIC_DIR%" mkdir "%PUBLIC_DIR%"

powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[1/6] 同步核心 JS 模块...'"
if exist "%SHARED_DIR%\auth-core.js" (
    copy /y "%SHARED_DIR%\auth-core.js" "%PUBLIC_DIR%\auth-core.js" >nul
    echo   [OK] auth-core.js
) else (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[警告] 未找到 auth-core.js'"
)
if exist "%SHARED_DIR%\permission.js" (
    copy /y "%SHARED_DIR%\permission.js" "%PUBLIC_DIR%\permission.js" >nul
    echo   [OK] permission.js
) else (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[警告] 未找到 permission.js'"
)
echo.

REM cloud_desktop/index.html APP cloud_app_geren MainActivity
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[1.5/6] 同步 APP 版本号...'"
set "CLOUD_DIR_TMP=%~dp0"
set "CLOUD_DIR_TMP=%CLOUD_DIR_TMP:~0,-1%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-app-version.ps1" "%CLOUD_DIR_TMP%" "%APP_DIR%"
echo.

REM - Step C
REM .class Java
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[2/6] 清理构建缓存（强制全量清理）...'"
cd /d "%APP_DIR%"
if exist "app\build\intermediates\javac" (
    rmdir /S /Q "app\build\intermediates\javac" 2>nul
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] 已清理 javac 缓存'"
)
if exist "app\build\intermediates\assets" (
    rmdir /S /Q "app\build\intermediates\assets" 2>nul
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] 已清理 assets 缓存'"
)
if exist "app\build\intermediates\merged_assets" (
    rmdir /S /Q "app\build\intermediates\merged_assets" 2>nul
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] 已清理 merged_assets 缓存'"
)
call "%GRADLEW%" clean 2>nul
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[警告] Gradle clean 失败，继续增量构建'"
) else (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] 旧缓存已清理'"
)
cd /d "%~dp0%"
echo.

REM Java daemon APK
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[3/6] Java 预编译检查...'"
cd /d "%APP_DIR%"
call "%GRADLEW%" javaPreCompileRelease compileReleaseJavaWithJavac --quiet
set "PRECOMPILE_RC=%errorlevel%"
cd /d "%~dp0%"
if %PRECOMPILE_RC% neq 0 (
    echo.
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] Java 预编译检查失败'"
    if not defined NO_PAUSE pause
    exit /b 1
)
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] Java 预编译检查通过'"
echo.

REM APK
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[4/6] 构建 APK - 标准版 com.tcm.prescription.geren...'"
cd /d "%APP_DIR%"
call "%GRADLEW%" assembleRelease
set "EXIT_CODE=%errorlevel%"
cd /d "%~dp0%"

if %EXIT_CODE% neq 0 (
    echo.
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] 构建失败，退出码: %EXIT_CODE%'"
    if not defined NO_PAUSE pause
    exit /b %EXIT_CODE%
)

REM APK
echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[5/6] 复制 APK...'"
if exist "%APK_SRC%" (
    copy /y "%APK_SRC%" "%APK_DST%" >nul
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] APK 已生成: %APK_DST%'"
) else (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] 未找到 APK 文件: %APK_SRC%'"
    if not defined NO_PAUSE pause
    exit /b 1
)

REM
echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[6/6] 自动更新下载页...'"
node "%~dp0..\..\tools\auto-update-downloads.js" geren-cloud
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[警告] 下载页自动更新（geren-cloud）出现问题，继续执行'"
) else (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] 下载页已更新 - geren-cloud'"
)
echo.

for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
for /f "delims=" %%e in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $s=[DateTime]::Parse('%BUILD_START_TIME%'); $e=[DateTime]::Parse('%BUILD_END_TIME%'); $d=$e-$s; $d.ToString('hh\:mm\:ss')"') do set "BUILD_ELAPSED=%%e"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '========================================' -ForegroundColor Yellow; Write-Host '  [OK] 云端 APP（标准版）构建完成!' -ForegroundColor Yellow; Write-Host '  APK: %APK_DST%' -ForegroundColor Yellow; Write-Host '  开始: %BUILD_START_TIME%' -ForegroundColor Yellow; Write-Host '  结束: %BUILD_END_TIME%' -ForegroundColor Yellow; Write-Host '  耗时: %BUILD_ELAPSED%' -ForegroundColor Yellow; Write-Host '========================================' -ForegroundColor Yellow"
echo.
if not defined NO_PAUSE (
    set "EXIT_KEY="
    set "EXIT_KEY="
    set /p "EXIT_KEY=Press 0 or Enter to exit: "
)
exit /b 0
