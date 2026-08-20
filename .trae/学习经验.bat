@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set "ROOT=%~dp0.."
set "SRC=%ROOT%\.trae\KNOWLEDGE.md"
set "MEMBASE=%USERPROFILE%\.trae-cn\memory\projects"

if not exist "%SRC%" (
  echo [ERROR] knowledge file not found: %SRC%
  if not defined NO_PAUSE pause
  exit /b 1
)

set "TARGET=%MEMBASE%\-d-trae-projects-kyt-zy--p2-7eaa1b1ed0ff6e40dc09"
if not exist "%TARGET%" (
  for /d %%D in ("%MEMBASE%\-d-trae-projects-kyt-zy--p2-*") do set "TARGET=%%D"
)
if not exist "%TARGET%" mkdir "%TARGET%"

copy /y "%SRC%" "%TARGET%\project_memory.md" >nul

echo.
echo [DONE] shared knowledge learned, written to this account local memory.
echo        AI will auto-load it every time this project is opened.
echo.
echo        SRC    : %SRC%
echo        TARGET : %TARGET%\project_memory.md
echo.
echo Tip: rerun this script after shared knowledge updates.
if not defined NO_PAUSE pause
endlocal