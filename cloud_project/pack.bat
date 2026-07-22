@echo off
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

echo ============================================
echo   惠康中医打包工具 - 云端版
echo ============================================
echo.
echo  请选择打包方式:
echo.
echo    pack-desktop.bat       打包桌面版 (Electron exe)
echo    pack-app.bat           打包手机 APP (Android APK)
echo    pack-app-strict.bat    严格模式 APP (APK+签名哈希+重打包)
echo.
echo  高级用法 (PowerShell):
echo    powershell -File packaging.ps1 -SyncOnly        仅同步文件
echo    powershell -File packaging.ps1 -CheckEncoding   仅编码检查
echo.
if not defined NO_PAUSE pause
