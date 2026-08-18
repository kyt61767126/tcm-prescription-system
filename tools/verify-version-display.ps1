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
$files = @(
    'public\index.html',
    'public\electron\login.html',
    'app_project\db-yunduan\cloud_desktop\index.html',
    'app_project\db-yunduan\cloud_desktop\electron\login.html',
    'app_project\db-offline\index-app.html',
    'app_project\db-offline\desktop\index.html',
    'app_project\db-offline\desktop\electron\login.html'
)

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  版本展示一致性检查 (8 处版本标识自动化)" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# 版本展示 token 正则：匹配 V主版.次版[.修订] 形如 V1.0.0（本仓库唯一命中即展示版本）
$tokenRe = 'V\d+(\.\d+)+'

$fileTokens = @{}   # 文件 -> 有序去重 token 列表
$missing = @()

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

# 汇总所有文件 token，判定是否"确定矛盾"
$all = @()
foreach ($rel in $files) { foreach ($t in $fileTokens[$rel]) { if ($all -notcontains $t) { $all += $t } } }

if ($all.Count -le 1) {
    Write-Host ("[PASS] 版本展示一致性 OK（全局唯一 token: {0}）" -f $(if ($all.Count -eq 1) { $all[0] } else { '无/单值' })) -ForegroundColor Green
    if ($missing.Count -gt 0) {
        Write-Host ("  (提示: {0} 个副本未纳入，模板差异，属预期)" -f $missing.Count) -ForegroundColor Yellow
    }
    exit 0
}

# 存在 ≥2 种版本 token → 确定矛盾，FATAL
Write-Host ("[FATAL] 版本展示不一致！检出 {0} 种版本: {1}" -f $all.Count, ($all -join ' / ')) -ForegroundColor Red
foreach ($rel in $files) {
    $tokens = $fileTokens[$rel]
    if ($tokens.Count -gt 1) {
        Write-Host ("   X <{0}> 文件内部版本不一致: {1}(改了一处漏了另一处)" -f $rel, ($tokens -join ' / ')) -ForegroundColor Red
    }
}
Write-Host "" -ForegroundColor Red
Write-Host "  修复指引(唯一权威源)：" -ForegroundColor Yellow
Write-Host "   1) 确定目标版本值(如 V1.0.0 → V1.1.0)，以云端 public\index.html 为真源先行修改；" -ForegroundColor Yellow
Write-Host "   2) 用 sync/拷贝脚本统一同步到离线副本(desktop、app 各 assets\public 下)；" -ForegroundColor Yellow
Write-Host "   3) 逐个核对 8 处(version-tag/tab-hint/textContent/console.log/alert/exportInfo.version/login 版本tag/<title>)；" -ForegroundColor Yellow
Write-Host "   4) 重跑本脚本确认 [PASS] 后再打包。" -ForegroundColor Yellow
exit 1