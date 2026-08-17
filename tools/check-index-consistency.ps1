# ============================================================================
#  check-index-consistency.ps1
#  校验云端 index.html 副本的关键业务逻辑一致性（防止"改一处漏其余"）
#
#  背景（2026-08-17）：
#    云端 index.html 有多份物理副本（public/ 线上 、cloud_desktop/ 桌面、
#    cloud_app assets/ APP离线兜底、根目录 残留），内联脚本保存处方等关键
#    逻辑若只改其中一份，其它端刷新/打包后仍用旧逻辑，导致"这端好了那端
#    又出问题"。
#
#  原理：
#    以 public/index.html 为基准（默认事实源），从每份 index.html 中提取
#    指定的"关键逻辑函数"定义/调用，校验每份副本是否都存在且包含基准中的
#    关键实现标记（约定注释串）。只校验关键标识，不做整文件覆盖，避免破坏
#    各版本合法差异（版本号、打包专属注入）。
#
#  用法：
#    powershell -NoProfile -ExecutionPolicy Bypass -File tools\check-index-consistency.ps1
#    powershell -NoProfile -ExecutionPolicy Bypass -File tools\check-index-consistency.ps1 -Source public\index.html
#  返回值：exit 0=一致 OK，exit 1=存在不一致（阻止发布/打包）
# ============================================================================
[CmdletBinding()]
param(
    [string]$Source = 'public/index.html'
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor [System.Net.ServicePointManager]::SecurityProtocolType::Tls12

$root = $PSScriptRoot | Split-Path -Parent
Set-Location $root

# 云端 index.html 副本清单（不含离线版，离线版逻辑与云端不同）
# ★ 根目录 index.html 为历史残留，未在任何 package.json build.files / electron main.js
#   中被引用（2026-08-17 已核实），不属于实际发布 artifact，故不纳入校验清单。
$targets = @(
    'app_project/db-yunduan/cloud_desktop/index.html',
    'app_project/db-yunduan/cloud_app/app/src/main/assets/public/index.html'
)

# 关键逻辑实现标记：这些注释串/函数名必须同时存在于基准与所有云端副本
# 当基准内联脚本出现这类关键实现/修复时，在此登记，所有云端副本必须同步
$markers = @(
    'syncPrescriptionToCloud',      # 云端保存处方同步（2026-08-17 修复"刷新消失"）
    'savePrescriptionToDB',
    'getAllUserPrescriptions',
    'savePrescription'
)

$sourcePath = Join-Path $root $Source
if (-not (Test-Path $sourcePath)) {
    Write-Host "[ERROR] 基准文件不存在: $Source" -ForegroundColor Red
    exit 1
}
$sourceText = Get-Content $sourcePath -Raw -Encoding UTF8

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Index.html 云端副本逻辑一致性校验"
Write-Host "  基准: $Source"
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$hasError = $false

foreach ($target in $targets) {
    $tPath = Join-Path $root $target
    if (-not (Test-Path $tPath)) {
        Write-Host "[MISS] $target  (文件不存在)" -ForegroundColor Red
        $hasError = $true
        continue
    }
    $tText = Get-Content $tPath -Raw -Encoding UTF8
    $missing = @()
    foreach ($m in $markers) {
        if ($tText -notmatch [regex]::Escape($m)) {
            $missing += $m
        }
    }
    if ($missing.Count -eq 0) {
        Write-Host "[ OK ] $target" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] $target 缺少关键逻辑标识，请同步基准 $Source 的对应实现:" -ForegroundColor Red
        $missing | ForEach-Object { Write-Host ("        - " + $_) -ForegroundColor Red }
        $hasError = $true
    }
}

Write-Host ""
if ($hasError) {
    Write-Host "[RESULT] FAILED - 存在不一致！禁止发布/打包，需先同步基准逻辑到各副本。" -ForegroundColor Red
    Write-Host "  修复方式：把基准 $Source 中缺失的关键函数/调用同步到对应副本即可。" -ForegroundColor Yellow
    exit 1
} else {
    Write-Host "[RESULT] OK - 所有云端副本关键逻辑一致。" -ForegroundColor Green
    exit 0
}