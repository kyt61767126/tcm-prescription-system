# edit-config.ps1 - Interactive clinic and doctor name editor
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$configPath = 'config.json'
$htmlPath = 'index.html'

if (-not (Test-Path $configPath)) {
    Write-Host '[ERROR] config.json not found!' -ForegroundColor Red
    Read-Host 'Press Enter to exit'
    exit 1
}

$config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$currentClinic = $config.clinicName
$currentDoctor = $config.doctorName

Write-Host "`n============================================" -ForegroundColor Cyan
Write-Host "   Clinic Configuration - Personal Edition" -ForegroundColor Cyan
Write-Host "============================================`n" -ForegroundColor Cyan

Write-Host "Current Settings:" -ForegroundColor Green
Write-Host "  Clinic Name: $currentClinic"
Write-Host "  Doctor Name: $currentDoctor"
Write-Host ""
Write-Host "Note: Press Enter to keep current value"
Write-Host "Info: Changes will affect clinic and doctor display on prescriptions"
Write-Host ""

$newClinic = Read-Host "Enter clinic name [$currentClinic]"
if ([string]::IsNullOrWhiteSpace($newClinic)) { $newClinic = $currentClinic }

$newDoctor = Read-Host "Enter doctor name [$currentDoctor]"
if ([string]::IsNullOrWhiteSpace($newDoctor)) { $newDoctor = $currentDoctor }

Write-Host ""
Write-Host "New Settings:" -ForegroundColor Green
Write-Host "  Clinic Name: $newClinic"
Write-Host "  Doctor Name: $newDoctor"
Write-Host ""

$confirm = Read-Host "Confirm save changes? (Y/N) [Y]"
if ([string]::IsNullOrWhiteSpace($confirm)) { $confirm = 'Y' }
if ($confirm -eq 'Y' -or $confirm -eq 'y') {
    $config.clinicName = $newClinic
    $config.doctorName = $newDoctor
    $config | ConvertTo-Json -Depth 10 | Set-Content $configPath -Encoding UTF8
    Write-Host '[OK] config.json updated' -ForegroundColor Green
} else {
    Write-Host '[SKIP] Changes not saved' -ForegroundColor Yellow
    Read-Host 'Press Enter to exit'
    exit 0
}

if (Test-Path $htmlPath) {
    $html = [System.IO.File]::ReadAllText($htmlPath, [System.Text.Encoding]::UTF8)
    $html = $html -replace "clinicName:\s*'[^']*'", "clinicName: '$newClinic'"
    $html = $html -replace "doctorName:\s*'[^']*'", "doctorName: '$newDoctor'"
    $replace1 = "clinic-info-name`">$newClinic<"
    $html = $html -replace 'clinic-info-name">[^<]*<', $replace1
    $replace2 = "clinicNameDisplay`">$newClinic<"
    $html = $html -replace 'clinicNameDisplay">[^<]*<', $replace2
    [System.IO.File]::WriteAllText($htmlPath, $html, [System.Text.Encoding]::UTF8)
    Write-Host '[OK] index.html updated' -ForegroundColor Green
} else {
    Write-Host '[WARN] index.html not found, skip update' -ForegroundColor Yellow
}

Write-Host ""
Write-Host "============================================`n" -ForegroundColor Cyan
Write-Host "Configuration updated!" -ForegroundColor Green
Write-Host "Clinic Name: $newClinic"
Write-Host "Doctor Name: $newDoctor"
Write-Host ""
Write-Host "Next Steps:"
Write-Host "  1. Run sync-to-app.bat to sync to Android"
Write-Host "  2. Run build-app.bat to build APK"
Write-Host "  3. Run build.bat to build desktop app"
Write-Host ""
Read-Host 'Press Enter to continue'