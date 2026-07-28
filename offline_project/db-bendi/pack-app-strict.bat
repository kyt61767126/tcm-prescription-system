@echo off
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

REM pack-app-strict.bat - Strict APP build (Capacitor APK + signature hash + repack)
REM 严格模式：完整安全打包 + 签名hash注入 + 重打包

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

REM 调用 Capacitor APP 严格打包
call "%CAP_DIR%\pack-app-strict.bat"
set "EXIT_CODE=%errorlevel%"

REM 复制 APK 到当前目录
if %EXIT_CODE% equ 0 (
    if exist "%CAP_DIR%\惠康中医-本地-Capacitor.apk" (
        copy "%CAP_DIR%\惠康中医-本地-Capacitor.apk" "%~dp0惠康中医-本地-Capacitor.apk" /y >nul
        echo [OK] APK copied to: %~dp0惠康中医-本地-Capacitor.apk
    )
)

echo.
if %EXIT_CODE% neq 0 (
    echo [ERROR] Build failed, exit code: %EXIT_CODE%
) else (
    echo [OK] Strict APP build complete!
)
echo.
if not defined NO_PAUSE pause
exit /b %EXIT_CODE%
