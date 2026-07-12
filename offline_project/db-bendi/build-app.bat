@echo off
chcp 65001 >nul
title 本能中医处方-本地 - 手机APP打包工具

echo ============================================
echo   本能中医处方-本地 - 手机APP打包工具
echo ============================================
echo.

cd /d "%~dp0\android"

echo [1/5] 检查环境...
if not exist "gradlew.bat" (
    echo [错误] 未找到 gradlew.bat
    pause
    exit /b 1
)
if not exist "app\signing.properties" (
    echo [错误] 未找到签名配置 signing.properties
    pause
    exit /b 1
)
if not exist "app\app-release.jks" (
    echo [错误] 未找到签名密钥 app-release.jks
    pause
    exit /b 1
)
if not exist "app\src\main\assets\public\index.html" (
    echo [错误] 未找到页面文件 index.html
    pause
    exit /b 1
)
echo [OK] 环境检查通过
echo.

echo [1.5/5] 停止残留 Gradle 进程...
taskkill /F /IM java.exe /FI "WINDOWTITLE eq gradle*" >nul 2>&1
echo [OK] 清理完成
echo.

echo [2/5] 清理构建缓存...
call gradlew.bat clean --no-daemon
if errorlevel 1 (
    echo [WARN] clean失败，继续增量构建
) else (
    echo [OK] 缓存已清理
)
echo.

echo [3/5] 开始构建签名 APK...
echo.
call gradlew.bat assembleRelease --no-daemon
if errorlevel 1 (
    echo.
    echo [错误] 构建失败！请检查错误信息
    pause
    exit /b 1
)
echo.
echo [4/5] 构建成功，定位 APK...
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
    echo [错误] 未找到生成的 APK 文件
    pause
    exit /b 1
)

for %%A in ("%APK_FILE%") do (
    echo APK 文件: %%~nxA
    echo 文件大小: %%~zA bytes
    echo 完整路径: %CD%\%%A
)
echo.

echo [5/5] 复制 APK 到打包目录...
set "FINAL_APK=..\本能中医处方-本地版-v1.0.apk"
copy /Y "%APK_FILE%" "%FINAL_APK%" >nul
if errorlevel 1 (
    echo [警告] 复制失败，请手动从 %APK_DIR% 获取 APK
) else (
    echo [OK] 已复制到: %CD%\%FINAL_APK%
)
echo.
echo ============================================
echo   打包完成！
echo   APK 路径: %CD%\%FINAL_APK%
echo   该 APK 已签名，可直接安装到手机
echo ============================================
echo.
pause
