@echo off
chcp 65001 >nul
title Generate Sign Hash - Custom (Strict Mode)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\generate-sign-hash.ps1" -Version dingzhi
echo.
if not defined NO_PAUSE pause
