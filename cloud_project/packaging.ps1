# packaging.ps1 - Cloud project unified packaging tool（含防盗防破解）
# 菜单结构严格对齐离线版 tools/pack.ps1（db-geren/db-bendi/db-dingzhi）
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$scriptDir = $PSScriptRoot

# UTF-8 encoders (reusable)
$script:UTF8WithBom = New-Object System.Text.UTF8Encoding($true)
$script:UTF8NoBom = New-Object System.Text.UTF8Encoding($false)

# ============================================================================
# Section 1: Utility Functions
# ============================================================================

function Write-Step {
    param([string]$Title)
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  $Title" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
}

# Run external .bat file and return exit code (stderr displayed as yellow warnings)
function Invoke-BatFile {
    param(
        [string]$BatPath,
        [string]$Context = "external command",
        [switch]$NoPause
    )
    if (-not (Test-Path $BatPath)) {
        Write-Host "[ERROR] 文件未找到: $BatPath" -ForegroundColor Red
        return 1
    }
    # NoPause 模式：设置 NO_PAUSE 环境变量，让 build.bat / build-app.bat 跳过末尾 pause
    # 用于 Build-AllStrict / Build-All 连续流程，避免中间回车打断
    $prevNoPause = $env:NO_PAUSE
    if ($NoPause) {
        $env:NO_PAUSE = '1'
    }
    try {
        & cmd /c "$BatPath" 2>&1 | ForEach-Object {
            if ($_ -is [System.Management.Automation.ErrorRecord]) {
                Write-Host $_.Exception.Message -ForegroundColor Yellow
            } else {
                Write-Host $_
            }
        }
        return $LASTEXITCODE
    } finally {
        if ($NoPause) {
            if ($prevNoPause) {
                $env:NO_PAUSE = $prevNoPause
            } else {
                Remove-Item Env:\NO_PAUSE -ErrorAction SilentlyContinue
            }
        }
    }
}

# ============================================================================
# Section 2: Encoding Verification (对齐离线版 Invoke-EncodingCheck)
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
    Write-Step "编码检查"
    Write-Host "  Verifying file encoding integrity..." -ForegroundColor White
    Write-Host ""

    $fixed = 0

    # Check .ps1 files: MUST have BOM (PowerShell 5.1 中文解析依赖 BOM)
    $ps1Files = @(
        "$scriptDir\packaging.ps1",
        "$scriptDir\generate-sign-hash.ps1",
        "$scriptDir\sync-app-version.ps1"
    ) | Where-Object { Test-Path $_ }

    foreach ($f in $ps1Files) {
        $leaf = Split-Path $f -Leaf
        if (Test-FileBom -Path $f) {
            Write-Host "  [OK]   $leaf : BOM 已存在" -ForegroundColor Green
        } else {
            Write-Host "  [FIX]  $leaf : BOM 缺失，修复中..." -ForegroundColor Yellow
            Repair-FileBom -Path $f -ShouldHaveBom $true | Out-Null
            $fixed++
        }
    }

    # Check index.html: MUST NOT have BOM (浏览器 BOM 会破坏 HTML 解析)
    $htmlFiles = @(
        "$scriptDir\cloud_desktop\index.html",
        "$scriptDir\cloud_app\app\src\main\assets\public\index.html"
    ) | Where-Object { Test-Path $_ }

    foreach ($f in $htmlFiles) {
        $leaf = Split-Path $f -Leaf
        $hasBom = Test-FileBom -Path $f
        if ($hasBom) {
            Write-Host "  [FIX]  $leaf : 检测到 BOM，去除中..." -ForegroundColor Yellow
            Repair-FileBom -Path $f -ShouldHaveBom $false | Out-Null
            $fixed++
        } else {
            Write-Host "  [OK]   $leaf : 无 BOM" -ForegroundColor Green
        }
    }

    Write-Host ""
    if ($fixed -gt 0) {
        Write-Host "  [OK] 编码检查完成：修复 $fixed 个文件" -ForegroundColor Green
    } else {
        Write-Host "  [OK] 编码检查完成：所有文件正常" -ForegroundColor Green
    }
}

# ============================================================================
# Section 3: File Sync (shared/ -> cloud_app，对齐离线版 Sync-FilesToApp)
# ============================================================================

function Sync-FilesToCloudApp {
    Write-Step "同步文件到 cloud_app"
    Write-Host "  Syncing shared files to cloud_app assets..." -ForegroundColor White
    Write-Host ""

    $sharedDir = "$scriptDir\..\shared"
    $publicDir = "$scriptDir\cloud_app\app\src\main\assets\public"
    $assetsDir = "$scriptDir\cloud_app\app\src\main\assets"

    if (-not (Test-Path $sharedDir)) {
        Write-Host "  [ERROR] shared 目录未找到: $sharedDir" -ForegroundColor Red
        Write-Host "  请确认 shared 目录存在且包含 auth-core.js / permission.js" -ForegroundColor White
        return 1
    }

    if (-not (Test-Path $publicDir)) {
        New-Item -ItemType Directory -Path $publicDir -Force | Out-Null
    }

    $synced = 0

    # 同步核心 JS 模块到 public/
    $coreFiles = @('auth-core.js', 'permission.js')
    foreach ($file in $coreFiles) {
        $src = Join-Path $sharedDir $file
        $dst = Join-Path $publicDir $file
        if (Test-Path $src) {
            Copy-Item -Path $src -Destination $dst -Force
            Write-Host "  [OK]   $file 已同步" -ForegroundColor Green
            $synced++
        } else {
            Write-Host "  [SKIP] $file 未找到" -ForegroundColor Yellow
        }
    }

    # 同步 video-recorder-inject.js 到 assets/（非 public/）
    $injectSrc = "$sharedDir\video-recorder-inject.js"
    $injectDst = "$assetsDir\video-recorder-inject.js"
    if (Test-Path $injectSrc) {
        Copy-Item -Path $injectSrc -Destination $injectDst -Force
        Write-Host "  [OK]   video-recorder-inject.js 已同步" -ForegroundColor Green
        $synced++
    } else {
        Write-Host "  [SKIP] video-recorder-inject.js 未找到" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "  [OK] 同步完成：$synced 个文件" -ForegroundColor Green
    return 0
}

# ============================================================================
# Section 4: Menu (严格对齐离线版 tools/pack.ps1 Show-Menu)
# ============================================================================

function Show-Menu {
    Clear-Host
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  惠康中医打包工具 - 云端版 (cloud)" -ForegroundColor Cyan
    Write-Host "  (桌面+APP 统一入口)" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  [1] 打包桌面版 (Electron exe)"
    Write-Host "  [2] 打包手机 APP (Android APK)"
    Write-Host "  [3] 全部打包 (桌面 + APP)"
    Write-Host "  [4] 仅同步文件到 cloud_app"
    Write-Host "  [5] 修改云端配置 (URL/产品名/版本号)"
    Write-Host "  [6] 仅编码检查"
    Write-Host "  [7] 查看当前配置"
    Write-Host "  [8] 启用严格模式 (提取并注入哈希)"
    Write-Host "  [9] 一键打包严格模式 (A->B->哈希->重打包)"
    Write-Host "  [0] 退出"
    Write-Host ""
    Write-Host "  快捷选项:"
    Write-Host "    [a] 快速全部打包 (跳过编码检查)"
    Write-Host "    [d] 仅桌面快速打包 (跳过编码检查)"
    Write-Host "    [p] 仅 APP 快速打包 (跳过编码检查)"
    Write-Host ""
    Write-Host "----------------------------------------------------------------"
    Write-Host "  防护说明："
    Write-Host "    [2] 默认启用 Root 检测 + 调试器检测（详见 SecurityGuard.java）"
    Write-Host "    [8] 启用严格模式后，APK 内硬编码签名哈希，任何二次打包即拒绝运行"
    Write-Host "    [9] 自动完成：打包->提取哈希->注入->重新打包"
    Write-Host "----------------------------------------------------------------"
    $choice = Read-Host "请选择 [0-9]"
    return $choice
}

# ============================================================================
# Section 5: Build Functions
# ============================================================================

# ============================================================================
# Section 5.1: 配置修改（参考离线版 Edit-ClinicConfig）
# ============================================================================

# 修改云端配置（云端URL、产品名称、桌面版本号）
# 云端版没有 config.json（动态从服务器加载），但 capacitor.config.json 中的
# 云端URL、package.json 中的产品名/版本号都是可配置项
function Edit-CloudConfig {
    Write-Step "云端配置修改"

    # ----- 读取当前配置 -----
    $capFile = Join-Path $scriptDir 'cloud_app\app\src\main\assets\capacitor.config.json'
    $pkgFile = Join-Path $scriptDir 'cloud_desktop\package.json'

    if (-not (Test-Path $capFile)) {
        Write-Host "  [错误] 未找到 capacitor.config.json: $capFile" -ForegroundColor Red
        Write-Host "  请确认 cloud_app 目录结构完整" -ForegroundColor White
        return 1
    }
    if (-not (Test-Path $pkgFile)) {
        Write-Host "  [错误] 未找到 cloud_desktop/package.json: $pkgFile" -ForegroundColor Red
        return 1
    }

    $cap = Get-Content $capFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $pkg = Get-Content $pkgFile -Raw -Encoding UTF8 | ConvertFrom-Json

    $currentUrl = $cap.server.url
    $currentAppName = $cap.appName
    $currentProductName = $pkg.build.productName
    $currentVersion = $pkg.version

    Write-Host ""
    Write-Host "  ===========================================" -ForegroundColor Cyan
    Write-Host "   当前云端配置" -ForegroundColor Cyan
    Write-Host "  ===========================================" -ForegroundColor Cyan
    Write-Host "    云端URL:    $currentUrl" -ForegroundColor Yellow
    Write-Host "    应用名称:   $currentAppName" -ForegroundColor Yellow
    Write-Host "    产品名称:   $currentProductName" -ForegroundColor Yellow
    Write-Host "    桌面版本号: $currentVersion" -ForegroundColor Yellow
    Write-Host "  ===========================================" -ForegroundColor Cyan
    Write-Host "  (按回车键保留当前值，或输入新值修改)" -ForegroundColor DarkGray
    Write-Host "  提示: 云端URL决定 APP 加载的服务器地址" -ForegroundColor DarkGray
    Write-Host "        修改后需重新打包 APK 才生效" -ForegroundColor DarkGray
    Write-Host ""

    # ----- 编辑云端URL -----
    $newUrl = Read-Host "  请输入云端URL [$currentUrl]"
    if ([string]::IsNullOrWhiteSpace($newUrl)) {
        $newUrl = $currentUrl
        Write-Host "  [SKIP] 云端URL保持不变: $newUrl" -ForegroundColor Yellow
    } else {
        # 简单校验：必须以 http:// 或 https:// 开头
        if ($newUrl -notmatch '^https?://') {
            Write-Host "  [警告] URL 应以 http:// 或 https:// 开头" -ForegroundColor Yellow
            $confirm2 = Read-Host "  仍要使用此 URL 吗？(Y/N) [N]"
            if ($confirm2 -ieq 'Y') {
                Write-Host "  [INFO] 已接受 URL: $newUrl" -ForegroundColor Green
            } else {
                $newUrl = $currentUrl
                Write-Host "  [SKIP] 云端URL保持不变: $newUrl" -ForegroundColor Yellow
            }
        }
    }

    # ----- 编辑应用名称（capacitor.config.json 的 appName）-----
    $newAppName = Read-Host "  请输入应用名称(APP) [$currentAppName]"
    if ([string]::IsNullOrWhiteSpace($newAppName)) {
        $newAppName = $currentAppName
        Write-Host "  [SKIP] 应用名称保持不变: $newAppName" -ForegroundColor Yellow
    }

    # ----- 编辑产品名称（package.json 的 build.productName）-----
    $newProductName = Read-Host "  请输入产品名称(桌面) [$currentProductName]"
    if ([string]::IsNullOrWhiteSpace($newProductName)) {
        $newProductName = $currentProductName
        Write-Host "  [SKIP] 产品名称保持不变: $newProductName" -ForegroundColor Yellow
    }

    # ----- 编辑桌面版本号 -----
    $newVersion = Read-Host "  请输入桌面版本号 [$currentVersion]"
    if ([string]::IsNullOrWhiteSpace($newVersion)) {
        $newVersion = $currentVersion
        Write-Host "  [SKIP] 桌面版本号保持不变: $newVersion" -ForegroundColor Yellow
    }

    # ----- 最终确认 -----
    Write-Host ""
    Write-Host "  ===========================================" -ForegroundColor Cyan
    Write-Host "   请确认新配置" -ForegroundColor Cyan
    Write-Host "  ===========================================" -ForegroundColor Cyan
    Write-Host "    云端URL:    $newUrl" -ForegroundColor Green
    Write-Host "    应用名称:   $newAppName" -ForegroundColor Green
    Write-Host "    产品名称:   $newProductName" -ForegroundColor Green
    Write-Host "    桌面版本号: $newVersion" -ForegroundColor Green
    Write-Host "  ===========================================" -ForegroundColor Cyan
    Write-Host ""
    $confirm = Read-Host "  确认以上配置吗？(Y=确认 / N=重新输入 / 回车=确认)"
    if ([string]::IsNullOrWhiteSpace($confirm)) { $confirm = 'Y' }
    if ($confirm -ieq 'N') {
        Write-Host "  [INFO] 用户选择重新输入..." -ForegroundColor Yellow
        Edit-CloudConfig
        return
    }

    # ----- 检查是否有变化 -----
    $urlChanged = ($newUrl -ne $currentUrl)
    $appNameChanged = ($newAppName -ne $currentAppName)
    $productNameChanged = ($newProductName -ne $currentProductName)
    $versionChanged = ($newVersion -ne $currentVersion)

    if (-not ($urlChanged -or $appNameChanged -or $productNameChanged -or $versionChanged)) {
        Write-Host "  [SKIP] 所有配置均无变化" -ForegroundColor Yellow
        return 0
    }

    # ----- 写入 capacitor.config.json -----
    if ($urlChanged) { $cap.server.url = $newUrl }
    if ($appNameChanged) { $cap.appName = $newAppName }
    $capJson = $cap | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($capFile, $capJson, $script:UTF8NoBom)
    if ($urlChanged) {
        Write-Host "  [OK] 云端URL已更新: $currentUrl -> $newUrl" -ForegroundColor Green
    }
    if ($appNameChanged) {
        Write-Host "  [OK] 应用名称已更新: $currentAppName -> $newAppName" -ForegroundColor Green
    }

    # ----- 写入 cloud_desktop/package.json -----
    if ($productNameChanged) { $pkg.build.productName = $newProductName }
    if ($versionChanged) { $pkg.version = $newVersion }
    $pkgJson = $pkg | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($pkgFile, $pkgJson, $script:UTF8NoBom)
    if ($productNameChanged) {
        Write-Host "  [OK] 产品名称已更新: $currentProductName -> $newProductName" -ForegroundColor Green
    }
    if ($versionChanged) {
        Write-Host "  [OK] 桌面版本号已更新: $currentVersion -> $newVersion" -ForegroundColor Green
    }

    Write-Host ""
    Write-Host "  [完成] 配置已写入 capacitor.config.json 和 package.json" -ForegroundColor Green
    Write-Host "  提示: 修改后请重新打包桌面版或 APP 使配置生效" -ForegroundColor DarkGray
    return 0
}

# 打包前配置确认（显示当前版本号+关键信息，要求用户确认）
function Confirm-BuildConfig {
    param([string]$Target)
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "  打包前配置确认 - $Target" -ForegroundColor Cyan
    Write-Host "==========================================" -ForegroundColor Cyan

    # 从 cloud_desktop/package.json 读取
    $pkgFile = Join-Path $scriptDir 'cloud_desktop\package.json'
    if (Test-Path $pkgFile) {
        try {
            $pkg = Get-Content $pkgFile -Raw -Encoding UTF8 | ConvertFrom-Json
            Write-Host "  产品名称: $($pkg.build.productName)" -ForegroundColor Yellow
            Write-Host "  桌面版本: $($pkg.version)" -ForegroundColor Yellow
        } catch {
            Write-Host "  [警告] 无法解析 package.json" -ForegroundColor Yellow
        }
    }

    # 从 build.gradle 读取 versionName
    $gradleFile = Join-Path $scriptDir 'cloud_app\app\build.gradle'
    if (Test-Path $gradleFile) {
        $gradleContent = Get-Content $gradleFile -Raw -Encoding UTF8
        $versionNameMatch = [regex]::Match($gradleContent, 'versionName\s+"([^"]+)"')
        if ($versionNameMatch.Success) {
            Write-Host "  APP版本:  $($versionNameMatch.Groups[1].Value)" -ForegroundColor Yellow
        }
    }

    # 从 capacitor.config.json 读取云端URL
    $capFile = Join-Path $scriptDir 'cloud_app\app\src\main\assets\capacitor.config.json'
    if (Test-Path $capFile) {
        try {
            $cap = Get-Content $capFile -Raw -Encoding UTF8 | ConvertFrom-Json
            Write-Host "  云端URL:  $($cap.server.url)" -ForegroundColor Yellow
        } catch {}
    }

    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host ""
    $confirm = Read-Host "  确认开始打包吗？(Y=确认 / N=取消 / 回车=确认) [Y]"
    if ([string]::IsNullOrWhiteSpace($confirm)) { $confirm = 'Y' }
    if ($confirm -ieq 'N') {
        Write-Host "  [SKIP] 用户取消打包" -ForegroundColor Yellow
        return $false
    }
    Write-Host "  [INFO] 开始打包..." -ForegroundColor Green
    Write-Host ""
    return $true
}

function Build-Desktop {
    param([switch]$SkipConfirm)
    Write-Step "打包云端桌面版 exe (Electron)"

    # 打包前配置确认（Build-AllStrict/Build-All 连续流程时跳过，避免中间回车打断）
    if (-not $SkipConfirm) {
        if (-not (Confirm-BuildConfig -Target "云端桌面版")) {
            return 1
        }
    } else {
        Write-Host "  [SKIP] 跳过配置确认（连续打包模式）" -ForegroundColor Cyan
    }

    Write-Host "  将执行以下步骤："
    Write-Host "  1. 检查环境（npm）"
    Write-Host "  2. 检查 node_modules（缺失时自动 npm ci/install）"
    Write-Host "  3. 关闭残留进程"
    Write-Host "  4. 清理旧构建产物"
    Write-Host "  5. JavaScript 代码混淆"
    Write-Host "  6. npm build 打包（含 better-sqlite3 SSL 修复）"
    Write-Host "  7. 恢复原始代码"
    Write-Host ""
    Write-Host "  输出目录: cloud_desktop\dist\"
    Write-Host ""
    Write-Host "----------------------------------------------------------------"
    Write-Host ""
    # P1-易用：分步耗时统计
    $stepStart = Get-Date
    $code = Invoke-BatFile "$scriptDir\cloud_desktop\build.bat" "桌面版打包" -NoPause:$SkipConfirm
    $stepElapsed = (Get-Date) - $stepStart
    if ($code -ne 0) {
        Write-Host ""
        Write-Host "================================================================" -ForegroundColor Red
        Write-Host "  [ERROR] 桌面版打包失败！退出码: $code" -ForegroundColor Red
        Write-Host "  耗时: $($stepElapsed.ToString('mm\:ss'))" -ForegroundColor Red
        Write-Host "  请查看上方错误日志" -ForegroundColor Red
        Write-Host "================================================================" -ForegroundColor Red
        return 1
    }
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "  桌面版打包完成！" -ForegroundColor Green
    Write-Host "  输出目录: $scriptDir\cloud_desktop\dist\" -ForegroundColor Green
    Write-Host "  耗时: $($stepElapsed.ToString('mm\:ss'))" -ForegroundColor Green
    Write-Host "================================================================" -ForegroundColor Green
    return 0
}

function Build-App {
    param([switch]$SkipConfirm)
    Write-Step "打包云端手机 APP (APK)"

    # 打包前配置确认（Build-AllStrict/Build-All 连续流程时跳过，避免中间回车打断）
    if (-not $SkipConfirm) {
        if (-not (Confirm-BuildConfig -Target "云端手机 APP")) {
            return 1
        }
    } else {
        Write-Host "  [SKIP] 跳过配置确认（连续打包模式）" -ForegroundColor Cyan
    }

    Write-Host "  将执行以下步骤："
    Write-Host "  1. 同步 shared 文件到 cloud_app"
    Write-Host "  2. 同步 APP 版本号"
    Write-Host "  3. 自动递增 versionCode"
    Write-Host "  4. 清理旧构建缓存"
    Write-Host "  5. JavaScript 代码混淆"
    Write-Host "  6. Gradle 编译签名 APK"
    Write-Host "  7. 恢复原始代码"
    Write-Host "  8. 复制 APK 到当前目录"
    Write-Host ""
    Write-Host "  输出文件: 当前目录下的 .apk 文件"
    Write-Host ""
    Write-Host "  安全说明：APK 内含 Root 检测 + 调试器检测 + 签名校验（SecurityGuard.java）"
    Write-Host "----------------------------------------------------------------"
    Write-Host ""
    # P1-易用：分步耗时统计
    $stepStart = Get-Date
    $code = Invoke-BatFile "$scriptDir\build-app.bat" "APP 打包" -NoPause:$SkipConfirm
    $stepElapsed = (Get-Date) - $stepStart
    if ($code -ne 0) {
        Write-Host ""
        Write-Host "================================================================" -ForegroundColor Red
        Write-Host "  [ERROR] 手机 APP 打包失败！退出码: $code" -ForegroundColor Red
        Write-Host "  耗时: $($stepElapsed.ToString('mm\:ss'))" -ForegroundColor Red
        Write-Host "  请查看上方错误日志" -ForegroundColor Red
        Write-Host "================================================================" -ForegroundColor Red
        return 1
    }
    # P1-易用：验证 APK 产物并显示大小
    $apkFiles = Get-ChildItem -Path $scriptDir -Filter "*.apk" -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike "*-unaligned*" }
    if ($apkFiles) {
        $latest = $apkFiles | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        $sizeMB = [math]::Round($latest.Length / 1MB, 2)
        Write-Host "  [OK] APK: $($latest.Name)  $sizeMB MB" -ForegroundColor Green
    }
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "  手机 APP 打包完成！" -ForegroundColor Green
    Write-Host "  APK 文件: $scriptDir\*.apk" -ForegroundColor Green
    Write-Host "  耗时: $($stepElapsed.ToString('mm\:ss'))" -ForegroundColor Green
    Write-Host "================================================================" -ForegroundColor Green
    return 0
}

function Build-All {
    Write-Step "全部打包 (桌面 + APP)"
    Write-Host "  将依次执行："
    Write-Host "  Step A. 打包桌面版 exe"
    Write-Host "  Step B. 打包手机 APP (默认模式：Root+调试器检测)"
    Write-Host ""
    Write-Host "  输出："
    Write-Host "  - 桌面版: cloud_desktop\dist\*.exe"
    Write-Host "  - 手机 APP: 当前目录\*.apk"
    Write-Host ""
    $confirm = Read-Host "确认开始全部打包？(Y/n) [默认回车=开始]"
    if ($confirm -eq "n" -or $confirm -eq "N") {
        Write-Host "  已取消" -ForegroundColor Yellow
        return 0
    }

    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host "  Step A. 打包桌面版 exe" -ForegroundColor Cyan
    Write-Host "================================================================" -ForegroundColor Cyan
    $rc = Build-Desktop -SkipConfirm
    if ($rc -ne 0) {
        Write-Host "[ERROR] 桌面版打包失败，终止全部打包" -ForegroundColor Red
        return 1
    }

    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host "  Step B. 打包手机 APP" -ForegroundColor Cyan
    Write-Host "================================================================" -ForegroundColor Cyan
    $rc = Build-App -SkipConfirm
    if ($rc -ne 0) {
        Write-Host "[ERROR] APP 打包失败，终止全部打包" -ForegroundColor Red
        return 1
    }

    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "  全部打包完成！" -ForegroundColor Green
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  桌面版: $scriptDir\cloud_desktop\dist\" -ForegroundColor Green
    Write-Host "  手机 APP: $scriptDir\*.apk" -ForegroundColor Green
    Write-Host ""
    return 0
}

# ============================================================================
# Section 6: Config Display (对齐离线版 Show-CurrentConfig)
# ============================================================================

function Show-Config {
    Write-Step "当前云端配置信息"
    Write-Host ""

    # 从 cloud_desktop/package.json 读取 productName
    $pkgFile = Join-Path $scriptDir 'cloud_desktop\package.json'
    if (Test-Path $pkgFile) {
        try {
            $pkg = Get-Content $pkgFile -Raw -Encoding UTF8 | ConvertFrom-Json
            Write-Host "  产品名称: $($pkg.build.productName)"
            Write-Host "  应用ID:   $($pkg.name)"
            Write-Host "  版本号:   $($pkg.version)"
        } catch {
            Write-Host "  [警告] 无法解析 package.json" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  [警告] 未找到 cloud_desktop/package.json" -ForegroundColor Yellow
    }

    # 从 cloud_app/app/build.gradle 读取 applicationId 和 versionName
    $gradleFile = Join-Path $scriptDir 'cloud_app\app\build.gradle'
    if (Test-Path $gradleFile) {
        Write-Host ""
        Write-Host "  Android 配置:" -ForegroundColor White
        $gradleContent = Get-Content $gradleFile -Raw -Encoding UTF8
        $appIdMatch = [regex]::Match($gradleContent, 'applicationId\s+"([^"]+)"')
        if ($appIdMatch.Success) {
            Write-Host "    applicationId: $($appIdMatch.Groups[1].Value)"
        }
        $versionNameMatch = [regex]::Match($gradleContent, 'versionName\s+"([^"]+)"')
        if ($versionNameMatch.Success) {
            Write-Host "    versionName:   $($versionNameMatch.Groups[1].Value)"
        }
    }

    # 从 capacitor.config.json 读取云端URL
    $capFile = Join-Path $scriptDir 'cloud_app\app\src\main\assets\capacitor.config.json'
    if (Test-Path $capFile) {
        Write-Host ""
        Write-Host "  Capacitor 配置:" -ForegroundColor White
        try {
            $cap = Get-Content $capFile -Raw -Encoding UTF8 | ConvertFrom-Json
            Write-Host "    云端URL: $($cap.server.url)"
        } catch {}
    }

    Write-Host ""
    Write-Host "----------------------------------------------------------------"
    Write-Host "  安全防护状态（SecurityGuard.java）：" -ForegroundColor White
    $guardFile = Join-Path $scriptDir 'cloud_app\app\src\main\java\com\tcm\prescription\SecurityGuard.java'
    if (Test-Path $guardFile) {
        $guardContent = Get-Content $guardFile -Raw -Encoding UTF8
        $signMatch = [regex]::Match($guardContent, 'EXPECTED_SIGN_HASH = "([^"]*)"')
        $signHash = if ($signMatch.Success) { $signMatch.Groups[1].Value } else { "" }

        if ([string]::IsNullOrEmpty($signHash)) {
            Write-Host "    APK 签名校验: 跳过（EXPECTED_SIGN_HASH 为空，建议启用严格模式）" -ForegroundColor Yellow
        } else {
            Write-Host "    APK 签名校验: 严格模式 ✓" -ForegroundColor Green
            Write-Host "    签名哈希: $signHash"
        }
        # 安全检测开关
        $rootMatch = [regex]::Match($guardContent, 'ENABLE_ROOT_CHECK = (true|false)')
        $debugMatch = [regex]::Match($guardContent, 'ENABLE_DEBUGGER_CHECK = (true|false)')
        $rootOn = if ($rootMatch.Success) { $rootMatch.Groups[1].Value } else { "?" }
        $debugOn = if ($debugMatch.Success) { $debugMatch.Groups[1].Value } else { "?" }
        Write-Host "    Root 检测:    $rootOn"
        Write-Host "    调试器检测:   $debugOn"
    } else {
        Write-Host "    [警告] 未找到 SecurityGuard.java" -ForegroundColor Yellow
    }
    Write-Host ""
    return 0
}

# ============================================================================
# Section 7: Strict Mode (对齐离线版 Enable-StrictMode / Build-AllStrict)
# ============================================================================

function Enable-StrictMode {
    Write-Step "启用签名严格模式（从已打包 APK 提取签名哈希并注入 SecurityGuard.java）"
    Write-Host ""
    Write-Host "  前置条件："
    Write-Host "  - 已通过菜单 [2] 打包过至少一次 APK"
    Write-Host "  - APK 使用正式签名证书签名"
    Write-Host ""
    Write-Host "  流程："
    Write-Host "  1. 从最新 APK 提取签名 SHA-256"
    Write-Host "  2. 注入到 SecurityGuard.java 的 EXPECTED_SIGN_HASH"
    Write-Host "  3. 之后重新打包 APK 即启用签名严格模式"
    Write-Host ""
    Write-Host "  说明：Root 检测 + 调试器检测默认已启用，无需此步骤"
    Write-Host "----------------------------------------------------------------"
    Write-Host ""
    $code = Invoke-BatFile "$scriptDir\generate-sign-hash.bat" "签名哈希提取"
    Write-Host ""
    return $code
}

function Build-AllStrict {
    Write-Step "一键打包严格模式（桌面 + APP + 签名严格模式）"
    Write-Host ""
    Write-Host "  自动执行流程："
    Write-Host "  Step A. 打包桌面版 exe"
    Write-Host "  Step B. 打包手机 APP（默认模式 APK：Root+调试器检测）"
    Write-Host "  Step C. 提取 APK 签名哈希并注入 SecurityGuard.java"
    Write-Host "  Step D. 重新打包手机 APP（签名严格模式 APK）"
    Write-Host ""
    Write-Host "  最终输出："
    Write-Host "  - 桌面版: cloud_desktop\dist\*.exe"
    Write-Host "  - 手机 APP: 当前目录\*.apk（已启用签名严格模式）"
    Write-Host ""
    $confirm = Read-Host "确认开始一键打包？(Y/n) [默认回车=开始]"
    if ($confirm -eq "n" -or $confirm -eq "N") {
        Write-Host "  已取消" -ForegroundColor Yellow
        return 0
    }

    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host "  Step A. 打包桌面版 exe" -ForegroundColor Cyan
    Write-Host "================================================================" -ForegroundColor Cyan
    $rc = Build-Desktop -SkipConfirm
    if ($rc -ne 0) {
        Write-Host "[ERROR] 桌面版打包失败，终止一键打包" -ForegroundColor Red
        return 1
    }

    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host "  Step B. 打包手机 APP（默认模式：Root+调试器检测）" -ForegroundColor Cyan
    Write-Host "================================================================" -ForegroundColor Cyan
    $rc = Build-App -SkipConfirm
    if ($rc -ne 0) {
        Write-Host "[ERROR] APP 打包失败，终止一键打包" -ForegroundColor Red
        return 1
    }

    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host "  Step C. 提取 APK 签名哈希并注入 SecurityGuard.java" -ForegroundColor Cyan
    Write-Host "================================================================" -ForegroundColor Cyan
    $rc = Invoke-BatFile "$scriptDir\generate-sign-hash.bat" "签名哈希提取"
    if ($rc -ne 0) {
        Write-Host "[ERROR] 签名哈希提取失败，终止一键打包" -ForegroundColor Red
        Write-Host "  您仍可使用 Step B 的 APK（默认模式）" -ForegroundColor Yellow
        return 1
    }

    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host "  Step D. 重新打包手机 APP（签名严格模式 APK）" -ForegroundColor Cyan
    Write-Host "================================================================" -ForegroundColor Cyan
    $rc = Build-App -SkipConfirm
    if ($rc -ne 0) {
        Write-Host "[ERROR] 签名严格模式重新打包失败" -ForegroundColor Red
        Write-Host "  您仍可使用 Step B 的 APK（默认模式）" -ForegroundColor Yellow
        return 1
    }

    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "  一键打包完成！" -ForegroundColor Green
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  桌面版: $scriptDir\cloud_desktop\dist\" -ForegroundColor Green
    Write-Host "  手机 APP: $scriptDir\*.apk（签名严格模式）" -ForegroundColor Green
    Write-Host ""
    return 0
}

# ============================================================================
# Section 8: Main Loop (对齐离线版 pack.ps1 Interactive 入口)
# ============================================================================

while ($true) {
    $choice = Show-Menu
    # P1-易用：总耗时统计
    $totalStart = Get-Date
    switch ($choice) {
        '1' { Build-Desktop | Out-Null }
        '2' { Build-App | Out-Null }
        '3' { Build-All | Out-Null }
        '4' { Sync-FilesToCloudApp | Out-Null }
        '5' { Edit-CloudConfig | Out-Null }
        '6' { Invoke-EncodingCheck | Out-Null }
        '7' { Show-Config | Out-Null }
        '8' { Enable-StrictMode | Out-Null }
        '9' { Build-AllStrict | Out-Null }
        # P1-易用：快捷选项 - 跳过编码检查，直接打包
        'a' {
            Write-Host "[快捷] 快速全部打包（跳过编码检查）..." -ForegroundColor Cyan
            Build-All | Out-Null
        }
        'd' {
            Write-Host "[快捷] 快速桌面打包（跳过编码检查）..." -ForegroundColor Cyan
            Build-Desktop | Out-Null
        }
        'p' {
            Write-Host "[快捷] 快速 APP 打包（跳过编码检查）..." -ForegroundColor Cyan
            Build-App | Out-Null
        }
        '0' {
            Write-Host ""
            Write-Host "再见！" -ForegroundColor Cyan
            Start-Sleep -Seconds 1
            exit
        }
        default {
            Write-Host ""
            Write-Host "  [错误] 无效选择，请重新输入" -ForegroundColor Red
            Start-Sleep -Seconds 2
        }
    }
    # P1-易用：显示本次操作总耗时
    if ($choice -ne '0' -and $choice -ne '7') {
        $totalElapsed = (Get-Date) - $totalStart
        Write-Host ""
        Write-Host "  本次操作总耗时: $($totalElapsed.ToString('hh\:mm\:ss'))" -ForegroundColor DarkGray
    }
    if ($choice -ne '0') {
        Write-Host ""
        Read-Host "按回车键继续"
    }
}
