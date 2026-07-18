@echo off
setlocal enabledelayedexpansion

set "SELF_DIR=%~dp0"
set "PROJECT_ROOT=%SELF_DIR%.."

if "%1"=="" (
    echo Usage: build-common.bat ^<target^> ^<product_name^> ^<output_dir^> [--skip-config]
    echo   target: cloud ^| bendi ^| geren ^| dingzhi
    exit /b 1
)

set "TARGET=%1"
set "PRODUCT_NAME=%2"
set "OUTPUT_DIR=%3"
set "SKIP_CONFIG=%4"

set "TARGET_PATH="
set "PROCESS_LIST="
set "WMIC_PATTERN="
set "OLD_DIR_PREFIX="

if "%TARGET%"=="cloud" (
    set "TARGET_PATH=cloud_project\cloud_desktop"
    set "PROCESS_LIST=HuikangTCM.exe"
    set "WMIC_PATTERN=cloud_desktop"
    set "OLD_DIR_PREFIX=build_output_old_"
) else if "%TARGET%"=="bendi" (
    set "TARGET_PATH=offline_project\db-bendi"
    set "PROCESS_LIST=app-local.exe"
    set "WMIC_PATTERN=db-bendi"
    set "OLD_DIR_PREFIX=dist_old_"
) else if "%TARGET%"=="geren" (
    set "TARGET_PATH=offline_project\db-geren"
    set "PROCESS_LIST=app-personal.exe"
    set "WMIC_PATTERN=db-geren"
    set "OLD_DIR_PREFIX=dist_old_"
) else if "%TARGET%"=="dingzhi" (
    set "TARGET_PATH=offline_project\db-dingzhi"
    set "PROCESS_LIST=app-custom.exe"
    set "WMIC_PATTERN=db-dingzhi"
    set "OLD_DIR_PREFIX=dist_old_"
) else (
    echo [ERROR] Invalid target: %TARGET%
    pause
    exit /b 1
)

set "BUILD_DIR=%PROJECT_ROOT%\%TARGET_PATH%"

chcp 65001 >nul

cd /d "%BUILD_DIR%"

echo ============================================
echo  %PRODUCT_NAME% Build
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
taskkill /F /IM electron.exe >nul 2>&1
for %%P in (%PROCESS_LIST%) do (
    taskkill /F /IM "%%P" >nul 2>&1
)
powershell -ExecutionPolicy Bypass -Command "Get-Process | Where-Object { $_.Path -like '*%WMIC_PATTERN%*' } | Stop-Process -Force" 2>nul
timeout /t 2 /nobreak >nul
echo [OK] Processes cleaned
echo.

if not "%TARGET%"=="cloud" (
    echo [3/7] Configuring clinic info...
    if /i "%SKIP_CONFIG%"=="--skip-config" (
        echo       [SKIP] --skip-config parameter detected
    ) else (
        powershell -ExecutionPolicy Bypass -File "edit-config.ps1"
    )
    echo.
)

echo [4/7] Cleaning old build artifacts...

set old_count=0
for /f "delims=" %%D in ('dir /b /ad "%OLD_DIR_PREFIX%*" 2^>nul ^| sort /r') do (
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
        echo [WARNING] Could not delete %OUTPUT_DIR%, renaming to %OLD_DIR_PREFIX%!DSTAMP!...
        rename "%OUTPUT_DIR%" "%OLD_DIR_PREFIX%!DSTAMP!" 2>nul
        if exist "%OUTPUT_DIR%" (
            echo [ERROR] Cannot clean or rename %OUTPUT_DIR% directory
            echo         Please manually close any program using %OUTPUT_DIR%\ and retry
            pause
            exit /b 1
        )
    )
)
echo [OK] Old artifacts cleaned
echo.

echo [5/7] Obfuscating JavaScript code (target=%TARGET%)...
node "%PROJECT_ROOT%\tools\obfuscate.js" --target=%TARGET%
if errorlevel 1 (
    echo [ERROR] Obfuscation failed
    echo Restoring original files...
    node "%PROJECT_ROOT%\tools\obfuscate.js" restore --target=%TARGET% >nul 2>&1
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
    node "%PROJECT_ROOT%\tools\obfuscate.js" restore --target=%TARGET% >nul 2>&1
    pause
    exit /b 1
)
echo.

echo [7/7] Restoring original JavaScript code...
node "%PROJECT_ROOT%\tools\obfuscate.js" restore --target=%TARGET%
if errorlevel 1 (
    echo [ERROR] Restore failed! Source code may remain obfuscated.
    echo Please manually run: node "%PROJECT_ROOT%\tools\obfuscate.js" restore --target=%TARGET%
    pause
    exit /b 1
)
echo [OK] Original code restored
echo.

echo Build completed
echo Output dir: %CD%\%OUTPUT_DIR%
echo ============================================
if exist "%OLD_DIR_PREFIX%*" (
    echo [NOTE] Old build artifacts saved as %OLD_DIR_PREFIX%* directories
    echo        These will be auto-cleaned in future builds
)
pause