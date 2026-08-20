@echo off
:: 学习经验.bat - 把仓库共享知识库同步到当前账户本地AI记忆（之后每次会话自动加载）
chcp 65001 >nul
setlocal enabledelayedexpansion

set "ROOT=%~dp0.."
set "SRC=%ROOT%\.trae\KNOWLEDGE.md"
set "MEMBASE=%USERPROFILE%\.trae-cn\memory\projects"

if not exist "%SRC%" (
  echo [错误] 找不到共享知识库：%SRC%
  echo 请确认本项目路径正确（D:\trae_projects\kyt-zy）。
  if not defined NO_PAUSE pause
  exit /b 1
)

rem 精确定位本项目（D:\trae_projects\kyt-zy）的 AI 记忆目录
set "TARGET=%MEMBASE%\-d-trae-projects-kyt-zy--p2-7eaa1b1ed0ff6e40dc09"

rem 兜底：仅匹配 -d-trae-projects-kyt-zy--p2- 精确形态（避免误撞其它子项目目录）
if not exist "%TARGET%" (
  for /d %%D in ("%MEMBASE%\-d-trae-projects-kyt-zy--p2-*") do set "TARGET=%%D"
)
if not exist "%TARGET%" mkdir "%TARGET%"

copy /y "%SRC%" "%TARGET%\project_memory.md" >nul
echo.
echo [完成] 已学习共享经验并把知识写入当前账户本地记忆。
echo       之后每次打开本项目，AI 都会自动加载这份经验。
echo       来源：%SRC%
echo       写入：%TARGET%\project_memory.md
echo.
echo 提示：若后续共享知识库有更新，可再运行一次本脚本刷新。
if not defined NO_PAUSE pause
endlocal