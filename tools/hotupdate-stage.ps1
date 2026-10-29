# hotupdate-stage.ps1 - 三通道热更包「检查 / 签发 / 校验」（发布链阶段 1.5）
# ★ 2026-10-30 P1：根治「源码与整包已上线，客户端却收不到热更」缺口。
#   此前 one-click-pack / release-menu / publish-release / auto-publish 全都不生成热更包，
#   全靠人工记得重签；漏签即静默失效（2026-10-29 实测：线上 hotVersion 未变 →
#   客户端判定"已是最新"，不下载、无淡绿横幅）。
#
# 通道（三条，各自独立签名）：
#   desktop/cloud  云桌面      generate-desktop-hotupdate.cjs -c cloud
#   desktop/local  离线桌面    generate-desktop-hotupdate.cjs -c local
#   app-local      离线 APP    generate-app-hotupdate.cjs
#
# 用法：
#   -Mode Check  [-Channels 'desktop/cloud,desktop/local']   只读比对（逗号分隔；省略=三通道）
#   -Mode Sign   [-Channels ...] [-Commit]                    按需重签，-Commit 自动提交并推送
#   -Mode Verify                                              校验三通道签名 + 清单 + 逐文件哈希
#
# ★ 2026-10-30 坑：powershell -File 模式下 [string[]] 参数**不接受空格分隔多值**
#   （会报 PositionalParameterNotFound），因此 Channels 用单字符串 + 逗号分隔，
#   内部再 split。调用方（release-menu）统一传 ($arr -join ',')。
#
# 退出码：Check  0=三通道都已最新 / 2=有落后通道需签发 / 1=检查失败
#          Sign   0=签发成功或无需签发 / 1=签发、校验或提交失败
#          Verify 0=全部通过 / 1=有不通过项
# 保险丝：SKIP_HOTUPDATE=1 跳过签发（打印提示，退出 0）
[CmdletBinding()]
param(
    [ValidateSet('Check', 'Sign', 'Verify')]
    [string]$Mode = 'Check',
    [string]$Channels = '',
    [switch]$Commit
)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
. (Join-Path $PSScriptRoot 'noise-reduce.ps1')

$hotDefs = [ordered]@{
    'desktop/cloud' = @{ Label = '云桌面';   Gen = 'generate-desktop-hotupdate.cjs'; GenArgs = @('-c', 'cloud') }
    'desktop/local' = @{ Label = '离线桌面'; Gen = 'generate-desktop-hotupdate.cjs'; GenArgs = @('-c', 'local') }
    'app-local'     = @{ Label = '离线 APP'; Gen = 'generate-app-hotupdate.cjs';     GenArgs = @() }
}

# 逗号分隔 → 通道数组（-File 模式不能传空格分隔多值）
$channelList = @($Channels -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
if ($channelList.Count -eq 0) {
    $channelList = @('desktop/cloud', 'desktop/local', 'app-local')
}
$unknown = @($channelList | Where-Object { -not $hotDefs.Contains($_) })
if ($unknown.Count -gt 0) {
    Write-Host ("[ERROR] 未知热更通道: {0}" -f ($unknown -join ', ')) -ForegroundColor Red
    exit 1
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] 未找到 node，无法检查/签发热更包" -ForegroundColor Red
    exit 1
}

function Invoke-HotGenCheck([string]$key) {
    $d = $hotDefs[$key]
    $scriptPath = Join-Path $PSScriptRoot $d.Gen
    if (-not (Test-Path $scriptPath)) {
        Write-Host ("[ERROR] 缺少热更生成器: {0}" -f $scriptPath) -ForegroundColor Red
        return 1
    }
    $argList = @($scriptPath) + @($d.GenArgs) + @('--check')
    return Invoke-QuietProcess -FilePath 'node' -ArgumentList $argList -Capture
}

function Invoke-HotGenSign([string]$key) {
    $d = $hotDefs[$key]
    $scriptPath = Join-Path $PSScriptRoot $d.Gen
    $argList = @($scriptPath) + @($d.GenArgs)
    return Invoke-QuietProcess -FilePath 'node' -ArgumentList $argList -Capture
}

function Get-HotVersion([string]$key) {
    $p = Join-Path $root ("public/hot-update/" + $key + "/version.json")
    if (-not (Test-Path $p)) { return '' }
    try { return [string]((Get-Content $p -Raw -Encoding UTF8 | ConvertFrom-Json).hotVersion) } catch { return '' }
}

function Invoke-HotVerifyAll {
    $verifyPath = Join-Path $PSScriptRoot 'verify-hotupdate.cjs'
    if (-not (Test-Path $verifyPath)) {
        Write-Host "[WARN] 缺少 tools\verify-hotupdate.cjs，跳过离线校验" -ForegroundColor Yellow
        return 0
    }
    return Invoke-QuietProcess -FilePath 'node' -ArgumentList @($verifyPath) -Capture
}

# ------------------------- Verify -------------------------
if ($Mode -eq 'Verify') {
    Write-Host ""
    Write-Host "--- 热更包离线校验（签名 + 清单 + 逐文件哈希）---" -ForegroundColor Cyan
    $vrc = Invoke-HotVerifyAll
    if ($vrc -ne 0) {
        Write-Host "[ERROR] 热更包校验未通过（详见上方）" -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] 三通道热更包校验通过" -ForegroundColor Green
    exit 0
}

# ------------------------- Check -------------------------
$stale = @()
$fresh = @()
$checkError = $false
Write-Host ""
Write-Host "--- 热更包检查（比对线上签名清单 vs 当前源码）---" -ForegroundColor Cyan
foreach ($key in $channelList) {
    $rc = Invoke-HotGenCheck $key
    if ($rc -eq 0) {
        $fresh += $key
        Write-Host ("  [最新] {0}（{1}）" -f $hotDefs[$key].Label, (Get-HotVersion $key)) -ForegroundColor Green
    } elseif ($rc -eq 2) {
        $stale += $key
    } else {
        $checkError = $true
        Write-Host ("  [ERROR] {0} 热更检查失败，退出码 {1}" -f $hotDefs[$key].Label, $rc) -ForegroundColor Red
    }
}

if ($Mode -eq 'Check') {
    if ($checkError) { exit 1 }
    if ($stale.Count -gt 0) {
        Write-Host ("[需签发] {0} 个通道内容落后: {1}" -f $stale.Count, ($stale -join ', ')) -ForegroundColor Yellow
        exit 2
    }
    Write-Host "[OK] 所有热更通道都已是最新，无需重签" -ForegroundColor Green
    exit 0
}

# ------------------------- Sign -------------------------
if ($env:SKIP_HOTUPDATE -eq '1') {
    Write-Host "[SKIP] SKIP_HOTUPDATE=1 —— 跳过热更签发（仅限明确知道线上已最新时使用）" -ForegroundColor Yellow
    exit 0
}
if ($checkError) {
    Write-Host "[ERROR] 热更检查失败，中止签发" -ForegroundColor Red
    exit 1
}
if ($stale.Count -eq 0) {
    Write-Host "[OK] 热更包已是最新，本次无需重签" -ForegroundColor Green
    exit 0
}

Write-Host ""
Write-Host ("--- 热更签发（{0} 个通道）---" -f $stale.Count) -ForegroundColor Cyan
foreach ($key in $stale) {
    Write-Host ("  [签发] {0} ..." -f $hotDefs[$key].Label) -ForegroundColor Yellow
    $grc = Invoke-HotGenSign $key
    if ($grc -ne 0) {
        Write-Host ("[ERROR] {0} 热更签发失败，退出码 {1}" -f $hotDefs[$key].Label, $grc) -ForegroundColor Red
        exit 1
    }
    Write-Host ("  [OK] {0} -> {1}" -f $hotDefs[$key].Label, (Get-HotVersion $key)) -ForegroundColor Green
}

Write-Host ""
Write-Host "--- 签发后离线校验 ---" -ForegroundColor Cyan
$vrc = Invoke-HotVerifyAll
if ($vrc -ne 0) {
    Write-Host "[ERROR] 签发产物校验失败，中止（请勿提交/发布）" -ForegroundColor Red
    exit 1
}

if (-not $Commit) {
    Write-Host "[OK] 热更包已重签（未提交，按需人工 commit）" -ForegroundColor Green
    exit 0
}

# 只提交 public/hot-update（绝不 git add -A，避免把无关工作区改动卷入发布）
$null = Invoke-QuietProcess -FilePath 'git' -ArgumentList @('add', 'public/hot-update') -Capture
$stagedRaw = @(& git diff --cached --name-only -- public/hot-update 2>$null)
$staged = @($stagedRaw | Where-Object { "$_".Trim() -ne '' })
if ($staged.Count -eq 0) {
    Write-Host "[OK] 热更包无差异，无需提交" -ForegroundColor Green
    exit 0
}

$hotVersionText = ($stale | ForEach-Object { $_.Split('/')[1] + '=' + (Get-HotVersion $_) }) -join ' '
$commitMsg = "chore(hotupdate): sign channels ($hotVersionText)"
$crc = Invoke-QuietProcess -FilePath 'git' -ArgumentList @('commit', '-m', $commitMsg) -Capture
if ($crc -ne 0) {
    Write-Host "[ERROR] 热更包提交失败，退出码 $crc" -ForegroundColor Red
    exit 1
}
$prc = Invoke-QuietProcess -FilePath 'git' -ArgumentList @('push') -Capture
if ($prc -ne 0) {
    Write-Host "[ERROR] 热更包已提交但 push 失败（退出码 $prc）—— 线上仍是旧版，客户端不会收到热更" -ForegroundColor Red
    Write-Host "  网络恢复后执行: git push（或重跑 -Mode Sign -Commit）" -ForegroundColor Yellow
    exit 1
}
Write-Host "[OK] 热更包已提交并推送（Pages 部署约 20-60s 后生效）" -ForegroundColor Green
exit 0
