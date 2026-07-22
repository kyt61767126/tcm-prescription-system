@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Huikang TCM Cloud - Desktop Build

REM ��¼�����ʼʱ�䣨���ں�ʱͳ�ƣ�- ʹ�� PowerShell ��� wmic��Windows 11 �����ã�
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
REM P0-�Ż�����ȷƥ����Ŀ��ؽ��̣�������ɱ���� Electron Ӧ�ã��� VSCode��Slack �ȣ�
REM ����ֹ�� cloud_desktop/dist �� build_output Ŀ¼�����Ľ���
taskkill /F /IM "HuikangTCM*.exe" >nul 2>&1
taskkill /F /IM "�ݿ���ҽ-�ƶ�.exe" >nul 2>&1
taskkill /F /IM "�ݿ���ҽ*.exe" >nul 2>&1
REM P0-�Ż����滻 wmic��Windows 11 ������������Ϊ PowerShell Get-Process����ȷ·��ƥ�䣩
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
        REM P0-�Ż����滻 wmic�������ã�Ϊ PowerShell Get-Date ����ʱ���
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

echo [6/8] Preparing win-unpacked directory...
REM ★ 修复：使用 --prepackaged 模式，跳过 app-builder.exe 解包步骤
set ELECTRON_BUILDER_BINARIES_MIRROR=https://registry.npmmirror.com/-/binary/electron-builder-binaries/
set NODE_TLS_REJECT_UNAUTHORIZED=0
node "%~dp0..\..\tools\prepare-win-unpacked.js" "%~dp0"
if errorlevel 1 (
    echo [ERROR] prepare-win-unpacked failed
    set NODE_TLS_REJECT_UNAUTHORIZED=
    node "%~dp0..\..\tools\obfuscate.js" restore --target=cloud >nul 2>&1
    pause
    exit /b 1
)
echo [OK] win-unpacked prepared
echo.

echo [6.5/8] Running electron-builder --prepackaged...
npx electron-builder --win --prepackaged dist/win-unpacked
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

REM P1-���ã���֤��������ҷǿգ�ʧ������ǰ�˳�
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
REM P1-���ã���ʾ����ܺ�ʱ
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
echo Start: %BUILD_START_TIME%
echo End:   %BUILD_END_TIME%
if not defined NO_PAUSE pause
