# ============================================================================
#  verify-role-centralized.ps1 - 角色判断收口门禁（一期方案·2026-08-25 / 三期强化）
#
#  目的：防止业务代码重新出现手写角色散判（2.20 教训：6 处 x 3 文件手工同步
#        漏改）。角色判断必须收口到 AuthCore.isAdmin/isClinicAdmin 及
#        UserAdmin 共享块（二期 shared/user-admin.js 标记块注入）。
#
#  扫描规则（宁漏检不可误报）：
#    - 仅扫 6 份 index.html 业务副本（不扫 auth-core.js 实现本身）
#    - 纯注释行（行首 // 或 * ）跳过：标记块文档注释中含示例代码属合法引用
#    - 规则A 复合散判：'admin' 在前（===/!== + ||/&& + clinic_admin 判断）
#    - 规则B currentUser 单角色散判：currentUser.role ===/!== 'admin'
#      （三期新增：登录用户角色判断一律 AuthCore.isAdmin；云端 clinic_admin 曾被
#        `role !== 'admin'` 误判为普通用户只载自己处方——2026-08-25 二期收口）
#    - 规则C 加载层三元散判：X.role !== 'admin' ? username : null
#      （三期新增：处方加载层过滤收口 UserAdmin.prescriptionFilterUser）
#    - 不扫其他单角色 role === 'admin'（option value/导出显示等合法场景已逐个
#      人工收口，剩余非注释命中见下方"规则C 兜底"说明）
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

# 规则A：'admin' 在前的复合散判（权限判断惯例顺序）
$patternCompound = "\.role\s*(===|!==)\s*'admin'\s*(\|\||&&)\s*[\w\.\[\]]+\.role\s*(===|!==)\s*'clinic_admin'"
# 规则B：currentUser 角色单判（登录用户权限判断必须走 AuthCore）
$patternCurrentUser = "currentUser\s*\??\.role\s*(===|!==)\s*'admin'"
# 规则C：处方加载层三元散判（必须走 UserAdmin.prescriptionFilterUser）
$patternLoadTernary = "\.role\s*!==\s*'admin'\s*\?"

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
        $trimmed = $line.TrimStart()
        # 纯注释行跳过（标记块文档注释中的示例代码属合法引用，宁漏检不可误报）
        if ($trimmed.StartsWith('//') -or $trimmed.StartsWith('*')) { continue }
        $hit = $null
        if ($line -match $patternCompound) { $hit = 'A:复合散判' }
        elseif ($line -match $patternCurrentUser) { $hit = 'B:currentUser单判' }
        elseif ($line -match $patternLoadTernary) { $hit = 'C:加载层三元' }
        if ($hit) {
            $findings += ("{0}:{1} [{2}]" -f $rel, $lineNo, $hit)
        }
    }
}

Write-Host ""
Write-Host "角色判断收口门禁（扫描 $scanned 份 index.html，规则A复合/B currentUser单判/C加载层三元）" -ForegroundColor Cyan

if ($findings.Count -eq 0) {
    Write-Host "[OK] 未发现手写角色散判（权限判断已收口 AuthCore / UserAdmin）" -ForegroundColor Green
    exit 0
}

Write-Host ("[FAIL] 发现 {0} 处角色散判，请改为 AuthCore.isAdmin / UserAdmin.prescriptionFilterUser 调用:" -f $findings.Count) -ForegroundColor Red
foreach ($f in $findings) {
    Write-Host "    - $f" -ForegroundColor Red
}
exit 1
