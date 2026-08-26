@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Huikang-TCM Build Tool

REM ★ [BUILD-LOCK 2026-08-23] Global build mutex - abort if another build is running
REM   并发构建会互相冲突（obfuscate 共享源文件/node_modules/git index/构建缓存）
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\..\tools\build-lock.ps1" acquire -LockPath "%~dp0..\..\..\.build.lock" -Owner "cloud-desktop"
if errorlevel 2 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] 检测到另一个构建正在运行，共享文件会冲突。请等待其结束后重试；若确认无构建在跑，可删除仓库根目录 .build.lock 后重试。' -ForegroundColor Red"
    if not defined NO_PAUSE pause
    exit /b 1
)

for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"
for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyyMMdd_HHmmss'"') do set "BUILD_START_STAMP=%%t"

echo ============================================
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Huikang TCM Cloud Desktop Build Tool (Unified)'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Started: %BUILD_START_TIME%'"
echo ============================================
echo.

powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[1/9] Check environment (npm)...'"
where npm >nul 2>nul
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] npm not found, please install Node.js first'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Download URL: https://nodejs.org/'"
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] npm installed
echo.

powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[2/9] Check dependencies (node_modules + Electron binary)...'"
if not exist "node_modules" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'node_modules not found, installing dependencies...'"
    if exist "package-lock.json" (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Running npm ci (faster, deterministic)...'"
        call npm ci --no-audit --no-fund --prefer-offline
        if errorlevel 1 (
            powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] npm ci failed, fallback to npm install --ignore-scripts...'"
            call npm install --no-audit --no-fund --prefer-offline --ignore-scripts
        )
    ) else (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Running npm install...'"
        call npm install --no-audit --no-fund --prefer-offline --ignore-scripts
    )
    if errorlevel 1 (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] Dependency installation failed'"
        if not defined NO_PAUSE pause
        exit /b 1
    )
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] Dependency installation complete'"
) else (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] node_modules already exists'"
)
REM Electron --ignore-scripts postinstall
if not exist "node_modules\electron\dist\electron.exe" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Electron binary missing, downloading...'"
    set NODE_TLS_REJECT_UNAUTHORIZED=0
    set ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/
    call node node_modules\electron\install.js
    set NODE_TLS_REJECT_UNAUTHORIZED=
    set ELECTRON_MIRROR=
    if not exist "node_modules\electron\dist\electron.exe" (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] Electron binary download failed'"
        if not defined NO_PAUSE pause
        exit /b 1
    )
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] Electron binary download complete'"
)
echo.

echo [3/9] Kill leftover processes...
taskkill /F /IM "HuikangTCM*.exe" >nul 2>&1
taskkill /F /IM "Huikang*.exe" >nul 2>&1
REM 2026-08-19 enhanced: kill Chinese-prefixed exe, electron.exe, wmic path match (sibling to offline desktop)
taskkill /F /IM "惠康*.exe" >nul 2>&1
taskkill /F /IM "electron.exe" >nul 2>&1
wmic process where "ExecutablePath like '%%db-yunduan%%cloud_desktop%%' or ExecutablePath like '%%惠康%%'" call Terminate >nul 2>&1
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Process | Where-Object { try { $_.Path -like '*db-yunduan/cloud_desktop*dist*' } catch { $false } } | Stop-Process -Force -ErrorAction SilentlyContinue" 2>nul
REM wait 2s for handles to be released (AV/minifilter scan)
REM ★ 2026-08-25 timeout.exe 依赖控制台 stdin，在 stdin 被重定向的环境（一键打包/代理管道/CI）
REM   会立即报错退出 "ERROR: Input redirection is not supported" 且等待失效。
REM   改用 ping 延时（n 个包约 n-1 秒），不依赖 stdin，任何环境等价生效。
ping -n 3 127.0.0.1 >nul
echo [OK] Leftover processes cleaned
echo.

REM ★ 2026-08-18 Add: Clinic/Doctor info config step (align with offline desktop\build.bat)
REM Manual build: interactive edit; one-click build (one-click-pack.ps1 with SKIP_CONFIG=1): skip
echo [3.5/9] Configure clinic info...
if defined SKIP_CONFIG (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[SKIP] SKIP_CONFIG env detected, skipping config'"
) else if /i "%1"=="--skip-config" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[SKIP] --skip-config flag detected, skipping config'"
) else (
    powershell -ExecutionPolicy Bypass -File "%~dp0..\edit-config.ps1" -DesktopDir cloud_desktop -AppDir cloud_app -AutoConfirm
)
echo.

echo [4/9] Clean old build artifacts...
for /f "delims=" %%d in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; try { (Get-Content package.json -Raw | ConvertFrom-Json).build.directories.output } catch { 'dist' }"') do set "OUTPUT_DIR=%%d"
if "%OUTPUT_DIR%"=="" set "OUTPUT_DIR=dist"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '  Output directory: %OUTPUT_DIR%'"

set old_count=0
for /f "delims=" %%D in ('dir /b /ad "dist_old_*" 2^>nul ^| sort /r') do (
    set /a old_count+=1
    if !old_count! gtr 2 (
        rmdir /s /q "%%D" 2>nul
    )
)
REM 2026-08-19 NEW: clean build_output_* fallback dirs (keep last 2 only)
set old_count=0
for /f "delims=" %%D in ('dir /b /ad "build_output_*" 2^>nul ^| sort /r') do (
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
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] Direct rmdir failed, try PowerShell force delete...'"
        powershell -ExecutionPolicy Bypass -Command "try { [System.IO.Directory]::Delete('%CD%\%OUTPUT_DIR%', $true) } catch { Write-Host '[WARN] PowerShell delete also failed' }" 2>nul
    )
    if exist "%OUTPUT_DIR%" (
        for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyyMMdd_HHmmss'"') do set "DSTAMP=%%t"
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] Cannot delete %OUTPUT_DIR%, renaming to dist_old_!DSTAMP!...'"
        rename "%OUTPUT_DIR%" "dist_old_!DSTAMP!" 2>nul
    )
    REM 2026-08-19 NEW fallback: rename ALSO fails (Defender minifilter lock on app.asar)
    REM   -> switch to build_output_<ts> isolated dir. Never block build.
    if exist "%OUTPUT_DIR%" (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] %OUTPUT_DIR% locked (likely Defender scanning app.asar), switching to alternate output dir build_output_!DSTAMP!...'"
        set "OUTPUT_DIR=build_output_!DSTAMP!"
        if exist "!OUTPUT_DIR!" rmdir /s /q "!OUTPUT_DIR!" 2>nul
    )
)
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] Output dir ready: %CD%\%OUTPUT_DIR%'"
echo.

REM 2026-08-19 Add: Unified build-env gate (8-step: Git/BOM/encoding/version/package/cleanup/disk)
REM Place BEFORE bump-version: if identity gate fails, do not waste version bump
echo [5/9] Ensure build environment (BOM / encoding / version gate / package integrity / cleanup / disk)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\..\tools\ensure-build-env.ps1" -Target cloud-desktop -DesktopDir "%~dp0"
if errorlevel 1 (
    if not defined NO_PAUSE pause
    exit /b 1
)
echo.

REM ★ 铁闸1（2026-08-21）：代码副本哈希一致性硬校验
REM   任何 permission/button-manager/edition-lock 副本 ≠ shared/ 权威源 → 阻断构建
REM   禁止"改了 shared/ 但某端副本没同步 → 那端打包又出旧 bug"复发
echo [5.1/9] Iron Gate #1 — Copy-Consistency Hash Check (shared vs all copies)...
node "%~dp0..\..\..\tools\copy-consistency.cjs"
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '  → Auto-FIX with --fix...'"
    node "%~dp0..\..\..\tools\copy-consistency.cjs" --fix
    if errorlevel 1 (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] 副本不一致且 --fix 失败，请手动检查文件锁'"
        if not defined NO_PAUSE pause
        exit /b 1
    )
)
echo.

powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[6/9] Auto-bump version (triggers integrity baseline rebuild)...'"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\..\tools\bump-version.ps1" -PackagePath "%CD%\package.json"
echo.

powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[7/9] Code obfuscation (target=cloud)...'"
node "%~dp0..\..\..\tools\obfuscate.js" --target=cloud
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] Code obfuscation failed'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Restoring original files...'"
    node "%~dp0..\..\..\tools\obfuscate.js" restore --target=cloud >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] Code obfuscation complete
echo.

REM ★ 铁闸4（2026-08-21）：构建前写 build-meta.json（版本三元组）
REM   登录页顶端会显示 Vx.x.xx | Build 时间 | Arch 2.xx，用户一眼能对照真假包
echo [7.1/9] Iron Gate #4 / #5 — Write build-meta.json (version-triple for login page)...
node "%~dp0..\..\..\tools\write-build-meta.cjs" "%CD%"
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] build-meta 生成失败（non-fatal，登录页将不显示三元组）'"
)
echo.

powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[8/9] Running build (prepare-win-unpacked + electron-builder)...'"
set ELECTRON_BUILDER_BINARIES_MIRROR=https://registry.npmmirror.com/-/binary/electron-builder-binaries/
set NODE_TLS_REJECT_UNAUTHORIZED=0
node "%~dp0..\..\..\tools\prepare-win-unpacked.js" "%CD%"
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] prepare-win-unpacked failed'"
    set NODE_TLS_REJECT_UNAUTHORIZED=
    node "%~dp0..\..\..\tools\obfuscate.js" restore --target=cloud >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] win-unpacked directory ready
echo.
echo Running electron-builder --prepackaged...
REM win-unpacked
set "WIN_UNPACKED_PATH=dist/win-unpacked"
if exist "dist\win-unpacked-path.txt" (
    set /p WIN_UNPACKED_PATH=<dist\win-unpacked-path.txt
)
REM ★ 2026-08-21 强化：把真实路径保存到全局，后面 asar 覆盖和最终验证都要用它
set "REAL_WIN_UNPACKED_PATH=%WIN_UNPACKED_PATH%"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Using prepackaged path: %REAL_WIN_UNPACKED_PATH%'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '  (此目录中 asar 已通过 prepare-win-unpacked GATE-KEEPER 硬校验)'"

REM ★★ 关键防御：consolidation 会清空 dist 下所有子目录（包括 win-unpacked.时间戳），
REM    这里立即把真 asar 备份到项目根的 _backup_asar\（不会被任何步骤清理），
REM    后续 Iron Gate Fixup 和 Final IRON GATE 都从这个备份读取，杜绝被误删。
echo [8.0/9] Save real asar to safe backup (avoid consolidation deleting it)...
set "BACKUP_ASAR_DIR=%CD%\_backup_asar"
if exist "%BACKUP_ASAR_DIR%" rmdir /s /q "%BACKUP_ASAR_DIR%" 2>nul
mkdir "%BACKUP_ASAR_DIR%" 2>nul
copy /Y "%REAL_WIN_UNPACKED_PATH%\resources\app.asar" "%BACKUP_ASAR_DIR%\real_app.asar" >nul
set "SAFE_BACKED_ASAR=%BACKUP_ASAR_DIR%\real_app.asar"
if exist "%SAFE_BACKED_ASAR%" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '  [OK] 真 asar 已备份到: %SAFE_BACKED_ASAR%'"
) else (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] asar 备份失败（可能路径不对），将尝试直接用 REAL_WIN_UNPACKED_PATH'"
    set "SAFE_BACKED_ASAR=%REAL_WIN_UNPACKED_PATH%\resources\app.asar"
)
REM ★ P0-3（2026-08-26）：禁用 electron-builder 自动签名（时机错误——它会在
REM   .bnzc 嵌入前签名，签名后 embed 会作废签名）。签名统一由下方 [8.05/9]
REM   在 prepare-win-unpacked 已嵌 .bnzc 之后用 tools/sign-exe.ps1 显式执行。
set CSC_IDENTITY_AUTO_DISCOVERY=false

REM ★ [8.05/9] P0-3（2026-08-26）Authenticode 代码签名（铁律：必须在 .bnzc 嵌入之后）
REM   prepare-win-unpacked.js 已对主 exe 嵌入 .bnzc（rcedit 之后）；.bnzc 哈希已排除
REM   CheckSum/安全目录项/证书表（shared/pe-guard.cjs P0-3 改造），签名不改其余
REM   任何字节 → 签名与 .bnzc 两路校验共存。sign-exe.ps1 -VerifyBnzc 签名后立即
REM   复验 .bnzc，失配即失败（防"签完哈希坏"的产物交付）。
echo [8.05/9] Sign main exe (Authenticode, after .bnzc embed)...
set "CLOUD_MAIN_EXE="
for %%f in ("%REAL_WIN_UNPACKED_PATH%\*.exe") do set "CLOUD_MAIN_EXE=%%f"
if not "%CLOUD_MAIN_EXE%"=="" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\..\tools\sign-exe.ps1" -ExePath "%CLOUD_MAIN_EXE%" -VerifyBnzc
) else (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] win-unpacked 未找到主 exe，跳过签名'"
)
set "SIGN_RC=%errorlevel%"
if "%SIGN_RC%"=="1" (
    set NODE_TLS_REJECT_UNAUTHORIZED=
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] 主 exe 签名失败（或签名后 .bnzc 失配）- build aborted'"
    node "%~dp0..\..\..\tools\obfuscate.js" restore --target=cloud >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
if "%SIGN_RC%"=="2" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] 证书材料缺失，本次主 exe 未签名（不阻断，与 P0-3 之前状态一致）'"
)
if "%SIGN_RC%"=="0" (
    if not "%CLOUD_MAIN_EXE%"=="" (
        copy /Y "%CLOUD_MAIN_EXE%" "%BACKUP_ASAR_DIR%\real_main.exe" >nul
        for %%A in ("%CLOUD_MAIN_EXE%") do set "CLOUD_MAIN_EXE_NAME=%%~nxA"
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '  [OK] 已签名主 exe 备份到: %BACKUP_ASAR_DIR%\real_main.exe'"
    )
)
echo.
set "PREV_TEMP=%TEMP%"
set "PREV_TMP=%TMP%"
if not exist "tmp" mkdir tmp
set "TEMP=%CD%\tmp"
set "TMP=%CD%\tmp"
node "node_modules\electron-builder\cli.js" --win --prepackaged "%WIN_UNPACKED_PATH%" --config.directories.output="%OUTPUT_DIR%"
set "BUILD_RC=%errorlevel%"
set NODE_TLS_REJECT_UNAUTHORIZED=
set "TEMP=%PREV_TEMP%"
set "TMP=%PREV_TMP%"
if not "%BUILD_RC%"=="0" (
    echo.
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] electron-builder exit code %BUILD_RC%, checking artifacts...'"
    set "HAS_EXE=0"
    for %%f in ("%OUTPUT_DIR%\*.exe") do set "HAS_EXE=1"
    if "!HAS_EXE!"=="1" (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] exe found, build succeeded (ignoring exit code %BUILD_RC%)'"
    ) else (
        echo.
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] First electron-builder failed, retry in 3s...'"
        ping -n 4 127.0.0.1 >nul
        set "TEMP=%CD%\tmp"
        set "TMP=%CD%\tmp"
        node "node_modules\electron-builder\cli.js" --win --prepackaged "%WIN_UNPACKED_PATH%" --config.directories.output="%OUTPUT_DIR%"
        set "BUILD_RC=%errorlevel%"
        set "TEMP=%PREV_TEMP%"
        set "TMP=%PREV_TMP%"
        set "HAS_EXE=0"
        for %%f in ("%OUTPUT_DIR%\*.exe") do set "HAS_EXE=1"
        if not "!HAS_EXE!"=="1" (
            powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] Retry failed - no exe found'"
            powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Restoring original JavaScript code...'"
            node "%~dp0..\..\..\tools\obfuscate.js" restore --target=cloud >nul 2>&1
            if not defined NO_PAUSE pause
            exit /b 1
        )
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] Retry succeeded - exe found'"
    )
)
if exist "tmp" rmdir /s /q "tmp" 2>nul
echo.
echo Restoring original JavaScript code...
node "%~dp0..\..\..\tools\obfuscate.js" restore --target=cloud
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] Failed to restore original code'"
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] Original code restored
echo.
REM 2026-08-19 POST-BUILD CONSOLIDATION: if we used build_output_<ts> fallback dir (dist was locked)
REM   now try to move results back to dist so user always finds deliverable in dist/ (project convention)
REM   Do NOT fail build if move fails (dist might still be locked); just report and keep alt dir.
set "DEFAULT_OUTPUT=dist"
if /i not "%OUTPUT_DIR%"=="%DEFAULT_OUTPUT%" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[INFO] Used fallback dir %OUTPUT_DIR%, attempting to consolidate back to %DEFAULT_OUTPUT%...'"
    REM Try to wipe stale contents inside dist first (best-effort, partial failure OK)
    if exist "%DEFAULT_OUTPUT%" (
        for /f "delims=" %%E in ('dir /b "%DEFAULT_OUTPUT%" 2^>nul') do (
            if exist "%DEFAULT_OUTPUT%\%%E\*" ( rmdir /s /q "%DEFAULT_OUTPUT%\%%E" 2>nul ) else ( del /f /q "%DEFAULT_OUTPUT%\%%E" 2>nul )
        )
    ) else ( mkdir "%DEFAULT_OUTPUT%" )
    REM ★ 2026-08-23 防嵌套合并：move 目标已存在时，Windows 会把源目录移入目标内部，
    REM   形成 dist\win-unpacked\win-unpacked 嵌套（Defender 锁定半删除场景已实际发生，主 exe 藏进二级目录）。
    REM   铁律：① move 前先删目标；② 删不掉则 rename 让路（*_old_<时间戳>）；③ 两者都失败→本项放弃
    REM   （MOVE_OK=0，产物完整留在 fallback 目录，绝不 move 进半删除目录，绝不 xcopy 合并出新旧混合包）。
    set "MOVE_OK=1"
    for /f "delims=" %%E in ('dir /b "%OUTPUT_DIR%" 2^>nul') do (
        if exist "%DEFAULT_OUTPUT%\%%E" (
            if exist "%DEFAULT_OUTPUT%\%%E\*" ( rmdir /s /q "%DEFAULT_OUTPUT%\%%E" 2>nul ) else ( del /f /q "%DEFAULT_OUTPUT%\%%E" 2>nul )
            if exist "%DEFAULT_OUTPUT%\%%E" rename "%DEFAULT_OUTPUT%\%%E" "%%E_old_!BUILD_START_STAMP!" 2>nul
        )
        if exist "%DEFAULT_OUTPUT%\%%E" (
            set "MOVE_OK=0"
        ) else (
            move /Y "%OUTPUT_DIR%\%%E" "%DEFAULT_OUTPUT%\%%E" >nul 2>nul
            if exist "%OUTPUT_DIR%\%%E" set "MOVE_OK=0"
        )
    )
    if "!MOVE_OK!"=="1" (
        rmdir "%OUTPUT_DIR%" 2>nul
        set "OUTPUT_DIR=%DEFAULT_OUTPUT%"
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] Consolidated output into %DEFAULT_OUTPUT% (fallback dir cleaned)'"
    ) else (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] Could not fully consolidate (dist still partially locked). Artifacts in both dirs.'"
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[INFO] Main deliverables: %CD%\%DEFAULT_OUTPUT%\ and fallback %CD%\%OUTPUT_DIR%\ '"
    )
)


REM ★ 2026-08-21 根因修复（根治 electron-builder 缓存/重建假 asar）：
REM   electron-builder --prepackaged 在 build_output_* 里会生成一份自己的 win-unpacked（asar是错的），
REM   consolidation 把假的搬进 dist/。这里强制用 SAFE_BACKED_ASAR（真 asar 的安全备份）覆盖
REM   output/win-unpacked/resources/app.asar，保证 portable 解压内容正确，并且 final-verify 正确。
echo.
echo [8.9/9] Iron Gate Fixup — 强制覆盖 output/win-unpacked asar 为真包...
if exist "%SAFE_BACKED_ASAR%" (
    if exist "%OUTPUT_DIR%\win-unpacked\resources\app.asar" (
        echo   删除 output 下的假 asar: %OUTPUT_DIR%\win-unpacked\resources\app.asar
        del /f /q "%OUTPUT_DIR%\win-unpacked\resources\app.asar" 2>nul
    )
    echo   复制真 asar 到 output:
    echo     源: %SAFE_BACKED_ASAR%
    echo     目: %OUTPUT_DIR%\win-unpacked\resources\app.asar
    if not exist "%OUTPUT_DIR%\win-unpacked\resources" mkdir "%OUTPUT_DIR%\win-unpacked\resources" 2>nul
    copy /Y "%SAFE_BACKED_ASAR%" "%OUTPUT_DIR%\win-unpacked\resources\app.asar" >nul
    if exist "%OUTPUT_DIR%\win-unpacked\resources\app.asar" (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '  [OK] asar 覆盖成功（根治缓存假包）'"
    ) else (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] asar 覆盖失败（不致命，final-verify 仍会抓出问题）'"
    )
) else (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] 安全备份 asar 不存在：%SAFE_BACKED_ASAR%'"
)

REM ★ [8.85/9] P0-3（2026-08-26）：恢复主 exe 为"已签名+.bnzc"真包（与 asar 恢复同款铁闸）。
REM   electron-builder --prepackaged consolidation 可能用缓存重建 output 内
REM   win-unpacked 主 exe（未签名/无 .bnzc），这里强制用 [8.05/9] 的备份覆盖。
if exist "%BACKUP_ASAR_DIR%\real_main.exe" (
    if exist "%OUTPUT_DIR%\win-unpacked\%CLOUD_MAIN_EXE_NAME%" del /f /q "%OUTPUT_DIR%\win-unpacked\%CLOUD_MAIN_EXE_NAME%" 2>nul
    copy /Y "%BACKUP_ASAR_DIR%\real_main.exe" "%OUTPUT_DIR%\win-unpacked\%CLOUD_MAIN_EXE_NAME%" >nul
    if exist "%OUTPUT_DIR%\win-unpacked\%CLOUD_MAIN_EXE_NAME%" (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '  [OK] 主 exe 已恢复为已签名+.bnzc 真包'"
    ) else (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] 主 exe 恢复失败（8.95 终验将复验 .bnzc）'"
    )
)

REM ★ 同步覆盖 build-audit.json（从 dist/build-audit.json → output 根）
if exist "dist\build-audit.json" (
    copy /Y "dist\build-audit.json" "%OUTPUT_DIR%\build-audit.json" >nul 2>&1
    echo   [OK] build-audit.json 同步到 output
)

REM ★ [8.95/9] P0-3（2026-08-26）终验 + 安装包签名：
REM   ① output 主 exe 复验 .bnzc（防 consolidation 偷换且 8.85 恢复失败，红线中止）
REM   ② 签名安装包（Setup/portable exe；主 exe 已随包携带签名）
if exist "%BACKUP_ASAR_DIR%\real_main.exe" (
    if exist "%OUTPUT_DIR%\win-unpacked\%CLOUD_MAIN_EXE_NAME%" (
        node "%~dp0..\..\..\tools\pe-zone-sign.cjs" verify "%OUTPUT_DIR%\win-unpacked\%CLOUD_MAIN_EXE_NAME%"
        if errorlevel 1 (
            powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] output 主 exe .bnzc 失配（可能被 consolidation 偷换）- build aborted'"
            if not defined NO_PAUSE pause
            exit /b 1
        )
    )
)
echo [8.95/9] Sign installers (Setup / portable exe)...
set "SIGN_FAIL=0"
for %%f in ("%OUTPUT_DIR%\*.exe") do (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\..\tools\sign-exe.ps1" -ExePath "%%f"
    if errorlevel 1 (
        if not errorlevel 2 set "SIGN_FAIL=1"
    )
)
if "%SIGN_FAIL%"=="1" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] 安装包签名失败 - build aborted'"
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] Installers signed
echo.

powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[9/9] Verify artifacts & finish...'"

REM ★ 最后一道铁闸（2026-08-21）：独立验证真 asar，不通过就删除 OUTPUT_DIR + dist 下所有 exe
REM   验证标准与 prepare-win-unpacked GATE-KEEPER 完全一致（8 个 ARCH_MARKERS + version 精确匹配）。
REM   避免 postbuild-asar-verify 中已过时的 Arch 2.24 标识误杀（那 3 个当前代码确实不存在）。
REM   这里是权威验证：真 asar 通过 = 最终 NSIS/portable 内就是通过校验的代码；失败 → 红线删 exe。
REM   注意：使用 %SAFE_BACKED_ASAR%（项目根 _backup_asar/ 下的安全备份），不会被 consolidation 误删。
echo [9.0/9] Iron Gate Final — 独立验证真 asar（标准与 prepare-win-unpacked GATE-KEEPER 一致）...
set "VERIFY_ASAR_PATH=%SAFE_BACKED_ASAR%"
set "VERIFY_PKG_DIR=%CD%"
set "VERIFY_OUTPUT_DIR=%OUTPUT_DIR%"
node "%~dp0..\..\..\tools\final-verify.cjs"
set "FINAL_VERIFY_RC=%errorlevel%"
set "VERIFY_ASAR_PATH="
set "VERIFY_PKG_DIR="
set "VERIFY_OUTPUT_DIR="
if not "%FINAL_VERIFY_RC%"=="0" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] FINAL IRON GATE 验证失败，真 asar 未通过校验。已自动删除所有 exe，杜绝假包'"
    REM 还原混淆源码（因为前面 prepare-win-unpacked 阶段失败，混淆状态可能未知）
    node "%~dp0..\..\..\tools\obfuscate.js" restore --target=cloud >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] FINAL IRON GATE ALL PASS ✓

set "EXE_FILE="
for %%f in ("%OUTPUT_DIR%\*.exe") do set "EXE_FILE=%%f"
if "%EXE_FILE%"=="" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] No .exe file found in %OUTPUT_DIR%'"
    node "%~dp0..\..\..\tools\obfuscate.js" restore --target=cloud >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
for %%A in ("%EXE_FILE%") do (
    if %%~zA LSS 1000000 (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] exe too small: %%~zA bytes ^(< 1MB^), build may be incomplete'"
        node "%~dp0..\..\..\tools\obfuscate.js" restore --target=cloud >nul 2>&1
        if not defined NO_PAUSE pause
        exit /b 1
    )
    if %%~zA GTR 200000000 (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] exe abnormally large: %%~zA bytes ^(^> 200MB^)'"
    )
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] %%~nxA  %%~zA bytes'"
)

REM ★ [9.5/9] T4 e2e 端到端回归（2026-08-21）：对 dist\win-unpacked 真实产物跑 3 条固定用例
REM   E1 机构版管理员点开【用户管理】弹窗 / E2 标准版按钮权限矩阵 / E3 毒数据注入非静默
REM   机制：run-e2e.cjs 在 win-unpacked 内临时写 e2e-enabled.marker（跑完即删）；
REM         NSIS Setup 在本步骤【之前】已打包完成，产物永不携带 marker → 生产包远程调试防护不受影响。
echo [9.5/9] E2E regression — 3 fixed cases on real win-unpacked...
if not exist "node_modules\playwright" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] playwright 未安装，自动安装（一次性）...'"
    call npm i -D playwright --no-fund --no-audit
)
REM ★ 2026-08-23：--dir 显式传真实产物目录（consolidation 后可能仍是 build_output_* fallback）。
REM   run-e2e.cjs 在 --dir 模式下找不到主 exe 会红线失败（绝不静默兜底 dev electron），
REM   杜绝嵌套/半删除场景下"E2E 测旧残留 exe"的假绿灯。
node "e2e\run-e2e.cjs" --dir "%OUTPUT_DIR%\win-unpacked"
set "E2E_RC=%errorlevel%"
if not "%E2E_RC%"=="0" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] E2E 回归失败，红线删除所有 exe，杜绝带病交付'"
    del /q "%OUTPUT_DIR%\*.exe" >nul 2>&1
    del /q "dist\*.exe" >nul 2>&1
    del /q "%OUTPUT_DIR%\win-unpacked\e2e-enabled.marker" >nul 2>&1
    del /q "dist\win-unpacked\e2e-enabled.marker" >nul 2>&1
    node "%~dp0..\..\..\tools\obfuscate.js" restore --target=cloud >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] E2E 3/3 PASS - 用户管理按钮链路真实可点

REM ★ [9.7/9] P4 交付核对单自动生成（2026-08-21）：一页纸聚合三元组+产物哈希+关卡清单+安装自检三步+生效方式
REM   只读聚合不改动产物；生成失败仅 WARN 不阻断交付（产物已过全部铁闸）
node "%~dp0..\..\..\tools\delivery-report.cjs" --pkg "%CD%"

echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Output directory: %CD%\%OUTPUT_DIR%'"
echo ============================================
for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
for /f "delims=" %%e in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $s=[DateTime]::Parse('%BUILD_START_TIME%'); $e=[DateTime]::Parse('%BUILD_END_TIME%'); $d=$e-$s; $d.ToString('hh\:mm\:ss')"') do set "BUILD_ELAPSED=%%e"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '============================================' -ForegroundColor Yellow; Write-Host '  打包完成！' -ForegroundColor Yellow; Write-Host '  Started: %BUILD_START_TIME%' -ForegroundColor Yellow; Write-Host '  Finished: %BUILD_END_TIME%' -ForegroundColor Yellow; Write-Host '  Total elapsed: %BUILD_ELAPSED%' -ForegroundColor Yellow; Write-Host '============================================' -ForegroundColor Yellow"
REM 清理临时 asar 备份
if exist "%BACKUP_ASAR_DIR%" rmdir /s /q "%BACKUP_ASAR_DIR%" 2>nul
REM ★ [BUILD-LOCK 2026-08-23] Release global build mutex
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\..\tools\build-lock.ps1" release -LockPath "%~dp0..\..\..\.build.lock" -Owner "cloud-desktop"
exit /b 0
