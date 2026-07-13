@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  BenNeng TCM Prescription System - Cloud
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
taskkill /F /IM electron.exe >nul 2>&1
taskkill /F /IM "BenNeng*.exe" >nul 2>&1
echo [OK] Processes cleaned
timeout /t 2 /nobreak >nul
echo.
echo [3/5] Cleaning old build artifacts...
if exist "dist" (
    rmdir /s /q "dist"
    if errorlevel 1 (
        echo [WARNING] Clean failed, trying force delete...
        powershell -ExecutionPolicy Bypass -Command "[System.IO.Directory]::Delete('%CD%\dist', $true)"
    )
)
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