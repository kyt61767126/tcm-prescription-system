@echo off
chcp 65001 >nul
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

REM [2026-09-05] Entry self-heal consolidated into tools\entry-selfheal.ps1 (single
REM source shared with one-click-publish.bat): downstream .bat CRLF repair + .ps1
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

REM Launch one-click-pack.ps1 (forward args: 1=cloud 2=offline 3=all, auto mode no pause)
REM NOTE [BUILD-LOCK 2026-08-23]: concurrent builds are serialized by
REM tools\build-lock.ps1 inside build-pack.bat/build.bat/build-app.bat.
REM If another build is running, the child build aborts with a clear message.
REM [2026-09-01] Always append -AutoCommit: auto collect+commit+push packaging
REM side effects (versionCode/version bumps) after build, so they never pile up
REM uncommitted and block the source-settled gate on the next build.
REM Opt out by setting NO_AUTOCOMMIT=1 (side effects listed for manual commit).
set "EXTRA_ARGS=-AutoCommit"
if defined NO_AUTOCOMMIT set "EXTRA_ARGS="
powershell -NoProfile -ExecutionPolicy Bypass -File "%PACK_PS1%" %* %EXTRA_ARGS%
set "EXIT_CODE=%errorlevel%"

if %EXIT_CODE% neq 0 (
    echo.
    powershell -NoProfile -Command "Write-Host '[ERROR] One-click packaging exited with code: %EXIT_CODE%'"
)
echo.
REM With args (auto mode) no pause; no args (interactive menu) or explicit NO_PAUSE pauses as needed
if not defined NO_PAUSE if "%~1"=="" pause
REM [2026-09-05] Propagate real exit code to callers (CI / schedulers / chained flows)
exit /b %EXIT_CODE%
