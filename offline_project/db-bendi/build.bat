@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  BenNeng TCM Prescription System - Local
echo ============================================
echo.

echo [1/5] Checking environment...
where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm not found, please install Node.js first
    pause
    exit /b 1
)
echo       npm OK
echo.

echo [2/5] Closing remaining processes...
taskkill /f /im "惠康中医处方系统-本地.exe" >nul 2>nul
taskkill /f /im "惠康中医处方系统-本地版.exe" >nul 2>nul
echo [OK] Processes cleaned
echo.

echo [3/5] Configuring clinic info...
powershell -ExecutionPolicy Bypass -File "edit-config.ps1"
echo.

echo [4/5] Cleaning old build artifacts and running build...
if exist "dist" rmdir /s /q "dist"
set ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://registry.npmmirror.com/-/binary/electron-builder-binaries/
set NODE_TLS_REJECT_UNAUTHORIZED=0
call npm run build
if errorlevel 1 (
    echo.
    echo [ERROR] Build failed, please check logs above
    pause
    exit /b 1
)
echo.
echo [5/5] Build completed
echo Output dir: %CD%\dist
echo ============================================
pause
