@echo off
cd /d "%~dp0"
git add .
git commit -m "Update"
git push
if errorlevel 1 git push --set-upstream origin main
echo Done!
pause