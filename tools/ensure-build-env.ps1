# ============================================================================
# ensure-build-env.ps1 - 打包环境统一预检（P0：合并 7+2 套散脚本入口）
#
# ★ 目的：修复"4 个打包入口各自零散调用预检脚本，存在大量漏跑/错序/参数陷阱"的工程缺陷。
# 原调用散点：fix-ps1-bom / verify-packaging / verify-version-display /
#   verify-app-version-consistency / verify-no-hardcoded-clinic /
#   pre-build-check.js / pre-flight-check.ps1 / 磁盘空间检查 / .gitattributes renormalize
# 现在合并为 8 步统一门禁，严格按"越早 fail-fast 越靠前"顺序执行。
#
# 用法 (powershell -NoProfile -ExecutionPolicy Bypass -File ensure-build-env.ps1 ...)：
#   -Target            必选: cloud-desktop | offline-desktop | cloud-app | offline-app
#   -DesktopDir        桌面 Target 必选（如 "%~dp0"）；脚本内部自动 Trim 引号/尾反斜杠 (五十一)
#   -AppDir            APP   Target 必选；脚本内部自动 Trim 引号/尾反斜杠
#   -RepoRoot          可选，默认自动向上查找含 .git 的目录
#   -MinDiskSpaceGB    可选，默认 1.0；APP 端建议在调用点传 5.0
#   -SkipBomFix        不修复 BOM，仅校验（缺 BOM 直接 FAIL）
#   -SkipRenormalizeGit 跳过 .gitattributes renormalize（CI / 调试 / 无 git 环境）
#
# 退出码：0 = 全通过（WARN 不阻塞，符合分级原则）
#         1 = 至少 1 项 FAIL（脚本底部会打印修复指引）
# ============================================================================
param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('cloud-desktop','offline-desktop','cloud-app','offline-app')]
    [string]$Target,
    [string]$DesktopDir = "",
    [string]$AppDir     = "",
    [string]$RepoRoot   = "",
    [double]$MinDiskSpaceGB = 1.0,
    [switch]$SkipBomFix,
    [switch]$SkipRenormalizeGit
)

# ----------------------------------------------------------------------------
# [Step 0] 初始化 & 参数规范化 (记忆 51: CMD %~dp0 尾部 \" 转义陷阱)
# ----------------------------------------------------------------------------
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# 参数规范化：去除首尾引号 + 尾反斜杠，防止 Test-Path / Join-Path 报 Illegal characters
$DesktopDir = ($DesktopDir.Trim('"')).TrimEnd('\')
$AppDir     = ($AppDir.Trim('"')).TrimEnd('\')

# 定位 RepoRoot（向上找含 .git 目录）
if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $p = Split-Path $MyInvocation.MyCommand.Path -Parent
    while ($p -and -not (Test-Path (Join-Path $p '.git'))) { $p = Split-Path $p -Parent }
    if (-not $p) { $p = Split-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) -Parent }
    $RepoRoot = $p
}
$RepoRoot = $RepoRoot.TrimEnd('\')
$ToolsDir = Join-Path $RepoRoot 'tools'

# 派生 Target 组别
$IsDesktop  = $Target -like '*-desktop'
$IsApp      = $Target -like '*-app'
$IsCloud    = $Target -like 'cloud-*'
$Edition    = if ($IsCloud) { 'cloud' } else { 'dingzhi' }   # 与 pre-flight-check / obfuscate 里 Target 定义对齐

# 统一步骤状态表（便于汇总输出，不区分步骤真实顺序只按 id）
$script:Steps   = New-Object System.Collections.ArrayList
$script:TotalOk = 0
$script:TotalFail = 0
$script:TotalWarn = 0
$script:AllFailures = New-Object System.Collections.ArrayList
$script:AllWarnings = New-Object System.Collections.ArrayList

function Register-Step($id, $name) {
    [void]$script:Steps.Add([PSCustomObject]@{
        Id       = $id
        Name     = $name
        Status   = 'RUNNING'
        Failures = New-Object System.Collections.ArrayList
        Warnings = New-Object System.Collections.ArrayList
        Duration = $null
        StartTs  = Get-Date
    })
    Write-Host ""
    Write-Host ("[{0}/8] {1}" -f $id, $name) -ForegroundColor Cyan
    Write-Host ("-" * 60) -ForegroundColor DarkGray
}
function Finish-Step($id, $ok = $true) {
    $step = $script:Steps | Where-Object { $_.Id -eq $id } | Select-Object -First 1
    if (-not $step) { return }
    $step.Status   = if ($ok) { 'OK' } else { 'FAIL' }
    $step.Duration = [math]::Round(((Get-Date) - $step.StartTs).TotalSeconds, 1)
    foreach ($f in $step.Failures) { [void]$script:AllFailures.Add($f); $script:TotalFail++ }
    foreach ($w in $step.Warnings) { [void]$script:AllWarnings.Add($w); $script:TotalWarn++ }
    if ($ok) {
        $script:TotalOk++
        Write-Host ("  [PASS] step {0} in {1}s" -f $id, $step.Duration) -ForegroundColor Green
    } else {
        Write-Host ("  [FAIL] step {0} in {1}s  (failures={2}, warns={3})" -f $id, $step.Duration, $step.Failures.Count, $step.Warnings.Count) -ForegroundColor Red
    }
}
function Add-StepFailure($id, $msg) {
    $step = $script:Steps | Where-Object { $_.Id -eq $id } | Select-Object -First 1
    if ($step) { [void]$step.Failures.Add($msg) }
    Write-Host ("  [FAIL] " + $msg) -ForegroundColor Red
}
function Add-StepWarning($id, $msg) {
    $step = $script:Steps | Where-Object { $_.Id -eq $id } | Select-Object -First 1
    if ($step) { [void]$step.Warnings.Add($msg) }
    Write-Host ("  [WARN] " + $msg) -ForegroundColor Yellow
}
function Write-MsgOk($msg) { Write-Host ("  [OK]   " + $msg) -ForegroundColor Green }
function Write-MsgSkip($msg) { Write-Host ("  [SKIP] " + $msg) -ForegroundColor DarkGray }

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ("  ensure-build-env  ::  Target = {0}" -f $Target) -ForegroundColor Cyan
Write-Host ("                    RepoRoot = {0}" -f $RepoRoot) -ForegroundColor DarkGray
Write-Host ("                    Desktop  = {0}" -f $(if ($DesktopDir) { $DesktopDir } else { "(n/a)" })) -ForegroundColor DarkGray
Write-Host ("                    AppDir   = {0}" -f $(if ($AppDir)     { $AppDir }     else { "(n/a)" })) -ForegroundColor DarkGray
Write-Host ("                    MinDisk  = {0} GB" -f $MinDiskSpaceGB) -ForegroundColor DarkGray
Write-Host "============================================================" -ForegroundColor Cyan

# ----------------------------------------------------------------------------
# 公共帮助：Test-HasBom / EnsureUtf8Bom / StripHtmlBom
# ----------------------------------------------------------------------------
function Test-HasBom([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    return ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
}
function EnsureUtf8Bom([string]$Path) {
    $utf8Bom = New-Object System.Text.UTF8Encoding($true)
    $content = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    [System.IO.File]::WriteAllText($Path, $content, $utf8Bom)
}
function StripHtmlBom([string]$Path) {
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    # 剥掉头部 BOM，其余原样写回
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        $rest = New-Object byte[] ($bytes.Length - 3)
        [Array]::Copy($bytes, 3, $rest, 0, $rest.Length)
        [System.IO.File]::WriteAllBytes($Path, $rest)
    }
}

# ----------------------------------------------------------------------------
# [Step 1] Git LF/CRLF renormalize + 清陈旧索引 (记忆 42)
#   - 仅在仓库根存在 .gitattributes 时执行
#   - reset --mixed HEAD 清陈旧索引
#   - add -u --renormalize 验证 .gitattributes 生效（不 commit）
#   - 最后再次 reset --mixed HEAD 避免把假改动留在 staged
# ----------------------------------------------------------------------------
Register-Step 1 "Git LF/CRLF renormalize (清陈旧索引，杜绝 LF/CRLF 假改动)"

$gitAttrs = Join-Path $RepoRoot '.gitattributes'
$gitDir   = Join-Path $RepoRoot '.git'

if ($SkipRenormalizeGit) {
    Write-MsgSkip "-SkipRenormalizeGit 指定，跳过 Git renormalize"
    Finish-Step 1 $true
} elseif (-not (Test-Path -LiteralPath $gitAttrs) -or -not (Test-Path -LiteralPath $gitDir)) {
    Add-StepWarning 1 ".gitattributes 或 .git 不存在，跳过 Git renormalize（不影响打包）"
    Finish-Step 1 $true
} else {
    Push-Location $RepoRoot
    try {
        # 1a: 先验证 git 命令可用
        $null = & git --version 2>$null
        if ($LASTEXITCODE -ne 0) {
            Add-StepWarning 1 "git 命令不在 PATH，跳过 renormalize"
            Finish-Step 1 $true
        } else {
            # 1b: reset --mixed HEAD（清陈旧索引，不改工作区）
            & git reset --mixed HEAD *>&1 | ForEach-Object { Write-Host ("         " + $_) -ForegroundColor DarkGray }
            if ($LASTEXITCODE -ne 0) {
                Add-StepWarning 1 "git reset --mixed HEAD 未返回 0（不阻塞，继续）"
            }
            # 1c: add -u --renormalize（按 .gitattributes 重算 index）
            & git add -u --renormalize *>&1 | ForEach-Object { Write-Host ("         " + $_) -ForegroundColor DarkGray }
            if ($LASTEXITCODE -ne 0) {
                Add-StepWarning 1 "git add -u --renormalize 返回非 0（.gitattributes 可能规则冲突？不阻塞）"
            }
            # 1d: 再 reset 清空 staged，确保打包脚本最后 git add 只会抓到真实改动
            & git reset --mixed HEAD *>&1 | ForEach-Object { Write-Host ("         " + $_) -ForegroundColor DarkGray }
            if ($LASTEXITCODE -eq 0) {
                Write-MsgOk "Git index renormalize 完成（staged 已清空，工作区未变）"
            } else {
                Add-StepWarning 1 "第 2 次 reset 返回非 0，不阻塞"
            }
            Finish-Step 1 $true
        }
    } catch {
        Add-StepWarning 1 ("git 命令异常: " + $_.Exception.Message + "（不阻塞打包）")
        Finish-Step 1 $true
    } finally {
        Pop-Location
    }
}

# ----------------------------------------------------------------------------
# [Step 1.5] 源码落定门（★ 2026-08-31 事故根因防呆：杜绝打包半成品代码）
#   事故复盘：用户在 AI 修改源码进行中双击打包 → exe 静默装走"当时磁盘状态"
#   （1.2.194 实测缺当日 CSP/userType 修复）。现有全部铁闸只验"产物内部
#   一致"（版本号/架构标记/签名/asar 完整性），没有任何一环验"打包起点
#   是否落定"——本门补齐这一环：git 工作区存在未提交修改 = 打包会装走
#   无法追溯的中间状态 → FAIL 阻断。
#   白名单（不拦）：package.json / build-meta.json（打包自身 bump 版本会改，
#   连续二次打包必脏属正常）；未跟踪文件 ??（dist/build_output 等产物）；
#   build.gradle 纯 versionCode/versionName 行变化（APP 打包自身 bump）。
#   保险丝：ALLOW_DIRTY_BUILD=1 降级 WARN（确要打包未提交状态时自负其责）。
# ----------------------------------------------------------------------------
Register-Step 1.5 "源码落定门 (未提交修改检测 → 杜绝打包半成品代码)"

# ★ 2026-08-31 收敛为单一权威源：检测逻辑在 tools/source-settled.ps1
#   （本门 + release-menu + one-click-pack 三处共用；白名单含 build.gradle
#   versionCode/versionName 纯版本递增——APP 打包自身 bump 误拦事故修复）
. (Join-Path $PSScriptRoot 'source-settled.ps1')

if ($env:ALLOW_DIRTY_BUILD -eq '1') {
    Add-StepWarning 1.5 "ALLOW_DIRTY_BUILD=1 保险丝生效，跳过未提交修改检测（紧急/自负其责用途）"
    Finish-Step 1.5 $true
} elseif (-not (Test-Path -LiteralPath $gitDir)) {
    Add-StepWarning 1.5 ".git 不存在（非仓库环境），跳过源码落定检测"
    Finish-Step 1.5 $true
} else {
    $blockers = @(Get-SourceSettledBlockers -RepoRoot $RepoRoot)
    if ($blockers.Count -gt 0) {
        Add-StepFailure 1.5 ("检测到 {0} 个未提交的源码修改 —— 现在打包会把『半成品』代码装进安装包" -f $blockers.Count)
        Write-Host "  ── 2026-08-31 事故防呆门：当日 1.2.194 打包静默缺当日修复的根因 ──" -ForegroundColor Yellow
        $blockers | Select-Object -First 20 | ForEach-Object { Write-Host ("    " + $_) -ForegroundColor Yellow }
        if ($blockers.Count -gt 20) { Write-Host ("    ... 其余 {0} 个文件" -f ($blockers.Count - 20)) -ForegroundColor Yellow }
        Write-Host "  正确做法（按序选一）：" -ForegroundColor Yellow
        Write-Host "    ① AI 还在修改中 → 等它改完并 commit 后重新打包（推荐）" -ForegroundColor Yellow
        Write-Host "    ② 自己手动改的 → git add -A ; git commit -m '...' 后再打包" -ForegroundColor Yellow
        Write-Host "    ③ 确认就要打包当前状态 → set ALLOW_DIRTY_BUILD=1 后重跑（产物不可追溯）" -ForegroundColor Yellow
        Finish-Step 1.5 $false
    } else {
        Write-MsgOk "源码已落定：无未提交修改（版本文件/未跟踪产物除外），打包起点可信"
        Finish-Step 1.5 $true
    }
}

# ----------------------------------------------------------------------------
# [Step 2] UTF-8 BOM 修复（1:1 等价 fix-ps1-bom + verify-packaging Check 1/2/4）
#   规则：
#     .ps1 必须有 BOM（缺则修复，-SkipBomFix 时 FAIL）
#     index.html 必须无 BOM（有则剥离，-SkipBomFix 时 FAIL）
#     .gradle 必须无 BOM（有则剥离，-SkipBomFix 时 FAIL）
# ----------------------------------------------------------------------------
Register-Step 2 "UTF-8 BOM 规范化 (.ps1 必须有 / .html & .gradle 必须无)"

$allPs1 = @()
$allPs1 += Get-ChildItem -Path (Join-Path $RepoRoot 'app_project') -Recurse -Filter '*.ps1' -File -ErrorAction SilentlyContinue
$allPs1 += Get-ChildItem -Path (Join-Path $RepoRoot 'tools')       -Recurse -Filter '*.ps1' -File -ErrorAction SilentlyContinue
$allPs1 += Get-ChildItem -Path $RepoRoot -Filter '*.ps1' -File -ErrorAction SilentlyContinue
$allPs1 = $allPs1 | Where-Object { $_.FullName -notmatch '\\node_modules\\|\\\.eb-cache\\' -and $_.FullName -notmatch 'tools\\\.eb-cache' }

$bomFixedCount = 0
foreach ($f in $allPs1) {
    $rel = $f.FullName.Substring($RepoRoot.Length + 1)
    if (Test-HasBom $f.FullName) {
        # Write-MsgOk (".ps1 BOM OK: $rel")   # 全部 OK 会刷屏太多，只报异常
    } else {
        if ($SkipBomFix) {
            Add-StepFailure 2 (".ps1 缺少 UTF-8 BOM（PowerShell 5.x 会 GBK 解码乱码）: $rel  修复: powershell -File tools/fix-ps1-bom.ps1")
        } else {
            try {
                EnsureUtf8Bom $f.FullName
                $bomFixedCount++
                Add-StepWarning 2 (".ps1 缺少 UTF-8 BOM，已自动修复: $rel")
            } catch {
                Add-StepFailure 2 (".ps1 缺少 UTF-8 BOM，修复失败: $rel  ($($_.Exception.Message))")
            }
        }
    }
}

# index.html 不能有 BOM（白屏风险）—— 扫描目标与 verify-packaging 完全一致：
$htmlTargets = @(
    'app_project\db-offline\desktop\index.html',
    'app_project\db-offline\app\app\src\main\assets\public\index.html',
    'public\index.html',
    'app_project\db-yunduan\cloud_desktop\index.html',
    'app_project\db-yunduan\cloud_app\app\src\main\assets\public\index.html'
)
foreach ($rel in $htmlTargets) {
    $full = Join-Path $RepoRoot $rel
    if (-not (Test-Path -LiteralPath $full)) { continue }
    if (Test-HasBom $full) {
        if ($SkipBomFix) {
            Add-StepFailure 2 ("index.html 含 BOM（会导致白屏 DOCTYPE 异常）: $rel  修复: 手动以无 BOM UTF-8 保存或使用 strip-html-bom 工具")
        } else {
            try {
                StripHtmlBom $full
                Add-StepWarning 2 ("index.html 含 BOM，已自动剥离: $rel")
            } catch {
                Add-StepFailure 2 ("index.html 含 BOM，剥离失败: $rel  ($($_.Exception.Message))")
            }
        }
    }
}

# .gradle 不能有 BOM（Gradle warning）—— 扫描 app_project 下所有 .gradle 文件，与 verify-packaging 原则一致
$gradleFiles = @()
$gradleFiles += Get-ChildItem -Path (Join-Path $RepoRoot 'app_project') -Recurse -Filter '*.gradle' -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '\\node_modules\\|\\build\\|\\\.gradle\\' }
foreach ($f in $gradleFiles) {
    $rel = $f.FullName.Substring($RepoRoot.Length + 1)
    if (Test-HasBom $f.FullName) {
        if ($SkipBomFix) {
            Add-StepFailure 2 (".gradle 含 BOM（Gradle warning）: $rel")
        } else {
            try {
                StripHtmlBom $f.FullName
                Add-StepWarning 2 (".gradle 含 BOM，已自动剥离: $rel")
            } catch {
                Add-StepFailure 2 (".gradle 含 BOM，剥离失败: $rel  ($($_.Exception.Message))")
            }
        }
    }
}

if ($bomFixedCount -gt 0) { Write-MsgOk ("已为 " + $bomFixedCount + " 个 .ps1 补回 UTF-8 BOM") }

Finish-Step 2 $(($script:Steps | Where-Object { $_.Id -eq 2 } | Select-Object -First 1).Failures.Count -eq 0)

# ----------------------------------------------------------------------------
# [Step 3] .bat 编码校验 (1:1 等价 verify-packaging Check 3)
#   规则：.bat 必须为 ASCII-only   OR
#         合法 UTF-8 且文件内包含 "chcp 65001"   OR
#         合法 GBK/ANSI（cmd 默认代码页能显示中文）
# ----------------------------------------------------------------------------
Register-Step 3 ".bat 编码校验 (ASCII-only / UTF-8+chcp65001 / GBK-ANSI)"

$batFiles = New-Object System.Collections.ArrayList
$appProjBat = Get-ChildItem -Path (Join-Path $RepoRoot 'app_project') -Recurse -Filter '*.bat' -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '\\node_modules\\|\\build\\|\\dist\\|\\intermediates\\' -and $_.Name -ne 'gradlew.bat' }
foreach ($f in $appProjBat) { [void]$batFiles.Add($f) }
$toolsBat = Get-ChildItem -Path (Join-Path $RepoRoot 'tools') -Recurse -Filter '*.bat' -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '\\node_modules\\|\\\.eb-cache\\|\\build\\|\\dist\\' }
foreach ($f in $toolsBat) { [void]$batFiles.Add($f) }
$rootBat = Get-ChildItem -Path $RepoRoot -Filter '*.bat' -File -ErrorAction SilentlyContinue
foreach ($f in $rootBat) { [void]$batFiles.Add($f) }

$strictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
$gbkEnc     = [System.Text.Encoding]::GetEncoding(936, [System.Text.EncoderFallback]::ExceptionFallback, [System.Text.DecoderFallback]::ExceptionFallback)

foreach ($f in $batFiles) {
    $rel = $f.FullName.Substring($RepoRoot.Length + 1)
    $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
    $nonAscii = @($bytes | Where-Object { $_ -gt 127 })

    if (-not $nonAscii) {
        # Write-MsgOk ("ASCII-only: $rel")
        continue
    }

    $utf8Ok = $false; $text = $null
    try { $text = $strictUtf8.GetString($bytes); $utf8Ok = $true } catch { $utf8Ok = $false }

    if ($utf8Ok) {
        if ($text -match 'chcp\s+65001') {
            # Write-MsgOk ("UTF-8 + chcp 65001: $rel")
        } else {
            Add-StepFailure 3 ("UTF-8 .bat 缺少 chcp 65001，CMD GBK 代码页下中文乱码: $rel  修复: 文件顶部添加 chcp 65001 >nul")
        }
    } else {
        try {
            $null = $gbkEnc.GetString($bytes)
            # Write-MsgOk ("GBK/ANSI: $rel")
        } catch {
            Add-StepFailure 3 (".bat 编码未知（既非合法 UTF-8 也非合法 GBK），共 $($nonAscii.Count) 个非 ASCII 字节: $rel")
        }
    }
}

# ---- 工作区 .bat/.cmd 强制 CRLF（记忆 49 根因：工具直写盘产生 LF，cmd 解析含中文批处理必坏）----
# 只就地改写行尾（内容不变，git 归一化后不产生内容 diff），保证每次打包前批处理都可用
$utf8NoBom    = New-Object System.Text.UTF8Encoding($false)
$lfFixedCount = 0
foreach ($f in $batFiles) {
    $bytes  = [System.IO.File]::ReadAllBytes($f.FullName)
    $hasLoneLf = $false
    for ($i = 0; $i -lt $bytes.Length; $i++) {
        if ($bytes[$i] -eq 0x0A -and ($i -eq 0 -or $bytes[$i - 1] -ne 0x0D)) { $hasLoneLf = $true; break }
    }
    if (-not $hasLoneLf) { continue }
    $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
    if ($hasBom) {
        $text = [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
    } else {
        try { $text = $strictUtf8.GetString($bytes) } catch { $text = $gbkEnc.GetString($bytes) }
    }
    $text = [regex]::Replace($text, "(?<!\r)\n", "`r`n")
    $enc  = if ($hasBom) { New-Object System.Text.UTF8Encoding($true) } else { $utf8NoBom }
    [System.IO.File]::WriteAllText($f.FullName, $text, $enc)
    $lfFixedCount++
    Write-Host ("  [FIX] 批处理已强制 CRLF（cmd 兼容）: " + $f.FullName.Substring($RepoRoot.Length + 1)) -ForegroundColor Yellow
}
if ($lfFixedCount -gt 0) {
    Write-Host ("  [WARN] 已修复 $lfFixedCount 个 .bat/.cmd 行尾为 CRLF（行尾归一化不产生内容 diff，重新 git add 即可）") -ForegroundColor Yellow
}

# 额外复用 verify-packaging 里 Check 4：调用 check-index-consistency.ps1（云端 index.html 副本一致性，非阻断 fail+1，否则 pass+1）
$checkIdxCons = Join-Path $ToolsDir 'check-index-consistency.ps1'
if (Test-Path -LiteralPath $checkIdxCons) {
    Push-Location $RepoRoot
    try {
        & powershell -NoProfile -ExecutionPolicy Bypass -File $checkIdxCons *>&1 | ForEach-Object { Write-Host ("         " + $_) -ForegroundColor DarkGray }
        if ($LASTEXITCODE -eq 0) {
            Write-MsgOk "云端 index.html 副本逻辑一致性（check-index-consistency）通过"
        } else {
            Add-StepFailure 3 "云端 index.html 副本逻辑不一致，请修复后重新打包（check-index-consistency 返回非 0）"
        }
    } catch {
        Add-StepFailure 3 ("check-index-consistency 调用异常: " + $_.Exception.Message)
    } finally {
        Pop-Location
    }
}

Finish-Step 3 $(($script:Steps | Where-Object { $_.Id -eq 3 } | Select-Object -First 1).Failures.Count -eq 0)

# ----------------------------------------------------------------------------
# [Step 4] 版本身份 & 版本号 门禁
#   4a. verify-no-hardcoded-clinic (所有 Target 都跑)
#   4b. verify-version-display (8 处版本 V token 一致性，所有 Target 都跑)
#   4c. verify-app-version-consistency (按 Target 决定 -Target cloud|offline)
#   4d. 桌面 Target → 内嵌 pre-build-check.js 的"版本标签身份校验"段（APP 不适用）
# 注：4a/4b/4c 不做逻辑改写，直接子进程调用（1:1 等价，风险最低）
# ----------------------------------------------------------------------------
Register-Step 4 "版本身份 & 版本号 门禁 (反模式扫描 / 8处版本展示 / 三要素一致性 / 标签身份)"

# --- 4a: 诊所名/医师名硬编码反模式 ---
$script_hc = Join-Path $ToolsDir 'verify-no-hardcoded-clinic.ps1'
if (Test-Path -LiteralPath $script_hc) {
    Push-Location $RepoRoot
    try {
        & powershell -NoProfile -ExecutionPolicy Bypass -File $script_hc -RepoRoot $RepoRoot *>&1 | ForEach-Object { Write-Host ("         " + $_) -ForegroundColor DarkGray }
        if ($LASTEXITCODE -ne 0) { Add-StepFailure 4 "诊所名/医师名硬编码反模式扫描 FAIL（verify-no-hardcoded-clinic 返回非 0）。修复指引见上方输出。" }
    } catch {
        Add-StepFailure 4 ("verify-no-hardcoded-clinic 调用异常: " + $_.Exception.Message)
    } finally { Pop-Location }
} else { Add-StepWarning 4 "缺失脚本 verify-no-hardcoded-clinic.ps1，跳过 4a" }

# --- 4b: 8 处版本展示一致性 ---
$script_vd = Join-Path $ToolsDir 'verify-version-display.ps1'
if (Test-Path -LiteralPath $script_vd) {
    Push-Location $RepoRoot
    try {
        & powershell -NoProfile -ExecutionPolicy Bypass -File $script_vd *>&1 | ForEach-Object { Write-Host ("         " + $_) -ForegroundColor DarkGray }
        if ($LASTEXITCODE -ne 0) { Add-StepFailure 4 "版本展示 8 处标识不一致 FAIL（verify-version-display 返回非 0）。修复指引见上方输出。" }
    } catch {
        Add-StepFailure 4 ("verify-version-display 调用异常: " + $_.Exception.Message)
    } finally { Pop-Location }
} else { Add-StepWarning 4 "缺失脚本 verify-version-display.ps1，跳过 4b" }

# --- 4c: 版本号三要素/两要素一致性 ---
$script_vc = Join-Path $ToolsDir 'verify-app-version-consistency.ps1'
$vcTarget = if ($IsCloud) { 'cloud' } else { 'offline' }
if (Test-Path -LiteralPath $script_vc) {
    Push-Location $RepoRoot
    try {
        & powershell -NoProfile -ExecutionPolicy Bypass -File $script_vc -Target $vcTarget -RepoRoot $RepoRoot *>&1 | ForEach-Object { Write-Host ("         " + $_) -ForegroundColor DarkGray }
        if ($LASTEXITCODE -ne 0) { Add-StepFailure 4 "版本号三要素/两要素一致性 FAIL（verify-app-version-consistency -Target $vcTarget 返回非 0）。修复指引见上方输出。" }
    } catch {
        Add-StepFailure 4 ("verify-app-version-consistency 调用异常: " + $_.Exception.Message)
    } finally { Pop-Location }
} else { Add-StepWarning 4 "缺失脚本 verify-app-version-consistency.ps1，跳过 4c" }

# --- 4d: 桌面 Target → 版本标签身份校验（1:1 搬运 pre-build-check.js L208-254 逻辑） ---
if ($IsDesktop) {
    if (-not (Test-Path -LiteralPath $DesktopDir)) {
        Add-StepFailure 4 ("DesktopDir 不存在，无法做 4d 版本标签身份校验: " + $DesktopDir)
    } else {
        $idxPath = Join-Path $DesktopDir 'index.html'
        if (-not (Test-Path -LiteralPath $idxPath)) {
            Add-StepFailure 4 ("桌面 index.html 不存在，无法做 4d 版本标签身份校验: " + $idxPath)
        } else {
            try {
                $html = Get-Content -LiteralPath $idxPath -Raw -Encoding UTF8
                $htmlTitle   = ([regex]::Match($html, '<title>([^<]*)</title>', 'IgnoreCase')).Groups[1].Value
                $hasOfflineProd = [regex]::IsMatch($html, "window\.PRODUCT_NAME\s*=\s*'惠康中医-本地'")
                $hasCloudProd   = [regex]::IsMatch($html, "window\.PRODUCT_NAME\s*=\s*'惠康中医-云端'")
                $hasCloudConfig = [regex]::IsMatch($html, "productName:\s*'惠康中医-云端'")
                $appModeMatch   = [regex]::Match($html, "window\.APP_MODE\s*=\s*'([^']+)'")
                $appMode = if ($appModeMatch.Success) { $appModeMatch.Groups[1].Value } else { '' }
                $errors = @()

                if ($IsCloud) {
                    if ($hasOfflineProd) { $errors += '发现离线身份硬编码 window.PRODUCT_NAME=惠康中医-本地（云端桌面必须为 惠康中医-云端）' }
                    if (-not $hasCloudProd -and -not $hasCloudConfig) { $errors += '缺少云端产品名（window.PRODUCT_NAME=惠康中医-云端 / CONFIG.productName=惠康中医-云端）' }
                    if ($appMode -and $appMode -ne 'cloud') { $errors += "window.APP_MODE 不是 cloud（当前=$appMode），云端桌面必须为 cloud" }
                    if ([regex]::IsMatch($htmlTitle, '标准版|机构版') -and $htmlTitle.IndexOf('云端') -lt 0) { $errors += "<title> 含版式标签但缺「云端」前缀（当前=""$htmlTitle""），应如 惠康中医-云端标准版/机构版" }
                } else {
                    if ($hasCloudProd)   { $errors += '发现云端身份硬编码 window.PRODUCT_NAME=惠康中医-云端（离线桌面必须为 惠康中医-本地）' }
                    if (-not $hasOfflineProd) { $errors += '缺少离线产品名 hardcode（window.PRODUCT_NAME=惠康中医-本地）' }
                    if ($appMode -and $appMode -ne 'offline') { $errors += "window.APP_MODE 不是 offline（当前=$appMode），离线桌面必须为 offline" }
                }

                if ($errors.Count -gt 0) {
                    foreach ($e in $errors) { Add-StepFailure 4 ("4d 版本标签身份: " + $e) }
                    Add-StepFailure 4 "修复指引: 修正 $idxPath 中的 window.PRODUCT_NAME / APP_MODE / <title> 后再打包"
                } else {
                    Write-MsgOk ("4d 版本标签身份校验通过（{0} 桌面）" -f $(if ($IsCloud) { '云端' } else { '离线' }))
                }
            } catch {
                Add-StepFailure 4 ("4d 版本标签身份校验异常: " + $_.Exception.Message)
            }
        }
    }
} else {
    Write-MsgSkip "4d 版本标签身份校验只适用于桌面 Target，当前 APP Target 跳过"
}

Finish-Step 4 $(($script:Steps | Where-Object { $_.Id -eq 4 } | Select-Object -First 1).Failures.Count -eq 0)

# ----------------------------------------------------------------------------
# [Step 5] 包完整性门禁
#   桌面 Target → 直接调 node pre-build-check.js <DesktopDir>（1:1 等价）
#     注：虽然 4d 已搬运了"版本标签身份"段，但 pre-build-check.js 还有 package.files 覆盖/磁盘存在/IPC 一致性，
#     必须整段保留，不做精简（避免丢检查项）。
#   APP   Target → APP 资源存在性 quick-check (signing.properties / jks / capacitor.config / gradlew)
# ----------------------------------------------------------------------------
Register-Step 5 "包完整性门禁 (桌面=pre-build-check 全项；APP=资源存在性 quick-check)"

if ($IsDesktop) {
    $preBuildJs = Join-Path $ToolsDir 'pre-build-check.js'
    if (-not (Test-Path -LiteralPath $preBuildJs)) {
        Add-StepFailure 5 "缺失脚本 tools/pre-build-check.js"
    } elseif (-not (Test-Path -LiteralPath $DesktopDir)) {
        Add-StepFailure 5 ("DesktopDir 不存在: " + $DesktopDir)
    } else {
        Push-Location $RepoRoot
        try {
            & node $preBuildJs $DesktopDir *>&1 | ForEach-Object { Write-Host ("         " + $_) -ForegroundColor DarkGray }
            if ($LASTEXITCODE -ne 0) { Add-StepFailure 5 "pre-build-check.js 返回非 0（package.files 缺失 / IPC 不一致 / 磁盘条目无命中）。修复指引见上方输出。" }
        } catch {
            Add-StepFailure 5 ("pre-build-check.js 调用异常: " + $_.Exception.Message)
        } finally { Pop-Location }
    }
} else {
    # APP 资源存在性 quick-check（APP build-app.bat 里原本就单独写的，纳入统一门禁 FAIL=0 才放行）
    if (-not (Test-Path -LiteralPath $AppDir)) {
        Add-StepFailure 5 ("AppDir 不存在: " + $AppDir)
    } else {
        $gradlewBat   = Join-Path $AppDir 'gradlew.bat'
        $signProps    = Join-Path $AppDir 'app\signing.properties'
        $signJks      = Join-Path $AppDir 'app\app-release.jks'
        $capConfig    = Join-Path $AppDir 'app\src\main\assets\capacitor.config.json'

        foreach ($check in @(
            @('gradlew.bat',                $gradlewBat),
            @('app/signing.properties',     $signProps),
            @('app/app-release.jks',        $signJks),
            @('capacitor.config.json',      $capConfig)
        )) {
            $label = $check[0]; $path = $check[1]
            if (Test-Path -LiteralPath $path) { Write-MsgOk ("APP resource: {0}" -f $label) }
            else                              { Add-StepFailure 5 ("APP resource 缺失: {0} (期望路径: {1})" -f $label, $path) }
        }
    }
}

Finish-Step 5 $(($script:Steps | Where-Object { $_.Id -eq 5 } | Select-Object -First 1).Failures.Count -eq 0)

# ----------------------------------------------------------------------------
# [Step 6] 残留清理 (1:1 等价 pre-flight-check.ps1 全项逻辑)
#   直接通过子进程调用，保持行为 100% 一致；同时传入已规范化的 DesktopDir / AppDir
# ----------------------------------------------------------------------------
Register-Step 6 "残留清理（上次非正常退出：.bak/.certbak/.build_vcode_prev/dist_old_*/.gradle configuration-cache 等）"

$pfPath = Join-Path $ToolsDir 'pre-flight-check.ps1'
if (-not (Test-Path -LiteralPath $pfPath)) {
    Add-StepFailure 6 "缺失脚本 tools/pre-flight-check.ps1"
} else {
    Push-Location $RepoRoot
    try {
        $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $pfPath, '-Target', $Edition)
        if ($DesktopDir) { $args += @('-DesktopDir', $DesktopDir) }
        if ($AppDir)     { $args += @('-AppDir',     $AppDir) }
        & powershell @args *>&1 | ForEach-Object { Write-Host ("         " + $_) -ForegroundColor DarkGray }
        # pre-flight-check 从不以 exit 1 阻塞；任何问题都只 WARN+清理。所以此处不判 LASTEXITCODE
    } catch {
        Add-StepWarning 6 ("pre-flight-check.ps1 调用异常（不阻塞）: " + $_.Exception.Message)
    } finally { Pop-Location }
}

Finish-Step 6 $true

# ----------------------------------------------------------------------------
# [Step 7] 磁盘空间检查 (桌面端默认 1 GB，APP 端默认在调用点传 5 GB)
# ----------------------------------------------------------------------------
Register-Step 7 ("磁盘空间检查 (≥ {0} GB)" -f $MinDiskSpaceGB)

# 决定用哪个目录所在盘符判定：优先 DesktopDir/AppDir，否则 RepoRoot
$checkDir = if ($DesktopDir -and (Test-Path -LiteralPath $DesktopDir)) { $DesktopDir } `
       elseif ($AppDir -and (Test-Path -LiteralPath $AppDir))         { $AppDir } `
       else                                                             { $RepoRoot }

try {
    $di = New-Object System.IO.DirectoryInfo $checkDir
    $driveName = if ($di.Root) { $di.Root.FullName.TrimEnd('\') } else { ($RepoRoot.Split(':')[0] + ':') }
    $drive = [System.IO.DriveInfo]::GetDrives() | Where-Object { $_.Name.TrimEnd('\') -eq $driveName } | Select-Object -First 1
    if (-not $drive) {
        Add-StepFailure 7 ("无法定位盘符: " + $driveName)
    } elseif (-not $drive.IsReady) {
        Add-StepFailure 7 ("磁盘未就绪: " + $drive.Name)
    } else {
        $freeGB = [math]::Round($drive.AvailableFreeSpace / 1GB, 2)
        Write-Host ("         Drive {0}  FreeSpace = {1} GB  阈值 = {2} GB" -f $drive.Name, $freeGB, $MinDiskSpaceGB) -ForegroundColor DarkGray
        if ($freeGB -lt $MinDiskSpaceGB) {
            Add-StepFailure 7 ("磁盘可用空间不足: {0} GB < 阈值 {1} GB。请清理 {2} 所在盘后重试。" -f $freeGB, $MinDiskSpaceGB, $checkDir)
            Add-StepWarning 7 "紧急时可在 build-app.bat 调用 ensure-build-env 的 -MinDiskSpaceGB 参数处临时调小（不推荐，Gradle/NDK 冷构建可能中途失败）"
        } else {
            Write-MsgOk ("磁盘空间充足 ({0} GB ≥ {1} GB)" -f $freeGB, $MinDiskSpaceGB)
        }
    }
} catch {
    Add-StepFailure 7 ("磁盘空间检查异常: " + $_.Exception.Message)
}

Finish-Step 7 $(($script:Steps | Where-Object { $_.Id -eq 7 } | Select-Object -First 1).Failures.Count -eq 0)

# ----------------------------------------------------------------------------
# [Step 8] 汇总输出 + 退出码
# ----------------------------------------------------------------------------
Register-Step 8 "汇总输出与修复指引"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ("  Ensure Build Env SUMMARY  (Target={0})" -f $Target) -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
foreach ($s in ($script:Steps | Sort-Object Id)) {
    $color = if ($s.Status -eq 'OK') { 'Green' } else { 'Red' }
    $line = "  Step {0}: {1,-5}   {2} ({3}s, F={4} W={5})" -f $s.Id, $s.Status, $s.Name, ("{0:N1}" -f $s.Duration), $s.Failures.Count, $s.Warnings.Count
    Write-Host $line -ForegroundColor $color
}
Write-Host ("  TOTALS:  OK-step={0}   FAIL-total={1}   WARN-total={2}" -f $script:TotalOk, $script:TotalFail, $script:TotalWarn) -ForegroundColor White

if ($script:TotalFail -gt 0) {
    Write-Host ""
    Write-Host "[RESULT] FATAL: 共 $($script:TotalFail) 项检查失败，打包已强制终止！" -ForegroundColor Red
    Write-Host ""
    Write-Host "---- 所有 FAIL 明细 ----" -ForegroundColor Red
    $script:AllFailures | ForEach-Object { Write-Host ("  - " + $_) -ForegroundColor Yellow }
    Write-Host ""
    Write-Host "---- 快速修复指引 (按步骤对应原单跑入口) ----" -ForegroundColor Yellow
    Write-Host "  Step 1 LF/CRLF 假改动:  git -C '$RepoRoot' add -u --renormalize  (不提交，仅刷新 index)；然后 git reset --mixed HEAD 清空 staged"
    Write-Host "  Step 1.5 源码未落定:  等 AI 改完并 commit 后重打包；或 git add -A ; git commit ；确要打未提交状态：set ALLOW_DIRTY_BUILD=1"
    Write-Host "  Step 2 BOM 问题    :  powershell -File tools/fix-ps1-bom.ps1  (对 .ps1 补 BOM)；.html/.gradle 缺 BOM 改为无 BOM UTF-8 保存"
    Write-Host "  Step 3 .bat 编码   :  UTF-8 .bat 文件顶部必须有 chcp 65001 >nul ；否则改存为 GBK/ANSI"
    Write-Host "  Step 4 版本门禁    :  单跑 verify-no-hardcoded-clinic.ps1 / verify-version-display.ps1 / verify-app-version-consistency.ps1 -Target <cloud|offline>"
    Write-Host "  Step 5 包完整性    :  桌面端：node tools/pre-build-check.js <桌面目录>；APP 端补缺失的 signing.properties/jks/gradlew.bat/capacitor.config.json"
    Write-Host "  Step 7 磁盘空间    :  清理对应盘符，或临时将 ensure-build-env 调用参数 -MinDiskSpaceGB 适当调小"
    Write-Host ""
    exit 1
} else {
    if ($script:TotalWarn -gt 0) {
        Write-Host ""
        Write-Host ("[RESULT] PASS（共 {0} 条 WARN，不阻塞打包；详情见上方 [WARN] 行）" -f $script:TotalWarn) -ForegroundColor Green
        Write-Host "---- WARN 汇总 ----" -ForegroundColor Yellow
        $script:AllWarnings | Select-Object -Unique | ForEach-Object { Write-Host ("  - " + $_) -ForegroundColor Yellow }
    } else {
        Write-Host ""
        Write-Host "[RESULT] PASS: 全部检查通过，无 FAIL 无 WARN。" -ForegroundColor Green
    }
    exit 0
}
