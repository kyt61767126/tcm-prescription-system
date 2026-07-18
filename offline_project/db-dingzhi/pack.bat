@echo off
title Packaging Module - Custom Edition
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\pack.ps1" -Version dingzhi -Interactive
pause
