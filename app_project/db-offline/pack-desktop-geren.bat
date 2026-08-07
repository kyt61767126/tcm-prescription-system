chcp 65001 >nul
@echo off
setlocal enableextensions
cd /d "%~dp0"
title Huikang-TCM Build Tool

REM pack-desktop-geren.bat - Electron exe
set "PACK_PS1=%~dp0..\..\tools\pack.ps1"
if not exist "%PACK_PS1%" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] 未找到 pack.ps1'"
    if not defined NO_PAUSE pause
    exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] 未找到 Node.js'"
    if not defined NO_PAUSE pause
    exit /b 1
)

REM [0.5] .ps1 BOM
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[0.5] 修复 .ps1 BOM 编码...'"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\fix-ps1-bom.ps1"
echo.

REM
for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"

echo ============================================
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '惠康中医离线桌面版打包工具（标准版）'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '开始: %BUILD_START_TIME%'"
echo ============================================
echo.

REM [1] node_modules
REM (BUILD_ELECTRON-004): node_modules
REM electron-builder 'Cannot find module builder-util'
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$d='%~dp0desktop_geren\node_modules';" ^
  "$critical=@('electron\package.json','electron-builder\package.json','builder-util\package.json','builder-util-runtime\package.json','app-builder-lib\package.json','@electron\get\package.json');" ^
  "$missing=@(); foreach($m in $critical){ if(-not(Test-Path \"$d\$m\")){ $missing+=$m } };" ^
  "if($missing.Count -gt 0){" ^
  "  Write-Host '[警告] node_modules 不完整（缺少 package.json）:' -ForegroundColor Yellow;" ^
  "  $missing|ForEach-Object{ Write-Host '  - '$_ };" ^
  "  Write-Host '[提示] pack.ps1 将自动清理并重装。继续执行...' -ForegroundColor Cyan" ^
  "} else { Write-Host '[OK] node_modules 完整性检查通过' -ForegroundColor Green }"
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%PACK_PS1%" -Version geren -Target desktop
set "EXIT_CODE=%errorlevel%"

for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
for /f "delims=" %%e in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $s=[DateTime]::Parse('%BUILD_START_TIME%'); $e=[DateTime]::Parse('%BUILD_END_TIME%'); $d=$e-$s; $d.ToString('hh\:mm\:ss')"') do set "BUILD_ELAPSED=%%e"

echo.
if %EXIT_CODE% neq 0 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '========================================' -ForegroundColor Red; Write-Host '  [错误] 构建失败，退出码: %EXIT_CODE%' -ForegroundColor Red; Write-Host '  耗时: %BUILD_ELAPSED%' -ForegroundColor Red; Write-Host '  日志:   %~dp0logs\packaging-*.log' -ForegroundColor Red; Write-Host '  诊断: powershell -File %~dp0..\..\tools\pack-diagnostics.ps1 -LogFile <log>' -ForegroundColor Red; Write-Host '========================================' -ForegroundColor Red"
) else (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '========================================' -ForegroundColor Yellow; Write-Host '  [OK] 离线桌面版（标准版）构建完成!' -ForegroundColor Yellow; Write-Host '  产物: %~dp0desktop_geren\dist\惠康中医-LB.exe' -ForegroundColor Yellow; Write-Host '  开始: %BUILD_START_TIME%' -ForegroundColor Yellow; Write-Host '  结束: %BUILD_END_TIME%' -ForegroundColor Yellow; Write-Host '  总耗时: %BUILD_ELAPSED%' -ForegroundColor Yellow; Write-Host '========================================' -ForegroundColor Yellow"
)
echo.
if not defined NO_PAUSE (
    set "EXIT_KEY="
    set "EXIT_KEY="
    set /p "EXIT_KEY=Press 0 or Enter to exit: "
)
exit /b %EXIT_CODE%
