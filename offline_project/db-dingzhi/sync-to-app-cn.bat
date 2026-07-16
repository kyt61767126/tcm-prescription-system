@echo off
title Sync to APP - Custom Edition
setlocal

set "SRC=%~dp0"
set "ANDROID_PUBLIC=%~dp0android\app\src\main\assets\public"
set "ANDROID_ASSETS=%~dp0android\app\src\main\assets"

echo.
echo ================================================================
echo  离线项目三端同步 - db-dingzhi (定制版)
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

echo [1/4] 同步 index.html ...
copy /Y "%SRC%index.html" "%ANDROID_PUBLIC%\index.html" >nul
if errorlevel 1 (
    echo [错误] index.html 同步失败
    pause
    exit /b 1
)
echo       index.html 已同步

echo [2/4] 同步 vendor/xlsx.full.min.js ...
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

echo [3/4] 同步核心 JS 模块...
set "MODULES=auth-core.js db-adapter.js debug-logger.js medicine-dict.js patient-archive.js performance-utils.js permission.js prescription-core.js print-utils.js"
for %%m in (%MODULES%) do (
    if exist "%SRC%%%m" (
        copy /Y "%SRC%%%m" "%ANDROID_PUBLIC%\%%m" >nul
        if errorlevel 1 (
            echo [警告] %%m 同步失败，继续
        ) else (
            echo       %%m 已同步
        )
    ) else (
        echo [跳过] %%m 不存在
    )
)

echo [4/4] 同步录像拍照脚本 video-recorder-inject.js ...
if exist "%SRC%video-recorder-inject.js" (
    copy /Y "%SRC%video-recorder-inject.js" "%ANDROID_ASSETS%\video-recorder-inject.js" >nul
    if errorlevel 1 (
        echo [警告] video-recorder-inject.js 同步失败
    ) else (
        echo       video-recorder-inject.js 已同步
    )
) else (
    echo [跳过] video-recorder-inject.js 不存在于源目录
)

echo.
echo ================================================================
echo  同步完成
echo ================================================================
echo.
echo  下一步：
echo   - 运行 build-app.bat 打包 APK
echo   - 或进入 android 目录执行 gradlew assembleRelease 打包
echo.
pause
