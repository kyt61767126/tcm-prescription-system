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
    .\pack.ps1 -Version bendi -Interactive
#>

param(
    [Parameter()]
    [ValidateSet('bendi','dingzhi','geren')]
    [string]$Version,
    [Parameter()]
    [ValidateSet('desktop','app','all','sync','config','encoding')]
    [string]$Target,
    [switch]$SkipConfig,
    [switch]$SkipEncodingCheck,
    [switch]$Interactive
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
        [string]$Context = "external command"
    )
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'

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

    try {
        if ($PSCmdlet.ParameterSetName -eq 'FilePath') {
            & cmd /c "$FilePath" 2>&1 | ForEach-Object {
                if ($_ -is [System.Management.Automation.ErrorRecord]) {
                    Write-Host $_.Exception.Message -ForegroundColor Yellow
                } else {
                    Write-Host $_
                }
            }
        } else {
            & $Command 2>&1 | ForEach-Object {
                if ($_ -is [System.Management.Automation.ErrorRecord]) {
                    # stderr line - print as warning (yellow), don't throw
                    Write-Host $_.Exception.Message -ForegroundColor Yellow
                } else {
                    Write-Host $_
                }
            }
        }
        $code = $LASTEXITCODE
    } finally {
        if ($prevLocation) { Set-Location $prevLocation }
        $ErrorActionPreference = $prevEAP
    }
    if ($code -ne 0 -and $code -ne $null) {
        Write-Log "[FAIL] $Context (exit code: $code)" "ERROR"
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

    # Check .ps1 files: MUST have BOM
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

    # Read config
    $config = [System.IO.File]::ReadAllText($configPath, $script:UTF8NoBom) | ConvertFrom-Json
    $currentClinic = $config.clinicName
    $currentDoctor = $config.doctorName

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

    if (-not $clinicChanged -and -not $doctorChanged) {
        Write-Host "  [SKIP] 诊所信息和医师姓名均无变化" -ForegroundColor Yellow
        Write-Log "Config: no changes (clinic=$newClinic, doctor=$newDoctor)"
        return
    }

    # 更新 config.json（必须计算 HMAC-SHA256 签名，与 edit-config.ps1 保持一致）
    if ($clinicChanged) { $config.clinicName = $newClinic }
    if ($doctorChanged) { $config.doctorName = $newDoctor }

    # ★ v3 安全：写入签名时间戳（UTC ISO 8601，与 license-manager.js 验签逻辑匹配）
    $config.configIssuedAt = (Get-Date).ToUniversalTime().ToString("o")

    # 先写入不含签名的 config.json（清掉可能存在的旧 configSignature）
    $config | Select-Object -Property * -ExcludeProperty configSignature |
        ConvertTo-Json -Depth 10 |
        Set-Content -Path $configPath -Encoding UTF8

    # ★ v3 安全：计算 HMAC-SHA256 签名
    # 签名内容：clinicName|doctorName|edition|configIssuedAt
    $signContent = "$($config.clinicName)|$($config.doctorName)|$($config.edition)|$($config.configIssuedAt)"
    $hmac = New-Object System.Security.Cryptography.HMACSHA256
    $hmac.Key = [System.Text.Encoding]::UTF8.GetBytes($script:CONFIG_SIGN_KEY)
    $hashBytes = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($signContent))
    $configSignature = ($hashBytes | ForEach-Object { $_.ToString("x2") }) -join ''
    $config | Add-Member -NotePropertyName configSignature -NotePropertyValue $configSignature -Force

    # 重新写入带签名的 config.json（无 BOM，与 edit-config.ps1 保持一致）
    $configJson = $config | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($configPath, $configJson, $script:UTF8NoBom)

    Write-Host "  [OK] config.json 签名已生成: $configSignature" -ForegroundColor Green

    # 更新 index.html (NO BOM - critical!)
    $html = [System.IO.File]::ReadAllText($htmlPath, $script:UTF8NoBom)

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

    [System.IO.File]::WriteAllText($htmlPath, $html, $script:UTF8NoBom)

    Write-Host ""
    Write-Host "  [完成] 配置已写入 config.json 和 index.html" -ForegroundColor Green
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
    $injectSrc = "$script:VersionDir\video-recorder-inject.js"
    if (Test-Path $injectSrc) {
        Copy-FileWithLog $injectSrc "$assetsDir\video-recorder-inject.js"
    } else {
        Write-Host "  [SKIP] 未找到 video-recorder-inject.js" -ForegroundColor Yellow
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
            } else {
                Invoke-External { npm install --no-audit --no-fund --prefer-offline } "npm install"
            }
        } finally {
            Pop-Location
        }
    }

    # Obfuscate JS
    Write-Host "  混淆 JavaScript 中..." -ForegroundColor Yellow
    Push-Location $script:ProjectRoot
    try {
        Invoke-External { node "tools\obfuscate.js" --target=$Version } "JS obfuscation"
    } finally {
        Pop-Location
    }

    # Build with electron-builder (use cache via mirror)
    Write-Host "  运行 electron-builder 中..." -ForegroundColor Yellow
    Push-Location $script:VersionDir
    try {
        $env:ELECTRON_MIRROR = "https://registry.npmmirror.com/-/binary/electron/"
        $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://registry.npmmirror.com/-/binary/electron-builder-binaries/"
        # Enable caching to skip re-download of electron binary
        $env:ELECTRON_BUILDER_CACHE = "$env:LOCALAPPDATA\electron-builder\Cache"
        # better-sqlite3 prebuild-install 从 GitHub Releases 下载预编译二进制时 SSL 证书验证失败
        # 临时关闭 TLS 验证（仅构建期间），确保 prebuild-install 成功下载 electron ABI 二进制
        $env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
        try {
            Invoke-External { npm run build } "electron-builder"
        } finally {
            # P1-安全：立即清除 TLS 临时变量，避免污染后续命令环境
            Remove-Item Env:\NODE_TLS_REJECT_UNAUTHORIZED -ErrorAction SilentlyContinue
            Remove-Item Env:\ELECTRON_MIRROR -ErrorAction SilentlyContinue
            Remove-Item Env:\ELECTRON_BUILDER_BINARIES_MIRROR -ErrorAction SilentlyContinue
        }
    } finally {
        Pop-Location
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

    # Restore JS (de-obfuscate)
    Write-Host "  恢复 JavaScript 中..." -ForegroundColor Yellow
    Push-Location $script:ProjectRoot
    try {
        Invoke-External { node "tools\obfuscate.js" restore --target=$Version } "JS restore"
    } finally {
        Pop-Location
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

    # Skip clean for incremental build - only clean if --clean flag was passed
    # Gradle's incremental build + build cache handles dependency changes automatically
    if ($env:TCM_GRADLE_CLEAN -eq '1') {
        Write-Host "  [深度清理] 清理构建缓存 (TCM_GRADLE_CLEAN=1)..." -ForegroundColor Yellow
        Push-Location $script:AndroidDir
        try {
            Invoke-External { & ".\gradlew.bat" clean } "gradlew clean"
        } finally {
            Pop-Location
        }
    } else {
        Write-Host "  [增量构建] 跳过 clean (设置 TCM_GRADLE_CLEAN=1 进行全量清理)" -ForegroundColor Cyan
    }

    # P1: 混淆 JS 代码（含 Android assets/public，防 APK 内 JS 被直接读取）
    Write-Host "  混淆 JavaScript 中（含 Android assets）..." -ForegroundColor Yellow
    Push-Location $script:ProjectRoot
    try {
        Invoke-External { node "tools\obfuscate.js" --target=$Version } "JS obfuscation for APK"
    } finally {
        Pop-Location
    }

    try {
        # Increment versionCode
        Increment-VersionCode

        # Build APK - use daemon for faster subsequent builds
        Write-Host "  构建签名 APK 中..." -ForegroundColor Yellow
        Push-Location $script:AndroidDir
        try {
            # Using daemon (no --no-daemon) enables 2-3x faster incremental builds
            # --parallel enables parallel task execution
            Invoke-External { & ".\gradlew.bat" assembleRelease --parallel --build-cache } "gradlew assembleRelease"
        } catch {
            Restore-VersionCode
            throw
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
        $productName = "惠康中医"
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
            Restore-VersionCode
            Write-Log "[ERROR] APK copy failed or file is empty/corrupted" "ERROR"
            throw "APK 复制失败或文件为空/损坏"
        }
    } else {
        Restore-VersionCode
        throw "输出目录未找到 APK"
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
    Write-Host "  [1] 打包桌面版 (Electron exe)"
    Write-Host "  [2] 打包手机 APP (Android APK)"
    Write-Host "  [3] 全部打包 (桌面 + APP)"
    Write-Host "  [4] 仅同步文件到 Android"
    Write-Host "  [5] 仅修改诊所配置"
    Write-Host "  [6] 仅编码检查"
    Write-Host "  [7] 查看当前配置"
    Write-Host "  [8] 启用严格模式 (提取并注入哈希)"
    Write-Host "  [9] 一键打包严格模式 (A->B->哈希->重打包)"
    Write-Host "  [0] 退出"
    Write-Host ""
    Write-Host "  快捷选项:"
    Write-Host "    [a] 快速全部打包 (跳过编码检查/配置编辑)"
    Write-Host "    [d] 仅桌面快速打包 (跳过编码检查)"
    Write-Host "    [p] 仅 APP 快速打包 (跳过编码检查/配置)"
    Write-Host ""
    $choice = Read-Host "  请选择 [0-9]"
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
    $hashBat = "$versionDir\generate-sign-hash.bat"

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

    if (-not (Test-Path $hashBat)) {
        Write-Host "[错误] 未找到 generate-sign-hash.bat: $hashBat" -ForegroundColor Red
        return 1
    }

    $confirm = Read-Host "确认启用严格模式? (Y/n) [默认回车=开始]"
    if ($confirm -eq 'n' -or $confirm -eq 'N') {
        Write-Host "  已取消"
        return 0
    }

    Write-Host ""
    Write-Log "[STEP] Enable strict mode for $Ver"
    Invoke-External -FilePath $hashBat -WorkDir $versionDir
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[错误] 哈希提取失败" -ForegroundColor Red
        Write-Log "[ERROR] generate-sign-hash.bat failed" "ERROR"
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
    $hashBat = "$versionDir\generate-sign-hash.bat"

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

    $confirm = Read-Host "确认开始一键打包严格模式? (Y/n) [默认回车=开始]"
    if ($confirm -eq 'n' -or $confirm -eq 'N') {
        Write-Host "  已取消"
        return 0
    }

    # Step A: Desktop build
    Write-Host ""
    Write-Host "  [步骤 A] 打包桌面版..." -ForegroundColor Cyan
    $rc = Invoke-Packaging -Ver $Ver -Tgt 'desktop' -SkipCfg $false -SkipEnc $false
    if ($rc -ne 0) {
        Write-Host "[错误] 桌面版打包失败，终止" -ForegroundColor Red
        return 1
    }

    # Step B: Mobile build (first-lock)
    Write-Host ""
    Write-Host "  [步骤 B] 打包手机 APP (首次锁定模式)..." -ForegroundColor Cyan
    $rc = Invoke-Packaging -Ver $Ver -Tgt 'app' -SkipCfg $false -SkipEnc $true
    if ($rc -ne 0) {
        Write-Host "[错误] 手机 APP 打包失败，终止" -ForegroundColor Red
        return 1
    }

    # Step C: Extract & inject hash
    Write-Host ""
    Write-Host "  [步骤 C] 提取并注入哈希..." -ForegroundColor Cyan
    if (-not (Test-Path $hashBat)) {
        Write-Host "[错误] 未找到 generate-sign-hash.bat，跳过严格模式" -ForegroundColor Red
        Write-Host "  您仍可使用步骤 B 的 APK (首次锁定模式)"
        return 1
    }
    Invoke-External -FilePath $hashBat -WorkDir $versionDir
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[错误] 哈希提取失败，跳过严格模式" -ForegroundColor Red
        Write-Host "  您仍可使用步骤 B 的 APK (首次锁定模式)"
        return 1
    }

    # Step D: Rebuild mobile (strict)
    Write-Host ""
    Write-Host "  [步骤 D] 重新打包手机 APP (严格模式)..." -ForegroundColor Cyan
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

if ($Interactive) {
    if (-not $Version) {
        Write-Host "用法: pack.ps1 -Version <bendi|dingzhi|geren> -Interactive"
        exit 1
    }

    while ($true) {
        $choice = Show-Menu -Ver $Version
        switch ($choice) {
            '1' { Invoke-Packaging -Ver $Version -Tgt 'desktop' -SkipCfg $false -SkipEnc $false }
            '2' { Invoke-Packaging -Ver $Version -Tgt 'app' -SkipCfg $false -SkipEnc $false }
            '3' { Invoke-Packaging -Ver $Version -Tgt 'all' -SkipCfg $false -SkipEnc $false }
            '4' { Invoke-Packaging -Ver $Version -Tgt 'sync' -SkipCfg $true -SkipEnc $true }
            '5' { Invoke-Packaging -Ver $Version -Tgt 'config' -SkipCfg $false -SkipEnc $true }
            '6' { Invoke-Packaging -Ver $Version -Tgt 'encoding' -SkipCfg $true -SkipEnc $false }
            '7' { Show-CurrentConfig -Ver $Version }
            '8' { Enable-StrictMode -Ver $Version }
            '9' { Build-AllStrict -Ver $Version }
            # P1-易用：快捷选项 - 跳过耗时步骤，专注打包
            'a' { Invoke-Packaging -Ver $Version -Tgt 'all' -SkipCfg $true -SkipEnc $true }
            'd' { Invoke-Packaging -Ver $Version -Tgt 'desktop' -SkipCfg $true -SkipEnc $true }
            'p' { Invoke-Packaging -Ver $Version -Tgt 'app' -SkipCfg $true -SkipEnc $true }
            '0' { exit 0 }
            default { Write-Host "  [错误] 无效选项，请重新选择" -ForegroundColor Red }
        }
        if ($choice -ne '0') {
            Write-Host ""
            Read-Host "按回车键继续"
        }
    }
} else {
    # Direct execution mode
    if (-not $Version -or -not $Target) {
        Write-Host "用法: pack.ps1 -Version <bendi|dingzhi|geren> -Target <desktop|app|all>"
        Write-Host "     pack.ps1 -Version bendi -Interactive"
        exit 1
    }
    $exitCode = Invoke-Packaging -Ver $Version -Tgt $Target -SkipCfg $SkipConfig -SkipEnc $SkipEncodingCheck
    exit $exitCode
}
