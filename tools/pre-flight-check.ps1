# pre-flight-check.ps1 - 打包前预防性检查
# 检测并修复上次非正常退出（崩溃/Ctrl+C/进程被杀）留下的残留文件
# 调用方式：powershell -NoProfile -ExecutionPolicy Bypass -File pre-flight-check.ps1 [-Target cloud] [-AppDir ...] [-DesktopDir ...]
param(
    [string]$Target = "",       # obfuscate target: cloud/dingzhi/dingzhi-cloud
    [string]$AppDir = "",       # APP 项目目录（清理 .gradle/configuration-cache）
    [string]$DesktopDir = ""    # 桌面项目目录（清理 dist_old_*/package.json.certbak）
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$scriptDir = $PSScriptRoot
$projectRoot = if ($scriptDir) { Split-Path $scriptDir -Parent } else { $PWD.Path }

$fixed = 0

Write-Host ""
Write-Host "[Pre-flight] 预防性检查（检测上次非正常退出残留）..." -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# 1. 检查 .build_vcode_prev 残留（versionCode 回滚文件）
# 上次 build-app.bat 在 Gradle 构建失败时创建，成功后删除
# 若脚本被 Ctrl+C 中断，文件会残留，下次打包 versionCode 状态不一致
# ---------------------------------------------------------------------------
$vcodePrevCandidates = @(
    (Join-Path $projectRoot "app_project\db-yunduan\.build_vcode_prev"),
    (Join-Path $projectRoot "app_project\db-offline\app\.build_vcode_prev")
) | Where-Object { Test-Path $_ }

foreach ($f in $vcodePrevCandidates) {
    Write-Host "  [WARN] .build_vcode_prev 残留: $f" -ForegroundColor Yellow
    Write-Host "         原因: 上次打包 Gradle 构建失败或被中断" -ForegroundColor DarkGray
    Remove-Item $f -Force -ErrorAction SilentlyContinue
    Write-Host "         [OK] 已清理" -ForegroundColor Green
    $fixed++
}

# ---------------------------------------------------------------------------
# 2. 检查 .bak 文件残留（obfuscate.js 未还原）
# obfuscate.js 混淆前备份为 .bak，restore 时恢复并删除 .bak
# 若脚本中断，.bak 残留，源代码处于混淆状态
# ---------------------------------------------------------------------------
if ($Target -ne "") {
    $obfuscatePath = Join-Path $scriptDir "obfuscate.js"
    if (Test-Path $obfuscatePath) {
        # 扫描关键目录是否有 .bak 文件
        $checkDirs = @(
            "public",
            "public\electron",
            "app_project\db-yunduan\cloud_desktop",
            "app_project\db-yunduan\cloud_desktop\electron",
            "app_project\db-yunduan\cloud_app\app\src\main\assets\public",
            "app_project\db-yunduan\cloud_app\app\src\main\assets",
            "app_project\db-offline\desktop",
            "app_project\db-offline\desktop\electron",
            "app_project\db-offline\app\app\src\main\assets\public"
        )

        $hasBak = $false
        $bakSamples = @()
        foreach ($dir in $checkDirs) {
            $fullDir = Join-Path $projectRoot $dir
            if (Test-Path $fullDir) {
                $bakFiles = Get-ChildItem $fullDir -Filter "*.bak" -File -ErrorAction SilentlyContinue
                if ($bakFiles) {
                    $hasBak = $true
                    $bakSamples += $bakFiles | Select-Object -First 2 | ForEach-Object { "$dir\$($_.Name)" }
                }
            }
        }

        if ($hasBak) {
            Write-Host "  [WARN] 检测到 .bak 残留文件（obfuscate 未还原）" -ForegroundColor Yellow
            $bakSamples | ForEach-Object { Write-Host "         - $_" -ForegroundColor DarkGray }
            Write-Host "         原因: 上次打包 obfuscate.js 中断，源代码处于混淆状态" -ForegroundColor DarkGray
            Write-Host "         正在自动恢复..." -ForegroundColor Yellow
            & node $obfuscatePath restore --target=$Target 2>&1 | ForEach-Object {
                Write-Host "         $_" -ForegroundColor DarkGray
            }
            if ($LASTEXITCODE -eq 0) {
                Write-Host "         [OK] 已恢复原始代码" -ForegroundColor Green
            } else {
                Write-Host "         [WARN] restore 退出码: $LASTEXITCODE（可能需手动执行）" -ForegroundColor Yellow
            }
            $fixed++
        }
    }
}

# ---------------------------------------------------------------------------
# 3. 检查 package.json.certbak 残留（桌面版代码签名备份）
# packaging.ps1 在证书不存在时备份 package.json 为 .certbak，构建后恢复
# 若脚本中断，package.json 处于被修改状态（certificateFile 已移除）
# ---------------------------------------------------------------------------
$certBakCandidates = @()
if ($DesktopDir -ne "" -and (Test-Path $DesktopDir)) {
    $certBakCandidates += Join-Path $DesktopDir "package.json.certbak"
} else {
    $certBakCandidates += (Join-Path $projectRoot "app_project\db-yunduan\cloud_desktop\package.json.certbak")
    $certBakCandidates += (Join-Path $projectRoot "app_project\db-offline\desktop\package.json.certbak")
}

foreach ($f in ($certBakCandidates | Where-Object { Test-Path $_ })) {
    $pkgPath = $f -replace '\.certbak$', ''
    Write-Host "  [WARN] package.json.certbak 残留: $f" -ForegroundColor Yellow
    Write-Host "         原因: 上次桌面打包中断，package.json 处于被修改状态" -ForegroundColor DarkGray
    if (Test-Path $pkgPath) {
        Copy-Item $f $pkgPath -Force
        Remove-Item $f -Force -ErrorAction SilentlyContinue
        Write-Host "         [OK] 已恢复 package.json" -ForegroundColor Green
    } else {
        Remove-Item $f -Force -ErrorAction SilentlyContinue
        Write-Host "         [OK] 已清理孤立 certbak（原 package.json 不存在）" -ForegroundColor Green
    }
    $fixed++
}

# ---------------------------------------------------------------------------
# 4. 检查 dist_old_* 残留（桌面版旧构建产物）
# packaging.ps1 在 dist 目录被占用时重命名为 dist_old_时间戳
# 多次崩溃会积累多个 dist_old 目录占用磁盘
# ---------------------------------------------------------------------------
$desktopCheckDirs = @()
if ($DesktopDir -ne "" -and (Test-Path $DesktopDir)) {
    $desktopCheckDirs += $DesktopDir
} else {
    $desktopCheckDirs += (Join-Path $projectRoot "app_project\db-yunduan\cloud_desktop")
    $desktopCheckDirs += (Join-Path $projectRoot "app_project\db-offline\desktop")
}

foreach ($dir in $desktopCheckDirs) {
    if (Test-Path $dir) {
        $oldDists = Get-ChildItem $dir -Directory -Filter "dist_old_*" -ErrorAction SilentlyContinue
        foreach ($old in $oldDists) {
            Write-Host "  [WARN] 旧 dist 目录残留: $($old.Name)" -ForegroundColor Yellow
            Write-Host "         原因: 上次桌面打包 dist 被占用，重命名为 dist_old_*" -ForegroundColor DarkGray
            Remove-Item $old.FullName -Recurse -Force -ErrorAction SilentlyContinue
            Write-Host "         [OK] 已清理" -ForegroundColor Green
            $fixed++
        }
    }
}

# ---------------------------------------------------------------------------
# 5. 检查 .gradle\configuration-cache 残留（APP Gradle 缓存）
# capacitor-community-sqlite 的 annotationProcessors.json 缓存过期会导致编译失败
# 错误现象: package-aware-r.txt 缺失 / annotationProcessors.json stale
# ---------------------------------------------------------------------------
$appCheckDirs = @()
if ($AppDir -ne "" -and (Test-Path $AppDir)) {
    $appCheckDirs += $AppDir
} else {
    $appCheckDirs += (Join-Path $projectRoot "app_project\db-yunduan\cloud_app")
    $appCheckDirs += (Join-Path $projectRoot "app_project\db-offline\app\app")
}

foreach ($appDir in $appCheckDirs) {
    $configCache = Join-Path $appDir ".gradle\configuration-cache"
    if (Test-Path $configCache) {
        Write-Host "  [WARN] .gradle\configuration-cache 残留: $appDir" -ForegroundColor Yellow
        Write-Host "         原因: 上次 Gradle 构建中断，缓存可能损坏" -ForegroundColor DarkGray
        Write-Host "         风险: capacitor-community-sqlite 编译失败（package-aware-r.txt 缺失）" -ForegroundColor DarkGray
        Remove-Item $configCache -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "         [OK] 已清理" -ForegroundColor Green
        $fixed++
    }
}

# ---------------------------------------------------------------------------
# 6. 检查 Gradle daemon 残留进程
# 旧 daemon 占用内存和文件锁，可能导致下次构建 OOM 或文件冲突
# ---------------------------------------------------------------------------
$gradleJava = Get-Process java -ErrorAction SilentlyContinue | Where-Object {
    try {
        $_.MainWindowTitle -like "*gradle*" -or
        $_.Path -like "*gradle*" -or
        ($_.CommandLine -like "*gradle*" 2>$null)
    } catch { $false }
}
if ($gradleJava) {
    Write-Host "  [WARN] 检测到 Gradle daemon 残留进程 (PID: $($gradleJava.Id -join ', '))" -ForegroundColor Yellow
    Write-Host "         原因: 上次 Gradle 构建未正常退出" -ForegroundColor DarkGray
    Write-Host "         风险: 文件锁冲突 / 内存占用导致 R8 OOM" -ForegroundColor DarkGray
    $gradleJava | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
    Write-Host "         [OK] 已停止" -ForegroundColor Green
    $fixed++
}

# ---------------------------------------------------------------------------
# 总结
# ---------------------------------------------------------------------------
Write-Host ""
if ($fixed -gt 0) {
    Write-Host "[Pre-flight] 完成: 修复 $fixed 项残留" -ForegroundColor Green
    Write-Host "[Pre-flight] 上次打包可能非正常退出，已自动修复，继续打包..." -ForegroundColor Green
} else {
    Write-Host "[Pre-flight] 完成: 环境正常，无残留文件" -ForegroundColor Green
}
Write-Host ""

exit 0
