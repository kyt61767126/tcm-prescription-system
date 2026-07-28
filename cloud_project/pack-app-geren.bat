@echo off
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

REM pack-app-geren.bat - 云端个人版APP Build (Android APK)
REM 个人版特点：单用户管理员，不具备新增离线普通管理员功能
REM 包名：com.tcm.prescription.geren
REM APP名：惠康中医-云端个人版
REM 加载URL：https://tcm-prescription-system.pages.dev/?edition=personal

set "APP_DIR=%~dp0cloud_app_geren"
set "GRADLEW=%APP_DIR%\gradlew.bat"
set "APK_SRC=%APP_DIR%\app\build\outputs\apk\release\app-release.apk"
set "APK_DST=%~dp0惠康中医-云端个人版.apk"

echo ============================================
echo   惠康中医-云端个人版APP Build (Android APK)
echo ============================================
echo.

where java >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Java not found
    echo   Please install JDK 17+
    if not defined NO_PAUSE pause
    exit /b 1
)

REM 同步 shared/ 核心文件到 cloud_app_geren assets（对齐 cloud_app 流程）
set "SHARED_DIR=%~dp0..\shared"
set "PUBLIC_DIR=%APP_DIR%\app\src\main\assets\public"
if not exist "%PUBLIC_DIR%" mkdir "%PUBLIC_DIR%"

echo [1/3] 同步核心 JS 模块...
if exist "%SHARED_DIR%\auth-core.js" (
    copy /y "%SHARED_DIR%\auth-core.js" "%PUBLIC_DIR%\auth-core.js" >nul
    echo   [OK] auth-core.js
) else (
    echo   [WARN] auth-core.js 未找到
)
if exist "%SHARED_DIR%\permission.js" (
    copy /y "%SHARED_DIR%\permission.js" "%PUBLIC_DIR%\permission.js" >nul
    echo   [OK] permission.js
) else (
    echo   [WARN] permission.js 未找到
)
echo.

REM 构建 APK
echo [2/3] 构建 APK（个人版 com.tcm.prescription.geren）...
cd /d "%APP_DIR%"
call "%GRADLEW%" assembleRelease --no-daemon
set "EXIT_CODE=%errorlevel%"
cd /d "%~dp0"

if %EXIT_CODE% neq 0 (
    echo.
    echo [ERROR] 构建失败，退出码: %EXIT_CODE%
    if not defined NO_PAUSE pause
    exit /b %EXIT_CODE%
)

REM 复制并重命名 APK
echo.
echo [3/3] 复制 APK...
if exist "%APK_SRC%" (
    copy /y "%APK_SRC%" "%APK_DST%" >nul
    echo   [OK] APK 已生成: %APK_DST%
) else (
    echo   [ERROR] APK 文件未找到: %APK_SRC%
    if not defined NO_PAUSE pause
    exit /b 1
)

echo.
echo ============================================
echo   [OK] 云端个人版APP构建完成!
echo   APK: %APK_DST%
echo ============================================
echo.
if not defined NO_PAUSE pause
