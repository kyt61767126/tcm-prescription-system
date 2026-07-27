<#
.SYNOPSIS
    Unified Packaging Module for TCM Prescription System
.DESCRIPTION
    Self-contained, robust packaging engine.
    Solves recurring issues: encoding corruption, error propagation, versionCode management.
    Future-proof: pattern-based file sync, isolated from project code changes.
.PARAMETER Version
    Target version: bendi | dingzhi | geren
.PARAMETER Target
    Build target: desktop | app | all | sync | config | encoding
.PARAMETER SkipConfig
    Skip clinic config modification
.PARAMETER SkipEncodingCheck
    Skip pre-packaging encoding verification
.PARAMETER Interactive
    Show interactive menu (for launcher use)
.EXAMPLE
    .\pack.ps1 -Version bendi -Target app
    .\pack.ps1 -Version bendi -Target app -SkipConfig
    .\pack.ps1 -Version bendi -Target appstrict
#>

param(
    [Parameter()]
    [ValidateSet('bendi','dingzhi','geren')]
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

# 速度优化：npm cache 跨版本共享（bendi/dingzhi/geren 共用同一缓存目录）
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
    # 修复后：调用 fix-ps1-bom.ps1 扫描 offline_project/ 和 tools/ 下所有 .ps1 文件
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
        "$script:VersionDir\index.html",
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

    $configPath = "$script:VersionDir\config.json"
    $htmlPath = "$script:VersionDir\index.html"

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
    Copy-FileWithLog "$script:VersionDir\config.json" "$publicDir\config.json"

    # Sync index.html (CRITICAL: no BOM)
    Copy-FileWithLog "$script:VersionDir\index.html" "$publicDir\index.html"
    # Strip BOM if present (belt-and-suspenders)
    Repair-FileBom -Path "$publicDir\index.html" -ShouldHaveBom $false | Out-Null

    # Sync all .js modules in version root (pattern-based, auto-discovers new files)
    # Exclude: main.js (electron entry point, not for Android)
    $excludeJs = @('main.js')
    Get-ChildItem -Path $script:VersionDir -Filter "*.js" -File | Where-Object { $_.Name -notin $excludeJs } | ForEach-Object {
        Copy-FileWithLog $_.FullName "$publicDir\$($_.Name)"
    }

    # Sync vendor/ directory
    $vendorSrc = "$script:VersionDir\vendor"
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
    if (-not (Test-Path "$script:VersionDir\node_modules")) {
        $lockFile = "$script:VersionDir\package-lock.json"
        Write-Host "  安装 npm 依赖中..." -ForegroundColor Yellow
        Push-Location $script:VersionDir
        try {
            if (Test-Path $lockFile) {
                # npm ci is 2-3x faster than npm install when lock file exists
                Invoke-External { npm ci --no-audit --no-fund --prefer-offline } "npm ci"
                if ($LASTEXITCODE -ne 0) {
                    Write-Host "  [WARN] npm ci failed, fallback to npm install --ignore-scripts..." -ForegroundColor Yellow
                    Invoke-External { npm install --no-audit --no-fund --prefer-offline --ignore-scripts } "npm install --ignore-scripts"
                }
            } else {
                Invoke-External { npm install --no-audit --no-fund --prefer-offline --ignore-scripts } "npm install"
            }
        } finally {
            Pop-Location
        }
    }
    # 检查 electron dist（--ignore-scripts 安装时 postinstall 不执行，需手动下载）
    if (-not (Test-Path "$script:VersionDir\node_modules\electron\dist\electron.exe")) {
        Write-Host "  electron dist 缺失，下载二进制文件中..." -ForegroundColor Yellow
        Push-Location $script:VersionDir
        try {
            $env:NODE_TLS_REJECT_UNAUTHORIZED = '0'
            $env:ELECTRON_MIRROR = 'https://registry.npmmirror.com/-/binary/electron/'
            Invoke-External { node "node_modules\electron\install.js" } "electron install"
        } finally {
            Remove-Item Env:\NODE_TLS_REJECT_UNAUTHORIZED -ErrorAction SilentlyContinue
            Remove-Item Env:\ELECTRON_MIRROR -ErrorAction SilentlyContinue
            Pop-Location
        }
        if (-not (Test-Path "$script:VersionDir\node_modules\electron\dist\electron.exe")) {
            Write-Host "  [ERROR] electron 二进制文件下载失败" -ForegroundColor Red
            # ★ 改为 throw（而非 exit 1），确保外层 try/finally 执行环境变量恢复
            throw "electron 二进制文件下载失败"
        }
    }

    # Obfuscate JS
    # ★ 稳定性修复：混淆步骤本身也可能失败（部分文件已生成 .bak），失败时必须 restore 清理
    # 修复前问题：若 obfuscate.js 中途失败，已生成的 .bak 残留开发环境，下次打包会触发误还原
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
    $pkgPath = "$script:VersionDir\package.json"
    $certBackupPath = "$script:VersionDir\package.json.certbak"

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
        Invoke-External { node $prepareScript $script:VersionDir } "prepare-win-unpacked"
    } else {
        Write-Host "  [WARN] prepare-win-unpacked.js 未找到，使用传统构建模式" -ForegroundColor Yellow
    }

    # Build with electron-builder --prepackaged
    Write-Host "  运行 electron-builder (--prepackaged)..." -ForegroundColor Yellow
    Push-Location $script:VersionDir
    try {
        $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://registry.npmmirror.com/-/binary/electron-builder-binaries/"
        # ELECTRON_BUILDER_CACHE 已在脚本开头设置为项目级共享目录
        $env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
        # ★ 修复 NSIS "Error writing temporary file" 错误
        # 原因：TRAE 沙箱可能阻止 NSIS 编译器(makensis.exe)写入系统 %TEMP% 目录
        # 方案：将 TEMP/TMP 重定向到项目本地的 tmp 目录
        $localTemp = "$script:VersionDir\tmp"
        if (-not (Test-Path $localTemp)) { New-Item -ItemType Directory -Path $localTemp -Force | Out-Null }
        $prevTemp = $env:TEMP
        $prevTmp = $env:TMP
        $env:TEMP = $localTemp
        $env:TMP = $localTemp
        try {
            # Read actual win-unpacked path (may differ if dir was locked and renamed)
            $unpackPath = "dist/win-unpacked"
            $pathFile = "$script:VersionDir\dist\win-unpacked-path.txt"
            if (Test-Path $pathFile) {
                $actualPath = Get-Content $pathFile -Raw -Encoding UTF8 | ForEach-Object { $_.Trim() }
                if ($actualPath -and (Test-Path $actualPath)) {
                    $unpackPath = $actualPath
                    # Convert to relative path for electron-builder
                    $unpackPath = $unpackPath.Replace("$script:VersionDir\", "").Replace($script:VersionDir, "")
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
    $distDir = "$script:VersionDir\dist"
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

    # Kill only Gradle daemon processes (not all java processes - preserves IDE etc.)
    Write-Host "  停止 Gradle daemon 中..." -ForegroundColor Yellow
    Push-Location $script:AndroidDir
    try {
        # Graceful daemon stop (faster restart than --no-daemon every time)
        & ".\gradlew.bat" --stop 2>&1 | Out-Null
    } finally {
        Pop-Location
    }
    Start-Sleep -Milliseconds 500  # reduced from 1s

    # ★ 默认强制 clean 全量构建（解决 Gradle 增量构建缓存导致 Java 修改不生效的问题）
    # 原因：Gradle 增量构建通过输入哈希判断是否重新编译，但 Android 资源/Manifest/Java
    #       同时修改时可能漏掉依赖，导致修改不生效（用户反馈状态栏修复打包后无变化）
    # 开发调试时可设置 TCM_GRADLE_SKIP_CLEAN=1 跳过 clean 加速打包
    if ($env:TCM_GRADLE_SKIP_CLEAN -eq '1') {
        Write-Host "  [增量构建] 跳过 clean (TCM_GRADLE_SKIP_CLEAN=1，仅开发调试用)..." -ForegroundColor Cyan
    } else {
        Write-Host "  [全量清理] 清理构建缓存（默认强制，确保 Java/资源修改全部生效）..." -ForegroundColor Yellow
        # 先删除 javac 缓存目录（强制 Java 重新编译，比 gradlew clean 快）
        $javacCache = "$script:AndroidDir\app\build\intermediates\javac"
        if (Test-Path $javacCache) {
            try {
                Remove-Item -Path $javacCache -Recurse -Force -ErrorAction SilentlyContinue
                Write-Host "    [OK] 已清理 javac 缓存" -ForegroundColor Green
            } catch {
                Write-Host "    [WARN] 清理 javac 缓存失败: $($_.Exception.Message)" -ForegroundColor Yellow
            }
        }
        # ★ 清理 assets 缓存目录（防止 index.html/JS 修改不生效，与 build-app.bat 对齐）
        $assetsCacheDirs = @(
            "$script:AndroidDir\app\build\intermediates\assets",
            "$script:AndroidDir\app\build\intermediates\merged_assets"
        )
        foreach ($cacheDir in $assetsCacheDirs) {
            if (Test-Path $cacheDir) {
                try {
                    Remove-Item -Path $cacheDir -Recurse -Force -ErrorAction SilentlyContinue
                    Write-Host "    [OK] 已清理 $(Split-Path $cacheDir -Leaf)" -ForegroundColor Green
                } catch {
                    Write-Host "    [WARN] 清理 $(Split-Path $cacheDir -Leaf) 失败: $($_.Exception.Message)" -ForegroundColor Yellow
                }
            }
        }
        # 再执行 gradlew clean 全量清理（含资源、依赖缓存）
        Push-Location $script:AndroidDir
        try {
            Invoke-External { & ".\gradlew.bat" clean } "gradlew clean"
        } finally {
            Pop-Location
        }
    }

    # P1: 混淆 JS 代码（含 Android assets/public，防 APK 内 JS 被直接读取）
    # ★ 稳定性修复：混淆失败时必须 restore 清理 .bak 残留（与 Build-Desktop 对齐）
    Write-Host "  混淆 JavaScript 中（含 Android assets）..." -ForegroundColor Yellow
    $obfuscateOk = $false
    Push-Location $script:ProjectRoot
    try {
        Invoke-External { node "tools\obfuscate.js" --target=$Version } "JS obfuscation for APK"
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

    # ★ 举一反三：集中 versionCode restore 到单一 catch 块
    # 修复前问题：Restore-VersionCode 分散在 3 处（assembleRelease catch / APK not found / copy failed）
    #           新增步骤若忘记调用 Restore-VersionCode，versionCode 会错误递增
    # 修复后：用 $versionCodeIncremented 标志 + 单一 catch 块统一处理回滚
    $versionCodeIncremented = $false
    try {
    try {
        # ★ Java 预编译检查（在 versionCode 递增前执行，避免编译错误导致版本号无效递增）
        # 原因：@Override 方法在父类不存在等编译错误，若在 versionCode 递增后才发现，
        #       需要回滚版本号，增加复杂度。预编译检查可提前发现，减少回滚成本。
        Write-Host "  Java 预编译检查中（提前发现编译错误）..." -ForegroundColor Cyan
        Push-Location $script:AndroidDir
        try {
            # 清理残留的 STOPPED Gradle daemon（避免"daemon has been stopped"错误）
            & ".\gradlew.bat" --stop 2>&1 | Out-Null
            Invoke-External { & ".\gradlew.bat" compileReleaseJavaWithJavac --quiet } "Java pre-compile check"
        } catch {
            Write-Log "[ERROR] Java 预编译检查失败，终止打包（避免无效递增 versionCode）" "ERROR"
            throw
        } finally {
            Pop-Location
        }

        # Increment versionCode
        Increment-VersionCode
        $versionCodeIncremented = $true

        # Build APK - use daemon for faster subsequent builds
        Write-Host "  构建签名 APK 中..." -ForegroundColor Yellow
        Push-Location $script:AndroidDir
        try {
            # Using daemon (no --no-daemon) enables 2-3x faster incremental builds
            # --parallel enables parallel task execution
            # ★ 速度优化：TCM_GRADLE_SKIP_CLEAN=1 时跳过 --rerun-tasks，启用真正增量构建
            #   - 默认（全量）：--rerun-tasks 强制重新执行所有任务，确保修改全部生效（最稳）
            #   - 增量模式：跳过 --rerun-tasks，Gradle 通过输入哈希判断是否重新编译（快 2-3 倍）
            #   适用场景：仅修改少量 Java/资源文件的开发调试；正式发布必须用全量模式
            if ($env:TCM_GRADLE_SKIP_CLEAN -eq '1') {
                Write-Host "  [增量构建] 跳过 --rerun-tasks TCM_GRADLE_SKIP_CLEAN=1" -ForegroundColor Cyan
                Invoke-External { & ".\gradlew.bat" assembleRelease --parallel } "gradlew assembleRelease incremental"
            } else {
                Invoke-External { & ".\gradlew.bat" assembleRelease --parallel --rerun-tasks } "gradlew assembleRelease"
            }
        } finally {
            Pop-Location
        }
    } finally {
        # P1: 无论成功或失败，都恢复原始 JS 代码（防源码污染开发环境）
        Write-Host "  恢复 JavaScript 中..." -ForegroundColor Yellow
        Push-Location $script:ProjectRoot
        try {
            Invoke-External { node "tools\obfuscate.js" restore --target=$Version } "JS restore"
        } catch {
            Write-Log "[WARN] JS restore failed after APK build" "WARN"
        } finally {
            Pop-Location
        }
    }

    # Copy APK to version directory with proper naming
    $apkPath = Get-ChildItem -Path "$script:AndroidDir\app\build\outputs\apk\release" -Filter "*.apk" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($apkPath) {
        # Read productName from config.json (reference: cloud_app uses "惠康中医-云端")
        $configPath = "$script:VersionDir\config.json"
        $productName = switch ($Version) {
            'bendi'   { '惠康中医-本地' }
            'geren'   { '惠康中医-个人' }
            'dingzhi' { '惠康中医-定制' }
            default   { '惠康中医' }
        }
        if (Test-Path $configPath) {
            try {
                $config = [System.IO.File]::ReadAllText($configPath, $script:UTF8NoBom) | ConvertFrom-Json
                if ($config.productName) {
                    $productName = $config.productName
                }
            } catch {
                Write-Log "[WARN] Failed to read productName from config.json" "WARN"
            }
        }

        # Extract versionName from build.gradle
        $versionName = "1.0"
        try {
            $gradleContent = [System.IO.File]::ReadAllText("$script:AndroidDir\app\build.gradle", $script:UTF8NoBom)
            if ($gradleContent -match 'versionName\s+["'']([^"'']+)["'']') {
                $versionName = $matches[1]
            }
        } catch {
            Write-Log "[WARN] Failed to read versionName from build.gradle" "WARN"
        }

        # Build final APK name: 产品名称_版本号.apk
        $finalApkName = "$productName.apk"
        $destPath = "$script:VersionDir\$finalApkName"

        # Copy with verification
        Copy-Item -Path $apkPath.FullName -Destination $destPath -Force
        $destFile = Get-Item $destPath -ErrorAction SilentlyContinue
        if ($destFile -and $destFile.Length -gt 0 -and $destFile.Length -eq $apkPath.Length) {
            $sizeMB = [math]::Round($apkPath.Length / 1MB, 2)
            Write-Host ""
            Write-Host "  ====================================" -ForegroundColor Green
            Write-Host "  APK 生成成功!" -ForegroundColor Green
            Write-Host "  ====================================" -ForegroundColor Green
            Write-Host "  文件:  $finalApkName"
            Write-Host "  大小:  $sizeMB MB"
            Write-Host "  路径:  $destPath"
            Write-Host "  ====================================" -ForegroundColor Green
            Write-Log "[OK] APK: $finalApkName ($sizeMB MB)"
        } else {
            Write-Log "[ERROR] APK copy failed or file is empty/corrupted" "ERROR"
            throw "APK 复制失败或文件为空/损坏"
        }
    } else {
        throw "输出目录未找到 APK"
    }
    } catch {
        # ★ 集中 versionCode restore：任何步骤失败时统一回滚（防版本号错误递增）
        if ($versionCodeIncremented) {
            Restore-VersionCode
        }
        throw
    }
}

# ============================================================================
# Section 8: Main Logic
# ============================================================================

function Show-Menu {
    param([string]$Ver)
    Clear-Host
    $versionLabel = switch ($Ver) {
        'bendi'   { '本地版 (bendi)' }
        'dingzhi' { '定制版 (dingzhi)' }
        'geren'   { '个人版 (geren)' }
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
    $versionDir = "$script:ProjectRoot\offline_project\db-$Ver"
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
    $versionDir = "$script:ProjectRoot\offline_project\db-$Ver"
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
    $versionDir = "$script:ProjectRoot\offline_project\db-$Ver"
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
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  一键打包严格模式完成!" -ForegroundColor Green
    Write-Host "  桌面版: $versionDir\dist\" -ForegroundColor Green
    Write-Host "  手机版: $versionDir\*.apk (严格模式)" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    return 0
}

function Build-AppStrict {
    param([string]$Ver)
    $versionDir = "$script:ProjectRoot\offline_project\db-$Ver"
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
    # ★ 严格模式必须全量清理（不再跳过 clean），原因详见上方 Step D 注释
    $rc = Invoke-Packaging -Ver $Ver -Tgt 'app' -SkipCfg $true -SkipEnc $true
    if ($rc -ne 0) {
        Write-Host "[错误] 严格模式重新打包失败" -ForegroundColor Red
        Write-Host "  您仍可使用步骤 A 的 APK (首次锁定模式)"
        return 1
    }

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  APP 严格模式打包完成!" -ForegroundColor Green
    Write-Host "  手机版: $versionDir\*.apk (严格模式)" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    return 0
}

function Invoke-Packaging {
    param(
        [string]$Ver,
        [string]$Tgt,
        [bool]$SkipCfg,
        [bool]$SkipEnc
    )

    # Setup paths
    $script:VersionDir = "$script:ProjectRoot\offline_project\db-$Ver"
    $script:AndroidDir = "$script:VersionDir\android"
    $script:ElectronDir = "$script:VersionDir\electron"

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

        # Step 1.5: Sync check - ensure _shared/ files are synced to all versions before packaging
        $syncScript = Join-Path $PSScriptRoot 'sync-offline-files.ps1'
        if (Test-Path $syncScript) {
            Write-Host "  [步骤] 检查共享文件同步状态..." -ForegroundColor Cyan
            $syncOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $syncScript -VerifyOnly 2>&1
            $syncExitCode = $LASTEXITCODE
            if ($syncExitCode -ne 0) {
                Write-Host "  [WARN] 检测到共享文件未同步，正在自动同步..." -ForegroundColor Yellow
                & powershell -NoProfile -ExecutionPolicy Bypass -File $syncScript 2>&1 | Out-Null
                Write-Host "  [OK] 共享文件已同步" -ForegroundColor Green
            } else {
                Write-Host "  [OK] 共享文件已同步" -ForegroundColor Green
            }
            Write-Host "  [耗时] 同步检查: $(((Get-Date) - $stepStartTime).ToString('ss\.fff'))s" -ForegroundColor DarkGray
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
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "  打包完成!" -ForegroundColor Green
        Write-Host "  总耗时: $($elapsed.ToString('hh\:mm\:ss'))" -ForegroundColor Green
        Write-Host "  日志:   $($script:LogFile)" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Green
        Write-Log "[OK] Packaging completed in $($elapsed.ToString('hh\:mm\:ss'))"

    } catch {
        $elapsed = (Get-Date) - $startTime
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Red
        Write-Host "  打包失败!" -ForegroundColor Red
        Write-Host "  错误: $_" -ForegroundColor Red
        Write-Host "  总耗时: $($elapsed.ToString('hh\:mm\:ss'))" -ForegroundColor Red
        Write-Host "  日志:   $($script:LogFile)" -ForegroundColor Red
        Write-Host "========================================" -ForegroundColor Red
        Write-Log "[ERROR] Packaging failed: $_" "ERROR"
        return 1
    }
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
    Write-Host "    pack.ps1 -Version <bendi|dingzhi|geren> -Target <desktop|app|appstrict>"
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
