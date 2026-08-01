# ============================================================================
# check-interface.ps1 - 界面结构完整性校验脚本
#
# 目的：检测 index.html 的 body DOM 结构是否被意外修改
# 原理：提取 <body> 到 </body> 之间内容，剔除 <script>...</script> 段（只保留 DOM 结构+style），
#       计算 SHA256 哈希，与基线文件比对
#
# 使用：
#   .\check-interface.bat            首次运行建立基线，再次运行验证
#   .\check-interface.ps1 -Reset     强制重新建立基线
# ============================================================================

param(
    [switch]$Reset
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSCommandPath
$baselineDir = Join-Path $projectRoot '.interface-baseline'

# 待校验的 index.html
$targets = @(
    'app_project\db-geren\desktop\index.html',
    'app_project\db-dingzhi\desktop\index.html',
    'app_project\db-geren\app\app\src\main\assets\public\index.html',
    'app_project\db-dingzhi\app\app\src\main\assets\public\index.html'
)

function Get-BodyDOM {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    $content = Get-Content $Path -Raw -Encoding UTF8
    # 精确定位 <body...> 和 </body>
    $bodyOpenMatch = [regex]::Match($content, '<body[^>]*>')
    if (-not $bodyOpenMatch.Success) { return $null }
    $bodyOpenEnd = $bodyOpenMatch.Index + $bodyOpenMatch.Length
    $bodyCloseIdx = $content.IndexOf('</body>', $bodyOpenEnd)
    if ($bodyCloseIdx -lt 0) { return $null }
    $bodyInner = $content.Substring($bodyOpenEnd, $bodyCloseIdx - $bodyOpenEnd)
    # 剔除所有 <script>...</script> 段（含 src 的和 inline 的）
    $bodyNoScript = [regex]::Replace($bodyInner, '(?s)<script[^>]*>.*?</script>', '')
    return $bodyOpenMatch.Value + $bodyNoScript + '</body>'
}

function Get-BodyHash {
    param([string]$Path)
    $dom = Get-BodyDOM -Path $Path
    if (-not $dom) { return $null }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($dom)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hashBytes = $sha.ComputeHash($bytes)
    return ($hashBytes | ForEach-Object { $_.ToString('x2') }) -join ''
}

# 强制重置模式：删除旧基线
if ($Reset -and (Test-Path $baselineDir)) {
    Remove-Item $baselineDir -Recurse -Force
    Write-Host "[INFO] 已删除旧基线目录" -ForegroundColor Yellow
}

# 首次运行：建立基线
if (-not (Test-Path $baselineDir)) {
    New-Item -ItemType Directory -Path $baselineDir -Force | Out-Null
    Write-Host "[INFO] 首次运行，建立基线..." -ForegroundColor Yellow
    $okCount = 0
    foreach ($t in $targets) {
        $full = Join-Path $projectRoot $t
        $hash = Get-BodyHash -Path $full
        if ($hash) {
            $name = ($t -replace '[\\/]', '_') + '.sha256'
            $hash | Out-File (Join-Path $baselineDir $name) -Encoding UTF8
            Write-Host ("  [BASELINE] {0} -> {1}" -f $t, $hash.Substring(0, 12)) -ForegroundColor Cyan
            $okCount++
        } else {
            Write-Host ("  [SKIP] {0} (文件不存在或无 body)" -f $t) -ForegroundColor DarkGray
        }
    }
    Write-Host "[INFO] 基线建立完成：$okCount / $($targets.Count) 个文件" -ForegroundColor Green
    exit 0
}

# 验证模式：与基线比对
Write-Host "[INFO] 验证界面结构完整性..." -ForegroundColor Yellow
$okCount = 0
$warnCount = 0
$failCount = 0
foreach ($t in $targets) {
    $full = Join-Path $projectRoot $t
    $hash = Get-BodyHash -Path $full
    $name = ($t -replace '[\\/]', '_') + '.sha256'
    $baselineFile = Join-Path $baselineDir $name
    if (-not (Test-Path $baselineFile)) {
        Write-Host ("  [WARN] {0} 缺少基线" -f $t) -ForegroundColor Yellow
        $warnCount++
        continue
    }
    $baseHash = (Get-Content $baselineFile -Raw -Encoding UTF8).Trim()
    if (-not $hash) {
        Write-Host ("  [FAIL] {0} 无法读取 body" -f $t) -ForegroundColor Red
        $failCount++
        continue
    }
    if ($hash -eq $baseHash) {
        Write-Host ("  [OK]    {0}" -f $t) -ForegroundColor Green
        $okCount++
    } else {
        Write-Host ("  [FAIL]  {0}" -f $t) -ForegroundColor Red
        Write-Host ("          基线: $($baseHash.Substring(0, 12))  当前: $($hash.Substring(0, 12))") -ForegroundColor Red
        $failCount++
    }
}

Write-Host ""
Write-Host ("[结果] OK: {0}  WARN: {1}  FAIL: {2}" -f $okCount, $warnCount, $failCount) -ForegroundColor $(if ($failCount -eq 0) { 'Green' } else { 'Red' })

if ($failCount -gt 0) {
    Write-Host ""
    Write-Host "[ERROR] 发现界面结构变化！请检查上述 FAIL 项的改动是否符合预期。" -ForegroundColor Red
    Write-Host "        若确认 DOM 改动是必要的，请运行: .\check-interface.ps1 -Reset 重新建立基线" -ForegroundColor Yellow
    exit 1
}
exit 0
