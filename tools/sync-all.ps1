# ============================================================================
#  sync-all.ps1 - Unified sync script for all shared modules
#
#  Purpose:
#    Single entry point to sync shared/ to ALL distribution directories.
#    Replaces: sync-all.bat, sync-auth-core.ps1, sync-license.ps1,
#              sync-offline-files.ps1
#
#  Usage:
#    cd D:\trae_projects\kyt-zy
#    .\tools\sync-all.ps1              # Sync all
#    .\tools\sync-all.ps1 -VerifyOnly  # Check only (exit 1 if out of sync)
#
#  Source: shared/ (unified master directory)
#  Targets: 13+ distribution directories (cloud + offline)
#  Cross-platform: Works on Windows (powershell) and Linux (pwsh, for CI)
# ============================================================================
#Requires -Version 5.0
[CmdletBinding()]
param(
    [switch]$VerifyOnly = $false
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$SharedDir = Join-Path $ProjectRoot 'shared'

# ============================================================================
# Configuration: file groups and their sync targets
# Note: Use forward slashes (/) in paths for cross-platform compatibility
#       (PowerShell on Windows and Linux both accept / as separator)
# ============================================================================

# Group 1: 8 business JS files (cloud + offline)
# ★ 2026-08-16: auth-core.js REMOVED from this group.
#   Root cause of the 2026-08 drift: auth-core.js has TWO content versions
#   (offline=trial+heartbeat / cloud=validate), and this single-source group
#   pushed the cloud copy from shared/ onto OFFLINE targets, silently
#   removing trial-enforced-standard-edition logic.
#   auth-core.js is now managed ONLY by tools/sync-auth-core.ps1
#   (dual fact source: shared/auth-core/offline.js + cloud.js).
# ★ 2026-08-28: print-utils.js REMOVED from this group (same dual-source
#   pattern as auth-core.js). Offline copies intentionally keep the full
#   product title (惠康中医诊所管理系统 V1.0.0-打印预览/药材清单打印预览,
#   per commit eb0e7b2c "软著申请后恢复" 有意保留项), while cloud copies use
#   the short title (打印处方/药材清单). Now managed by Group 1b/1c below:
#     cloud  -> shared/print-utils.js        (unchanged, short title)
#     offline-> shared/print-utils-offline.js(full product title)
# ★ 2026-09-11: stock-core.js 纳入本组（药品库存管理核心）。注意：本组目标不含
#   云端APP assets 与鸿蒙 rawfile 两处副本（手工维护），由 copy-consistency.cjs
#   的 stock-core 专用组全量校验（8 副本），漂移在 pre-push 第⑦道门拦截。
# ★ 2026-09-13 P2-A1: db-adapter.js / patient-archive.js 已删除（全端零消费死模块，
#   33 轮触点审计确认无任何运行时引用；历史同步/混淆/热更/打包链一并移除）。
$BusinessJsFiles = @(
    'debug-logger.js',
    'medicine-dict.js',
    'symptom-dict.js',
    'performance-utils.js',
    'permission.js',
    'prescription-core.js',
    'stock-core.js',
    'security-guard.js'
)

# 10 directories for business JS (cloud + offline root + app assets)
$BusinessJsTargets = @(
    'public',
    'public/electron',
    'app_project/db-yunduan/cloud_desktop',
    'app_project/db-yunduan/cloud_desktop/electron',
                'app_project/db-offline/desktop',
        'app_project/db-offline/app/app/src/main/assets/public'
)

# Group 1b: print-utils.js (cloud version, short title) -> 4 cloud dirs
$PrintUtilsCloudTargets = @(
    'public',
    'public/electron',
    'app_project/db-yunduan/cloud_desktop',
    'app_project/db-yunduan/cloud_desktop/electron',
    # ★ 2026-09-15 补缺口：云APP assets 此前漏在清单外（伪权威源漂移，旧版
    #   min-height:100vh 一直滞留），与 UI logic 组对齐纳入
    'app_project/db-yunduan/cloud_app/app/src/main/assets/public'
)

# Group 1c: print-utils-offline.js (full product title) -> 2 offline dirs
#   Source file: shared/print-utils-offline.js -> distributed AS print-utils.js
$PrintUtilsOfflineTargets = @(
    'app_project/db-offline/desktop',
    'app_project/db-offline/app/app/src/main/assets/public'
)

# Group 1e: UI logic (button-manager.js, edition-lock.js) -> 5 dirs
#   ★ 2026-08-29: 这两个文件此前在 shared/ 中却未纳入任何同步分组（伪权威源），
#     依赖手工复制到各端副本。经 SHA256 摸底全端当前一致（无本地化差异），
#     现正式纳管。目标不含各端 electron/ 子目录：index.html 均从根目录
#     （或 APP assets/public）加载这两个文件，electron/ 下无引用无副本，
#     不制造冗余文件。
$UiLogicFiles = @(
    'button-manager.js',
    'edition-lock.js'
)

$UiLogicTargets = @(
    'public',
    'app_project/db-yunduan/cloud_desktop',
    'app_project/db-offline/desktop',
    'app_project/db-offline/app/app/src/main/assets/public',
    'app_project/db-yunduan/cloud_app/app/src/main/assets/public'
)

# Group 2: permission.js extra targets (3 offline electron/, beyond Group 1)
$PermissionExtraTargets = @(
        'app_project/db-offline/desktop/electron'
)

# Group 3: calculate-hash.js targets (6 offline directories)
$CalculateHashTargets = @(
    'app_project/db-offline',
        'app_project/db-offline/app/app/src/main/assets/public'
)

# Group 4: license files (3 files)
$LicenseFiles = @(
    'license/feature-guard.js',
    'license/license-manager.js',
    'license/prescription-counter.js'
)

# license targets (4 electron/ + 3 root/license/ + 3 nndroidicense/)
$LicenseTargets = @(
    'app_project/db-yunduan/cloud_desktop/electron',
            'app_project/db-offline/desktop/electron',
        'app_project/db-offline/desktop/license',
        'app_project/db-offline/app/app/src/main/assets/public/license'
)

# Group 5: electron/hot-update.js —— 2026-08-26 移除（源文件 shared/electron/hot-update.js
#   已不存在，全仓库无代码引用，仅剩本死配置每次跑出 "[WARN] Source not found" 红字）

# Group 6: res/xml files (3 XML)
$ResXmlFiles = @(
    'res/xml/network_security_config.xml',
    'res/xml/data_extraction_rules.xml',
    'res/xml/file_paths.xml'
)

# res/xml targets (2 app/res/xml/)
$ResXmlTargets = @(
        'app_project/db-offline/app/app/src/main/res/xml'
)

# Group 7: vendor files
$VendorFiles = @(
    'vendor/xlsx.full.min.js'
)

# vendor targets (2 root/vendor/ + 2 app/vendor/)
$VendorTargets = @(
        'app_project/db-offline/desktop/vendor',
        'app_project/db-offline/app/app/src/main/assets/public/vendor'
)

# Group 7b: pinyin-pro vendor（★ 2026-09-17 语音连报修复）-> 3 云端 vendor 目录
#   ASR 同音字（白勺→白芍）拼音归一匹配用，voice-input.js ensurePinyin 运行时
#   动态加载（相对路径 vendor/pinyin-pro.min.js），三云端表面必须随 voice-input
#   同步分发，缺位=拼音容错静默降级。固定版本库文件，内容永不变化。
#   离线端（db-offline）无 Web Speech API（isAvailable=false 永不触达）不分发。
$PinyinVendorTargets = @(
    'public/vendor',
    'app_project/db-yunduan/cloud_desktop/vendor',
    'app_project/db-yunduan/cloud_app/app/src/main/assets/public/vendor'
)

# Group 8: cloud-only modules (cloud-api.js, local-db.js, sync-engine.js)
# 仅同步到云端版目录，离线版不需要这些文件
$CloudModuleFiles = @(
    'cloud-api.js',
    'local-db.js',
    'sync-engine.js'
)

$CloudModuleTargets = @(
    'app_project/db-yunduan/cloud_desktop'
    )

# Group 9: electron-logger.cjs (P0-[6.3] 主进程滚动日志) -> 2 个 electron 目录
# 与 main.js 配套使用：main.js 里 require('./electron-logger.cjs')
# .cjs 后缀确保在根目录 type:module 作用域下仍按 CommonJS 解析
$ElectronLoggerTargets = @(
    'app_project/db-yunduan/cloud_desktop/electron',
    'app_project/db-offline/desktop/electron'
)

# Group 10: pe-guard.cjs (P1-[3.1] PE .bnzc 完整性区段) -> 2 个 electron 目录
# 与 self-check.js 配套使用：self-check.js 里 require('./pe-guard.cjs')
$PeGuardTargets = @(
    'app_project/db-yunduan/cloud_desktop/electron',
    'app_project/db-offline/desktop/electron'
)

# Group 12: update-manager.cjs + hot-update-core.cjs (★ 2026-09-13 P0-1 桌面更新器架构收口；
#   ★ 2026-09-14 新增 hot-update-core.cjs 静默热更新纯逻辑模块，update-manager.cjs 组装)
# 历史：云桌面/离线桌面 main.js 各内嵌 ~200 行同构更新器（仅渠道 URL 不同），
#   靠人肉双改，09-12 /api/dl 代理修复被迫改两处。现抽为唯一权威源。
# 配套：main.js 里 require('./update-manager.cjs')，渠道差异（updates/<cloud|local>/
#   latest.json + 下载页 card 锚点 + hot-update/desktop/<cloud|local>）由 main.js 工厂
#   入参注入，模块本体零差异。hot-update-core.cjs 与 update-manager.cjs 同组同位分发
#   （update-manager 内相对 require('./hot-update-core.cjs') 依赖同目录布局）。
$UpdateManagerTargets = @(
    'app_project/db-yunduan/cloud_desktop/electron',
    'app_project/db-offline/desktop/electron'
)

# Group 14: desktop-fs-ipc.cjs (★ 2026-09-13 B2-1 桌面文件域收口) -> 2 个 electron 目录
#   媒体保存/查找/重命名、备份读写/一键恢复、用户数据落盘、路径白名单等文件域
#   40 项函数/IPC 从双 main.js 等体抽取（原各内嵌 ~650 行，历史靠人工双刷）。
#   配套：main.js require('./desktop-fs-ipc.cjs') 工厂入参注入 electron API，
#   模块本体零差异；改文件域只改本权威源。
$DesktopFsIpcTargets = @(
    'app_project/db-yunduan/cloud_desktop/electron',
    'app_project/db-offline/desktop/electron'
)

# Group 15: desktop-windows.cjs (★ 2026-09-13 B2-2 桌面窗口域收口) -> 2 个 electron 目录
#   focusWindow/getSharedWebPrefs/installDevToolsGuard/injectVideoRecorder/
#   createMainWindow/createLoginWindow 6 函数从双 main.js 等体抽取（原各内嵌
#   ~322 行，历史靠人工双刷）。与 B2-1 的差异点——窗口域有状态：
#   mainWindow/loginWindow/currentLoggedInUser 仍是 main.js 模块级变量，
#   模块经访问器（get/set）读写，体外引用零改动。
#   配套：main.js require('./desktop-windows.cjs') createDesktopWindows 工厂注入。
$DesktopWindowsTargets = @(
    'app_project/db-yunduan/cloud_desktop/electron',
    'app_project/db-offline/desktop/electron'
)

# Group 17: desktop-dialog.cjs + prompt-modal.html + prompt-preload.js (★ 2026-09-14 P3-A 桌面对话框域收口)
#   -> 2 个 electron 目录。dialog:alert-sync / dialog:confirm-sync / dialog:prompt
#   三 handler 从双 main.js 等体抽取（双端除 prompt 窗 title 外字节级同体，
#   title 经工厂 promptTitle 入参注入端差异）。prompt-modal.html 双端 <title>
#   统一为"请输入"（小输入窗标题无功能影响）；prompt-preload.js 三份归一
#   （tools/ 下零引用副本已删）。三文件同组同位分发：desktop-dialog.cjs 内
#   path.join(__dirname,...) 依赖同目录布局（asar 内与开发目录均正确）。
#   配套：main.js require('./desktop-dialog.cjs').createDesktopDialogIpc({...}) 工厂注入。
$DesktopDialogTargets = @(
    'app_project/db-yunduan/cloud_desktop/electron',
    'app_project/db-offline/desktop/electron'
)

# Group 18: desktop-crash-guard.cjs (★ 2026-09-14 P3-A 桌面崩溃韧性补强) -> 2 个 electron 目录
#   render-process-gone / child-process-gone 兜底：此前双端仅有
#   uncaughtException/unhandledRejection，渲染进程崩溃=白屏无恢复。
#   主壳崩溃自动销毁重建（clean-exit 过滤防误报），60s 滑窗 >=3 次熔断
#   提示后自然退出；GPU/Utility 子进程仅审计。窗口经访问器注入复用
#   desktop-windows.cjs 的 createMainWindow/createLoginWindow（模块边界不交叉）。
#   配套：main.js require('./desktop-crash-guard.cjs').createDesktopCrashGuard({...}) 工厂注入。
$DesktopCrashGuardTargets = @(
    'app_project/db-yunduan/cloud_desktop/electron',
    'app_project/db-offline/desktop/electron'
)

# Group 19: voice 模块（voice-input.js）-> 3 云端目录（★ 2026-09-17 语音版一期）
#   智能语音输入模块（Web Speech API，cloud_voice 版本专属入口）。
#   仅分发云端表面：public（云端网页，一期主战场）+ cloud_desktop（云桌面
#   index.html 由 sync-html 生成，携带 voice-input.js 引用标签）+ cloud_app
#   assets（云APP WebView 实载线上 public，本地 assets 仅打包兜底）。
#   Electron/WebView 无 Web Speech API → isAvailable() 三重 gate 自动隐藏
#   按钮入口（降级安全，键盘开方零影响）。
#   离线端（db-offline）四期换 sherpa-onnx 本地模型时再扩展目标集；
#   site-admin/admin 后台无语音需求不分发。
#   源文件带子目录 shared/voice/voice-input.js，Sync-Group 按文件名展平落位
#   为各目录根级 voice-input.js（与 permission.js 同级，script src 相对引用）。
$VoiceInputTargets = @(
    'public',
    'app_project/db-yunduan/cloud_desktop',
    'app_project/db-yunduan/cloud_app/app/src/main/assets/public'
)

# Group 11: index.html 权威源 -> 云端副本（★ 2026-09-02 从手工复制升级为生成模式）
#   历史事故：权威源改动靠手工复制到云桌面/云APP 副本，多次遗漏导致 CI 红灯、
#   重复 IIFE 脏块累积。现由 tools/sync-html.ps1 自动生成（端配置块保留，
#   其余全部从 public/index.html 传播）。用子进程调用：sync-html 的 exit 语义
#   独立，不会中途终止本脚本的后续分组。
#   （离线两端 index.html 与权威源差异过大——激活/试用整块功能——不纳入。）

# ============================================================================
# Helper: Get SHA256 hash of a file
# ============================================================================
function Get-FileSha256 {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    try {
        return (Get-FileHash $Path -Algorithm SHA256).Hash
    } catch { return $null }
}

# ============================================================================
# Helper: Sync a single file with SHA256 comparison
# ============================================================================
function Sync-File {
    param(
        [string]$Source,
        [string]$Target,
        [string]$Label,
        [bool]$VerifyOnly
    )

    if (-not (Test-Path $Source)) {
        # ★ 原则：宁可漏检不可误报 —— 源文件不存在时该目标无法对照，视为"跳过"
        #   而非"不同步"，避免源本就废弃/未纳入 shared 的组永远误报 FAIL。
        #[WARN 仍提示 源缺失需人工关注，但不阻断发布]
        Write-Host "  [WARN] Source not found (skipped): $Source" -ForegroundColor Yellow
        return $true
    }

    # Create target directory if needed
    $targetDir = Split-Path -Parent $Target
    if (-not (Test-Path $targetDir)) {
        if ($VerifyOnly) {
            return $false
        }
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }

    $sourceHash = Get-FileSha256 $Source
    $targetHash = Get-FileSha256 $Target

    if ($sourceHash -eq $targetHash) {
        return $true
    }

    if ($VerifyOnly) {
        Write-Host "  [DIFF] $Label" -ForegroundColor Yellow
        return $false
    }

    Copy-Item -Path $Source -Destination $Target -Force
    Write-Host "  [SYNC] $Label" -ForegroundColor Green
    return $true
}

# ============================================================================
# Helper: Sync a group of files to a list of targets
# ============================================================================
function Sync-Group {
    param(
        [string]$GroupName,
        [string[]]$Files,
        [string[]]$Targets,
        [bool]$VerifyOnly,
        [string]$TargetLeafName = ''   # ★ 2026-08-28: optional rename, e.g. print-utils-offline.js -> print-utils.js
    )

    Write-Host "--- [$GroupName] ---" -ForegroundColor Cyan

    $allInSync = $true
    $totalChecked = 0
    $syncedCount = 0

    foreach ($file in $Files) {
        $srcPath = Join-Path $SharedDir $file
        $fileName = Split-Path $file -Leaf
        if ($TargetLeafName) { $fileName = $TargetLeafName }

        foreach ($target in $Targets) {
            $totalChecked++
            $targetDir = Join-Path $ProjectRoot $target
            $dstPath = Join-Path $targetDir $fileName
            $label = "$target/$fileName"

            $result = Sync-File -Source $srcPath -Target $dstPath -Label $label -VerifyOnly $VerifyOnly
            if ($result) { $syncedCount++ } else { $allInSync = $false }
        }
    }

    Write-Host "  Checked: $totalChecked, In sync: $syncedCount"
    return $allInSync
}

# ============================================================================
# Main
# ============================================================================
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Sync All Shared Modules" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Project root: $ProjectRoot"
Write-Host "Shared dir:   $SharedDir"
Write-Host "Mode: $(if ($VerifyOnly) { 'Verify only' } else { 'Sync' })"
Write-Host ""

if (-not (Test-Path $SharedDir)) {
    Write-Host "FAIL: Shared directory not found: $SharedDir" -ForegroundColor Red
    exit 1
}

$allInSync = $true

# Group 1: business JS -> directories (auth-core.js managed by sync-auth-core.ps1)
$result = Sync-Group -GroupName "Business JS ($($BusinessJsFiles.Count) files -> dirs)" -Files $BusinessJsFiles -Targets $BusinessJsTargets -VerifyOnly $VerifyOnly
if (-not $result) { $allInSync = $false }
Write-Host ""

# Group 1b: print-utils.js cloud version -> 4 cloud dirs (★ 2026-08-28 dual-source)
$result = Sync-Group -GroupName 'print-utils.js cloud (short title -> 4 cloud dirs)' -Files @('print-utils.js') -Targets $PrintUtilsCloudTargets -VerifyOnly $VerifyOnly
if (-not $result) { $allInSync = $false }
Write-Host ""

# Group 1c: print-utils-offline.js -> 2 offline dirs AS print-utils.js (★ 2026-08-28 dual-source)
$result = Sync-Group -GroupName 'print-utils.js offline (full title -> 2 offline dirs)' -Files @('print-utils-offline.js') -Targets $PrintUtilsOfflineTargets -VerifyOnly $VerifyOnly -TargetLeafName 'print-utils.js'
if (-not $result) { $allInSync = $false }
Write-Host ""

# Group 1e: UI logic (button-manager.js, edition-lock.js) -> 5 dirs (★ 2026-08-29 纳管伪权威源)
$result = Sync-Group -GroupName 'UI logic (2 files -> 5 dirs)' -Files $UiLogicFiles -Targets $UiLogicTargets -VerifyOnly $VerifyOnly
if (-not $result) { $allInSync = $false }
Write-Host ""

# Group 2: permission.js -> 3 offline electron/ (extra)
$result = Sync-Group -GroupName 'permission.js -> 3 offline electron/' -Files @('permission.js') -Targets $PermissionExtraTargets -VerifyOnly $VerifyOnly
if (-not $result) { $allInSync = $false }
Write-Host ""

# Group 3: calculate-hash.js -> 6 offline directories
$result = Sync-Group -GroupName 'calculate-hash.js -> 6 offline dirs' -Files @('calculate-hash.js') -Targets $CalculateHashTargets -VerifyOnly $VerifyOnly
if (-not $result) { $allInSync = $false }
Write-Host ""

# Group 4: license files -> 10 targets
$result = Sync-Group -GroupName 'License (3 files -> 10 dirs)' -Files $LicenseFiles -Targets $LicenseTargets -VerifyOnly $VerifyOnly
if (-not $result) { $allInSync = $false }
Write-Host ""

# Group 6: res/xml files -> 2 app/res/xml/
$result = Sync-Group -GroupName 'res/xml (3 files -> 2 app/res/xml/)' -Files $ResXmlFiles -Targets $ResXmlTargets -VerifyOnly $VerifyOnly
if (-not $result) { $allInSync = $false }
Write-Host ""

# Group 7: vendor files -> 4 targets
$result = Sync-Group -GroupName 'vendor (1 file -> 4 dirs)' -Files $VendorFiles -Targets $VendorTargets -VerifyOnly $VerifyOnly
if (-not $result) { $allInSync = $false }
Write-Host ""

# Group 7b: pinyin-pro vendor -> 3 cloud dirs (★ 2026-09-17 语音连报修复)
$result = Sync-Group -GroupName 'vendor pinyin-pro (1 file -> 3 cloud vendor dirs)' -Files @('vendor/pinyin-pro.min.js') -Targets $PinyinVendorTargets -VerifyOnly $VerifyOnly
if (-not $result) { $allInSync = $false }
Write-Host ""

# Group 8: cloud-only modules -> 1 target (cloud_desktop only)
$result = Sync-Group -GroupName 'cloud modules (3 files -> 1 cloud dir)' -Files $CloudModuleFiles -Targets $CloudModuleTargets -VerifyOnly $VerifyOnly
if (-not $result) { $allInSync = $false }
Write-Host ""

# Group 9: electron-logger.cjs -> 2 electron dirs (P0-[6.3])
$result = Sync-Group -GroupName 'electron-logger.cjs -> 2 electron dirs' -Files @('electron-logger.cjs') -Targets $ElectronLoggerTargets -VerifyOnly $VerifyOnly
if (-not $result) { $allInSync = $false }
Write-Host ""

# Group 10: pe-guard.cjs -> 2 electron dirs (P1-[3.1])
$result = Sync-Group -GroupName 'pe-guard.cjs -> 2 electron dirs' -Files @('pe-guard.cjs') -Targets $PeGuardTargets -VerifyOnly $VerifyOnly
if (-not $result) { $allInSync = $false }
Write-Host ""

# Group 11: index.html authority -> cloud copies (★ 2026-09-02 generator mode)
Write-Host "--- [index.html authority -> cloud copies] ---" -ForegroundColor Cyan
$syncHtmlScript = Join-Path $PSScriptRoot 'sync-html.ps1'
$psExe = if ($IsLinux -or $IsMacOS) { 'pwsh' } else { 'powershell' }
$syncHtmlArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $syncHtmlScript)
if ($VerifyOnly) { $syncHtmlArgs += '-VerifyOnly' }
# 直接调用（不接管 stdout 管道，避免子进程 UTF-8 中文输出经管道转码乱码）
& $psExe @syncHtmlArgs
if ($LASTEXITCODE -ne 0) { $allInSync = $false }
Write-Host ""

# Group 12: update-manager.cjs + hot-update-core.cjs -> 2 electron dirs (★ 2026-09-13 P0-1 + 2026-09-14 热更新)
$result = Sync-Group -GroupName 'update-manager.cjs + hot-update-core.cjs -> 2 electron dirs' -Files @('update-manager.cjs', 'hot-update-core.cjs') -Targets $UpdateManagerTargets -VerifyOnly $VerifyOnly
if (-not $result) { $allInSync = $false }
Write-Host ""

# Group 14: desktop-fs-ipc.cjs -> 2 electron dirs (★ 2026-09-13 B2-1 桌面文件域收口)
$result = Sync-Group -GroupName 'desktop-fs-ipc.cjs -> 2 electron dirs' -Files @('desktop-fs-ipc.cjs') -Targets $DesktopFsIpcTargets -VerifyOnly $VerifyOnly
if (-not $result) { $allInSync = $false }
Write-Host ""

# Group 15: desktop-windows.cjs -> 2 electron dirs (★ 2026-09-13 B2-2 桌面窗口域收口)
$result = Sync-Group -GroupName 'desktop-windows.cjs -> 2 electron dirs' -Files @('desktop-windows.cjs') -Targets $DesktopWindowsTargets -VerifyOnly $VerifyOnly
if (-not $result) { $allInSync = $false }
Write-Host ""

# Group 17: desktop-dialog.cjs + prompt-modal.html + prompt-preload.js -> 2 electron dirs (★ 2026-09-14 P3-A 对话框域收口)
$result = Sync-Group -GroupName 'desktop-dialog.cjs + prompt-modal.html + prompt-preload.js -> 2 electron dirs' -Files @('desktop-dialog.cjs', 'prompt-modal.html', 'prompt-preload.js') -Targets $DesktopDialogTargets -VerifyOnly $VerifyOnly
if (-not $result) { $allInSync = $false }
Write-Host ""

# Group 18: desktop-crash-guard.cjs -> 2 electron dirs (★ 2026-09-14 P3-A 崩溃韧性补强)
$result = Sync-Group -GroupName 'desktop-crash-guard.cjs -> 2 electron dirs' -Files @('desktop-crash-guard.cjs') -Targets $DesktopCrashGuardTargets -VerifyOnly $VerifyOnly
if (-not $result) { $allInSync = $false }
Write-Host ""

# Group 19: voice-input.js -> 3 cloud dirs (★ 2026-09-17 语音版一期)
$result = Sync-Group -GroupName 'voice-input.js -> 3 cloud dirs' -Files @('voice/voice-input.js') -Targets $VoiceInputTargets -VerifyOnly $VerifyOnly
if (-not $result) { $allInSync = $false }
Write-Host ""

# Group 13: index-app.html 生成器（★ 2026-09-13 P1-B1 离线APP权威源生成模式收口）
#   离线桌面权威源 → 33 条变换表 → index-app.html + assets 副本双写。
#   防呆：工作流顺序 = 先 sync-shared-blocks（USER-STORE/USER-ADMIN 块）再跑本组；
#   锚点落入标记块时生成器自动红灯。此后禁止手改 index-app/assets，只改
#   desktop/index.html 权威源 + tools/index-app-transforms.cjs 变换表。
Write-Host "--- [index-app.html authority -> offline APP copies] ---" -ForegroundColor Cyan
$syncIndexAppScript = Join-Path $PSScriptRoot 'sync-index-app.cjs'
$syncIndexAppArgs = @($syncIndexAppScript)
if ($VerifyOnly) { $syncIndexAppArgs += '--verify-only' }
# 直接调用（不接管 stdout 管道，避免子进程 UTF-8 中文输出经管道转码乱码）
& node @syncIndexAppArgs
if ($LASTEXITCODE -ne 0) { $allInSync = $false }
Write-Host ""

# Group 16: site-admin 共享函数层生成器（★ 2026-09-13 P2-B site-admin 生成模式收口）
#   public/index.html 权威源 42 同体函数 → site-admin/index.html 的
#   SYNCED-FN 标记块原样传播（raw 字节级）。互锁分工：
#     本组 = 共享层执行器（42 同体函数，--check 字节校验）；
#     diff-cross-version siteadmin 对 = 分叉层探测器（Tier A/C 101 分叉函数）。
#   此后禁止手改 site-admin 标记块内函数——只改 public/index.html 权威源，
#   然后跑 sync-all.ps1（或单独 node tools/sync-siteadmin.cjs）。
Write-Host "--- [site-admin shared-fn layer: public authority -> SYNCED-FN markers] ---" -ForegroundColor Cyan
$syncSiteAdminScript = Join-Path $PSScriptRoot 'sync-siteadmin.cjs'
$syncSiteAdminArgs = @($syncSiteAdminScript)
if ($VerifyOnly) { $syncSiteAdminArgs += '--check' }
# 直接调用（不接管 stdout 管道，避免子进程 UTF-8 中文输出经管道转码乱码）
& node @syncSiteAdminArgs
if ($LASTEXITCODE -ne 0) { $allInSync = $false }
Write-Host ""

# ============================================================================
# Summary
# ============================================================================
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

if ($VerifyOnly) {
    if ($allInSync) {
        Write-Host "[OK] All files are in sync" -ForegroundColor Green
        exit 0
    } else {
        Write-Host "[FAIL] Some files out of sync" -ForegroundColor Red
        Write-Host "Run without -VerifyOnly to sync" -ForegroundColor Yellow
        exit 1
    }
} else {
    Write-Host "[OK] Sync completed" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  - Run sync-all.ps1 -VerifyOnly to verify"
    Write-Host "  - Run build-app.bat in each version to build"
    exit 0
}
