@echo off
title Packaging Module - Local Edition
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\pack.ps1" -Version bendi -Interactive
pause
