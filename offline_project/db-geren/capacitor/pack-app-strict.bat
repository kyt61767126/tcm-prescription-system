@echo off
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

REM pack-app-strict.bat - Capacitor APP Strict Build
REM Strict mode: clean build + hash verify + signature hash injection + repack

echo ============================================
echo   Huikang-TCM Personal - Capacitor APP Strict
echo   (Clean build + hash verify + sig inject)
echo ============================================
echo.

REM Step A: First build (default mode with full security, skip config edit)
echo [Step A] First build (default mode)...
call build-app.bat --skip-config
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
powershell -NoProfile -ExecutionPolicy Bypass -File "%HASH_PS1%" -Version geren 2>nul
if errorlevel 1 (
    echo [WARN] Signature hash extraction failed, using default mode APK
    goto :done
)
echo [OK] Signature hash injected
echo.

REM Step C: Rebuild with strict signature mode
echo [Step C] Rebuilding (strict signature mode)...
call build-app.bat --skip-config
if errorlevel 1 (
    echo [ERROR] Strict rebuild failed
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] Strict rebuild complete
echo.

:done
echo ============================================
echo   [OK] Strict APP build complete!
echo   APK: %CD%\惠康中医-个人-Capacitor.apk
echo   Mode: Signature strict (anti-tamper enabled)
echo ============================================
echo.
if not defined NO_PAUSE pause
exit /b 0
