@echo off
chcp 65001 >nul
echo ========================================
echo    快易通中医处方系统 - 一键上传
echo ========================================
echo.

cd /d "c:\Users\61767\Documents\trae_projects\kyt-zy\tcm-prescription-system"

echo [1/4] 正在检查修改...
git status
echo.

echo [2/4] 正在添加所有修改...
git add .
echo.

set /p message="请输入更新说明（如：完善用户系统）："
echo.

echo [3/4] 正在提交修改...
git commit -m "%message%"
echo.

echo [4/4] 正在上传到 GitHub...
git push origin main
echo.

echo ========================================
echo    上传完成！
echo ========================================
echo.
echo Netlify 会自动检测到更新并部署。
echo 约1-2分钟后访问您的云端网址即可看到最新版本。
echo.
pause
