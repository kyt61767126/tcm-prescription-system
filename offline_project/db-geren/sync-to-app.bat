@echo off
chcp 65001 >nul
setlocal

REM ============================================================
REM  离线项目三端同步脚本 - db-geren (个人版)
REM
REM  使用场景：
REM    修改 db-geren/index.html 后，运行此脚本同步到 Android APP。
REM    同步完成后可直接运行 build-app.bat 或 配置打包.bat 打包 APK。
REM
REM  同步内容：
REM    1. index.html -> android/app/src/main/assets/public/index.html
REM    2. vendor/xlsx.full.min.js -> android/app/src/main/assets/public/vendor/xlsx.full.min.js
REM
REM  使用方法：
REM    双击运行，或命令行执行 sync-to-app.bat
REM ============================================================

set "SRC=%~dp0"
set "ANDROID_PUBLIC=%~dp0android\app\src\main\assets\public"

echo.
echo ================================================================
echo  离线项目三端同步 - db-geren (个人版)
echo ================================================================
echo  源目录: %SRC%
echo  Android 目标目录: %ANDROID_PUBLIC%
echo.

if not exist "%ANDROID_PUBLIC%" (
    echo [警告] Android 目标目录不存在: %ANDROID_PUBLIC%
    echo        可能该版本不支持 Android 打包，跳过同步
    pause
    exit /b 0
)

echo [1/2] 同步 index.html ...
copy /Y "%SRC%index.html" "%ANDROID_PUBLIC%\index.html" >nul
if errorlevel 1 (
    echo [错误] index.html 同步失败
    pause
    exit /b 1
)
echo       index.html 已同步

echo [2/2] 同步 vendor/xlsx.full.min.js ...
if exist "%SRC%vendor\xlsx.full.min.js" (
    if not exist "%ANDROID_PUBLIC%\vendor" mkdir "%ANDROID_PUBLIC%\vendor" >nul
    copy /Y "%SRC%vendor\xlsx.full.min.js" "%ANDROID_PUBLIC%\vendor\xlsx.full.min.js" >nul
    if errorlevel 1 (
        echo [警告] xlsx.full.min.js 同步失败，继续
    ) else (
        echo       xlsx.full.min.js 已同步
    )
) else (
    echo [跳过] vendor/xlsx.full.min.js 不存在
)

echo [3/3] 同步 shared/ 共享模块...
set "SHARED_DIR=%~dp0..\..\shared"
if exist "%SHARED_DIR%\auth-core.js" (
    copy /Y "%SHARED_DIR%\auth-core.js" "%ANDROID_PUBLIC%\auth-core.js" >nul
    echo       auth-core.js 已同步
)
if exist "%SHARED_DIR%\permission.js" (
    copy /Y "%SHARED_DIR%\permission.js" "%ANDROID_PUBLIC%\permission.js" >nul
    echo       permission.js 已同步
)

echo.
echo ================================================================
echo  同步完成
echo ================================================================
echo.
echo  下一步：
echo   - 运行 配置打包.bat 进行个人化配置并打包 APK
echo   - 或进入 android 目录执行 gradlew assembleRelease 打包
echo.
pause