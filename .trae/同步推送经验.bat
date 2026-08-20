@echo off
chcp 65001 >nul
setlocal

set "ROOT=%~dp0.."
cd /d "%ROOT%"

echo Pulling latest shared knowledge ...
git pull origin main --rebase
if errorlevel 1 (
  echo [WARN] pull failed. will try push anyway.
)

echo Committing knowledge base ...
git add .trae/KNOWLEDGE.md
git commit -m "docs: sync shared knowledge base" >nul 2>&1
echo Pushing to GitHub ...
git push origin main
if errorlevel 1 (
  echo [ERROR] push failed. check network / git login.
  if not defined NO_PAUSE pause
  exit /b 1
)

echo.
echo [DONE] knowledge pushed to GitHub. other accounts can pull.
if not defined NO_PAUSE pause
endlocal