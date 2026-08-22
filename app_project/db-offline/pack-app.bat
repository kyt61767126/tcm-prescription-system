@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

REM ============================================================
REM pack-app.bat - Offline APP (Standard Strict mode)
REM Delegates to: build-pack.bat app-strict (same standard as one-click pack)
REM 2026-08-21: manual pack unified to STRICT standard
REM   (signature hash refresh failure = hard abort)
REM ============================================================

echo [pack-app.bat] Offline APP (Standard Strict)...
REM [SELF-HEAL 2026-08-23] Fix LF line endings in downstream .bat files BEFORE
REM parsing them. LF-corrupted Chinese .bat aborts cmd at parse time (window
REM flash-close, no output). This entry bat is ASCII-only so it is immune.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\fix-bat-crlf.ps1" "%~dp0build-pack.bat" "%~dp0app\build-app.bat"
call build-pack.bat app-strict
exit /b %errorlevel%
