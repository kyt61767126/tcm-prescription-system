# entry-selfheal.ps1 - 一键打包.bat / 一键发布.bat 入口共享自检（单一权威源）
# 2026-09-05 架构收敛：原两个 bat 各自硬编码同一份 8 个下游 bat 的 CRLF 自检列表
#   （双源漂移：新增下游 bat 需改两处，漏一处即隐患）。现统一收口到本脚本：
#   新增/删除下游构建 bat 只改 $DownstreamBuildBats 这一处。
# 自检项：
#   1. 下游构建 .bat 行尾 CRLF 修复（Git/IDE 可能转 LF 导致 cmd 解析异常）
#   2. 全量 .ps1 UTF-8 BOM 修复（IDE 编辑可能剥 BOM，PS5.1 按 GBK 误读中文崩脚本）
# 退出码：0=通过（含自愈修复）；1=自检工具缺失等异常（入口 bat 据此中止）
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent

# ★ 下游构建 bat 清单（唯一权威源；两个入口 bat 共用）
$DownstreamBuildBats = @(
    'app_project\db-yunduan\pack-desktop.bat'
    'app_project\db-yunduan\build-pack.bat'
    'app_project\db-yunduan\build-app.bat'
    'app_project\db-yunduan\cloud_desktop\build.bat'
    'app_project\db-offline\pack-desktop.bat'
    'app_project\db-offline\build-pack.bat'
    'app_project\db-offline\app\build-app.bat'
    'app_project\db-offline\desktop\build.bat'
)

# 1. CRLF 自愈
$crlfTool = Join-Path $PSScriptRoot 'fix-bat-crlf.ps1'
if (-not (Test-Path $crlfTool)) {
    Write-Host "[entry-selfheal][ERROR] 缺少工具: fix-bat-crlf.ps1" -ForegroundColor Red
    exit 1
}
$existing = @($DownstreamBuildBats | ForEach-Object { Join-Path $root $_ } | Where-Object { Test-Path $_ })
if ($existing.Count -gt 0) {
    Write-Host "[entry-selfheal] CRLF check: $($existing.Count) downstream .bat files"
    & powershell -NoProfile -ExecutionPolicy Bypass -File $crlfTool @existing
}

# 2. ps1 BOM 自愈（全量扫描，仅显示 [FIX]/Summary 行）
$bomTool = Join-Path $PSScriptRoot 'fix-ps1-bom.ps1'
if (-not (Test-Path $bomTool)) {
    Write-Host "[entry-selfheal][ERROR] 缺少工具: fix-ps1-bom.ps1" -ForegroundColor Red
    exit 1
}
Write-Host "[entry-selfheal] BOM check: all .ps1 files"
& powershell -NoProfile -ExecutionPolicy Bypass -File $bomTool |
    Where-Object { $_ -match '\[FIX\]' -or $_ -match 'Summary:' } | ForEach-Object { Write-Host $_ }

exit 0
