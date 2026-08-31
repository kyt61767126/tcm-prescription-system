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

Write-Host ""
Write-Host ("RESULT: {0} pass / {1} fail" -f $pass, $fail)
if ($fail -gt 0) { exit 1 }
