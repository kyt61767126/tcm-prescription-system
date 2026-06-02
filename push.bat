@echo off
cls
echo ==============================================
echo 自动推送代码到 GitHub 仓库
echo ==============================================
echo.

echo 1. 添加所有文件...
git add .

echo.
echo 2. 提交更改...
git commit -m "Auto update: %date% %time%"

echo.
echo 3. 推送到远程仓库...
git push

echo.
echo ==============================================
echo 推送完成！
echo ==============================================
timeout /t 2 /nobreak >nul