<#
.SYNOPSIS
    Edit clinic configuration for offline TCM APP/Desktop builds.
.DESCRIPTION
    Standalone config editor for db-offline/desktop version.
    Updates config.json with HMAC-SHA256 signature for security.
    Syncs config.json to Capacitor public/ directory for APP packaging.
.PARAMETER SkipConfig
    Skip interactive config editing (for automated builds).
.PARAMETER Version
    Target version: dingzhi.
.EXAMPLE
    powershell -File edit-config.ps1
    powershell -File edit-config.ps1 -SkipConfig
#>

param(
    [switch]$SkipConfig,
    [string]$Version,
    [string]$DesktopDir = 'desktop',
    [string]$AppDir = 'app'
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

$scriptDir = $PSScriptRoot
if (-not $Version) {
    $Version = 'dingzhi'
}

$configPath = Join-Path $scriptDir "$DesktopDir\config.json"
$capPublicDir = Join-Path $scriptDir "$AppDir\app\src\main\assets\public"

$CONFIG_SIGN_KEY = 'bnzc_config_sign_key_v1_2026'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Show-CurrentConfig {
    param($config)
    Write-Host ""
    Write-Host "  ===========================================" -ForegroundColor Cyan
    Write-Host "   当前诊所信息" -ForegroundColor Cyan
    Write-Host "  ===========================================" -ForegroundColor Cyan
    Write-Host "    诊所名称: $($config.clinicName)" -ForegroundColor Yellow
    Write-Host "    医师姓名: $($config.doctorName)" -ForegroundColor Yellow
    Write-Host "  -------------------------------------------" -ForegroundColor DarkGray
    Write-Host "  （以下为系统固定信息，不可修改）" -ForegroundColor DarkGray
    Write-Host "    产品名称: $($config.productName)" -ForegroundColor DarkGray
    Write-Host "    版本标签: $($config.versionLabel)" -ForegroundColor DarkGray
    if ($config.configSignature) {
        Write-Host "    签名:     $($config.configSignature.Substring(0, [Math]::Min(16, $config.configSignature.Length)))..." -ForegroundColor DarkGray
    }
    Write-Host "  ===========================================" -ForegroundColor Cyan
}

function Edit-ClinicConfig {
    param(
        [switch]$AutoConfirm
    )

    if (-not (Test-Path $configPath)) {
        Write-Host "  [WARN] config.json not found: $configPath" -ForegroundColor Yellow
        return 1
    }

    try {
        $config = [System.IO.File]::ReadAllText($configPath, $utf8NoBom) | ConvertFrom-Json
    } catch {
        Write-Host "  [ERROR] Failed to read config.json: $_" -ForegroundColor Red
        return 1
    }

    $currentClinic = $config.clinicName
    $currentDoctor = $config.doctorName
    $currentProduct = $config.productName
    $currentVersionLabel = $config.versionLabel

    Show-CurrentConfig $config

    if ($AutoConfirm) {
        Write-Host ""
        Write-Host "  (Auto-confirm: keeping current values, no input required)" -ForegroundColor DarkGray
        Write-Host ""
        Write-Host "  [OK] Using current config (clinic=$currentClinic, doctor=$currentDoctor)" -ForegroundColor Green
        Write-Host ""
        return 0
    }

    Write-Host ""
    Write-Host "  (按回车键保留当前值，或输入新值修改)" -ForegroundColor DarkGray
    Write-Host ""

    $newClinic = Read-Host "  请输入诊所名称 [$currentClinic]"
    if ([string]::IsNullOrWhiteSpace($newClinic)) {
        $newClinic = $currentClinic
    }

    $newDoctor = Read-Host "  请输入医师姓名 [$currentDoctor]"
    if ([string]::IsNullOrWhiteSpace($newDoctor)) {
        $newDoctor = $currentDoctor
    }

    # 产品名称和版本标签为系统固定配置，不接受用户修改
    $newProduct = $currentProduct
    $newVersionLabel = $currentVersionLabel

    Write-Host ""
    Write-Host "  ===========================================" -ForegroundColor Cyan
    Write-Host "   请确认新配置" -ForegroundColor Cyan
    Write-Host "  ===========================================" -ForegroundColor Cyan
    Write-Host "    诊所名称: $newClinic" -ForegroundColor Green
    Write-Host "    医师姓名: $newDoctor" -ForegroundColor Green
    Write-Host "  -------------------------------------------" -ForegroundColor DarkGray
    Write-Host "  （以下为系统固定信息，不可修改）" -ForegroundColor DarkGray
    Write-Host "    产品名称: $newProduct" -ForegroundColor DarkGray
    Write-Host "    版本标签: $newVersionLabel" -ForegroundColor DarkGray
    Write-Host "  ===========================================" -ForegroundColor Cyan
    Write-Host ""

    $confirm = Read-Host "  确认以上配置吗？(Y=确认 / N=重新输入)"
    if ($confirm -ieq 'N') {
        Write-Host "  [INFO] 用户选择重新输入..." -ForegroundColor Yellow
        return Edit-ClinicConfig
    }

    $clinicChanged = ($newClinic -ne $currentClinic)
    $doctorChanged = ($newDoctor -ne $currentDoctor)
    $productChanged = ($newProduct -ne $currentProduct)
    $versionChanged = ($newVersionLabel -ne $currentVersionLabel)

    if (-not ($clinicChanged -or $doctorChanged -or $productChanged -or $versionChanged)) {
        Write-Host "  [SKIP] 所有配置均无变化" -ForegroundColor Yellow
        return 0
    }

    try {
        if ($clinicChanged) { $config.clinicName = $newClinic }
        if ($doctorChanged) { $config.doctorName = $newDoctor }
        if ($productChanged) { $config.productName = $newProduct }
        if ($versionChanged) { $config.versionLabel = $newVersionLabel }

        $issuedAt = (Get-Date).ToUniversalTime().ToString("o")
        $config | Add-Member -NotePropertyName configIssuedAt -NotePropertyValue $issuedAt -Force

        $configJsonNoSig = $config | Select-Object -Property * -ExcludeProperty configSignature | ConvertTo-Json -Depth 10
        [System.IO.File]::WriteAllText($configPath, $configJsonNoSig, $utf8NoBom)

        # 构建 HMAC 签名内容：用 -join 拼接，避免双引号字符串中 | 被解析为管道操作符
        $signParts = @($config.clinicName, $config.doctorName, $config.edition, $config.configIssuedAt)
        $signContent = $signParts -join '|'
        $hmac = New-Object System.Security.Cryptography.HMACSHA256
        $hmac.Key = [System.Text.Encoding]::UTF8.GetBytes($CONFIG_SIGN_KEY)
        $hashBytes = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($signContent))
        $configSignature = ($hashBytes | ForEach-Object { $_.ToString('x2') }) -join ''
        $config | Add-Member -NotePropertyName configSignature -NotePropertyValue $configSignature -Force

        $configJson = $config | ConvertTo-Json -Depth 10
        [System.IO.File]::WriteAllText($configPath, $configJson, $utf8NoBom)

        Write-Host "  [OK] config.json updated with HMAC signature" -ForegroundColor Green

        if ($clinicChanged) { Write-Host "    诊所名称: $currentClinic -> $newClinic" -ForegroundColor Green }
        if ($doctorChanged) { Write-Host "    医师姓名: $currentDoctor -> $newDoctor" -ForegroundColor Green }
        if ($productChanged) { Write-Host "    产品名称: $currentProduct -> $newProduct" -ForegroundColor Green }
        if ($versionChanged) { Write-Host "    版本标签: $currentVersionLabel -> $newVersionLabel" -ForegroundColor Green }

        return 0
    } catch {
        Write-Host "  [ERROR] Failed to update config.json: $_" -ForegroundColor Red
        return 1
    }
}

function Sync-ConfigToCapacitor {
    if (-not (Test-Path $configPath)) {
        Write-Host "  [WARN] config.json not found, skip sync" -ForegroundColor Yellow
        return
    }

    if (-not (Test-Path $capPublicDir)) {
        Write-Host "  [WARN] Capacitor public dir not found: $capPublicDir" -ForegroundColor Yellow
        return
    }

    $destPath = Join-Path $capPublicDir 'config.json'
    try {
        $srcContent = [System.IO.File]::ReadAllText($configPath, $utf8NoBom)
        # ★ 2026-08-24 幂等同步：内容一致时不写文件（避免每次打包都产生无意义 dirty diff，
        #   配合 tools/build-skip.ps1 打包增量检测：config.json 无真实变化 → 工作区干净 → 可跳过重复打包）
        $dstContent = $null
        if (Test-Path $destPath) { $dstContent = [System.IO.File]::ReadAllText($destPath, $utf8NoBom) }
        if ($dstContent -eq $srcContent) {
            Write-Host "  [SKIP] config.json 已一致，无需同步" -ForegroundColor DarkGray
        } else {
            [System.IO.File]::WriteAllText($destPath, $srcContent, $utf8NoBom)
            Write-Host "  [OK] config.json synced to Capacitor public/" -ForegroundColor Green
        }
    } catch {
        Write-Host "  [WARN] Failed to sync config.json to Capacitor: $_" -ForegroundColor Yellow
    }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Huikang-TCM Config Editor - $Version" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($SkipConfig) {
    Write-Host "  [SKIP] -SkipConfig parameter detected, skipping config editing" -ForegroundColor Yellow
    Write-Host ""
} else {
    $result = Edit-ClinicConfig -AutoConfirm:$AutoConfirm
    if ($result -ne 0) {
        Write-Host "  [WARN] Config editing had issues, continuing anyway" -ForegroundColor Yellow
    }
    Write-Host ""
}

Write-Host "  Syncing config.json to Capacitor APP..." -ForegroundColor Cyan
Sync-ConfigToCapacitor
Write-Host ""

Write-Host "========================================" -ForegroundColor Green
Write-Host "  Config setup complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
