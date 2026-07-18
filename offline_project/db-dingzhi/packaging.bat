@echo off
title Packaging - Custom Edition
REM Unified: use tools\pack.ps1 (same reliable packager as pack.bat)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\pack.ps1" -Version dingzhi -Interactive

echo.
pause
