$testFile = "$env:TEMP\test_config.html"
$content = @"
clinicName: '本能堂中医诊所'
doctorName: '张大夫'
<div class="clinic-info-name">本能堂中医诊所</div>
<div id="clinicNameDisplay">本能堂中医诊所</div>
"@
[System.IO.File]::WriteAllText($testFile, $content, [System.Text.Encoding]::UTF8)

Write-Output "=== 替换前 ==="
Get-Content $testFile -Encoding UTF8
Write-Output ""

$clinic = "惠民中医诊所"
$doctor = "李大夫"

$content = Get-Content -Path $testFile -Raw -Encoding UTF8
$content = [regex]::Replace($content, "clinicName:\s*'[^']*'", "clinicName: '$clinic'")
$content = [regex]::Replace($content, "doctorName:\s*'[^']*'", "doctorName: '$doctor'")
$content = [regex]::Replace($content, 'clinic-info-name">[^<]*<', "clinic-info-name"">$clinic<")
$content = [regex]::Replace($content, 'clinicNameDisplay">[^<]*<', "clinicNameDisplay"">$clinic<")
[System.IO.File]::WriteAllText($testFile, $content, [System.Text.Encoding]::UTF8)

Write-Output "=== 替换后 ==="
Get-Content $testFile -Encoding UTF8

Remove-Item $testFile -Force
