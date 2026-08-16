<#
.SYNOPSIS
    Unified Packaging Module for TCM Prescription System
.DESCRIPTION
    Self-contained, robust packaging engine.
    Solves recurring issues: encoding corruption, error propagation, versionCode management.
    Future-proof: pattern-based file sync, isolated from project code changes.
.PARAMETER Version
    Target version: dingzhi
.PARAMETER Target
    Build target: desktop | app | all | sync | config | encoding
.PARAMETER SkipConfig
    Skip clinic config modification
.PARAMETER SkipEncodingCheck
    Skip pre-packaging encoding verification
.PARAMETER Interactive
    Show interactive menu (for launcher use)
.EXAMPLE
    .\pack.ps1 -Version dingzhi -Target app
    .\pack.ps1 -Version dingzhi -Target app -SkipConfig
    .\pack.ps1 -Version dingzhi -Target appstrict
#>

param(
    [Parameter()]
    [ValidateSet('dingzhi')]
    [string]$Version,
    [Parameter()]
    [ValidateSet('desktop','app','all','sync','config','encoding','appstrict')]
    [string]$Target,
    [switch]$SkipConfig,
    [switch]$SkipEncodingCheck
)

# ============================================================================
# Section 1: Setup and Utility Functions
# ============================================================================

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

$script:ProjectRoot = $PSScriptRoot | Split-Path -Parent
$script:LogFile = $null
$script:VersionDir = $null
$script:AndroidDir = $null
$script:ElectronDir = $null
$script:OldVersionCode = $null

# UTF-8 encoders (reusable)
$script:UTF8WithBom = New-Object System.Text.UTF8Encoding($true)
$script:UTF8NoBom = New-Object System.Text.UTF8Encoding($false)

# 速度优化：npm cache 跨版本共享（dingzhi 使用统一缓存目录）
# 默认 npm cache 位于 %LOCALAPPDATA%\npm-cache，可能受 AV 扫描影响较慢
# 改为项目级共享目录，所有版本复用，避免重复下载 electron/better-sqlite3 等大包
$script:SharedNpmCache = "$script:ProjectRoot\tools\.npm-cache"
if (-not (Test-Path $script:SharedNpmCache)) {
    New-Item -ItemType Directory -Path $script:SharedNpmCache -Force | Out-Null
}
# 仅在用户未自定义时设置（避免覆盖开发者本地配置）
if (-not $env:npm_config_cache) {
    $env:npm_config_cache = $script:SharedNpmCache
}
# ELECTRON_BUILDER_CACHE 也统一到项目级，便于跨版本复用 NSIS/wine 等二进制
if (-not $env:ELECTRON_BUILDER_CACHE) {
    $env:ELECTRON_BUILDER_CACHE = "$script:ProjectRoot\tools\.eb-cache"
}

# ★ v3 安全：config.json 完整性签名密钥（与 license-manager.js / edit-config.ps1 保持一致）
# 修改 config.json 时必须同步计算 HMAC-SHA256 签名并写入 configSignature 字段
$script:CONFIG_SIGN_KEY = 'bnzc_config_sign_key_v1_2026'

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$timestamp] [$Level] $Message"
    if ($script:LogFile) {
        [System.IO.File]::AppendAllText($script:LogFile, "$line`n", $script:UTF8NoBom)
    }
    $color = switch ($Level) {
        "ERROR" { "Red" }
        "WARN"  { "Yellow" }
        "OK"    { "Green" }
        default { "White" }
    }
    Write-Host $Message -ForegroundColor $color
}

function Write-Step {
    param([string]$Step, [string]$Message)
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  $Step" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Log $Message
}

function Stop-OnError {
    param([string]$Context)
    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne $null) {
        Write-Log "[FAIL] $Context (exit code: $LASTEXITCODE)" "ERROR"
        throw "$Context 失败，退出码: $LASTEXITCODE"
    }
}

# Run external command safely. Java/Gradle/npm write warnings to stderr which
# PowerShell 5.x with ErrorActionPreference=Stop treats as terminating errors.
# This helper temporarily switches to Continue so only $LASTEXITCODE matters.
# Supports two calling conventions:
#   1. scriptblock mode:  Invoke-External { npm install } "npm install"
#   2. file mode:         Invoke-External -FilePath "foo.bat" -WorkDir "C:\path"
function Invoke-External {
    param(
        [Parameter(Mandatory=$true, ParameterSetName='ScriptBlock', Position=0)]
        [scriptblock]$Command,
        [Parameter(Mandatory=$true, ParameterSetName='FilePath', Position=0)]
        [string]$FilePath,
        [Parameter(ParameterSetName='FilePath', Position=1)]
        [string]$WorkDir,
        [Parameter(ParameterSetName='ScriptBlock', Position=1)]
        [Parameter(ParameterSetName='FilePath', Position=2)]
        [string]$Context = "external command",
        [switch]$NoPause
    )
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'

    # NoPause 模式：设置 NO_PAUSE 环境变量，让 build.bat / build-app.bat 跳过末尾 pause
    # 用于 Build-AllStrict / Build-All 连续流程，避免中间回车打断
    $prevNoPause = $env:NO_PAUSE
    if ($NoPause) {
        $env:NO_PAUSE = '1'
    }

    # Resolve FilePath to absolute path and verify existence
    if ($PSCmdlet.ParameterSetName -eq 'FilePath') {
        if (-not (Test-Path $FilePath)) {
            Write-Log "[FAIL] $Context (file not found: $FilePath)" "ERROR"
            throw "$Context 失败: 文件未找到: $FilePath"
        }
        $FilePath = (Resolve-Path $FilePath).Path
        if ($Context -eq 'external command') {
            $Context = $FilePath | Split-Path -Leaf
        }
    }

    # Change working directory if specified
    $prevLocation = $null
    if ($WorkDir) {
        $prevLocation = Get-Location
        Set-Location $WorkDir
    }

    # ★ 缓存命令输出：失败时写入日志，便于排查编译错误（如 Java @Override 失败）
    $outputBuffer = New-Object System.Collections.ArrayList
    try {
        if ($PSCmdlet.ParameterSetName -eq 'FilePath') {
            & $FilePath 2>&1 | ForEach-Object {
                $line = if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { "$_" }
                Write-Host $line -ForegroundColor $(if ($_ -is [System.Management.Automation.ErrorRecord]) { 'Yellow' } else { 'White' })
                $outputBuffer.Add($line) | Out-Null
            }
        } else {
            & $Command 2>&1 | ForEach-Object {
                $line = if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { "$_" }
                Write-Host $line -ForegroundColor $(if ($_ -is [System.Management.Automation.ErrorRecord]) { 'Yellow' } else { 'White' })
                $outputBuffer.Add($line) | Out-Null
            }
        }
        $code = $LASTEXITCODE
    } finally {
        if ($prevLocation) { Set-Location $prevLocation }
        $ErrorActionPreference = $prevEAP
        if ($NoPause) {
            if ($prevNoPause) {
                $env:NO_PAUSE = $prevNoPause
            } else {
                Remove-Item Env:\NO_PAUSE -ErrorAction SilentlyContinue
            }
        }
    }
    if ($code -ne 0 -and $code -ne $null) {
        Write-Log "[FAIL] $Context (exit code: $code)" "ERROR"
        # ★ 失败时将完整命令输出写入日志（解决编译错误不记录到日志的问题）
        if ($outputBuffer.Count -gt 0) {
            Write-Log "--- 命令输出开始 ---" "ERROR"
            foreach ($l in $outputBuffer) { Write-Log "  $l" "ERROR" }
            Write-Log "--- 命令输出结束 ---" "ERROR"
        }
        throw "$Context 失败，退出码: $code"
    }
    Write-Log "[OK] $Context (exit code: $code)"
}

# ★ 举一反三修复（2026-08-02）：node_modules 完整性检查
# 历史问题：npm ci --ignore-scripts 或打包中断后 node_modules 可能不完整
#   - BUILD_ELECTRON-003: @electron/get 仅有 LICENSE 无 package.json
#   - builder-util/electron-builder 等 package.json 丢失
# 原脚本仅检查 node_modules 目录是否存在，不完整时不会重装，导致后续 electron-builder 报 MODULE_NOT_FOUND
# 修复：安装前后都检查关键模块 package.json 是否存在，缺失则删除重装
function Test-CriticalModules {
    param([string]$Dir)
    $critical = @(
        "electron\package.json",
        "electron-builder\package.json",
        "builder-util\package.json",
        "builder-util-runtime\package.json",
        "app-builder-lib\package.json",
        "@electron\get\package.json"
    )
    $missing = @()
    foreach ($m in $critical) {
        if (-not (Test-Path "$Dir\node_modules\$m")) {
            $missing += $m
        }
    }
    return $missing
}

# ============================================================================
# Section 2: Encoding Verification
# ============================================================================

function Test-FileBom {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    return ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
}

function Repair-FileBom {
    param([string]$Path, [bool]$ShouldHaveBom)
    $hasBom = Test-FileBom -Path $Path
    if ($hasBom -eq $null) { return $false }
    if ($ShouldHaveBom -and -not $hasBom) {
        $content = [System.IO.File]::ReadAllText($Path, $script:UTF8NoBom)
        [System.IO.File]::WriteAllText($Path, $content, $script:UTF8WithBom)
        return $true
    }
    if (-not $ShouldHaveBom -and $hasBom) {
        $bytes = [System.IO.File]::ReadAllBytes($Path)
        [System.IO.File]::WriteAllBytes($Path, $bytes[3..($bytes.Length - 1)])
        return $true
    }
    return $false
}

function Invoke-EncodingCheck {
    Write-Step "编码检查" "Verifying file encoding integrity..."

    $fixed = 0

    # ★ 举一反三：扫描并修复所有 .ps1 文件的 BOM（不仅限于 edit-config.ps1）
    # 修复前问题：只检查 $script:VersionDir\edit-config.ps1，遗漏 tools/pack.ps1 等
    # 修复后：调用 fix-ps1-bom.ps1 扫描 app_project/ 和 tools/ 下所有 .ps1 文件
    # 原因：Edit 工具会剥离 .ps1 文件 BOM，导致 PowerShell 5.x 解析中文失败
    $fixBomScript = "$script:ProjectRoot\tools\fix-ps1-bom.ps1"
    if (Test-Path $fixBomScript) {
        Write-Host "  扫描所有 .ps1 文件 BOM..." -ForegroundColor Cyan
        & $fixBomScript
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  [OK] 所有 .ps1 文件 BOM 检查通过" -ForegroundColor Green
        } else {
            Write-Host "  [WARN] 部分文件已自动修复 BOM" -ForegroundColor Yellow
            $fixed++
        }
    } else {
        # 降级：仅检查当前版本的 edit-config.ps1
        $ps1Files = @(
            "$script:VersionDir\edit-config.ps1"
        ) | Where-Object { Test-Path $_ }

        foreach ($f in $ps1Files) {
            if (Test-FileBom -Path $f) {
                Write-Host "  [OK]   $($f | Split-Path -Leaf) : BOM 已存在" -ForegroundColor Green
            } else {
                Write-Host "  [FIX]  $($f | Split-Path -Leaf) : BOM 缺失，修复中..." -ForegroundColor Yellow
                Repair-FileBom -Path $f -ShouldHaveBom $true | Out-Null
                $fixed++
            }
        }
    }

    # Check index.html: MUST NOT have BOM
    $htmlFiles = @(
        "$script:DesktopDir\index.html",
        "$script:AndroidDir\app\src\main\assets\public\index.html"
    ) | Where-Object { Test-Path $_ }

    foreach ($f in $htmlFiles) {
        $hasBom = Test-FileBom -Path $f
        if ($hasBom) {
            Write-Host "  [FIX]  $($f | Split-Path -Leaf) : 检测到 BOM，去除中..." -ForegroundColor Yellow
            Repair-FileBom -Path $f -ShouldHaveBom $false | Out-Null
            $fixed++
        } else {
            Write-Host "  [OK]   $($f | Split-Path -Leaf) : 无 BOM" -ForegroundColor Green
        }
    }

    if ($fixed -gt 0) {
        Write-Log "[OK] Encoding check: $fixed file(s) auto-repaired" "OK"
    } else {
        Write-Log "[OK] Encoding check: all files OK" "OK"
    }
}

# ============================================================================
# Section 3: Config Modification
# ============================================================================

function Edit-ClinicConfig {
    Write-Step "配置修改" "Modifying clinic configuration..."

    $configPath = "$script:DesktopDir\config.json"
    $htmlPath = "$script:DesktopDir\index.html"

    if (-not (Test-Path $configPath)) {
        Write-Log "[WARN] config.json not found, skipping config" "WARN"
        return
    }

    try {
        # Read config
        $config = [System.IO.File]::ReadAllText($configPath, $script:UTF8NoBom) | ConvertFrom-Json
        $currentClinic = $config.clinicName
        $currentDoctor = $config.doctorName
        Write-Log "Config read: clinic=$currentClinic, doctor=$currentDoctor"
    } catch {
        Write-Log "[ERROR] Failed to read config.json: $_" "ERROR"
        Write-Host "  [错误] 读取 config.json 失败: $_" -ForegroundColor Red
        return
    }

    Write-Host ""
    Write-Host "  ===========================================" -ForegroundColor Cyan
    Write-Host "   当前诊所信息确认" -ForegroundColor Cyan
    Write-Host "  ===========================================" -ForegroundColor Cyan
    Write-Host "    诊所名称: $currentClinic" -ForegroundColor Yellow
    Write-Host "    医师姓名: $currentDoctor" -ForegroundColor Yellow
    Write-Host "  ===========================================" -ForegroundColor Cyan
    Write-Host "  (按回车键保留当前值，或输入新值修改)" -ForegroundColor DarkGray
    Write-Host ""

    # 编辑诊所名称
    $newClinic = Read-Host "  请输入诊所名称 [$currentClinic]"
    if ([string]::IsNullOrWhiteSpace($newClinic)) {
        $newClinic = $currentClinic
        Write-Host "  [SKIP] 诊所名称保持不变: $newClinic" -ForegroundColor Yellow
    }

    # 编辑医生姓名
    $newDoctor = Read-Host "  请输入医师姓名 [$currentDoctor]"
    if ([string]::IsNullOrWhiteSpace($newDoctor)) {
        $newDoctor = $currentDoctor
        Write-Host "  [SKIP] 医师姓名保持不变: $newDoctor" -ForegroundColor Yellow
    }

    # 最终确认
    Write-Host ""
    Write-Host "  ===========================================" -ForegroundColor Cyan
    Write-Host "   请确认信息" -ForegroundColor Cyan
    Write-Host "  ===========================================" -ForegroundColor Cyan
    Write-Host "    诊所名称: $newClinic" -ForegroundColor Green
    Write-Host "    医师姓名: $newDoctor" -ForegroundColor Green
    Write-Host "  ===========================================" -ForegroundColor Cyan
    Write-Host ""
    $confirm = Read-Host "  确认以上信息吗？(Y=确认 / N=重新输入 / 回车=确认)"
    if ($confirm -ieq 'N') {
        Write-Host "  [INFO] 用户选择重新输入..." -ForegroundColor Yellow
        # 递归调用重新输入
        Edit-ClinicConfig
        return
    }

    # 检查是否有变化
    $clinicChanged = ($newClinic -ne $currentClinic)
    $doctorChanged = ($newDoctor -ne $currentDoctor)

    Write-Log "Config change check: clinicChanged=$clinicChanged, doctorChanged=$doctorChanged (old=$currentClinic/$currentDoctor, new=$newClinic/$newDoctor)"

    if (-not $clinicChanged -and -not $doctorChanged) {
        Write-Host "  [SKIP] 诊所信息和医师姓名均无变化" -ForegroundColor Yellow
        Write-Log "Config: no changes (clinic=$newClinic, doctor=$newDoctor)"
        return
    }

    Write-Host "  [INFO] 检测到配置变化，开始更新..." -ForegroundColor Cyan
    Write-Log "Config: proceeding with update (clinicChanged=$clinicChanged, doctorChanged=$doctorChanged)"

    try {
        # 更新 config.json（必须计算 HMAC-SHA256 签名，与 edit-config.ps1 保持一致）
        if ($clinicChanged) { $config.clinicName = $newClinic }
        if ($doctorChanged) { $config.doctorName = $newDoctor }

        # ★ v3 安全：写入签名时间戳（UTC ISO 8601，与 license-manager.js 验签逻辑匹配）
        # 使用 Add-Member -Force 避免属性不存在时报错（PowerShell 5.1 PSCustomObject 限制）
        $issuedAt = (Get-Date).ToUniversalTime().ToString("o")
        $config | Add-Member -NotePropertyName configIssuedAt -NotePropertyValue $issuedAt -Force
        Write-Log "Config: writing config.json (clinic=$($config.clinicName), doctor=$($config.doctorName))"

        # 先写入不含签名的 config.json（清掉可能存在的旧 configSignature）
        $config | Select-Object -Property * -ExcludeProperty configSignature |
            ConvertTo-Json -Depth 10 |
            Set-Content -Path $configPath -Encoding UTF8

        # ★ v3 安全：计算 HMAC-SHA256 签名
        # 签名内容：clinicName|doctorName|edition|configIssuedAt
        Write-Log "Config: computing HMAC-SHA256 signature..."
        $signContent = "$($config.clinicName)|$($config.doctorName)|$($config.edition)|$($config.configIssuedAt)"
        $hmac = New-Object System.Security.Cryptography.HMACSHA256
        $hmac.Key = [System.Text.Encoding]::UTF8.GetBytes($script:CONFIG_SIGN_KEY)
        $hashBytes = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($signContent))
        $configSignature = ($hashBytes | ForEach-Object { $_.ToString("x2") }) -join ''
        $config | Add-Member -NotePropertyName configSignature -NotePropertyValue $configSignature -Force
        Write-Log "Config: HMAC signature computed: $configSignature"

        # 重新写入带签名的 config.json（无 BOM，与 edit-config.ps1 保持一致）
        $configJson = $config | ConvertTo-Json -Depth 10
        [System.IO.File]::WriteAllText($configPath, $configJson, $script:UTF8NoBom)
        Write-Log "Config: config.json written successfully"

        Write-Host "  [OK] config.json 签名已生成: $configSignature" -ForegroundColor Green

        # 更新 index.html (NO BOM - critical!)
        $html = [System.IO.File]::ReadAllText($htmlPath, $script:UTF8NoBom)
        Write-Log "Config: index.html read, length=$($html.Length)"

        if ($clinicChanged) {
            # Pattern: clinicName: 'xxx' -> clinicName: 'newClinic'
            $pattern1 = "clinicName:\s*'[^']*'"
            $replacement1 = "clinicName: '$newClinic'"
            $html = $html -replace $pattern1, $replacement1

            # Pattern: clinic-info-name">xxx< -> clinic-info-name">newClinic<
            $pattern2 = 'clinic-info-name">[^<]*<'
            $replacement2 = 'clinic-info-name">' + $newClinic + '<'
            $html = $html -replace $pattern2, $replacement2

            # Pattern: clinicNameDisplay">xxx< -> clinicNameDisplay">newClinic<
            $pattern3 = 'clinicNameDisplay">[^<]*<'
            $replacement3 = 'clinicNameDisplay">' + $newClinic + '<'
            $html = $html -replace $pattern3, $replacement3
            Write-Host "  [OK] 诊所名称已更新: $currentClinic -> $newClinic" -ForegroundColor Green
        }

        if ($doctorChanged) {
            # Pattern: doctorName: 'xxx' -> doctorName: 'newDoctor'
            $pattern4 = "doctorName:\s*'[^']*'"
            $replacement4 = "doctorName: '$newDoctor'"
            $html = $html -replace $pattern4, $replacement4
            Write-Host "  [OK] 医师姓名已更新: $currentDoctor -> $newDoctor" -ForegroundColor Green
        }

        # 写入 index.html 前日志
        Write-Log "Config: writing index.html (length=$($html.Length))"
        [System.IO.File]::WriteAllText($htmlPath, $html, $script:UTF8NoBom)
        # 写入 index.html 后日志
        Write-Log "Config: index.html written successfully"
    }
    catch {
        Write-Log "[ERROR] Config update failed: $_" "ERROR"
        Write-Host ""
        Write-Host "  [错误] 配置更新失败: $_" -ForegroundColor Red
        Write-Host "  请检查错误信息后重试" -ForegroundColor Yellow
        # ★ 改为 throw（而非 return），避免错误被吞没后继续打包产生配置错误的产物
        throw "配置更新失败: $_"
    }

    Write-Host ""
    Write-Host "  ===========================================" -ForegroundColor Green
    Write-Host "   [完成] 配置已写入 config.json 和 index.html" -ForegroundColor Green
    Write-Host "  ===========================================" -ForegroundColor Green
    Write-Log "Config: clinic name = $newClinic, doctor name = $newDoctor"
}

# ============================================================================
# Section 4: File Sync (Pattern-based, future-proof)
# ============================================================================

function Copy-FileWithLog {
    param([string]$Src, [string]$Dst)
    if (Test-Path $Src) {
        Copy-Item -Path $Src -Destination $Dst -Force
        Write-Host "  [OK]   $(Split-Path $Src -Leaf) 已同步" -ForegroundColor Green
    } else {
        Write-Host "  [SKIP] $(Split-Path $Src -Leaf) 未找到" -ForegroundColor Yellow
    }
}

function Sync-FilesToApp {
    Write-Step "文件同步" "Syncing web files to Android assets..."

    $publicDir = "$script:AndroidDir\app\src\main\assets\public"
    $assetsDir = "$script:AndroidDir\app\src\main\assets"

    # Ensure target directory exists
    if (-not (Test-Path $publicDir)) {
        New-Item -ItemType Directory -Path $publicDir -Force | Out-Null
    }

    # Sync config.json
    Copy-FileWithLog "$script:DesktopDir\config.json" "$publicDir\config.json"

    # Sync index.html (CRITICAL: no BOM)
    Copy-FileWithLog "$script:DesktopDir\index.html" "$publicDir\index.html"
    # Strip BOM if present (belt-and-suspenders)
    Repair-FileBom -Path "$publicDir\index.html" -ShouldHaveBom $false | Out-Null

    # Sync all .js modules in version root (pattern-based, auto-discovers new files)
    # Exclude: main.js (electron entry point, not for Android)
    $excludeJs = @('main.js')
    Get-ChildItem -Path $script:DesktopDir -Filter "*.js" -File | Where-Object { $_.Name -notin $excludeJs } | ForEach-Object {
        Copy-FileWithLog $_.FullName "$publicDir\$($_.Name)"
    }

    # Sync vendor/ directory
    $vendorSrc = "$script:DesktopDir\vendor"
    if (Test-Path $vendorSrc) {
        $vendorDst = "$publicDir\vendor"
        if (-not (Test-Path $vendorDst)) {
            New-Item -ItemType Directory -Path $vendorDst -Force | Out-Null
        }
        Get-ChildItem -Path $vendorSrc -Filter "*.js" -File | ForEach-Object {
            Copy-FileWithLog $_.FullName "$vendorDst\$($_.Name)"
        }
    }

    # Sync video-recorder-inject.js to assets/ (not public/)
    # 源文件可选：若版本根目录有则同步；没有则验证目标已存在（该文件由 _shared 或 git 直接维护在 assets/ 下）
    $injectSrc = "$script:VersionDir\video-recorder-inject.js"
    $injectDst = "$assetsDir\video-recorder-inject.js"
    if (Test-Path $injectSrc) {
        Copy-FileWithLog $injectSrc $injectDst
    } elseif (Test-Path $injectDst) {
        Write-Host "  [OK]   video-recorder-inject.js 已存在于 assets/" -ForegroundColor Green
    } else {
        Write-Host "  [WARN] video-recorder-inject.js 缺失，录像功能将不可用" -ForegroundColor Red
        Write-Log "[WARN] video-recorder-inject.js 缺失于 $injectDst"
    }

    Write-Log "[OK] File sync completed"
}

# ============================================================================
# Section 5: VersionCode Management (with rollback)
# ============================================================================

function Get-VersionCode {
    $gradlePath = "$script:AndroidDir\app\build.gradle"
    $content = [System.IO.File]::ReadAllText($gradlePath, $script:UTF8NoBom)
    $pattern = 'versionCode\s+(\d+)'
    if ($content -match $pattern) {
        return [int]$matches[1]
    }
    return $null
}

function Set-VersionCode {
    param([int]$Code)
    $gradlePath = "$script:AndroidDir\app\build.gradle"
    $content = [System.IO.File]::ReadAllText($gradlePath, $script:UTF8NoBom)
    $pattern = 'versionCode\s+\d+'
    $replacement = "versionCode $Code"
    $content = $content -replace $pattern, $replacement
    [System.IO.File]::WriteAllText($gradlePath, $content, $script:UTF8NoBom)
}

function Increment-VersionCode {
    Write-Step "版本号管理" "Incrementing versionCode..."

    $script:OldVersionCode = Get-VersionCode
    if ($script:OldVersionCode -eq $null) {
        Write-Log "[WARN] versionCode not found in build.gradle, skipping" "WARN"
        return
    }

    $newCode = $script:OldVersionCode + 1
    Set-VersionCode -Code $newCode
    Write-Host "  [OK] versionCode: $($script:OldVersionCode) -> $newCode" -ForegroundColor Green
    Write-Log "versionCode: $($script:OldVersionCode) -> $newCode"
}

function Restore-VersionCode {
    if ($script:OldVersionCode -ne $null) {
        Write-Log "[ROLLBACK] Restoring versionCode to $($script:OldVersionCode)" "WARN"
        Set-VersionCode -Code $script:OldVersionCode
        Write-Host "  [ROLLBACK] versionCode 已回滚到 $($script:OldVersionCode)" -ForegroundColor Yellow
    }
}

# ============================================================================
# Section 6: Desktop Build (Electron)
# ============================================================================

function Build-Desktop {
    Write-Step "桌面版打包" "Building Electron desktop application..."

    # Pre-flight check: 检测上次非正常退出残留（.bak/certbak/dist_old/Gradle daemon）
    & "$PSScriptRoot\pre-flight-check.ps1" -Target $Version -DesktopDir $script:DesktopDir

    # Kill old process (only target our app, reduce wait time)
    $processNames = @("app-local", "app-custom", "app-personal", "HuikangTCM-Local", "HuikangTCM-Custom", "HuikangTCM-Personal")
    foreach ($proc in $processNames) {
        $running = Get-Process -Name $proc -ErrorAction SilentlyContinue
        if ($running) {
            Write-Host "  停止进程: $proc" -ForegroundColor Yellow
            $running | Stop-Process -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Milliseconds 500  # reduced from 1s

    # Check node_modules - use npm ci for faster, deterministic install
    Write-Log "[STAGE:deps] start - 安装桌面版 npm 依赖"
    # ★ 举一反三修复（2026-08-02）：不仅检查 node_modules 是否存在，还检查关键模块完整性。
    # 历史问题：打包中断后 node_modules 残留但不完整（package.json 丢失），下次打包跳过安装，
    # 导致 electron-builder 报 Cannot find module 'builder-util'。
    $missingModules = Test-CriticalModules $script:DesktopDir
    $needInstall = (-not (Test-Path "$script:DesktopDir\node_modules")) -or ($missingModules.Count -gt 0)
    if ($needInstall) {
        if ($missingModules.Count -gt 0) {
            Write-Host "  [WARN] 关键模块不完整（缺失 package.json）: $($missingModules -join ', ')" -ForegroundColor Yellow
            Write-Host "  [INFO] 删除损坏的 node_modules 重新安装..." -ForegroundColor Cyan
            if (Test-Path "$script:DesktopDir\node_modules") {
                Remove-Item "$script:DesktopDir\node_modules" -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
        $lockFile = "$script:DesktopDir\package-lock.json"
        Write-Host "  安装 npm 依赖中..." -ForegroundColor Yellow
        Push-Location $script:DesktopDir
        try {
            if (Test-Path $lockFile) {
                # npm ci is 2-3x faster than npm install when lock file exists
                # --ignore-scripts: 跳过 asarmor 的 postinstall（node-gyp 原生编译，需要 VS C++ 工具链）。
                # afterPack.js 仅使用 createBloatPatch（纯 JS），不依赖原生加密模块；
                # electron 二进制由下方独立逻辑下载，故跳过 lifecycle scripts 安全。
                Invoke-External { npm ci --no-audit --no-fund --prefer-offline --ignore-scripts } "npm ci"
            } else {
                Invoke-External { npm install --no-audit --no-fund --prefer-offline --ignore-scripts } "npm install"
            }
        } finally {
            Pop-Location
        }
        # ★ 安装后再次验证完整性，若仍不完整则清理 cache 强制重装
        $missingAfter = Test-CriticalModules $script:DesktopDir
        if ($missingAfter.Count -gt 0) {
            Write-Host "  [WARN] 安装后关键模块仍缺失: $($missingAfter -join ', ')" -ForegroundColor Yellow
            Write-Host "  [INFO] 清理共享 npm cache 强制重新下载..." -ForegroundColor Cyan
            Remove-Item "$script:DesktopDir\node_modules" -Recurse -Force -ErrorAction SilentlyContinue
            Push-Location $script:DesktopDir
            try {
                if (Test-Path $lockFile) {
                    Invoke-External { npm ci --no-audit --no-fund --ignore-scripts } "npm ci (no cache)"
                } else {
                    Invoke-External { npm install --no-audit --no-fund --ignore-scripts } "npm install (no cache)"
                }
            } finally {
                Pop-Location
            }
            $missingRetry = Test-CriticalModules $script:DesktopDir
            if ($missingRetry.Count -gt 0) {
                throw "关键模块安装失败（重试后仍缺失）: $($missingRetry -join ', ')"
            }
        }
        Write-Host "  [OK] 关键模块完整性验证通过" -ForegroundColor Green
    }
    # 检查 electron dist（--ignore-scripts 安装时 postinstall 不执行，需手动下载）
    if (-not (Test-Path "$script:DesktopDir\node_modules\electron\dist\electron.exe")) {
        Write-Host "  electron dist 缺失，下载二进制文件中..." -ForegroundColor Yellow
        # ★ 举一反三修复（2026-08-02）：@electron/get 包可能在 npm ci --ignore-scripts 后损坏
        # （目录仅 LICENSE 无 package.json/dist），导致 install.js 的 require('@electron/get')
        # 抛 MODULE_NOT_FOUND。install.js 失败改为软失败，让流程继续走下方 .NET 回退解压。
        $electronGetOk = (Test-Path "$script:DesktopDir\node_modules\@electron\get\package.json") -and `
                         (Test-Path "$script:DesktopDir\node_modules\@electron\get\dist")
        Push-Location $script:DesktopDir
        try {
            $env:NODE_TLS_REJECT_UNAUTHORIZED = '0'
            $env:ELECTRON_MIRROR = 'https://registry.npmmirror.com/-/binary/electron/'
            if (-not $electronGetOk) {
                Write-Host "  [WARN] @electron/get 包不完整，跳过 install.js，直接走 .NET 回退解压" -ForegroundColor Yellow
            } else {
                try {
                    Invoke-External { node "node_modules\electron\install.js" } "electron install"
                } catch {
                    Write-Host "  [WARN] install.js 失败: $_ 将尝试 .NET 回退解压" -ForegroundColor Yellow
                }
            }
        } finally {
            Remove-Item Env:\NODE_TLS_REJECT_UNAUTHORIZED -ErrorAction SilentlyContinue
            Remove-Item Env:\ELECTRON_MIRROR -ErrorAction SilentlyContinue
            Pop-Location
        }
        if (-not (Test-Path "$script:DesktopDir\node_modules\electron\dist\electron.exe")) {
            # ★ 回退：install.js 依赖 extract-zip 模块解压，该模块在某些 Windows 环境
            # 下会静默部分解压（仅 locales，无 electron.exe）却返回 exit 0。
            # 回退方案：从缓存中找到已下载的 zip，用 .NET ZipFile 直接解压。
            Write-Host "  [WARN] install.js 解压不完整，尝试 .NET 回退解压..." -ForegroundColor Yellow
            $electronVer = (Get-Content "$script:DesktopDir\node_modules\electron\package.json" -Raw | ConvertFrom-Json).version
            $cacheZip = Join-Path $env:LOCALAPPDATA "electron\Cache\electron-v$electronVer-win32-x64.zip"
            if (-not (Test-Path $cacheZip)) {
                # 兜底：扫描缓存目录下匹配版本的 zip
                $cacheDir = Join-Path $env:LOCALAPPDATA "electron\Cache"
                $found = Get-ChildItem $cacheDir -Filter "electron-v$electronVer-*.zip" -ErrorAction SilentlyContinue | Select-Object -First 1
                if ($found) { $cacheZip = $found.FullName }
            }
            if (Test-Path $cacheZip) {
                Write-Host "  [INFO] 从缓存解压: $cacheZip" -ForegroundColor Cyan
                $electronDist = "$script:DesktopDir\node_modules\electron\dist"
                if (Test-Path $electronDist) { Remove-Item "$electronDist\*" -Recurse -Force -ErrorAction SilentlyContinue }
                Add-Type -AssemblyName System.IO.Compression.FileSystem
                [System.IO.Compression.ZipFile]::ExtractToDirectory($cacheZip, $electronDist)
                # 写入 path.txt（install.js 解压成功后也会写，此处补齐）
                Set-Content -Path "$script:DesktopDir\node_modules\electron\path.txt" -Value "electron.exe" -NoNewline -Encoding ASCII
                Write-Host "  [OK] .NET 解压完成" -ForegroundColor Green
            }
            if (-not (Test-Path "$script:DesktopDir\node_modules\electron\dist\electron.exe")) {
                Write-Host "  [ERROR] electron 二进制文件下载失败" -ForegroundColor Red
                # ★ 改为 throw（而非 exit 1），确保外层 try/finally 执行环境变量恢复
                throw "electron 二进制文件下载失败"
            }
        }
    }

    # Obfuscate JS
    # ★ 稳定性修复：混淆步骤本身也可能失败（部分文件已生成 .bak），失败时必须 restore 清理
    # 修复前问题：若 obfuscate.js 中途失败，已生成的 .bak 残留开发环境，下次打包会触发误还原
    Write-Log "[STAGE:obfuscate] start - JS 代码混淆（安全加固）"
    Write-Host "  混淆 JavaScript 中..." -ForegroundColor Yellow
    $obfuscateOk = $false
    Push-Location $script:ProjectRoot
    try {
        Invoke-External { node "tools\obfuscate.js" --target=$Version } "JS obfuscation"
        $obfuscateOk = $true
    } finally {
        Pop-Location
        if (-not $obfuscateOk) {
            Write-Host "  [WARN] 混淆失败，正在 restore 清理 .bak 残留..." -ForegroundColor Yellow
            Push-Location $script:ProjectRoot
            try {
                Invoke-External { node "tools\obfuscate.js" restore --target=$Version } "JS restore after obfuscate failure"
            } catch {
                Write-Log "[WARN] JS restore failed after obfuscate failure" "WARN"
            } finally {
                Pop-Location
            }
        }
    }

    # ★ 稳定性修复：将后续所有步骤包裹在 try-finally 中，确保任何步骤失败时都能还原 JS 源码
    # 修复前问题：若证书检查/prepare-win-unpacked 等步骤抛异常，混淆源码会卡住不还原，污染开发环境
    try {
    # ★ 证书存在性检查（防止证书丢失时 electron-builder 签名失败）
    # 策略：
    #   1. 先读 package.json，若未配置 certificateFile → 直接跳过签名（不检查 pfx/密码文件）
    #   2. 若配置了 certificateFile → 检查 pfx 和 cert-password.txt 是否存在
    #      任一缺失 → 临时移除 certificateFile 配置（避免 electron-builder 签名失败）
    #   3. 证书齐全 → 加载 CSC_KEY_PASSWORD
    $certPath = "$script:ProjectRoot\tools\certs\惠康中医-codesign.pfx"
    $certPwdFile = "$script:ProjectRoot\tools\certs\cert-password.txt"
    $pkgPath = "$script:DesktopDir\package.json"
    $certBackupPath = "$script:DesktopDir\package.json.certbak"

    # 读取 package.json 检查是否配置了 certificateFile
    $pkgContent = Get-Content $pkgPath -Raw -Encoding UTF8
    $hasCertConfig = $pkgContent -match '"certificateFile"'

    if (-not $hasCertConfig) {
        # package.json 未配置 certificateFile → 默认不签名（当前默认状态）
        Write-Host "  [INFO] 未配置代码签名（package.json 无 certificateFile）" -ForegroundColor Cyan
        Write-Host "         如需启用签名：1) 在 package.json 的 build.win 添加 certificateFile" -ForegroundColor DarkGray
        Write-Host "                          2) 运行 tools\gen-code-sign-cert.ps1 生成证书" -ForegroundColor DarkGray
        # 清除可能残留的 CSC_KEY_PASSWORD
        Remove-Item Env:CSC_KEY_PASSWORD -ErrorAction SilentlyContinue
    } else {
        # 配置了 certificateFile → 检查 pfx 和密码文件
        $certExists = Test-Path $certPath
        $pwdExists = Test-Path $certPwdFile
        if (-not $certExists -or -not $pwdExists) {
            Write-Host "  [WARN] 代码签名证书或密码文件缺失，将跳过签名" -ForegroundColor Yellow
            if (-not $certExists) { Write-Host "         证书路径: $certPath (未找到)" -ForegroundColor Yellow }
            if (-not $pwdExists)  { Write-Host "         密码文件: $certPwdFile (未找到)" -ForegroundColor Yellow }
            Write-Host "         如需启用签名，请运行: powershell -File tools\gen-code-sign-cert.ps1" -ForegroundColor Yellow
            Write-Host "         临时从 package.json 移除 certificateFile 配置..." -ForegroundColor Yellow
            # 清除可能残留的 CSC_KEY_PASSWORD
            Remove-Item Env:CSC_KEY_PASSWORD -ErrorAction SilentlyContinue
            Copy-Item -Path $pkgPath -Destination $certBackupPath -Force
            try {
                $pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
                if ($pkg.build.win.PSObject.Properties.Name -contains 'certificateFile') {
                    $pkg.build.win.PSObject.Properties.Remove('certificateFile')
                }
                if ($pkg.build.win.PSObject.Properties.Name -contains 'certificatePassword') {
                    $pkg.build.win.PSObject.Properties.Remove('certificatePassword')
                }
                $jsonStr = $pkg | ConvertTo-Json -Depth 10
                [System.IO.File]::WriteAllText($pkgPath, $jsonStr, (New-Object System.Text.UTF8Encoding $false))
                Write-Host "  [OK] 已临时移除证书配置，构建后将恢复" -ForegroundColor Green
            } catch {
                Write-Host "  [ERROR] 修改 package.json 失败: $($_.Exception.Message)" -ForegroundColor Red
                if (Test-Path $certBackupPath) {
                    Copy-Item -Path $certBackupPath -Destination $pkgPath -Force
                    Remove-Item $certBackupPath -Force -ErrorAction SilentlyContinue
                }
                return 1
            }
        } else {
            # ★ P1-安全加固: 证书密码从本地 cert-password.txt 读取（仅当证书和密码都存在时才加载）
            $env:CSC_KEY_PASSWORD = (Get-Content $certPwdFile -Raw).Trim()
            Write-Host "  [OK] 代码签名证书已就绪" -ForegroundColor Green
            Write-Host "  [OK] 证书密码已从 cert-password.txt 加载" -ForegroundColor Green
        }
    }

    # ★ 修复：使用 --prepackaged 模式，跳过 app-builder.exe 解包步骤
    # 原因：TRAE IDE 沙箱阻止 app-builder.exe 创建目录，导致打包失败
    # 方案：先用 prepare-win-unpacked.js 准备 win-unpacked 目录，
    #       再用 electron-builder --prepackaged 跳过解包步骤
    Write-Host "  准备 win-unpacked 目录..." -ForegroundColor Yellow
    $prepareScript = "$script:ProjectRoot\tools\prepare-win-unpacked.js"
    if (Test-Path $prepareScript) {
        Invoke-External { node $prepareScript $script:DesktopDir } "prepare-win-unpacked"
    } else {
        Write-Host "  [WARN] prepare-win-unpacked.js 未找到，使用传统构建模式" -ForegroundColor Yellow
    }

    # Build with electron-builder --prepackaged
    Write-Log "[STAGE:build] start - electron-builder 打包（含 asarmor 防解包）"
    Write-Host "  运行 electron-builder (--prepackaged)..." -ForegroundColor Yellow
    Push-Location $script:DesktopDir
    try {
        $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://registry.npmmirror.com/-/binary/electron-builder-binaries/"
        # ELECTRON_BUILDER_CACHE 已在脚本开头设置为项目级共享目录
        $env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
        # ★ 修复 NSIS "Error writing temporary file" 错误
        # 原因：TRAE 沙箱可能阻止 NSIS 编译器(makensis.exe)写入系统 %TEMP% 目录
        # 方案：将 TEMP/TMP 重定向到项目本地的 tmp 目录
        $localTemp = "$script:DesktopDir\tmp"
        if (-not (Test-Path $localTemp)) { New-Item -ItemType Directory -Path $localTemp -Force | Out-Null }
        $prevTemp = $env:TEMP
        $prevTmp = $env:TMP
        $env:TEMP = $localTemp
        $env:TMP = $localTemp
        try {
            # Read actual win-unpacked path (may differ if dir was locked and renamed)
            $unpackPath = "dist/win-unpacked"
            $pathFile = "$script:DesktopDir\dist\win-unpacked-path.txt"
            if (Test-Path $pathFile) {
                $actualPath = Get-Content $pathFile -Raw -Encoding UTF8 | ForEach-Object { $_.Trim() }
                if ($actualPath -and (Test-Path $actualPath)) {
                    $unpackPath = $actualPath
                    # Convert to relative path for electron-builder
                    $unpackPath = $unpackPath.Replace("$script:DesktopDir\", "").Replace($script:DesktopDir, "")
                    $unpackPath = $unpackPath.Replace("\", "/")
                    Write-Host "  [INFO] Using win-unpacked: $unpackPath" -ForegroundColor Cyan
                }
            }
            Invoke-External { node "node_modules\electron-builder\cli.js" --win --prepackaged $unpackPath } "electron-builder --prepackaged"
        } catch {
            Write-Host ""
            Write-Host "  [ERROR] electron-builder 失败: $_" -ForegroundColor Red
            Write-Log "[ERROR] electron-builder --prepackaged failed" "ERROR"
            # ★ P1-B5 修复：构建失败时恢复 package.json 原始配置（JS 源码由外层 finally 统一恢复）
            if (Test-Path $certBackupPath) {
                Copy-Item -Path $certBackupPath -Destination $pkgPath -Force
                Remove-Item $certBackupPath -Force -ErrorAction SilentlyContinue
                Write-Host "  [OK] 已恢复 package.json 原始配置" -ForegroundColor Green
            }
            throw
        } finally {
            Remove-Item Env:\NODE_TLS_REJECT_UNAUTHORIZED -ErrorAction SilentlyContinue
            Remove-Item Env:\ELECTRON_BUILDER_BINARIES_MIRROR -ErrorAction SilentlyContinue
            # 恢复原始 TEMP/TMP
            $env:TEMP = $prevTemp
            $env:TMP = $prevTmp
            # 清理本地临时目录
            if (Test-Path $localTemp) { Remove-Item $localTemp -Recurse -Force -ErrorAction SilentlyContinue }
        }
    } finally {
        Pop-Location
    }

    # ★ 构建后恢复 package.json
    if (Test-Path $certBackupPath) {
        Copy-Item -Path $certBackupPath -Destination $pkgPath -Force
        Remove-Item $certBackupPath -Force -ErrorAction SilentlyContinue
        Write-Host "  [OK] 已恢复 package.json 原始配置" -ForegroundColor Green
    }

    # P1-易用：验证产物存在并显示大小
    $distDir = "$script:DesktopDir\dist"
    if (Test-Path $distDir) {
        $exeFiles = Get-ChildItem -Path $distDir -Filter "*.exe" -ErrorAction SilentlyContinue
        if ($exeFiles) {
            foreach ($f in $exeFiles) {
                $sizeMB = [math]::Round($f.Length / 1MB, 2)
                Write-Host "  [OK] 产物: $($f.Name)  $sizeMB MB" -ForegroundColor Green
                Write-Log "[OK] Built exe: $($f.Name) ($sizeMB MB)"
            }
        } else {
            Write-Host "  [WARN] dist 目录下未发现 .exe 文件（可能仅生成 NSIS 安装包）" -ForegroundColor Yellow
        }
    }

    # Restore JS (de-obfuscate) - 由外层 try-finally 统一处理
    } finally {
        # ★ 稳定性修复：无论构建成功或失败，都恢复 JS 源码（防源码污染开发环境）
        Write-Host "  恢复 JavaScript 中..." -ForegroundColor Yellow
        Push-Location $script:ProjectRoot
        try {
            Invoke-External { node "tools\obfuscate.js" restore --target=$Version } "JS restore"
        } catch {
            Write-Log "[WARN] JS restore failed after desktop build" "WARN"
        } finally {
            Pop-Location
        }
    }

    Write-Log "[OK] Desktop build completed"
}

# ============================================================================
# Section 7: APP Build (Android Gradle)
# ============================================================================

function Build-App {
    Write-Step "APP 打包" "Building Android APK..."

    # Pre-flight check: 检测上次非正常退出残留（.build_vcode_prev/.bak/configuration-cache/Gradle daemon）
    & "$PSScriptRoot\pre-flight-check.ps1" -Target $Version -AppDir $script:AndroidDir

    # ★ 统一入口：委托 build-app.bat（db-offline\build-app.bat → app\build-app.bat）
    # 与云端 packaging.ps1 对齐，所有 APP 打包逻辑收敛到 build-app.bat：
    #   - 选择器配置(SKIP_CONFIG=1 跳过编辑，沿用现有配置)
    #   - 同步 shared / Android assets
    #   - 自动递增 versionCode
    #   - gradlew clean + JS 混淆 + Java 预编译检查 + assembleRelease
    #   - 自动刷新 APK 签名哈希（SecurityGuard/LicenseManager，普通/严格通用）
    #   - 复制 APK 到 db-offline 根目录 + 更新下载页
    $env:NO_PAUSE = '1'
    $env:SKIP_CONFIG = '1'
    try {
        Push-Location $script:VersionDir
        try {
            & "$script:VersionDir\build-app.bat"
            $code = $LASTEXITCODE
        } finally {
            Pop-Location
        }
    } finally {
        Remove-Item Env:\NO_PAUSE -ErrorAction SilentlyContinue
        Remove-Item Env:\SKIP_CONFIG -ErrorAction SilentlyContinue
    }
    if ($code -ne 0) {
        Write-Log "[FAIL] 手机 APP 打包失败（build-app.bat 退出码: $code），详见上方日志" "ERROR"
        return $code
    }
    return $code
}

# ============================================================================
# Section 8: Main Logic
# ============================================================================

function Show-Menu {
    param([string]$Ver)
    Clear-Host
    $versionLabel = switch ($Ver) {
        'dingzhi' { '定制版 (dingzhi)' }
    }
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  惠康中医打包工具 - $versionLabel" -ForegroundColor Cyan
    Write-Host "  (桌面+APP 统一入口)" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  ★ 核心打包选项:" -ForegroundColor Yellow
    Write-Host "  [1] 打包桌面版 (Electron exe)"
    Write-Host "  [2] 打包手机 APP (Android APK)"
    Write-Host "  [3] 全部打包 (桌面 + APP)"
    Write-Host "  [4] 严格模式 APP (APP+签名哈希+重打包)"
    Write-Host ""
    Write-Host "  --- 辅助工具 ---" -ForegroundColor DarkGray
    Write-Host "  [5] 仅同步文件到 Android"
    Write-Host "  [6] 修改诊所配置"
    Write-Host "  [7] 仅编码检查"
    Write-Host "  [8] 查看当前配置"
    Write-Host "  [9] 启用严格模式 (仅提取注入哈希)"
    Write-Host "  [s] 严格模式全套 (桌面+APP+哈希+重打包)"
    Write-Host ""
    Write-Host "  快捷选项:" -ForegroundColor DarkGray
    Write-Host "    [a] 快速全部打包 (跳过编码检查/配置)"
    Write-Host "    [d] 快速桌面打包 (跳过编码检查)"
    Write-Host "    [p] 快速 APP 打包 (跳过编码检查/配置)"
    Write-Host ""
    Write-Host "  [0] 退出"
    Write-Host ""
    $choice = Read-Host "  请选择 [0-9/a/d/p/s]"
    return $choice
}

function Show-CurrentConfig {
    param([string]$Ver)
    $versionDir = "$script:ProjectRoot\app_project\db-$Ver"
    $configPath = "$versionDir\config.json"
    if (-not (Test-Path $configPath)) {
        Write-Host "[错误] 未找到 config.json: $configPath" -ForegroundColor Red
        return
    }
    try {
        $config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  当前配置 ($Ver)" -ForegroundColor Cyan
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  诊所名称 : $($config.clinicName)"
        Write-Host "  医师姓名 : $($config.doctorName)"
        Write-Host "  版本标签 : $($config.versionLabel)"
        Write-Host "  产品名称 : $($config.productName)"
        Write-Host ""
        Write-Host "  已注册用户:" -ForegroundColor Yellow
        if ($config.users) {
            foreach ($u in $config.users) {
                Write-Host "    - $($u.name) ($($u.username), $($u.role))"
            }
        } else {
            Write-Host "    (无)"
        }
        Write-Host ""
    } catch {
        Write-Host "[错误] 读取配置失败: $_" -ForegroundColor Red
    }
}

function Enable-StrictMode {
    param([string]$Ver)
    $versionDir = "$script:ProjectRoot\app_project\db-$Ver"
    $hashPs1 = "$script:ProjectRoot\tools\generate-sign-hash.ps1"

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host "  启用严格模式 ($Ver)" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  前置条件:"
    Write-Host "    - 已通过选项 [2] 打包过至少一次 APK"
    Write-Host "    - APK 使用正式签名证书签名"
    Write-Host ""
    Write-Host "  流程:"
    Write-Host "    1. 从最新 APK 提取签名 SHA-256"
    Write-Host "    2. 注入到 LicenseManager.java (EXPECTED_APK_SIGNATURE_SHA256)"
    Write-Host "    3. 重新打包 APK 启用签名严格模式"
    Write-Host ""

    if (-not (Test-Path $hashPs1)) {
        Write-Host "[错误] 未找到 generate-sign-hash.ps1: $hashPs1" -ForegroundColor Red
        return 1
    }

    $confirm = Read-Host "确认启用严格模式? (Y/n) [默认回车=开始]"
    if ($confirm -eq 'n' -or $confirm -eq 'N') {
        Write-Host "  已取消"
        return 0
    }

    Write-Host ""
    Write-Log "[STEP] Enable strict mode for $Ver"
    $env:NO_PAUSE = '1'; & $hashPs1 -Version $Ver
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[错误] 哈希提取失败" -ForegroundColor Red
        Write-Log "[ERROR] generate-sign-hash.ps1 failed" "ERROR"
        return 1
    }

    Write-Host ""
    Write-Host "  哈希已注入。现在重新打包 APK 以激活严格模式。" -ForegroundColor Green
    $rebuild = Read-Host "立即重新打包 APK? (Y/n)"
    if ($rebuild -ne 'n' -and $rebuild -ne 'N') {
        Invoke-Packaging -Ver $Ver -Tgt 'app' -SkipCfg $true -SkipEnc $true
    }
    return 0
}

function Build-AllStrict {
    param([string]$Ver)
    $versionDir = "$script:ProjectRoot\app_project\db-$Ver"
    $hashPs1 = "$script:ProjectRoot\tools\generate-sign-hash.ps1"

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host "  一键打包严格模式 ($Ver)" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  步骤:"
    Write-Host "    A. 打包桌面版 (exe)"
    Write-Host "    B. 打包手机 APP (默认模式 APK：Root+调试器检测)"
    Write-Host "    C. 提取 APK 签名哈希并注入 LicenseManager.java"
    Write-Host "    D. 重新打包手机 APP (签名严格模式 APK)"
    Write-Host ""
    Write-Host "  输出:"
    Write-Host "    - 桌面版: dist\*.exe"
    Write-Host "    - 手机版: <versionDir>\*.apk (签名严格模式)"
    Write-Host ""
    Write-Host "  [INFO] 自动开始一键打包..." -ForegroundColor Green

    # Step A: Desktop build
    Write-Host ""
    Write-Host "  [步骤 A] 打包桌面版..." -ForegroundColor Cyan
    $rc = Invoke-Packaging -Ver $Ver -Tgt 'desktop' -SkipCfg $false -SkipEnc $false
    if ($rc -ne 0) {
        Write-Host "[错误] 桌面版打包失败，终止" -ForegroundColor Red
        return 1
    }

    # Step B: Mobile build (first-lock)
    # 跳过配置修改（Step A 已执行过 Edit-ClinicConfig，避免重复要求用户回车确认）
    Write-Host ""
    Write-Host "  [步骤 B] 打包手机 APP (首次锁定模式)..." -ForegroundColor Cyan
    $rc = Invoke-Packaging -Ver $Ver -Tgt 'app' -SkipCfg $true -SkipEnc $true
    if ($rc -ne 0) {
        Write-Host "[错误] 手机 APP 打包失败，终止" -ForegroundColor Red
        return 1
    }

    # Step C: Extract & inject hash
    Write-Host ""
    Write-Host "  [步骤 C] 提取并注入哈希..." -ForegroundColor Cyan
    if (-not (Test-Path $hashPs1)) {
        Write-Host "[错误] 未找到 generate-sign-hash.ps1，跳过严格模式" -ForegroundColor Red
        Write-Host "  您仍可使用步骤 B 的 APK (首次锁定模式)"
        return 1
    }
    $env:NO_PAUSE = '1'; & $hashPs1 -Version $Ver
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[错误] 哈希提取失败，跳过严格模式" -ForegroundColor Red
        Write-Host "  您仍可使用步骤 B 的 APK (首次锁定模式)"
        return 1
    }

    # Step D: Rebuild mobile (strict)
    Write-Host ""
    Write-Host "  [步骤 D] 重新打包手机 APP (严格模式)..." -ForegroundColor Cyan
    # ★ 严格模式必须全量清理（不再跳过 clean）：
    # 历史教训（2026-07-22）：之前为加速打包设置 TCM_GRADLE_SKIP_CLEAN=1 跳过 clean，
    # 导致 MainActivity.java 中 NoAutofillWebView/AutofillManager.cancel() 等修复代码
    # 因 Gradle 增量构建使用旧 javac 缓存未生效，APK 实际加载旧版页面，
    # 华为 P40 仍弹出"本能中医处方系统"凭据提示。
    # 修复方案：严格模式 Step C/D 不再跳过 clean，确保所有 Java 修改全部生效。
    $rc = Invoke-Packaging -Ver $Ver -Tgt 'app' -SkipCfg $true -SkipEnc $true
    if ($rc -ne 0) {
        Write-Host "[错误] 严格模式重新打包失败" -ForegroundColor Red
        Write-Host "  您仍可使用步骤 B 的 APK (首次锁定模式)"
        return 1
    }

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host "  一键打包严格模式完成!" -ForegroundColor Yellow
    Write-Host "  桌面版: $versionDir\dist\" -ForegroundColor Yellow
    Write-Host "  手机版: $versionDir\*.apk (严格模式)" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Yellow
    return 0
}

function Build-AppStrict {
    param([string]$Ver)
    $versionDir = "$script:ProjectRoot\app_project\db-$Ver"
    $hashPs1 = "$script:ProjectRoot\tools\generate-sign-hash.ps1"

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host "  APP 严格模式 ($Ver)" -ForegroundColor Yellow
    Write-Host "  (APP + 签名严格模式，无桌面)" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  自动执行流程："
    Write-Host "    A. 打包手机 APP（默认模式 APK：Root+调试器检测）"
    Write-Host "    B. 提取 APK 签名哈希并注入 LicenseManager.java"
    Write-Host "    C. 重新打包手机 APP（签名严格模式 APK）"
    Write-Host ""
    Write-Host "  最终输出："
    Write-Host "    - 手机 APP: $versionDir\*.apk（已启用签名严格模式）"
    Write-Host ""
    Write-Host "  [INFO] 自动开始 APP 严格模式打包..." -ForegroundColor Green

    # Step A: Mobile build (first-lock mode)
    Write-Host ""
    Write-Host "  [步骤 A] 打包手机 APP (首次锁定模式)..." -ForegroundColor Cyan
    $rc = Invoke-Packaging -Ver $Ver -Tgt 'app' -SkipCfg $false -SkipEnc $false
    if ($rc -ne 0) {
        Write-Host "[错误] 手机 APP 打包失败，终止" -ForegroundColor Red
        return 1
    }

    # Step B: Extract & inject hash
    Write-Host ""
    Write-Host "  [步骤 B] 提取并注入哈希..." -ForegroundColor Cyan
    if (-not (Test-Path $hashPs1)) {
        Write-Host "[错误] 未找到 generate-sign-hash.ps1，跳过严格模式" -ForegroundColor Red
        Write-Host "  您仍可使用步骤 A 的 APK (首次锁定模式)"
        return 1
    }
    $env:NO_PAUSE = '1'; & $hashPs1 -Version $Ver
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[错误] 哈希提取失败，跳过严格模式" -ForegroundColor Red
        Write-Host "  您仍可使用步骤 A 的 APK (首次锁定模式)"
        return 1
    }

    # Step C: Rebuild mobile (strict)
    Write-Host ""
    Write-Host "  [步骤 C] 重新打包手机 APP (严格模式)..." -ForegroundColor Cyan
    # ★ 修复（2026-08-07）：移除此处的 gradlew.bat --stop
    # 原因：build-app.bat [4/10] 已经会调用 gradlew.bat --stop + clean
    # 在此处额外调用 --stop 会导致竞态条件：
    #   assembleRelease 期间延迟的 stop 命令到达 daemon，导致构建失败
    # 修复方案：依赖 build-app.bat [4/10] 的 --stop，此处不再重复调用
    Write-Host "  [INFO] 跳过手动 --stop（build-app.bat [4/10] 会自动处理）..." -ForegroundColor Yellow
    # ★ 严格模式必须全量清理（不再跳过 clean），原因详见上方 Step D 注释
    $rc = Invoke-Packaging -Ver $Ver -Tgt 'app' -SkipCfg $true -SkipEnc $true
    if ($rc -ne 0) {
        Write-Host "[错误] 严格模式重新打包失败" -ForegroundColor Red
        Write-Host "  您仍可使用步骤 A 的 APK (首次锁定模式)"
        return 1
    }

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host "  APP 严格模式打包完成!" -ForegroundColor Yellow
    Write-Host "  手机版: $versionDir\*.apk (严格模式)" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Yellow
    return 0
}

function Invoke-Packaging {
    param(
        [string]$Ver,
        [string]$Tgt,
        [bool]$SkipCfg,
        [bool]$SkipEnc
    )

    # Setup paths - merged db-offline structure (统一安装包，标准版/机构版由激活码运行时决定)
    $script:VersionDir = "$script:ProjectRoot\app_project\db-offline"
    $script:DesktopDir = "$script:VersionDir\desktop"
    $script:AndroidDir = "$script:VersionDir\app"
    $script:ElectronDir = "$script:DesktopDir\electron"

    # Validate paths
    if (-not (Test-Path $script:VersionDir)) {
        throw "版本目录未找到: $($script:VersionDir)"
    }

    # Setup log
    $logDir = "$script:VersionDir\logs"
    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
    $script:LogFile = "$logDir\packaging-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"

    $startTime = Get-Date
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Magenta
    Write-Host "  惠康中医打包模块" -ForegroundColor Magenta
    Write-Host "  版本: $Ver | 目标: $Tgt" -ForegroundColor Magenta
    Write-Host "  开始: $($startTime.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor Magenta
    Write-Host "  日志: $($script:LogFile)" -ForegroundColor Magenta
    Write-Host "========================================" -ForegroundColor Magenta

    try {
        # P1-易用：分步耗时记录
        $stepStartTime = Get-Date

        # Step 1: Pre-packaging encoding check (skip if target is 'encoding' to avoid duplicate with Step 6)
        if (-not $SkipEnc -and $Tgt -ne 'encoding') {
            Invoke-EncodingCheck
            Write-Host "  [耗时] 编码检查: $(((Get-Date) - $stepStartTime).ToString('ss\.fff'))s" -ForegroundColor DarkGray
            $stepStartTime = Get-Date
        }

        # Step 2: Config modification (for desktop/app/all/config targets)
        if (-not $SkipCfg -and ($Tgt -eq 'desktop' -or $Tgt -eq 'app' -or $Tgt -eq 'all' -or $Tgt -eq 'config')) {
            Edit-ClinicConfig
            Write-Host "  [耗时] 配置修改: $(((Get-Date) - $stepStartTime).ToString('ss\.fff'))s" -ForegroundColor DarkGray
            $stepStartTime = Get-Date
        }

        # Step 3: File sync (for app target)
        if ($Tgt -eq 'app' -or $Tgt -eq 'all' -or $Tgt -eq 'sync') {
            Sync-FilesToApp
            Write-Host "  [耗时] 文件同步: $(((Get-Date) - $stepStartTime).ToString('ss\.fff'))s" -ForegroundColor DarkGray
            $stepStartTime = Get-Date
        }

        # Step 4: Desktop build
        if ($Tgt -eq 'desktop' -or $Tgt -eq 'all') {
            Build-Desktop
            Write-Host "  [耗时] 桌面打包: $(((Get-Date) - $stepStartTime).ToString('mm\:ss'))" -ForegroundColor DarkGray
            $stepStartTime = Get-Date
        }

        # Step 5: APP build
        if ($Tgt -eq 'app' -or $Tgt -eq 'all') {
            Build-App
            Write-Host "  [耗时] APP 打包: $(((Get-Date) - $stepStartTime).ToString('mm\:ss'))" -ForegroundColor DarkGray
            $stepStartTime = Get-Date
        }

        # Step 6: Encoding check only
        if ($Tgt -eq 'encoding') {
            Invoke-EncodingCheck
            Write-Host "  [耗时] 编码检查: $(((Get-Date) - $stepStartTime).ToString('ss\.fff'))s" -ForegroundColor DarkGray
        }

        $elapsed = (Get-Date) - $startTime
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Yellow
        Write-Host "  打包完成!" -ForegroundColor Yellow
        Write-Host "  总耗时: $($elapsed.ToString('hh\:mm\:ss'))" -ForegroundColor Yellow
        Write-Host "  日志:   $($script:LogFile)" -ForegroundColor Yellow
        Write-Host "  按 0 或回车键退出..." -ForegroundColor Yellow
        Write-Host "========================================" -ForegroundColor Yellow
        Write-Log "[OK] Packaging completed in $($elapsed.ToString('hh\:mm\:ss'))"

    } catch {
        $elapsed = (Get-Date) - $startTime
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Red
        Write-Host "  打包失败!" -ForegroundColor Red
        Write-Host "  错误: $_" -ForegroundColor Red
        Write-Host "  总耗时: $($elapsed.ToString('hh\:mm\:ss'))" -ForegroundColor Red
        Write-Host "  日志:   $($script:LogFile)" -ForegroundColor Red
        Write-Host "  按 0 或回车键退出..." -ForegroundColor Yellow
        Write-Host "========================================" -ForegroundColor Red
        Write-Log "[ERROR] Packaging failed: $_" "ERROR"
        $exitKey = Read-Host "  按 0 或回车键退出"
        return 1
    }
    $exitKey = Read-Host "  按 0 或回车键退出"
    return 0
}

# ============================================================================
# Entry Point
# ============================================================================

# 命令行模式（无交互菜单）
if (-not $Version) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  惠康中医打包工具 - 离线版" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  用法:" -ForegroundColor Yellow
    Write-Host "    pack-desktop.bat        打包桌面版 (Electron exe)"
    Write-Host "    pack-app.bat            打包手机 APP (Android APK)"
    Write-Host "    pack-app-strict.bat     严格模式 APP (APK+签名哈希+重打包)"
    Write-Host ""
    Write-Host "  或直接调用:" -ForegroundColor DarkGray
    Write-Host "    pack.ps1 -Version <dingzhi> -Target <desktop|app|appstrict>"
    Write-Host ""
    exit 0
}

if ($Target -eq 'appstrict') {
    $exitCode = Build-AppStrict -Ver $Version
    exit $exitCode
}

if (-not $Target) {
    Write-Host "[ERROR] 请指定 -Target 参数 (desktop|app|all|appstrict)"
    exit 1
}

$exitCode = Invoke-Packaging -Ver $Version -Tgt $Target -SkipCfg $SkipConfig -SkipEnc $SkipEncodingCheck
exit $exitCode
