@echo off
chcp 65001 >nul
title HKTCM Activation Diagnostics
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0hk-diag.ps1"
