@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Huikang TCM Cloud - Desktop Build

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
    if not defined NO_PAUSE pause
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

echo [3/8] Closing remaining processes...
taskkill /F /IM "HuikangTCM*.exe" >nul 2>&1
taskkill /F /IM "Huikang*.exe" >nul 2>&1
powershell -NoProfile -Command "Get-Process | Where-Object { try { $_.Path -like '*db-yunduan/cloud_desktop*dist*' } catch { $false } } | Stop-Process -Force -ErrorAction SilentlyContinue" 2>nul
echo [OK] Processes cleaned
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
for /f "delims=" %%D in ('dir /b /ad "build_output_old_*" 2^>nul ^| sort /r') do (
    rmdir /s /q "%%D" 2>nul
)

if exist "%OUTPUT_DIR%" (
    rmdir /s /q "%OUTPUT_DIR%" 2>nul
    if exist "%OUTPUT_DIR%" (
        echo [WARNING] Direct delete failed, trying PowerShell force delete...
        powershell -ExecutionPolicy Bypass -Command "try { [System.IO.Directory]::Delete('%CD%\%OUTPUT_DIR%', $true) } catch { Write-Host '[WARNING] delete failed' }" 2>nul
    )
    if exist "%OUTPUT_DIR%" (
        for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd_HHmmss'"') do set "DSTAMP=%%t"
        echo [WARNING] Could not delete %OUTPUT_DIR%, renaming to dist_old_!DSTAMP!...
        rename "%OUTPUT_DIR%" "dist_old_!DSTAMP!" 2>nul
        if exist "%OUTPUT_DIR%" (
            echo [ERROR] Cannot clean or rename %OUTPUT_DIR% directory
            if not defined NO_PAUSE pause
            exit /b 1
        )
    )
)

echo [OK] Old artifacts cleaned
echo.

echo [CHECK] ============================================
echo [CHECK] 打包前安全完整性验证
echo [CHECK] ============================================
node "%~dp0..\..\..\tools\pre-build-check.js" "%CD%"
if errorlevel 1 (
    echo [FAIL] 安全检查未通过，终止打包！请修复 package.json 的 files 列表
    exit /b 1
)
echo [OK] 安全检查通过
echo.

echo [5/8] Obfuscating JavaScript code (target=cloud)...
node "%~dp0..\..\..\tools\obfuscate.js" --target=cloud
if errorlevel 1 (
    echo [ERROR] Obfuscation failed
    echo Restoring original files...
    node "%~dp0..\..\..\tools\obfuscate.js" restore --target=cloud >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] Obfuscation completed
echo.

echo [6/8] Preparing win-unpacked directory...
set ELECTRON_BUILDER_BINARIES_MIRROR=https://registry.npmmirror.com/-/binary/electron-builder-binaries/
set NODE_TLS_REJECT_UNAUTHORIZED=0
REM VERSION_DIR no longer needed, using %CD%
REM stripped trailing backslash not needed with %CD%
node "%~dp0..\..\..\tools\prepare-win-unpacked.js" "%CD%"
if errorlevel 1 (
    echo [ERROR] prepare-win-unpacked failed
    set NODE_TLS_REJECT_UNAUTHORIZED=
    node "%~dp0..\..\..\tools\obfuscate.js" restore --target=cloud >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] win-unpacked prepared
echo.

echo [6.5/8] Running electron-builder --prepackaged...
REM Read actual win-unpacked path (may differ if original was locked)
set "WIN_UNPACKED_PATH=dist/win-unpacked"
if exist "dist\win-unpacked-path.txt" (
    set /p WIN_UNPACKED_PATH=<dist\win-unpacked-path.txt
)
echo       Using prepackaged: %WIN_UNPACKED_PATH%
REM Code signing disabled (pfx and cert-password.txt removed; package.json has no certificateFile)
set "PREV_TEMP=%TEMP%"
set "PREV_TMP=%TMP%"
if not exist "tmp" mkdir tmp
set "TEMP=%CD%\tmp"
set "TMP=%CD%\tmp"
node "node_modules\electron-builder\cli.js" --win --prepackaged "%WIN_UNPACKED_PATH%"
set "BUILD_RC=%errorlevel%"
set NODE_TLS_REJECT_UNAUTHORIZED=
set "TEMP=%PREV_TEMP%"
set "TMP=%PREV_TMP%"
if exist "tmp" rmdir /s /q "tmp" 2>nul
if not "%BUILD_RC%"=="0" (
    echo.
    echo [WARNING] electron-builder returned exit code %BUILD_RC%, checking output...
    set "HAS_EXE=0"
    for %%f in ("%OUTPUT_DIR%\*.exe") do set "HAS_EXE=1"
    if "!HAS_EXE!"=="1" (
        echo [OK] Build output verified - exe files found despite exit code %BUILD_RC%
    ) else (
        echo [ERROR] Build failed - no exe files found
        echo Restoring original JavaScript code...
        node "%~dp0..\..\..\tools\obfuscate.js" restore --target=cloud >nul 2>&1
        if not defined NO_PAUSE pause
        exit /b 1
    )
)
echo.

echo [7/8] Restoring original JavaScript code...
node "%~dp0..\..\..\tools\obfuscate.js" restore --target=cloud
if errorlevel 1 (
    echo [ERROR] Restore failed
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] Original code restored
echo.

echo [7.5/8] Verifying build output...
set "EXE_FILE="
for %%f in ("%OUTPUT_DIR%\*.exe") do set "EXE_FILE=%%f"
if "%EXE_FILE%"=="" (
    echo [WARN] No .exe found in %OUTPUT_DIR%
) else (
    for %%A in ("%EXE_FILE%") do (
        echo   [OK] %%~nxA  %%~zA bytes
    )
)
echo.

echo [8/8] Build completed
echo Output dir: %CD%\%OUTPUT_DIR%
echo ============================================
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
for /f "delims=" %%e in ('powershell -NoProfile -Command "$s=[DateTime]::Parse('%BUILD_START_TIME%'); $e=[DateTime]::Parse('%BUILD_END_TIME%'); $d=$e-$s; $d.ToString('hh\:mm\:ss')"') do set "BUILD_ELAPSED=%%e"
powershell -NoProfile -Command "Write-Host '============================================' -ForegroundColor Yellow; Write-Host '  打包完成!' -ForegroundColor Yellow; Write-Host '  开始: %BUILD_START_TIME%' -ForegroundColor Yellow; Write-Host '  结束: %BUILD_END_TIME%' -ForegroundColor Yellow; Write-Host '  总耗时: %BUILD_ELAPSED%' -ForegroundColor Yellow; Write-Host '============================================' -ForegroundColor Yellow"
if not defined NO_PAUSE (
    set "EXIT_KEY="
    set /p "EXIT_KEY=按 0 或回车键退出: "
)
exit /b 0