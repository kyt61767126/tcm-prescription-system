@echo off
chcp 65001 >nul
setlocal

REM ============================================================
REM  三端同步脚本 - cloud_desktop -> tcm-prescription-system/public
REM
REM  使用场景：
REM    修改 cloud_desktop/index.html 后，运行此脚本同步到云端网页。
REM    云端网页更新后，手机APP（Capacitor WebView）会自动加载新版。
REM    桌面端 cloud_desktop 始终是源文件，三端共用同一份代码。
REM
REM  使用方法：
REM    1) 双击运行，或命令行执行 sync-to-cloud.bat
REM    2) 同步完成后会提示是否自动 git commit + push
REM    3) push 到 GitHub 后 Cloudflare Pages 自动部署（约1-2分钟）
REM ============================================================

set "SRC=%~dp0"
set "DST=%~dp0..\tcm-prescription-system\public"

echo.
echo ================================================================
echo  三端同步 - cloud_desktop -^> tcm-prescription-system\public
echo ================================================================
echo  源目录: %SRC%
echo  目标目录: %DST%
echo.

if not exist "%DST%" (
    echo [错误] 目标目录不存在: %DST%
    echo 请确认 tcm-prescription-system 仓库已 clone 到 cloud_project 目录
    pause
    exit /b 1
)

REM 同步核心文件
echo [1/3] 同步 index.html ...
copy /Y "%SRC%index.html" "%DST%index.html" >nul
if errorlevel 1 (
    echo [错误] index.html 同步失败
    pause
    exit /b 1
)

echo [2/3] 同步 xlsx.full.min.js ...
if exist "%SRC%xlsx.full.min.js" (
    copy /Y "%SRC%xlsx.full.min.js" "%DST%xlsx.full.min.js" >nul
    if errorlevel 1 (
        echo [警告] xlsx.full.min.js 同步失败，继续
    ) else (
        echo       xlsx.full.min.js 已同步
    )
) else (
    echo [跳过] xlsx.full.min.js 不存在
)

REM 校验 MD5
echo [3/3] 校验 MD5 ...
powershell -NoProfile -Command "$src='%SRC%'; $dst='%DST%'; $f1='index.html'; $f2='xlsx.full.min.js'; foreach ($f in @($f1,$f2)) { if ((Test-Path \"$src$f\") -and (Test-Path \"$dst$f\")) { $h1=(Get-FileHash \"$src$f\" -Algorithm MD5).Hash; $h2=(Get-FileHash \"$dst$f\" -Algorithm MD5).Hash; if ($h1 -eq $h2) { Write-Host \"  [OK]   $f  $h1\" } else { Write-Host \"  [FAIL] $f  src=$h1 dst=$h2\" } } }"

echo.
echo ================================================================
echo  同步完成
echo ================================================================
echo.
echo  下一步：
echo   - 进入 tcm-prescription-system 目录执行 git add/commit/push
echo   - 或运行 sync-and-push.bat 一键同步并推送
echo.
pause
