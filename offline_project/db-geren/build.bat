@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  BenNeng TCM Prescription System - Personal
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
echo [2/5] Configuring clinic info...
powershell -ExecutionPolicy Bypass -File "edit-config.ps1"
echo.
echo [3/5] Cleaning old build artifacts...
if exist "dist" rmdir /s /q "dist"
echo [OK] Old artifacts cleaned
echo.
echo [4/5] Running build...
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