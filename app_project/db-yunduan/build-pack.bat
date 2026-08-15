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

    echo   Huikang TCM Cloud - Build Tool

    echo ================================================

    echo.

    echo Usage: build-pack.bat ^<mode^>

    echo.

    echo [Desktop]

    echo   desktop           - Cloud Desktop (Unified)

    echo.

    echo [APP]

    echo   app               - Cloud APP (Unified)

    echo   app-strict        - Cloud APP Strict

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

    call :log_title "Cloud Desktop Builder (Unified)"

    call :check_node || call :finalize 1 "Node.js check failed"

    set "BUILD_BAT=%~dp0cloud_desktop\build.bat"

    call :check_file "cloud_desktop\build.bat" "%BUILD_BAT%" || call :finalize 1 "Script not found"

    set "NO_PAUSE=1"

    call "%BUILD_BAT%"

    set "TEMP_RC=%errorlevel%"

    set "NO_PAUSE="

    call :finalize %TEMP_RC% "Cloud Desktop (Unified) completed" "" "EXE: cloud_desktop\dist\"

    goto :eof



:mode_app

    call :log_title "Cloud APP Builder (Unified)"

    call :check_node || call :finalize 1 "Node.js check failed"

    set "PACK_PS1=%~dp0packaging.ps1"

    call :check_file "packaging.ps1" "%PACK_PS1%" || call :finalize 1 "packaging.ps1 not found"

    powershell -NoProfile -ExecutionPolicy Bypass -File "%PACK_PS1%" -AutoApp

    call :finalize %errorlevel% "Cloud APP (Unified) completed" "Output: %~dp0惠康中医-云端.apk" "APK: 惠康中医-云端.apk"

    goto :eof



:mode_app_strict

    call :log_title "Cloud APP Builder (Standard Strict)"

    call :check_node || call :finalize 1 "Node.js check failed"

    call :check_java || call :finalize 1 "Java check failed"

    set "BUILD_APP=%~dp0build-app.bat"

    call :check_file "build-app.bat" "%BUILD_APP%" || call :finalize 1 "Script not found"

    set "SAVED_NO_PAUSE=%NO_PAUSE%"
    set "NO_PAUSE=1"

    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Step A: First build (standard)...'"
    call "%BUILD_APP%" standard
    set "TEMP_RC=%errorlevel%"
    if not "%TEMP_RC%"=="0" (
        set "NO_PAUSE=%SAVED_NO_PAUSE%"
        call :finalize %TEMP_RC% "First build failed"
        goto :eof
    )

    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Step B: Extract signature hash...'"
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\generate-sign-hash.ps1" -Version cloud 2>nul

    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Step C: Strict rebuild (standard)...'"
    call "%BUILD_APP%" standard
    set "TEMP_RC=%errorlevel%"

    set "NO_PAUSE=%SAVED_NO_PAUSE%"

    call :finalize %TEMP_RC% "Cloud APP (Standard Strict) completed" "Output: %~dp0惠康中医-云端.apk" "APK: 惠康中医-云端.apk"

    goto :eof



