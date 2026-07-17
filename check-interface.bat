@echo off
chcp 65001 >nul
title Interface Structure Integrity Check
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-interface.ps1"
echo.
pause
exit /b %ERRORLEVEL%
