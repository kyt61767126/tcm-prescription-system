@echo off
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

REM pack-desktop-geren.bat - Desktop build entry (Electron exe, personal edition)
set "PACK_PS1=%~dp0..\..\tools\pack.ps1"
if not exist "%PACK_PS1%" (
    echo [ERROR] pack.ps1 not found
    if not defined NO_PAUSE pause
    exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found
    if not defined NO_PAUSE pause
    exit /b 1
)

REM [0.5] Pre-build: fix .ps1 BOM encoding (self-healing, idempotent)
echo [0.5] Fixing .ps1 BOM encoding...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\fix-ps1-bom.ps1"
echo.

REM Record start time
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"

echo ============================================
echo   Huikang-TCM Build - Desktop (Personal)
echo   Start: %BUILD_START_TIME%
echo ============================================
echo.

REM [1] Pre-check: critical node_modules integrity (fail-fast, hint solution)
REM Historical lesson (BUILD_ELECTRON-004): node_modules may be incomplete after interrupted build,
REM causing 'Cannot find module builder-util' at electron-builder stage. Detect early and hint.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$d='%~dp0desktop_geren\node_modules';" ^
  "$critical=@('electron\package.json','electron-builder\package.json','builder-util\package.json','builder-util-runtime\package.json','app-builder-lib\package.json','@electron\get\package.json');" ^
  "$missing=@(); foreach($m in $critical){ if(-not(Test-Path \"$d\$m\")){ $missing+=$m } };" ^
  "if($missing.Count -gt 0){" ^
  "  Write-Host '[WARN] node_modules incomplete (missing package.json):' -ForegroundColor Yellow;" ^
  "  $missing|ForEach-Object{ Write-Host '  - '$_ };" ^
  "  Write-Host '[INFO] pack.ps1 will auto-clean and reinstall. Continuing...' -ForegroundColor Cyan" ^
  "} else { Write-Host '[OK] node_modules integrity check passed' -ForegroundColor Green }"
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%PACK_PS1%" -Version geren -Target desktop
set "EXIT_CODE=%errorlevel%"

for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
for /f "delims=" %%e in ('powershell -NoProfile -Command "$s=[DateTime]::Parse('%BUILD_START_TIME%'); $e=[DateTime]::Parse('%BUILD_END_TIME%'); $d=$e-$s; $d.ToString('hh\:mm\:ss')"') do set "BUILD_ELAPSED=%%e"

echo.
if %EXIT_CODE% neq 0 (
    powershell -NoProfile -Command "Write-Host '========================================' -ForegroundColor Red; Write-Host '  [ERROR] Build failed, exit code: %EXIT_CODE%' -ForegroundColor Red; Write-Host '  Elapsed: %BUILD_ELAPSED%' -ForegroundColor Red; Write-Host '  Log:     %~dp0logs\packaging-*.log' -ForegroundColor Red; Write-Host '  Diagnose: powershell -File %~dp0..\..\tools\pack-diagnostics.ps1 -LogFile <log>' -ForegroundColor Red; Write-Host '========================================' -ForegroundColor Red"
) else (
    powershell -NoProfile -Command "Write-Host '========================================' -ForegroundColor Yellow; Write-Host '  [OK] Desktop (Personal) build complete!' -ForegroundColor Yellow; Write-Host '  Product: %~dp0desktop_geren\dist\惠康中医-LB.exe' -ForegroundColor Yellow; Write-Host '  Start: %BUILD_START_TIME%' -ForegroundColor Yellow; Write-Host '  End: %BUILD_END_TIME%' -ForegroundColor Yellow; Write-Host '  Elapsed: %BUILD_ELAPSED%' -ForegroundColor Yellow; Write-Host '========================================' -ForegroundColor Yellow"
)
echo.
exit /b %EXIT_CODE%
