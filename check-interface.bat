@echo off
chcp 65001 >nul
title Interface Structure Integrity Check
REM ★ P0-1 收口：统一到 tools\check-interface.ps1 + 入库的 .interface-lock.json 基线
REM    （废弃旧 .interface-baseline\ 本地快照机制，杜绝"双套脚本口径不一致"）
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\check-interface.ps1"
set EXIT=%ERRORLEVEL%
echo.
if %EXIT%==0 (
    echo [OK] 界面结构与入库基线一致（通过）。
) else (
    echo [ERROR] 界面结构被改动或基线过期，详见上方详情。
    echo         若为预期界面改动，请先执行: powershell -File tools\generate-interface-lock.ps1
    echo         重建 .interface-lock.json 并连同页面改动一起提交。
)
if not defined NO_PAUSE pause
exit /b %EXIT%