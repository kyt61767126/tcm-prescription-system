@echo off
chcp 65001 >nul
setlocal

REM ============================================================
REM  一键同步并推送 - cloud_desktop -> tcm-prescription-system/public
REM                   -> git commit -> git push (触发 Cloudflare Pages 部署)
REM
REM  使用场景：
REM    修改 cloud_desktop/index.html 后，运行此脚本：
REM    1) 同步前端代码到 tcm-prescription-system/public/
REM    2) 自动 git add + commit + push
REM    3) Cloudflare Pages 收到 push 后自动部署（约1-2分钟）
REM    4) 部署完成后，桌面端/云端网页/手机APP 三端一致
REM
REM  使用方法：
REM    双击运行，或命令行执行 sync-and-push.bat
REM ============================================================

set "SRC=%~dp0"
set "DST=%~dp0..\tcm-prescription-system\public"
set "REPO=%~dp0..\tcm-prescription-system"

echo.
echo ================================================================
echo  一键同步并推送 - 三端代码同步
echo ================================================================
echo.

if not exist "%DST%" (
    echo [错误] 目标目录不存在: %DST%
    pause
    exit /b 1
)

REM 同步
echo [1/4] 同步 index.html ...
copy /Y "%SRC%index.html" "%DST%index.html" >nul
if errorlevel 1 ( echo [错误] index.html 同步失败 & pause & exit /b 1 )

echo [2/4] 同步 xlsx.full.min.js ...
if exist "%SRC%xlsx.full.min.js" (
    copy /Y "%SRC%xlsx.full.min.js" "%DST%xlsx.full.min.js" >nul
)

REM Git 操作
echo [3/4] git add ...
cd /d "%REPO%"
git add public/index.html public/xlsx.full.min.js 2>nul
if errorlevel 1 ( echo [警告] git add 部分文件可能未暂存 )

REM 检查是否有变更
git diff --cached --quiet
if %errorlevel% equ 0 (
    echo.
    echo [提示] 没有变更需要提交，可能是文件未修改
    pause
    exit /b 0
)

echo [4/4] git commit + push ...
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss' -ca") do set "NOW=%%t"
git commit -m "sync: 三端同步 cloud_desktop 前端代码 (%NOW%)"
if errorlevel 1 ( echo [错误] git commit 失败 & pause & exit /b 1 )

git push origin main
if errorlevel 1 ( echo [错误] git push 失败 & pause & exit /b 1 )

echo.
echo ================================================================
echo  完成
echo ================================================================
echo  Cloudflare Pages 将在 1-2 分钟内自动部署完成。
echo  部署完成后访问 https://tcm-prescription-system.pages.dev 验证。
echo.
pause
