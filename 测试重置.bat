@echo off
chcp 65001 >nul
setlocal enableextensions
title 惠康中医 测试环境重置工具

echo ============================================================
echo   惠康中医（离线桌面版）测试环境重置工具
echo ------------------------------------------------------------
echo   用途：把测试电脑恢复到「全新客户首次安装」状态
echo   将清除：记住的用户名、注册记录、激活记录、本地配置
echo.
echo   ⚠️  警告：仅限测试电脑使用！
echo   真实客户电脑运行此工具会丢失全部数据！
echo ============================================================
echo.
set /p CONFIRM=确认重置请输入 YES （其他任意内容退出）:
if /i not "%CONFIRM%"=="YES" (
    echo.
    echo 已取消，未做任何修改。
    pause
    exit /b 0
)

echo.
echo [1/3] 结束正在运行的惠康中医程序...
taskkill /f /im "惠康中医-本地.exe" >nul 2>&1
taskkill /f /im "tcm-prescription.exe" >nul 2>&1
timeout /t 1 /nobreak >nul

echo [2/3] 清除离线桌面版用户数据（配置/注册/激活/记住的用户名）...
set "UD=%APPDATA%\tcm-prescription"
if exist "%UD%" (
    rd /s /q "%UD%"
    if exist "%UD%" (
        echo.
        echo [错误] 目录删除失败，请手动删除： %UD%
        pause
        exit /b 1
    )
    echo   已清除： %UD%
) else (
    echo   未发现用户数据目录（可能已是全新状态）
)

echo [3/3] 重置完成。
echo.
echo ============================================================
echo   ✅ 现在启动「惠康中医-本地」= 全新客户首次安装体验：
echo.
echo   ① 首次启动选择版本（标准版 / 机构版）
echo   ② 登录框约 2 秒后自动弹出「注册开通」，
echo      或点击登录框下方绿色「📝 注册开通」按钮
echo   ③ 填写诊所/医师/手机号/密码 → 按导引到官网付款
echo      → 后台标记已付款 → 客户端点「立即激活」领码
echo   ④ 用注册的手机号 + 密码登录
echo.
echo   【注意】如果您用的是「解压版(portable)」程序：
echo   还需手动删除程序文件夹（惠康中医-本地.exe 旁边）的
echo   config.json、license 开头的 json 文件，才等于全新客户。
echo ============================================================
echo.
pause
