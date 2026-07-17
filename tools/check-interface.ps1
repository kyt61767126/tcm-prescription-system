# ============================================================================
#  check-interface.ps1
#  检查界面结构是否被改动 - 对比当前 HTML body 哈希与 .interface-lock.json 基线
#  用法: powershell -NoProfile -ExecutionPolicy Bypass -File tools\check-interface.ps1
#  返回: exit code 0 = 全部一致, exit code 1 = 有界面被改动(需人工确认)
# ============================================================================
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$lockFile = Join-Path $root '.interface-lock.json'
if (-not (Test-Path $lockFile)) {
    Write-Host "[ERROR] .interface-lock.json not found. Run generate-interface-lock.ps1 first." -ForegroundColor Red
    exit 2
}

$lock = Get-Content $lockFile -Raw -Encoding UTF8 | ConvertFrom-Json
$changed = 0
$ok = 0
$missing = 0

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Interface Structure Integrity Check" -ForegroundColor Cyan
Write-Host "  Baseline: $($lock.generated_at)" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

foreach ($prop in $lock.files.PSObject.Properties) {
    $f = $prop.Name
    $baseline = $prop.Value
    $fullPath = Join-Path $root $f

    if ($baseline.error) {
        Write-Host ("[SKIP] " + $f + "  (baseline error: " + $baseline.error + ")") -ForegroundColor Yellow
        continue
    }

    if (-not (Test-Path $fullPath)) {
        Write-Host ("[MISS] " + $f + "  file deleted!") -ForegroundColor Red
        $missing++
        continue
    }

    $content = Get-Content $fullPath -Raw -Encoding UTF8
    $bodyMatch = [regex]::Match($content, '(?s)<body[^>]*>(.*?)<script')
    if (-not $bodyMatch.Success) {
        Write-Host ("[FAIL] " + $f + "  body section not found") -ForegroundColor Red
        $changed++
        continue
    }

    $html = $bodyMatch.Groups[1].Value
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($html)
    $hashBytes = $sha.ComputeHash($bytes)
    $currentHash = ($hashBytes | ForEach-Object { $_.ToString('x2') }) -join ''

    if ($currentHash -eq $baseline.sha256) {
        Write-Host ("[ OK ] " + $f) -ForegroundColor Green
        $ok++
    } else {
        Write-Host ("[WARN] " + $f) -ForegroundColor Red
        Write-Host ("        baseline: " + $baseline.sha256) -ForegroundColor Red
        Write-Host ("        current : " + $currentHash) -ForegroundColor Red
        Write-Host ("        >>> Interface HTML structure changed! Verify this is intended.") -ForegroundColor Yellow
        $changed++
    }
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
$summary = "  Summary: " + $ok + " OK, " + $changed + " CHANGED, " + $missing + " MISSING"
Write-Host $summary -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

if ($changed -gt 0 -or $missing -gt 0) {
    Write-Host ""
    Write-Host "[ACTION REQUIRED] Interface structure changed!" -ForegroundColor Yellow
    Write-Host "  If changes are INTENDED (user requested UI modification):" -ForegroundColor Yellow
    Write-Host "    -> Re-run: powershell -File tools\generate-interface-lock.ps1" -ForegroundColor Yellow
    Write-Host "  If changes are UNINTENDED (optimization broke UI):" -ForegroundColor Yellow
    Write-Host "    -> git checkout <changed-file> to restore" -ForegroundColor Yellow
    exit 1
}

exit 0
