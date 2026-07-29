@echo off
REM ============================================================
REM  Huikang TCM - Customer Service Offline Activation Launcher
REM  Double-click to run generate-license.ps1
REM ============================================================
title Huikang TCM - Offline Activation License Generator

REM Switch to script folder
cd /d "%~dp0"

echo.
echo ============================================================
echo  Huikang TCM - Customer Service Offline Activation Tool
echo ============================================================
echo.
echo Starting PowerShell script...
echo.

REM Run PowerShell script (ASCII filename to avoid encoding issues)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0generate-license.ps1"

REM Always pause to prevent window close
echo.
echo ============================================================
echo  Script finished (exit code %errorlevel%)
echo  If no success message above, contact technical support
echo ============================================================
echo.
if not defined NO_PAUSE pause