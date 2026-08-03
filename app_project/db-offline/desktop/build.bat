@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
title 惠康中医离线桌面版打包工具（机构版）

REM 记录开始时间（用于耗时统计）
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd_HHmmss'"') do set "BUILD_START_STAMP=%%t"

echo ============================================
echo  惠康中医离线桌面版打包工具（机构版）
echo  开始: %BUILD_START_TIME%
echo ============================================
echo.

echo [1/9] 检查环境（npm）...
where npm >nul 2>nul
if errorlevel 1 (
    echo       [错误] 未找到 npm，请先安装 Node.js
    echo       下载地址: https://nodejs.org/
    if not defined NO_PAUSE pause
    exit /b 1
)
echo       [OK] npm 已安装
echo.

echo [2/9] 检查依赖（node_modules + Electron 二进制）...
if not exist "node_modules" (
    echo       node_modules 不存在，正在安装依赖...
    if exist "package-lock.json" (
        echo       执行 npm ci（更快、确定性安装）...
        call npm ci --no-audit --no-fund --prefer-offline
        if errorlevel 1 (
            echo       [警告] npm ci 失败，回退到 npm install --ignore-scripts...
            call npm install --no-audit --no-fund --prefer-offline --ignore-scripts
        )
    ) else (
        echo       执行 npm install...
        call npm install --no-audit --no-fund --prefer-offline --ignore-scripts
    )
    if errorlevel 1 (
        echo       [错误] 依赖安装失败
        if not defined NO_PAUSE pause
        exit /b 1
    )
    echo       [OK] 依赖安装完成
) else (
    echo       [OK] node_modules 已存在
)
REM Electron 二进制检查（--ignore-scripts 跳过 postinstall，需手动下载）
if not exist "node_modules\electron\dist\electron.exe" (
    echo       Electron 二进制缺失，正在下载...
    set NODE_TLS_REJECT_UNAUTHORIZED=0
    set ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/
    call node node_modules\electron\install.js
    set NODE_TLS_REJECT_UNAUTHORIZED=
    set ELECTRON_MIRROR=
    if not exist "node_modules\electron\dist\electron.exe" (
        echo       [错误] Electron 二进制下载失败
        if not defined NO_PAUSE pause
        exit /b 1
    )
    echo       [OK] Electron 二进制下载完成
)
echo.

echo [3/9] 关闭残留进程...
REM 精确匹配项目相关进程，避免误杀其他 Electron 应用（如 VSCode、Slack）
taskkill /F /IM "app-custom.exe" >nul 2>&1
taskkill /F /IM "惠康中医-LJ.exe" >nul 2>&1
REM 用 PowerShell Get-Process 替代废弃的 wmic（Win11 已弃用），基于路径精确匹配
powershell -NoProfile -Command "Get-Process | Where-Object { try { $_.Path -like '*db-offline\desktop\dist*' -or $_.Path -like '*db-offline\desktop\build_output*' } catch { $false } } | Stop-Process -Force -ErrorAction SilentlyContinue" 2>nul
echo       [OK] 残留进程已清理
echo.

echo [4/9] 配置诊所信息...
if /i "%1"=="--skip-config" (
    echo       [SKIP] 检测到 --skip-config 参数，跳过配置
) else (
    powershell -ExecutionPolicy Bypass -File "..\edit-config.ps1"
)
echo.

echo [5/9] 清理旧打包产物 + 版本号自增...
set "OUTPUT_DIR=dist"

set old_count=0
for /f "delims=" %%D in ('dir /b /ad "dist_old_*" 2^>nul ^| sort /r') do (
    set /a old_count+=1
    if !old_count! gtr 2 (
        rmdir /s /q "%%D" 2>nul
    )
)

if exist "%OUTPUT_DIR%" (
    rmdir /s /q "%OUTPUT_DIR%" 2>nul
    if exist "%OUTPUT_DIR%" (
        echo       [警告] 直接删除失败，尝试 PowerShell 强制删除...
        powershell -ExecutionPolicy Bypass -Command "try { [System.IO.Directory]::Delete('%CD%\%OUTPUT_DIR%', $true) } catch { Write-Host '[警告] PowerShell 删除也失败' }" 2>nul
    )
    if exist "%OUTPUT_DIR%" (
        REM 用 PowerShell Get-Date 替代废弃的 wmic 获取时间戳
        for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd_HHmmss'"') do set "DSTAMP=%%t"
        echo       [警告] 无法删除 %OUTPUT_DIR%，重命名为 dist_old_!DSTAMP!...
        rename "%OUTPUT_DIR%" "dist_old_!DSTAMP!" 2>nul
        if exist "%OUTPUT_DIR%" (
            echo       [错误] 无法清理或重命名 %OUTPUT_DIR% 目录
            echo       请手动关闭使用 %OUTPUT_DIR%\ 的程序后重试
            echo       或手动删除/重命名 %OUTPUT_DIR% 文件夹
            if not defined NO_PAUSE pause
            exit /b 1
        )
    )
)
echo       [OK] 旧产物已清理
echo.
echo       版本号自增（触发完整性基线重建）...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\..\tools\bump-version.ps1" -PackagePath "%CD%\package.json"
echo.

echo [6/9] 打包前安全完整性验证...
echo ============================================
echo   安全完整性验证
echo ============================================
node "%~dp0..\..\..\tools\pre-build-check.js" "%CD%"
if errorlevel 1 (
    echo [失败] 安全检查未通过，终止打包！请修复 package.json 的 files 列表
    node "%~dp0..\..\..\tools\obfuscate.js" restore --target=dingzhi >nul 2>&1
    exit /b 1
)
echo [OK] 安全检查通过
echo.
echo       磁盘空间检查...
for /f "delims=" %%d in ('powershell -NoProfile -Command "[math]::Round((Get-PSDrive -Name $((Get-Location).Drive.Name)).Free/1GB,2)"') do set "FREE_GB=%%d"
echo       剩余空间: %FREE_GB% GB
if "%FREE_GB%"=="" set "FREE_GB=0"
powershell -NoProfile -Command "if([double]'%FREE_GB%' -lt 1.0){ Write-Host '[错误] 磁盘空间不足: %FREE_GB%GB, 需要 >=1GB'; exit 1 }"
if errorlevel 1 (
    node "%~dp0..\..\..\tools\obfuscate.js" restore --target=dingzhi >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] 磁盘空间充足
echo.

echo [7/9] 代码混淆（target=dingzhi，可能耗时 1-2 分钟）...
node "%~dp0..\..\..\tools\obfuscate.js" --target=dingzhi
if errorlevel 1 (
    echo [错误] 代码混淆失败
    echo 正在恢复原始文件...
    node "%~dp0..\..\..\tools\obfuscate.js" restore --target=dingzhi >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] 代码混淆完成
echo.

echo [8/9] 执行打包（npm run build + 失败重试）...
set ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://registry.npmmirror.com/-/binary/electron-builder-binaries/
REM better-sqlite3 prebuild-install 从 GitHub Releases 下载预编译包，有时 SSL 证书验证失败
REM 临时禁用 TLS 证书验证（仅构建期间），确保 prebuild-install 下载匹配 electron ABI 的包
REM 代码签名已禁用（pfx 已删除，package.json 无 certificateFile）

REM 将 TEMP 目录隔离到项目 tmp/，避免 C: 盘空间/权限问题
set "PREV_TEMP=%TEMP%"
set "PREV_TMP=%TMP%"
if not exist "tmp" mkdir tmp
set "TEMP=%CD%\tmp"
set "TMP=%CD%\tmp"

set NODE_TLS_REJECT_UNAUTHORIZED=0
call npm run build
set "BUILD_RC=%errorlevel%"
REM 安全加固：清除临时 TLS 禁用，避免污染开发环境
set NODE_TLS_REJECT_UNAUTHORIZED=
if not "%BUILD_RC%"=="0" (
    echo.
    echo       [警告] 首次构建失败，3 秒后重试...
    timeout /t 3 /nobreak >nul
    set NODE_TLS_REJECT_UNAUTHORIZED=0
    call npm run build
    set "BUILD_RC=%errorlevel%"
    set NODE_TLS_REJECT_UNAUTHORIZED=
)

REM 无论构建结果如何都恢复 TEMP
set "TEMP=%PREV_TEMP%"
set "TMP=%PREV_TMP%"
if exist "tmp" rmdir /s /q "tmp" 2>nul

if not "%BUILD_RC%"=="0" (
    echo.
    echo [错误] 构建失败，请查看上方日志
    echo 正在恢复原始 JavaScript 代码...
    node "%~dp0..\..\..\tools\obfuscate.js" restore --target=dingzhi >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
echo.

echo [9/9] 验证产物 & 完成...
echo       产物完整性验证...
set "EXE_FILE="
for %%f in ("%OUTPUT_DIR%\*.exe") do set "EXE_FILE=%%f"
if "%EXE_FILE%"=="" (
    echo [错误] 在 %OUTPUT_DIR% 中未找到 .exe 文件
    node "%~dp0..\..\..\tools\obfuscate.js" restore --target=dingzhi >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
for %%A in ("%EXE_FILE%") do (
    if %%~zA LSS 1000000 (
        echo [错误] exe 文件过小: %%~zA 字节 ^(< 1MB^)，构建可能不完整
        node "%~dp0..\..\..\tools\obfuscate.js" restore --target=dingzhi >nul 2>&1
        if not defined NO_PAUSE pause
        exit /b 1
    )
    if %%~zA GTR 200000000 (
        echo [警告] exe 文件异常大: %%~zA 字节 ^(^> 200MB^)
    )
    echo   [OK] %%~nxA  %%~zA 字节
)
echo.
echo       正在恢复原始 JavaScript 代码...
node "%~dp0..\..\..\tools\obfuscate.js" restore --target=dingzhi
if errorlevel 1 (
    echo [错误] 恢复原始代码失败！源代码可能仍处于混淆状态。
    echo 请手动执行: node "%~dp0..\..\..\tools\obfuscate.js" restore --target=dingzhi
    if not defined NO_PAUSE pause
    exit /b 1
)
echo       [OK] 原始代码已恢复
echo.
echo 输出目录: %CD%\%OUTPUT_DIR%
echo ============================================
if exist "dist_old_*" (
    echo [提示] 旧打包产物已保存为 dist_old_* 目录
    echo       未来构建时将自动清理（仅保留最近 2 个）
)
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
for /f "delims=" %%e in ('powershell -NoProfile -Command "$s=[DateTime]::Parse('%BUILD_START_TIME%'); $e=[DateTime]::Parse('%BUILD_END_TIME%'); $d=$e-$s; $d.ToString('hh\:mm\:ss')"') do set "BUILD_ELAPSED=%%e"
powershell -NoProfile -Command "Write-Host '============================================' -ForegroundColor Yellow; Write-Host '  打包完成!' -ForegroundColor Yellow; Write-Host '  开始: %BUILD_START_TIME%' -ForegroundColor Yellow; Write-Host '  结束: %BUILD_END_TIME%' -ForegroundColor Yellow; Write-Host '  总耗时: %BUILD_ELAPSED%' -ForegroundColor Yellow; Write-Host '============================================' -ForegroundColor Yellow"
exit /b 0
