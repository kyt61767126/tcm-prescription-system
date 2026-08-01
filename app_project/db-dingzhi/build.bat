@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Huikang TCM Custom - Offline Desktop Build

REM Record start time (for elapsed stats) - use PowerShell instead of wmic (deprecated in Windows 11)
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd_HHmmss'"') do set "BUILD_START_STAMP=%%t"

echo ============================================
echo  Huikang TCM Custom - Offline Desktop
echo  Start: %BUILD_START_TIME%
echo ============================================
echo.

echo [1/8] Checking environment...
where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm not found, please install Node.js first
    if not defined NO_PAUSE pause
    exit /b 1
)
echo       npm OK
echo.

echo [1.5/8] Checking node_modules...
if not exist "node_modules" (
    echo       node_modules not found, installing dependencies...
    if exist "package-lock.json" (
        echo       Running npm ci ^(faster, deterministic^)...
        call npm ci --no-audit --no-fund --prefer-offline
        if errorlevel 1 (
            echo       [WARN] npm ci failed, fallback to npm install --ignore-scripts...
            call npm install --no-audit --no-fund --prefer-offline --ignore-scripts
        )
    ) else (
        echo       Running npm install...
        call npm install --no-audit --no-fund --prefer-offline --ignore-scripts
    )
    if errorlevel 1 (
        echo [ERROR] npm install failed
        if not defined NO_PAUSE pause
        exit /b 1
    )
    echo       [OK] Dependencies installed
) else (
    echo       [OK] node_modules exists
)
REM Check electron dist (--ignore-scripts skips postinstall, need manual download)
if not exist "node_modules\electron\dist\electron.exe" (
    echo       electron dist missing, downloading binary...
    set NODE_TLS_REJECT_UNAUTHORIZED=0
    set ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/
    call node node_modules\electron\install.js
    set NODE_TLS_REJECT_UNAUTHORIZED=
    set ELECTRON_MIRROR=
    if not exist "node_modules\electron\dist\electron.exe" (
        echo [ERROR] electron binary download failed
        if not defined NO_PAUSE pause
        exit /b 1
    )
    echo       [OK] electron dist downloaded
)
echo.

echo [2/8] Closing remaining processes...
REM P0-Optimization: precisely match project-related processes to avoid killing other Electron apps (e.g. VSCode, Slack)
taskkill /F /IM "app-custom.exe" >nul 2>&1
taskkill /F /IM "惠康中医-离线机构版.exe" >nul 2>&1
REM P0-Optimization: replace deprecated wmic (deprecated in Windows 11) with PowerShell Get-Process (precise path-based match)
powershell -NoProfile -Command "Get-Process | Where-Object { try { $_.Path -like '*db-dingzhi*dist*' -or $_.Path -like '*db-dingzhi*build_output*' } catch { $false } } | Stop-Process -Force -ErrorAction SilentlyContinue" 2>nul
echo [OK] Processes cleaned
echo.

echo [3/8] Configuring clinic info...
if /i "%1"=="--skip-config" (
    echo       [SKIP] --skip-config parameter detected
) else (
    powershell -ExecutionPolicy Bypass -File "edit-config.ps1"
)
echo.

echo [4/8] Cleaning old build artifacts...
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
        REM P0-Optimization: replace deprecated wmic with PowerShell Get-Date for timestamp
        for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd_HHmmss'"') do set "DSTAMP=%%t"
        echo [WARNING] Could not delete %OUTPUT_DIR%, renaming to dist_old_!DSTAMP!...
        rename "%OUTPUT_DIR%" "dist_old_!DSTAMP!" 2>nul
        if exist "%OUTPUT_DIR%" (
            echo [ERROR] Cannot clean or rename %OUTPUT_DIR% directory
            echo         Please manually close any program using %OUTPUT_DIR%\ and retry
            echo         Or manually delete/rename the %OUTPUT_DIR% folder
            if not defined NO_PAUSE pause
            exit /b 1
        )
    )
)
echo [OK] Old artifacts cleaned
echo.

echo [BUMP] Auto bumping patch version (integrity baseline rebuild)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\bump-version.ps1" -PackagePath "%CD%\package.json"
echo.

echo [5/8] Obfuscating JavaScript code (target=dingzhi, may take 1-2 minutes)...
node "%~dp0..\..\tools\obfuscate.js" --target=dingzhi
if errorlevel 1 (
    echo [ERROR] Obfuscation failed
    echo Restoring original files...
    node "%~dp0..\..\tools\obfuscate.js" restore --target=dingzhi >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] Obfuscation completed
echo.

echo [6/8] Running build...
set ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://registry.npmmirror.com/-/binary/electron-builder-binaries/
REM better-sqlite3 prebuild-install downloads prebuilt packages from GitHub Releases, sometimes SSL cert verification fails
REM Temporarily disable TLS cert verification (build only) to ensure prebuild-install downloads packages matching electron ABI
REM Code signing disabled (pfx and cert-password.txt removed; package.json has no certificateFile)
echo.
echo [CHECK] ============================================
echo [CHECK] 打包前安全完整性验证
echo [CHECK] ============================================
node "%~dp0..\..\tools\pre-build-check.js" "%CD%"
if errorlevel 1 (
    echo [FAIL] 安全检查未通过，终止打包！请修复 package.json 的 files 列表
    node "%~dp0..\..\tools\obfuscate.js" restore --target=dingzhi >nul 2>&1
    exit /b 1
)
echo [OK] 安全检查通过
echo.

echo [CHECK] 磁盘空间检查...
for /f "delims=" %%d in ('powershell -NoProfile -Command "[math]::Round((Get-PSDrive -Name $((Get-Location).Drive.Name)).Free/1GB,2)"') do set "FREE_GB=%%d"
echo       Disk free: %FREE_GB% GB
if "%FREE_GB%"=="" set "FREE_GB=0"
powershell -NoProfile -Command "if([double]'%FREE_GB%' -lt 1.0){ Write-Host '[ERROR] 磁盘空间不足: %FREE_GB%GB, 需要>=1GB'; exit 1 }"
if errorlevel 1 (
    node "%~dp0..\..\tools\obfuscate.js" restore --target=dingzhi >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] 磁盘空间充足
echo.

REM P1-Reliability: isolate TEMP directory to project tmp/ to avoid C: drive space/permission issues
set "PREV_TEMP=%TEMP%"
set "PREV_TMP=%TMP%"
if not exist "tmp" mkdir tmp
set "TEMP=%CD%\tmp"
set "TMP=%CD%\tmp"

set NODE_TLS_REJECT_UNAUTHORIZED=0
call npm run build
set "BUILD_RC=%errorlevel%"
REM P1-Security hardening: clear temporary TLS disable to avoid polluting dev environment
set NODE_TLS_REJECT_UNAUTHORIZED=
if not "%BUILD_RC%"=="0" (
    echo.
    echo [WARN] First build attempt failed, retrying...
    timeout /t 3 /nobreak >nul
    set NODE_TLS_REJECT_UNAUTHORIZED=0
    call npm run build
    set "BUILD_RC=%errorlevel%"
    set NODE_TLS_REJECT_UNAUTHORIZED=
)

REM Restore TEMP regardless of build result
set "TEMP=%PREV_TEMP%"
set "TMP=%PREV_TMP%"
if exist "tmp" rmdir /s /q "tmp" 2>nul

if not "%BUILD_RC%"=="0" (
    echo.
    echo [ERROR] Build failed, please check logs above
    echo Restoring original JavaScript code...
    node "%~dp0..\..\tools\obfuscate.js" restore --target=dingzhi >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
echo.

echo [VERIFY] 产物完整性验证...
set "EXE_FILE="
for %%f in ("%OUTPUT_DIR%\*.exe") do set "EXE_FILE=%%f"
if "%EXE_FILE%"=="" (
    echo [ERROR] No exe file found in %OUTPUT_DIR%
    node "%~dp0..\..\tools\obfuscate.js" restore --target=dingzhi >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
for %%A in ("%EXE_FILE%") do (
    if %%~zA LSS 1000000 (
        echo [ERROR] exe file too small: %%~zA bytes ^(< 1MB^), build may be incomplete
        node "%~dp0..\..\tools\obfuscate.js" restore --target=dingzhi >nul 2>&1
        if not defined NO_PAUSE pause
        exit /b 1
    )
    if %%~zA GTR 200000000 (
        echo [WARN] exe file unusually large: %%~zA bytes ^(^> 200MB^)
    )
    echo [OK] %%~nxA  %%~zA bytes
)
echo.

echo Restoring original JavaScript code...
node "%~dp0..\..\tools\obfuscate.js" restore --target=dingzhi
if errorlevel 1 (
    echo [ERROR] Restore failed! Source code may remain obfuscated.
    echo Please manually run: node "%~dp0..\..\tools\obfuscate.js" restore --target=dingzhi
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] Original code restored
echo.

echo [7/8] Build completed
echo Output dir: %CD%\%OUTPUT_DIR%
echo ============================================
if exist "dist_old_*" (
    echo [NOTE] Old build artifacts saved as dist_old_* directories
    echo        These will be auto-cleaned in future builds (keeping latest 2)
)
REM P1-Enhancement: show build elapsed time
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
for /f "delims=" %%e in ('powershell -NoProfile -Command "$s=[DateTime]::Parse('%BUILD_START_TIME%'); $e=[DateTime]::Parse('%BUILD_END_TIME%'); $d=$e-$s; $d.ToString('hh\:mm\:ss')"') do set "BUILD_ELAPSED=%%e"
powershell -NoProfile -Command "Write-Host '============================================' -ForegroundColor Yellow; Write-Host '  打包完成!' -ForegroundColor Yellow; Write-Host '  开始: %BUILD_START_TIME%' -ForegroundColor Yellow; Write-Host '  结束: %BUILD_END_TIME%' -ForegroundColor Yellow; Write-Host '  总耗时: %BUILD_ELAPSED%' -ForegroundColor Yellow; Write-Host '============================================' -ForegroundColor Yellow"
exit /b 0
