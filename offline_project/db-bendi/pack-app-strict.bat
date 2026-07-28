@echo off
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

REM pack-app-strict.bat - Strict APP build (Capacitor APK + signature hash + repack)
REM Calls capacitor/pack-app-strict.bat which handles full strict flow

set "CAP_DIR=%~dp0capacitor"
if not exist "%CAP_DIR%\pack-app-strict.bat" (
    echo [ERROR] Capacitor APP strict build script not found: %CAP_DIR%\pack-app-strict.bat
    if not defined NO_PAUSE pause
    exit /b 1
)

echo ============================================
echo   Huikang-TCM Build - Strict APP (Capacitor)
echo   Version: bendi (本地版)
echo   (APK + signature hash + repack)
echo ============================================
echo.

set "NO_PAUSE=1"
call "%CAP_DIR%\pack-app-strict.bat"
set "EXIT_CODE=%errorlevel%"
set "NO_PAUSE="

echo.
if %EXIT_CODE% neq 0 (
    echo [错误] 打包失败，退出码: %EXIT_CODE%
) else (
    echo [成功] 严格模式APP打包完成！
    echo [位置] APK 文件: %~dp0惠康中医-本地.apk
)
echo.
if not defined NO_PAUSE pause
exit /b %EXIT_CODE%
