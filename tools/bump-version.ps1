# ============================================================================
# bump-version.ps1 - 自动递增 package.json 的 patch 版本号
#
# 目的：每次打包时自动递增 patch 版本号（如 1.2.0 -> 1.2.1），
#       使 Electron 完整性校验基线（integrity-v{version}.dat）自动重建，
#       避免升级后误报"关键代码文件已被篡改"。
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File bump-version.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File bump-version.ps1 -PackagePath "D:\path\to\package.json"
# ============================================================================
param(
    [string]$PackagePath = ""
)

# 定位 package.json
if ($PackagePath -eq "") {
    $PackagePath = Join-Path (Get-Location) 'package.json'
}
if (-not (Test-Path $PackagePath)) {
    Write-Host '[WARN] package.json not found, skip bump' -ForegroundColor Yellow
    exit 0
}

# 读取 package.json
$content = [System.IO.File]::ReadAllText($PackagePath, [System.Text.Encoding]::UTF8)

# 匹配 "version": "x.y.z"
if ($content -match '"version":\s*"(\d+)\.(\d+)\.(\d+)"') {
    $oldLine = $matches[0]
    $oldVer = $matches[1] + '.' + $matches[2] + '.' + $matches[3]
    $newPatch = [int]$matches[3] + 1
    $newVer = $matches[1] + '.' + $matches[2] + '.' + $newPatch
    $newLine = '"version": "' + $newVer + '"'
    $newContent = $content.Replace($oldLine, $newLine)
    [System.IO.File]::WriteAllText($PackagePath, $newContent, [System.Text.UTF8Encoding]::new($false))
    Write-Host ('  Version bumped: ' + $oldVer + ' -> ' + $newVer) -ForegroundColor Green
} else {
    Write-Host '[WARN] version pattern not found in package.json, skip bump' -ForegroundColor Yellow
}