@echo off
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

REM pack-acceptance.bat - Bottom-line acceptance gate (user entry, double-click)
REM Runs tools\pack-gate.ps1 in FULL mode: syntax + BOM + CRLF + encoding
REM + 9-item compliance (version / index copies / interface baseline / IPC /
REM AUTH_SECRET / desktop JS integrity / hardcode scan / shared sync).
REM Exit 0 = PASS (safe to pack/publish); Exit 1 = FAIL (blocked).
REM This entry bat is ASCII-only so it is immune to line-ending/encoding corruption.

echo ============================================================
echo   PACK ACCEPTANCE GATE (full mode)
echo   Runs all checks. Result: PASS = safe, FAIL = blocked.
echo ============================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\pack-gate.ps1" -Mode full
set "EXIT_CODE=%errorlevel%"

echo.
if %EXIT_CODE% neq 0 (
    echo [RESULT] FAIL - fix the issues above, then re-run this gate.
) else (
    echo [RESULT] PASS - safe to pack and publish.
)
echo.
pause
