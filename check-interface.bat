@echo off
chcp 65001 >nul
title Interface Structure Integrity Check
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-interface.ps1"
echo.
if not defined NO_PAUSE pause
exit /b %ERRORLEVEL%
