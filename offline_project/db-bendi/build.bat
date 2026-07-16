@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  惠康中医诊所管理系统 - 电脑离线诊所版
echo ============================================
echo.

echo [1/7] Checking environment...
where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm not found, please install Node.js first
    pause
    exit /b 1
)
echo       npm OK
echo.

echo [2/7] Closing remaining processes...
taskkill /f /im "惠康中医诊所管理系统-本地.exe" >nul 2>nul
taskkill /f /im "惠康中医诊所管理系统-本地版.exe" >nul 2>nul
echo [OK] Processes cleaned
echo.

echo [3/7] Configuring clinic info...
if /i "%1"=="--skip-config" (
    echo       [SKIP] --skip-config parameter detected
) else (
    powershell -ExecutionPolicy Bypass -File "edit-config.ps1"
)
echo.

echo [4/7] Cleaning old build artifacts...
if exist "dist" rmdir /s /q "dist"
echo.

echo [5/7] Obfuscating JavaScript code...
node "%~dp0..\..\tools\obfuscate.js"
if errorlevel 1 (
    echo [ERROR] Obfuscation failed
    pause
    exit /b 1
)
echo [OK] Obfuscation completed
echo.

echo [6/7] Running build...
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

echo [7/7] Build completed
echo Output dir: %CD%\dist
echo ============================================
pause
