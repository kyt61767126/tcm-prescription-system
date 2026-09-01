@echo off
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

REM Check one-click-pack.ps1 exists
set "PACK_PS1=%~dp0tools\one-click-pack.ps1"
if not exist "%PACK_PS1%" (
    powershell -NoProfile -Command "Write-Host '[ERROR] one-click-pack.ps1 not found'"
    echo   Path: %PACK_PS1%
    if not defined NO_PAUSE pause
    exit /b 1
)

echo [one-click-pack] Self-heal: fix LF line endings in downstream build .bat files...
REM [SELF-HEAL 2026-08-23] one-click-pack.ps1 invokes build-pack.bat/build-app.bat
REM directly (bypassing pack-* entries). Fix all downstream .bat BEFORE parsing.
REM This entry bat is ASCII-only so it is immune to line-ending corruption.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\fix-bat-crlf.ps1" "%~dp0app_project\db-yunduan\pack-desktop.bat" "%~dp0app_project\db-yunduan\build-pack.bat" "%~dp0app_project\db-yunduan\build-app.bat" "%~dp0app_project\db-yunduan\cloud_desktop\build.bat" "%~dp0app_project\db-offline\pack-desktop.bat" "%~dp0app_project\db-offline\build-pack.bat" "%~dp0app_project\db-offline\app\build-app.bat" "%~dp0app_project\db-offline\desktop\build.bat"

echo [one-click-pack] Self-heal: ensure UTF-8 BOM in .ps1 files...
REM [SELF-HEAL 2026-08-24] IDE edits may strip UTF-8 BOM from .ps1 files; PowerShell 5.1
REM then reads them as GBK, corrupting Chinese text and breaking string parsing.
REM fix-ps1-bom.ps1 rescans ALL .ps1 and re-adds BOM silently (only FIX lines shown).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\fix-ps1-bom.ps1" | findstr /C:"[FIX]" /C:"Summary:"

REM Launch one-click-pack.ps1 (forward args: 1=cloud 2=offline 3=all, auto mode no pause)
REM NOTE [BUILD-LOCK 2026-08-23]: concurrent builds are serialized by
REM tools\build-lock.ps1 inside build-pack.bat/build.bat/build-app.bat.
REM If another build is running, the child build aborts with a clear message.
REM [2026-09-01] Always append -AutoCommit: auto collect+commit+push packaging
REM side effects (versionCode/version bumps) after build, so they never pile up
REM uncommitted and block the source-settled gate on the next build.
REM Opt out by setting NO_AUTOCOMMIT=1 (side effects listed for manual commit).
set "EXTRA_ARGS=-AutoCommit"
if defined NO_AUTOCOMMIT set "EXTRA_ARGS="
powershell -NoProfile -ExecutionPolicy Bypass -File "%PACK_PS1%" %* %EXTRA_ARGS%
set "EXIT_CODE=%errorlevel%"

if %EXIT_CODE% neq 0 (
    echo.
    powershell -NoProfile -Command "Write-Host '[ERROR] One-click packaging exited with code: %EXIT_CODE%'"
)
echo.
REM With args (auto mode) no pause; no args (interactive menu) or explicit NO_PAUSE pauses as needed
if not defined NO_PAUSE if "%~1"=="" pause
