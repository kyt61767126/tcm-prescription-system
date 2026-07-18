@echo off
title Packaging Module - Personal Edition
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\pack.ps1" -Version geren -Interactive
pause
