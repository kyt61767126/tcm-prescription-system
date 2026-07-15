@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  BenNeng TCM Prescription System - Cloud
echo ============================================
echo.
echo [1/6] Checking environment...
where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm not found, please install Node.js first
    pause
    exit /b 1
)
echo       npm OK
echo.

echo [2/6] Closing remaining processes...
taskkill /F /IM electron.exe >nul 2>&1
taskkill /F /IM "BenNeng*.exe" >nul 2>&1
echo [OK] Processes cleaned
timeout /t 2 /nobreak >nul
echo.

echo [3/6] Cleaning old build artifacts...
if exist "dist" (
    rmdir /s /q "dist"
    if errorlevel 1 (
        echo [WARNING] Clean failed, trying force delete...
        powershell -ExecutionPolicy Bypass -Command "[System.IO.Directory]::Delete('%CD%\dist', $true)"
    )
)
echo [OK] Old artifacts cleaned
echo.

echo [4/6] Obfuscating JavaScript code...
node "%~dp0..\..\tools\obfuscate.js"
if errorlevel 1 (
    echo [ERROR] Obfuscation failed
    pause
    exit /b 1
)
echo [OK] Obfuscation completed
echo.

echo [5/6] Running build...
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

echo Restoring original JavaScript code...
node "%~dp0..\..\tools\obfuscate.js" restore
echo [OK] Original code restored
echo.

echo [6/6] Build completed
echo Output dir: %CD%\dist
echo ============================================
pause