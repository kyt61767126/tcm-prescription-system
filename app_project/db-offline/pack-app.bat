@echo off
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"
title 惠康中医离线APP打包工具（机构版）

REM pack-app.bat - APP 打包入口（Capacitor Android APK，机构版）
REM 调用 app/build-app.bat，该脚本处理完整 10 步流程并复制 APK 到父目录

set "CAP_DIR=%~dp0app"
if not exist "%CAP_DIR%\build-app.bat" (
    echo [错误] 未找到 Capacitor APP 构建脚本: %CAP_DIR%\build-app.bat
    if not defined NO_PAUSE pause
    exit /b 1
)

REM 记录开始时间
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"

echo ============================================
echo   惠康中医离线APP打包工具（机构版）
echo   版本: dingzhi（机构版）
echo   开始: %BUILD_START_TIME%
echo ============================================
echo.

set "NO_PAUSE=1"
call "%CAP_DIR%\build-app.bat"
set "EXIT_CODE=%errorlevel%"
set "NO_PAUSE="

for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
for /f "delims=" %%e in ('powershell -NoProfile -Command "$s=[DateTime]::Parse('%BUILD_START_TIME%'); $e=[DateTime]::Parse('%BUILD_END_TIME%'); $d=$e-$s; $d.ToString('hh\:mm\:ss')"') do set "BUILD_ELAPSED=%%e"

echo.
if %EXIT_CODE% neq 0 (
    echo ========================================
    echo   [错误] 构建失败，退出码: %EXIT_CODE%
    echo   耗时: %BUILD_ELAPSED%
    echo ========================================
) else (
    echo ========================================
    echo   [OK] 离线 APP（机构版）构建完成!
    echo   APK: %~dp0惠康中医-LJ.apk
    echo   开始: %BUILD_START_TIME%
    echo   结束: %BUILD_END_TIME%
    echo   总耗时: %BUILD_ELAPSED%
    echo ========================================
)
echo.
if not defined NO_PAUSE (
    set "EXIT_KEY="
    set /p "EXIT_KEY=按 0 或回车键退出: "
)
exit /b %EXIT_CODE%
