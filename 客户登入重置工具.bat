@echo off
rem ============================================================
rem  HuiKang TCM - Login/Activation Reset Tool (ASCII safe)
rem  Keep-window guard: when double-clicked, relaunch in a
rem  persistent cmd window so it can never "flash and close".
rem ============================================================
if /i "%~1"=="keep" goto main
start "HKZY Reset" cmd /k ""%~f0" keep"
exit /b 0

:main
title HuiKang TCM - Reset Tool
echo ============================================================
echo    HuiKang TCM  -  Login Reset Tool  (v3)
echo ------------------------------------------------------------
echo  This tool will do 4 things:
echo    1. Close HuiKang software
echo    2. Backup patient data to your Desktop
echo    3. Clear saved account, password and activation info
echo       (including the hidden partition storage that kept
echo        old accounts in the CLOUD edition)
echo    4. Clean portable edition auth files if a portable copy
echo       is currently running
echo.
echo  After that, open the software again = like a brand new
echo  install: register a NEW account and activate again.
echo.
echo  *** BEFORE CONTINUE ***
echo  Contact customer service WeChat: hktzy1688
echo  Ask them to unbind the old activation code from this PC,
echo  otherwise activation will say "device limit reached".
echo ============================================================
echo.
set /p CHOICE=Type 1 then press ENTER to start (other key = exit):
if not "%CHOICE%"=="1" (
    echo.
    echo Cancelled. Nothing changed.
    echo You can close this window now.
    pause
    goto :eof
)

echo.
echo ============================================================
echo  Which edition do you want to reset?
echo    1 = BOTH offline and cloud  (use this if unsure)
echo    2 = CLOUD edition ONLY
echo        (choose this if the offline edition is already
echo         re-registered and working, so it stays untouched)
echo    3 = OFFLINE edition ONLY
echo ============================================================
set "ED=1"
set /p ED=Enter 1, 2 or 3 then press ENTER (default 1):
if not "%ED%"=="2" if not "%ED%"=="3" set "ED=1"
if "%ED%"=="2" echo    Will reset CLOUD only, offline stays untouched.
if "%ED%"=="3" echo    Will reset OFFLINE only, cloud stays untouched.
if "%ED%"=="1" echo    Will reset BOTH editions.
echo.
echo [1/5] Closing HuiKang software, please wait...
rem --- Record exe paths BEFORE closing them (portable detection) ---
set "EXELIST=%TEMP%\hkzy-running-exes.txt"
if exist "%EXELIST%" del /f /q "%EXELIST%" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command "$h=[char]0x60e0+[char]0x5eb7; $paths = Get-Process | Where-Object { ($_.ProcessName -like ('*'+$h+'*')) -or ($_.ProcessName -like 'tcm-prescription*') } | ForEach-Object { try { $_.Path } catch {} } | Where-Object { $_ } | Sort-Object -Unique; if ($paths) { [System.IO.File]::WriteAllLines($env:EXELIST, $paths, (New-Object System.Text.UTF8Encoding $false)) }"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$h=[char]0x60e0+[char]0x5eb7; Get-Process | Where-Object { ($_.ProcessName -like ('*'+$h+'*')) -or ($_.ProcessName -like 'tcm-prescription*') } | Stop-Process -Force -ErrorAction SilentlyContinue"
ping -n 4 127.0.0.1 >nul

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set STAMP=%%i
set "BAK=%USERPROFILE%\Desktop\HKZY-Backup-%STAMP%"
echo [2/5] Backup folder: %BAK%
echo [3/5] Checking installed versions...
if not "%ED%"=="2" call :clean "%APPDATA%\tcm-prescription" "offline"
if not "%ED%"=="3" call :clean "%APPDATA%\tcm-prescription-cloud" "cloud"

echo [4/5] Checking portable edition (if it was running)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$files=@('config.json','license.dat','license.json','users-backup.json','trial-config.json','activation-flow.json','registration-info.json','admin-request-id.dat','admin-account.dat'); $mode=$env:ED; $cloudChar=[char]0x4E91; if (Test-Path -LiteralPath $env:EXELIST) { $n=0; Get-Content -Encoding UTF8 -LiteralPath $env:EXELIST | ForEach-Object { $exe=$_; $isCloud = ($exe -like '*tcm-prescription-cloud*') -or ($exe.Contains($cloudChar)); if (($mode -eq '2') -and (-not $isCloud)) { return }; if (($mode -eq '3') -and $isCloud) { return }; $dir=Split-Path -Parent $exe; if ($dir -and (Test-Path (Join-Path $dir 'config.json'))) { $n=$n+1; $tag = if ($isCloud) {'cloud'} else {'offline'}; $bak=Join-Path $env:BAK ('portable-'+$tag+'-'+$n+'-auth'); New-Item -ItemType Directory -Force -Path $bak | Out-Null; foreach ($f in $files) { $p=Join-Path $dir $f; if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination $bak -Force; Remove-Item -LiteralPath $p -Force } }; Write-Host ('   - cleaned portable ('+$tag+'): ' + $dir) } } }"
if exist "%EXELIST%" del /f /q "%EXELIST%" >nul 2>&1

echo.
echo [5/5] Done!
echo ============================================================
echo  Next steps:
echo    1. Open HuiKang software (double click the normal icon)
echo    2. On the login screen click the teal button:
echo       "Admin Activation" (a small window: choose edition,
echo       enter code, or submit an activation request)
echo    3. Register with a NEW phone number and activate
echo.
echo  IMPORTANT for the CLOUD edition:
echo    Use the NEW activation code that customer service gave
echo    you, with your NEW phone number.
echo.
echo  Patient data backup is on your Desktop:
echo  HKZY-Backup-%STAMP%
echo.
echo  You can close this window now.
echo ============================================================
pause
goto :eof

:clean
set "DIR=%~1"
set "NAME=%~2"
if not exist "%DIR%" (
    echo   - %NAME% version not found, skip
    goto :eof
)
echo   - %NAME% version found, backing up...
if not exist "%BAK%\%NAME%-data" robocopy "%DIR%\data" "%BAK%\%NAME%-data" /E /NFL /NDL /NJH /NJS /NC /NS >nul 2>&1
if not exist "%BAK%\%NAME%-downloads" robocopy "%DIR%\downloads" "%BAK%\%NAME%-downloads" /E /NFL /NDL /NJH /NJS /NC /NS >nul 2>&1
if not exist "%BAK%\%NAME%-license-backup" md "%BAK%\%NAME%-license-backup" >nul 2>&1
for %%F in (config.json license.dat license.json users-backup.json admin-request-id.dat admin-account.dat registration-info.json login-state.json gate.dat) do (
    if exist "%DIR%\%%F" copy /y "%DIR%\%%F" "%BAK%\%NAME%-license-backup\" >nul 2>&1
)
echo   - clearing %NAME% saved account / password / activation...
rem --- Default partition (used by the separate activation window) ---
rd /s /q "%DIR%\Local Storage" 2>nul
rd /s /q "%DIR%\Session Storage" 2>nul
rd /s /q "%DIR%\IndexedDB" 2>nul
rem --- Persistent partition (login + main windows store their
rem    localStorage HERE, including old accounts and the flag that
rem    hides the register entry). This was the v2 miss on cloud. ---
rd /s /q "%DIR%\Partitions" 2>nul
del /f /q "%DIR%\config.json" 2>nul
del /f /q "%DIR%\license.dat" 2>nul
del /f /q "%DIR%\license.json" 2>nul
del /f /q "%DIR%\trial-config.json" 2>nul
del /f /q "%DIR%\activation-flow.json" 2>nul
del /f /q "%DIR%\registration-info.json" 2>nul
del /f /q "%DIR%\admin-request-id.dat" 2>nul
del /f /q "%DIR%\admin-account.dat" 2>nul
del /f /q "%DIR%\users-backup.json" 2>nul
del /f /q "%DIR%\login-state.json" 2>nul
del /f /q "%DIR%\gate.dat" 2>nul
echo   - %NAME% done
goto :eof
