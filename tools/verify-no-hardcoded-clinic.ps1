# ============================================================================
#  verify-no-hardcoded-clinic.ps1
#  ★ 2026-08-17 新增：打包前强制"诊所名/医师名硬编码"反模式扫描（举一反三预防）
#
#  背景：曾发生——用户在基础设置修改诊所名/医师名并重启后，登录框/处方PDF
#  仍回显硬编码"本能堂中医诊所"。根因有二：
#    ① 运行期回退值写死字面量，绕过 CONFIG/localStorage 动态配置；
#    ② config.json 版本(configIssuedAt)变化时强制 removeItem 清空用户已保存值。
#  本工具扫描并阻断这两类"病根反模式"，防止 bug 复发。
#
#  用法:
#    powershell -NoProfile -ExecutionPolicy Bypass -File verify-no-hardcoded-clinic.ps1 [-RepoRoot <repo根目录>]
#  任何违规命中直接 exit 1 终止打包。
# ============================================================================
param([string]$RepoRoot = '')

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrEmpty($RepoRoot)) {
    $p = Split-Path $MyInvocation.MyCommand.Path -Parent
    while ($p -and -not (Test-Path (Join-Path $p '.git'))) { $p = Split-Path $p -Parent }
    if (-not $p) { $p = Split-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) -Parent }
    $RepoRoot = $p
}

Write-Host "============================================"
Write-Host "  诊所名/医师名硬编码反模式扫描 (prevent regression)"
Write-Host "  RepoRoot: $RepoRoot"
Write-Host "============================================"

# 需扫描的运行期产品文件（用户可见三端：网页 / 桌面 / APP）
$scanFiles = @(
    'index.html',
    'public\index.html',
    'site-admin\index.html',
    'app_project\db-offline\index-app.html',
    'app_project\db-offline\desktop\index.html',
    'app_project\db-yunduan\cloud_desktop\index.html',
    'app_project\db-offline\desktop\electron\login.js',
    'app_project\db-yunduan\cloud_desktop\electron\login.js'
)

# 三类病根反模式（正则）
#  A. 处方PDF直接用字面量回退，绕过 CONFIG —— 必须改用 CONFIG.clinicName
$patPdfLiteral   = "document\.getElementById\('clinicName'\)\?\.value\s*\|\|\s*'本能堂"
#  B. CONFIG 之后又兜底字面量 —— CONFIG 已含默认值，冗余字面量会让硬编码复活
$patCfgLiteral   = "CONFIG\.(?:clinicName|doctorName)\s*\|\|\s*'本能堂"
#  C. config 版本变化时强制清空用户已保存诊所名/医师名 —— 必须保留用户配置，仅记录 appliedAt
$patConfigClear  = "if\s*\(\s*_cfgIssued[\s\S]{0,120}removeItem\('local_clinic(Name|Doctor)'\)"

$errors = @()

foreach ($rel in $scanFiles) {
    $file = Join-Path $RepoRoot $rel
    if (-not (Test-Path $file)) {
        Write-Host ("  [SKIP] 文件不存在: {0}" -f $rel)
        continue
    }
    $raw = Get-Content $file -Raw -Encoding UTF8
    foreach ($item in @(
            @('PDF字面量回退(应改CONFIG.clinicName)',  $patPdfLiteral),
            @('CONFIG后冗余字面量',                    $patCfgLiteral),
            @('config版本变化清空用户诊所名',          $patConfigClear)
        )) {
        $label = $item[0]; $pattern = $item[1]
        $m = [regex]::Matches($raw, $pattern)
        if ($m.Count -gt 0) {
            $script:errors += "[$rel] 命中反模式: $label (共 $($m.Count) 处)"
            Write-Host ("  [FAIL] {0} :: {1} :: {2} 处" -f $rel, $label, $m.Count) -ForegroundColor Red
        } else {
            Write-Host ("  [OK]   {0} :: {1}" -f $rel, $label) -ForegroundColor DarkGreen
        }
    }
}

Write-Host ""
if ($errors.Count -gt 0) {
    Write-Host "============================================"
    Write-Host ("  扫描未通过：{0} 处违规，终止打包！" -f $errors.Count) -ForegroundColor Red
    foreach ($e in $errors) { Write-Host ("   - " + $e) -ForegroundColor Yellow }
    Write-Host "  请修改为 CONFIG/localStorage 动态取值后重试。"
    Write-Host "============================================"
    exit 1
} else {
    Write-Host "  扫描通过：未发现诊所名/医师名硬编码反模式。"
    exit 0
}