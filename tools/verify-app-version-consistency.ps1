# ============================================================================
#  verify-app-version-consistency.ps1
#  ★ 2026-08-17 新增：打包前强制版本号一致性预检（举一反三杜绝回滚）
#  检查所有 __APP_VERSION__ / EXPECTED_APP_VERSION 副本是否一致。
#  任何不一致直接 exit 1 终止打包，防止带病打包上线后用户反复反馈"问题依旧"。
#
#  用法:
#    powershell -NoProfile -ExecutionPolicy Bypass -File verify-app-version-consistency.ps1 -Target <cloud|offline|all> [-RepoRoot <repo根目录>]
#
#  参数:
#    -Target   cloud  = 仅检查云端版本号（public/index.html + cloud_desktop/index.html + cloud_app MainActivity）
#              offline = 仅检查离线版本号（index-app.html + desktop/index.html）
#              all     = 全部检查（默认）
#    -RepoRoot 项目根目录（可选，默认自动向上查找）
# ============================================================================
param(
    [ValidateSet('cloud','offline','all')]
    [string]$Target = 'all',
    [string]$RepoRoot = ''
)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

# --- 定位仓库根目录 ---
if ([string]::IsNullOrEmpty($RepoRoot)) {
    $p = Split-Path $MyInvocation.MyCommand.Path -Parent
    while ($p -and -not (Test-Path (Join-Path $p '.git'))) { $p = Split-Path $p -Parent }
    if (-not $p) { $p = Split-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) -Parent }
    $RepoRoot = $p
}
Write-Host "============================================"
Write-Host "  版本号一致性预检 (Target: $Target)"
Write-Host "  RepoRoot: $RepoRoot"
Write-Host "============================================"

$errors = @()
$warns  = @()

function Extract-Version($file, $pattern, $label) {
    if (-not (Test-Path $file)) {
        $script:warns += "[$label] 文件不存在: $file"
        return $null
    }
    $raw = Get-Content $file -Raw -Encoding UTF8
    if ($raw -match $pattern) {
        $ver = $matches[1]
        Write-Host "  [OK] $label = $ver  ($file)"
        return $ver
    } else {
        $script:errors += "[$label] 未匹配到版本号: $file"
        return $null
    }
}

$all_versions = @{}

# ============== 云端版本号组 ==============
if ($Target -eq 'cloud' -or $Target -eq 'all') {
    Write-Host ""
    Write-Host "--- [云端组] 三要素必须一致 ---"
    $pub     = Extract-Version (Join-Path $RepoRoot 'public\index.html')  "__APP_VERSION__\s*=\s*'([^']+)'"  "PUBLIC __APP_VERSION__ (真源)"
    $cd      = Extract-Version (Join-Path $RepoRoot 'app_project\db-yunduan\cloud_desktop\index.html') "__APP_VERSION__\s*=\s*'([^']+)'"  "CLOUD_DESKTOP __APP_VERSION__"
    $caMain  = Join-Path $RepoRoot 'app_project\db-yunduan\cloud_app\app\src\main\java\com\tcm\prescription\MainActivity.java'
    $ca      = Extract-Version $caMain 'EXPECTED_APP_VERSION\s*=\s*"([^"]+)"'  "CLOUD_APP EXPECTED_APP_VERSION"

    if ($pub)  { $all_versions['PUBLIC']        = $pub }
    if ($cd)   { $all_versions['CLOUD_DESKTOP'] = $cd }
    if ($ca)   { $all_versions['CLOUD_APP']     = $ca }

    $vals = @()
    if ($pub) { $vals += $pub }
    if ($cd)  { $vals += $cd }
    if ($ca)  { $vals += $ca }
    if ($vals.Count -ge 2) {
        $first = $vals[0]
        foreach ($v in $vals) {
            if ($v -ne $first) {
                $script:errors += "[云端组FATAL] 三要素不一致！public=$pub, cloud_desktop=$cd, cloud_app=$ca"
                break
            }
        }
    }
}

# ============== 离线版本号组 ==============
if ($Target -eq 'offline' -or $Target -eq 'all') {
    Write-Host ""
    Write-Host "--- [离线组] index-app.html 与 desktop/index.html 必须一致 ---"
    $offApp  = Extract-Version (Join-Path $RepoRoot 'app_project\db-offline\index-app.html') "__APP_VERSION__\s*=\s*'([^']+)'"  "OFFLINE index-app.html"
    $offDesk = Extract-Version (Join-Path $RepoRoot 'app_project\db-offline\desktop\index.html') "__APP_VERSION__\s*=\s*'([^']+)'" "OFFLINE desktop/index.html"
    if ($offApp) { $all_versions['OFFLINE_APP']     = $offApp }
    if ($offDesk){ $all_versions['OFFLINE_DESKTOP'] = $offDesk }

    if ($offApp -and $offDesk -and $offApp -ne $offDesk) {
        $script:errors += "[离线组FATAL] 版本号不一致！index-app.html=$offApp, desktop/index.html=$offDesk"
    }
}

# ============== 汇总输出 ==============
Write-Host ""
Write-Host "--- 汇总 ---"
foreach ($k in $all_versions.Keys) {
    Write-Host ("  {0,-20} -> {1}" -f $k, $all_versions[$k])
}

if ($warns.Count -gt 0) {
    Write-Host ""
    Write-Host ("[WARN] 共 {0} 条警告（非致命，仅提示文件不存在或跳过）：" -f $warns.Count)
    foreach ($w in $warns) { Write-Host "  - $w" }
}

if ($errors.Count -gt 0) {
    Write-Host ""
    Write-Host ("[FATAL] 共 {0} 条错误！版本号不一致，打包已强行终止！" -f $errors.Count) -ForegroundColor Red
    foreach ($e in $errors) { Write-Host "  X $e" -ForegroundColor Red }
    Write-Host ""
    Write-Host "  修复方法："
    Write-Host "  1) 修改版本号时，云端只改 <repo>/public/index.html 的 __APP_VERSION__（真源）"
    Write-Host "     然后运行 db-yunduan/sync-app-version.ps1 自动双向同步到其他副本"
    Write-Host "  2) 离线只改 <repo>/app_project/db-offline/index-app.html，再同步到 desktop/index.html"
    Write-Host "  3) 重新运行本脚本，确认 [FATAL] 清零后再打包"
    exit 1
}

Write-Host ""
Write-Host "[PASS] 版本号一致性预检通过 OK" -ForegroundColor Green
exit 0
