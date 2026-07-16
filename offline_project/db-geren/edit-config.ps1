# edit-config.ps1 - 打包前交互式编辑诊所名称
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$config = Get-Content 'config.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$currentClinic = $config.clinicName
$currentDoctor = $config.doctorName

Write-Host "当前诊所名称: $currentClinic"
Write-Host "当前医师姓名: $currentDoctor （打包后可在程序内登录修改）"
Write-Host ""
Write-Host "提示: 直接按回车保持当前值不变"
Write-Host "说明: 个人版仅打包时编辑诊所名称；"
Write-Host "      医师姓名由登录用户决定，支持多用户登录"
Write-Host ""

$newClinic = Read-Host "请输入诊所名称 [$currentClinic]"
if ([string]::IsNullOrWhiteSpace($newClinic)) { $newClinic = $currentClinic }

Write-Host ""
Write-Host "新配置确认:"
Write-Host "  诊所名称: $newClinic"
Write-Host "  医师姓名: 登录后自动显示（多用户登录）"
Write-Host ""

$config.clinicName = $newClinic
$config | ConvertTo-Json -Depth 10 | Set-Content 'config.json' -Encoding UTF8

$html = [System.IO.File]::ReadAllText('index.html', [System.Text.Encoding]::UTF8)
$html = $html -replace "clinicName:\s*'[^']*'", "clinicName: '$newClinic'"
$html = $html -replace 'clinic-info-name">[^<]*<', 'clinic-info-name">' + $newClinic + '<'
$html = $html -replace 'clinicNameDisplay">[^<]*<', 'clinicNameDisplay">' + $newClinic + '<'
[System.IO.File]::WriteAllText('index.html', $html, [System.Text.Encoding]::UTF8)

Write-Host "[OK] 配置已更新：诊所=$newClinic"