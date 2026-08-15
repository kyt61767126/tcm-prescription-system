# ============================================================================
#  sync-app-version.ps1
#  从 cloud_desktop/index.html 读取 __APP_VERSION__，自动注入到
#  cloud_app 的 MainActivity.EXPECTED_APP_VERSION，
#  避免版本号不同步导致每次启动清缓存
#
#  用法:
#    powershell -NoProfile -ExecutionPolicy Bypass -File sync-app-version.ps1 <cloud_dir> [android_dir]
#
#  参数:
#    cloud_dir   - db-yunduan 目录路径（包含 cloud_desktop/cloud_app）
#    android_dir - 可选，指定单个 APP 目录（如 cloud_app）
#                  未指定时自动同步两个 APP
# ============================================================================
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

if ($args.Count -lt 1) {
    Write-Host "[ERROR] Usage: sync-app-version.ps1 <cloud_dir> [android_dir]"
    exit 1
}

$cloudDir  = $args[0]
$indexFile = Join-Path $cloudDir 'cloud_desktop\index.html'

if (-not (Test-Path $indexFile)) {
    Write-Host "  [WARN] index.html not found: $indexFile"
    exit 0
}

$idx = Get-Content $indexFile -Raw -Encoding UTF8
if ($idx -match "__APP_VERSION__\s*=\s*'([^']+)'") {
    $ver = $matches[1]
} else {
    Write-Host "  [WARN] __APP_VERSION__ not found in index.html"
    exit 0
}

# 目标 APP 目录列表：未指定 android_dir 时同步两个 APP
if ($args.Count -ge 2 -and -not [string]::IsNullOrEmpty($args[1])) {
    $targetDirs = @($args[1])
} else {
    $targetDirs = @(
        (Join-Path $cloudDir 'cloud_app')
    )
}

$utf8NoBom = New-Object System.Text.UTF8Encoding $false
$pattern = 'EXPECTED_APP_VERSION\s*=\s*"[^"]*"'
$replacement = 'EXPECTED_APP_VERSION = "' + $ver + '"'

foreach ($androidDir in $targetDirs) {
    $mainFile = Join-Path $androidDir 'app\src\main\java\com\tcm\prescription\MainActivity.java'
    if (-not (Test-Path $mainFile)) {
        Write-Host "  [WARN] MainActivity.java not found: $mainFile"
        continue
    }

    $c = Get-Content $mainFile -Raw -Encoding UTF8
    $new = $c -replace $pattern, $replacement

    if ($new -ne $c) {
        [System.IO.File]::WriteAllText($mainFile, $new, $utf8NoBom)
        $appName = Split-Path $androidDir -Leaf
        Write-Host "  [OK] $appName MainActivity.EXPECTED_APP_VERSION = $ver"
    } else {
        $appName = Split-Path $androidDir -Leaf
        Write-Host "  [SKIP] $appName already in sync"
    }
}
