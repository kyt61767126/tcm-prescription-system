@echo off
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

REM Thin wrapper for tools/rollback-hotupdate.cjs interactive menu.
REM Keep this entry bat ASCII-only (immune to line-ending corruption).
REM Usage: double-click or run from terminal. Channel/version/scope are
REM selected interactively; commit+push is offered at the end (Y/N).
node tools\rollback-hotupdate.cjs --interactive
set "EXIT_CODE=%errorlevel%"
if not defined NO_PAUSE pause
exit /b %EXIT_CODE%
