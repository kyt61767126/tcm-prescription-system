# ============================================================================
#  verify-auth-secret.ps1 —— 认证密钥安全门禁检查（P1-A，2026-08-19）
#
#  背景：全局符合性审查发现 R1 高风险——functions/api/_lib/auth.js 的
#  AUTH_SECRET 未配置时静默回退默认不安全密钥，攻击者可用公开的默认密钥
#  伪造任意角色 token（含 platform_admin）。已改造为 fail-closed（未配置
#  拒绝签发/拒绝验证）。本脚本把该门禁固化为发布前自动检查，防回归。
#
#  原则（与 verify-version-display.ps1 一致）：
#   - 原则一(唯一权威源)：fail-closed 机制只认 auth.js 单点实现
#   - 原则二(可自证+可行动)：每项失败给出"为什么"与处置路径
#   - 原则三(宁漏检不可误报)：仅确定性错误 FATAL；文件缺失只 WARN
#
#  检查项：
#   A. auth.js fail-closed 机制在位（getSecret 不回退默认密钥 + signToken 抛错
#      + verifyToken 拒验）——防"有人改回静默回退"的回归
#   B. 本地配置文件(.dev.vars / wrangler*.toml)若设置 AUTH_SECRET，
#      不得为默认值或弱值(<16 字符)——防把默认值当配置
#   C. .dev.vars 等密钥文件不得被 git 跟踪——防密钥入库泄露
#
#  用法:
#    powershell -NoProfile -ExecutionPolicy Bypass -File tools\verify-auth-secret.ps1
#  返回: 0 = 通过, 1 = 存在 FATAL 项
# ============================================================================
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
$fatal = 0

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  认证密钥安全门禁检查 (AUTH_SECRET fail-closed)" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# ---------- 检查 A：auth.js fail-closed 机制在位 ----------
$authJs = Join-Path $root 'functions\api\_lib\auth.js'
if (-not (Test-Path $authJs)) {
    Write-Host "  [WARN] functions/api/_lib/auth.js 缺失(工程结构变化，不阻断)" -ForegroundColor Yellow
} else {
    $src = Get-Content $authJs -Raw -Encoding UTF8
    # 三个确定性标记：getSecret 返回 null / signToken 抛错 / verifyToken 拒验
    $markers = @(
        @{ pat = 'AUTH_SECRET 未配置或等于默认不安全值'; desc = 'getSecret fail-closed(不回退默认密钥)' },
        @{ pat = "AUTH_SECRET_NOT_CONFIGURED";             desc = 'signToken 未配置时抛错拒绝签发' },
        @{ pat = '拒绝验证 Token';                          desc = 'verifyToken 未配置时拒绝验证' }
    )
    foreach ($m in $markers) {
        if ($src.Contains($m.pat)) {
            Write-Host ("  [OK] {0}" -f $m.desc) -ForegroundColor Green
        } else {
            Write-Host ("  [FATAL] {0} —— 标记缺失，疑似 fail-closed 被移除(安全回归！)" -f $m.desc) -ForegroundColor Red
            Write-Host "         处置：恢复 functions/api/_lib/auth.js 的 P1-A fail-closed 门禁(见 2026-08-19 提交)" -ForegroundColor Yellow
            $fatal++
        }
    }
    # 防回归：禁止出现"静默回退"写法（getSecret 内把 DEFAULT_SECRET 当返回值）
    if ($src -match 'env\?\.AUTH_SECRET\s*\|\|\s*DEFAULT_SECRET') {
        Write-Host "  [FATAL] getSecret 存在 env?.AUTH_SECRET || DEFAULT_SECRET 静默回退写法！" -ForegroundColor Red
        Write-Host "         处置：改为未配置返回 null(P1-A fail-closed)，禁止默认密钥参与签名" -ForegroundColor Yellow
        $fatal++
    } else {
        Write-Host "  [OK] 无静默回退默认密钥的写法" -ForegroundColor Green
    }
}

# ---------- 检查 B：本地配置文件不得把 AUTH_SECRET 配成默认值/弱值 ----------
$DEFAULT_SECRET = 'tcm-dev-insecure-secret-replace-in-prod'
$configFiles = @('.dev.vars', 'wrangler.toml', 'wrangler.jsonc', 'functions\.dev.vars')
$foundAny = $false
foreach ($rel in $configFiles) {
    $path = Join-Path $root $rel
    if (-not (Test-Path $path)) { continue }
    $foundAny = $true
    $content = Get-Content $path -Raw -Encoding UTF8
    # 匹配 AUTH_SECRET = "value" 或 AUTH_SECRET="value"
    $mm = [regex]::Match($content, 'AUTH_SECRET\s*=\s*"?([^"\r\n]+)"?')
    if ($mm.Success) {
        $val = $mm.Groups[1].Value.Trim()
        if ($val -eq $DEFAULT_SECRET) {
            Write-Host ("  [FATAL] {0} 把 AUTH_SECRET 配成了默认不安全值！" -f $rel) -ForegroundColor Red
            Write-Host "         处置：改为 32 位以上随机串(可用 openssl rand -hex 32 生成)" -ForegroundColor Yellow
            $fatal++
        } elseif ($val.Length -lt 16) {
            Write-Host ("  [FATAL] {0} 的 AUTH_SECRET 长度不足 16 字符({1} 位)，强度过弱" -f $rel, $val.Length) -ForegroundColor Red
            Write-Host "         处置：改为 32 位以上随机串" -ForegroundColor Yellow
            $fatal++
        } else {
            Write-Host ("  [OK] {0} 已配置 AUTH_SECRET(长度 {1})" -f $rel, $val.Length) -ForegroundColor Green
        }
    }
}
if (-not $foundAny) {
    Write-Host "  [INFO] 本地无 .dev.vars/wrangler 配置(云端密钥在 Cloudflare 后台，本地无法探测，不阻断)" -ForegroundColor DarkGray
}

# ---------- 检查 C：密钥文件不得被 git 跟踪 ----------
$tracked = & git -C $root ls-files 2>$null | Where-Object { $_ -match '(^|[/\\])\.dev\.vars$|(^|[/\\])[^/\\]*\.vars$' }
if ($tracked) {
    foreach ($t in $tracked) {
        Write-Host ("  [FATAL] 密钥文件被 git 跟踪，存在入库泄露风险: {0}" -f $t) -ForegroundColor Red
        Write-Host "         处置：git rm --cached 该文件并加入 .gitignore；若已推送需轮换密钥" -ForegroundColor Yellow
        $fatal++
    }
} else {
    Write-Host "  [OK] 无 .vars 密钥文件被 git 跟踪" -ForegroundColor Green
}

# ---------- 汇总 ----------
Write-Host ""
if ($fatal -gt 0) {
    Write-Host ("  [RESULT] FAILED —— {0} 项 FATAL，认证密钥门禁不合规！" -f $fatal) -ForegroundColor Red
    exit 1
} else {
    Write-Host "  [RESULT] PASSED —— 认证密钥 fail-closed 门禁在位，无弱配置/无密钥入库" -ForegroundColor Green
    exit 0
}
