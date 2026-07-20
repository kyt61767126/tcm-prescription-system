@echo off
title 惠康中医 - 一键打包工具
setlocal enabledelayedexpansion

REM ★ 设置 NO_PAUSE=1 让各 build.bat/build-app.bat 末尾不暂停
set "NO_PAUSE=1"

REM P1-易用：记录开始时间用于总耗时统计
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "MENU_START_TIME=%%t"

:MENU
cls
echo ============================================
echo   惠康中医 - 一键打包工具
echo   (各版本统一入口 - 桌面+APP 一气呵成)
echo   启动: %MENU_START_TIME%
echo ============================================
echo.
echo   [1] 云端版 (桌面+APP)
echo   [2] 离线本地版 (桌面+APP)
echo   [3] 离线定制版 (桌面+APP)
echo   [4] 离线个人版 (桌面+APP)
echo   [5] 全部4个版本 (耗时较长)
echo   [0] 退出
echo.
echo   --- 进阶选项 ---
echo   [6] 仅打包某个版本的桌面 exe
echo   [7] 仅打包某个版本的 APP
echo   [8] 启动交互式菜单 (含编码检查/配置/严格模式)
echo.
echo   说明：
echo   - 桌面版输出: 各版本目录\dist\*.exe
echo   - APP 输出: 各版本目录\*.apk
echo   - 离线版会弹出诊所配置编辑 (必须填写)
echo   - 其他步骤全部自动完成
echo   - 耗时统计会在结束时显示
echo --------------------------------------------
set /p choice=请选择 [0-8]:

if "%choice%"=="1" call :BUILD_CLOUD all & goto MENU
if "%choice%"=="2" call :BUILD_OFFLINE bendi & goto MENU
if "%choice%"=="3" call :BUILD_OFFLINE dingzhi & goto MENU
if "%choice%"=="4" call :BUILD_OFFLINE geren & goto MENU
if "%choice%"=="5" goto ALL
if "%choice%"=="6" goto PICK_DESKTOP
if "%choice%"=="7" goto PICK_APP
if "%choice%"=="8" goto INTERACTIVE
if "%choice%"=="0" exit /b 0
goto MENU

:ALL
REM P1-易用：全部打包模式 - 显示总耗时
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "ALL_START=%%t"
echo.
echo ============================================
echo   全部4个版本打包开始: %ALL_START%
echo ============================================
call :BUILD_CLOUD all
call :BUILD_OFFLINE bendi
call :BUILD_OFFLINE dingzhi
call :BUILD_OFFLINE geren
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "ALL_END=%%t"
echo.
echo ============================================
echo   全部4个版本打包完成！
echo   开始: %ALL_START%
echo   结束: %ALL_END%
echo ============================================
pause
goto MENU

REM ============ 选择版本 - 仅桌面 ============
:PICK_DESKTOP
echo.
echo 请选择版本:
echo   [1] 云端版
echo   [2] 离线本地版
echo   [3] 离线定制版
echo   [4] 离线个人版
echo   [0] 返回主菜单
set /p ver_choice=请选择:
if "%ver_choice%"=="1" call :BUILD_CLOUD desktop & goto MENU
if "%ver_choice%"=="2" call :BUILD_OFFLINE bendi desktop & goto MENU
if "%ver_choice%"=="3" call :BUILD_OFFLINE dingzhi desktop & goto MENU
if "%ver_choice%"=="4" call :BUILD_OFFLINE geren desktop & goto MENU
if "%ver_choice%"=="0" goto MENU
goto PICK_DESKTOP

REM ============ 选择版本 - 仅 APP ============
:PICK_APP
echo.
echo 请选择版本:
echo   [1] 云端版
echo   [2] 离线本地版
echo   [3] 离线定制版
echo   [4] 离线个人版
echo   [0] 返回主菜单
set /p ver_choice=请选择:
if "%ver_choice%"=="1" call :BUILD_CLOUD app & goto MENU
if "%ver_choice%"=="2" call :BUILD_OFFLINE bendi app & goto MENU
if "%ver_choice%"=="3" call :BUILD_OFFLINE dingzhi app & goto MENU
if "%ver_choice%"=="4" call :BUILD_OFFLINE geren app & goto MENU
if "%ver_choice%"=="0" goto MENU
goto PICK_APP

REM ============ 启动交互式菜单 ============
:INTERACTIVE
echo.
echo 请选择版本进入交互式菜单:
echo   [1] 云端版 (含编码检查/严格模式等)
echo   [2] 离线本地版
echo   [3] 离线定制版
echo   [4] 离线个人版
echo   [0] 返回主菜单
set /p ver_choice=请选择:
if "%ver_choice%"=="1" (
    pushd "%~dp0cloud_project"
    powershell -ExecutionPolicy Bypass -File "packaging.ps1"
    popd
    goto MENU
)
if "%ver_choice%"=="2" (
    pushd "%~dp0offline_project\db-bendi"
    powershell -ExecutionPolicy Bypass -File "pack.bat"
    popd
    goto MENU
)
if "%ver_choice%"=="3" (
    pushd "%~dp0offline_project\db-dingzhi"
    powershell -ExecutionPolicy Bypass -File "pack.bat"
    popd
    goto MENU
)
if "%ver_choice%"=="4" (
    pushd "%~dp0offline_project\db-geren"
    powershell -ExecutionPolicy Bypass -File "pack.bat"
    popd
    goto MENU
)
if "%ver_choice%"=="0" goto MENU
goto INTERACTIVE

REM ============ 云端版 ============
REM 参数: %1 = all | desktop | app
:BUILD_CLOUD
set "CLOUD_TGT=%1"
if "%CLOUD_TGT%"=="" set "CLOUD_TGT=all"

for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "CLOUD_START=%%t"
echo.
echo ============================================
echo   开始打包云端版 (模式: %CLOUD_TGT%)...
echo   开始: %CLOUD_START%
echo ============================================

if "%CLOUD_TGT%"=="all" goto :CLOUD_DESKTOP
if "%CLOUD_TGT%"=="desktop" goto :CLOUD_DESKTOP
if "%CLOUD_TGT%"=="app" goto :CLOUD_APP
echo [ERROR] 无效模式: %CLOUD_TGT%
pause
goto :EOF

:CLOUD_DESKTOP
REM Step 1: 桌面版
echo.
echo [Step 1/2] 打包云端桌面版 exe...
pushd "%~dp0cloud_project\cloud_desktop"
call build.bat
set "RC=%errorlevel%"
popd
if not "%RC%"=="0" (
    echo.
    echo [ERROR] 云端桌面版打包失败！退出码: %RC%
    pause
    goto :EOF
)
if "%CLOUD_TGT%"=="desktop" goto :CLOUD_DONE

:CLOUD_APP
REM Step 2: APP
echo.
echo [Step 2/2] 打包云端手机 APP...
pushd "%~dp0cloud_project"
call build-app.bat
set "RC=%errorlevel%"
popd
if not "%RC%"=="0" (
    echo.
    echo [ERROR] 云端APP打包失败！退出码: %RC%
    pause
    goto :EOF
)

:CLOUD_DONE
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "CLOUD_END=%%t"
echo.
echo ============================================
echo   云端版打包完成！
echo   开始: %CLOUD_START%
echo   结束: %CLOUD_END%
echo   桌面版: cloud_project\cloud_desktop\dist\*.exe
echo   APP:    cloud_project\*.apk
echo ============================================
pause
goto :EOF

REM ============ 离线版 ============
REM 参数: %1 = version (bendi/dingzhi/geren), %2 = all|desktop|app (默认all)
:BUILD_OFFLINE
set "VER=%1"
set "TGT=%2"
if "%TGT%"=="" set "TGT=all"
set "VER_LABEL=本地"
if "%VER%"=="dingzhi" set "VER_LABEL=定制"
if "%VER%"=="geren" set "VER_LABEL=个人"

for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "OFF_START=%%t"
echo.
echo ============================================
echo   开始打包离线%VER_LABEL%版 (模式: %TGT%)...
echo   开始: %OFF_START%
echo ============================================

if "%TGT%"=="desktop" goto :OFF_DESKTOP
if "%TGT%"=="app" goto :OFF_CONFIG_THEN_APP

REM Step 1: 编辑诊所配置 (仅 all 模式需要)
:OFF_CONFIG
echo.
echo [Step 1/3] 编辑诊所配置...
pushd "%~dp0offline_project\db-%VER%"
powershell -ExecutionPolicy Bypass -File "edit-config.ps1"
set "RC=%errorlevel%"
popd
if not "%RC%"=="0" (
    echo.
    echo [ERROR] 诊所配置编辑失败！退出码: %RC%
    pause
    goto :EOF
)

:OFF_DESKTOP
REM Step 2: 桌面版 (--skip-config 跳过重复的配置编辑)
echo.
if "%TGT%"=="all" (
    echo [Step 2/3] 打包离线%VER_LABEL%桌面版 exe...
) else (
    echo [Step 1/1] 打包离线%VER_LABEL%桌面版 exe...
)
pushd "%~dp0offline_project\db-%VER%"
call build.bat --skip-config
set "RC=%errorlevel%"
popd
if not "%RC%"=="0" (
    echo.
    echo [ERROR] 离线%VER_LABEL%桌面版打包失败！退出码: %RC%
    pause
    goto :EOF
)
if "%TGT%"=="desktop" goto :OFF_DONE

:OFF_CONFIG_THEN_APP
REM 仅 APP 模式也需要先编辑配置
if "%TGT%"=="app" (
    echo.
    echo [Step 1/2] 编辑诊所配置...
    pushd "%~dp0offline_project\db-%VER%"
    powershell -ExecutionPolicy Bypass -File "edit-config.ps1"
    set "RC=%errorlevel%"
    popd
    if not "%RC%"=="0" (
        echo.
        echo [ERROR] 诊所配置编辑失败！退出码: %RC%
        pause
        goto :EOF
    )
)

REM Step 3: APP (--skip-config 跳过重复的配置编辑)
echo.
if "%TGT%"=="all" (
    echo [Step 3/3] 打包离线%VER_LABEL%手机 APP...
) else (
    echo [Step 2/2] 打包离线%VER_LABEL%手机 APP...
)
pushd "%~dp0offline_project\db-%VER%"
call build-app.bat --skip-config
set "RC=%errorlevel%"
popd
if not "%RC%"=="0" (
    echo.
    echo [ERROR] 离线%VER_LABEL%APP打包失败！退出码: %RC%
    pause
    goto :EOF
)

:OFF_DONE
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "OFF_END=%%t"
echo.
echo ============================================
echo   离线%VER_LABEL%版打包完成！
echo   开始: %OFF_START%
echo   结束: %OFF_END%
echo   桌面版: offline_project\db-%VER%\dist\*.exe
echo   APP:    offline_project\db-%VER%\*.apk
echo ============================================
pause
goto :EOF
