# generate-sign-hash.ps1 - Unified APK signature hash extraction and injection tool
# Extracts SHA-256 from APK and injects into LicenseManager.java (offline) or SecurityGuard.java (cloud)
# Enables strict signature mode: APP rejects any repackaged APK with mismatched signature

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('cloud','dingzhi')]
    [string]$Version
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$rootDir = $PSScriptRoot | Split-Path -Parent  # project root: d:\trae_projects\kyt-zy

# Decide project directory, target file, and placeholder based on Version
$verLabel = switch ($Version) {
    'cloud'       { '云端' }
    'dingzhi'     { '本地' }
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
    $apkFilter = '惠康中医-云端.apk'
    $appRoot = Join-Path $projectDir "cloud_app\app"
} elseif ($Version -eq 'dingzhi') {
    # db-offline merged structure: APK in db-offline/ root, Java in app/app/src/main/java/
    $projectDir = Join-Path $rootDir "app_project\db-offline"
    $guardFileName = 'LicenseManager.java'
    $guardSearchPath = Join-Path $projectDir "app\app\src\main\java\com\benneng\pres"
    $placeholder = 'EXPECTED_APK_SIGNATURE_SHA256'
    $useRecurse = $false
    $apkFilter = '惠康中医-本地.apk'
    $appRoot = Join-Path $projectDir "app\app"
}

Write-Host ""
Write-Host "================================================================"
Write-Host "  签名哈希生成工具（$verLabel 版 - 启用签名严格模式）"
Write-Host "================================================================"
Write-Host ""

# ------------------------------------------------------------
# [1/4] 定位 keystore + 读取 storePassword
# ------------------------------------------------------------
# ★ 第三轮打包优化 E1：改从 keystore 直接提取证书哈希（keytool -list），
#   而非从已构建 APK 提取（keytool -printcert -jarfile）。
#   原因：APK 由该 keystore 签名，证书哈希一致；且无需先构建 APK，
#   从而消除严格模式的 Step A（每次省去一次完整构建，时间减半）。
Write-Host "[1/4] 定位签名 keystore..."
$keystorePath = Join-Path $appRoot "app-release.jks"
if (-not (Test-Path $keystorePath)) {
    Write-Host "  [错误] 未找到 keystore: $keystorePath"
    Write-Host "  请先确认 app-release.jks 存在"
    exit 1
}
Write-Host "  [OK] keystore: $keystorePath"

$storePassword = ""
$signPropsPath = Join-Path $appRoot "signing.properties"
if (Test-Path $signPropsPath) {
    foreach ($line in (Get-Content $signPropsPath -ErrorAction SilentlyContinue)) {
        if ($line -match '^\s*storePassword\s*=\s*(.+)$') {
            $storePassword = $matches[1].Trim()
            break
        }
    }
}
if (-not $storePassword) {
    $storePassword = $env:TCM_STORE_PASSWORD
}
if (-not $storePassword) {
    Write-Host "  [错误] 无法获取 keystore 密码（signing.properties 无 storePassword，且未设 TCM_STORE_PASSWORD 环境变量）"
    exit 1
}
Write-Host "  [OK] 已读取 keystore 密码（signing.properties 或环境变量）"
Write-Host ""

# ------------------------------------------------------------
# [2/4] 读取 keystore 证书 SHA-256
# ------------------------------------------------------------
Write-Host "[2/4] 读取 keystore 证书 SHA-256..."

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

$certOutput = & $keytoolPath -list -v -keystore $keystorePath -storepass $storePassword 2>&1 | Out-String
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

# ★ P1-2（2026-08-26）签名哈希碎片化注入：明文 64 位哈希不再写入单一字符串常量
#   （防 smali/strings 静态搜索定位后篡改）。拆 4 片×16 hex 字符，每片先按位移
#   shift 做十六进制替换（(d+shift)%16），再整体反序存储；运行时由 Java 端
#   expectedApkSignatureSha256() / expectedSignHash() 重组比对（逻辑严格互逆）。
$shifts = @(5, 11, 3, 9)
$fragments = @()
for ($i = 0; $i -lt 4; $i++) {
    $frag = $signSha256.Substring($i * 16, 16)
    $shifted = -join ($frag.ToCharArray() | ForEach-Object {
        '{0:x}' -f (([Convert]::ToInt32($_.ToString(), 16) + $shifts[$i]) % 16)
    })
    $rev = $shifted.ToCharArray(); [array]::Reverse($rev)
    $fragments += (-join $rev)
}

# 自检：逆向重组必须还原出原始哈希（防脚本与 Java 逻辑不一致流出坏包）
$roundTrip = ''
for ($i = 0; $i -lt 4; $i++) {
    $rev = $fragments[$i].ToCharArray(); [array]::Reverse($rev)
    $shifted = -join $rev
    $roundTrip += -join ($shifted.ToCharArray() | ForEach-Object {
        '{0:x}' -f (([Convert]::ToInt32($_.ToString(), 16) - $shifts[$i] + 16) % 16)
    })
}
if ($roundTrip -ne $signSha256) {
    Write-Host "  [错误] 碎片化自检失败（重组=$roundTrip 原始=$signSha256）"
    exit 1
}

# 正则加行首锚定（?m）+ 可选空白，避免匹配到注释行
$signPattern = '(?m)^\s*private static final String\[\] SIGN_FRAGMENTS = \{[^}]*\};'
$signReplacement = 'private static final String[] SIGN_FRAGMENTS = { "' + ($fragments -join '", "') + '" };'
if ($content -match $signPattern) {
    $newContent = $content -replace $signPattern, $signReplacement
    if ($newContent -ne $content) {
        # ★ 写入前备份原文件（.bak），注入失败时可回滚
        $bakPath = "$($guardFile.FullName).bak"
        Copy-Item -Path $guardFile.FullName -Destination $bakPath -Force
        Write-Host "  [OK] 已备份原文件: $(Split-Path $bakPath -Leaf)"
        $content = $newContent
        $updated = $true
        Write-Host "  [OK] $placeholder 碎片化注入完成（4 片 x 16 hex，明文哈希不再出现于源码）"
    } else {
        # ★ 2026-08-23 优化：哈希已一致属正常幂等（上次已注入，本次校验通过），
        #   原按[警告]黄色显示，用户误以为打包过程出错。改为[OK]绿色正常提示。
        Write-Host "  [OK] 哈希已与当前值一致（$placeholder 碎片校验通过，无需更新）" -ForegroundColor Green
    }
} else {
    Write-Host "  [警告] 未找到 SIGN_FRAGMENTS 碎片占位符（源码可能还是旧明文格式，请拉取最新代码）"
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
    Write-Host "  1. 重新打包 APK（运行 pack-app.bat）"
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
