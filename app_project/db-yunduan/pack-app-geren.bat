@echo off
chcp 65001 >nul
REM P0: 打包前自动修复 .ps1 文件 BOM 编码
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\fix-ps1-bom.ps1" >nul 2>&1
setlocal enableextensions
cd /d "%~dp0"
title 惠康中医云端APP打包工具（标准版）

REM pack-app-geren.bat - 云端 APP 打包入口（标准版，Android APK）
REM 标准版：单管理员用户，无离线管理员管理
REM 包名: com.tcm.prescription.geren
REM APP 名称: 惠康中医云端标准版
REM URL: https://tcm-prescription-system.pages.dev/?edition=personal

REM 记录开始时间
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"

set "APP_DIR=%~dp0cloud_app_geren"
set "GRADLEW=%APP_DIR%\gradlew.bat"
set "APK_SRC=%APP_DIR%\app\build\outputs\apk\release\app-release.apk"
set "APK_DST=%~dp0惠康中医-YB.apk"

echo ============================================
echo   惠康中医云端APP打包工具（标准版）
echo   开始: %BUILD_START_TIME%
echo ============================================
echo.

where java >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 Java
    echo   请安装 JDK 17+
    if not defined NO_PAUSE pause
    exit /b 1
)

REM 同步 shared/ 核心文件到 db-yunduan/cloud_app_geren assets
set "SHARED_DIR=%~dp0..\..\shared"
set "PUBLIC_DIR=%APP_DIR%\app\src\main\assets\public"
if not exist "%PUBLIC_DIR%" mkdir "%PUBLIC_DIR%"

echo [1/6] 同步核心 JS 模块...
if exist "%SHARED_DIR%\auth-core.js" (
    copy /y "%SHARED_DIR%\auth-core.js" "%PUBLIC_DIR%\auth-core.js" >nul
    echo   [OK] auth-core.js
) else (
    echo   [警告] 未找到 auth-core.js
)
if exist "%SHARED_DIR%\permission.js" (
    copy /y "%SHARED_DIR%\permission.js" "%PUBLIC_DIR%\permission.js" >nul
    echo   [OK] permission.js
) else (
    echo   [警告] 未找到 permission.js
)
echo.

REM 从 cloud_desktop/index.html 同步 APP 版本号到 cloud_app_geren MainActivity
echo [1.5/6] 同步 APP 版本号...
set "CLOUD_DIR_TMP=%~dp0"
set "CLOUD_DIR_TMP=%CLOUD_DIR_TMP:~0,-1%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-app-version.ps1" "%CLOUD_DIR_TMP%" "%APP_DIR%"
echo.

REM 清理构建缓存（强制全量清理）- 严格模式 Step C 重建必需
REM 不清理会导致上次构建的 .class 文件与修改后的 Java 文件冲突
echo [2/6] 清理构建缓存（强制全量清理）...
cd /d "%APP_DIR%"
if exist "app\build\intermediates\javac" (
    rmdir /S /Q "app\build\intermediates\javac" 2>nul
    echo   [OK] 已清理 javac 缓存
)
if exist "app\build\intermediates\assets" (
    rmdir /S /Q "app\build\intermediates\assets" 2>nul
    echo   [OK] 已清理 assets 缓存
)
if exist "app\build\intermediates\merged_assets" (
    rmdir /S /Q "app\build\intermediates\merged_assets" 2>nul
    echo   [OK] 已清理 merged_assets 缓存
)
call "%GRADLEW%" clean --no-daemon 2>nul
if errorlevel 1 (
    echo   [警告] Gradle clean 失败，继续增量构建
) else (
    echo   [OK] 旧缓存已清理
)
cd /d "%~dp0%"
echo.

REM Java 预编译检查（使用 --no-daemon 与 APK 构建保持一致）
echo [3/6] Java 预编译检查...
cd /d "%APP_DIR%"
call "%GRADLEW%" compileReleaseJavaWithJavac --quiet --no-daemon
set "PRECOMPILE_RC=%errorlevel%"
cd /d "%~dp0%"
if %PRECOMPILE_RC% neq 0 (
    echo.
    echo [错误] Java 预编译检查失败
    if not defined NO_PAUSE pause
    exit /b 1
)
echo   [OK] Java 预编译检查通过
echo.

REM 构建 APK
echo [4/6] 构建 APK - 标准版 com.tcm.prescription.geren...
cd /d "%APP_DIR%"
call "%GRADLEW%" assembleRelease --no-daemon
set "EXIT_CODE=%errorlevel%"
cd /d "%~dp0%"

if %EXIT_CODE% neq 0 (
    echo.
    echo [错误] 构建失败，退出码: %EXIT_CODE%
    if not defined NO_PAUSE pause
    exit /b %EXIT_CODE%
)

REM 复制并重命名 APK
echo.
echo [5/6] 复制 APK...
if exist "%APK_SRC%" (
    copy /y "%APK_SRC%" "%APK_DST%" >nul
    echo   [OK] APK 已生成: %APK_DST%
) else (
    echo   [错误] 未找到 APK 文件: %APK_SRC%
    if not defined NO_PAUSE pause
    exit /b 1
)

REM 自动更新下载页
echo.
echo [6/6] 自动更新下载页...
node "%~dp0..\..\tools\auto-update-downloads.js" geren-cloud
if errorlevel 1 (
    echo [警告] 下载页自动更新(geren-cloud)出现问题，继续执行
) else (
    echo [OK] 下载页已更新 - geren-cloud
)
echo.

for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
for /f "delims=" %%e in ('powershell -NoProfile -Command "$s=[DateTime]::Parse('%BUILD_START_TIME%'); $e=[DateTime]::Parse('%BUILD_END_TIME%'); $d=$e-$s; $d.ToString('hh\:mm\:ss')"') do set "BUILD_ELAPSED=%%e"
powershell -NoProfile -Command "Write-Host '========================================' -ForegroundColor Yellow; Write-Host '  [OK] 云端 APP（标准版）构建完成!' -ForegroundColor Yellow; Write-Host '  APK: %APK_DST%' -ForegroundColor Yellow; Write-Host '  开始: %BUILD_START_TIME%' -ForegroundColor Yellow; Write-Host '  结束: %BUILD_END_TIME%' -ForegroundColor Yellow; Write-Host '  总耗时: %BUILD_ELAPSED%' -ForegroundColor Yellow; Write-Host '========================================' -ForegroundColor Yellow"
echo.
if not defined NO_PAUSE (
    set "EXIT_KEY="
    set /p "EXIT_KEY=按 0 或回车键退出: "
)
exit /b 0
