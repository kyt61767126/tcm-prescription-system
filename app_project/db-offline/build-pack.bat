@echo off

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

    if /i "%MODE%"=="institutional" goto :mode_institutional

    if /i "%MODE%"=="institutional-strict" goto :mode_institutional_strict

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

    echo   app               - Offline APP (Standard)

    echo   app-strict        - Offline APP (Standard Strict)

    echo   institutional     - Offline APP (Institutional)

    echo   institutional-strict - Offline APP (Institutional Strict)

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

    set "BUILD_BAT=%~dp0desktop\build.bat"

    call :check_file "desktop\build.bat" "%BUILD_BAT%" || call :finalize 1 "Script not found"

    set "NO_PAUSE=1"

    call "%BUILD_BAT%"

    set "TEMP_RC=%errorlevel%"

    set "NO_PAUSE="

    call :finalize %TEMP_RC% "Offline Desktop (Unified) completed" "" "EXE: desktop\dist\"

    goto :eof



:mode_app

    call :log_title "Offline APP Builder (Standard)"

    call :check_java || call :finalize 1 "Java check failed"

    set "CAP_DIR=%~dp0app"

    call :check_file "app\build-app.bat" "%CAP_DIR%\build-app.bat" || call :finalize 1 "Script not found"

    set "NO_PAUSE=1"

    call "%CAP_DIR%\build-app.bat" standard

    set "TEMP_RC=%errorlevel%"

    set "NO_PAUSE="

    call :finalize %TEMP_RC% "Offline APP (Standard) completed" "Output: %~dp0LB.apk" "APK: LB.apk"

    goto :eof



:mode_institutional

    call :log_title "Offline APP Builder (Institutional)"

    call :check_java || call :finalize 1 "Java check failed"

    set "CAP_DIR=%~dp0app"

    call :check_file "app\build-app.bat" "%CAP_DIR%\build-app.bat" || call :finalize 1 "Script not found"

    set "NO_PAUSE=1"

    call "%CAP_DIR%\build-app.bat" institutional

    set "TEMP_RC=%errorlevel%"

    set "NO_PAUSE="

    call :finalize %TEMP_RC% "Offline APP (Institutional) completed" "Output: %~dp0LJ.apk" "APK: LJ.apk"

    goto :eof



:mode_app_strict

    call :log_title "Offline APP Builder (Standard Strict)"

    call :check_java || call :finalize 1 "Java check failed"

    set "CAP_DIR=%~dp0app"

    call :check_file "app\pack-app-strict.bat" "%CAP_DIR%\pack-app-strict.bat" || call :finalize 1 "Script not found"

    set "NO_PAUSE=1"

    call "%CAP_DIR%\pack-app-strict.bat"

    set "TEMP_RC=%errorlevel%"

    set "NO_PAUSE="

    call :finalize %TEMP_RC% "Offline APP (Standard Strict) completed" "Output: %~dp0LB.apk" "APK: LB.apk"

    goto :eof



:mode_institutional_strict

    call :log_title "Offline APP Builder (Institutional Strict)"

    call :check_java || call :finalize 1 "Java check failed"

    set "CAP_DIR=%~dp0app"

    call :check_file "app\pack-app-institutional-strict.bat" "%CAP_DIR%\pack-app-institutional-strict.bat" || call :finalize 1 "Script not found"

    set "NO_PAUSE=1"

    call "%CAP_DIR%\pack-app-institutional-strict.bat"

    set "TEMP_RC=%errorlevel%"

    set "NO_PAUSE="

    call :finalize %TEMP_RC% "Offline APP (Institutional Strict) completed" "Output: %~dp0LJ.apk" "APK: LJ.apk"

    goto :eof
