@echo off
cd /d "%~dp0"
echo Building...
call npm run build
echo Build completed!
echo Output: dist\
pause