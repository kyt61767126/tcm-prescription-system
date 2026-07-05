@echo off
chcp 65001 >nul
title 本能中医处方系统 - 云端APP打包工具

echo ============================================
echo   本能中医处方系统 - 云端APP打包工具
echo ============================================
echo.

set "PROJECT_DIR=%~dp0cloud_app"
set "ANDROID_DIR=%PROJECT_DIR%"
set "APK_OUTPUT_DIR=%ANDROID_DIR%\app\build\outputs\apk\release"
set "FINAL_APK=%~dp0中医处方系统-云端版.apk"

cd /d "%ANDROID_DIR%"

echo [1/6] 检查环境...
if not exist "gradlew.bat" (
    echo [错误] 未找到 gradlew.bat
    echo   路径: %ANDROID_DIR%\gradlew.bat
    pause
    exit /b 1
)
if not exist "app\signing.properties" (
    echo [错误] 未找到签名配置 signing.properties
    echo   路径: %ANDROID_DIR%\app\signing.properties
    pause
    exit /b 1
)
if not exist "app\app-release.jks" (
    echo [错误] 未找到签名密钥 app-release.jks
    echo   路径: %ANDROID_DIR%\app\app-release.jks
    pause
    exit /b 1
)
if not exist "app\src\main\assets\capacitor.config.json" (
    echo [错误] 未找到 Capacitor 配置文件
    echo   路径: %ANDROID_DIR%\app\src\main\assets\capacitor.config.json
    pause
    exit /b 1
)
echo [OK] 环境检查通过
echo.

echo [2/6] 当前配置信息...
findstr "url" "app\src\main\assets\capacitor.config.json"
findstr "versionName" "app\build.gradle"
echo.

echo [3/6] 停止残留 Gradle 进程...
taskkill /F /IM java.exe /FI "WINDOWTITLE eq gradle*" >nul 2>&1
echo [OK] 清理完成
echo.

echo [4/6] 清理旧构建缓存（强制重新打包，避免 APK 时间戳不更新）...
call gradlew.bat clean --no-daemon
if errorlevel 1 (
    echo [警告] clean 失败，继续使用增量构建
) else (
    echo [OK] 旧缓存已清除
)
echo.

echo [5/6] 开始构建签名 APK...
echo.
call gradlew.bat assembleRelease --no-daemon
if errorlevel 1 (
    echo.
    echo [错误] 构建失败！请检查错误信息
    pause
    exit /b 1
)
echo.

echo [6/6] 构建成功，复制 APK...
set "APK_FILE="
if exist "%APK_OUTPUT_DIR%\app-release.apk" (
    set "APK_FILE=%APK_OUTPUT_DIR%\app-release.apk"
) else (
    for %%f in ("%APK_OUTPUT_DIR%\*.apk") do (
        set "APK_FILE=%%f"
    )
)

if "%APK_FILE%"=="" (
    echo [错误] 未找到生成的 APK 文件
    echo   搜索目录: %APK_OUTPUT_DIR%
    pause
    exit /b 1
)

for %%A in ("%APK_FILE%") do (
    echo APK 文件: %%~nxA
    echo 文件大小: %%~zA bytes
)

copy /Y "%APK_FILE%" "%FINAL_APK%" >nul
if errorlevel 1 (
    echo [警告] 复制失败，请手动从以下目录获取 APK:
    echo   %APK_OUTPUT_DIR%
) else (
    echo [OK] 已复制到: %FINAL_APK%
)

echo.
echo ============================================
echo   打包完成！
echo   APK 路径: %FINAL_APK%
echo   该 APK 已签名，可直接安装到手机
echo ============================================
echo.
pause
