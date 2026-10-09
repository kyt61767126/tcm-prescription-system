@echo off
chcp 936 >nul <nul
setlocal enableextensions enabledelayedexpansion
title 惠康中医 配置修复工具 v2

echo ============================================================
echo   惠康中医（本地桌面版）配置修复工具 v2
echo ------------------------------------------------------------
echo   适用提示：激活时出现「本地配置异常（旧版本残留或配置损坏），
echo   激活已中止且未消耗激活码」或「配置文件异常，请联系客服」。
echo.
echo   本工具只把旧配置文件改名备份（不删除、可恢复），
echo   不碰处方、药材、验方数据，也不碰激活授权 license.dat。
echo.
echo   自动覆盖：安装版配置目录、解压版软件所在文件夹
echo   （会自动识别正在运行的软件位置；也可把桌面的软件图标
echo     直接拖到本工具图标上运行）。
echo.
echo   [注意] 运行前请保存手头工作，本工具会自动关闭惠康中医软件。
echo ============================================================
echo.
set /p CONFIRM=确认修复请输入 YES （其他任意内容退出）:
if /i not "%CONFIRM%"=="YES" (
    echo.
    echo 已取消，未做任何修改。
    pause
    exit /b 0
)

rem ===== 1) 先从运行中的进程抓取 exe 完整路径（必须在杀进程之前）=====
rem    匹配词「惠康中医-本地」用 Unicode 码点构造，命令行纯 ASCII 防乱码；
rem    管道输出保持系统默认 ANSI(GBK)，与 chcp 936 的 for /f 读取一致。
rem    用编号变量 P1..PC 保存，避免跨行变量值破坏 cmd 读取指针。
set /a PC=0
for /f "delims=" %%p in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$n=-join([char]0x60E0,[char]0x5EB7,[char]0x4E2D,[char]0x533B,'-',[char]0x672C,[char]0x5730);Get-Process|Where-Object{$_.Path -and $_.Path.Contains($n)}|ForEach-Object{$_.Path}" 2^>nul') do (
    if exist "%%p" call :addProc "%%p"
)

rem ===== 2) 关闭软件：标准进程名 + 探测到的实际 exe 名（防客户改名）=====
echo.
echo [1/4] 关闭正在运行的惠康中医软件...
taskkill /f /im "惠康中医-本地.exe" >nul 2>&1
taskkill /f /im "tcm-prescription.exe" >nul 2>&1
for /l %%i in (1,1,%PC%) do call :killProc %%i
ping 127.0.0.1 -n 2 >nul

rem ===== 3) 收集需要检查的目录（编号去重 D1..DC）=====
echo.
echo [2/4] 检查并备份旧配置文件...
set /a DC=0
set /a IC=0
set "CLEANED=0"
call :addDir "%APPDATA%\惠康中医-本地"
call :addDir "%APPDATA%\惠康中医"
call :addDir "%APPDATA%\tcm-prescription"
rem 工具自身所在目录（与 exe 放一起时）
call :addDir "%~dp0."
rem 拖放到本工具上的目标（exe 文件取其目录，目录直接用）
if not "%~1"=="" (
    if exist "%~1\" (
        call :addDir "%~1"
    ) else if exist "%~1" (
        call :addDir "%~dp1."
    )
)
rem 运行中进程所在目录（解压版核心路径）
for /l %%i in (1,1,%PC%) do call :addProcDir %%i
rem 常见 perMachine 安装位置
for %%P in ("%ProgramFiles%\惠康中医-本地" "%ProgramFiles(x86)%\惠康中医-本地") do (
    if exist "%%~P\惠康中医-本地.exe" call :addDir "%%~P"
)

rem ===== 4) 逐目录执行备份 =====
if %DC% EQU 0 (
    echo   未定位到任何配置目录。
) else (
    for /l %%i in (1,1,%DC%) do call :cleanIdx %%i
)

echo.
echo [3/4] 配置备份完成。
echo.
echo [4/4] 修复流程结束。
echo.
echo ============================================================
if "!CLEANED!"=="0" (
    echo   [提示] 本次没有发现可清理的配置文件。
    echo.
    echo   如果软件仍提示配置异常，请做以下任一操作后重试：
    echo    ^(1^) 把桌面上的「惠康中医-本地」软件图标直接【拖到本工具
    echo        图标上】再松开，工具会精确定位软件文件夹；
    echo    ^(2^) 或右键桌面软件图标 -^>「打开文件所在位置」，把本工具
    echo        复制进打开的文件夹后双击运行；
    echo    ^(3^) 仍不行请把本窗口截图 + 软件文件夹截图发客服。
) else (
    echo   [完成] 已备份 !CLEANED! 处旧配置（.bak 文件，可改回原名恢复）。
    echo.
    echo   接下来请：
    echo    ^(1^) 重新打开「惠康中医-本地」
    echo    ^(2^) 用【原来的激活码 + 原来的手机号】重新激活
    echo        （码绑的是本机，重激不另扣次数，无需重新购买）
    echo    ^(3^) 若询问诊所名，填写与原来一致的名称
    echo    ^(4^) 激活后密码重新设置一次即可登录
    echo.
    echo   处方/药材/验方数据保存在「惠康中医媒体\data」，不受影响。
)
echo.
echo   操作后仍有异常，请把【本窗口全部内容截图】发客服微信 hktzy1688。
echo ============================================================
echo.
pause
exit /b 0

rem ============ 子程序 ============

:addProc
set /a PC+=1
set "P%PC%=%~1"
goto :eof

:killProc
set "pv=!P%1!"
for %%f in ("!pv!") do taskkill /f /im "%%~nxf" >nul 2>&1
goto :eof

:addProcDir
set "pv=!P%1!"
for %%f in ("!pv!") do call :addDir "%%~dpf."
goto :eof

:addDir
rem 入参 %1=目录；目录存在且未重复则编号入列
set "cand=%~1"
if "%cand:~-1%"=="." set "cand=%cand:~0,-1%"
if "%cand:~-1%"=="\" set "cand=%cand:~0,-1%"
if not exist "%cand%\" goto :eof
for /l %%i in (1,1,%DC%) do (
    if /i "!D%%i!"=="%cand%" goto :eof
)
set /a DC+=1
set "D%DC%=%cand%"
goto :eof

:cleanIdx
set "dv=!D%1!"
call :cleanDir "!dv!"
goto :eof

:cleanDir
set "d=%~1"
if not exist "%d%\config.json" (
    echo   - 跳过（无 config.json）：%d%
    goto :eof
)
call :renameOne "%d%" "config.json" "config.bak.json" "config.bak2.json" "config.bak3.json"
if exist "%d%\users-backup.json" (
    call :renameOne "%d%" "users-backup.json" "users-backup.bak.json" "users-backup.bak2.json" "users-backup.bak3.json"
)
goto :eof

:renameOne
rem %1=目录 %2=原文件名 %3..%5=备份候选名（递增防覆盖）
set "rd=%~1"
set "rf=%~2"
if not exist "%rd%\%rf%" goto :eof
set "target=%~3"
if exist "%rd%\%~3" set "target=%~4"
if exist "%rd%\%~4" set "target=%~5"
if exist "%rd%\%~5" (
    echo   [警告] 备份名已用尽，跳过：%rd%\%rf%
    goto :eof
)
ren "%rd%\%rf%" "%target%" >nul 2>&1
if exist "%rd%\%target%" (
    echo   已备份：%rd%\%target%
    set /a CLEANED+=1 >nul
) else (
    echo   [警告] 文件被占用或无权限，改名失败：%rd%\%rf%
    echo          请退出 360/火绒/电脑管家后重试，或手动改名为 %target%
)
goto :eof
