@echo off
chcp 65001 >nul
title 惠康中医 - 一键打包工具
setlocal enabledelayedexpansion

REM ★ 设置 NO_PAUSE=1 让各 build.bat/build-app.bat 末尾不暂停
set "NO_PAUSE=1"

:MENU
cls
echo ============================================
echo   惠康中医 - 一键打包工具
echo ============================================
echo.
echo   [1] 云端版（桌面+APP）
echo   [2] 离线本地版（桌面+APP）
echo   [3] 离线定制版（桌面+APP）
echo   [4] 离线个人版（桌面+APP）
echo   [5] 全部4个版本（耗时较长）
echo   [0] 退出
echo.
echo   说明：
echo   - 桌面版输出: 各版本目录\dist\*.exe
echo   - APP输出: 各版本目录\*.apk
echo   - 离线版会弹出诊所配置编辑（必须填写）
echo   - 其他步骤全部自动完成
echo --------------------------------------------
set /p choice=请选择 [0-5]:

if "%choice%"=="1" call :BUILD_CLOUD & goto MENU
if "%choice%"=="2" call :BUILD_OFFLINE bendi & goto MENU
if "%choice%"=="3" call :BUILD_OFFLINE dingzhi & goto MENU
if "%choice%"=="4" call :BUILD_OFFLINE geren & goto MENU
if "%choice%"=="5" goto ALL
if "%choice%"=="0" exit /b 0
goto MENU

:ALL
call :BUILD_CLOUD
call :BUILD_OFFLINE bendi
call :BUILD_OFFLINE dingzhi
call :BUILD_OFFLINE geren
echo.
echo ============================================
echo   全部4个版本打包完成！
echo ============================================
pause
goto MENU

REM ============ 云端版 ============
:BUILD_CLOUD
echo.
echo ============================================
echo   开始打包云端版（桌面+APP）...
echo ============================================

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

echo.
echo ============================================
echo   云端版打包完成！
echo   桌面版: cloud_project\cloud_desktop\dist\*.exe
echo   APP: cloud_project\*.apk
echo ============================================
pause
goto :EOF

REM ============ 离线版 ============
:BUILD_OFFLINE
set "VER=%1"
set "VER_LABEL=本地"
if "%VER%"=="dingzhi" set "VER_LABEL=定制"
if "%VER%"=="geren" set "VER_LABEL=个人"

echo.
echo ============================================
echo   开始打包离线%VER_LABEL%版（桌面+APP）...
echo ============================================

REM Step 1: 编辑诊所配置（必须用户交互）
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

REM Step 2: 桌面版（--skip-config 跳过重复的配置编辑）
echo.
echo [Step 2/3] 打包离线%VER_LABEL%桌面版 exe...
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

REM Step 3: APP（--skip-config 跳过重复的配置编辑）
echo.
echo [Step 3/3] 打包离线%VER_LABEL%手机 APP...
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

echo.
echo ============================================
echo   离线%VER_LABEL%版打包完成！
echo   桌面版: offline_project\db-%VER%\dist\*.exe
echo   APP: offline_project\db-%VER%\*.apk
echo ============================================
pause
goto :EOF
