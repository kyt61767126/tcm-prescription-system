@echo off
cd /d "%~dp0"
call "%~dp0..\..\tools\build-common.bat" cloud "HuikangTCM Cloud" build_output %*