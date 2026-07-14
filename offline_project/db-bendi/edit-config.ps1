# edit-config.ps1 - 打包前编辑诊所名和医师姓名
$config = Get-Content 'config.json' -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Host "当前诊所名称: $($config.clinicName)"
Write-Host "当前医师姓名: $($config.doctorName)"
Write-Host ""
$ans = Read-Host "是否修改？(y/n)"
if ($ans -ne 'y' -and $ans -ne 'Y') {
    Write-Host "保持原有配置"
    exit 0
}
$clinic = Read-Host "请输入诊所名称"
$doctor = Read-Host "请输入医师姓名"
if ([string]::IsNullOrWhiteSpace($clinic) -or [string]::IsNullOrWhiteSpace($doctor)) {
    Write-Host "[错误] 诊所名称和医师姓名不能为空"
    exit 1
}
$config.clinicName = $clinic
$config.doctorName = $doctor
$config | ConvertTo-Json -Depth 10 | Set-Content 'config.json' -Encoding UTF8
$html = [System.IO.File]::ReadAllText('index.html', [System.Text.Encoding]::UTF8)
$html = $html -replace "clinicName:\s*'[^']*'", "clinicName: '$clinic'"
$html = $html -replace "doctorName:\s*'[^']*'", "doctorName: '$doctor'"
[System.IO.File]::WriteAllText('index.html', $html, [System.Text.Encoding]::UTF8)
Write-Host "[OK] 配置已更新：诊所=$clinic, 医师=$doctor"