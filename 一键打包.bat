@echo off
REM Save original console codepage before switching to UTF-8 (restore on exit
REM so callers chaining this bat from an open terminal keep their codepage).
for /f "tokens=2 delims=:" %%c in ('chcp') do set "OLD_CP=%%c"
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

REM [2026-10-30] Git sync-state preflight + entry self-heal consolidated into
REM tools\entry-preflight.ps1 (single source, shared with the one-click publish
REM entry). Before this change both entry bats carried their own copy of the git
REM checks (~30 lines) plus a separate entry-selfheal invocation block (~18 lines);
REM the only real difference was that publish hard-stops when "behind upstream".
REM Mode "pack" only warns (never blocks a healthy build), "pack-post" re-checks
REM the tree after the build (catches an AutoCommit push that silently failed).
call :run_preflight pack
set "PF_RC=%errorlevel%"
if not "%PF_RC%"=="0" goto preflight_failed

REM Check one-click-pack.ps1 exists
set "PACK_PS1=%~dp0tools\one-click-pack.ps1"
if not exist "%PACK_PS1%" (
    powershell -NoProfile -Command "Write-Host '[ERROR] one-click-pack.ps1 not found' -ForegroundColor Red"
    echo   Path: %PACK_PS1%
    if not defined NO_PAUSE pause
    set "EXIT_CODE=1"
    goto do_exit
)

REM Launch one-click-pack.ps1 (forward args: 1=cloud 2=offline 3=all 4=smart, auto mode no pause)
REM NOTE [BUILD-LOCK 2026-08-23]: concurrent builds are serialized by
REM tools\build-lock.ps1 inside build-pack.bat/build.bat/build-app.bat.
REM If another build is running, the child build aborts with a clear message.
REM [2026-09-01] Always append -AutoCommit: auto collect+commit+push packaging
REM side effects (versionCode/version bumps) after build, so they never pile up
REM uncommitted and block the source-settled gate on the next build.
REM Opt out by setting NO_AUTOCOMMIT=1 (side effects listed for manual commit).
REM [2026-09-23] Do not duplicate -AutoCommit if the caller already passed it
REM (PowerShell rejects binding a named switch twice).
set "EXTRA_ARGS=-AutoCommit"
if defined NO_AUTOCOMMIT set "EXTRA_ARGS="
echo %* | findstr /i /c:"-AutoCommit" >nul && set "EXTRA_ARGS="
powershell -NoProfile -ExecutionPolicy Bypass -File "%PACK_PS1%" %* %EXTRA_ARGS%
set "EXIT_CODE=%errorlevel%"

REM If the post-build check reports "Ahead of upstream", AutoCommit push was rejected:
REM run "git push" before publishing (otherwise release is built from local-only commits).
call :run_preflight pack-post

if %EXIT_CODE% neq 0 (
    echo.
    powershell -NoProfile -Command "Write-Host '[ERROR] One-click packaging exited with code: %EXIT_CODE%' -ForegroundColor Red"
)
echo.
REM With args (auto mode) no pause; no args (interactive menu) or explicit NO_PAUSE pauses as needed
if not defined NO_PAUSE if "%~1"=="" pause
goto do_exit

:preflight_failed
echo.
powershell -NoProfile -Command "Write-Host '[ERROR] Entry preflight failed with code: %PF_RC%' -ForegroundColor Red"
if not defined NO_PAUSE pause
set "EXIT_CODE=%PF_RC%"
goto do_exit

:do_exit
REM Unified exit: restore original codepage, then propagate the real exit code.
if defined OLD_CP chcp %OLD_CP: =% >nul
exit /b %EXIT_CODE%

REM ============================================================================
REM helper: run tools\entry-preflight.ps1 (git state + self-heal, single source)
REM Degrades to a warning when the helper is missing (never abort a healthy build).
REM ============================================================================
:run_preflight
if not exist "%~dp0tools\entry-preflight.ps1" (
    echo   [WARN] tools\entry-preflight.ps1 not found - skipping entry preflight.
    exit /b 0
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\entry-preflight.ps1" -Mode %~1
exit /b %errorlevel%
