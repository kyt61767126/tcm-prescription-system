@echo off
chcp 65001 >nul
echo ============================================
echo   Netlify 部署构建脚本
echo ============================================
echo.

echo [1/3] 清理旧构建产物...
if exist "dist" rmdir /s /q "dist"
echo [OK] 清理完成
echo.

echo [2/3] 创建构建目录...
mkdir "dist"
echo [OK] 创建完成
echo.

echo [3/3] 复制 public/ 到 dist/...
xcopy "public" "dist" /E /H /C /I /Y >nul
echo [OK] 复制完成
echo.

echo ============================================
echo   构建完成！dist/ 目录已就绪
echo ============================================
