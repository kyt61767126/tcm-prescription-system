# fix-ps1-bom.ps1 - Add UTF-8 BOM to .ps1 files that are missing it
# Usage: powershell -File tools\fix-ps1-bom.ps1
#
# This tool fixes .ps1 files that lost their BOM due to IDE edits.
# PowerShell 5.x reads .ps1 without BOM as GBK, causing Chinese garbled text.

$root = $PSScriptRoot | Split-Path -Parent
Set-Location $root

$utf8Bom = New-Object System.Text.UTF8Encoding($true)
$fixed = 0
$ok = 0

$ps1Files = Get-ChildItem -Path 'offline_project' -Recurse -Filter '*.ps1' -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '\\node_modules\\' }

foreach ($f in $ps1Files) {
    $rel = $f.FullName.Substring($root.Length + 1)
    $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
    $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
    if ($hasBom) {
        Write-Host ("  [OK]   " + $rel + " : BOM present") -ForegroundColor Green
        $ok++
    } else {
        $content = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
        [System.IO.File]::WriteAllText($f.FullName, $content, $utf8Bom)
        Write-Host ("  [FIX]   " + $rel + " : BOM added") -ForegroundColor Yellow
        $fixed++
    }
}

Write-Host ""
Write-Host ("Summary: " + $ok + " OK / " + $fixed + " fixed")
if ($fixed -gt 0) {
    Write-Host "[DONE] BOM restored to $fixed .ps1 files" -ForegroundColor Green
} else {
    Write-Host "[DONE] All .ps1 files already have BOM" -ForegroundColor Green
}
