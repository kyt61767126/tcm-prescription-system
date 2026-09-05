@echo off
setlocal enableextensions
REM [FIX 2026-08-31] switch console to UTF-8 (align with one-click-pack.bat):
REM downstream publish-release.js (node) emits UTF-8 Chinese; default GBK codepage
REM rendered the final release-version summary as mojibake.
chcp 65001 >nul
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

REM [2026-09-05] Entry self-heal consolidated into tools\entry-selfheal.ps1 (single
REM source shared with one-click-pack.bat): downstream .bat CRLF repair + .ps1
REM BOM repair. New downstream build .bat only needs to be added in that ps1.
REM This entry bat is ASCII-only so it is immune to line-ending corruption.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\entry-selfheal.ps1"
set "HEAL_RC=%errorlevel%"
if %HEAL_RC% neq 0 (
    echo.
    powershell -NoProfile -Command "Write-Host '[ERROR] Entry self-heal failed with code: %HEAL_RC%'"
    if not defined NO_PAUSE pause
    exit /b %HEAL_RC%
)

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
REM [2026-09-05] Propagate real exit code to callers (CI / schedulers / chained flows)
exit /b %EXIT_CODE%
