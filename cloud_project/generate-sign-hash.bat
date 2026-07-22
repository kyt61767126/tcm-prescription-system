@echo off
chcp 65001 >nul
title Generate Sign Hash - Cloud (Strict Mode)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\tools\generate-sign-hash.ps1" -Version cloud
echo.
if not defined NO_PAUSE pause
