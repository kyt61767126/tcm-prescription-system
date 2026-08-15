@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

REM ============================================================
REM pack-app-institutional-strict.bat - Offline APP Institutional (Strict)
REM Process: Step A (Build Institutional) -> Step B (Sign Hash) -> Step C (Strict Rebuild)
REM ============================================================

set "PROJECT_DIR=%~dp0"
set "PACK_APP_BAT=%~dp0build-app.bat"
set "GEN_HASH_PS1=%~dp0..\..\..\tools\generate-sign-hash.ps1"

echo ============================================
echo   Huikang TCM Offline APP (Institutional Strict)
echo ============================================
echo.

if not exist "%PACK_APP_BAT%" (
    echo [ERROR] build-app.bat not found
    pause
    exit /b 1
)
if not exist "%GEN_HASH_PS1%" (
    echo [ERROR] generate-sign-hash.ps1 not found
    pause
    exit /b 1
)

echo [Step 0] Java pre-compile check...
pushd "%PROJECT_DIR%"
call gradlew.bat :app:javaPreCompileRelease :app:compileReleaseJavaWithJavac --quiet 2>&1
set "PRECOMPILE_RC=%errorlevel%"
popd
if %PRECOMPILE_RC% neq 0 (
    echo [ERROR] Java pre-compile check failed
    pause
    exit /b 1
)
echo [OK] Java pre-compile passed
echo.

echo [Step A] Build APK - Institutional mode...
set "NO_PAUSE=1"
call "%PACK_APP_BAT%" institutional
set "TEMP_RC=%errorlevel%"
set "NO_PAUSE="
if %TEMP_RC% neq 0 (
    echo [ERROR] Step A build failed, exit code: %TEMP_RC%
    pause
    exit /b %TEMP_RC%
)
echo.

echo [Step B] Extract sign hash and inject SecurityGuard.java...
set "NO_PAUSE=1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%GEN_HASH_PS1%" -Version dingzhi
set "TEMP_RC=%errorlevel%"
set "NO_PAUSE="
if %TEMP_RC% neq 0 (
    echo [ERROR] Step B sign hash extraction failed, exit code: %TEMP_RC%
    pause
    exit /b %TEMP_RC%
)
echo.

echo [Step C] Rebuild APK - Strict mode (Institutional)...
echo   [INFO] Skip manual --stop (build-app.bat handles it)
set "NO_PAUSE=1"
call "%PACK_APP_BAT%" institutional
set "TEMP_RC=%errorlevel%"
set "NO_PAUSE="
if %TEMP_RC% neq 0 (
    echo [ERROR] Step C rebuild failed, exit code: %TEMP_RC%
    pause
    exit /b %TEMP_RC%
)

echo.
echo [OK] Offline APP (Institutional Strict) build completed
echo      APK: 惠康中医-本地.apk
echo.
if not defined NO_PAUSE pause
exit /b 0
