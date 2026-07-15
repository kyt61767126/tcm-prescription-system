@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  惠康中医诊所管理系统 - 电脑离线诊所版
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
taskkill /f /im "惠康中医诊所管理系统-本地.exe" >nul 2>nul
taskkill /f /im "惠康中医诊所管理系统-本地版.exe" >nul 2>nul
echo [OK] Processes cleaned
echo.

echo [3/5] Configuring clinic info (optional for offline version)...
if /i "%1"=="--skip-config" (
    echo       [SKIP] --skip-config parameter detected
) else (
    echo       离线诊所版全程可编辑，配置步骤可选
    choice /C YN /M "是否修改诊所名称"
    if errorlevel 2 (
        echo       [SKIP] 用户选择跳过配置
    ) else (
        powershell -ExecutionPolicy Bypass -File "edit-config.ps1"
    )
)
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
