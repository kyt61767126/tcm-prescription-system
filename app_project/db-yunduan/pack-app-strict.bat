@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

REM ============================================================
REM pack-app-strict.bat - Cloud APP (Standard Strict mode)
REM Delegates to: build-pack.bat app-strict
REM   Strict = signature hash refresh hard gate (fail = abort, no APK)
REM   Same standard as one-click pack (pack-app.bat lands here too)
REM Chain: this entry -> build-pack.bat -> build-app.bat -> gradlew
REM ============================================================

echo ============================================
echo   Cloud APP Builder (Standard Strict)
echo ============================================
echo.

echo [pack-app-strict.bat] Cloud APP (Standard Strict)...
REM [SELF-HEAL 2026-08-23] Fix LF line endings in downstream .bat files BEFORE
REM parsing them. LF-corrupted Chinese .bat aborts cmd at parse time (window
REM flash-close, no output). This entry bat is ASCII-only so it is immune.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\fix-bat-crlf.ps1" "%~dp0build-pack.bat" "%~dp0build-app.bat"
call build-pack.bat app-strict
exit /b %errorlevel%
