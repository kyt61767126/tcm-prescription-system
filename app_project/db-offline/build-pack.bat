@echo off
chcp 65001 >nul

setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

title Huikang-TCM Offline Build Tool



set "MODE=%~1"

if "%MODE%"=="" set "MODE=help"

goto :main



:check_node

    where node >nul 2>nul

    if errorlevel 1 (

        powershell -NoProfile -Command "Write-Host '[ERROR] Node.js not found' -ForegroundColor Red"

        exit /b 1

    )

    powershell -NoProfile -Command "Write-Host '[OK] Node.js installed' -ForegroundColor Green"

    exit /b 0



:check_java

    where java >nul 2>nul

    if errorlevel 1 (

        powershell -NoProfile -Command "Write-Host '[ERROR] Java not found' -ForegroundColor Red"

        exit /b 1

    )

    powershell -NoProfile -Command "Write-Host '[OK] Java installed' -ForegroundColor Green"

    exit /b 0



:check_file

    if not exist "%~2" (

        powershell -NoProfile -Command "Write-Host '[ERROR] %~1 not found' -ForegroundColor Red"

        exit /b 1

    )

    powershell -NoProfile -Command "Write-Host '[OK] %~1' -ForegroundColor Green"

    exit /b 0



:log_title

    echo ============================================

    powershell -NoProfile -Command "Write-Host '%~1' -ForegroundColor Cyan"

    echo ============================================

    exit /b 0



:get_start_time

    for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"

    exit /b 0



:finalize

    set "EXIT_CODE=%~1"

    echo.

    if %EXIT_CODE% neq 0 (

        powershell -NoProfile -Command "Write-Host '========================================' -ForegroundColor Red"

        powershell -NoProfile -Command "Write-Host '  [ERROR] Build failed (ExitCode: %~1)' -ForegroundColor Red"

        powershell -NoProfile -Command "Write-Host '========================================' -ForegroundColor Red"

    ) else (

        powershell -NoProfile -Command "Write-Host '========================================' -ForegroundColor Yellow"

        powershell -NoProfile -Command "Write-Host '  [OK] %~2' -ForegroundColor Yellow"

        if not "%~3"=="" powershell -NoProfile -Command "Write-Host '  %~3' -ForegroundColor Yellow"

        if not "%~4"=="" powershell -NoProfile -Command "Write-Host '  %~4' -ForegroundColor Yellow"

        powershell -NoProfile -Command "Write-Host '========================================' -ForegroundColor Yellow"

    )

    echo.

    if not defined NO_PAUSE (

        set "EXIT_KEY="

        set /p "EXIT_KEY=Press Enter to exit..."

    )

    exit /b %EXIT_CODE%



:main

    call :get_start_time

    if /i "%MODE%"=="help" goto :mode_help

    if /i "%MODE%"=="-h" goto :mode_help

    if /i "%MODE%"=="/?" goto :mode_help

    if /i "%MODE%"=="desktop" goto :mode_desktop

    if /i "%MODE%"=="app" goto :mode_app

    if /i "%MODE%"=="app-strict" goto :mode_app_strict


    powershell -NoProfile -Command "Write-Host '[ERROR] Unknown mode: %MODE%' -ForegroundColor Red"

    call :finalize 1 "Unknown mode"

    goto :eof



:mode_help

    echo.

    echo ================================================

    echo   Huikang TCM Offline - Build Tool

    echo ================================================

    echo.

    echo Usage: build-pack.bat ^<mode^>

    echo.

    echo [Desktop]

    echo   desktop           - Offline Desktop (Unified)

    echo.

    echo [APP]

    echo   app               - Offline APP (Unified, Strict)

    echo   app-strict        - Offline APP (Standard Strict)

    echo.

    echo   help              - Show this help

    echo.

    echo Examples:

    echo   build-pack.bat desktop

    echo   build-pack.bat app

    echo ================================================

    echo.

    if not defined NO_PAUSE (

        set "EXIT_KEY="

        set /p "EXIT_KEY=Press Enter to exit..."

    )

    goto :eof



:mode_desktop

    call :log_title "Offline Desktop Builder (Unified)"

    call :check_node || call :finalize 1 "Node.js check failed"

    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\sync-auth-core.ps1"

    if errorlevel 1 (

        call :finalize 1 "auth-core.js sync failed - aborting build"

        goto :eof

    )

    set "BUILD_BAT=%~dp0desktop\build.bat"

    call :check_file "desktop\build.bat" "%BUILD_BAT%" || call :finalize 1 "Script not found"

    REM ★ 2026-08-21 手动打包失败闪退修复：不再强制 NO_PAUSE=1，
    REM   一键打包的 NO_PAUSE=1 由 one-click-pack.ps1 环境变量继承；
    REM   手动双击时未定义 → 子 build.bat 失败分支会 pause 显示错误（不再闪退）
    call "%BUILD_BAT%"

    set "TEMP_RC=%errorlevel%"

    call :finalize %TEMP_RC% "离线桌面版（统一版）打包完成" "EXE: %~dp0desktop\dist\惠康中医-本地 Setup *.exe" "EXE: %~dp0desktop\dist\惠康中医-本地 *.exe (portable)"

    goto :eof



:mode_app

    call :log_title "Offline APP Builder (Unified Strict)"

    call :check_node || call :finalize 1 "Node.js check failed"

    call :check_java || call :finalize 1 "Java check failed"

    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\sync-auth-core.ps1"

    if errorlevel 1 (

        call :finalize 1 "auth-core.js sync failed - aborting build"

        goto :eof

    )

    set "CAP_DIR=%~dp0app"

    call :check_file "app\build-app.bat" "%CAP_DIR%\build-app.bat" || call :finalize 1 "Script not found"

    REM ★ 2026-08-21 手动打包统一严格标准：app 模式显式传 standard（严格），
    REM   与 app-strict 等价，杜绝手动入口哈希刷新失败仍出包
    REM ★ 2026-08-21 手动打包失败闪退修复：不再强制 NO_PAUSE=1（同 mode_desktop）
    call "%CAP_DIR%\build-app.bat" standard

    set "TEMP_RC=%errorlevel%"

    call :finalize %TEMP_RC% "离线APP（严格模式）打包完成" "Output: %~dp0惠康中医-本地.apk" "APK: 惠康中医-本地.apk"

    goto :eof



:mode_app_strict

    call :log_title "Offline APP Builder (Standard Strict)"

    call :check_node || call :finalize 1 "Node.js check failed"

    call :check_java || call :finalize 1 "Java check failed"

    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\sync-auth-core.ps1"

    if errorlevel 1 (

        call :finalize 1 "auth-core.js sync failed - aborting build"

        goto :eof

    )

    set "CAP_DIR=%~dp0app"

    call :check_file "app\build-app.bat" "%CAP_DIR%\build-app.bat" || call :finalize 1 "Script not found"

    REM ★ 2026-08-21 手动打包失败闪退修复：不再强制 NO_PAUSE=1（同 mode_desktop）
    call "%CAP_DIR%\build-app.bat" standard

    set "TEMP_RC=%errorlevel%"

    call :finalize %TEMP_RC% "离线APP（标准严格版）打包完成" "Output: %~dp0惠康中医-本地.apk" "APK: 惠康中医-本地.apk"

    goto :eof



