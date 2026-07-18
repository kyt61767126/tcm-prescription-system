@echo off
title Packaging - Local Edition
REM Unified: use tools\pack.ps1 (same reliable packager as pack.bat)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\pack.ps1" -Version bendi -Interactive

echo.
pause
