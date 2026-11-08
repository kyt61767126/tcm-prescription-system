@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo ============================================
echo   生成《软件说明书（补正版）》PDF
echo   预计 1-2 分钟，请不要关闭本窗口
echo ============================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 本机没有找到 Node.js。请先安装 Node.js 后再运行本文件。
  echo        或联系技术顾问远程处理。
  pause
  exit /b 1
)
if not exist "%~dp0软件说明书_补正版.md" (
  echo [错误] 没有找到 软件说明书_补正版.md，请确认文件完整。
  pause
  exit /b 1
)
node "%~dp0build-manual-pdf-v2.cjs"
if errorlevel 1 (
  echo.
  echo [失败] 生成过程出错。请把上面红色报错文字截图发给技术顾问。
) else (
  echo.
  echo [成功] 说明书 PDF 已生成：
  echo        %~dp0惠康中医诊所管理系统V1.0.0_软件说明书_补正版.pdf
  echo.
  echo 即将打开 PDF 供你检查（重点看：页眉、页码、截图是否都正常）。
  start "" "%~dp0惠康中医诊所管理系统V1.0.0_软件说明书_补正版.pdf"
)
echo.
pause
