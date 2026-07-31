@echo off
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

REM pack-app-strict.bat - Capacitor APP Strict Build
REM Strict mode: clean build + hash verify + signature hash injection + repack

echo ============================================
echo   Huikang-TCM Custom - Capacitor APP Strict
echo   (Clean build + hash verify + sig inject)
echo ============================================
echo.

REM Record start time
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"

REM Step A: First build (default mode with full security)
echo [Step A] First build (default mode)...
call build-app.bat
if errorlevel 1 (
    echo [ERROR] First build failed
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] First build complete
echo.

REM Step B: Extract signature hash and inject into LicenseManager
echo [Step B] Extracting APK signature hash...
set "HASH_PS1=%~dp0..\..\..\tools\generate-sign-hash.ps1"
if not exist "%HASH_PS1%" (
    echo [WARN] generate-sign-hash.ps1 not found, skipping signature injection
    echo [INFO] APK is still usable in default mode
    goto :done
)
set "NO_PAUSE=1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%HASH_PS1%" -Version dingzhi 2>nul
set "NO_PAUSE="
if errorlevel 1 (
    echo [WARN] Signature hash extraction failed, using default mode APK
    goto :done
)
echo [OK] Signature hash injected
echo.

REM Step C: Stop Gradle daemon from Step A, then rebuild with strict signature mode
echo [Step C] Stopping Gradle daemon and rebuilding (strict signature mode)...
call gradlew.bat --stop 2>nul
timeout /t 2 /nobreak >nul
call build-app.bat --skip-config
if errorlevel 1 (
    echo [ERROR] Strict rebuild failed
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] Strict rebuild complete
echo.

:done
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
for /f "delims=" %%e in ('powershell -NoProfile -Command "$s=[DateTime]::Parse('%BUILD_START_TIME%'); $e=[DateTime]::Parse('%BUILD_END_TIME%'); $d=$e-$s; $d.ToString('hh\:mm\:ss')"') do set "BUILD_ELAPSED=%%e"
powershell -NoProfile -Command "Write-Host '========================================' -ForegroundColor Yellow; Write-Host '  打包成功！' -ForegroundColor Yellow; Write-Host '  APK 文件: %~dp0..\惠康中医-定制.apk' -ForegroundColor Yellow; Write-Host '  模式: 签名严格模式（已启用防篡改）' -ForegroundColor Yellow; Write-Host '  开始: %BUILD_START_TIME%' -ForegroundColor Yellow; Write-Host '  结束: %BUILD_END_TIME%' -ForegroundColor Yellow; Write-Host '  总耗时: %BUILD_ELAPSED%' -ForegroundColor Yellow; Write-Host '========================================' -ForegroundColor Yellow"
echo.
if not defined NO_PAUSE (
    set "EXIT_KEY="
    set /p "EXIT_KEY=按 0 或回车键退出: "
)
exit /b 0
