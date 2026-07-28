@echo off
chcp 65001 >nul
REM ============================================================================
REM  upload-release.bat - One-click upload exe/apk to GitHub Releases
REM
REM  Prerequisites:
REM    1. Install GitHub CLI: winget install GitHub.cli
REM    2. Login: gh auth login
REM
REM  Usage:
REM    upload-release.bat              (interactive file selection)
REM    upload-release.bat v1.0.0 file1.apk file2.exe  (specify version and files)
REM ============================================================================

setlocal enabledelayedexpansion

REM Check if gh CLI is installed
where gh >nul 2>&1
if errorlevel 1 (
    echo [ERROR] GitHub CLI not installed
    echo.
    echo Please install first:
    echo   winget install GitHub.cli
    echo.
    echo After install, run:
    echo   gh auth login
    echo.
    pause
    exit /b 1
)

REM Check if logged in
gh auth status >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Not logged in to GitHub
    echo Please run: gh auth login
    pause
    exit /b 1
)

REM Get version number
set "VERSION=%~1"
if "%VERSION%"=="" (
    echo.
    echo ============================================
    echo   GitHub Releases Upload Tool
    echo ============================================
    echo.
    set /p VERSION="Enter version number (e.g. v1.0.0): "
)

if "%VERSION%"=="" (
    echo [ERROR] Version number cannot be empty
    pause
    exit /b 1
)

echo.
echo [INFO] Version number: %VERSION%
echo.

REM Collect files to upload
set "FILES="
set "FILE_COUNT=0"

if "%~2"=="" (
    REM Interactive file selection
    echo Select files to upload (drag and drop to window or input path):
    echo Enter empty line to finish
    echo.

    :select_loop
    set /p "FILE_PATH="
    if "!FILE_PATH!"=="" goto select_done
    if not exist "!FILE_PATH!" (
        echo [WARN] File not found: !FILE_PATH!
        goto select_loop
    )
    set "FILES=!FILES! "!FILE_PATH!""
    set /a FILE_COUNT+=1
    echo [OK] Added: !FILE_PATH!
    goto select_loop

    :select_done
) else (
    REM Specify files via command-line args
    shift
    :param_loop
    if "%~2"=="" goto param_done
    if not exist "%~2" (
        echo [WARN] File not found: %~2
    ) else (
        set "FILES=!FILES! "%~2""
        set /a FILE_COUNT+=1
        echo [OK] Added: %~2
    )
    shift
    goto param_loop
    :param_done
)

if %FILE_COUNT% EQU 0 (
    echo [ERROR] No files selected
    pause
    exit /b 1
)

echo.
echo [INFO] Total %FILE_COUNT% file(s) to upload
echo.

REM Ask for release notes
set "NOTES="
set /p NOTES="Enter release notes (can be empty): "

REM Create Release and upload files
echo.
echo [INFO] Creating Release %VERSION% ...
if "!NOTES!"=="" (
    gh release create %VERSION% %FILES% --title "%VERSION%" --generate-notes
) else (
    gh release create %VERSION% %FILES% --title "%VERSION%" --notes "!NOTES!"
)

if errorlevel 1 (
    echo.
    echo [ERROR] Upload failed, please check error messages
    pause
    exit /b 1
)

echo.
echo ============================================
echo   Upload OK!
echo ============================================
echo.
echo Download links:
gh release view %VERSION% --json assets --jq ".assets[] | \"  \(.name): \(.url)\""
echo.
echo Please fill the above links into the url field of public/hash-manifest.json
echo.

REM Auto-run calculate-hash.js to update checksums
set /p RUN_HASH="Auto-calculate SHA-256 and update hash-manifest.json? (y/n): "
if /i "!RUN_HASH!"=="y" (
    node "%~dp0..\shared\calculate-hash.js"
)

pause
exit /b 0
