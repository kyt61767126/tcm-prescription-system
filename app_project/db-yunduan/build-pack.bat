@echo off
chcp 65001 >nul

setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

title Huikang-TCM Cloud Build Tool



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

    REM ★ [BUILD-LOCK 2026-08-23] Release global build mutex (all exit paths pass here)
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\build-lock.ps1" release -LockPath "%~dp0..\..\.build.lock" -Owner "cloud-pack"

    echo.

    if %EXIT_CODE% neq 0 (

        powershell -NoProfile -Command "Write-Host '========================================' -ForegroundColor Red"

        powershell -NoProfile -Command "Write-Host '  [ERROR] Build failed (ExitCode: %~1)' -ForegroundColor Red"

        powershell -NoProfile -Command "Write-Host '========================================' -ForegroundColor Red"

        REM ★ 2026-08-29 一键打包入口已启动全流程日志转录, 此处回显路径供事后回溯根因
        if defined PACK_LOG_FILE powershell -NoProfile -Command "Write-Host '  完整日志: %PACK_LOG_FILE%' -ForegroundColor Yellow"

    ) else (

        powershell -NoProfile -Command "Write-Host '========================================' -ForegroundColor Yellow"

        powershell -NoProfile -Command "Write-Host '  [OK] %~2' -ForegroundColor Yellow"

        if not "%~3"=="" powershell -NoProfile -Command "Write-Host '  %~3' -ForegroundColor Yellow"

        if not "%~4"=="" powershell -NoProfile -Command "Write-Host '  %~4' -ForegroundColor Yellow"

        powershell -NoProfile -Command "Write-Host '========================================' -ForegroundColor Yellow"

    )

    echo.

    REM ★ 2026-08-21 手动打包失败闪退修复：NO_PAUSE 未定义（手动双击）时暂停显示结果，
    REM   一键打包（one-click-pack.ps1 已设置 NO_PAUSE=1 环境变量继承）不暂停
    if not defined NO_PAUSE (

        set "EXIT_KEY="

        set /p "EXIT_KEY=Press Enter to exit..."

    )

    REM ★ 2026-08-29 退出码修复: 原exit /b处于call子程序上下文, 返回调用者后goto :eof
    REM   结束批处理, 进程退出码实测丢失恒0, 一键打包误判成功并把失败构建记成成功基线。
    REM   exit不带/b直接终止cmd进程并携带退出码; 调用方末行均为exit /b收尾, 不依赖call返回。
    exit %EXIT_CODE%



:check_node


:main

    REM ★ [BUILD-LOCK 2026-08-23] Global build mutex - abort if another build is running
    REM   并发构建会互相冲突（obfuscate 共享源文件/node_modules/git index/构建缓存）
    REM   可重入：下游 build.bat/build-app.bat 同 cmd 链条重入放行，锁由本入口持有并释放
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\build-lock.ps1" acquire -LockPath "%~dp0..\..\.build.lock" -Owner "cloud-pack"
    if errorlevel 2 (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] 检测到另一个构建正在运行，共享文件会冲突。请等待其结束后重试；若确认无构建在跑，可删除仓库根目录 .build.lock 后重试。' -ForegroundColor Red"
        call :finalize 1 "Another build is running - aborted"
        goto :eof
    )

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

    echo   Huikang TCM Cloud - Build Tool

    echo ================================================

    echo.

    echo Usage: build-pack.bat ^<mode^>

    echo.

    echo [Desktop]

    echo   desktop           - Cloud Desktop (Unified)

    echo.

    echo [APP]

    echo   app               - Cloud APP (Unified, Strict)

    echo   app-strict        - Cloud APP Strict

    echo.

    echo   help              - Show this help

    echo.

    echo Examples:

    echo   build-pack.bat desktop

    echo   build-pack.bat app

    echo ================================================

    echo.

    REM ★ [BUILD-LOCK 2026-08-23] help is also a lock holder and must be released (finalize is not taken, manual release; at the same time, add pause to align with the offline version, manual double-click no longer flash-closes)
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\build-lock.ps1" release -LockPath "%~dp0..\..\.build.lock" -Owner "cloud-pack"

    if not defined NO_PAUSE (

        set "EXIT_KEY="

        set /p "EXIT_KEY=Press Enter to exit..."

    )

    goto :eof



:mode_desktop

    call :log_title "Cloud Desktop Builder (Unified)"

    call :check_node
    if errorlevel 1 (
        call :finalize 1 "Node.js check failed"
        goto :eof
    )

    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\sync-auth-core.ps1"

    if errorlevel 1 (

        call :finalize 1 "auth-core.js sync failed - aborting build"

        goto :eof

    )

    set "BUILD_BAT=%~dp0cloud_desktop\build.bat"

    call :check_file "cloud_desktop\build.bat" "%BUILD_BAT%"
    if errorlevel 1 (
        call :finalize 1 "Script not found"
        goto :eof
    )

    REM ★ 2026-08-21 手动打包失败闪退修复：不再强制 NO_PAUSE=1，
    REM   一键打包的 NO_PAUSE=1 由 one-click-pack.ps1 环境变量继承；
    REM   手动双击时未定义 → 子 build.bat 失败分支会 pause 显示错误（不再闪退）
    call "%BUILD_BAT%"

    set "TEMP_RC=%errorlevel%"

    call :finalize %TEMP_RC% "云端桌面版（统一版）打包完成" "EXE: %~dp0cloud_desktop\dist\惠康中医-云端 Setup *.exe" "EXE: %~dp0cloud_desktop\dist\惠康中医-云端 *.exe (portable)"

    goto :eof



:mode_app

    call :log_title "Cloud APP Builder (Unified Strict)"

    call :check_node
    if errorlevel 1 (
        call :finalize 1 "Node.js check failed"
        goto :eof
    )

    call :check_java
    if errorlevel 1 (
        call :finalize 1 "Java check failed"
        goto :eof
    )

    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\sync-auth-core.ps1"

    if errorlevel 1 (

        call :finalize 1 "auth-core.js sync failed - aborting build"

        goto :eof

    )

    set "BUILD_APP=%~dp0build-app.bat"

    call :check_file "build-app.bat" "%BUILD_APP%"
    if errorlevel 1 (
        call :finalize 1 "Script not found"
        goto :eof
    )

    REM ★ 2026-08-21 手动打包统一严格标准：app 模式显式传 standard（严格），
    REM   与 app-strict 等价，杜绝手动入口哈希刷新失败仍出包
    REM ★ 2026-08-21 手动打包失败闪退修复：不再强制 NO_PAUSE=1（同 mode_desktop）
    call "%BUILD_APP%" standard

    set "TEMP_RC=%errorlevel%"

    call :finalize %TEMP_RC% "云端APP（严格模式）打包完成" "Output: %~dp0惠康中医-云端.apk" "APK: 惠康中医-云端.apk"

    goto :eof



:mode_app_strict

    call :log_title "Cloud APP Builder (Standard Strict)"

    call :check_node
    if errorlevel 1 (
        call :finalize 1 "Node.js check failed"
        goto :eof
    )

    call :check_java
    if errorlevel 1 (
        call :finalize 1 "Java check failed"
        goto :eof
    )

    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\sync-auth-core.ps1"

    if errorlevel 1 (

        call :finalize 1 "auth-core.js sync failed - aborting build"

        goto :eof

    )

    set "BUILD_APP=%~dp0build-app.bat"

    call :check_file "build-app.bat" "%BUILD_APP%"
    if errorlevel 1 (
        call :finalize 1 "Script not found"
        goto :eof
    )

    REM ★ 2026-08-21 手动打包失败闪退修复：不再强制 NO_PAUSE=1（同 mode_desktop）
    call "%BUILD_APP%" standard
    set "TEMP_RC=%errorlevel%"

    call :finalize %TEMP_RC% "云端APP（严格模式）打包完成" "Output: %~dp0惠康中医-云端.apk" "APK: 惠康中医-云端.apk"

    goto :eof



