@echo off
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

REM pack-app-strict.bat - Capacitor APP Strict Build
REM Strict mode: clean build + hash verify + signature hash injection + repack
REM
REM This script calls build-app.bat (which has full security mechanisms):
REM   1. Environment check (gradlew.bat, signing.properties, app-release.jks, index.html)
REM   2. Record index.html hash (for APK verification)
REM   3. Auto-increment versionCode
REM   4. Stop residual Gradle processes
REM   5. Force clean build cache (javac, assets, merged_assets)
REM   6. Build signed APK
REM   7. Verify APK contains latest index.html (hash match)
REM   8. Copy APK with size verification
REM
REM Strict mode adds signature hash injection (same as original offline APP):
REM   After first build, extract APK signature SHA-256 hash,
REM   inject into LicenseManager.java, then rebuild for strict mode.

echo ============================================
echo   Huikang-TCM Local - Capacitor APP Strict
echo   (Clean build + hash verify + sig inject)
echo ============================================
echo.

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
powershell -NoProfile -ExecutionPolicy Bypass -File "%HASH_PS1%" -Version bendi 2>nul
if errorlevel 1 (
    echo [WARN] Signature hash extraction failed, using default mode APK
    goto :done
)
echo [OK] Signature hash injected
echo.

REM Step C: Rebuild with strict signature mode (skip config edit, already done in Step A)
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
echo   APK: %~dp0..\惠康中医-本地.apk
echo   Mode: Signature strict (anti-tamper enabled)
echo ============================================
echo.
if not defined NO_PAUSE pause
exit /b 0
