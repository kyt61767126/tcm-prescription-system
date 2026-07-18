@echo off
title Packaging - Custom Edition
REM 统一使用 tools\pack.ps1（和 pack.bat 相同的可靠打包工具）
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\pack.ps1" -Version dingzhi -Interactive

echo.
pause
