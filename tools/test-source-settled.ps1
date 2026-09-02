# ============================================================================
# test-source-settled.ps1 — 源码落定门永久单测（2026-08-31 举一反三）
#
# 背景：门禁上线次日 build.gradle versionCode 误拦（用户实报），当时测试
#   是 tools/_tmp 临时脚本用完即删——回归无守护。本测试转为永久资产并入
#   CI（verify-unified.yml 第 5 道防线），守护两类回归：
#   ① 白名单漏项（新增打包副作用类型未登记 → 用户打包误拦）
#   ② 白名单开洞（整文件放行了真实源码 → 半成品代码装进安装包）
#
# 断言法：纯函数断言（不依赖工作区状态，CI 稳）+ 差值集成断言
#   （改文件前后 blockers 计数差，不依赖基线干净）。
#   注意：改 UTF-8 中文文件必须 [IO.File]::WriteAllText + UTF8，
#   PS5.1 Set-Content 默认 GBK 会写坏文件产生假 diff（当日实测坑）。
# ============================================================================$
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'source-settled.ps1')

$script:pass = 0; $script:fail = 0
function Check([string]$name, [bool]$cond) {
    if ($cond) { Write-Host "  [PASS] $name" -ForegroundColor Green; $script:pass++ }
    else       { Write-Host "  [FAIL] $name" -ForegroundColor Red;   $script:fail++ }
}
function Restore([string]$p) { & git checkout -- $p 2>$null }

$utf8 = New-Object System.Text.UTF8Encoding($false)
function EditFile([string]$p, [string]$find, [string]$repl) {
    $abs = Join-Path (Split-Path $PSScriptRoot -Parent) $p
    $c = [System.IO.File]::ReadAllText($abs, [System.Text.Encoding]::UTF8)
    [System.IO.File]::WriteAllText($abs, ($c -replace $find, $repl), $utf8)
}

Write-Host "=== A. 纯函数断言（Test-IsPackSideEffect）==="
Check 'A1 package.json 副作用'      (Test-IsPackSideEffect -GitPath 'app_project/db-yunduan/cloud_desktop/package.json')
Check 'A2 build-meta.json 副作用'   (Test-IsPackSideEffect -GitPath 'app_project/db-yunduan/cloud_desktop/build-meta.json')
Check 'A3 hash-manifest 副作用'     (Test-IsPackSideEffect -GitPath 'public/hash-manifest.json')
Check 'A4 index.html 非副作用'      (-not (Test-IsPackSideEffect -GitPath 'public/index.html'))
Check 'A5 js 非副作用'              (-not (Test-IsPackSideEffect -GitPath 'tools/verify-payqr.cjs'))
Check 'A6 gradle 纯版本行副作用'    (Test-IsPackSideEffect -GitPath 'app_project/db-yunduan/cloud_app/app/build.gradle' -DiffLines @('-        versionCode 256','+        versionCode 257'))
Check 'A7 gradle 混源码行拦截'      (-not (Test-IsPackSideEffect -GitPath 'app_project/db-yunduan/cloud_app/app/build.gradle' -DiffLines @('-        versionCode 256','+        minSdkVersion 24')))
Check 'A8 gradle 签名配置拦截'      (-not (Test-IsPackSideEffect -GitPath 'app_project/db-yunduan/cloud_app/app/build.gradle' -DiffLines @('-            enableV1Signing true','+            enableV1Signing false')))
Check 'A9 非 app_project 的 gradle 拦截' (-not (Test-IsPackSideEffect -GitPath 'other/build.gradle' -DiffLines @('- versionCode 1','+ versionCode 2')))
Check 'A14 官网下载产物放行（发布复制 APK）'  (Test-IsPackSideEffect -GitPath 'public/downloads/惠康中医-云端.apk')
Check 'A15 官网更新清单放行（latest.json）'   (Test-IsPackSideEffect -GitPath 'public/updates/local/latest.json')
Check 'A16 public 源码目录不误放'            (-not (Test-IsPackSideEffect -GitPath 'public/js/main.js'))

Write-Host "=== A2. 产物形态黑名单（build_output 残留事故回归，build-skip.ps1）==="
# 复刻 2026-08-31 事故：?? 未跟踪的 build_output_时间戳/ 变体不算源码脏。
# 从 build-skip.ps1 源文本解析真实 $productShapePatterns（不自测自）。
$bs = Get-Content (Join-Path $PSScriptRoot 'build-skip.ps1') -Raw
Check 'A10 build-skip 含产物形态黑名单' ($bs -match 'productShapePatterns')
$patBlock = [regex]::Match($bs, '\$productShapePatterns\s*=\s*@\((?s)(.*?)\)').Groups[1].Value
$realPatterns = @([regex]::Matches($patBlock, "'([^']+)'") | ForEach-Object { $_.Groups[1].Value })
Check 'A11 解析出 ≥4 条真实模式' ($realPatterns.Count -ge 4)
$productShapes = @('build_output_20260829_063608', '_backup_asar', 'win-unpacked', 'dist_old_1', 'dist_new')
$shapeAll = $true
foreach ($s in $productShapes) {
    $hit = $false
    foreach ($p in $realPatterns) { if ($s -match $p) { $hit = $true; break } }
    if (-not $hit) { $shapeAll = $false; Write-Host "    miss: $s" }
}
Check 'A12 五类产物形态全部命中真实模式' $shapeAll
Check 'A13 源文件不误命中（index.html）' (-not ($realPatterns | Where-Object { 'public' -match $_ }))

Write-Host "=== B. 差值集成断言（真实文件改动 → blockers 差值）==="
$BG = 'app_project/db-yunduan/cloud_app/app/build.gradle'
$PJ = 'app_project/db-yunduan/cloud_desktop/package.json'
$SRC = 'tools/verify-payqr.cjs'
$base = @(Get-SourceSettledBlockers).Count
Check 'B1 基线可读取' ($base -ge 0)

EditFile $BG 'versionCode (\d+)' 'versionCode 9999'
$r = @(Get-SourceSettledBlockers).Count
Check 'B2 gradle 纯版本递增 +0（2026-08-31 误报场景复刻）' ($r -eq $base)
Restore $BG

EditFile $BG 'minSdkVersion' "// tamper`n        minSdkVersion"
$r = @(Get-SourceSettledBlockers).Count
Check 'B3 gradle 源码行改动 +1' ($r -eq ($base + 1))
Restore $BG

EditFile $SRC '(\S)$' "`$1`n// tmp-test"
$r = @(Get-SourceSettledBlockers).Count
Check 'B4 普通源码改动 +1' ($r -eq ($base + 1))
Restore $SRC

EditFile $BG 'versionCode (\d+)' 'versionCode 9998'
EditFile $PJ '"version": "([\d.]+)"' '"version": "9.9.9"'
$r = @(Get-SourceSettledBlockers).Count
Check 'B5 副作用组合（版本+元数据）+0' ($r -eq $base)
Restore $BG; Restore $PJ

Write-Host "=== C. Node/CI 出口（source-settled.ps1 -Assert，发布链路前置）==="
# B6：人为制造源码改动 → Assert 必须 exit 1 + SOURCE_NOT_SETTLED 输出
# ★ 2026-09-02 跨平台修复：子进程 shell 跟随当前宿主（CI ubuntu 只有 pwsh 无 powershell，
#   硬编码 powershell 导致第 5 道门在 GitHub runner 上必炸——此前多轮 CI 红灯的真根因）
$psExe = if ($PSVersionTable.PSEdition -eq 'Core') { 'pwsh' } else { 'powershell' }
EditFile $SRC '(\S)$' "`$1`n// assert-test"
$ss = Join-Path $PSScriptRoot 'source-settled.ps1'
$out = & $psExe -NoProfile -ExecutionPolicy Bypass -File $ss -Assert 2>&1
$code = $LASTEXITCODE
Check 'B6 源码脏 → Assert exit 1 + 标记' ($code -eq 1 -and (($out | Out-String) -match 'SOURCE_NOT_SETTLED'))
Restore $SRC
$base2 = @(Get-SourceSettledBlockers).Count
if ($base2 -eq 0) {
    # 仅干净树可测（CI 检出即干净必跑；本地开发树脏时 SKIP 防假失败）
    EditFile $BG 'versionCode (\d+)' 'versionCode 9997'
    $out2 = & $psExe -NoProfile -ExecutionPolicy Bypass -File $ss -Assert 2>&1
    $c2 = $LASTEXITCODE
    Restore $BG
    Check 'B7 副作用文件 → Assert 放行（exit 0）' ($c2 -eq 0 -and (($out2 | Out-String) -match 'SOURCE_SETTLED=OK'))
} else {
    Write-Host "  [SKIP] B7 需干净树（本地开发树脏时跳过，CI 必跑）" -ForegroundColor Yellow
}

Write-Host ""
Write-Host ("RESULT: {0} pass / {1} fail" -f $pass, $fail)
if ($fail -gt 0) { exit 1 }
