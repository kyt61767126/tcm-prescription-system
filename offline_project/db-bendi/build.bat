@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  本能中医处方系统-本地 打包脚本
echo ============================================
echo.
echo [1/4] 检查环境...
where npm >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 npm，请先安装 Node.js
    pause
    exit /b 1
)
echo       npm OK
echo.
echo [2/4] 清理旧打包产物...
if exist "dist" rmdir /s /q "dist"
echo [OK] 旧产物已清理
echo.
echo [3/4] 执行打包...
call npm run build
if errorlevel 1 (
    echo.
    echo [错误] 打包失败，请查看上方日志
    pause
    exit /b 1
)
echo.
echo [4/4] 打包完成
echo 输出目录: %CD%\dist
echo ============================================
pause
