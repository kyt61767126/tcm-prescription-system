@echo off
cls
echo 处方系统一键推送
echo ==================
echo.

git add .
git commit -m "更新"
git push

echo.
echo 推送完成，按任意键退出...
pause