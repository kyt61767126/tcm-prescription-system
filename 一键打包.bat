@echo off
setlocal enableextensions
cd /d "%~dp0"

REM Check one-click-pack.ps1 exists
set "PACK_PS1=%~dp0tools\one-click-pack.ps1"
if not exist "%PACK_PS1%" (
    powershell -NoProfile -Command "Write-Host '[ERROR] one-click-pack.ps1 not found'"
    echo   Path: %PACK_PS1%
    if not defined NO_PAUSE pause
    exit /b 1
)

REM Launch one-click-pack.ps1 (forward args: 1=云端 2=本地 3=全部, 自动模式不暂停)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PACK_PS1%" %*
set "EXIT_CODE=%errorlevel%"

if %EXIT_CODE% neq 0 (
    echo.
    powershell -NoProfile -Command "Write-Host '[ERROR] One-click packaging exited with code: %EXIT_CODE%'"
)
echo.
REM 带参数(自动模式)不暂停；无参数(交互菜单)或显式 NO_PAUSE 时才按需暂停
if not defined NO_PAUSE if "%~1"=="" pause
