@echo off
chcp 65001 >nul
title 中医处方系统 - 一键部署
color 0A

echo ========================================
echo   中医处方系统 - 一键部署
echo ========================================
echo.

set /p message="请输入提交信息（按回车使用默认）："

if "%message%"=="" (
    set message=更新代码
)

echo.
echo [1/4] 检查状态...
git status

echo.
echo [2/4] 添加更改...
git add .

echo.
echo [3/4] 提交更改...
git commit -m "%message%"

echo.
echo [4/4] 推送到 GitHub...
git push

echo.
echo ========================================
echo   部署完成！
echo ========================================
echo.
echo Cloudflare Pages 将在 1-2 分钟内自动部署
echo.
pause
