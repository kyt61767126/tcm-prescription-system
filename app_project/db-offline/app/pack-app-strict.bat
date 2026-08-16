@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

REM ============================================================
REM pack-app-strict.bat - Offline APP Standard (Strict)
REM 严格模式：直接调用 build-app.bat standard
REM build-app.bat 内置 签名哈希刷新 + Java层混淆 + 签名校验，
REM 严格模式下哈希刷新失败会强制中断，防止重打包签名不匹配
REM ============================================================

set "PACK_APP_BAT=%~dp0build-app.bat"

if not exist "%PACK_APP_BAT%" (
    echo [ERROR] build-app.bat not found
    pause
    exit /b 1
)

set "SAVED_NO_PAUSE=%NO_PAUSE%"
set "NO_PAUSE=1"
call "%PACK_APP_BAT%" standard
set "TEMP_RC=%errorlevel%"
set "NO_PAUSE=%SAVED_NO_PAUSE%"
if %TEMP_RC% neq 0 (
    echo [ERROR] Build failed, exit code: %TEMP_RC%
    pause
    exit /b %TEMP_RC%
)

echo.
echo [OK] 离线APP（严格模式）打包完成
echo      APK: 惠康中医-本地.apk
echo.
if not defined NO_PAUSE pause
exit /b 0
