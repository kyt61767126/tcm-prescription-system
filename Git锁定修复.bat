@echo off
echo ========================================
echo   Git 锁定问题彻底解决方案
echo ========================================
echo.

echo [1/4] 检查 Git 锁定文件...
if exist ".git\index.lock" (
    echo 发现锁定文件，正在删除...
    del /f /q ".git\index.lock"
    echo ✓ 锁定文件已删除
) else (
    echo ✓ 未发现锁定文件
)

echo.
echo [2/4] 检查其他可能的锁定...
set FOUND_LOCK=0
for /r ".git" %%i in (*.lock) do (
    echo 发现锁定文件: %%i
    del /f /q "%%i"
    set FOUND_LOCK=1
)
if %FOUND_LOCK%==0 (
    echo ✓ 未发现其他锁定文件
)

echo.
echo [3/4] 验证 Git 状态...
git status
if %errorlevel% neq 0 (
    echo ✗ Git 命令执行失败
    echo 正在尝试重新初始化...
    goto :reinit
)

echo.
echo [4/4] 检查远程仓库配置...
git remote -v
if %errorlevel% neq 0 (
    echo 添加远程仓库...
    git remote add origin https://github.com/kyt61767126/kyt61767126-kyt-zy-cloud.git
)

echo.
echo ========================================
echo   ✅ 所有检查完成！
echo ========================================
echo.
echo 提示：如需推送代码，请使用：
echo   git add .
echo   git commit -m "您的提交信息"
echo   git push -u origin master
echo.
pause
exit /b 0

:reinit
echo.
echo 正在重新初始化 Git...
rd /s /q ".git"
git init
git config user.name "kyt61767126"
git config user.email "61767126@qq.com"
git remote add origin https://github.com/kyt61767126/kyt61767126-kyt-zy-cloud.git
git status
echo.
echo ✓ Git 已重新初始化
pause