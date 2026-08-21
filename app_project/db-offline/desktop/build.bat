@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Huikang-TCM Build Tool

REM Record start time (for elapsed time stats), use PowerShell instead of deprecated wmic (Win11 deprecated)
for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"
for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyyMMdd_HHmmss'"') do set "BUILD_START_STAMP=%%t"

echo ============================================
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Huikang TCM Offline Desktop Build Tool (Unified)'"
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
REM Kill old version processes that may hold locks (ASCII wildcard match)
taskkill /F /IM "*offline*Setup*.exe" >nul 2>&1
taskkill /F /IM "*Huikang*.exe" >nul 2>&1
REM 2026-08-19 enhanced: kill Chinese-prefixed exe (惠康*.exe), wmic path match
taskkill /F /IM "惠康*.exe" >nul 2>&1
taskkill /F /IM "electron.exe" >nul 2>&1
wmic process where "ExecutablePath like '%%db-offline%%desktop%%' or ExecutablePath like '%%惠康%%'" call Terminate >nul 2>&1
REM Use PowerShell Get-Process (path-based exact match, ASCII safe) - kills processes from dist/build_output dirs
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Process | Where-Object { try { $_.Path -like '*db-offline\desktop\dist*' -or $_.Path -like '*db-offline\desktop\build_output*' } catch { $false } } | Stop-Process -Force -ErrorAction SilentlyContinue" 2>nul
REM wait 2s for handles to be released by AV/minifilter
timeout /t 2 /nobreak >nul
echo [OK] Leftover processes cleaned
echo.

echo [4/9] Configure clinic info...
if defined SKIP_CONFIG (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[SKIP] SKIP_CONFIG env detected, skipping config'"
) else if /i "%1"=="--skip-config" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[SKIP] --skip-config flag detected, skipping config'"
) else (
    powershell -ExecutionPolicy Bypass -File "..\edit-config.ps1" -DesktopDir desktop -AppDir app -AutoConfirm
)
echo.

echo [5/9] Clean old build artifacts...
set "OUTPUT_DIR=dist"

REM clean dist_old_* (keep last 2)
set old_count=0
for /f "delims=" %%D in ('dir /b /ad "dist_old_*" 2^>nul ^| sort /r') do (
    set /a old_count+=1
    if !old_count! gtr 2 (
        rmdir /s /q "%%D" 2>nul
    )
)

REM 2026-08-19 NEW: clean build_output_* (keep last 2, fallback dirs)
set old_count=0
for /f "delims=" %%D in ('dir /b /ad "build_output_*" 2^>nul ^| sort /r') do (
    set /a old_count+=1
    if !old_count! gtr 2 (
        rmdir /s /q "%%D" 2>nul
    )
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
    REM 2026-08-19 fallback: if rename ALSO fails (Defender minifilter lock on app.asar),
    REM   switch to timestamp-isolated output dir build_output_<ts>. Never blocks.
    if exist "%OUTPUT_DIR%" (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] %OUTPUT_DIR% still locked (likely Defender scanning app.asar), switching to alternate output dir build_output_!DSTAMP!...'"
        set "OUTPUT_DIR=build_output_!DSTAMP!"
        if exist "!OUTPUT_DIR!" rmdir /s /q "!OUTPUT_DIR!" 2>nul
    )
)
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"
echo [OK] Output dir ready: %CD%\%OUTPUT_DIR%
echo.

REM 2026-08-19 Add: Unified build-env gate (8-step: Git/BOM/encoding/version/package/cleanup/disk)
REM Place BEFORE bump-version: if identity gate fails, do not waste version bump
echo [5.5/9] Ensure build environment (BOM / encoding / version gate / package integrity / cleanup / disk)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\..\tools\ensure-build-env.ps1" -Target offline-desktop -DesktopDir "%~dp0"
if errorlevel 1 (
    if not defined NO_PAUSE pause
    exit /b 1
)
echo.

powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[6/9] Auto-bump version (triggers integrity baseline rebuild)...'"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\..\tools\bump-version.ps1" -PackagePath "%CD%\package.json"
echo.

powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[7/9] Code obfuscation (target=dingzhi, may take 1-2 min)...'"
node "%~dp0..\..\..\tools\obfuscate.js" --target=dingzhi
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] Code obfuscation failed'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Restoring original files...'"
    node "%~dp0..\..\..\tools\obfuscate.js" restore --target=dingzhi >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] Code obfuscation complete
echo.

REM ★ 铁闸4/5（2026-08-21 同步自云端 B2 推广）：写入 build-meta.json — 登录页/主界面版本自证三元组
REM   登录页/主界面顶端会显示 Vx.x.xx | Build 时间 | Arch 2.xx，用户一眼能对照真假包
echo [7.5/9] Iron Gate #4 / #5 — Write build-meta.json (version-triple for login page)...
node "%~dp0..\..\..\tools\write-build-meta.cjs" "%CD%"
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] build-meta 生成失败（non-fatal，登录页将不显示三元组）'"
)
echo.

powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[8/9] Running build (two-phase: --dir + final .bnzc embed + --prepackaged)...'"
set ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://registry.npmmirror.com/-/binary/electron-builder-binaries/
REM better-sqlite3 prebuild-install GitHub Releases SSL
REM TLS prebuild-install electron ABI
REM pfx package.json certificateFile

REM TEMP tmp/ C: /
set "PREV_TEMP=%TEMP%"
set "PREV_TMP=%TMP%"
if not exist "tmp" mkdir tmp
set "TEMP=%CD%\tmp"
set "TMP=%CD%\tmp"

REM ============================================================================
REM 2026-08-19 Two-phase build (fix .bnzc hash invalidated by rcedit):
REM electron-builder order = copy exe -> afterPack(embed .bnzc, hash OK) ->
REM rcedit(icon/version writes exe -> hash broken). Old single npm run build
REM produced Setup with mismatched .bnzc. New flow:
REM   Phase 1: --dir only (afterPack + rcedit complete, exe final)
REM   Phase 2: embed+verify .bnzc on final exe (blocking gate)
REM   Phase 3: --prepackaged builds nsis+portable from the embedded exe
REM ============================================================================
set NODE_TLS_REJECT_UNAUTHORIZED=0
REM 2026-08-19: pass OUTPUT_DIR explicitly (supports build_output_<ts> fallback when dist locked)
node "node_modules\electron-builder\cli.js" --win --dir --config.directories.output="%OUTPUT_DIR%"
set "BUILD_RC=%errorlevel%"
if not "%BUILD_RC%"=="0" (
    echo.
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] Phase 1 (--dir) failed, retry in 3s...'"
    timeout /t 3 /nobreak >nul
    set "TEMP=%CD%\tmp"
    set "TMP=%CD%\tmp"
    node "node_modules\electron-builder\cli.js" --win --dir --config.directories.output="%OUTPUT_DIR%"
    set "BUILD_RC=%errorlevel%"
)

if not "%BUILD_RC%"=="0" (
    set NODE_TLS_REJECT_UNAUTHORIZED=
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] Phase 1 (--dir) build failed, see logs above'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Restoring original JavaScript code...'"
    node "%~dp0..\..\..\tools\obfuscate.js" restore --target=dingzhi >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] Phase 1 complete: win-unpacked ready (rcedit applied)
echo.

echo Running final .bnzc integrity embed (post-rcedit)...
set "MAIN_EXE="
for %%f in ("%OUTPUT_DIR%\win-unpacked\*.exe") do set "MAIN_EXE=%%f"
if "%MAIN_EXE%"=="" (
    set NODE_TLS_REJECT_UNAUTHORIZED=
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] Main exe not found in %OUTPUT_DIR%\win-unpacked'"
    node "%~dp0..\..\..\tools\obfuscate.js" restore --target=dingzhi >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
node "%~dp0..\..\..\tools\pe-zone-sign.cjs" embed "%MAIN_EXE%"
if errorlevel 1 (
    set NODE_TLS_REJECT_UNAUTHORIZED=
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] .bnzc final embed failed - build aborted'"
    node "%~dp0..\..\..\tools\obfuscate.js" restore --target=dingzhi >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
node "%~dp0..\..\..\tools\pe-zone-sign.cjs" verify "%MAIN_EXE%"
if errorlevel 1 (
    set NODE_TLS_REJECT_UNAUTHORIZED=
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] .bnzc verify gate failed - build aborted'"
    node "%~dp0..\..\..\tools\obfuscate.js" restore --target=dingzhi >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] .bnzc embedded and verified on final exe
echo.

REM ★★ 铁闸6-A（B2 2026-08-21 同步自云端根治方案）：asar安全备份
REM    electron-builder --prepackaged / consolidation 会重建 output/win-unpacked 并搬入假 asar，
REM    这里立即把 Phase 1+2 产出的真 asar 备份到项目根的 _backup_asar\（不会被任何步骤清理），
REM    后续 Fixup 和 Final GATE 都从这个备份读取，杜绝被误删或覆盖回旧缓存。
echo [8.0/9] Save real asar to safe backup (avoid consolidation deleting it)...
set "BACKUP_ASAR_DIR=%CD%\_backup_asar"
if exist "%BACKUP_ASAR_DIR%" rmdir /s /q "%BACKUP_ASAR_DIR%" 2>nul
mkdir "%BACKUP_ASAR_DIR%" 2>nul
copy /Y "%OUTPUT_DIR%\win-unpacked\resources\app.asar" "%BACKUP_ASAR_DIR%\real_app.asar" >nul
set "SAFE_BACKED_ASAR=%BACKUP_ASAR_DIR%\real_app.asar"
if exist "%SAFE_BACKED_ASAR%" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '  [OK] 真 asar 已备份到: %SAFE_BACKED_ASAR%'"
) else (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] asar 备份失败（路径不对或尚未生成），将尝试直接用 OUTPUT_DIR 下的 asar'"
    set "SAFE_BACKED_ASAR=%OUTPUT_DIR%\win-unpacked\resources\app.asar"
)
echo.

echo Running electron-builder --prepackaged (nsis + portable)...
node "node_modules\electron-builder\cli.js" --win --prepackaged "%OUTPUT_DIR%/win-unpacked" --config.directories.output="%OUTPUT_DIR%"
set "BUILD_RC=%errorlevel%"
set NODE_TLS_REJECT_UNAUTHORIZED=

if not "%BUILD_RC%"=="0" (
    echo.
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] Phase 3 (--prepackaged) failed, retry in 3s...'"
    timeout /t 3 /nobreak >nul
    set NODE_TLS_REJECT_UNAUTHORIZED=0
    set "TEMP=%CD%\tmp"
    set "TMP=%CD%\tmp"
    node "node_modules\electron-builder\cli.js" --win --prepackaged "%OUTPUT_DIR%/win-unpacked" --config.directories.output="%OUTPUT_DIR%"
    set "BUILD_RC=%errorlevel%"
    set NODE_TLS_REJECT_UNAUTHORIZED=
)

if not "%BUILD_RC%"=="0" (
    echo.
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] Phase 3 (--prepackaged) build failed, see logs above'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Restoring original JavaScript code...'"
    node "%~dp0..\..\..\tools\obfuscate.js" restore --target=dingzhi >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)

REM ★ 铁闸6-B（B2 2026-08-21 根治 electron-builder 缓存/重建假 asar）：
REM   electron-builder --prepackaged 会重建自己的 output 内 win-unpacked/resources/app.asar（假的，未过 Gate），
REM   这里强制用 SAFE_BACKED_ASAR（真 asar 的安全备份）覆盖 %OUTPUT_DIR%\win-unpacked\resources\app.asar，
REM   根治 consolidation 阶段把假 asar 搬进 dist/。
echo.
echo [8.9/9] Iron Gate Fixup — 强制覆盖 output/win-unpacked asar 为真包...
if exist "%SAFE_BACKED_ASAR%" (
    if exist "%OUTPUT_DIR%\win-unpacked\resources\app.asar" (
        echo   删除 output 下的假 asar: %OUTPUT_DIR%\win-unpacked\resources\app.asar
        del /f /q "%OUTPUT_DIR%\win-unpacked\resources\app.asar" 2>nul
        echo %OUTPUT_DIR%\win-unpacked\resources\app.asar
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
echo.

REM TEMP
set "TEMP=%PREV_TEMP%"
set "TMP=%PREV_TMP%"
if exist "tmp" rmdir /s /q "tmp" 2>nul

if not "%BUILD_RC%"=="0" (
    echo.
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] Build failed, see logs above'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Restoring original JavaScript code...'"
    node "%~dp0..\..\..\tools\obfuscate.js" restore --target=dingzhi >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
echo.

powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[9/9] Verify artifacts & finish...'"
echo Artifact integrity verification...
set "EXE_FILE="
for %%f in ("%OUTPUT_DIR%\*.exe") do set "EXE_FILE=%%f"
if "%EXE_FILE%"=="" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] No .exe file found in %OUTPUT_DIR%'"
    if not defined NO_PAUSE pause
    exit /b 1
)
for %%A in ("%EXE_FILE%") do (
    if %%~zA LSS 1000000 (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] exe too small: %%~zA bytes ^(< 1MB^), build may be incomplete'"
        if not defined NO_PAUSE pause
        exit /b 1
    )
    if %%~zA GTR 200000000 (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] exe abnormally large: %%~zA bytes ^(^> 200MB^)'"
    )
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] %%~nxA  %%~zA bytes'"
)
echo.
echo Restoring original JavaScript code...
node "%~dp0..\..\..\tools\obfuscate.js" restore --target=dingzhi
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] Failed to restore original code! Source may still be obfuscated.'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Please run manually: node "%~dp0..\..\..\tools\obfuscate.js" restore --target=dingzhi'
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

REM ★ 最后一道铁闸7（B2 2026-08-21 推广至离线版）：独立验证真 asar
REM   使用 SAFE_BACKED_ASAR（项目根 _backup_asar/ 下的安全备份，不会被 consolidation 误删）。
REM   验证标准：8 个 ARCH_MARKERS + package.json version 精确匹配 + build-meta 三元组。
REM   失败 → 红线删除所有 exe，杜绝假包交付。
echo.
echo [9.5/9] Iron Gate Final — 独立验证真 asar（与云端一致标准：8 markers + version + build-meta 三元组）...
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
    REM 确保源码还原（失败路径上可能仍处于混淆态）
    node "%~dp0..\..\..\tools\obfuscate.js" restore --target=dingzhi >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] FINAL IRON GATE ALL PASS ✓ — 7 道铁闸全部生效（离线版）
echo.

REM ★ [9.6/9] P3 e2e 端到端回归（2026-08-21，与云端版同款红线设计）：
REM   E1 本地账号明文登录链路 / E2 试用期强制标准版反向断言 / E3 毒数据 UserStore 兜底
REM   机制：run-e2e.cjs 在 win-unpacked 内临时写 e2e-enabled.marker（跑完即删）；
REM         NSIS Setup 在本步骤【之前】已打包完成，产物永不携带 marker → 生产包远程调试防护不受影响。
echo [9.6/9] E2E regression — 3 fixed offline cases on real win-unpacked...
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
    node "%~dp0..\..\..\tools\obfuscate.js" restore --target=dingzhi >nul 2>&1
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] E2E 3/3 PASS - 离线登录/试用期降级/UserStore 兜底真实可点
echo.

powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Output directory: %CD%\%OUTPUT_DIR%'"
echo ============================================
if exist "dist_old_*" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[INFO] Old artifacts saved as dist_old_* directories'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Will auto-clean on future builds (keep last 2 only)'"
)
if exist "build_output_*" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[INFO] Fallback build_output_* dirs may linger if dist locked long; auto-clean keeps last 2'"
)

for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
for /f "delims=" %%e in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $s=[DateTime]::Parse('%BUILD_START_TIME%'); $e=[DateTime]::Parse('%BUILD_END_TIME%'); $d=$e-$s; $d.ToString('hh\:mm\:ss')"') do set "BUILD_ELAPSED=%%e"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '============================================' -ForegroundColor Yellow; Write-Host '  打包完成！' -ForegroundColor Yellow; Write-Host '  Started: %BUILD_START_TIME%' -ForegroundColor Yellow; Write-Host '  Finished: %BUILD_END_TIME%' -ForegroundColor Yellow; Write-Host '  Total elapsed: %BUILD_ELAPSED%' -ForegroundColor Yellow; Write-Host '============================================' -ForegroundColor Yellow"
if not defined NO_PAUSE (
    set "EXIT_KEY="
    set /p "EXIT_KEY=Press 0 or Enter to exit: "
)

exit /b 0

