@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

echo ============================================
echo   惠康中医 - 紧急回滚工具
echo   (云端网页版 + 桌面EXE + APP)
echo ============================================
echo.

if "%1"=="" goto :menu
if "%1"=="web" goto :rollback_web
if "%1"=="exe" goto :rollback_exe
if "%1"=="all" goto :rollback_all
goto :menu

:menu
echo 选择回滚操作:
echo.
echo   1. 云端网页版回滚 (撤销最近一次git提交，Cloudflare自动重新部署)
echo   2. 桌面EXE回滚 (回滚latest.json到上一个版本)
echo   3. 全部回滚 (网页版+EXE，紧急情况使用)
echo   4. 查看最近5次部署记录
echo   5. 退出
echo.
set /p choice="请选择 [1-5]: "

if "%choice%"=="1" goto :rollback_web
if "%choice%"=="2" goto :rollback_exe
if "%choice%"=="3" goto :rollback_all
if "%choice%"=="4" goto :show_deploys
if "%choice%"=="5" goto :eof
goto :menu

:rollback_web
echo.
echo [网页版回滚] 撤销最近一次提交并推送...
echo.

REM 显示最近3次提交
echo 最近3次提交:
git log --oneline -3
echo.

set /p confirm="确认回滚最近一次提交？(y/n): "
if /i not "%confirm%"=="y" (
    echo 已取消
    goto :eof
)

REM 撤销最近一次提交（保留代码变更到工作区）
git revert HEAD --no-edit
if errorlevel 1 (
    echo.
    echo [错误] git revert 失败，可能有冲突
    echo 请手动执行: git revert HEAD
    goto :eof
)

REM 推送到GitHub，触发Cloudflare Pages重新部署
git push origin main
if errorlevel 1 (
    echo.
    echo [错误] git push 失败
    echo 请手动执行: git push origin main
    goto :eof
)

echo.
echo ✓ 网页版回滚完成！
echo   Cloudflare Pages 将在1-2分钟内重新部署
echo   预览环境 staging 不受影响
echo.
goto :eof

:rollback_exe
echo.
echo [桌面EXE回滚]
echo.
echo 可回滚的渠道:
echo   cloud    - 云端桌面版
echo   dingzhi  - 定制版桌面版
echo   geren    - 个人版桌面版
echo   all      - 所有桌面版
echo.
set /p channel="请输入渠道 (回车=cloud): "
if "%channel%"=="" set channel=cloud

echo.
echo 正在查询可回滚的版本...
node tools/rollback.js %channel%
echo.
set /p ver="请输入要回滚到的版本号 (如 1.1.0): "
if "%ver%"=="" (
    echo 未输入版本号，已取消
    goto :eof
)

set /p confirm="确认将 %channel% 回滚到 %ver%？(y/n): "
if /i not "%confirm%"=="y" (
    echo 已取消
    goto :eof
)

node tools/rollback.js %channel% %ver% --push
echo.
goto :eof

:rollback_all
echo.
echo [全部回滚 - 紧急模式]
echo 此操作将:
echo   1. 撤销网页版最近一次提交
echo   2. 回滚所有桌面EXE到上一个版本
echo.
set /p confirm="确认执行全部回滚？此操作不可逆！(y/n): "
if /i not "%confirm%"=="y" (
    echo 已取消
    goto :eof
)

echo.
echo [1/2] 回滚网页版...
git revert HEAD --no-edit
git push origin main

echo.
echo [2/2] 回滚桌面EXE (所有渠道)...
for %%c in (cloud dingzhi geren) do (
    echo.
    echo 渠道: %%c
    node tools/rollback.js %%c 2>nul
    set /p ver="请输入 %%c 要回滚到的版本号 (跳过=回车): "
    if not "!ver!"=="" (
        node tools/rollback.js %%c !ver! --push
    )
)

echo.
echo ✓ 全部回滚完成！
echo   网页版: Cloudflare 1-2分钟内重新部署
echo   桌面版: 用户下次检查更新时收到回滚版本
echo.
goto :eof

:show_deploys
echo.
echo 最近5次Cloudflare Pages部署:
echo.
npx wrangler pages deployment list --project-name=tcm-prescription-system 2>&1 | findstr /R "Production.*main" | Select-Object -First 5
echo.
goto :menu
