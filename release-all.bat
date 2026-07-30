@echo off
chcp 65001 >nul
title 惠康中医 · 自动官网上架流水线

REM ============================================================
REM  release-all.bat - 顶层入口
REM  原 .bat 菜单存在中文 GBK 编码问题（"打包" "发布" 被当作命令）
REM  改为调用 PowerShell 脚本 release-menu.ps1，彻底解决乱码
REM  PowerShell 支持 UTF-8 中文显示，并支持选择单个版本发布
REM ============================================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\release-menu.ps1"
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] 脚本执行失败，退出码: %ERRORLEVEL%
    if not defined NO_PAUSE pause
)

exit /b %ERRORLEVEL%
