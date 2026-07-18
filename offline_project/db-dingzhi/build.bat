@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"
title Huikang TCM Custom - Offline Desktop Build

echo ============================================
echo  Huikang TCM Custom - Offline Desktop
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
taskkill /F /IM "app-custom.exe" >nul 2>&1
taskkill /F /IM "惠康中医定制.exe" >nul 2>&1
taskkill /F /IM electron.exe >nul 2>&1
wmic process where "ExecutablePath like '%%db-dingzhi%%dist%%'" call terminate >nul 2>&1
wmic process where "ExecutablePath like '%%db-dingzhi%%build_output%%'" call terminate >nul 2>&1
timeout /t 2 /nobreak >nul
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
set "OUTPUT_DIR=dist"

set old_count=0
for /f "delims=" %%D in ('dir /b /ad "dist_old_*" 2^>nul ^| sort /r') do (
    set /a old_count+=1
    if !old_count! gtr 2 (
        rmdir /s /q "%%D" 2>nul
    )
)

if exist "%OUTPUT_DIR%" (
    rmdir /s /q "%OUTPUT_DIR%" 2>nul
    if exist "%OUTPUT_DIR%" (
        echo [WARNING] Direct delete failed, trying PowerShell force delete...
        powershell -ExecutionPolicy Bypass -Command "try { [System.IO.Directory]::Delete('%CD%\%OUTPUT_DIR%', $true) } catch { Write-Host '[WARNING] PowerShell delete also failed' }" 2>nul
    )
    if exist "%OUTPUT_DIR%" (
        for /f "tokens=2 delims==" %%a in ('wmic os get localdatetime /value 2^>nul ^| find "="') do set "ldt=%%a"
        if defined ldt (
            set "DSTAMP=!ldt:~0,8!_!ldt:~8,6!"
        ) else (
            set "DSTAMP=%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%"
            set "DSTAMP=!DSTAMP: =0!"
        )
        echo [WARNING] Could not delete %OUTPUT_DIR%, renaming to dist_old_!DSTAMP!...
        rename "%OUTPUT_DIR%" "dist_old_!DSTAMP!" 2>nul
        if exist "%OUTPUT_DIR%" (
            echo [ERROR] Cannot clean or rename %OUTPUT_DIR% directory
            echo         Please manually close any program using %OUTPUT_DIR%\ and retry
            echo         Or manually delete/rename the %OUTPUT_DIR% folder
            pause
            exit /b 1
        )
    )
)
echo [OK] Old artifacts cleaned
echo.

echo [5/7] Obfuscating JavaScript code (target=dingzhi, may take 1-2 minutes)...
node "%~dp0..\..\tools\obfuscate.js" --target=dingzhi
if errorlevel 1 (
    echo [ERROR] Obfuscation failed
    echo Restoring original files...
    node "%~dp0..\..\tools\obfuscate.js" restore --target=dingzhi >nul 2>&1
    pause
    exit /b 1
)
echo [OK] Obfuscation completed
echo.

echo [6/7] Running build...
set ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://registry.npmmirror.com/-/binary/electron-builder-binaries/
call npm run build
if errorlevel 1 (
    echo.
    echo [ERROR] Build failed, please check logs above
    echo Restoring original JavaScript code...
    node "%~dp0..\..\tools\obfuscate.js" restore --target=dingzhi >nul 2>&1
    pause
    exit /b 1
)
echo.

echo Restoring original JavaScript code...
node "%~dp0..\..\tools\obfuscate.js" restore --target=dingzhi
if errorlevel 1 (
    echo [ERROR] Restore failed! Source code may remain obfuscated.
    echo Please manually run: node "%~dp0..\..\tools\obfuscate.js" restore --target=dingzhi
    pause
    exit /b 1
)
echo [OK] Original code restored
echo.

echo [7/7] Build completed
echo Output dir: %CD%\%OUTPUT_DIR%
echo ============================================
if exist "dist_old_*" (
    echo [NOTE] Old build artifacts saved as dist_old_* directories
    echo        These will be auto-cleaned in future builds (keeping latest 2)
)
pause
