# ============================================================================
#  verify-version-display.ps1
#  版本展示一致性检查 —— 把"8处版本标识位置"手工规范自动化(三原则落地)
#
#  背景(2026-08-18)：规范执行三原则。原"修改版本号必须检查8处版本标识位置
#  (version-tag/tab-hint/textContent/console.log/alert/exportInfo.version/
#   login.html version-tag/index.html <title>)" 纯手工、靠自觉，极易漏改，
#   与"唯一权威源/可自证/分级不误报"三原则相悖。本脚本将其固化为自动门禁。
#
#  原理：
#   - 原则一(唯一权威源)：版本展示值(形如 V1.0.0)在全部界面副本中必须唯一一致，
#     不允许任何独立硬编码与之背离。
#   - 原则二(可自证+可行动)：逐一报告每个文件抽取到的版本 token、缺失情况、
#     以及修复指引(统一改到真源后同步)。
#   - 原则三(分级+宁漏检不可误报)：仅当"确定矛盾"(不同文件/同文件内版本 token
#     出现 ≥2 种)才 FATAL 阻止；无版本 token(模板不显示版本)只 WARN 不阻断。
#
#  用法:
#    powershell -NoProfile -ExecutionPolicy Bypass -File tools\verify-version-display.ps1
#  返回: 0 = 通过(版本展示全一致), 1 = 存在版本展示不一致(禁止带错版打包)
# ============================================================================
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot

# 全部界面副本(展示版本可能出现的文件)。缺文件只 WARN，不误报。
# ★ 2026-11-21 链路深度优化：按产品分组判定（跨端版本号不要求统一）。
#   云端组（cloud）与离线组（offline）各自独立；组内不一致仍 FATAL（端内一致性，
#   防止单产品界面显示错乱）；跨组版本不同降为 WARN 放行（各端独立递增属预期）。
$groups = [ordered]@{
    'cloud' = @(
        'public\index.html',
        'public\electron\login.html',
        'app_project\db-yunduan\cloud_desktop\index.html',
        'app_project\db-yunduan\cloud_desktop\electron\login.html'
    )
    'offline' = @(
        'app_project\db-offline\index-app.html',
        'app_project\db-offline\desktop\index.html',
        'app_project\db-offline\desktop\electron\login.html'
    )
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  版本展示一致性检查 (8 处版本标识自动化)" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# 版本展示 token 正则：匹配 V主版.次版[.修订] 形如 V1.0.0（本仓库唯一命中即展示版本）
$tokenRe = 'V\d+(\.\d+)+'

$fileTokens = @{}   # 文件 -> 有序去重 token 列表
$missing = @()

# 展开分组为平铺清单（扫描用；分组判定见下方）
$files = @()
foreach ($g in $groups.Keys) { $files += $groups[$g] }

foreach ($rel in $files) {
    $path = Join-Path $root $rel
    if (-not (Test-Path $path)) {
        $missing += $rel
        Write-Host ("  [WARN] 副本缺失(模板差异，不阻断): {0}" -f $rel) -ForegroundColor Yellow
        continue
    }
    $content = Get-Content $path -Raw -Encoding UTF8
    $tokens = @()
    foreach ($m in [regex]::Matches($content, $tokenRe)) {
        if ($tokens -notcontains $m.Value) { $tokens += $m.Value }
    }
    if ($tokens.Count -eq 0) {
        Write-Host ("  [WARN] <{0}> 未检出版本 token(模板不显示版本，不阻断)" -f $rel) -ForegroundColor Yellow
    } else {
        Write-Host ("  [  ] {0}  ->  {1}" -f $rel, ($tokens -join ' , ')) -ForegroundColor Gray
    }
    $fileTokens[$rel] = $tokens
}

Write-Host ""
Write-Host "--- 按产品分组判定（组内必须一致；跨组不要求统一）---" -ForegroundColor Cyan

$groupTokens = [ordered]@{}   # 组名 -> 该组全部 token（有序去重）
$groupFileTokens = [ordered]@{}   # 组名 -> 文件 -> token 列表
foreach ($g in $groups.Keys) {
    $gAll = @()
    $gFiles = @{}
    foreach ($rel in $groups[$g]) {
        $tokens = $fileTokens[$rel]
        if ($null -eq $tokens) { continue }
        $gFiles[$rel] = $tokens
        foreach ($t in $tokens) { if ($gAll -notcontains $t) { $gAll += $t } }
    }
    $groupTokens[$g] = $gAll
    $groupFileTokens[$g] = $gFiles
    $gLabel = switch ($g) { 'cloud' { '云端' } 'offline' { '离线' } default { $g } }
    if ($gAll.Count -le 1) {
        Write-Host ("  [PASS] {0}组 版本唯一: {1}" -f $gLabel, $(if ($gAll.Count -eq 1) { $gAll[0] } else { '无/单值' })) -ForegroundColor Green
    } else {
        Write-Host ("  [FATAL] {0}组 版本展示不一致！检出 {1} 种版本: {2}" -f $gLabel, $gAll.Count, ($gAll -join ' / ')) -ForegroundColor Red
        foreach ($rel in $gFiles.Keys) {
            $tokens = $gFiles[$rel]
            if ($tokens.Count -gt 1) {
                Write-Host ("     X <{0}> 文件内部版本不一致: {1}(改了一处漏了另一处)" -f $rel, ($tokens -join ' / ')) -ForegroundColor Red
            }
        }
    }
}

# 组内 FATAL 判定（任一组内 ≥2 种 token 即失败）
foreach ($g in $groupTokens.Keys) {
    if ($groupTokens[$g].Count -gt 1) {
        Write-Host ""
        Write-Host "[FATAL] 存在组内版本展示不一致（见上方 X 行）——先修复组内一致性再打包" -ForegroundColor Red
        Write-Host "  修复指引(唯一权威源)：以各组真源先行修改（云端 public\index.html / 离线 desktop\index.html）" -ForegroundColor Yellow
        Write-Host "  再用 sync 脚本统一同步到组内副本，重跑本脚本确认组内 [PASS]。" -ForegroundColor Yellow
        exit 1
    }
}

# 跨组版本不同 → WARN 放行（2026-11-21 起各端独立递增属预期，不再要求统一）
$crossAll = @()
foreach ($g in $groupTokens.Keys) {
    foreach ($t in $groupTokens[$g]) { if ($crossAll -notcontains $t) { $crossAll += $t } }
}
if ($crossAll.Count -gt 1) {
    $parts = @()
    foreach ($g in $groupTokens.Keys) {
        $gLabel = switch ($g) { 'cloud' { '云端' } 'offline' { '离线' } default { $g } }
        $parts += ("{0}组={1}" -f $gLabel, ($groupTokens[$g] -join '/'))
    }
    Write-Host ""
    Write-Host ("[WARN] 跨产品版本号不同（不要求统一，放行）: {0}" -f ($parts -join '  ')) -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[PASS] 版本展示组内一致性 OK" -ForegroundColor Green
if ($missing.Count -gt 0) {
    Write-Host ("  (提示: {0} 个副本未纳入，模板差异，属预期)" -f $missing.Count) -ForegroundColor Yellow
}
exit 0