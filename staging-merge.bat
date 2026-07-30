@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

echo ============================================
echo   惠康中医 - 预发布分支管理工具
echo ============================================
echo.

if "%1"=="merge" goto :merge
if "%1"=="sync" goto :sync
if "%1"=="preview" goto :preview
goto :help

:merge
echo [1/4] 切换到 main 分支...
git checkout main
echo.
echo [2/4] 拉取最新代码...
git pull origin main
echo.
echo [3/4] 合并 staging 到 main...
git merge staging --no-ff -m "merge: staging -> main (预发布验证通过)"
if errorlevel 1 (
    echo.
    echo [错误] 合并冲突！请手动解决冲突后执行:
    echo   git add .
    echo   git commit
    echo   staging-merge.bat push
    goto :eof
)
echo.
echo [4/4] 推送到 GitHub (触发 Cloudflare Pages 生产部署)...
git push origin main
echo.
echo ✓ 合并完成！Cloudflare Pages 将自动部署到生产环境。
goto :eof

:sync
echo [1/3] 将 main 的最新代码同步到 staging...
git checkout staging
echo.
echo [2/3] 拉取最新代码...
git pull origin main
echo.
echo [3/3] 推送 staging...
git push origin staging
echo.
echo ✓ staging 已与 main 同步。
git checkout main
goto :eof

:preview
echo.
echo ============================================
echo  Cloudflare Pages Preview 部署说明
echo ============================================
echo.
echo 1. 在 Cloudflare Dashboard 中配置:
echo    Pages 项目 -> Settings -> Builds & deployments
echo    -> Preview branches -> 添加 staging
echo.
echo 2. 推送代码到 staging 分支后, Cloudflare 会自动部署预览:
echo    https://[hash].tcm-prescription-system.pages.dev
echo.
echo 3. 验证通过后, 执行:
echo    staging-merge.bat merge
echo    将 staging 合并到 main, 触发生产部署。
echo.
goto :eof

:help
echo 用法:
echo   staging-merge.bat merge    - 将 staging 合并到 main (验证通过后执行)
echo   staging-merge.bat sync     - 将 main 最新代码同步到 staging
echo   staging-merge.bat preview  - 查看 Preview 部署说明
echo.
echo 工作流:
echo   1. git checkout staging          (切换到预发布分支)
echo   2. 修改代码并测试
echo   3. git push origin staging       (推送, Cloudflare 自动部署预览)
echo   4. 在预览URL验证通过
echo   5. staging-merge.bat merge       (合并到main, 触发生产部署)
echo.
