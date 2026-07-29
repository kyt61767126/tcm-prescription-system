# ============================================================================
#  sync-app-version.ps1
#  从 cloud_desktop/index.html 读取 __APP_VERSION__，自动注入到
#  MainActivity.EXPECTED_APP_VERSION，避免版本号不同步导致每次启动清缓存
#  用法: powershell -NoProfile -ExecutionPolicy Bypass -File sync-app-version.ps1 <cloud_dir> <android_dir>
# ============================================================================
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

if ($args.Count -lt 2) {
    Write-Host "[ERROR] Usage: sync-app-version.ps1 <cloud_dir> <android_dir>"
    exit 1
}

$cloudDir  = $args[0]
$androidDir = $args[1]

$indexFile = Join-Path $cloudDir 'cloud_desktop\index.html'
$mainFile  = Join-Path $androidDir 'app\src\main\java\com\tcm\prescription\MainActivity.java'

if (-not (Test-Path $indexFile)) {
    Write-Host "  [WARN] index.html not found: $indexFile"
    exit 0
}
if (-not (Test-Path $mainFile)) {
    Write-Host "  [WARN] MainActivity.java not found: $mainFile"
    exit 0
}

$idx = Get-Content $indexFile -Raw -Encoding UTF8
if ($idx -match "__APP_VERSION__\s*=\s*'([^']+)'") {
    $ver = $matches[1]
} else {
    Write-Host "  [WARN] __APP_VERSION__ not found in index.html"
    exit 0
}

$c = Get-Content $mainFile -Raw -Encoding UTF8
# Use single-quoted regex pattern to avoid escape hell
$pattern = 'EXPECTED_APP_VERSION\s*=\s*"[^"]*"'
$replacement = 'EXPECTED_APP_VERSION = "' + $ver + '"'
$new = $c -replace $pattern, $replacement

if ($new -ne $c) {
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($mainFile, $new, $utf8NoBom)
    Write-Host "  [OK] MainActivity.EXPECTED_APP_VERSION = $ver"
} else {
    Write-Host "  [SKIP] Already in sync"
}
