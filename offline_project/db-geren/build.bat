@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Huikang TCM Personal - Offline Desktop Build

REM ��¼�����ʼʱ�䣨���ں�ʱͳ�ƣ�- ʹ�� PowerShell ��� wmic��Windows 11 �����ã�
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd_HHmmss'"') do set "BUILD_START_STAMP=%%t"

echo ============================================
echo  Huikang TCM Personal - Offline Desktop
echo  Start: %BUILD_START_TIME%
echo ============================================
echo.

echo [1/7] Checking environment...
where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm not found, please install Node.js first
    if not defined NO_PAUSE pause
    exit /b 1
)
echo       npm OK
echo.

echo [2/7] Closing remaining processes...
REM P0-�Ż�����ȷƥ����Ŀ��ؽ��̣�������ɱ���� Electron Ӧ�ã��� VSCode��Slack �ȣ�
taskkill /F /IM "app-personal.exe" >nul 2>&1
taskkill /F /IM "�ݿ���ҽ����.exe" >nul 2>&1
REM P0-�Ż����滻 wmic��Windows 11 ������������Ϊ PowerShell Get-Process����ȷ·��ƥ�䣩
powershell -NoProfile -Command "Get-Process | Where-Object { try { $_.Path -like '*db-geren*dist*' -or $_.Path -like '*db-geren*build_output*' } catch { $false } } | Stop-Process -Force -ErrorAction SilentlyContinue" 2>nul
echo [OK] Processes cleaned
ping -n 3 127.0.0.1 >nul 2>nul
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
        REM P0-�Ż����滻 wmic�������ã�Ϊ PowerShell Get-Date ����ʱ���
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

echo [5/7] Obfuscating JavaScript code (target=geren, may take 1-2 minutes)...
node "%~dp0..\..\tools\obfuscate.js" --target=geren
if errorlevel 1 (
    echo [ERROR] Obfuscation failed
    echo Restoring original files...
    node "%~dp0..\..\tools\obfuscate.js" restore --target=geren >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] Obfuscation completed
echo.

echo [6/7] Running build...
set ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://registry.npmmirror.com/-/binary/electron-builder-binaries/
REM better-sqlite3 prebuild-install �� GitHub Releases ����Ԥ���������ʱ SSL ֤����֤ʧ��
REM ��ʱ�ر� TLS ��֤���������ڼ䣩��ȷ�� prebuild-install �ܳɹ����� electron ABI ������
REM P1-安全加固: 证书密码从本地gitignore文件读取，避免硬编码泄露
if exist "%~dp0..\..\tools\certs\cert-password.txt" (
    for /f "delims=" %%p in (%~dp0..\..\tools\certs\cert-password.txt) do set "CSC_KEY_PASSWORD=%%p"
) else (
    echo [WARN] cert-password.txt not found, code signing may be skipped
)
set NODE_TLS_REJECT_UNAUTHORIZED=0
call npm run build
set "BUILD_RC=%errorlevel%"
REM P1-��ȫ��������� TLS ��ʱ������������Ⱦ���������
set NODE_TLS_REJECT_UNAUTHORIZED=
if not "%BUILD_RC%"=="0" (
    echo.
    echo [ERROR] Build failed, please check logs above
    echo Restoring original JavaScript code...
    node "%~dp0..\..\tools\obfuscate.js" restore --target=geren >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
echo.

echo Restoring original JavaScript code...
node "%~dp0..\..\tools\obfuscate.js" restore --target=geren
if errorlevel 1 (
    echo [ERROR] Restore failed! Source code may remain obfuscated.
    echo Please manually run: node "%~dp0..\..\tools\obfuscate.js" restore --target=geren
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] Original code restored
echo.

REM P1-���ã���֤��������ҷǿ�
set "EXE_FILE="
for %%f in ("%OUTPUT_DIR%\*.exe") do set "EXE_FILE=%%f"
if not "%EXE_FILE%"=="" (
    for %%A in ("%EXE_FILE%") do (
        echo   [OK] %%~nxA  %%~zA bytes
    )
)
echo.

echo [7/7] Build completed
echo Output dir: %CD%\%OUTPUT_DIR%
echo ============================================
if exist "dist_old_*" (
    echo [NOTE] Old build artifacts saved as dist_old_* directories
    echo        These will be auto-cleaned in future builds (keeping latest 2)
)
REM P1-���ã���ʾ����ܺ�ʱ
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
echo Start: %BUILD_START_TIME%
echo End:   %BUILD_END_TIME%
if not defined NO_PAUSE pause
exit /b 0
