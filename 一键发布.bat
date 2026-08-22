@echo off
setlocal enableextensions
cd /d "%~dp0"

REM One-Click Publish (Chinese name entry, symmetric with one-click-pack.bat)
REM Calls tools\release-menu.ps1 (pack / publish / verify menu)

set "RELEASE_PS1=%~dp0tools\release-menu.ps1"
if not exist "%RELEASE_PS1%" (
    powershell -NoProfile -Command "Write-Host '[ERROR] release-menu.ps1 not found'"
    echo   Path: %RELEASE_PS1%
    if not defined NO_PAUSE pause
    exit /b 1
)

echo [one-click-publish] Self-heal: fix LF line endings in downstream build .bat files...
REM [SELF-HEAL 2026-08-23] release-menu.ps1 invokes build-app.bat directly
REM (bypassing pack-* entries). Fix all downstream .bat BEFORE parsing.
REM This entry bat is ASCII-only so it is immune to line-ending corruption.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\fix-bat-crlf.ps1" "%~dp0app_project\db-yunduan\pack-desktop.bat" "%~dp0app_project\db-yunduan\build-pack.bat" "%~dp0app_project\db-yunduan\build-app.bat" "%~dp0app_project\db-yunduan\cloud_desktop\build.bat" "%~dp0app_project\db-offline\pack-desktop.bat" "%~dp0app_project\db-offline\build-pack.bat" "%~dp0app_project\db-offline\app\build-app.bat" "%~dp0app_project\db-offline\desktop\build.bat"

REM Launch release-menu.ps1
REM NOTE [BUILD-LOCK 2026-08-23]: concurrent builds are serialized by
REM tools\build-lock.ps1 inside build-pack.bat/build.bat/build-app.bat.
REM If another build is running, the child build aborts with a clear message.
powershell -NoProfile -ExecutionPolicy Bypass -File "%RELEASE_PS1%"
set "EXIT_CODE=%errorlevel%"

if %EXIT_CODE% neq 0 (
    echo.
    powershell -NoProfile -Command "Write-Host '[ERROR] One-click publish exited with code: %EXIT_CODE%'"
)
echo.
if not defined NO_PAUSE pause
