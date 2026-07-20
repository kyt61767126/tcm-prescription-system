# edit-config.ps1 - 打包前修改诊所名称
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
# 无 BOM 的 UTF-8 编码（避免 index.html 出现 BOM 导致 "锘?!DOCTYPE" 损坏）
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
# 带 BOM 的 UTF-8 编码（含中文的 .ps1 文件需要 BOM 才能在 PowerShell 5.1 正确解析）
$utf8WithBom = New-Object System.Text.UTF8Encoding($true)

# ★ v3 新增：config.json 完整性签名密钥（与客户端 license-manager.js 中 CONFIG_SIGN_KEY 保持一致）
$CONFIG_SIGN_KEY = 'bnzc_config_sign_key_v1_2026'

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
# ★ v3 新增：写入签名时间戳（用于签名内容）
$config.configIssuedAt = (Get-Date).ToUniversalTime().ToString("o")

# 先序列化（不含签名），计算签名，再写入签名
$configJsonTemp = $config | ConvertTo-Json -Depth 10
# 移除可能已存在的 configSignature 字段
$config | Select-Object -Property * -ExcludeProperty configSignature | ConvertTo-Json -Depth 10 | Set-Content 'config.json' -Encoding UTF8

# ★ v3 新增：计算 config.json 签名（HMAC-SHA256）
# 签名内容：clinicName|doctorName|edition|configIssuedAt
$signContent = "$($config.clinicName)|$($config.doctorName)|$($config.edition)|$($config.configIssuedAt)"
$hmac = New-Object System.Security.Cryptography.HMACSHA256
$hmac.Key = [System.Text.Encoding]::UTF8.GetBytes($CONFIG_SIGN_KEY)
$hashBytes = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($signContent))
$configSignature = ($hashBytes | ForEach-Object { $_.ToString("x2") }) -join ''
$config | Add-Member -NotePropertyName configSignature -NotePropertyValue $configSignature -Force

# 重新写入带签名的 config.json
$configJson = $config | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText('config.json', $configJson, $utf8NoBom)

Write-Host "[OK] config.json 签名已生成: $configSignature"

$html = [System.IO.File]::ReadAllText('index.html', [System.Text.Encoding]::UTF8)
$html = $html -replace "clinicName:\s*'[^']*'", "clinicName: '$newClinic'"
$html = $html -replace 'clinic-info-name">[^<]*<', ('clinic-info-name">' + $newClinic + '<')
$html = $html -replace 'clinicNameDisplay">[^<]*<', ('clinicNameDisplay">' + $newClinic + '<')
[System.IO.File]::WriteAllText('index.html', $html, $utf8NoBom)

Write-Host "[OK] 配置已更新: 诊所名称=$newClinic"
Write-Host ""

# ★ 重要：将本文件用 BOM UTF-8 重新写入（Edit 工具会剥离 BOM，PowerShell 5.1 需要 BOM 解析中文）
$scriptContent = [System.IO.File]::ReadAllText($MyInvocation.MyCommand.Path, [System.Text.Encoding]::UTF8)
[System.IO.File]::WriteAllText($MyInvocation.MyCommand.Path, $scriptContent, $utf8WithBom)
