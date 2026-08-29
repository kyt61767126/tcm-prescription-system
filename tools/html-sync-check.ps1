# ============================================================================
#  html-sync-check.ps1  (P1-3 观察期工具, P2-5 扩展)
#  HTML 副本漂移校验（只报告不覆盖）：
#   ① 云端 index.html：以 public/index.html 为权威源，规范化合法端配置差异
#      后行级 diff 云桌面/云端APP 副本。
#   ② 桌面 login.html：云桌面 ↔ 离线桌面 规范化 diff（P2-5 新增）。
#      历史上多次"改登录框漏桌面版"bug 正是这两份副本脱管造成。
#
#  用法:
#    powershell -NoProfile -ExecutionPolicy Bypass -File tools\html-sync-check.ps1
#    返回: exit 0 = 无实质漂移(仅合法差异), exit 1 = 发现实质漂移需人工处理
#
#  设计背景 (2026-08-29 P1-3/P2-5):
#    - 云端 3 份 index.html (网页版/云桌面/云端APP) 此前纯手工复制，
#      2026-08-28~29 两次登录框修改均遗漏云桌面，导致外飘胶囊 (N) bug 在云桌面残留。
#    - login.js 为功能双源特例（云端账户登录 vs 离线本地验证，377 行差异），
#      如 auth-core 一样按端维护，不做统一；本工具仅监控 login.html 结构层。
#    - public/electron/login.html 与两桌面版是平行演化（3KB 差异），统一属于
#      界面改版需用户确认，暂不纳入比较。
#    - 观察期策略: 本工具只报告不覆盖。运行 1~2 周确认差异清单稳定后，
#      切换为权威源生成模式。
#    - 离线两端 index.html 与云端权威源差异过大（离线版含激活/试用等
#      整块功能差异），不纳入本工具比较范围，避免海量噪音。
# ============================================================================
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# ★ 行级漂移比较：返回漂移行数（0 = 一致）
#   容忍 ±30 行插入/删除造成的错位（窗口搜索重对齐）
function Compare-Drift([System.Collections.Generic.List[string]]$srcLines, [System.Collections.Generic.List[string]]$tgtLines) {
    $diffCount = 0
    $diffSamples = New-Object System.Collections.Generic.List[string]
    $offset = 0
    $i = 0
    while ($i -lt [Math]::Max($srcLines.Count, $tgtLines.Count)) {
        $s = if ($i -lt $srcLines.Count) { $srcLines[$i] } else { $null }
        $t = if (($i + $offset) -lt $tgtLines.Count -and ($i + $offset) -ge 0) { $tgtLines[$i + $offset] } else { $null }

        if ($s -eq $t) { $i++; continue }

        $matched = $false
        foreach ($delta in @(-30..30)) {
            $j = $i + $delta
            if ($j -lt 0 -or $j -ge $tgtLines.Count) { continue }
            if ($srcLines[$i] -eq $tgtLines[$j]) {
                $offset = $j - $i
                $matched = $true
                break
            }
        }
        if ($matched) { $i++; continue }

        $diffCount++
        if ($diffSamples.Count -lt 12) {
            $sTxt = if ($s) { $s.Trim() } else { '<EOF>' }
            $tTxt = if ($t) { $t.Trim() } else { '<EOF>' }
            if ($sTxt.Length -gt 110) { $sTxt = $sTxt.Substring(0, 110) + '...' }
            if ($tTxt.Length -gt 110) { $tTxt = $tTxt.Substring(0, 110) + '...' }
            $diffSamples.Add(("    L{0}:" -f ($i + 1)))
            $diffSamples.Add(("      src: {0}" -f $sTxt))
            $diffSamples.Add(("      tgt: {0}" -f $tTxt))
        }
        $i++
    }
    return @{ Count = $diffCount; Samples = $diffSamples }
}

# 权威源
$Authority = 'public/index.html'

# 云端副本目标（观察期范围）
$Targets = @(
    'app_project/db-yunduan/cloud_desktop/index.html',
    'app_project/db-yunduan/cloud_app/app/src/main/assets/public/index.html'
)

# ★ 合法端配置差异清单：正则 -> 占位符
#   这些行按端必然不同（版本身份/运行模式），规范化为占位符后不应产生 diff。
#   若端配置行本身结构变化（如新增变量），仍会以 diff 形式暴露。
$NormalizeRules = @(
    @{ Pattern = "window\.EDITION\s*=\s*'[^']*'";               Replace = "window.EDITION = '@@EDITION@@'" },
    @{ Pattern = "window\.PRODUCT_NAME\s*=\s*'[^']*'";          Replace = "window.PRODUCT_NAME = '@@PRODUCT_NAME@@'" },
    @{ Pattern = "window\.APP_MODE\s*=\s*'[^']*'";              Replace = "window.APP_MODE = '@@APP_MODE@@'" }
)

# ★ 端身份注释行：整行删除（两侧块的注释文字按端不同但语义等价，
#   删除后只留 3 行占位符赋值，行级对齐即归零）
$DropLineRules = @(
    '// ★★★ 2026-08-17 【Setup 1.0.38 根治刀1-A】：惠康中医-本地 = 永久离线标准版（personal），绝不再用 clinic_custom 默认值！',
    '// ★ 2026-08-28 版本身份（云端桌面标准版）：打包门禁 verify-version-display 严格校验：',
    '//   PRODUCT_NAME=惠康中医-云端 / EDITION=cloud_personal / APP_MODE=cloud / <title>含「云端」',
    '// ★v2.0 统一架构：声明 APP_MODE（offline/cloud/auto），供 db-adapter.js 自动检测',
    '// auto=自动检测：已加载 cloud-api.js 且 CLOUD_API_BASE 存在则走云端，否则走离线',
    '// ★v2.0 统一架构：声明 APP_MODE=cloud（云端桌面强制云端，不做auto探测）'
)

function Get-NormalizedLines([string]$path) {
    $lines = Get-Content $path -Encoding UTF8
    $out = New-Object System.Collections.Generic.List[string]
    foreach ($line in $lines) {
        # 端身份注释行直接跳过
        $trimmed = $line.Trim()
        $dropped = $false
        foreach ($drop in $DropLineRules) {
            if ($trimmed -eq $drop) { $dropped = $true; break }
        }
        if ($dropped) { continue }

        $l = $line
        foreach ($rule in $NormalizeRules) {
            $l = [regex]::Replace($l, $rule.Pattern, $rule.Replace)
        }
        $out.Add($l)
    }
    return $out
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  HTML Sync Check (P1-3 observe mode)" -ForegroundColor Cyan
Write-Host "  Authority: $Authority" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$srcLines = Get-NormalizedLines (Join-Path $root $Authority)
$driftFound = $false

foreach ($target in $Targets) {
    $fullTarget = Join-Path $root $target
    if (-not (Test-Path $fullTarget)) {
        Write-Host ("[MISS] " + $target) -ForegroundColor Red
        $driftFound = $true
        continue
    }

    $tgtLines = Get-NormalizedLines $fullTarget
    $result = Compare-Drift $srcLines $tgtLines
    $diffCount = $result.Count
    $diffSamples = $result.Samples

    if ($diffCount -eq 0) {
        Write-Host ("[ OK ] " + $target) -ForegroundColor Green
        Write-Host ("       normalized lines identical ({0} lines)" -f $srcLines.Count)
    } else {
        Write-Host ("[DRIFT] " + $target) -ForegroundColor Red
        Write-Host ("       {0} drifted lines (after normalizing edition config)" -f $diffCount)
        $diffSamples | ForEach-Object { Write-Host $_ -ForegroundColor Yellow }
        if ($diffCount -gt 12) { Write-Host "       ... (only first 12 shown)" -ForegroundColor Yellow }
        $driftFound = $true
    }
    Write-Host ""
}

# ============================================================================
# ② 桌面 login.html 双版漂移监控 (P2-5, 2026-08-29)
#    云桌面 ↔ 离线桌面，规范化 3 处合法端差异后应完全一致：
#      a) CSP connect-src（云端连 pages.dev 域，离线仅 'self'）
#      b) version-tag 文本（【云端 ·…】vs【离线标准版 ·…】）
#      c) 离线版特有 loginDoctorName div 行（整行删除）
# ============================================================================
$LoginSrc = 'app_project/db-yunduan/cloud_desktop/electron/login.html'
$LoginTgt = 'app_project/db-offline/desktop/electron/login.html'

$LoginNormalizeRules = @(
    # CSP meta 整行归一（云端含 connect-src pages.dev 域，离线版无该指令——指令集本身即端差异）
    @{ Pattern = '<meta http-equiv="Content-Security-Policy" content="[^"]*"'; Replace = '<meta http-equiv="Content-Security-Policy" content="@CSP@@"' },
    @{ Pattern = '【(云端|离线标准版|离线机构版) ·'; Replace = '【@@EDITION@@ ·' }
)

function Get-LoginNormalizedLines([string]$path) {
    $lines = Get-Content $path -Encoding UTF8
    $out = New-Object System.Collections.Generic.List[string]
    foreach ($line in $lines) {
        # 离线版特有元素行整行跳过
        if ($line -match 'loginDoctorName') { continue }
        $l = $line
        foreach ($rule in $LoginNormalizeRules) {
            $l = [regex]::Replace($l, $rule.Pattern, $rule.Replace)
        }
        $out.Add($l)
    }
    return $out
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Login.html Sync Check (desktop dual)" -ForegroundColor Cyan
Write-Host "  Ref: $LoginSrc" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$loginSrcLines = $null
$loginTgtLines = $null
if ((Test-Path (Join-Path $root $LoginSrc)) -and (Test-Path (Join-Path $root $LoginTgt))) {
    $loginSrcLines = Get-LoginNormalizedLines (Join-Path $root $LoginSrc)
    $loginTgtLines = Get-LoginNormalizedLines (Join-Path $root $LoginTgt)
    $result = Compare-Drift $loginSrcLines $loginTgtLines

    if ($result.Count -eq 0) {
        Write-Host ("[ OK ] " + $LoginTgt) -ForegroundColor Green
        Write-Host ("       normalized lines identical ({0} lines)" -f $loginSrcLines.Count)
    } else {
        Write-Host ("[DRIFT] " + $LoginTgt) -ForegroundColor Red
        Write-Host ("       {0} drifted lines (after normalizing CSP/version/doctorName)" -f $result.Count)
        $result.Samples | ForEach-Object { Write-Host $_ -ForegroundColor Yellow }
        $driftFound = $true
    }
} else {
    Write-Host "[MISS] login.html file(s) not found" -ForegroundColor Red
    $driftFound = $true
}
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
if ($driftFound) {
    Write-Host "  RESULT: DRIFT DETECTED" -ForegroundColor Red
    Write-Host "  合法差异(端配置/注释)已规范化，以上为实质漂移。" -ForegroundColor Yellow
    Write-Host "  → 修复方式: 以 public/index.html 为准回改副本；" -ForegroundColor Yellow
    Write-Host "    副本合法改动则先改权威源再同步。" -ForegroundColor Yellow
    exit 1
} else {
    Write-Host "  RESULT: IN SYNC (authority -> cloud copies)" -ForegroundColor Green
    exit 0
}
