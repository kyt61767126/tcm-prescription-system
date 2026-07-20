@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  Huikang TCM Cloud - Desktop Build
echo ============================================
echo.

echo [1/8] Checking environment...
where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm not found, please install Node.js first
    pause
    exit /b 1
)
echo       npm OK
echo.

echo [2/8] Checking node_modules...
if not exist "node_modules" (
    echo       node_modules not found, installing dependencies...
    if exist "package-lock.json" (
        echo       Running npm ci ^(faster, deterministic^)...
        call npm ci --no-audit --no-fund --prefer-offline
    ) else (
        echo       Running npm install...
        call npm install --no-audit --no-fund --prefer-offline
    )
    if errorlevel 1 (
        echo [ERROR] npm install failed
        pause
        exit /b 1
    )
    echo       [OK] Dependencies installed
) else (
    echo       [OK] node_modules exists
)
echo.

echo [3/8] Closing remaining processes...
REM Kill all electron and app processes that might lock files
taskkill /F /IM electron.exe >nul 2>&1
taskkill /F /IM "HuikangTCM*.exe" >nul 2>&1
taskkill /F /IM "惠康中医-云端.exe" >nul 2>&1
taskkill /F /IM "惠康中医*.exe" >nul 2>&1
REM Kill any process running from the build output directory
wmic process where "ExecutablePath like '%%cloud_desktop%%build_output%%'" call terminate >nul 2>&1
wmic process where "ExecutablePath like '%%cloud_desktop%%dist%%'" call terminate >nul 2>&1
echo [OK] Processes cleaned
timeout /t 3 /nobreak >nul
echo.

echo [4/8] Cleaning old build artifacts...
REM Define the output directory (must match package.json build.directories.output)
set "OUTPUT_DIR=build_output"

REM Clean up old renamed output directories first (keep only the latest 2)
set old_count=0
for /f "delims=" %%D in ('dir /b /ad "build_output_old_*" 2^>nul ^| sort /r') do (
    set /a old_count+=1
    if !old_count! gtr 2 (
        rmdir /s /q "%%D" 2>nul
    )
)

REM Try to clean the output directory
if exist "%OUTPUT_DIR%" (
    rmdir /s /q "%OUTPUT_DIR%" 2>nul
    if exist "%OUTPUT_DIR%" (
        echo [WARNING] Direct delete failed, trying PowerShell force delete...
        powershell -ExecutionPolicy Bypass -Command "try { [System.IO.Directory]::Delete('%CD%\%OUTPUT_DIR%', $true) } catch { Write-Host '[WARNING] PowerShell delete also failed' }" 2>nul
    )
    if exist "%OUTPUT_DIR%" (
        REM Generate timestamp for renamed directory
        for /f "tokens=2 delims==" %%a in ('wmic os get localdatetime /value 2^>nul ^| find "="') do set "ldt=%%a"
        if defined ldt (
            set "DSTAMP=!ldt:~0,8!_!ldt:~8,6!"
        ) else (
            set "DSTAMP=%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%"
            set "DSTAMP=!DSTAMP: =0!"
        )
        echo [WARNING] Could not delete %OUTPUT_DIR%, renaming to build_output_old_!DSTAMP!...
        rename "%OUTPUT_DIR%" "build_output_old_!DSTAMP!" 2>nul
        if exist "%OUTPUT_DIR%" (
            echo [ERROR] Cannot clean or rename %OUTPUT_DIR% directory
            echo         Please manually close any program using %OUTPUT_DIR%\ and retry
            echo         Or manually delete/rename the %OUTPUT_DIR% folder
            pause
            exit /b 1
        )
    )
)

REM Also try to clean old dist directory if it exists (from previous builds)
if exist "dist" (
    rmdir /s /q "dist" 2>nul
    if exist "dist" (
        echo [WARNING] Old dist directory could not be deleted, leaving it in place
    )
)

echo [OK] Old artifacts cleaned
echo.

echo [5/8] Obfuscating JavaScript code (target=cloud)...
node "%~dp0..\..\tools\obfuscate.js" --target=cloud
if errorlevel 1 (
    echo [ERROR] Obfuscation failed
    echo Restoring original files...
    node "%~dp0..\..\tools\obfuscate.js" restore --target=cloud >nul 2>&1
    pause
    exit /b 1
)
echo [OK] Obfuscation completed
echo.

echo [6/8] Running build...
REM Use domestic mirror to accelerate electron binary download (no need to disable TLS verification)
set ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://registry.npmmirror.com/-/binary/electron-builder-binaries/
REM better-sqlite3 prebuild-install 从 GitHub Releases 下载预编译二进制时 SSL 证书验证失败
REM 临时关闭 TLS 验证（仅构建期间），确保 prebuild-install 能成功下载 electron ABI 二进制
set NODE_TLS_REJECT_UNAUTHORIZED=0
call npm run build
if errorlevel 1 (
    echo.
    echo [ERROR] Build failed, please check logs above
    echo Restoring original JavaScript code...
    node "%~dp0..\..\tools\obfuscate.js" restore --target=cloud >nul 2>&1
    pause
    exit /b 1
)
echo.

echo [7/8] Restoring original JavaScript code...
node "%~dp0..\..\tools\obfuscate.js" restore --target=cloud
if errorlevel 1 (
    echo [ERROR] Restore failed! Source code may remain obfuscated.
    echo Please manually run: node "%~dp0..\..\tools\obfuscate.js" restore --target=cloud
    pause
    exit /b 1
)
echo [OK] Original code restored
echo.

echo [8/8] Build completed
echo Output dir: %CD%\%OUTPUT_DIR%
echo ============================================
if exist "build_output_old_*" (
    echo [NOTE] Old build artifacts saved as build_output_old_* directories
    echo        These will be auto-cleaned in future builds
)
if exist "dist" (
    echo [NOTE] Old dist directory still exists and could not be deleted
    echo        You can manually delete it if no longer needed
)
pause
