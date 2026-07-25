$path = 'd:\trae_projects\kyt-zy\tools\pack.ps1'
$bytes = [System.IO.File]::ReadAllBytes($path)
$first4 = $bytes[0..3]
Write-Host ("First 4 bytes: {0:X2} {1:X2} {2:X2} {3:X2}" -f $first4[0], $first4[1], $first4[2], $first4[3])
if ($first4[0] -eq 0xEF -and $first4[1] -eq 0xBB -and $first4[2] -eq 0xBF) {
    Write-Host "BOM: UTF-8 with BOM" -ForegroundColor Green
} elseif ($first4[0] -eq 0xFF -and $first4[1] -eq 0xFE) {
    Write-Host "BOM: UTF-16 LE" -ForegroundColor Yellow
} else {
    Write-Host "BOM: None (no BOM)" -ForegroundColor Yellow
}
Write-Host ("File size: {0} bytes" -f $bytes.Length)
