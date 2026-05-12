@echo off
echo ========================================
echo   Git 提交和推送脚本（自动处理锁定）
echo ========================================
echo.

echo [1/5] 检查并删除 index.lock...
if exist ".git\index.lock" (
    del /f /q ".git\index.lock" 2>nul
    echo   ✓ 锁定文件已删除
) else (
    echo   ✓ 无锁定文件
)

echo.
echo [2/5] 配置 Git 用户信息...
git config user.name "kyt61767126"
git config user.email "61767126@qq.com"
echo   ✓ 用户信息已配置

echo.
echo [3/5] 检查远程仓库...
git remote -v | findstr origin >nul
if errorlevel 1 (
    echo   添加远程仓库...
    git remote add origin https://github.com/kyt61767126/kyt61767126-kyt-zy-cloud.git
) else (
    echo   ✓ 远程仓库已配置
)

echo.
echo [4/5] 提交代码...
echo   正在暂存所有文件...
git add .

echo   正在提交...
git commit -m "配置 Cloudflare Pages 部署 - 完善云端功能"
if errorlevel 1 (
    echo   ✗ 提交失败，尝试重新处理锁定...
    if exist ".git\index.lock" del /f /q ".git\index.lock"
    git commit -m "配置 Cloudflare Pages 部署 - 完善云端功能"
)

echo.
echo [5/5] 推送代码...
git push -u origin master --force
if errorlevel 1 (
    echo   ✗ 推送失败
    echo   原因可能：
    echo   - 网络连接问题
    echo   - GitHub 认证失败
    echo   - 其他网络错误
    pause
    exit /b 1
)

echo.
echo ========================================
echo   ✅ 完成！
echo ========================================
echo.
echo 已成功推送到 GitHub！
echo Cloudflare Pages 将自动检测并部署。
echo.
echo 提示：部署通常需要 1-3 分钟。
echo 请访问以下网址查看部署状态：
echo https://dash.cloudflare.com/pages/view/kyt61767126-kyt-zy-cloud
echo.
pause
exit /b 0