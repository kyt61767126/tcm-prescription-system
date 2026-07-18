@echo off
cd /d "%~dp0"
title Huikang TCM Custom - Offline Desktop Build
call "%~dp0..\..\tools\build-common.bat" dingzhi "HuikangTCM Custom" dist %*