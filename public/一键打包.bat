@echo off
title HuikangTCM Cloud - One Click Build
echo ==============================================
echo   HuikangTCM Cloud - One Click Build
echo ==============================================
echo.
echo Building...
echo.

cd /d "%~dp0"

echo 1. Running npm run build...
call npm run build

echo.
echo ==============================================
echo Build completed!
echo Output: %~dp0dist\
echo ==============================================
pause
