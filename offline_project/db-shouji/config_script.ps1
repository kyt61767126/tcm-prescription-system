[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$HtmlFile = $env:CONFIG_HTML_FILE
$BuildBat = $env:CONFIG_BUILD_BAT

Write-Host "============================================================"
Write-Host "  本能中医处方 - 配置并打包手机APP"
Write-Host "============================================================"
Write-Host ""

if (-not $HtmlFile -or -not (Test-Path $HtmlFile)) {
    Write-Host "[错误] 找不到页面文件" -ForegroundColor Red
    Read-Host "按回车键退出"
    exit 1
}

Write-Host "[1/3] 读取当前配置..."
Write-Host ""

$content = Get-Content -Path $HtmlFile -Raw -Encoding UTF8

$clinicMatch = [regex]::Match($content, "clinicName:\s*'([^']+)'")
$doctorMatch = [regex]::Match($content, "doctorName:\s*'([^']+)'")

if ($clinicMatch.Success) { $currentClinic = $clinicMatch.Groups[1].Value } else { $currentClinic = '本能堂中医诊所' }
if ($doctorMatch.Success) { $currentDoctor = $doctorMatch.Groups[1].Value } else { $currentDoctor = '张大夫' }

Write-Host "  当前诊所名称: $currentClinic"
Write-Host "  当前医师姓名: $currentDoctor"
Write-Host ""
Write-Host "------------------------------------------------------------"
Write-Host "  提示: 直接按回车保持当前值不变"
Write-Host "------------------------------------------------------------"
Write-Host ""

$newClinic = Read-Host "请输入诊所名称 [$currentClinic]"
if ([string]::IsNullOrWhiteSpace($newClinic)) { $newClinic = $currentClinic }

$newDoctor = Read-Host "请输入医师姓名 [$currentDoctor]"
if ([string]::IsNullOrWhiteSpace($newDoctor)) { $newDoctor = $currentDoctor }

Write-Host ""
Write-Host "------------------------------------------------------------"
Write-Host "  新配置确认:"
Write-Host "    诊所名称: $newClinic"
Write-Host "    医师姓名: $newDoctor"
Write-Host "------------------------------------------------------------"
Write-Host ""

$confirm = Read-Host "确认并开始打包？(Y/N) [Y]"
if ($confirm -ne '' -and $confirm -ne 'Y' -and $confirm -ne 'y') {
    Write-Host "已取消。"
    Read-Host "按回车键退出"
    exit 0
}

Write-Host ""
Write-Host "[2/3] 更新配置文件..."

$content = [regex]::Replace($content, "clinicName:\s*'[^']*'", "clinicName: '$newClinic'")
$content = [regex]::Replace($content, "doctorName:\s*'[^']*'", "doctorName: '$newDoctor'")
$content = [regex]::Replace($content, 'clinic-info-name">[^<]*<', 'clinic-info-name">' + $newClinic + '<')
$content = [regex]::Replace($content, 'clinicNameDisplay">[^<]*<', 'clinicNameDisplay">' + $newClinic + '<')
$content = [regex]::Replace($content, '(id="loginUsername"[^>]*value=)"[^"]*"', '${1}"' + $newDoctor + '"')

$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($HtmlFile, $content, $utf8NoBom)

Write-Host "  [OK] 配置已更新"
Write-Host ""
Write-Host "[3/3] 开始打包..."
Write-Host ""

Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$BuildBat`"" -Wait -NoNewWindow

Write-Host ""
Write-Host "============================================================"
Write-Host "  打包完成！"
Write-Host "  诊所名称: $newClinic"
Write-Host "  医师姓名: $newDoctor"
Write-Host "============================================================"
Write-Host ""

Read-Host "按回车键退出"
