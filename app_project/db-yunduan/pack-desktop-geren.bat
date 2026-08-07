chcp 65001 >nul
@echo off
setlocal enableextensions
cd /d "%~dp0"
title Huikang-TCM Build Tool

REM pack-desktop-geren.bat - Electron exe
REM cloud_desktop_geren/build.bat

set "BUILD_BAT=%~dp0cloud_desktop_geren\build.bat"
if not exist "%BUILD_BAT%" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] 未找到 cloud_desktop_geren\build.bat'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '路径: %BUILD_BAT%'"
    if not defined NO_PAUSE pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] 未找到 Node.js'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '请从 https://nodejs.org/ 安装'"
    if not defined NO_PAUSE pause
    exit /b 1
)

REM
for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"

echo ============================================
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '惠康中医云端桌面版打包工具（标准版）'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '开始: %BUILD_START_TIME%'"
echo ============================================
echo.

call "%BUILD_BAT%"
set "EXIT_CODE=%errorlevel%"

for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
for /f "delims=" %%e in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $s=[DateTime]::Parse('%BUILD_START_TIME%'); $e=[DateTime]::Parse('%BUILD_END_TIME%'); $d=$e-$s; $d.ToString('hh\:mm\:ss')"') do set "BUILD_ELAPSED=%%e"

echo.
if %EXIT_CODE% neq 0 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '========================================' -ForegroundColor Red; Write-Host '  [错误] 构建失败，退出码: %EXIT_CODE%' -ForegroundColor Red; Write-Host '  耗时: %BUILD_ELAPSED%' -ForegroundColor Red; Write-Host '========================================' -ForegroundColor Red"
) else (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '========================================' -ForegroundColor Yellow; Write-Host '  [OK] 云端桌面版（标准版）构建完成!' -ForegroundColor Yellow; Write-Host '  开始: %BUILD_START_TIME%' -ForegroundColor Yellow; Write-Host '  结束: %BUILD_END_TIME%' -ForegroundColor Yellow; Write-Host '  耗时: %BUILD_ELAPSED%' -ForegroundColor Yellow; Write-Host '========================================' -ForegroundColor Yellow"
)
echo.
if not defined NO_PAUSE (
    set "EXIT_KEY="
    set /p "EXIT_KEY=
 0 :
"
)

exit /b %EXIT_CODE%
