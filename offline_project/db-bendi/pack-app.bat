@echo off
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

REM pack-app.bat - APP build entry (Capacitor Android APK)
REM Capacitor APP: 稳定架构，与云端APP统一技术栈
REM 打包流程：环境检查 → 清理缓存 → 构建签名APK → hash验证 → 复制输出

set "CAP_DIR=%~dp0capacitor"
if not exist "%CAP_DIR%\build-app.bat" (
    echo [ERROR] Capacitor APP build script not found: %CAP_DIR%\build-app.bat
    if not defined NO_PAUSE pause
    exit /b 1
)

echo ============================================
echo   Huikang-TCM Build - Mobile APP (Capacitor)
echo   Version: bendi (本地版)
echo ============================================
echo.

REM 调用 Capacitor APP 完整安全打包（含8步安全机制）
call "%CAP_DIR%\build-app.bat"
set "EXIT_CODE=%errorlevel%"

REM 复制 APK 到当前目录（方便统一管理）
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
    echo [OK] Mobile APP build complete!
)
echo.
if not defined NO_PAUSE pause
exit /b %EXIT_CODE%
