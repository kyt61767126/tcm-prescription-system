@echo off
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

REM pack-desktop-geren.bat - Cloud Personal Desktop Build entry (Electron exe)
REM Direct build, calls cloud_desktop_geren/build.bat

set "BUILD_BAT=%~dp0cloud_desktop_geren\build.bat"
if not exist "%BUILD_BAT%" (
    echo [ERROR] cloud_desktop_geren\build.bat not found
    echo   Path: %BUILD_BAT%
    if not defined NO_PAUSE pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found
    echo   Please install from https://nodejs.org/
    if not defined NO_PAUSE pause
    exit /b 1
)

REM Record start time
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"

echo ============================================
echo   Huikang-TCM Build - Cloud Desktop (Personal)
echo   Start: %BUILD_START_TIME%
echo ============================================
echo.

call "%BUILD_BAT%"
set "EXIT_CODE=%errorlevel%"

for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
for /f "delims=" %%e in ('powershell -NoProfile -Command "$s=[DateTime]::Parse('%BUILD_START_TIME%'); $e=[DateTime]::Parse('%BUILD_END_TIME%'); $d=$e-$s; $d.ToString('hh\:mm\:ss')"') do set "BUILD_ELAPSED=%%e"

echo.
if %EXIT_CODE% neq 0 (
    powershell -NoProfile -Command "Write-Host '========================================' -ForegroundColor Red; Write-Host '  [ERROR] Build failed, exit code: %EXIT_CODE%' -ForegroundColor Red; Write-Host '  Elapsed: %BUILD_ELAPSED%' -ForegroundColor Red; Write-Host '========================================' -ForegroundColor Red"
) else (
    powershell -NoProfile -Command "Write-Host '========================================' -ForegroundColor Yellow; Write-Host '  [OK] Cloud Desktop (Personal) build complete!' -ForegroundColor Yellow; Write-Host '  Start: %BUILD_START_TIME%' -ForegroundColor Yellow; Write-Host '  End: %BUILD_END_TIME%' -ForegroundColor Yellow; Write-Host '  Elapsed: %BUILD_ELAPSED%' -ForegroundColor Yellow; Write-Host '========================================' -ForegroundColor Yellow"
)
echo.
exit /b %EXIT_CODE%
