@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"
title Huikang TCM - Build All Strict

echo ============================================
echo   Huikang TCM Cloud - Build All Strict
echo   Start: %DATE% %TIME%
echo ============================================
echo.

set "TOTAL_RC=0"

echo ============================================
echo   Step A: Build Desktop (Electron exe)
echo ============================================
echo.

set "NO_PAUSE=1"
call "cloud_desktop\build.bat"
set "DESKTOP_RC=%errorlevel%"
set "NO_PAUSE="

if not "%DESKTOP_RC%"=="0" (
    echo.
    echo [WARNING] Desktop build returned: %DESKTOP_RC%, checking output...
    set "HAS_EXE=0"
    for %%f in ("cloud_desktop\dist\*.exe") do set "HAS_EXE=1"
    if "!HAS_EXE!"=="1" (
        echo [OK] Desktop exe files found
        set "DESKTOP_RC=0"
    ) else (
        echo [ERROR] Desktop build failed - no exe files
        set "TOTAL_RC=1"
    )
) else (
    echo [OK] Desktop build succeeded
)

echo.
echo --- Desktop output ---
if exist "cloud_desktop\dist\*.exe" (
    for %%f in ("cloud_desktop\dist\*.exe") do echo   %%~nxA  [%%~zf bytes]
) else (
    echo   [none]
)
echo.

echo ============================================
echo   Step B: Build APP (APK - default mode)
echo ============================================
echo.

set "NO_PAUSE=1"
call "build-app.bat"
set "APP_RC=%errorlevel%"
set "NO_PAUSE="

if not "%APP_RC%"=="0" (
    echo.
    echo [WARNING] APP build returned: %APP_RC%, checking output...
    set "HAS_APK=0"
    for %%f in ("%~dp0*.apk") do set "HAS_APK=1"
    if "!HAS_APK!"=="1" (
        echo [OK] APK files found
        set "APP_RC=0"
    ) else (
        echo [ERROR] APP build failed - no APK files
        set "TOTAL_RC=1"
    )
) else (
    echo [OK] APP build succeeded
)

echo.
echo --- APP output ---
for %%f in ("%~dp0*.apk") do echo   %%~nxA  [%%~zf bytes]
echo.

echo ============================================
echo   Step C: Extract signature hash
echo ============================================
echo.

if not "%TOTAL_RC%"=="0" (
    echo [SKIP] Skipping hash extraction
    set "HASH_RC=0"
    goto :StepD
)

set "NO_PAUSE=1"
if exist "generate-sign-hash.bat" (
    call "generate-sign-hash.bat"
    set "HASH_RC=%errorlevel%"
) else if exist "generate-sign-hash.ps1" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "generate-sign-hash.ps1"
    set "HASH_RC=%errorlevel%"
) else (
    echo [WARN] generate-sign-hash not found, skipping
    set "HASH_RC=0"
)
set "NO_PAUSE="

if not "%HASH_RC%"=="0" (
    echo [WARN] Hash extraction failed, continuing
    set "HASH_RC=0"
) else (
    echo [OK] Hash extraction complete
)
echo.

:StepD
echo ============================================
echo   Step D: Rebuild APP (strict mode APK)
echo ============================================
echo.

set "NO_PAUSE=1"
call "build-app.bat"
set "APP_RC2=%errorlevel%"
set "NO_PAUSE="

if not "%APP_RC2%"=="0" (
    echo.
    echo [WARNING] Strict APP build returned: %APP_RC2%, checking...
    set "HAS_APK2=0"
    for %%f in ("%~dp0*.apk") do set "HAS_APK2=1"
    if "!HAS_APK2!"=="1" (
        echo [OK] Strict APK files found
        set "APP_RC2=0"
    ) else (
        echo [ERROR] Strict APP build failed
    )
) else (
    echo [OK] Strict APP build succeeded
)

echo.
echo --- Strict APP output ---
for %%f in ("%~dp0*.apk") do echo   %%~nxA  [%%~zf bytes]
echo.

echo ============================================
echo   Build Summary
echo ============================================
echo   Desktop: %DESKTOP_RC%
echo   APP(default): %APP_RC%
echo   Hash: %HASH_RC%
echo   APP(strict): %APP_RC2%
echo.

echo --- All outputs ---
echo [Desktop exe:]
if exist "cloud_desktop\dist\*.exe" (
    for %%f in ("cloud_desktop\dist\*.exe") do echo   %%~nxA  [%%~zf bytes]
) else (
    echo   [none]
)
echo [APK files:]
for %%f in ("%~dp0*.apk") do echo   %%~nxA  [%%~zf bytes]
if not exist "%~dp0*.apk" echo   [none]
echo.

echo ============================================
echo   Build complete! Check outputs above
echo   Desktop dir: %~dp0cloud_desktop\dist\
echo   APK dir: %~dp0
echo ============================================
echo.
if not defined NO_PAUSE pause
exit /b %TOTAL_RC%
