# ============================================================================
#  sync-app-version.ps1
#  ★ 2026-08-17 根治版本号回滚问题：真源改为 public/index.html（不再是 cloud_desktop）
#  从 <repo_root>/public/index.html（云端版本唯一真源）读取 __APP_VERSION__，
#  双向同步到：
#    1) cloud_app 的 MainActivity.EXPECTED_APP_VERSION（APK内置版本号）
#    2) cloud_desktop/index.html 的 __APP_VERSION__（云端桌面版）
#  保证三要素：APK内置 = 云端网页 = 桌面版本号 完全一致，杜绝打包时回滚覆盖。
#  打包前还会被 verify-app-version-consistency.ps1 再次强制预检不通过则终止。
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

$cloudDirRaw = $args[0]
# ★ 规范化：相对路径(.\)、末尾反斜杠一律转成绝对路径，防止后续 Split-Path/Resolve-Path 边界出错
try {
    if (-not (Test-Path $cloudDirRaw)) {
        Write-Host "[ERROR] cloud_dir not found: $cloudDirRaw"
        exit 1
    }
    $cloudDir = (Resolve-Path -Path $cloudDirRaw -ErrorAction Stop).Path
} catch {
    Write-Host "[ERROR] cloud_dir resolve failed: $cloudDirRaw ($_)"
    exit 1
}

# ★ 真源：repo 根目录下的 public/index.html（Cloudflare Pages 实际部署的文件）
#   cloud_desktop/index.html 只是桌面版本地副本，不再作为真源（之前回滚的根因）
#   db-yunduan 路径层级：<repo_root>\app_project\db-yunduan → 向上 2 级 = repo_root
$repoRootUp = Join-Path $cloudDir '..\..'
$repoRoot = (Resolve-Path -Path $repoRootUp -ErrorAction Stop).Path
Write-Host "  [INFO] cloud_dir  = $cloudDir"
Write-Host "  [INFO] repo_root = $repoRoot"
$publicHtml = Join-Path $repoRoot 'public\index.html'
$desktopHtml = Join-Path $cloudDir 'cloud_desktop\index.html'

# --- 1. 从真源 public/index.html 读取版本号 ---
if (-not (Test-Path $publicHtml)) {
    Write-Host "  [ERROR] ★版本号真源不存在: $publicHtml"
    Write-Host "         请确认 public/index.html 位置，已放弃以 cloud_desktop 作为真源（防回滚）"
    exit 1
}
$idx = Get-Content $publicHtml -Raw -Encoding UTF8
if ($idx -match "__APP_VERSION__\s*=\s*'([^']+)'") {
    $ver = $matches[1]
    Write-Host "  [OK] 从版本真源 public/index.html 读取版本号: $ver"
} else {
    Write-Host "  [ERROR] public/index.html 中未找到 __APP_VERSION__，打包终止！"
    exit 1
}

# --- 2. 把版本号写回 cloud_desktop/index.html（保证桌面端副本也同步）---
if (Test-Path $desktopHtml) {
    $d = Get-Content $desktopHtml -Raw -Encoding UTF8
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    if ($d -match "__APP_VERSION__\s*=\s*'([^']+)'") {
        $oldVer = $matches[1]
        if ($oldVer -ne $ver) {
            Write-Host "  [WARN] cloud_desktop/index.html 版本号=$oldVer 与真源不一致，强制覆盖为 $ver（之前会因此反向回滚！）"
            $newD = $d -replace "__APP_VERSION__\s*=\s*'[^']+'", "__APP_VERSION__ = '$ver'"
            [System.IO.File]::WriteAllText($desktopHtml, $newD, $utf8NoBom)
            Write-Host "  [OK] cloud_desktop/index.html 已同步为 $ver"
        } else {
            Write-Host "  [OK] cloud_desktop/index.html 已一致：$ver"
        }
    } else {
        Write-Host "  [WARN] cloud_desktop/index.html 未找到 __APP_VERSION__，跳过同步"
    }
}

# --- 3. 写入 cloud_app 的 MainActivity.EXPECTED_APP_VERSION ---
if ($args.Count -ge 2 -and -not [string]::IsNullOrEmpty($args[1])) {
    $targetDirs = @($args[1])
} else {
    $targetDirs = @(
        (Join-Path $cloudDir 'cloud_app')
    )
}

$utf8NoBom2 = New-Object System.Text.UTF8Encoding $false
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
        [System.IO.File]::WriteAllText($mainFile, $new, $utf8NoBom2)
        $appName = Split-Path $androidDir -Leaf
        Write-Host "  [OK] $appName MainActivity.EXPECTED_APP_VERSION = $ver"
    } else {
        $appName = Split-Path $androidDir -Leaf
        Write-Host "  [OK] $appName already in sync ($ver)"
    }
}
