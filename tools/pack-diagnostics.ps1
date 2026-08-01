<#
.SYNOPSIS
    打包错误诊断器 - 自动识别打包失败原因并给出解决方案
.DESCRIPTION
    读取打包日志，匹配已知错误模式，输出错误分类 + 直接解决方案。
    用法：
    1. 打包失败后手动运行：.\tools\pack-diagnostics.ps1 -LogFile <日志路径>
    2. 从 stdin 读取：Get-Content log.txt | .\tools\pack-diagnostics.ps1
    3. 直接传文本：.\tools\pack-diagnostics.ps1 -LogText "错误文本"
.PARAMETER LogFile
    打包日志文件路径
.PARAMETER LogText
    直接传入错误文本
.EXAMPLE
    .\pack-diagnostics.ps1 -LogFile "D:\trae_projects\kyt-zy\pack-log.txt"
.EXAMPLE
    .\pack-diagnostics.ps1 -LogText "Cannot read properties of undefined (reading 'charAt')"
#>

param(
    [Parameter()]
    [string]$LogFile,
    [Parameter()]
    [string]$LogText
)

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# ============================================================================
# 错误模式库（与 docs/pack-issues-knowledge-base.md 对应）
# ============================================================================
$ErrorPatterns = @(
    # === SECURITY_OBFUSCATE（代码混淆）===
    @{
        Category = "SECURITY_OBFUSCATE"
        IssueId = "SECURITY_OBFUSCATE-001/003"
        Patterns = @("charAt", "reading 'charAt'", "Cannot read properties of undefined")
        Solution = "javascript-obfuscator stringArray 在 Electron 环境不稳定。解决：清空 tools/obfuscate.js 的 MODULE_FILES 数组，或移除报错文件。详见 docs/pack-issues-knowledge-base.md"
        Severity = "HIGH"
    },
    @{
        Category = "SECURITY_OBFUSCATE"
        IssueId = "SECURITY_OBFUSCATE-002"
        Patterns = @("RC4", "rc4", "decode failed")
        Solution = "RC4 解码在 Electron 环境失败。解决：改用 base64 编码或禁用 stringArray。详见 docs/pack-issues-knowledge-base.md"
        Severity = "HIGH"
    },
    # === SECURITY_ASARMOR（ASAR 防解包）===
    @{
        Category = "SECURITY_ASARMOR"
        IssueId = "SECURITY_ASARMOR-001"
        Patterns = @("asarmor", "asar", "100GB", "virtual file", "EPERM")
        Solution = "ASAR 防解包问题。检查 asarmor 配置和 afterPack.js。详见 docs/pack-issues-knowledge-base.md"
        Severity = "MEDIUM"
    },
    # === SECURITY_SIGN（签名）===
    @{
        Category = "SECURITY_SIGN"
        IssueId = "SECURITY_SIGN-001"
        Patterns = @("signtool", "certificate", "pfx", "签名失败", "unable to sign")
        Solution = "签名证书问题。当前 pfx 已删除，package.json 未配置 certificateFile。如需签名需重新生成 pfx。详见 docs/pack-issues-knowledge-base.md"
        Severity = "LOW"
    },
    # === BUILD_GRADLE（Android 编译）===
    @{
        Category = "BUILD_GRADLE"
        IssueId = "BUILD_GRADLE-001"
        Patterns = @("AAPT2", "aapt2", "daemon", "Failed to start AAPT2")
        Solution = "AAPT2 daemon 启动失败。清理 ~/.gradle/daemon/*/daemon*.bin，用 gradlew.bat --stop 优雅停止。详见 docs/pack-issues-knowledge-base.md"
        Severity = "HIGH"
    },
    @{
        Category = "BUILD_GRADLE"
        IssueId = "BUILD_GRADLE-002"
        Patterns = @("compileReleaseJavaWithJavac", "compile failed", "BUILD FAILED", "Task :app:")
        Solution = "Gradle 编译失败。检查 Java 代码语法、依赖、资源。离线版预编译失败会自动 obfuscate.js restore。详见 docs/pack-issues-knowledge-base.md"
        Severity = "HIGH"
    },
    # === BUILD_PATH（路径问题）===
    @{
        Category = "BUILD_PATH"
        IssueId = "BUILD_PATH-001"
        Patterns = @("prepare-win-unpacked", "package.json not found", "Cannot find module")
        Solution = "路径问题。检查 pack.ps1 中 prepare-win-unpacked.js 调用是否传入 DesktopDir（而非 VersionDir）。详见 docs/pack-issues-knowledge-base.md"
        Severity = "HIGH"
    },
    @{
        Category = "BUILD_PATH"
        IssueId = "BUILD_PATH-003"
        Patterns = @("无新文件", "apk not found", "APK 路径", "apkDir")
        Solution = "APK 路径问题。云端APP无 android 子目录，离线APP有。检查 APP_CONFIG 中的 apkDir 配置。详见 docs/pack-issues-knowledge-base.md"
        Severity = "MEDIUM"
    },
    @{
        Category = "BUILD_PATH"
        IssueId = "BUILD_PATH-004"
        Patterns = @("db-dingzhi", "db-geren", "路径不存在", "Path not found")
        Solution = "文件夹合并残留。db-dingzhi/db-geren 已合并为 db-offline。更新所有 tools/ 脚本路径引用。详见 docs/pack-issues-knowledge-base.md"
        Severity = "MEDIUM"
    },
    # === BUILD_ENCODING（编码/行尾）===
    @{
        Category = "BUILD_ENCODING"
        IssueId = "BUILD_ENCODING-001"
        Patterns = @("BOM", "乱码", "GBK", "编码错误", "无效字符")
        Solution = ".ps1 文件 BOM 丢失。运行 tools/fix-ps1-bom.ps1 自动修复。打包入口脚本已内置自动修复。详见 docs/pack-issues-knowledge-base.md"
        Severity = "MEDIUM"
    },
    @{
        Category = "BUILD_ENCODING"
        IssueId = "BUILD_ENCODING-002"
        Patterns = @("CRLF", "LF", "行尾", "cmd.exe", "闪退")
        Solution = ".bat 文件行尾问题。必须用 CRLF（非 LF）。中文注释改英文避免 GBK 问题。详见 docs/pack-issues-knowledge-base.md"
        Severity = "MEDIUM"
    },
    # === BUILD_VERSION（版本配置）===
    @{
        Category = "BUILD_VERSION"
        IssueId = "BUILD_VERSION-001"
        Patterns = @("versionCode", "versionName", "版本冲突", "version mismatch")
        Solution = "版本配置问题。打包失败需回滚 versionCode。检查 build-app.bat versionCode 自增与回滚逻辑。详见 docs/pack-issues-knowledge-base.md"
        Severity = "MEDIUM"
    },
    # === BUILD_CACHE（缓存问题）===
    @{
        Category = "BUILD_CACHE"
        IssueId = "BUILD_CACHE-001/002"
        Patterns = @("stale", "增量缓存", "旧代码", "缓存", "TCM_GRADLE_SKIP_CLEAN")
        Solution = "Gradle 增量缓存导致旧代码。强制 gradlew clean（已废弃 TCM_GRADLE_SKIP_CLEAN）。清理 javac/assets/merged_assets 缓存。详见 docs/pack-issues-knowledge-base.md"
        Severity = "HIGH"
    },
    # === BUILD_VERIFY（产物校验）===
    @{
        Category = "BUILD_VERIFY"
        IssueId = "BUILD_VERIFY-001"
        Patterns = @("hash mismatch", "hash 不匹配", "SHA256", "验证失败", "APK 内容")
        Solution = "产物校验失败。三层防护：①同步后 hash 校验 ②强制 clean ③APK 内容验证。检查根目录与 android 目录 index.html 是否一致。详见 docs/pack-issues-knowledge-base.md"
        Severity = "HIGH"
    },
    # === BUILD_DEPS（依赖/模块兼容）===
    @{
        Category = "BUILD_DEPS"
        IssueId = "BUILD_DEPS-001"
        Patterns = @("require is not defined", "__dirname is not defined", "ESM", "Cannot use import statement", "createRequire")
        Solution = "ESM 兼容问题。项目 package.json 设置 type:module。添加 import { createRequire } from 'module'; const require = createRequire(import.meta.url); 详见 docs/pack-issues-knowledge-base.md"
        Severity = "MEDIUM"
    },
    @{
        Category = "BUILD_DEPS"
        IssueId = "BUILD_DEPS-002"
        Patterns = @("npm install", "ENOTFOUND", "404", "npm ERR", "node_modules")
        Solution = "依赖安装失败。检查网络、npm registry。可使用共享缓存 tools/.npm-cache。详见 docs/pack-issues-knowledge-base.md"
        Severity = "MEDIUM"
    },
    # === BUILD_ELECTRON（Electron 打包）===
    @{
        Category = "BUILD_ELECTRON"
        IssueId = "BUILD_ELECTRON-001"
        Patterns = @("electron-builder", "NSIS", "asar unpack", "Cannot unpack")
        Solution = "Electron 打包问题。检查 electron-builder 配置、NSIS、asar 设置。详见 docs/pack-issues-knowledge-base.md"
        Severity = "MEDIUM"
    },
    @{
        Category = "BUILD_ELECTRON"
        IssueId = "BUILD_ELECTRON-002"
        Patterns = @("integrity", "baseline", "基线", "篡改", "完整性校验")
        Solution = "完整性校验问题。桌面版 version 固定，哈希不匹配会自动重建基线（正常）。异常 catch 块已改为阻止启动。详见 docs/pack-issues-knowledge-base.md"
        Severity = "LOW"
    },
    @{
        Category = "BUILD_ELECTRON"
        IssueId = "BUILD_ELECTRON-003"
        Patterns = @("@electron/get", "Cannot find module '@electron/get'", "electron install", "electron dist 缺失", "extract-zip")
        Solution = "@electron/get 包损坏或 install.js 解压不完整。pack.ps1 已修复：install.js 失败软失败走 .NET 回退解压（从 %LOCALAPPDATA%\electron\Cache 找 zip）。检查缓存是否有 electron-v<版本>-win32-x64.zip。详见 docs/pack-issues-knowledge-base.md"
        Severity = "HIGH"
    }
)

# ============================================================================
# 主逻辑
# ============================================================================

# 获取日志内容
$logContent = ""
if ($LogText) {
    $logContent = $LogText
} elseif ($LogFile) {
    if (-not (Test-Path $LogFile)) {
        Write-Host "[ERROR] 日志文件不存在: $LogFile" -ForegroundColor Red
        exit 1
    }
    $logContent = Get-Content $LogFile -Raw -ErrorAction SilentlyContinue
} else {
    # 从 stdin 读取
    $stdinText = $input -join "`n"
    if ($stdinText) { $logContent = $stdinText }
}

if (-not $logContent) {
    Write-Host "[USAGE] 用法：" -ForegroundColor Yellow
    Write-Host "  .\pack-diagnostics.ps1 -LogFile <日志路径>"
    Write-Host "  .\pack-diagnostics.ps1 -LogText `"错误文本`""
    Write-Host "  Get-Content log.txt | .\pack-diagnostics.ps1"
    Write-Host ""
    Write-Host "[INFO] 也可直接查看经验库: docs/pack-issues-knowledge-base.md"
    exit 0
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  打包错误诊断报告" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$matchedIssues = @()
$unmatchedLines = @()

foreach ($pattern in $ErrorPatterns) {
    foreach ($p in $pattern.Patterns) {
        if ($logContent -match [regex]::Escape($p)) {
            $matchedIssues += $pattern
            break
        }
    }
}

if ($matchedIssues.Count -eq 0) {
    Write-Host "[RESULT] 未匹配已知错误模式" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "[SUGGEST] 建议：" -ForegroundColor Yellow
    Write-Host "  1. 查看完整日志定位错误关键词"
    Write-Host "  2. 查阅经验库: docs/pack-issues-knowledge-base.md"
    Write-Host "  3. 将新问题追加到经验库对应分类"
    exit 0
}

# 去重（同分类只显示一次）
$seenCategories = @{}
$uniqueIssues = @()
foreach ($issue in $matchedIssues) {
    if (-not $seenCategories.ContainsKey($issue.Category)) {
        $seenCategories[$issue.Category] = $true
        $uniqueIssues += $issue
    }
}

Write-Host "[RESULT] 匹配到 $($uniqueIssues.Count) 个已知问题：" -ForegroundColor Green
Write-Host ""

foreach ($issue in $uniqueIssues) {
    $severityColor = if ($issue.Severity -eq "HIGH") { "Red" }
                     elseif ($issue.Severity -eq "MEDIUM") { "Yellow" }
                     else { "Cyan" }
    Write-Host "  [$($issue.Severity)] $($issue.Category) ($($issue.IssueId))" -ForegroundColor $severityColor
    Write-Host "  解决方案: $($issue.Solution)" -ForegroundColor White
    Write-Host ""
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  详见: docs/pack-issues-knowledge-base.md" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
