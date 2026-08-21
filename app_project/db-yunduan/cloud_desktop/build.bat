@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Huikang-TCM Build Tool

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
timeout /t 2 /nobreak >nul
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
REM pfx package.json certificateFile
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
        timeout /t 3 /nobreak >nul
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
    REM Move all files+dirs from OUTPUT_DIR -> DEFAULT_OUTPUT (robocopy-style move)
    set "MOVE_OK=1"
    for /f "delims=" %%E in ('dir /b "%OUTPUT_DIR%" 2^>nul') do (
        move /Y "%OUTPUT_DIR%\%%E" "%DEFAULT_OUTPUT%\%%E" >nul 2>nul
        if errorlevel 1 (
            REM move failed: try copy + delete fallback for directories
            if exist "%OUTPUT_DIR%\%%E\*" (
                xcopy /E /I /Y /Q "%OUTPUT_DIR%\%%E" "%DEFAULT_OUTPUT%\%%E" >nul 2>nul
                if exist "%DEFAULT_OUTPUT%\%%E" ( rmdir /s /q "%OUTPUT_DIR%\%%E" 2>nul ) else ( set "MOVE_OK=0" )
            ) else ( set "MOVE_OK=0" )
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

REM ★ 同步覆盖 build-audit.json（从 dist/build-audit.json → output 根）
if exist "dist\build-audit.json" (
    copy /Y "dist\build-audit.json" "%OUTPUT_DIR%\build-audit.json" >nul 2>&1
    echo   [OK] build-audit.json 同步到 output
)

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
node "e2e\run-e2e.cjs"
set "E2E_RC=%errorlevel%"
if not "%E2E_RC%"=="0" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] E2E 回归失败，红线删除所有 exe，杜绝带病交付'"
    del /q "%OUTPUT_DIR%\*.exe" >nul 2>&1
    del /q "dist\*.exe" >nul 2>&1
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
if not defined NO_PAUSE (
    set "EXIT_KEY="
    set "EXIT_KEY="
    set /p "EXIT_KEY=Press 0 or Enter to exit: "
)
exit /b 0
