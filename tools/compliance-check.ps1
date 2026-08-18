# ============================================================================
#  compliance-check.ps1 —— 发布前合规检查统一编排（只读，不修改任何文件）
#
#  ★ 必守HARD规则（project_memory 第五十七章）：
#    打包产物(程序/APK)禁止自动上传官方下载网站！
#    上传/发布前必须人工执行本合规检查，全部通过(exit 0)后，才允许
#    手动执行带 --confirm --push 的发布命令。
#
#  用法:
#    powershell -NoProfile -ExecutionPolicy Bypass -File tools\compliance-check.ps1
#    powershell -NoProfile -ExecutionPolicy Bypass -File tools\compliance-check.ps1 -SummaryOnly
#
#  参数:
#    -SummaryOnly  仅输出最终通过/失败结论（供发布工具门禁捕获退出码）
#
#  退出码:
#    0 = 全部通过（合规合格，可手动上传）
#    1 = 存在失败项（禁止上传，先修复）
#    2 = 编排脚本自身异常（如找不到某检查脚本）
#
#  ★ 原则：宁可漏检不可误报 —— 仅纳入确定性的只读检查，任一失败即拒绝发布。
# ============================================================================
param(
    [switch]$SummaryOnly = $false
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

$scriptDir = $PSScriptRoot
if ($scriptDir) { $root = Split-Path $scriptDir -Parent } else { $root = $PWD.Path }
Set-Location $root

$pass = 0
$fail = 0
$failDetails = @()

# 输出统一的 [组别] 通过/失败。children 脚本自带详细输出；这里只做归集。
function Invoke-Check {
    param(
        [string]$Name,        # 检查项名称（中文标题）
        [string[]]$ArgsList   # 命令及其参数
    )
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "  [合规] $Name" -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan

    $cmd = $ArgsList[0]
    # ★ 修复：range 切片在 ArgsList 只有脚本路径(1 个元素)时，`1..0` 会反向生成 @(1,0)，
    #   从而把脚本路径误当参数传给子脚本，导致"基准文件不存在/全部SKIP"等误报。
    #   仅在确实存在额外参数时才切片；否则必须为空数组。
    $cmdArgs = @()
    if ($ArgsList.Count -gt 1) { $cmdArgs = @($ArgsList[1..($ArgsList.Count - 1)]) }
    if (-not (Test-Path $cmd)) {
        Write-Host "  [SKIP] 脚本不存在: $cmd" -ForegroundColor Yellow
        return
    }

    try {
        if ($cmd -match '\.ps1$') {
            & powershell -NoProfile -ExecutionPolicy Bypass -File $cmd @cmdArgs 2>&1 | ForEach-Object { Write-Host "  $_" }
            $rc = $LASTEXITCODE
        } else {
            & node $cmd @cmdArgs 2>&1 | ForEach-Object { Write-Host "  $_" }
            $rc = $LASTEXITCODE
        }
    } catch {
        Write-Host "  [FAIL] $Name 执行异常: $_" -ForegroundColor Red
        $script:fail++
        $script:failDetails += $Name
        return
    }

    if ($rc -eq 0) {
        Write-Host ""
        Write-Host "  [OK] $Name ：通过" -ForegroundColor Green
        $script:pass++
    } else {
        Write-Host ""
        Write-Host "  [FAIL] $Name ：未通过 (exit $rc) —— 禁止上传！请先修复" -ForegroundColor Red
        $script:fail++
        $script:failDetails += $Name
    }
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  惠康中医 · 发布前合规检查（只读，不修改文件）" -ForegroundColor Cyan
Write-Host "  RepoRoot: $root" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# --- 1 编码/BOM 完整性（.ps1 必须有 BOM、index.html 不能有 BOM、.bat 编码合法） ---
Invoke-Check -Name "1/8 编码/BOM 完整性" -ArgsList @(
    (Join-Path $scriptDir 'verify-packaging.ps1')
)

# --- 2 云端 index.html 副本逻辑一致性（防"改一处漏其余"） ---
Invoke-Check -Name "2/8 云端 index.html 副本一致性" -ArgsList @(
    (Join-Path $scriptDir 'check-index-consistency.ps1')
)

# --- 3 诊所名/医师名硬编码反模式扫描（防旧名回显） ---
# 显式传 -RepoRoot，避免子脚本 $MyInvocation 在- File + 管道下定位根目录不可靠
Invoke-Check -Name "3/8 诊所名/医师名硬编码扫描" -ArgsList @(
    (Join-Path $scriptDir 'verify-no-hardcoded-clinic.ps1'),
    '-RepoRoot', $root
)

# --- 4 版本号一致性（云端/离线三要素，防回滚） ---
Invoke-Check -Name "4/8 版本号一致性" -ArgsList @(
    (Join-Path $scriptDir 'verify-app-version-consistency.ps1'),
    '-Target', 'all'
)

# --- 5 shared/ 模块分发一致性（VerifyOnly 只检不改） ---
Invoke-Check -Name "5/8 shared/ 模块一致性" -ArgsList @(
    (Join-Path $scriptDir 'sync-all.ps1'),
    '-VerifyOnly'
)

# --- 6 桌面工程 JS 打包完整性 + 版本身份校验（每个桌面工程） ---
foreach ($proj in @(
        'app_project\db-offline\desktop',
        'app_project\db-yunduan\cloud_desktop'
    )) {
    Invoke-Check -Name "6/8 桌面JS打包完整性/身份 (${proj})" -ArgsList @(
        (Join-Path $scriptDir 'pre-build-check.js'),
        (Join-Path $root $proj)
    )
}

# --- 7 IPC 一致性（cloud + offline，防表格/历史不显示） ---
Invoke-Check -Name "7/8 IPC 一致性 (cloud)" -ArgsList @(
    (Join-Path $scriptDir 'check-ipc-consistency.js'),
    '--target=cloud'
)
Invoke-Check -Name "7/8 IPC 一致性 (offline)" -ArgsList @(
    (Join-Path $scriptDir 'check-ipc-consistency.js'),
    '--target=offline'
)

# --- 8 界面结构基线保护（body 结构与 .interface-lock.json 一致） ---
Invoke-Check -Name "8/8 界面结构基线保护" -ArgsList @(
    (Join-Path $scriptDir 'check-interface.ps1')
)

# ============================ 汇总 ============================
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  合规检查汇总" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ("  通过: {0}" -f $pass) -ForegroundColor Green
if ($fail -gt 0) {
    Write-Host ("  失败: {0}" -f $fail) -ForegroundColor Red
    Write-Host ""
    Write-Host "  不通过项:" -ForegroundColor Red
    foreach ($d in $failDetails) { Write-Host "    - $d" -ForegroundColor Red }
    Write-Host ""
    Write-Host "  [RESULT] FAILED —— 存在不合规项，禁止上传官方下载网站！" -ForegroundColor Red
    Write-Host "  请先修复上述问题，再重新运行本检查，全部通过后方可手动发布。" -ForegroundColor Yellow
    exit 1
} else {
    Write-Host ("  失败: {0}" -f 0) -ForegroundColor Green
    Write-Host ""
    Write-Host "  [RESULT] PASSED —— 合规合格，可手动上传官方下载网站。" -ForegroundColor Green
    exit 0
}