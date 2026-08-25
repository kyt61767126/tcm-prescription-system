# ============================================================================
#  verify-role-centralized.ps1 - 角色判断收口门禁（一期方案·2026-08-25）
#
#  目的：防止业务代码重新出现手写"多角色复合散判"（2.20 教训：6 处 x 3 文件
#        手工同步漏改）。角色判断必须收口到 AuthCore.isAdmin/isClinicAdmin。
#
#  扫描规则（宁漏检不可误报）：
#    - 仅扫 6 份 index.html 业务副本（不扫 auth-core.js 实现本身）
#    - 检测 'admin' 在前的复合散判（权限判断惯例顺序）：
#        X.role === 'admin' || X.role === 'clinic_admin' [|| X.role === 'platform_admin']
#        X.role !== 'admin' && X.role !== 'clinic_admin' [&& ...]
#    - 不扫单角色 role === 'admin'（离线版/option value/显示分支有合法场景）
#    - 不扫显示文案分支（'clinic_admin' || 'admin' 顺序，属展示映射非权限判断）
#
#  退出码：0=通过  1=发现散判（禁止发布）
# ============================================================================
param(
    [string]$RepoRoot = ""
)

$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) {
    $RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}

# 6 份业务 index.html（云端 3 + 离线 2 + 根目录离线源码 1）
$targets = @(
    (Join-Path $RepoRoot 'public\index.html'),
    (Join-Path $RepoRoot 'app_project\db-yunduan\cloud_desktop\index.html'),
    (Join-Path $RepoRoot 'app_project\db-yunduan\cloud_app\app\src\main\assets\public\index.html'),
    (Join-Path $RepoRoot 'app_project\db-offline\desktop\index.html'),
    (Join-Path $RepoRoot 'app_project\db-offline\app\app\src\main\assets\public\index.html'),
    (Join-Path $RepoRoot 'index.html')
)

# 复合散判正则：'admin' 在前（=== 或 !==，后跟 || 或 &&，再跟 clinic_admin 判断）
$pattern = "\.role\s*(===|!==)\s*'admin'\s*(\|\||&&)\s*[\w\.\[\]]+\.role\s*(===|!==)\s*'clinic_admin'"

$findings = @()
$scanned = 0

foreach ($file in $targets) {
    if (-not (Test-Path $file)) {
        Write-Host "[WARN] 文件不存在(跳过): $file" -ForegroundColor Yellow
        continue
    }
    $scanned++
    $rel = $file.Replace($RepoRoot + '\', '')
    $lineNo = 0
    foreach ($line in [System.IO.File]::ReadAllLines($file)) {
        $lineNo++
        if ($line -match $pattern) {
            $findings += ("{0}:{1}" -f $rel, $lineNo)
        }
    }
}

Write-Host ""
Write-Host "角色判断收口门禁（扫描 $scanned 份 index.html）" -ForegroundColor Cyan

if ($findings.Count -eq 0) {
    Write-Host "[OK] 未发现手写多角色复合散判（角色判断已收口 AuthCore）" -ForegroundColor Green
    exit 0
}

Write-Host ("[FAIL] 发现 {0} 处手写复合角色散判，请改为 AuthCore.isAdmin/isClinicAdmin 调用:" -f $findings.Count) -ForegroundColor Red
foreach ($f in $findings) {
    Write-Host "    - $f" -ForegroundColor Red
}
exit 1
