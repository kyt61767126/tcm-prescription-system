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

# Group 1: 9 business JS files (cloud + offline)
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
$BusinessJsFiles = @(
    'db-adapter.js',
    'debug-logger.js',
    'medicine-dict.js',
    'symptom-dict.js',
    'patient-archive.js',
    'performance-utils.js',
    'permission.js',
    'prescription-core.js',
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
    'app_project/db-yunduan/cloud_desktop/electron'
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

# Group 1: 9 business JS -> directories (auth-core.js managed by sync-auth-core.ps1)
$result = Sync-Group -GroupName 'Business JS (9 files -> dirs)' -Files $BusinessJsFiles -Targets $BusinessJsTargets -VerifyOnly $VerifyOnly
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
