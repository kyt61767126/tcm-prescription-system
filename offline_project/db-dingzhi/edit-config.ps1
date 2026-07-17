# edit-config.ps1 - Interactive clinic name editor before build
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
# 无 BOM 的 UTF-8 编码（避免 index.html 出现 BOM 导致 "锘?!DOCTYPE" 损坏）
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$config = Get-Content 'config.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$currentClinic = $config.clinicName
$currentDoctor = $config.doctorName

Write-Host "Current Clinic Name: $currentClinic"
Write-Host "Current Doctor Name: $currentDoctor (can be changed after login)"
Write-Host ""
Write-Host "Note: Press Enter to keep current value"
Write-Host "Info: Custom Edition only edits clinic name at build time;"
Write-Host "      Doctor name is determined by login user, supports multi-user"
Write-Host ""

$newClinic = Read-Host "Enter clinic name [$currentClinic]"
if ([string]::IsNullOrWhiteSpace($newClinic)) { $newClinic = $currentClinic }

Write-Host ""
Write-Host "New configuration:"
Write-Host "  Clinic Name: $newClinic"
Write-Host "  Doctor Name: Auto-display after login (multi-user)"
Write-Host ""

$config.clinicName = $newClinic
$config | ConvertTo-Json -Depth 10 | Set-Content 'config.json' -Encoding UTF8

$html = [System.IO.File]::ReadAllText('index.html', [System.Text.Encoding]::UTF8)
$html = $html -replace "clinicName:\s*'[^']*'", "clinicName: '$newClinic'"
$html = $html -replace 'clinic-info-name">[^<]*<', ('clinic-info-name">' + $newClinic + '<')
$html = $html -replace 'clinicNameDisplay">[^<]*<', ('clinicNameDisplay">' + $newClinic + '<')
[System.IO.File]::WriteAllText('index.html', $html, $utf8NoBom)

Write-Host "[OK] Configuration updated: Clinic=$newClinic"