# edit-config.ps1 - 打包前修改诊所名称
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$config = Get-Content 'config.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$currentClinic = $config.clinicName
$currentDoctor = $config.doctorName

Write-Host ""
Write-Host "============================================================"
Write-Host "  修改配置 - 本地版"
Write-Host "============================================================"
Write-Host ""
Write-Host "  当前诊所名称: $currentClinic"
Write-Host "  当前医师姓名: $currentDoctor （登录后自动显示，支持多用户）"
Write-Host ""
Write-Host "  提示: 直接回车保持当前值不变"
Write-Host ""

$newClinic = Read-Host "请输入诊所名称 [$currentClinic]"
if ([string]::IsNullOrWhiteSpace($newClinic)) { $newClinic = $currentClinic }

Write-Host ""
Write-Host "------------------------------------------------------------"
Write-Host "  新配置确认:"
Write-Host "    诊所名称: $newClinic"
Write-Host "    医师姓名: 登录后自动显示（多用户模式）"
Write-Host "------------------------------------------------------------"
Write-Host ""

$config.clinicName = $newClinic
$config | ConvertTo-Json -Depth 10 | Set-Content 'config.json' -Encoding UTF8

$html = [System.IO.File]::ReadAllText('index.html', [System.Text.Encoding]::UTF8)
$html = $html -replace "clinicName:\s*'[^']*'", "clinicName: '$newClinic'"
$html = $html -replace 'clinic-info-name">[^<]*<', ('clinic-info-name">' + $newClinic + '<')
$html = $html -replace 'clinicNameDisplay">[^<]*<', ('clinicNameDisplay">' + $newClinic + '<')
[System.IO.File]::WriteAllText('index.html', $html, [System.Text.Encoding]::UTF8)

Write-Host "[OK] 配置已更新: 诊所名称=$newClinic"
Write-Host ""
