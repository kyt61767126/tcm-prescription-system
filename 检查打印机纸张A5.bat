@echo off
REM ============================================================================
REM  Check-Printer-Paper-A5 launcher (ASCII-only; Chinese lives in the .ps1)
REM  Double-click            -> read-only report of every local printer
REM  this-bat -Fix           -> set the DEFAULT printer paper to A5 (no admin)
REM  ... -Fix -All           -> set every A5-capable local printer to A5
REM  ... -Fix -Printer NAME  -> set one printer only
REM ============================================================================
setlocal
set "PS1=%~dp0tools\printer-paper-a5.ps1"
if not exist "%PS1%" set "PS1=%~dp0printer-paper-a5.ps1"
if not exist "%PS1%" (
    echo [ERROR] printer-paper-a5.ps1 not found.
    echo         Put this .bat next to printer-paper-a5.ps1, or keep the tools folder.
    pause
    exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" echo [RESULT] OK - printer paper is ready ^(A5^).
if "%RC%"=="2" echo [RESULT] Default printer is NOT A5. Re-run with: -Fix
if "%RC%"=="3" echo [RESULT] Printer driver does not support A5. Use another driver/printer.
if "%RC%"=="1" echo [RESULT] Script error - see messages above.
if not defined NO_PAUSE pause
exit /b %RC%
