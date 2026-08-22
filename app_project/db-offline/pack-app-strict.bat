@echo off
setlocal EnableExtensions
cd /d "%~dp0"

REM ============================================================
REM pack-app-strict.bat - Offline APP (Standard Strict)
REM Delegates to: build-pack.bat app-strict
REM ============================================================

echo [pack-app-strict.bat] Offline APP (Standard Strict)...
REM [SELF-HEAL 2026-08-23] Fix LF line endings in downstream .bat files BEFORE
REM parsing them. LF-corrupted Chinese .bat aborts cmd at parse time (window
REM flash-close, no output). This entry bat is ASCII-only so it is immune.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\fix-bat-crlf.ps1" "%~dp0build-pack.bat" "%~dp0app\build-app.bat"
call build-pack.bat app-strict
exit /b %errorlevel%
