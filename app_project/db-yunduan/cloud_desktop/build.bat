chcp 65001 >nul
@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Huikang-TCM Build Tool

for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"
for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyyMMdd_HHmmss'"') do set "BUILD_START_STAMP=%%t"

echo ============================================
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '惠康中医云端桌面版打包工具'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '开始: %BUILD_START_TIME%'"
echo ============================================
echo.

powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[1/9] 检查环境（npm）...'"
where npm >nul 2>nul
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] 未找到 npm，请先安装 Node.js'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '下载地址: https://nodejs.org/'"
    if not defined NO_PAUSE pause
    exit /b 1
)
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] npm 已安装'"
echo.

powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[2/9] 检查依赖（node_modules + Electron 二进制）...'"
if not exist "node_modules" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'node_modules 不存在，正在安装依赖...'"
    if exist "package-lock.json" (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '执行 npm ci（更快、确定性安装）...'"
        call npm ci --no-audit --no-fund --prefer-offline
        if errorlevel 1 (
            powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[警告] npm ci 失败，回退到 npm install --ignore-scripts...'"
            call npm install --no-audit --no-fund --prefer-offline --ignore-scripts
        )
    ) else (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '执行 npm install...'"
        call npm install --no-audit --no-fund --prefer-offline --ignore-scripts
    )
    if errorlevel 1 (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] 依赖安装失败'"
        if not defined NO_PAUSE pause
        exit /b 1
    )
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] 依赖安装完成'"
) else (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] node_modules 已存在'"
)
REM Electron --ignore-scripts postinstall
if not exist "node_modules\electron\dist\electron.exe" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Electron 二进制缺失，正在下载...'"
    set NODE_TLS_REJECT_UNAUTHORIZED=0
    set ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/
    call node node_modules\electron\install.js
    set NODE_TLS_REJECT_UNAUTHORIZED=
    set ELECTRON_MIRROR=
    if not exist "node_modules\electron\dist\electron.exe" (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] Electron 二进制下载失败'"
        if not defined NO_PAUSE pause
        exit /b 1
    )
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] Electron 二进制下载完成'"
)
echo.

powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[3/9] 关闭残留进程...'"
taskkill /F /IM "HuikangTCM*.exe" >nul 2>&1
taskkill /F /IM "Huikang*.exe" >nul 2>&1
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Process | Where-Object { try { $_.Path -like '*db-yunduan/cloud_desktop*dist*' } catch { $false } } | Stop-Process -Force -ErrorAction SilentlyContinue" 2>nul
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] 残留进程已清理'"
echo.

powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[4/9] 清理旧打包产物...'"
set "OUTPUT_DIR=dist"

set old_count=0
for /f "delims=" %%D in ('dir /b /ad "dist_old_*" 2^>nul ^| sort /r') do (
    set /a old_count+=1
    if !old_count! gtr 2 (
        rmdir /s /q "%%D" 2>nul
    )
)
for /f "delims=" %%D in ('dir /b /ad "build_output_old_*" 2^>nul ^| sort /r') do (
    rmdir /s /q "%%D" 2>nul
)

if exist "%OUTPUT_DIR%" (
    rmdir /s /q "%OUTPUT_DIR%" 2>nul
    if exist "%OUTPUT_DIR%" (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[警告] 直接删除失败，尝试 PowerShell 强制删除...'"
        powershell -ExecutionPolicy Bypass -Command "try { [System.IO.Directory]::Delete('%CD%\%OUTPUT_DIR%', $true) } catch { Write-Host '[警告] PowerShell 删除也失败' }" 2>nul
    )
    if exist "%OUTPUT_DIR%" (
        for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyyMMdd_HHmmss'"') do set "DSTAMP=%%t"
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[警告] 无法删除 %OUTPUT_DIR%，重命名为 dist_old_!DSTAMP!...'"
        rename "%OUTPUT_DIR%" "dist_old_!DSTAMP!" 2>nul
        if exist "%OUTPUT_DIR%" (
            powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] 无法清理或重命名 %OUTPUT_DIR% 目录'"
            if not defined NO_PAUSE pause
            exit /b 1
        )
    )
)
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] 旧产物已清理'"
echo.

powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[5/9] 版本号自增（触发完整性基线重建）...'"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\..\tools\bump-version.ps1" -PackagePath "%CD%\package.json"
echo.

powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[6/9] 打包前安全完整性验证...'"
echo ============================================
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '安全完整性验证'"
echo ============================================
node "%~dp0..\..\..\tools\pre-build-check.js" "%CD%"
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[失败] 安全检查未通过，终止打包！请修复 package.json 的 files 列表'"
    exit /b 1
)
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] 安全检查通过'"
echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '磁盘空间检查...'"
for /f "delims=" %%d in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; [math]::Round((Get-PSDrive -Name $((Get-Location).Drive.Name)).Free/1GB,2)"') do set "FREE_GB=%%d"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '剩余空间: %FREE_GB% GB'"
if "%FREE_GB%"=="" set "FREE_GB=0"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; if([double]'%FREE_GB%' -lt 1.0){ Write-Host '[错误] 磁盘空间不足: %FREE_GB%GB, 需要 >=1GB'; exit 1 }"
if errorlevel 1 (
    if not defined NO_PAUSE pause
    exit /b 1
)
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] 磁盘空间充足'"
echo.

powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[7/9] 代码混淆（target=cloud）...'"
node "%~dp0..\..\..\tools\obfuscate.js" --target=cloud
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] 代码混淆失败'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '正在恢复原始文件...'"
    node "%~dp0..\..\..\tools\obfuscate.js" restore --target=cloud >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] 代码混淆完成'"
echo.

powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[8/9] 执行打包（prepare-win-unpacked + electron-builder）...'"
set ELECTRON_BUILDER_BINARIES_MIRROR=https://registry.npmmirror.com/-/binary/electron-builder-binaries/
set NODE_TLS_REJECT_UNAUTHORIZED=0
node "%~dp0..\..\..\tools\prepare-win-unpacked.js" "%CD%"
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] prepare-win-unpacked 失败'"
    set NODE_TLS_REJECT_UNAUTHORIZED=
    node "%~dp0..\..\..\tools\obfuscate.js" restore --target=cloud >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] win-unpacked 目录已准备'"
echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '执行 electron-builder --prepackaged...'"
REM win-unpacked
set "WIN_UNPACKED_PATH=dist/win-unpacked"
if exist "dist\win-unpacked-path.txt" (
    set /p WIN_UNPACKED_PATH=<dist\win-unpacked-path.txt
)
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '使用 prepackaged 路径: %WIN_UNPACKED_PATH%'"
REM pfx package.json certificateFile
set "PREV_TEMP=%TEMP%"
set "PREV_TMP=%TMP%"
if not exist "tmp" mkdir tmp
set "TEMP=%CD%\tmp"
set "TMP=%CD%\tmp"
node "node_modules\electron-builder\cli.js" --win --prepackaged "%WIN_UNPACKED_PATH%"
set "BUILD_RC=%errorlevel%"
set NODE_TLS_REJECT_UNAUTHORIZED=
set "TEMP=%PREV_TEMP%"
set "TMP=%PREV_TMP%"
if not "%BUILD_RC%"=="0" (
    echo.
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[警告] electron-builder 退出码 %BUILD_RC%，检查产物...'"
    set "HAS_EXE=0"
    for %%f in ("%OUTPUT_DIR%\*.exe") do set "HAS_EXE=1"
    if "!HAS_EXE!"=="1" (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] 已找到 exe 文件，构建成功（忽略退出码 %BUILD_RC%）'"
    ) else (
        echo.
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[警告] 首次 electron-builder 失败，3 秒后重试...'"
        timeout /t 3 /nobreak >nul
        set "TEMP=%CD%\tmp"
        set "TMP=%CD%\tmp"
        node "node_modules\electron-builder\cli.js" --win --prepackaged "%WIN_UNPACKED_PATH%"
        set "BUILD_RC=%errorlevel%"
        set "TEMP=%PREV_TEMP%"
        set "TMP=%PREV_TMP%"
        set "HAS_EXE=0"
        for %%f in ("%OUTPUT_DIR%\*.exe") do set "HAS_EXE=1"
        if not "!HAS_EXE!"=="1" (
            powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] 重试失败 - 未找到 exe 文件'"
            powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '正在恢复原始 JavaScript 代码...'"
            node "%~dp0..\..\..\tools\obfuscate.js" restore --target=cloud >nul 2>&1
            if not defined NO_PAUSE pause
            exit /b 1
        )
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] 重试成功 - 已找到 exe 文件'"
    )
)
if exist "tmp" rmdir /s /q "tmp" 2>nul
echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '正在恢复原始 JavaScript 代码...'"
node "%~dp0..\..\..\tools\obfuscate.js" restore --target=cloud
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] 恢复原始代码失败'"
    if not defined NO_PAUSE pause
    exit /b 1
)
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] 原始代码已恢复'"
echo.

powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[9/9] 验证产物 & 完成...'"
set "EXE_FILE="
for %%f in ("%OUTPUT_DIR%\*.exe") do set "EXE_FILE=%%f"
if "%EXE_FILE%"=="" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] 在 %OUTPUT_DIR% 中未找到 .exe 文件'"
    node "%~dp0..\..\..\tools\obfuscate.js" restore --target=cloud >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
for %%A in ("%EXE_FILE%") do (
    if %%~zA LSS 1000000 (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[错误] exe 文件过小: %%~zA 字节 ^(< 1MB^)，构建可能不完整'"
        node "%~dp0..\..\..\tools\obfuscate.js" restore --target=cloud >nul 2>&1
        if not defined NO_PAUSE pause
        exit /b 1
    )
    if %%~zA GTR 200000000 (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[警告] exe 文件异常大: %%~zA 字节 ^(^> 200MB^)'"
    )
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] %%~nxA  %%~zA 字节'"
)
echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '输出目录: %CD%\%OUTPUT_DIR%'"
echo ============================================
for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
for /f "delims=" %%e in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $s=[DateTime]::Parse('%BUILD_START_TIME%'); $e=[DateTime]::Parse('%BUILD_END_TIME%'); $d=$e-$s; $d.ToString('hh\:mm\:ss')"') do set "BUILD_ELAPSED=%%e"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '============================================' -ForegroundColor Yellow; Write-Host '  打包完成!' -ForegroundColor Yellow; Write-Host '  开始: %BUILD_START_TIME%' -ForegroundColor Yellow; Write-Host '  结束: %BUILD_END_TIME%' -ForegroundColor Yellow; Write-Host '  总耗时: %BUILD_ELAPSED%' -ForegroundColor Yellow; Write-Host '============================================' -ForegroundColor Yellow"
if not defined NO_PAUSE (
    set "EXIT_KEY="
    set "EXIT_KEY="
    set /p "EXIT_KEY=Press 0 or Enter to exit: "
)
exit /b 0
