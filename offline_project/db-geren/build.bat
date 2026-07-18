@echo off
cd /d "%~dp0"
title Huikang TCM Personal - Offline Desktop Build
call "%~dp0..\..\tools\build-common.bat" geren "HuikangTCM Personal" dist %*