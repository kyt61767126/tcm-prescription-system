@echo off
REM Save original console codepage before switching to UTF-8 (restore on exit
REM so callers chaining this bat from an open terminal keep their codepage).
for /f "tokens=2 delims=:" %%c in ('chcp') do set "OLD_CP=%%c"
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

REM ============================================================================
REM repack-4-targets.bat - Repack 4 targets (2 desktops + 2 APKs) + artifact verification
REM Purpose: main-process asar changes (shared\desktop-fs-ipc.cjs / preload.js) and
REM Java bridge changes (MainActivity.java / NativeBridge.ets) are NOT covered by
REM hot-update packages, so the four install artifacts must be rebuilt, and then
REM verified by unpacking asar/APK and grepping key markers (build-skip fingerprint
REM may wrongly report "already up to date").
REM Delegates to tools\repack-four-targets.ps1 (single source of truth for logic).
REM This entry bat is ASCII-only so it is immune to line-ending corruption.
REM Usage:
REM   repack-4-targets.bat          : pack 4 targets, then verify artifacts
REM   repack-4-targets.bat -Force   : ignore incremental skip, force rebuild all 4
REM   repack-4-targets.bat -SkipPack: verify existing artifacts only (no packing)
REM ============================================================================

set "PS1=%~dp0tools\repack-four-targets.ps1"
if not exist "%PS1%" (
    powershell -NoProfile -Command "Write-Host '[ERROR] tools\repack-four-targets.ps1 not found' -ForegroundColor Red"
    echo   Path: %PS1%
    if not defined NO_PAUSE pause
    exit /b 1
)

REM [2026-09-05] Entry self-heal (downstream .bat CRLF + .ps1 BOM) - single source
REM shared with the other entry bats (one-click pack / one-click publish).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\entry-selfheal.ps1"
set "HEAL_RC=%errorlevel%"
if %HEAL_RC% neq 0 (
    echo.
    powershell -NoProfile -Command "Write-Host '[ERROR] Entry self-heal failed with code: %HEAL_RC%' -ForegroundColor Red"
    if not defined NO_PAUSE pause
    exit /b %HEAL_RC%
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set "EXIT_CODE=%errorlevel%"

if %EXIT_CODE% neq 0 (
    echo.
    powershell -NoProfile -Command "Write-Host '[ERROR] Repack/verify exited with code: %EXIT_CODE%' -ForegroundColor Red"
)
echo.
if not defined NO_PAUSE pause

if defined OLD_CP chcp %OLD_CP: =% >nul
exit /b %EXIT_CODE%
