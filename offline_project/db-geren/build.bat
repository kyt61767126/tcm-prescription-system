@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  惠康中医诊所管理系统 - 电脑个人定制版
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

echo [2/6] Configuring clinic info...
if /i "%1"=="--skip-config" (
    echo       [SKIP] --skip-config parameter detected
) else (
    powershell -ExecutionPolicy Bypass -File "edit-config.ps1"
)
echo.

echo [3/6] Cleaning old build artifacts...
if exist "dist" rmdir /s /q "dist"
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