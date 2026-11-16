# ============================================================================
#  sync-offline-desktop-version.ps1
#  离线端版本号单计数器：离线桌面 package.json version = "1.0.<App versionCode>"
#
#  背景（2026-11-16 方案 B）：
#    App 显示号已统一为 V1.0.<versionCode>（三段，与桌面同形），桌面此前每次打包
#    patch+1，两套独立计数器必然走散（317 vs 350）。改为以 App 的 versionCode 为
#    唯一计数源：桌面打包前读 build.gradle 的 versionCode 写入 "1.0.<code>"，
#    使两端对外版本号长期同号。
#
#  硬约束（不得违反）：
#    - App versionName 恒 "1.0.0"：参与设备指纹 machineId 与授权解密，禁止改动；
#    - App versionCode 只增不减：本脚本不回写 gradle，只读；
#    - 本脚本只处理离线端（db-offline），云端两端不在此门禁范围。
#
#  用法：
#    powershell -NoProfile -ExecutionPolicy Bypass -File sync-offline-desktop-version.ps1
#        写入桌面 package.json（离线桌面打包前调用）
#    powershell -NoProfile -ExecutionPolicy Bypass -File sync-offline-desktop-version.ps1 -Check
#        只校验不写盘；桌面 version 与 App versionCode 不一致即 exit 1（发布前门禁）
# ============================================================================
param(
    [switch]$Check,
    [string]$RepoRoot = ""
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrEmpty($RepoRoot)) {
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
} else {
    $RepoRoot = (Resolve-Path $RepoRoot).Path
}

$gradlePath = Join-Path $RepoRoot 'app_project\db-offline\app\app\build.gradle'
$pkgPath = Join-Path $RepoRoot 'app_project\db-offline\desktop\package.json'

foreach ($p in @($gradlePath, $pkgPath)) {
    if (-not (Test-Path $p)) {
        Write-Host "[FAIL] 文件不存在: $p"
        exit 1
    }
}

# --- 1. 读 App versionCode（唯一计数源）---
$gradle = Get-Content $gradlePath -Raw -Encoding UTF8
if ($gradle -notmatch 'versionCode\s+(\d+)') {
    Write-Host "[FAIL] build.gradle 中未找到 versionCode: $gradlePath"
    exit 1
}
$code = [int]$matches[1]

# --- 2. 读桌面 version ---
$pkgRaw = [System.IO.File]::ReadAllText($pkgPath, [System.Text.Encoding]::UTF8)
if ($pkgRaw -notmatch '"version"\s*:\s*"([^"]+)"') {
    Write-Host "[FAIL] package.json 中未找到 version: $pkgPath"
    exit 1
}
$oldLine = $matches[0]
$desktopVer = $matches[1]
$targetVer = '1.0.' + $code

if ($Check) {
    if ($desktopVer -ne $targetVer) {
        Write-Host "[FAIL] 离线桌面与 App 版本号不同号（两端必须同号）"
        Write-Host "       桌面 package.json = $desktopVer"
        Write-Host "       App versionCode   = $code  -> 期望桌面 = $targetVer"
        Write-Host "       修复：先重打离线 APP（versionCode 自增），再打离线桌面（打包前会自动同步），最后重新发布。"
        exit 1
    }
    Write-Host "[PASS] 离线桌面与 App 同号：$targetVer（App versionCode=$code）"
    exit 0
}

# --- 3. 写入（版本未变则跳过，避免无意义改动）---
if ($desktopVer -eq $targetVer) {
    Write-Host "  [OK] 桌面版本号已同步：$targetVer（App versionCode=$code，无需改动）"
    exit 0
}
$newLine = '"version": "' + $targetVer + '"'
$newRaw = $pkgRaw.Replace($oldLine, $newLine)
[System.IO.File]::WriteAllText($pkgPath, $newRaw, (New-Object System.Text.UTF8Encoding $false))
Write-Host "  [OK] 桌面版本号已按 App 构建号同步：$desktopVer -> $targetVer（App versionCode=$code）"
exit 0
