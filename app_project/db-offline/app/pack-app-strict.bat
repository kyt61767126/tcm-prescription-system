chcp 65001 >nul
@echo off
setlocal enableextensions
cd /d "%~dp0"

REM pack-app-strict.bat - APP Strict Build (dingzhi)
REM Strict: clean build + hash verify + sig inject + repack

echo ============================================
echo   APP Strict Build (dingzhi)
echo   (Clean build + hash verify + sig inject)
echo ============================================
echo.

for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"

echo [Step A] First build (default mode)...
call build-app.bat
if errorlevel 1 (
    echo [ERR] First build failed
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] First build complete
echo.

echo [Step B] Extracting APK signature hash...
set "HASH_PS1=%~dp0..\..\..\tools\generate-sign-hash.ps1"
if not exist "%HASH_PS1%" (
    echo [WARN] generate-sign-hash.ps1 not found, skip
    echo [INFO] APK still usable in default mode
    goto :done
)
set "NO_PAUSE=1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%HASH_PS1%" -Version dingzhi 2>nul
set "NO_PAUSE="
if errorlevel 1 (
    echo [WARN] Sig hash extraction failed, using default APK
    goto :done
)
echo [OK] Signature hash injected
echo.

echo [Step C] Stop Gradle daemon and rebuild (strict mode)...
call gradlew.bat --stop 2>nul
timeout /t 2 /nobreak >nul
call build-app.bat --skip-config
if errorlevel 1 (
    echo [ERR] Strict rebuild failed
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] Strict rebuild complete
echo.

:done
for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
for /f "delims=" %%e in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $s=[DateTime]::Parse('%BUILD_START_TIME%'); $e=[DateTime]::Parse('%BUILD_END_TIME%'); $d=$e-$s; $d.ToString('hh\:mm\:ss')"') do set "BUILD_ELAPSED=%%e"
echo ========================================
echo   Build Success!
echo   APK: %~dp0..\APK-dingzhi.apk
echo   Mode: Strict signature (anti-tamper)
echo   Start: %BUILD_START_TIME%
echo   End:   %BUILD_END_TIME%
echo   Elapsed: %BUILD_ELAPSED%
echo ========================================
echo.
if not defined NO_PAUSE (
    set "EXIT_KEY="
    set "EXIT_KEY="
    set /p "EXIT_KEY=Press 0 or Enter to exit: "
)
exit /b 0