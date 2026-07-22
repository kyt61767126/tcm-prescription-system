@echo off
setlocal enableextensions
cd /d "%~dp0"

REM pack-app-strict.bat - 严格模式APP打包入口（APK+签名哈希+重打包）
REM 直接打包，无菜单交互

set "PACK_PS1=%~dp0packaging.ps1"
if not exist "%PACK_PS1%" (
    echo [ERROR] packaging.ps1 not found
    echo   Path: %PACK_PS1%
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found
    echo   Please install from https://nodejs.org/
    pause
    exit /b 1
)

echo ============================================
echo   惠康中医打包 - 严格模式APP
echo   (APK + 签名哈希校验 + 重打包)
echo ============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%PACK_PS1%" -AutoAppStrict
set "EXIT_CODE=%errorlevel%"

echo.
if %EXIT_CODE% neq 0 (
    echo [ERROR] 打包失败，退出码: %EXIT_CODE%
) else (
    echo [OK] 严格模式APP打包完成！
)
echo.
pause
