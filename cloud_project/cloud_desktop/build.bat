@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  本能中医处方系统-云端 打包脚本
echo ============================================
echo.
echo [1/5] 检查环境...
where npm >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 npm，请先安装 Node.js
    pause
    exit /b 1
)
echo       npm OK
echo.
echo [2/5] 关闭残留进程...
taskkill /F /IM electron.exe >nul 2>&1
taskkill /F /IM "本能中医处方系统-云端*.exe" >nul 2>&1
echo [OK] 进程已清理
timeout /t 2 /nobreak >nul
echo.
echo [3/5] 清理旧打包产物...
if exist "dist" (
    rmdir /s /q "dist"
    if errorlevel 1 (
        echo [警告] 清理失败，尝试强制删除...
        powershell -ExecutionPolicy Bypass -Command "[System.IO.Directory]::Delete('%CD%\dist', $true)"
    )
)
echo [OK] 旧产物已清理
echo.
echo [4/5] 执行打包...
call npm run build
if errorlevel 1 (
    echo.
    echo [错误] 打包失败，请查看上方日志
    pause
    exit /b 1
)
echo.
echo [5/5] 打包完成
echo 输出目录: %CD%\dist
echo ============================================
pause
