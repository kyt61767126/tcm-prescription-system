# edit-config.ps1 - Interactive clinic and doctor name editor
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
# 无 BOM 的 UTF-8 编码（避免 index.html 出现 BOM 导致 "锘?!DOCTYPE" 损坏）
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
# 带 BOM 的 UTF-8 编码（含中文的 .ps1 文件需要 BOM 才能在 PowerShell 5.1 正确解析）
$utf8WithBom = New-Object System.Text.UTF8Encoding($true)

# ★ v3 新增：config.json 完整性签名密钥（与客户端 license-manager.js 中 CONFIG_SIGN_KEY 保持一致）
$CONFIG_SIGN_KEY = 'bnzc_config_sign_key_v1_2026'

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
Write-Host "   诊所信息配置 - 个人版" -ForegroundColor Cyan
Write-Host "============================================`n" -ForegroundColor Cyan

Write-Host "当前信息:" -ForegroundColor Green
Write-Host "  诊所名称: $currentClinic"
Write-Host "  医师姓名: $currentDoctor"
Write-Host ""
Write-Host "提示: 按回车键保留当前值"
Write-Host "信息: 修改将影响处方上的诊所和医师显示"
Write-Host ""

$newClinic = Read-Host "请输入诊所名称 [$currentClinic]"
if ([string]::IsNullOrWhiteSpace($newClinic)) { $newClinic = $currentClinic }

$newDoctor = Read-Host "请输入医师姓名 [$currentDoctor]"
if ([string]::IsNullOrWhiteSpace($newDoctor)) { $newDoctor = $currentDoctor }

Write-Host ""
Write-Host "新信息:" -ForegroundColor Green
Write-Host "  诊所名称: $newClinic"
Write-Host "  医师姓名: $newDoctor"
Write-Host ""

$confirm = Read-Host "确认保存修改吗？(Y=确认 / N=重新输入 / 回车=确认) [Y]"
if ([string]::IsNullOrWhiteSpace($confirm)) { $confirm = 'Y' }
if ($confirm -ieq 'N') {
    Write-Host '[INFO] 用户选择重新输入...' -ForegroundColor Yellow
    & $MyInvocation.MyCommand.Path
    exit 0
}
if ($confirm -eq 'Y' -or $confirm -eq 'y') {
    $config.clinicName = $newClinic
    $config.doctorName = $newDoctor
    # ★ v3 新增：写入签名时间戳（用于签名内容）
    $config.configIssuedAt = (Get-Date).ToUniversalTime().ToString("o")

    # 先序列化（不含签名），计算签名，再写入签名
    $configJsonTemp = $config | ConvertTo-Json -Depth 10
    # 移除可能已存在的 configSignature 字段
    $config | Select-Object -Property * -ExcludeProperty configSignature | ConvertTo-Json -Depth 10 | Set-Content $configPath -Encoding UTF8

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
    [System.IO.File]::WriteAllText($configPath, $configJson, $utf8NoBom)

    Write-Host "[OK] config.json 签名已生成: $configSignature" -ForegroundColor Green
} else {
    Write-Host '[SKIP] 用户取消，未保存修改' -ForegroundColor Yellow
    Read-Host '按回车键退出'
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
    [System.IO.File]::WriteAllText($htmlPath, $html, $utf8NoBom)
    Write-Host '[OK] index.html 已更新' -ForegroundColor Green
} else {
    Write-Host '[WARN] 未找到 index.html，跳过更新' -ForegroundColor Yellow
}

Write-Host ""
Write-Host "============================================`n" -ForegroundColor Cyan
Write-Host "配置已更新！" -ForegroundColor Green
Write-Host "诊所名称: $newClinic"
Write-Host "医师姓名: $newDoctor"
Write-Host ""
Write-Host "后续步骤:"
Write-Host "  1. 运行 sync-to-app.bat 同步到 Android"
Write-Host "  2. 运行 build-app.bat 打包 APK"
Write-Host "  3. 运行 build.bat 打包桌面程序"
Write-Host ""
Read-Host '按回车键继续'

# ★ 重要：将本文件用 BOM UTF-8 重新写入（Edit 工具会剥离 BOM，PowerShell 5.1 需要 BOM 解析中文）
$scriptContent = [System.IO.File]::ReadAllText($MyInvocation.MyCommand.Path, [System.Text.Encoding]::UTF8)
[System.IO.File]::WriteAllText($MyInvocation.MyCommand.Path, $scriptContent, $utf8WithBom)