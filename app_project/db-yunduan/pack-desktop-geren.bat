@echo off
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"
title 惠康中医云端桌面版打包工具（标准版）

REM pack-desktop-geren.bat - 云端桌面版打包入口（标准版，Electron exe）
REM 直接构建，调用 cloud_desktop_geren/build.bat

set "BUILD_BAT=%~dp0cloud_desktop_geren\build.bat"
if not exist "%BUILD_BAT%" (
    echo [错误] 未找到 cloud_desktop_geren\build.bat
    echo   路径: %BUILD_BAT%
    if not defined NO_PAUSE pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 Node.js
    echo   请从 https://nodejs.org/ 安装
    if not defined NO_PAUSE pause
    exit /b 1
)

REM 记录开始时间
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"

echo ============================================
echo   惠康中医云端桌面版打包工具（标准版）
echo   开始: %BUILD_START_TIME%
echo ============================================
echo.

call "%BUILD_BAT%"
set "EXIT_CODE=%errorlevel%"

for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
for /f "delims=" %%e in ('powershell -NoProfile -Command "$s=[DateTime]::Parse('%BUILD_START_TIME%'); $e=[DateTime]::Parse('%BUILD_END_TIME%'); $d=$e-$s; $d.ToString('hh\:mm\:ss')"') do set "BUILD_ELAPSED=%%e"

echo.
if %EXIT_CODE% neq 0 (
    powershell -NoProfile -Command "Write-Host '========================================' -ForegroundColor Red; Write-Host '  [错误] 构建失败，退出码: %EXIT_CODE%' -ForegroundColor Red; Write-Host '  耗时: %BUILD_ELAPSED%' -ForegroundColor Red; Write-Host '========================================' -ForegroundColor Red"
) else (
    powershell -NoProfile -Command "Write-Host '========================================' -ForegroundColor Yellow; Write-Host '  [OK] 云端桌面版（标准版）构建完成!' -ForegroundColor Yellow; Write-Host '  开始: %BUILD_START_TIME%' -ForegroundColor Yellow; Write-Host '  结束: %BUILD_END_TIME%' -ForegroundColor Yellow; Write-Host '  总耗时: %BUILD_ELAPSED%' -ForegroundColor Yellow; Write-Host '========================================' -ForegroundColor Yellow"
)
echo.
exit /b %EXIT_CODE%
