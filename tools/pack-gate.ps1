# pack-gate.ps1 - 打包统一验收门（兜底验收）
# ============================================================================
# 目的：把历次打包事故的检查固化为一道门禁，任何一项失败即阻断（exit 1），
#       杜绝"改了忘了查/查了漏一项/检查脚本本身坏了没人发现"。
#
# 历次事故 → 检查项映射：
#   [P1] ps1 语法全检   ← 2026-08-24 release-menu.ps1 双重替换语法错/BOM丢失连锁解析错
#   [P2] ps1 BOM 全检   ← 2026-08-24 Edit剥BOM → PowerShell5.1按GBK读 → 中文乱码解析崩
#   [P3] bat CRLF 检查+自动修复 ← Edit/并行会话引入LF行尾 → 双击闪退（自动修复防死锁）
#   [P4] 编码完整性     ← verify-packaging.ps1（index.html禁BOM/bat编码/gradle禁BOM）
#   [F1] 合规9项编排    ← compliance-check.ps1（版本一致性/副本一致性/界面基线/IPC/
#                          AUTH_SECRET/桌面JS完整性/硬编码扫描/shared分发一致）
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\pack-gate.ps1                # preflight（快，秒级）
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\pack-gate.ps1 -Mode full     # 全检（发布前用）
# 退出码：0=全部通过可打包/发布；1=存在失败项，禁止打包发布
# 保险丝：环境变量 NO_PACK_GATE=1 跳过本门（仅紧急排查用，禁止常规使用）
# ============================================================================
param(
    [ValidateSet('preflight','full')]
    [string]$Mode = 'preflight'
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = $PSScriptRoot | Split-Path -Parent
Set-Location $root

if ($env:NO_PACK_GATE -eq '1') {
    Write-Host "[PACK-GATE] NO_PACK_GATE=1 保险丝生效，跳过验收门（紧急排查模式）" -ForegroundColor Yellow
    exit 0
}

$pass = 0; $fail = 0; $failItems = @()

function Add-Pass([string]$msg) { $script:pass++; Write-Host "  [PASS] $msg" -ForegroundColor Green }
function Add-Fail([string]$msg) { $script:fail++; $script:failItems += $msg; Write-Host "  [FAIL] $msg" -ForegroundColor Red }

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ("  惠康中医 · 打包验收门 (Mode: {0})" -f $Mode) -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# [P1] ps1 语法全检（git 跟踪的所有 .ps1，AST 解析，PowerShell 5.1 同引擎）
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[P1] ps1 语法全检..." -ForegroundColor Cyan
$ps1Files = @(& git -c core.quotepath=false ls-files -- '*.ps1' 2>$null) | Where-Object { $_ }
$syntaxFail = 0
foreach ($f in $ps1Files) {
    $full = Join-Path $root ($f -replace '/', '\')
    if (-not (Test-Path -LiteralPath $full)) { continue }
    $tokens = $null; $errors = $null
    try {
        [void][System.Management.Automation.Language.Parser]::ParseFile($full, [ref]$tokens, [ref]$errors)
        if ($errors -and $errors.Count -gt 0) {
            $first = $errors[0]
            Add-Fail ("语法错误: {0} (行{1}): {2}" -f $f, $first.Extent.StartLineNumber, $first.Message)
            $syntaxFail++
        }
    } catch {
        Add-Fail ("解析异常: {0}: {1}" -f $f, $_.Exception.Message)
        $syntaxFail++
    }
}
if ($syntaxFail -eq 0) { Add-Pass ("ps1 语法: {0} 个文件全部通过" -f $ps1Files.Count) }

# ---------------------------------------------------------------------------
# [P2] ps1 BOM 全检（PowerShell 5.1 无 BOM 按 GBK 读 → 中文乱码解析崩）
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[P2] ps1 BOM 全检..." -ForegroundColor Cyan
$bomFail = 0
foreach ($f in $ps1Files) {
    $full = Join-Path $root ($f -replace '/', '\')
    if (-not (Test-Path -LiteralPath $full)) { continue }
    $bytes = [System.IO.File]::ReadAllBytes($full)
    if (-not ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)) {
        Add-Fail ("缺 BOM: $f （运行 tools\fix-ps1-bom.ps1 修复）")
        $bomFail++
    }
}
if ($bomFail -eq 0) { Add-Pass ("ps1 BOM: {0} 个文件全部齐备" -f $ps1Files.Count) }

# ---------------------------------------------------------------------------
# [P3] bat CRLF 检查+自动修复（LF 行尾 → 双击闪退；扫描 git 跟踪的所有 .bat）
#      ★ 2026-08-24 死锁修复：LF 行尾【自动修复】而非阻断。入口 bat 的 self-heal
#        只覆盖硬编码清单（8个构建bat），并行会话/IDE 触碰清单外 .bat（如 pack-app.bat）
#        会导致验收门 P3 永久拦截所有打包（死锁）。字节级 LF→CRLF 是确定性安全操作。
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[P3] bat CRLF 检查（LF 自动修复）..." -ForegroundColor Cyan
$batFiles = @(& git -c core.quotepath=false ls-files -- '*.bat' 2>$null) | Where-Object { $_ }
$crlfFixed = 0
$crlfFail = 0
foreach ($f in $batFiles) {
    $full = Join-Path $root ($f -replace '/', '\')
    if (-not (Test-Path -LiteralPath $full)) { continue }
    $bytes = [System.IO.File]::ReadAllBytes($full)
    $lone = 0
    for ($i = 0; $i -lt $bytes.Length; $i++) {
        if ($bytes[$i] -eq 0x0A) {
            if ($i -eq 0 -or $bytes[$i-1] -ne 0x0D) { $lone++ }
        }
    }
    if ($lone -gt 0) {
        # 字节级确定性修复：孤立 0x0A 前插 0x0D，其余字节原样（编码无影响）
        try {
            $out = New-Object System.Collections.Generic.List[byte]
            for ($i = 0; $i -lt $bytes.Length; $i++) {
                if ($bytes[$i] -eq 0x0A -and ($i -eq 0 -or $bytes[$i-1] -ne 0x0D)) { $out.Add([byte]0x0D) }
                $out.Add($bytes[$i])
            }
            [System.IO.File]::WriteAllBytes($full, $out.ToArray())
            $crlfFixed++
            Write-Host ("  [FIXED] LF 行尾 x${lone} 已自动修复: $f") -ForegroundColor Yellow
        } catch {
            Add-Fail ("LF 行尾 x${lone} 且自动修复失败: $f ($($_.Exception.Message))")
            $crlfFail++
        }
    }
}
if ($crlfFail -eq 0 -and $crlfFixed -eq 0) { Add-Pass ("bat CRLF: {0} 个文件全部正常" -f $batFiles.Count) }
elseif ($crlfFail -eq 0) { Add-Pass ("bat CRLF: {0} 个文件检查完毕，{1} 个 LF 已自动修复" -f $batFiles.Count, $crlfFixed) }

# ---------------------------------------------------------------------------
# [P4] 编码完整性（verify-packaging.ps1：index.html 禁 BOM/bat 编码/gradle 禁 BOM）
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[P4] 编码完整性 (verify-packaging)..." -ForegroundColor Cyan
$vp = Join-Path $PSScriptRoot 'verify-packaging.ps1'
& powershell -NoProfile -ExecutionPolicy Bypass -File $vp 2>&1 | ForEach-Object { Write-Host "  $_" }
if ($LASTEXITCODE -eq 0) { Add-Pass "编码完整性: verify-packaging 通过" }
else { Add-Fail "编码完整性: verify-packaging 未通过 (exit $LASTEXITCODE)" }

# ---------------------------------------------------------------------------
# [F1] full 模式：合规 9 项编排（版本/副本/界面基线/IPC/AUTH_SECRET/桌面JS/硬编码/shared）
# ---------------------------------------------------------------------------
if ($Mode -eq 'full') {
    Write-Host ""
    Write-Host "[F1] 合规 9 项编排 (compliance-check)..." -ForegroundColor Cyan
    $cc = Join-Path $PSScriptRoot 'compliance-check.ps1'
    & powershell -NoProfile -ExecutionPolicy Bypass -File $cc 2>&1 | ForEach-Object { Write-Host "  $_" }
    if ($LASTEXITCODE -eq 0) { Add-Pass "合规检查: 9 项全部通过" }
    else { Add-Fail "合规检查: 存在不合规项 (exit $LASTEXITCODE)，禁止上传！" }
}

# ============================ 汇总 ============================
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  验收门汇总" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ("  通过: {0}" -f $pass) -ForegroundColor Green
if ($fail -gt 0) {
    Write-Host ("  失败: {0}" -f $fail) -ForegroundColor Red
    foreach ($d in $failItems) { Write-Host "    - $d" -ForegroundColor Red }
    Write-Host ""
    Write-Host "  [RESULT] 拒绝 —— 修复上述问题后重跑本门，通过后方可打包/发布" -ForegroundColor Red
    exit 1
} else {
    Write-Host ("  失败: {0}" -f 0) -ForegroundColor Green
    Write-Host ""
    Write-Host "  [RESULT] 放行 —— 验收合格，可打包/发布" -ForegroundColor Green
    exit 0
}
