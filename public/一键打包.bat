@echo off
title HuikangTCM Cloud - One Click Build
cd /d "%~dp0"
chcp 65001 >nul

echo ==============================================
echo   HuikangTCM Cloud - One Click Build
echo ==============================================
echo.

echo [1/5] Closing remaining processes...
taskkill /F /IM electron.exe >nul 2>&1
taskkill /F /IM "惠康中医-云端.exe" >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/5] Cleaning old build artifacts...
if exist "dist" (
    rmdir /s /q "dist" 2>nul
    if exist "dist" (
        powershell -ExecutionPolicy Bypass -Command "try { [System.IO.Directory]::Delete('%CD%\dist', $true) } catch { }" 2>nul
    )
)

echo [3/5] Running npm run build...
set ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://registry.npmmirror.com/-/binary/electron-builder-binaries/
call npm run build

if errorlevel 1 (
    echo.
    echo ==============================================
    echo [ERROR] Build failed!
    echo ==============================================
    pause
    exit /b 1
)

echo.
echo ==============================================
echo Build completed!
echo Output: %~dp0dist\
echo ==============================================
pause