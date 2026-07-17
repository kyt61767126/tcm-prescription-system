# generate-sign-hash.ps1 - 从 APK 提取签名 + dex 哈希，注入到 SecurityGuard.java
# 启用严格模式：APP 启动时与硬编码哈希严格比对，任何二次打包都会被拒绝
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"
$scriptDir = $PSScriptRoot

Write-Host ""
Write-Host "================================================================"
Write-Host "  签名哈希生成工具（启用严格模式）"
Write-Host "================================================================"
Write-Host ""

# ------------------------------------------------------------
# [1/5] 查找最新的 APK 文件
# ------------------------------------------------------------
Write-Host "[1/5] 查找 APK 文件..."
$apkFiles = Get-ChildItem -Path $scriptDir -Filter "*.apk" -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending
if (-not $apkFiles -or $apkFiles.Count -eq 0) {
    Write-Host "  [错误] 当前目录下未找到 APK 文件"
    Write-Host "  请先运行 build-app.bat 打包 APK 后再使用本工具"
    exit 1
}
$apkFile = $apkFiles[0]
$sizeMB = [math]::Round($apkFile.Length / 1MB, 2)
Write-Host "  [OK] APK 文件: $($apkFile.Name) ($sizeMB MB)"
Write-Host "  路径: $($apkFile.FullName)"
Write-Host ""

# ------------------------------------------------------------
# [2/5] 用 keytool 读取签名 SHA-256
# ------------------------------------------------------------
Write-Host "[2/5] 读取 APK 签名 SHA-256..."

$keytoolPath = $null
# 优先尝试 PATH 中的 keytool
$cmd = Get-Command keytool -ErrorAction SilentlyContinue
if ($cmd) {
    $keytoolPath = $cmd.Source
} else {
    # 尝试常见 JDK 路径
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
# keytool 输出格式：SHA256: AB:CD:EF:...
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
# [3/5] 计算 APK 内所有 classes*.dex 的串联 SHA-256
# ------------------------------------------------------------
Write-Host "[3/5] 计算 classes*.dex 串联 SHA-256..."
Add-Type -AssemblyName System.IO.Compression.FileSystem

$apkZip = [System.IO.Compression.ZipFile]::OpenRead($apkFile.FullName)
try {
    $dexEntries = $apkZip.Entries |
                  Where-Object { $_.Name -match "^classes.*\.dex$" } |
                  Sort-Object Name
    if (-not $dexEntries -or $dexEntries.Count -eq 0) {
        Write-Host "  [错误] APK 内未找到 dex 文件"
        exit 1
    }
    Write-Host "  找到 $($dexEntries.Count) 个 dex 文件: $($dexEntries.Name -join ', ')"

    $sha = [System.Security.Cryptography.SHA256]::Create()
    $sep = [byte[]](124)  # '|' 分隔符
    foreach ($entry in $dexEntries) {
        $stream = $entry.Open()
        try {
            $buf = New-Object byte[] 8192
            while (($len = $stream.Read($buf, 0, $buf.Length)) -gt 0) {
                $sha.TransformBlock($buf, 0, $len, $buf, 0)
            }
            # 加分隔符防止拼接歧义（与 Java 端 SecurityGuard.computeDexHash 保持一致）
            $sha.TransformBlock($sep, 0, 1, $sep, 0)
        } finally {
            $stream.Dispose()
        }
    }
    $sha.TransformFinalBlock([byte[]]@(), 0, 0)
    $dexSha256 = -join ($sha.Hash | ForEach-Object { $_.ToString("x2") })
} finally {
    $apkZip.Dispose()
}

Write-Host "  [OK] Dex SHA-256: $dexSha256"
Write-Host ""

# ------------------------------------------------------------
# [4/5] 注入哈希到 SecurityGuard.java
# ------------------------------------------------------------
Write-Host "[4/5] 注入哈希到 SecurityGuard.java..."

$guardFiles = Get-ChildItem -Path $scriptDir -Recurse -Filter "SecurityGuard.java" -ErrorAction SilentlyContinue
if (-not $guardFiles -or $guardFiles.Count -eq 0) {
    Write-Host "  [错误] 未找到 SecurityGuard.java"
    exit 1
}
if ($guardFiles.Count -gt 1) {
    Write-Host "  [警告] 找到 $($guardFiles.Count) 个 SecurityGuard.java，将注入第一个"
    $guardFiles | ForEach-Object { Write-Host "    - $($_.FullName)" }
}
$guardFile = $guardFiles[0]
Write-Host "  目标文件: $($guardFile.FullName)"

$content = Get-Content $guardFile.FullName -Raw -Encoding UTF8
$updated = $false

# 替换 EXPECTED_SIGN_HASH（支持已填值或为空）
$signPattern = 'private static final String EXPECTED_SIGN_HASH = "[^"]*";'
$signReplacement = 'private static final String EXPECTED_SIGN_HASH = "' + $signSha256 + '";'
if ($content -match $signPattern) {
    $newContent = $content -replace $signPattern, $signReplacement
    if ($newContent -ne $content) {
        $content = $newContent
        $updated = $true
        Write-Host "  [OK] EXPECTED_SIGN_HASH = $signSha256"
    }
} else {
    Write-Host "  [警告] 未找到 EXPECTED_SIGN_HASH 占位符（可能已被修改过格式）"
}

# 替换 EXPECTED_DEX_HASH
$dexPattern = 'private static final String EXPECTED_DEX_HASH = "[^"]*";'
$dexReplacement = 'private static final String EXPECTED_DEX_HASH = "' + $dexSha256 + '";'
if ($content -match $dexPattern) {
    $newContent = $content -replace $dexPattern, $dexReplacement
    if ($newContent -ne $content) {
        $content = $newContent
        $updated = $true
        Write-Host "  [OK] EXPECTED_DEX_HASH = $dexSha256"
    }
} else {
    Write-Host "  [警告] 未找到 EXPECTED_DEX_HASH 占位符"
}

if ($updated) {
    # 保留原文件 BOM 和换行风格
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($guardFile.FullName, $content, $utf8NoBom)
    Write-Host "  [OK] 文件已保存"
} else {
    Write-Host "  [警告] 未修改任何内容（可能哈希已与当前值一致）"
}
Write-Host ""

# ------------------------------------------------------------
# [5/5] 完成提示
# ------------------------------------------------------------
Write-Host "[5/5] 完成"
Write-Host ""
Write-Host "================================================================"
Write-Host "  严格模式哈希已注入成功！"
Write-Host "================================================================"
Write-Host ""
Write-Host "  签名 SHA-256: $signSha256"
Write-Host "  Dex   SHA-256: $dexSha256"
Write-Host ""
Write-Host "  下一步："
Write-Host "  1. 重新运行 build-app.bat 打包 APK"
Write-Host "  2. 新 APK 将启用严格模式："
Write-Host "     - 签名必须与上述哈希完全一致"
Write-Host "     - dex 哈希必须与上述哈希完全一致"
Write-Host "     - 任何二次打包、调试器附加、Frida 注入都会导致 APP 自动退出"
Write-Host ""
Write-Host "  注意："
Write-Host "  - 修改 Java 代码后 dex 哈希会变化，需重新生成本工具的哈希"
Write-Host "  - 更换签名证书后签名哈希会变化，需重新生成本工具的哈希"
Write-Host ""
Read-Host "按回车键继续"
