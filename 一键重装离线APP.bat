@echo off
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

REM ============================================================================
REM ??????APP.bat ? ??????????APP?????APK?USB????
REM ??? tools\reinstall-offline-apk.ps1?????? ASCII-only???????
REM ??????? USB ???????????
REM ============================================================================

set "PS1=%~dp0tools\reinstall-offline-apk.ps1"
if not exist "%PS1%" (
    echo [ERROR] tools\reinstall-offline-apk.ps1 not found
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set "RC=%errorlevel%"

echo.
if not defined NO_PAUSE pause
exit /b %RC%
