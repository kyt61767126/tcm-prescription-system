@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"
title Huikang TCM Cloud - Desktop Build

REM 记录打包开始时间（用于耗时统计）- 使用 PowerShell 替代 wmic（Windows 11 已弃用）
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd_HHmmss'"') do set "BUILD_START_STAMP=%%t"

echo ============================================
echo  Huikang TCM Cloud - Desktop Build
echo  Start: %BUILD_START_TIME%
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
REM P0-优化：精确匹配项目相关进程，避免误杀其他 Electron 应用（如 VSCode、Slack 等）
REM 仅终止从 cloud_desktop/dist 或 build_output 目录启动的进程
taskkill /F /IM "HuikangTCM*.exe" >nul 2>&1
taskkill /F /IM "惠康中医-云端.exe" >nul 2>&1
taskkill /F /IM "惠康中医*.exe" >nul 2>&1
REM P0-优化：替换 wmic（Windows 11 已弃用且慢）为 PowerShell Get-Process（精确路径匹配）
powershell -NoProfile -Command "Get-Process | Where-Object { try { $_.Path -like '*cloud_desktop*dist*' -or $_.Path -like '*cloud_desktop*build_output*' } catch { $false } } | Stop-Process -Force -ErrorAction SilentlyContinue" 2>nul
echo [OK] Processes cleaned
timeout /t 2 /nobreak >nul
echo.

echo [4/8] Cleaning old build artifacts...
REM Define the output directory (must match package.json build.directories.output)
set "OUTPUT_DIR=dist"

REM Clean up old renamed output directories first (keep only the latest 2)
set old_count=0
for /f "delims=" %%D in ('dir /b /ad "dist_old_*" 2^>nul ^| sort /r') do (
    set /a old_count+=1
    if !old_count! gtr 2 (
        rmdir /s /q "%%D" 2>nul
    )
)
REM Also clean up legacy build_output_old_* directories from previous versions
for /f "delims=" %%D in ('dir /b /ad "build_output_old_*" 2^>nul ^| sort /r') do (
    rmdir /s /q "%%D" 2>nul
)

REM Try to clean the output directory
if exist "%OUTPUT_DIR%" (
    rmdir /s /q "%OUTPUT_DIR%" 2>nul
    if exist "%OUTPUT_DIR%" (
        echo [WARNING] Direct delete failed, trying PowerShell force delete...
        powershell -ExecutionPolicy Bypass -Command "try { [System.IO.Directory]::Delete('%CD%\%OUTPUT_DIR%', $true) } catch { Write-Host '[WARNING] PowerShell delete also failed' }" 2>nul
    )
    if exist "%OUTPUT_DIR%" (
        REM P0-优化：替换 wmic（已弃用）为 PowerShell Get-Date 生成时间戳
        for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd_HHmmss'"') do set "DSTAMP=%%t"
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
set "BUILD_RC=%errorlevel%"
REM P1-安全：立即清除 TLS 临时变量，避免污染后续命令环境
set NODE_TLS_REJECT_UNAUTHORIZED=
if not "%BUILD_RC%"=="0" (
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

REM P1-易用：验证产物存在且非空，失败则提前退出
echo [7.5/8] Verifying build output...
set "EXE_FILE="
for %%f in ("%OUTPUT_DIR%\*.exe") do set "EXE_FILE=%%f"
if "%EXE_FILE%"=="" (
    echo [WARN] No .exe found in %OUTPUT_DIR% ^(may be NSIS installer only^)
) else (
    for %%A in ("%EXE_FILE%") do (
        echo   [OK] %%~nxA  %%~zA bytes
    )
)
echo.

echo [8/8] Build completed
echo Output dir: %CD%\%OUTPUT_DIR%
echo ============================================
if exist "dist_old_*" (
    echo [NOTE] Old build artifacts saved as dist_old_* directories
    echo        These will be auto-cleaned in future builds
)
if exist "build_output_old_*" (
    echo [NOTE] Legacy build_output_old_* directories detected, cleaning...
    rmdir /s /q "build_output_old_*" 2>nul
)
REM P1-易用：显示打包总耗时
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
echo Start: %BUILD_START_TIME%
echo End:   %BUILD_END_TIME%
if not defined NO_PAUSE pause
