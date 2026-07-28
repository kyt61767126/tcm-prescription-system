@echo off
chcp 65001 >nul
title 惠康中医 · 自动官网上架流水线

:MENU
cls
echo ============================================
echo   惠康中医 · 自动官网上架流水线
echo ============================================
echo.
echo   请选择操作：
echo     1. 仅打包（不发布）
echo     2. 仅发布（已打包好）
echo     3. 打包 + 发布 + 验证（推荐）
echo     4. 退出
echo.
set /p CHOICE=请输入数字 [1-4]:

if "%CHOICE%"=="1" goto PACKONLY
if "%CHOICE%"=="2" goto PUBONLY
if "%CHOICE%"=="3" goto FULL
if "%CHOICE%"=="4" goto EXIT

echo.
echo [ERROR] 无效的选择: %CHOICE%
pause
goto MENU

:PACKONLY
echo.
echo ============================================
echo   [1/1] 打包（one-click-pack.ps1）
echo ============================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\one-click-pack.ps1"
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] 打包失败，请检查上方日志
    pause
    goto MENU
)
echo.
echo [OK] 打包完成
echo.
echo --------------------------------------------
echo   下一步指引：
echo     - 运行 release-all.bat 选择 2 或 3 进行发布
echo     - 或直接执行: node tools\auto-publish.js
echo --------------------------------------------
pause
goto MENU

:PUBONLY
echo.
echo ============================================
echo   [1/1] 发布（auto-publish.js）
echo ============================================
node "%~dp0tools\auto-publish.js"
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] 发布失败，请检查上方日志
    pause
    goto MENU
)
echo.
echo [OK] 发布完成
echo.
echo --------------------------------------------
echo   下一步指引：
echo     - 建议运行 node tools\verify-release.js 验证 URL
echo     - 下载页: https://tcm-prescription-system.pages.dev/download
echo     - Release 页: https://github.com/kyt61767126/tcm-prescription-system/releases
echo --------------------------------------------
pause
goto MENU

:FULL
echo.
echo ============================================
echo   [1/3] 打包（one-click-pack.ps1）
echo ============================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\one-click-pack.ps1"
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] 打包失败，请检查上方日志
    pause
    goto MENU
)
echo.
echo [OK] 打包完成
echo.
echo ============================================
echo   [2/3] 发布（auto-publish.js）
echo ============================================
node "%~dp0tools\auto-publish.js"
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] 发布失败，请检查上方日志
    pause
    goto MENU
)
echo.
echo [OK] 发布完成
echo.
echo ============================================
echo   [3/3] 验证（verify-release.js）
echo ============================================
node "%~dp0tools\verify-release.js"
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] 验证失败，请检查 URL 是否可访问
    pause
    goto MENU
)
echo.
echo [OK] 验证通过
echo.
echo ============================================
echo   全流程完成！下一步指引：
echo ============================================
echo   - 下载页: https://tcm-prescription-system.pages.dev/download
echo   - Release 页: https://github.com/kyt61767126/tcm-prescription-system/releases
echo   - Cloudflare Pages 将在 1-2 分钟内自动部署
echo ============================================
pause
goto MENU

:EXIT
echo.
echo 再见！
exit /b 0
