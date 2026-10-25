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

REM [2026-10-25] Publish preflight: never publish from a non-synced tree.
REM - behind upstream -> hard stop (push would be rejected mid-publish / site could regress)
REM - uncommitted tracked changes -> informational (release-menu.ps1 has its own source-settled gate)
REM - ahead of upstream -> informational (publish-release --push pushes local commits first)
set "GS_AHEAD="
set "GS_BEHIND="
set "GS_DIRTY="
for /f %%A in ('git rev-list --count "@{u}..HEAD" 2^>nul') do set "GS_AHEAD=%%A"
for /f %%A in ('git rev-list --count "HEAD..@{u}" 2^>nul') do set "GS_BEHIND=%%A"
git diff --quiet 2>nul || set "GS_DIRTY=1"
git diff --cached --quiet 2>nul || set "GS_DIRTY=1"
if defined GS_BEHIND if not "%GS_BEHIND%"=="0" (
    powershell -NoProfile -Command "Write-Host '[ERROR] Local branch is behind upstream by %GS_BEHIND% commit(s). Run: git pull --rebase, then re-run this entry.' -ForegroundColor Red"
    if not defined NO_PAUSE pause
    set "EXIT_CODE=1"
    goto do_exit
)
if defined GS_DIRTY echo   [INFO] Uncommitted tracked changes detected - the source-settled gate may abort publish.
if defined GS_AHEAD if not "%GS_AHEAD%"=="0" echo   [INFO] Ahead of upstream by %GS_AHEAD% commit(s) - publish --push will push them before updating the site.

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

REM [2026-09-05] Entry self-heal consolidated into tools\entry-selfheal.ps1 (single
REM source shared with one-click-pack.bat): downstream .bat CRLF repair + .ps1
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

:do_exit
REM Unified exit: restore original codepage, then propagate the real exit code.
if defined OLD_CP chcp %OLD_CP: =% >nul
exit /b %EXIT_CODE%
