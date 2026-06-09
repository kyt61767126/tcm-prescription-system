@echo off
chcp 65001 >nul
echo ==============================================
echo    一键推送代码到 GitHub 仓库
echo ==============================================
echo.

:: 检查是否存在 PowerShell 脚本
if not exist "auto-push.ps1" (
    echo ERROR: auto-push.ps1 文件不存在！
    pause
    exit /b 1
)

:: 使用 PowerShell 执行脚本
powershell.exe -ExecutionPolicy Bypass -File "auto-push.ps1"

:: 保持窗口打开以便查看结果
echo.
echo 按任意键退出...
pause >nul