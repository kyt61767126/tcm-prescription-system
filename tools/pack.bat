@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

set "SELF_DIR=%~dp0"
set "PROJECT_ROOT=%SELF_DIR%.."
set "PACK_PS1=%SELF_DIR%pack.ps1"

if not exist "%PACK_PS1%" (
    echo [ERROR] pack.ps1 not found: %PACK_PS1%
    pause
    exit /b 1
)

if "%1"=="" goto :show_usage
if "%1"=="/?" goto :show_usage
if "%1"=="-h" goto :show_usage
if "%1"=="help" goto :show_usage

:run_pack
powershell -ExecutionPolicy Bypass -File "%PACK_PS1%" %*
exit /b %errorlevel%

:show_usage
echo ==============================================
echo   TCM Prescription Packaging Module
echo ==============================================
echo.
echo Usage: pack.bat ^<options^>
echo.
echo Options:
echo   -Version bendi    Build local edition
echo   -Version dingzhi  Build custom edition
echo   -Version geren    Build personal edition
echo   -Target desktop   Build only desktop (Electron exe)
echo   -Target app       Build only mobile (Android APK)
echo   -Target all       Build both desktop and mobile
echo   -Target sync      Sync files to Android only
echo   -Target config    Modify clinic config only
echo   -Target encoding  Encoding check only
echo   -Interactive      Show interactive menu
echo   -SkipConfig       Skip clinic config modification
echo   -SkipEncodingCheck Skip encoding verification
echo.
echo Examples:
echo   pack.bat -Version bendi -Interactive
echo   pack.bat -Version bendi -Target desktop
echo   pack.bat -Version bendi -Target app -SkipConfig
echo   pack.bat -Version dingzhi -Target all
echo.
echo ==============================================
pause
exit /b 0