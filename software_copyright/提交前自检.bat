@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 本机没有找到 Node.js。
  pause
  exit /b 1
)
node "%~dp0check-submit.cjs"
echo.
pause
