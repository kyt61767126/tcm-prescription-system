@echo off
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"
title 惠康中医离线桌面版打包工具（标准版）

REM pack-desktop-geren.bat - 离线桌面版打包入口（标准版，Electron exe）
set "PACK_PS1=%~dp0..\..\tools\pack.ps1"
if not exist "%PACK_PS1%" (
    echo [错误] 未找到 pack.ps1
    if not defined NO_PAUSE pause
    exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 Node.js
    if not defined NO_PAUSE pause
    exit /b 1
)

REM [0.5] 打包前修复 .ps1 BOM 编码（自愈、幂等）
echo [0.5] 修复 .ps1 BOM 编码...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\fix-ps1-bom.ps1"
echo.

REM 记录开始时间
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"

echo ============================================
echo   惠康中医离线桌面版打包工具（标准版）
echo   开始: %BUILD_START_TIME%
echo ============================================
echo.

REM [1] 预检查：关键 node_modules 完整性（快速失败，提示解决方案）
REM 历史教训(BUILD_ELECTRON-004): 中断构建后 node_modules 可能不完整，
REM 导致 electron-builder 阶段报 'Cannot find module builder-util'。提前检测并提示。
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

for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
for /f "delims=" %%e in ('powershell -NoProfile -Command "$s=[DateTime]::Parse('%BUILD_START_TIME%'); $e=[DateTime]::Parse('%BUILD_END_TIME%'); $d=$e-$s; $d.ToString('hh\:mm\:ss')"') do set "BUILD_ELAPSED=%%e"

echo.
if %EXIT_CODE% neq 0 (
    powershell -NoProfile -Command "Write-Host '========================================' -ForegroundColor Red; Write-Host '  [错误] 构建失败，退出码: %EXIT_CODE%' -ForegroundColor Red; Write-Host '  耗时: %BUILD_ELAPSED%' -ForegroundColor Red; Write-Host '  日志:   %~dp0logs\packaging-*.log' -ForegroundColor Red; Write-Host '  诊断: powershell -File %~dp0..\..\tools\pack-diagnostics.ps1 -LogFile <log>' -ForegroundColor Red; Write-Host '========================================' -ForegroundColor Red"
) else (
    powershell -NoProfile -Command "Write-Host '========================================' -ForegroundColor Yellow; Write-Host '  [OK] 离线桌面版（标准版）构建完成!' -ForegroundColor Yellow; Write-Host '  产物: %~dp0desktop_geren\dist\惠康中医-LB.exe' -ForegroundColor Yellow; Write-Host '  开始: %BUILD_START_TIME%' -ForegroundColor Yellow; Write-Host '  结束: %BUILD_END_TIME%' -ForegroundColor Yellow; Write-Host '  总耗时: %BUILD_ELAPSED%' -ForegroundColor Yellow; Write-Host '========================================' -ForegroundColor Yellow"
)
echo.
exit /b %EXIT_CODE%
