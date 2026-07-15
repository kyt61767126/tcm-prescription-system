# edit-config.ps1 - 打包前编辑诊所名和医师姓名
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$config = Get-Content 'config.json' -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Host "当前诊所名称: $($config.clinicName)"
Write-Host "当前医师姓名: $($config.doctorName)"
Write-Host ""
$newClinic = Read-Host "请输入诊所名称 [$($config.clinicName)]"
if ([string]::IsNullOrWhiteSpace($newClinic)) { $newClinic = $config.clinicName }
$newDoctor = Read-Host "请输入医师姓名 [$($config.doctorName)]"
if ([string]::IsNullOrWhiteSpace($newDoctor)) { $newDoctor = $config.doctorName }
if ([string]::IsNullOrWhiteSpace($newClinic) -or [string]::IsNullOrWhiteSpace($newDoctor)) {
    Write-Host "[错误] 诊所名称和医师姓名不能为空"
    exit 1
}
$config.clinicName = $newClinic
$config.doctorName = $newDoctor
$config | ConvertTo-Json -Depth 10 | Set-Content 'config.json' -Encoding UTF8
$html = [System.IO.File]::ReadAllText('index.html', [System.Text.Encoding]::UTF8)
$html = $html -replace "clinicName:\s*'[^']*'", "clinicName: '$newClinic'"
$html = $html -replace "doctorName:\s*'[^']*'", "doctorName: '$newDoctor'"
[System.IO.File]::WriteAllText('index.html', $html, [System.Text.Encoding]::UTF8)
Write-Host "[OK] 配置已更新：诊所=$newClinic, 医师=$newDoctor"