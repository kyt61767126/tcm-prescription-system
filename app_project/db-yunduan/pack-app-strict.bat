chcp 65001 >nul
@echo off
setlocal enableextensions
cd /d "%~dp0"
title Huikang-TCM Build Tool

REM pack-app-strict.bat - Strict mode APP Build entry (APK + signature hash + repack)
REM Direct build, no menu interaction

set "PACK_PS1=%~dp0packaging.ps1"
if not exist "%PACK_PS1%" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] packaging.ps1 not found'"
    echo   Path: %PACK_PS1%
    if not defined NO_PAUSE pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] Node.js not found'"
    echo   Please install from https://nodejs.org/
    if not defined NO_PAUSE pause
    exit /b 1
)

REM Record start time
for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"

echo ============================================
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '惠康中医云端APP打包工具（机构版·严格模式）'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '开始: %BUILD_START_TIME%'"
echo ============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%PACK_PS1%" -AutoAppStrict
set "EXIT_CODE=%errorlevel%"

for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
for /f "delims=" %%e in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $s=[DateTime]::Parse('%BUILD_START_TIME%'); $e=[DateTime]::Parse('%BUILD_END_TIME%'); $d=$e-$s; $d.ToString('hh\:mm\:ss')"') do set "BUILD_ELAPSED=%%e"

echo.
if %EXIT_CODE% neq 0 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '========================================' -ForegroundColor Red; Write-Host '  [错误] 构建失败，退出码: %EXIT_CODE%' -ForegroundColor Red; Write-Host '  耗时: %BUILD_ELAPSED%' -ForegroundColor Red; Write-Host '========================================' -ForegroundColor Red"
) else (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '========================================' -ForegroundColor Yellow; Write-Host '  [OK] APP构建完成!' -ForegroundColor Yellow; Write-Host '  开始: %BUILD_START_TIME%' -ForegroundColor Yellow; Write-Host '  结束: %BUILD_END_TIME%' -ForegroundColor Yellow; Write-Host '  耗时: %BUILD_ELAPSED%' -ForegroundColor Yellow; Write-Host '========================================' -ForegroundColor Yellow"
)
echo.
if not defined NO_PAUSE (
    set "EXIT_KEY="
    set "EXIT_KEY="
    set /p "EXIT_KEY=Press 0 or Enter to exit: "
)
exit /b %EXIT_CODE%
