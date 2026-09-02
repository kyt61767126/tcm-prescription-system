# ============================================================================
#  sync-html.ps1 - HTML 副本权威源生成器（P2-5 观察期毕业，2026-09-02 切换）
#
#  设计目的（从设计层面杜绝副本漂移）：
#    index.html 副本此前靠"手工复制"分发，html-sync-check 只报告不覆盖，
#    导致：权威源修复未同步副本（2026-09-02 CI 红灯）、权威源累积 3 份重复
#    IIFE 脏块、注释位置漂移——全部被 ±30 行窗口重对齐掩盖。
#    本工具把流程反转为"权威源 → 副本 自动生成"：
#      · 副本 = 权威源全文 + 副本自身的端配置块（原样保留）
#      · 权威源的一切改动（新增/删除/修改）自动传播到全部副本
#      · 端配置块（EDITION/PRODUCT_NAME/APP_MODE 赋值 + 紧邻身份注释）
#        是副本唯一允许的私有内容，同步时原样保留
#
#  算法（端配置块整体保留 + 其余从权威源传播）：
#    1. 在文件中定位端配置块：
#       a) 唯一的 window.EDITION= / window.APP_MODE= 赋值行（各恰好 1 行，
#          多于 1 行视为结构异常，立即报错退出——宁可失败不可错写）
#       b) 块起点 = EDITION 行向上连续 '//' 注释行的边界
#          块终点 = APP_MODE  行向下连续 '//' 注释行的边界
#    2. newTgt = src[块前] + tgt 自身块 + src[块后]
#    3. 与现有 tgt 不同则写入（LF 行尾、UTF-8 无 BOM，与仓库 eol=lf 一致）
#
#  用法:
#    powershell -NoProfile -ExecutionPolicy Bypass -File tools\sync-html.ps1             # 同步
#    powershell -NoProfile -ExecutionPolicy Bypass -File tools\sync-html.ps1 -VerifyOnly # 只校验
#    退出码: 0 = 副本已是权威源生成结果 / 1 = 校验失败或有异常
#
#  与 html-sync-check.ps1 的关系:
#    check 是 CI 最终防线（含 login.html 双版监控等），本工具是本地同步入口。
#    改 index.html 的唯一合法流程：改 public/index.html（权威源）→ 跑本工具
#    → 跑 html-sync-check 确认 0 drift → 提交。禁止直接改副本。
# ============================================================================
param(
    [switch]$VerifyOnly = $false
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# 权威源与副本清单（与 html-sync-check.ps1 保持一致；离线两端差异过大不纳入）
$Authority = 'public/index.html'
$Targets = @(
    'app_project/db-yunduan/cloud_desktop/index.html',
    'app_project/db-yunduan/cloud_app/app/src/main/assets/public/index.html'
)

# 赋值行模式（用于定位端配置块；每文件必须恰好各 1 行）
$EditionPattern  = "^\s*window\.EDITION\s*="
$ProductPattern  = "^\s*window\.PRODUCT_NAME\s*="
$AppModePattern  = "^\s*window\.APP_MODE\s*="

# ----------------------------------------------------------------------------
# 定位端配置块：返回 @{ First = 起始行号(0基); Last = 结束行号(0基) }
# 失败时 throw（宁可失败不可错写）
# ----------------------------------------------------------------------------
function Find-EditionBlock {
    param([string[]]$Lines, [string]$Label)

    $editionLine  = -1
    $productLine  = -1
    $appModeLine  = -1
    for ($i = 0; $i -lt $Lines.Count; $i++) {
        if ($Lines[$i] -match $EditionPattern) {
            if ($editionLine -ge 0) { throw "[$Label] window.EDITION 赋值行出现多于 1 次 (L$($editionLine+1) / L$($i+1))，结构异常，拒绝同步" }
            $editionLine = $i
        }
        if ($Lines[$i] -match $ProductPattern) {
            if ($productLine -ge 0) { throw "[$Label] window.PRODUCT_NAME 赋值行出现多于 1 次，结构异常，拒绝同步" }
            $productLine = $i
        }
        if ($Lines[$i] -match $AppModePattern) {
            if ($appModeLine -ge 0) { throw "[$Label] window.APP_MODE 赋值行出现多于 1 次，结构异常，拒绝同步" }
            $appModeLine = $i
        }
    }
    if ($editionLine -lt 0 -or $productLine -lt 0 -or $appModeLine -lt 0) {
        throw "[$Label] 未找到完整的 EDITION/PRODUCT_NAME/APP_MODE 赋值行，拒绝同步"
    }
    if (-not ($editionLine -le $productLine -and $productLine -le $appModeLine)) {
        throw "[$Label] 赋值行顺序异常 (EDITION=$($editionLine+1), PRODUCT_NAME=$($productLine+1), APP_MODE=$($appModeLine+1))，拒绝同步"
    }

    # 块起点：EDITION 行向上连续 '//' 注释行
    $first = $editionLine
    while ($first -gt 0 -and $Lines[$first - 1].TrimStart().StartsWith('//')) { $first-- }

    # 块终点：APP_MODE 行向下连续 '//' 注释行
    $last = $appModeLine
    while (($last + 1) -lt $Lines.Count -and $Lines[$last + 1].TrimStart().StartsWith('//')) { $last++ }

    return @{ First = $first; Last = $last }
}

# ----------------------------------------------------------------------------
# 生成副本内容：src 全文 + tgt 自身端配置块
# ----------------------------------------------------------------------------
function New-TargetContent {
    param([string[]]$SrcLines, [string[]]$TgtLines, [string]$Label)

    $srcBlock = Find-EditionBlock -Lines $SrcLines -Label "$Label(src)"
    $tgtBlock = Find-EditionBlock -Lines $TgtLines -Label "$Label(tgt)"

    $out = New-Object System.Collections.Generic.List[string]
    for ($i = 0; $i -lt $srcBlock.First; $i++) { $out.Add($SrcLines[$i]) }
    for ($j = $tgtBlock.First; $j -le $tgtBlock.Last; $j++) { $out.Add($TgtLines[$j]) }
    for ($i = $srcBlock.Last + 1; $i -lt $SrcLines.Count; $i++) { $out.Add($SrcLines[$i]) }
    return $out
}

# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  HTML 权威源同步 (authority -> copies)" -ForegroundColor Cyan
Write-Host "  Authority: $Authority" -ForegroundColor Cyan
Write-Host "  Mode: $(if ($VerifyOnly) { 'Verify only' } else { 'Sync' })" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$srcPath = Join-Path $root $Authority
if (-not (Test-Path $srcPath)) {
    Write-Host "[FAIL] 权威源不存在: $Authority" -ForegroundColor Red
    exit 1
}

# LF 行尾（仓库 .gitattributes eol=lf）+ UTF-8 无 BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$srcLines = [System.IO.File]::ReadAllLines($srcPath, [System.Text.Encoding]::UTF8)

$allOk = $true
foreach ($target in $Targets) {
    $tgtPath = Join-Path $root $target
    if (-not (Test-Path $tgtPath)) {
        Write-Host "[MISS] $target" -ForegroundColor Red
        $allOk = $false
        continue
    }

    try {
        $tgtLines = [System.IO.File]::ReadAllLines($tgtPath, [System.Text.Encoding]::UTF8)
        $newLines = New-TargetContent -SrcLines $srcLines -TgtLines $tgtLines -Label $target

        # 与现有副本比对（逐行 + 行数）
        $unchanged = ($newLines.Count -eq $tgtLines.Count)
        if ($unchanged) {
            for ($i = 0; $i -lt $newLines.Count; $i++) {
                if ($newLines[$i] -cne $tgtLines[$i]) { $unchanged = $false; break }
            }
        }

        if ($unchanged) {
            Write-Host "[ OK ] $target (已是权威源生成结果, $($newLines.Count) lines)" -ForegroundColor Green
        } elseif ($VerifyOnly) {
            Write-Host "[DRIFT] $target" -ForegroundColor Red
            Write-Host "       副本与权威源生成结果不一致，运行不带 -VerifyOnly 的同步修复:" -ForegroundColor Yellow
            Write-Host "       powershell -File tools/sync-html.ps1" -ForegroundColor Yellow
            $allOk = $false
        } else {
            # 写回：LF 行尾 + UTF-8 无 BOM + 末尾换行
            $newText = ($newLines -join "`n") + "`n"
            [System.IO.File]::WriteAllText($tgtPath, $newText, $utf8NoBom)
            $changedCount = 0
            $max = [Math]::Max($newLines.Count, $tgtLines.Count)
            for ($i = 0; $i -lt $max; $i++) {
                $a = if ($i -lt $newLines.Count) { $newLines[$i] } else { $null }
                $b = if ($i -lt $tgtLines.Count) { $tgtLines[$i] } else { $null }
                if ($a -cne $b) { $changedCount++ }
            }
            Write-Host "[SYNC] $target ($changedCount 行已更新为权威源内容, 端配置块保留)" -ForegroundColor Green
        }
    } catch {
        Write-Host "[FAIL] $target : $($_.Exception.Message)" -ForegroundColor Red
        $allOk = $false
    }
}

Write-Host ""
if ($allOk) {
    Write-Host "[OK] HTML 副本与权威源一致" -ForegroundColor Green
    exit 0
} else {
    Write-Host "[FAIL] HTML 副本存在漂移或异常" -ForegroundColor Red
    exit 1
}
