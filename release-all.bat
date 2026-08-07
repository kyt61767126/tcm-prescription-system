chcp 65001 >nul
@echo off
title Huikang TCM Release Pipeline

REM release-all.bat - Top entry point
REM Calls PowerShell script release-menu.ps1 to avoid Chinese GBK encoding issues
REM PowerShell supports UTF-8 and single version selection

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\release-menu.ps1"
set RC=%ERRORLEVEL%
if not "%RC%"=="0" (
    echo.
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] Script failed with exit code: %RC%'"
    if not defined NO_PAUSE pause
)

exit /b %RC%