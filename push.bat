@echo off
cls
echo Push to Git Repository
echo ======================
echo.

git add .
git commit -m "Update"
git push

echo.
echo Push completed.
echo Press any key to exit...
pause >nul