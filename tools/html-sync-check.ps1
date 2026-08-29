# ============================================================================
#  html-sync-check.ps1  (P1-3 观察期工具)
#  云端 index.html 副本漂移校验：以 public/index.html 为权威源，
#  规范化合法端配置差异后做行级 diff，报告各端副本的实质漂移。
#
#  用法:
#    powershell -NoProfile -ExecutionPolicy Bypass -File tools\html-sync-check.ps1
#    返回: exit 0 = 无实质漂移(仅合法差异), exit 1 = 发现实质漂移需人工处理
#
#  设计背景 (2026-08-29 P1-3):
#    - 云端 3 份 index.html (网页版/云桌面/云端APP) 此前纯手工复制，
#      2026-08-28~29 两次登录框修改均遗漏云桌面，导致外飘胶囊 (N) bug 在云桌面残留。
#    - 观察期策略: 本工具只报告不覆盖。运行 1~2 周确认差异清单稳定后，
#      切换为权威源生成模式 (生成脚本按端配置占位符替换产出副本)。
#    - 离线两端 (db-offline desktop/index-app.html) 与云端权威源差异过大
#      (离线版含激活/试用等整块功能差异)，不纳入本工具比较范围，避免海量噪音。
# ============================================================================
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

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

    # 行级 LCS diff（借用 git diff --no-index 逐行对比太重，用简易哈希对齐）
    # 策略：逐行比较（两端行号基本对齐，少量插入时容忍偏移窗口 ±30 行）
    $diffCount = 0
    $diffSamples = New-Object System.Collections.Generic.List[string]
    $offset = 0
    $i = 0
    while ($i -lt [Math]::Max($srcLines.Count, $tgtLines.Count)) {
        $s = if ($i -lt $srcLines.Count) { $srcLines[$i] } else { $null }
        $t = if (($i + $offset) -lt $tgtLines.Count -and ($i + $offset) -ge 0) { $tgtLines[$i + $offset] } else { $null }

        if ($s -eq $t) { $i++; continue }

        # 行不等：在偏移窗口内搜索匹配（容忍少量行插入/删除造成的错位）
        $matched = $false
        foreach ($delta in @(-30..30)) {
            $j = $i + $delta
            if ($j -lt 0 -or $j -ge $tgtLines.Count) { continue }
            if ($srcLines[$i] -eq $tgtLines[$j]) {
                $offset = $delta - 0
                # 将偏移量累计修正：新偏移 = 目标索引 - 源索引
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
