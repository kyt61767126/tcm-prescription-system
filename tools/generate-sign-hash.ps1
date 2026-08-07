# generate-sign-hash.ps1 - Unified APK signature hash extraction and injection tool
# Extracts SHA-256 from APK and injects into LicenseManager.java (offline) or SecurityGuard.java (cloud)
# Enables strict signature mode: APP rejects any repackaged APK with mismatched signature

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('cloud','geren-cloud','dingzhi','geren')]
    [string]$Version
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$rootDir = $PSScriptRoot | Split-Path -Parent  # project root: d:\trae_projects\kyt-zy

# Decide project directory, target file, and placeholder based on Version
$verLabel = switch ($Version) {
    'cloud'       { '云端' }
    'geren-cloud' { '云端个人' }
    'dingzhi'     { '定制' }
    'geren'       { '个人' }
    default       { $Version }
}

# APK file filter for precise matching (avoid finding wrong APK)
$apkFilter = '*.apk'

if ($Version -eq 'cloud') {
    $projectDir = Join-Path $rootDir "app_project\db-yunduan"
    $guardFileName = 'SecurityGuard.java'
    $guardSearchPath = Join-Path $projectDir "cloud_app\app\src\main\java\com\tcm\prescription"
    $placeholder = 'EXPECTED_SIGN_HASH'
    $useRecurse = $false
    $apkFilter = '惠康中医-YB.apk'
} elseif ($Version -eq 'geren-cloud') {
    $projectDir = Join-Path $rootDir "app_project\db-yunduan"
    $guardFileName = 'SecurityGuard.java'
    $guardSearchPath = Join-Path $projectDir "cloud_app_geren\app\src\main\java\com\tcm\prescription"
    $placeholder = 'EXPECTED_SIGN_HASH'
    $useRecurse = $false
    $apkFilter = '惠康中医-YJ.apk'
} elseif ($Version -eq 'dingzhi') {
    # db-offline merged structure: APK in db-offline/ root, Java in app/app/src/main/java/
    $projectDir = Join-Path $rootDir "app_project\db-offline"
    $guardFileName = 'LicenseManager.java'
    $guardSearchPath = Join-Path $projectDir "app\app\src\main\java\com\benneng\pres"
    $placeholder = 'EXPECTED_APK_SIGNATURE_SHA256'
    $useRecurse = $false
    $apkFilter = '惠康中医-LJ.apk'
} elseif ($Version -eq 'geren') {
    $projectDir = Join-Path $rootDir "app_project\db-offline"
    $guardFileName = 'LicenseManager.java'
    $guardSearchPath = Join-Path $projectDir "app_geren\app\src\main\java\com\benneng\pres"
    $placeholder = 'EXPECTED_APK_SIGNATURE_SHA256'
    $useRecurse = $false
    $apkFilter = '惠康中医-LB.apk'
}

Write-Host ""
Write-Host "================================================================"
Write-Host "  签名哈希生成工具（$verLabel 版 - 启用签名严格模式）"
Write-Host "================================================================"
Write-Host ""

# ------------------------------------------------------------
# [1/4] Find the latest APK file
# ------------------------------------------------------------
Write-Host "[1/4] 查找 APK 文件..."
$apkFiles = Get-ChildItem -Path $projectDir -Filter $apkFilter -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending
if (-not $apkFiles -or $apkFiles.Count -eq 0) {
    Write-Host "  [错误] 未找到 APK 文件: $projectDir"
    Write-Host "  请先运行打包工具生成 APK 后再使用本工具"
    exit 1
}
$apkFile = $apkFiles[0]
$sizeMB = [math]::Round($apkFile.Length / 1MB, 2)
Write-Host "  [OK] APK 文件: $($apkFile.Name) ($sizeMB MB)"
Write-Host "  路径: $($apkFile.FullName)"
Write-Host ""

# ------------------------------------------------------------
# [2/4] Read APK signature SHA-256 via keytool
# ------------------------------------------------------------
Write-Host "[2/4] 读取 APK 签名 SHA-256..."

$keytoolPath = $null
$cmd = Get-Command keytool -ErrorAction SilentlyContinue
if ($cmd) {
    $keytoolPath = $cmd.Source
} else {
    $candidatePaths = @(
        "$env:JAVA_HOME\bin\keytool.exe",
        "$env:LOCALAPPDATA\Programs\Android Studio\jbr\bin\keytool.exe",
        "$env:ProgramFiles\Java\jdk*\bin\keytool.exe",
        "${env:ProgramFiles(x86)}\Java\jdk*\bin\keytool.exe",
        "$env:LOCALAPPDATA\Android\Sdk\jdk\*\bin\keytool.exe"
    )
    foreach ($p in $candidatePaths) {
        $found = Get-Item $p -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) {
            $keytoolPath = $found.FullName
            break
        }
    }
}

if (-not $keytoolPath) {
    Write-Host "  [错误] 未找到 keytool.exe"
    Write-Host "  请确保已安装 JDK 或 Android Studio"
    Write-Host "  可设置 JAVA_HOME 环境变量指向 JDK 目录"
    exit 1
}
Write-Host "  使用 keytool: $keytoolPath"

$certOutput = & $keytoolPath -printcert -jarfile $apkFile.FullName 2>&1 | Out-String
$signSha256 = ""
foreach ($line in $certOutput -split "`n") {
    if ($line -match "SHA256:\s*([0-9A-Fa-f:]+)") {
        $signSha256 = ($matches[1] -replace ":", "").ToLower()
        break
    }
}
if (-not $signSha256) {
    Write-Host "  [错误] 无法从 keytool 输出解析签名 SHA-256"
    Write-Host "  keytool 输出内容:"
    Write-Host $certOutput
    exit 1
}
Write-Host "  [OK] 签名 SHA-256: $signSha256"
Write-Host ""

# ------------------------------------------------------------
# [3/4] Inject hash into target Java file
# ------------------------------------------------------------
Write-Host "[3/4] 注入哈希到 $guardFileName..."

if ($useRecurse) {
    $guardFiles = Get-ChildItem -Path $projectDir -Recurse -Filter $guardFileName -ErrorAction SilentlyContinue
} else {
    $guardFiles = Get-ChildItem -Path $guardSearchPath -Filter $guardFileName -ErrorAction SilentlyContinue
}
if (-not $guardFiles -or $guardFiles.Count -eq 0) {
    Write-Host "  [错误] 未找到 $guardFileName"
    Write-Host "  搜索路径: $guardSearchPath"
    exit 1
}
if ($guardFiles.Count -gt 1) {
    Write-Host "  [警告] 找到 $($guardFiles.Count) 个 $guardFileName，将注入第一个"
    $guardFiles | ForEach-Object { Write-Host "    - $($_.FullName)" }
}
$guardFile = $guardFiles[0]
Write-Host "  目标文件: $($guardFile.FullName)"

$content = Get-Content $guardFile.FullName -Raw -Encoding UTF8
$updated = $false

# ★ 正则加行首锚定（?m）+ 可选空白，避免匹配到注释行（如 // private static final...）
# 之前无锚定可能匹配到被注释掉的占位符，导致替换注释行破坏代码语法
$signPattern = '(?m)^\s*private static final String ' + $placeholder + ' = "[^"]*";'
$signReplacement = 'private static final String ' + $placeholder + ' = "' + $signSha256 + '";'
if ($content -match $signPattern) {
    $newContent = $content -replace $signPattern, $signReplacement
    if ($newContent -ne $content) {
        # ★ 写入前备份原文件（.bak），注入失败时可回滚
        $bakPath = "$($guardFile.FullName).bak"
        Copy-Item -Path $guardFile.FullName -Destination $bakPath -Force
        Write-Host "  [OK] 已备份原文件: $(Split-Path $bakPath -Leaf)"
        $content = $newContent
        $updated = $true
        Write-Host "  [OK] $placeholder = $signSha256"
    } else {
        Write-Host "  [警告] 哈希已与当前值一致，无需更新"
    }
} else {
    Write-Host "  [警告] 未找到 $placeholder 占位符（可能已被修改过格式）"
}

if ($updated) {
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($guardFile.FullName, $content, $utf8NoBom)
    Write-Host "  [OK] 文件已保存"
    # ★ 写入成功后删除备份（避免 .bak 残留干扰下次打包）
    $bakPath = "$($guardFile.FullName).bak"
    if (Test-Path $bakPath) {
        Remove-Item $bakPath -Force -ErrorAction SilentlyContinue
    }
}
Write-Host ""

# ------------------------------------------------------------
# [4/4] Done
# ------------------------------------------------------------
Write-Host "[4/4] 完成"
Write-Host ""
Write-Host "================================================================"
Write-Host "  $verLabel 版签名严格模式已启用！"
Write-Host "================================================================"
Write-Host ""
Write-Host "  签名 SHA-256: $signSha256"
Write-Host ""
if (-not $env:NO_PAUSE) {
    Write-Host "  下一步："
    Write-Host "  1. 重新打包 APK（运行 pack-app.bat 或 pack-app-strict.bat）"
    Write-Host "  2. 新 APK 将启用签名严格模式："
    Write-Host "     - APK 签名必须与上述哈希完全一致"
    Write-Host "     - 任何二次打包、调试器附加、Root 设备都会导致 APP 自动退出"
    Write-Host ""
    Write-Host "  注意："
    Write-Host "  - 更换签名证书后签名哈希会变化，需重新运行本工具"
    Write-Host "  - 修改 Java 代码不影响签名哈希（仅影响 dex 内容，本工具不校验 dex）"
    Read-Host "按回车键继续"
} else {
    Write-Host "  将在下一步自动重新打包 APK..."
    Write-Host "  新 APK 将启用签名严格模式（二次打包/调试器/Root 将自动退出）"
}
