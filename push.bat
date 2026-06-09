@echo off
title Git Push Script
color 0A
cls

echo.
echo ==============================================
echo         一键推送代码到 GitHub 仓库
echo ==============================================
echo.

:: 检查 git 是否可用
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Git 未安装或未添加到 PATH
    echo 请先安装 Git 并配置环境变量
    pause
    exit /b 1
)

:: 进入脚本所在目录
cd /d "%~dp0"
echo 当前目录: %cd%
echo.

:: 添加文件
echo [1/3] 正在添加文件...
git add .
if %errorlevel% neq 0 (
    echo ERROR: git add 失败
    pause
    exit /b 1
)
echo OK
echo.

:: 提交更改
echo [2/3] 正在提交更改...
git commit -m "Update"
if %errorlevel% neq 0 (
    echo 注意: commit 失败，可能没有需要提交的修改
)
echo.

:: 推送
echo [3/3] 正在推送...
git push
if %errorlevel% neq 0 (
    echo 尝试设置 upstream...
    git push --set-upstream origin main
)

echo.
echo ==============================================
echo              操作完成！
echo ==============================================
echo.
echo 按任意键退出...
pause >nul