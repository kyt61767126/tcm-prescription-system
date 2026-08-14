@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "PACK_APP_BAT=%~dp0build-app.bat"
set "GEN_HASH_PS1=%~dp0..\..\tools\generate-sign-hash.ps1"

echo ============================================
echo   Step A: Build APK - Institutional mode...
echo ============================================
echo.

set "NO_PAUSE=1"
call "%PACK_APP_BAT%" institutional
set "TEMP_RC=%errorlevel%"
set "NO_PAUSE="
if %TEMP_RC% neq 0 (
    echo.
    echo [ERROR] Step A build failed, exit code: %TEMP_RC%
    echo.
    pause
    exit /b %TEMP_RC%
)
echo.
echo [OK] Step A completed
echo.

echo ============================================
echo   Step B: Extract sign hash...
echo ============================================
echo.

set "NO_PAUSE=1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%GEN_HASH_PS1%" -Version cloud-institutional
set "TEMP_RC=%errorlevel%"
set "NO_PAUSE="
if %TEMP_RC% neq 0 (
    echo.
    echo [ERROR] Step B sign hash failed, exit code: %TEMP_RC%
    echo.
    pause
    exit /b %TEMP_RC%
)
echo.
echo [OK] Step B completed
echo.

echo ============================================
echo   Step C: Rebuild APK - Strict mode...
echo ============================================
echo.

set "NO_PAUSE=1"
call "%PACK_APP_BAT%" institutional
set "TEMP_RC=%errorlevel%"
set "NO_PAUSE="
if %TEMP_RC% neq 0 (
    echo.
    echo [ERROR] Step C rebuild failed, exit code: %TEMP_RC%
    echo.
    pause
    exit /b %TEMP_RC%
)
echo.
echo ============================================
echo   [OK] Cloud APP (Institutional Strict) completed
echo   APK: YJ.apk
echo ============================================
echo.
pause
exit /b 0
