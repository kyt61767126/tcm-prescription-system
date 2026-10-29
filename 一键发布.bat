@echo off
REM ============================================================================
REM  one-click publish - ALIAS entry (kept for muscle memory / desktop shortcuts)
REM
REM  Since 2026-10-30 P2 the build+release kernel is exposed by a single entry:
REM      one-click-build-release.bat  (a.k.a. 一键构建发布.bat)
REM  This file only forwards its arguments there, so both names behave identically:
REM      one-click-publish.bat                          -> interactive menu
REM      one-click-publish.bat full --yes               -> pack + hot-sign + publish + verify
REM      one-click-publish.bat pack cloud desktop       -> pack cloud desktop only
REM      one-click-publish.bat hot [--yes]              -> hot-update check (/ re-sign)
REM      one-click-publish.bat verify                   -> verify published artifacts
REM
REM  Why not just rename: existing docs / shortcuts / knowledge notes reference
REM  "一键发布.bat", and the pack entry ("一键打包.bat") is still its own menu.
REM  Keeping a 10-line forwarder avoids two divergent implementations.
REM ============================================================================
for /f "tokens=2 delims=:" %%c in ('chcp') do set "OLD_CP=%%c"
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

set "UNIFIED=%~dp0一键构建发布.bat"
if not exist "%UNIFIED%" (
    powershell -NoProfile -Command "Write-Host '[ERROR] 一键构建发布.bat not found' -ForegroundColor Red"
    echo   Path: %UNIFIED%
    if not defined NO_PAUSE pause
    set "EXIT_CODE=1"
    goto do_exit
)

call "%UNIFIED%" %*
set "EXIT_CODE=%errorlevel%"
goto do_exit

:do_exit
if defined OLD_CP chcp %OLD_CP: =% >nul
exit /b %EXIT_CODE%
