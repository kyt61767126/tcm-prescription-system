@echo off
chcp 65001 >nul
title Generate Sign Hash - Enable Strict Mode
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0generate-sign-hash.ps1"

echo.
pause
