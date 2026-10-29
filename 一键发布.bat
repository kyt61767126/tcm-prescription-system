@echo off
REM Save original console codepage before switching to UTF-8 (restore on exit
REM so callers chaining this bat from an open terminal keep their codepage).
for /f "tokens=2 delims=:" %%c in ('chcp') do set "OLD_CP=%%c"
chcp 65001 >nul
setlocal enableextensions
REM [FIX 2026-08-31] switch console to UTF-8 (align with one-click-pack.bat):
REM downstream publish-release.js (node) emits UTF-8 Chinese; default GBK codepage
REM rendered the final release-version summary as mojibake.
cd /d "%~dp0"

REM [2026-10-30] Git sync-state preflight + entry self-heal consolidated into
REM tools\entry-preflight.ps1 (single source, shared with the one-click pack entry).
REM Mode "publish" keeps the hard stop: never publish from a tree that is behind
REM upstream (a mid-publish push would be rejected and the site could regress).
REM Uncommitted changes / ahead-of-upstream stay informational (release-menu.ps1
REM has its own source-settled gate; publish-release --push pushes local commits).
call :run_preflight publish
set "PF_RC=%errorlevel%"
if not "%PF_RC%"=="0" goto preflight_failed

REM [2026-10-25] Read-only release readiness report (artifact vs published manifest,
REM hot-update content staleness, and the "last pack fully skipped -> full flow would
REM falsely skip publish" trap). Informational only - never blocks the menu on purpose.
if exist "%~dp0tools\check-release-readiness.cjs" (
    node "%~dp0tools\check-release-readiness.cjs"
) else (
    echo   [WARN] tools\check-release-readiness.cjs not found - skipping readiness report.
)

REM One-Click Publish (Chinese name entry, symmetric with one-click-pack.bat)
REM Calls tools\release-menu.ps1 (interactive pack / publish / verify menu).
REM Env knobs: NO_PAUSE=1 skips the final pause (CI / chained flows).
REM Hard rule enforced downstream: built artifacts are NEVER auto-uploaded to
REM the official download site; publishing always needs explicit confirmation
REM in the menu plus the read-only compliance gate (publish-release.js).

set "RELEASE_PS1=%~dp0tools\release-menu.ps1"
if not exist "%RELEASE_PS1%" (
    powershell -NoProfile -Command "Write-Host '[ERROR] release-menu.ps1 not found' -ForegroundColor Red"
    echo   Path: %RELEASE_PS1%
    if not defined NO_PAUSE pause
    set "EXIT_CODE=1"
    goto do_exit
)

REM Launch release-menu.ps1
REM NOTE [BUILD-LOCK 2026-08-23]: concurrent builds are serialized by
REM tools\build-lock.ps1 inside build-pack.bat/build.bat/build-app.bat.
REM If another build is running, the child build aborts with a clear message.
powershell -NoProfile -ExecutionPolicy Bypass -File "%RELEASE_PS1%"
set "EXIT_CODE=%errorlevel%"

if %EXIT_CODE% neq 0 (
    echo.
    powershell -NoProfile -Command "Write-Host '[ERROR] One-click publish exited with code: %EXIT_CODE%' -ForegroundColor Red"
)
echo.
if not defined NO_PAUSE pause
goto do_exit

:preflight_failed
echo.
if "%PF_RC%"=="2" (
    powershell -NoProfile -Command "Write-Host '[ERROR] Local branch is behind upstream. Run: git pull --rebase, then re-run this entry.' -ForegroundColor Red"
) else (
    powershell -NoProfile -Command "Write-Host '[ERROR] Entry preflight failed with code: %PF_RC%' -ForegroundColor Red"
)
if not defined NO_PAUSE pause
set "EXIT_CODE=%PF_RC%"
goto do_exit

:do_exit
REM Unified exit: restore original codepage, then propagate the real exit code.
if defined OLD_CP chcp %OLD_CP: =% >nul
exit /b %EXIT_CODE%

REM ============================================================================
REM helper: run tools\entry-preflight.ps1 (git state + self-heal, single source)
REM Degrades to a warning when the helper is missing (never abort a healthy publish).
REM ============================================================================
:run_preflight
if not exist "%~dp0tools\entry-preflight.ps1" (
    echo   [WARN] tools\entry-preflight.ps1 not found - skipping entry preflight.
    exit /b 0
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\entry-preflight.ps1" -Mode %~1
exit /b %errorlevel%
