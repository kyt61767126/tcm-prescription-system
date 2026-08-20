@echo off
:: 同步推送经验.bat - 把共享知识库(KNOWLEDGE.md)推送到GitHub，让其他work账户都能拉到最新经验
chcp 65001 >nul
setlocal

set "ROOT=%~dp0.."
cd /d "%ROOT%"

echo 正在从远程拉取最新经验（避免冲突）...
git pull origin main --rebase
if errorlevel 1 (
  echo [警告] 远程拉取失败，可能已有未提交改动或网络问题。将尝试推送。
)

echo 正在提交经验库...
git add .trae/KNOWLEDGE.md
git commit -m "docs: 沉淀经验 - 更新共享知识库(KNOWLEDGE.md)" >nul 2>&1
echo 正在推送到 GitHub ...
git push origin main
if errorlevel 1 (
  echo [错误] 推送失败，请检查网络或 git 登录状态。
  if not defined NO_PAUSE pause
  exit /b 1
)

echo.
echo [完成] 经验已推送到 GitHub，其他账户拉取（git pull）后即可共享。
if not defined NO_PAUSE pause
endlocal