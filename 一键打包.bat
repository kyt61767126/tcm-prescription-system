@echo off
REM Save original console codepage before switching to UTF-8 (restore on exit
REM so callers chaining this bat from an open terminal keep their codepage).
for /f "tokens=2 delims=:" %%c in ('chcp') do set "OLD_CP=%%c"
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

REM [2026-10-25] Git sync-state preflight (informational only; never changes exit code).
REM Rationale: 2026-10-25 AutoCommit push failed silently (single WARN line) and left the
REM version side-effect commit local-only - building from such a tree is a classic source
REM of "local artifact != online version" release conflicts. The post-build check repeats it.
call :git_state_check "pre-build"

REM Check one-click-pack.ps1 exists
set "PACK_PS1=%~dp0tools\one-click-pack.ps1"
if not exist "%PACK_PS1%" (
    powershell -NoProfile -Command "Write-Host '[ERROR] one-click-pack.ps1 not found' -ForegroundColor Red"
    echo   Path: %PACK_PS1%
    if not defined NO_PAUSE pause
    set "EXIT_CODE=1"
    goto do_exit
)

REM [2026-09-05] Entry self-heal consolidated into tools\entry-selfheal.ps1 (single
REM source shared with the one-click publish entry): downstream .bat CRLF repair + .ps1
REM BOM repair. New downstream build .bat only needs to be added in that ps1.
REM This entry bat is ASCII-only so it is immune to line-ending corruption.
REM [2026-10-25] Missing self-heal tool degrades to a warning instead of failing a
REM healthy build/publish (previously a deleted/moved tool path aborted the whole run).
set "HEAL_RC=0"
if not exist "%~dp0tools\entry-selfheal.ps1" goto selfheal_missing
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\entry-selfheal.ps1"
set "HEAL_RC=%errorlevel%"
if %HEAL_RC% neq 0 (
    echo.
    powershell -NoProfile -Command "Write-Host '[ERROR] Entry self-heal failed with code: %HEAL_RC%' -ForegroundColor Red"
    if not defined NO_PAUSE pause
    set "EXIT_CODE=%HEAL_RC%"
    goto do_exit
)
goto selfheal_done
:selfheal_missing
echo   [WARN] tools\entry-selfheal.ps1 not found - skipping entry self-heal.
:selfheal_done

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
call :git_state_check "post-build"

if %EXIT_CODE% neq 0 (
    echo.
    powershell -NoProfile -Command "Write-Host '[ERROR] One-click packaging exited with code: %EXIT_CODE%' -ForegroundColor Red"
)
echo.
REM With args (auto mode) no pause; no args (interactive menu) or explicit NO_PAUSE pauses as needed
if not defined NO_PAUSE if "%~1"=="" pause

:do_exit
REM Unified exit: restore original codepage, then propagate the real exit code.
if defined OLD_CP chcp %OLD_CP: =% >nul
exit /b %EXIT_CODE%

REM ============================================================================
REM helper: print git ahead/behind/dirty state (informational only, always exit /b 0)
REM ============================================================================
:git_state_check
set "GS_PHASE=%~1"
set "GS_AHEAD="
set "GS_BEHIND="
set "GS_DIRTY="
for /f %%A in ('git rev-list --count "@{u}..HEAD" 2^>nul') do set "GS_AHEAD=%%A"
for /f %%A in ('git rev-list --count "HEAD..@{u}" 2^>nul') do set "GS_BEHIND=%%A"
git diff --quiet 2>nul || set "GS_DIRTY=1"
git diff --cached --quiet 2>nul || set "GS_DIRTY=1"
if defined GS_DIRTY echo   [WARN] Uncommitted tracked changes detected (%GS_PHASE%) - AutoCommit only collects version side effects.
if defined GS_BEHIND if not "%GS_BEHIND%"=="0" echo   [WARN] Behind upstream by %GS_BEHIND% commit(s) (%GS_PHASE%) - run "git pull --rebase" to avoid building on a stale base.
if defined GS_AHEAD if not "%GS_AHEAD%"=="0" echo   [WARN] Ahead of upstream by %GS_AHEAD% commit(s) (%GS_PHASE%) - run "git push" before publishing a release.
exit /b 0
