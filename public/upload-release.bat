@echo off
chcp 65001 >nul
REM ============================================================================
REM  upload-release.bat — 一键上传 exe/apk 到 GitHub Releases
REM
REM  前提条件：
REM    1. 安装 GitHub CLI: winget install GitHub.cli
REM    2. 登录: gh auth login
REM
REM  用法：
REM    upload-release.bat              (交互式选择文件)
REM    upload-release.bat v1.0.0 file1.apk file2.exe  (指定版本和文件)
REM ============================================================================

setlocal enabledelayedexpansion

REM 检查 gh CLI 是否安装
where gh >nul 2>&1
if errorlevel 1 (
    echo [ERROR] GitHub CLI 未安装
    echo.
    echo 请先安装:
    echo   winget install GitHub.cli
    echo.
    echo 安装后运行:
    echo   gh auth login
    echo.
    pause
    exit /b 1
)

REM 检查是否已登录
gh auth status >nul 2>&1
if errorlevel 1 (
    echo [ERROR] 未登录 GitHub
    echo 请运行: gh auth login
    pause
    exit /b 1
)

REM 获取版本号
set "VERSION=%~1"
if "%VERSION%"=="" (
    echo.
    echo ============================================
    echo   GitHub Releases 上传工具
    echo ============================================
    echo.
    set /p VERSION="请输入版本号 (如 v1.0.0): "
)

if "%VERSION%"=="" (
    echo [ERROR] 版本号不能为空
    pause
    exit /b 1
)

echo.
echo [INFO] 版本号: %VERSION%
echo.

REM 收集要上传的文件
set "FILES="
set "FILE_COUNT=0"

if "%~2"=="" (
    REM 交互式选择文件
    echo 请选择要上传的文件（直接拖拽到窗口或输入路径）:
    echo 输入空行结束
    echo.

    :select_loop
    set /p "FILE_PATH="
    if "!FILE_PATH!"=="" goto select_done
    if not exist "!FILE_PATH!" (
        echo [WARN] 文件不存在: !FILE_PATH!
        goto select_loop
    )
    set "FILES=!FILES! "!FILE_PATH!""
    set /a FILE_COUNT+=1
    echo [OK] 已添加: !FILE_PATH!
    goto select_loop

    :select_done
) else (
    REM 命令行参数指定文件
    shift
    :param_loop
    if "%~2"=="" goto param_done
    if not exist "%~2" (
        echo [WARN] 文件不存在: %~2
    ) else (
        set "FILES=!FILES! "%~2""
        set /a FILE_COUNT+=1
        echo [OK] 已添加: %~2
    )
    shift
    goto param_loop
    :param_done
)

if %FILE_COUNT% EQU 0 (
    echo [ERROR] 没有选择文件
    pause
    exit /b 1
)

echo.
echo [INFO] 共 %FILE_COUNT% 个文件待上传
echo.

REM 询问发布说明
set "NOTES="
set /p NOTES="请输入发布说明 (可留空): "

REM 创建 Release 并上传文件
echo.
echo [INFO] 正在创建 Release %VERSION% ...
if "!NOTES!"=="" (
    gh release create %VERSION% %FILES% --title "%VERSION%" --generate-notes
) else (
    gh release create %VERSION% %FILES% --title "%VERSION%" --notes "!NOTES!"
)

if errorlevel 1 (
    echo.
    echo [ERROR] 上传失败，请检查错误信息
    pause
    exit /b 1
)

echo.
echo ============================================
echo   上传成功！
echo ============================================
echo.
echo 下载链接:
gh release view %VERSION% --json assets --jq ".assets[] | \"  \(.name): \(.url)\""
echo.
echo 请将以上链接填入 public/hash-manifest.json 的 url 字段
echo.

REM 自动运行 calculate-hash.js 更新校验值
set /p RUN_HASH="是否自动计算SHA-256并更新hash-manifest.json? (y/n): "
if /i "!RUN_HASH!"=="y" (
    node "%~dp0..\offline_project\_shared\calculate-hash.js"
)

pause
exit /b 0
