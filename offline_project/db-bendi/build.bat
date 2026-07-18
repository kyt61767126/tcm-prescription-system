@echo off
cd /d "%~dp0"
title Huikang TCM Local - Offline Desktop Build
call "%~dp0..\..\tools\build-common.bat" bendi "HuikangTCM Local" dist %*