# entry-preflight.ps1 - 一键打包.bat / 一键发布.bat 入口预检（单一权威源）
# ★ 2026-10-30 P0 去重：原两个入口 bat 各自硬编码同一份 git 状态检查 + entry-selfheal
#   调用块（约 60 行/份，唯一实质差异 = 发布对 behind upstream 硬停）。现统一到本脚本：
#     Mode=pack      构建前：git 状态仅提示（不阻断）+ 入口自愈（BOM/CRLF 修复）
#     Mode=pack-post 构建后：再次提示 git 状态（提醒 ahead 需 git push 后再发布）
#     Mode=publish   发布前：behind upstream 硬停（exit 2）+ 入口自愈
# 退出码：0=可继续；2=发布前落后上游（需 git pull --rebase）；其他=入口自愈失败
param(
    [ValidateSet('pack', 'pack-post', 'publish')]
    [string]$Mode = 'pack'
)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
. (Join-Path $PSScriptRoot 'noise-reduce.ps1')

function Get-GitCount([string]$Range) {
    $out = @(& git rev-list --count $Range 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $out) { return $null }
    $v = "$($out[0])".Trim()
    if ($v -match '^\d+$') { return [int]$v }
    return $null
}

$ahead = Get-GitCount '@{u}..HEAD'
$behind = Get-GitCount 'HEAD..@{u}'

$dirty = $false
& git diff --quiet 2>$null
if ($LASTEXITCODE -ne 0) { $dirty = $true }
& git diff --cached --quiet 2>$null
if ($LASTEXITCODE -ne 0) { $dirty = $true }

if ($Mode -eq 'publish') {
    # 发布前落后上游 = 硬停：中途 push 会被拒绝，官网可能回退到旧版
    if ($null -ne $behind -and $behind -gt 0) {
        Write-Host "[ERROR] 本地分支落后上游 $behind 个提交，禁止发布" -ForegroundColor Red
        Write-Host "  请先执行: git pull --rebase，然后重跑本入口。" -ForegroundColor Yellow
        exit 2
    }
    if ($dirty) { Write-Host "  [INFO] 检测到未提交改动 —— 发布链的源码落定门可能中止（先 commit 更稳）" -ForegroundColor Yellow }
    if ($null -ne $ahead -and $ahead -gt 0) { Write-Host "  [INFO] 本地领先上游 $ahead 个提交 —— 发布时会先 push" -ForegroundColor Yellow }
} else {
    if ($dirty) { Write-Host "  [WARN] 检测到未提交改动（$Mode）—— AutoCommit 只收纳版本副作用，其余需人工提交" -ForegroundColor Yellow }
    if ($null -ne $behind -and $behind -gt 0) { Write-Host "  [WARN] 落后上游 $behind 个提交（$Mode）—— 建议 git pull --rebase，避免在过期基线上打包" -ForegroundColor Yellow }
    if ($null -ne $ahead -and $ahead -gt 0) { Write-Host "  [WARN] 领先上游 $ahead 个提交（$Mode）—— 发布前请 git push，否则发布的是本地独有提交" -ForegroundColor Yellow }
}

# 构建后只做状态提示，不重复自愈（省时间）
if ($Mode -eq 'pack-post') { exit 0 }

$heal = Join-Path $PSScriptRoot 'entry-selfheal.ps1'
if (-not (Test-Path $heal)) {
    Write-Host "  [WARN] tools\entry-selfheal.ps1 不存在，跳过入口自愈（不阻断）" -ForegroundColor Yellow
    exit 0
}
$healRc = Invoke-QuietProcess -FilePath 'powershell' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $heal)
if ($healRc -ne 0) {
    Write-Host "[ERROR] 入口自愈失败，退出码: $healRc" -ForegroundColor Red
    exit $healRc
}
exit 0
