@echo off
REM ============================================================================
REM  one-click build + release (single non-interactive entry)
REM
REM  Why:  one-click-pack.bat (menu) and one-click-publish.bat (menu) were two
REM        interactive entries with duplicated boilerplate. Since 2026-10-30 both
REM        share one kernel (entry-preflight / pack-core / hotupdate-stage), and
REM        this entry exposes that same kernel BOTH interactively and
REM        NON-interactively:
REM
REM    one-click-build-release.bat                     -> interactive menu
REM                                                       [2] pack (incl. [4] smart pack)
REM                                                       [3] smart publish / [4] full publish
REM                                                       [8] standalone pack entries
REM    ... full                          --yes        -> pack + hot-sign + readiness + publish + verify
REM    ... pack [all|cloud|dingzhi] [all|desktop|app] -> pack only, then hot-update CHECK (read-only)
REM    ... publish [all|cloud|dingzhi] [all|desktop|app] --yes
REM                                                    -> readiness gate + publish
REM    ... hot [all|cloud|dingzhi] [--yes]             -> hot-update check only; --yes also re-signs
REM    ... verify                                      -> verify published artifacts only
REM
REM  HARD RULE preserved: uploading to the official download site is always an
REM  explicit human action -> publish / full refuse to run without --yes.
REM  2026-10-30 P7: this is now the ONLY root entry. 一键打包.bat (pack menu) and
REM  一键发布.bat (alias forwarder) were deleted; their capabilities live in the
REM  interactive menu above (pack / smart pack / standalone entries).
REM
REM  Env knobs: NO_PAUSE=1 skip final pause, NO_AUTOCOMMIT=1 opt out of side-effect
REM  auto-commit, SKIP_HOTUPDATE=1 skip hot update entirely, READINESS_SOFT=1 soft
REM  readiness, PACK_FORCE_ALL=1 force full rebuild for "all" (default = smart pack,
REM  changed ends skipped), PACK_HOT_SIGN=1 also re-sign hot packages after packing
REM  (default = read-only check, never writes git).
REM ============================================================================
for /f "tokens=2 delims=:" %%c in ('chcp') do set "OLD_CP=%%c"
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

REM ---- stage (first positional; empty = interactive menu) ----
set "STAGE=%~1"
if "%STAGE%"=="" set "STAGE=menu"
shift

REM ---- remaining positionals: VERSION then MODE; flags: --yes / -y ----
set "VERSION=all"
set "MODE=all"
set "CONFIRM="
set "GOTVER="
set "GOTMODE="
:parse_args
if "%~1"=="" goto args_done
set "A=%~1"
if /i "%A%"=="--yes" ( set "CONFIRM=-Yes" & shift & goto parse_args )
if /i "%A%"=="-y"    ( set "CONFIRM=-Yes" & shift & goto parse_args )
if not defined GOTVER ( set "VERSION=%A%" & set "GOTVER=1" & shift & goto parse_args )
if not defined GOTMODE ( set "MODE=%A%" & set "GOTMODE=1" & shift & goto parse_args )
shift
goto parse_args
:args_done

REM ---- stage validation (fail fast with usage, before any build/publish) ----
set "STAGE_OK="
for %%S in (menu full pack publish hot verify) do if /i "%STAGE%"=="%%S" set "STAGE_OK=1"
if not defined STAGE_OK (
    powershell -NoProfile -Command "Write-Host '[ERROR] Unknown stage: %STAGE%' -ForegroundColor Red; Write-Host '  Usage: one-click-build-release.bat [full^|pack^|publish^|hot^|verify] [all^|cloud^|dingzhi] [all^|desktop^|app] [--yes]' -ForegroundColor Yellow"
    set "EXIT_CODE=2"
    goto do_exit
)

REM ---- entry preflight: publish/full keep the hard stop when behind upstream ----
set "PF_MODE=pack"
if /i "%STAGE%"=="publish" set "PF_MODE=publish"
if /i "%STAGE%"=="full" set "PF_MODE=publish"
call :run_preflight %PF_MODE%
set "PF_RC=%errorlevel%"
if not "%PF_RC%"=="0" goto preflight_failed

REM ---- read-only readiness report: menu path only (stage paths run the strict
REM      gate inside release-menu, so running it twice would just waste time) ----
if /i "%STAGE%"=="menu" (
    if exist "%~dp0tools\check-release-readiness.cjs" (
        node "%~dp0tools\check-release-readiness.cjs"
    ) else (
        echo   [WARN] tools\check-release-readiness.cjs not found - skipping readiness report.
    )
)

set "REL_PS1=%~dp0tools\release-menu.ps1"
if not exist "%REL_PS1%" (
    powershell -NoProfile -Command "Write-Host '[ERROR] release-menu.ps1 not found' -ForegroundColor Red"
    echo   Path: %REL_PS1%
    set "EXIT_CODE=1"
    goto do_exit
)

REM release-menu.ps1 keeps the interactive menu as default (Stage=menu) and the
REM non-interactive stage dispatch from 2026-10-30 P2 (pack/publish/full/hot/verify).
powershell -NoProfile -ExecutionPolicy Bypass -File "%REL_PS1%" -Stage "%STAGE%" -Version "%VERSION%" -Mode "%MODE%" %CONFIRM%
set "EXIT_CODE=%errorlevel%"

if %EXIT_CODE% neq 0 (
    echo.
    powershell -NoProfile -Command "Write-Host '[ERROR] Stage %STAGE% exited with code: %EXIT_CODE%' -ForegroundColor Red"
)
echo.
REM Interactive menu path keeps the classic "Press any key" pause unless NO_PAUSE=1.
REM Stage paths are scriptable: no pause unless the caller asked for one.
if not defined NO_PAUSE if /i "%STAGE%"=="menu" pause
goto do_exit

:preflight_failed
echo.
if "%PF_RC%"=="2" (
    powershell -NoProfile -Command "Write-Host '[ERROR] Local branch is behind upstream. Run: git pull --rebase, then re-run.' -ForegroundColor Red"
) else (
    powershell -NoProfile -Command "Write-Host '[ERROR] Entry preflight failed with code: %PF_RC%' -ForegroundColor Red"
)
if not defined NO_PAUSE if /i "%STAGE%"=="menu" pause
set "EXIT_CODE=%PF_RC%"
goto do_exit

:do_exit
if defined OLD_CP chcp %OLD_CP: =% >nul
exit /b %EXIT_CODE%

REM ============================================================================
REM helper: run tools\entry-preflight.ps1 (git state + self-heal, single source)
REM ============================================================================
:run_preflight
if not exist "%~dp0tools\entry-preflight.ps1" (
    echo   [WARN] tools\entry-preflight.ps1 not found - skipping entry preflight.
    exit /b 0
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\entry-preflight.ps1" -Mode %~1
exit /b %errorlevel%
