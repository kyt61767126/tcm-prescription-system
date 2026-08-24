# build-skip.ps1 - 打包增量跳过检测
# 用途：如果某端的源码自上次成功打包后未变化、且产物文件完好（sha256 一致），则允许跳过重复打包。
# 指纹三要素（全部一致才 SKIP）：
#   1. git HEAD commit 与上次打包记录一致
#   2. 该端源路径工作区干净（排除"打包流程自身会改写的副作用文件"：config.json/build.gradle版本号/hash-manifest/downloads）
#   3. 产物 sha256 与上次打包记录一致（APK 单文件 / dist 目录全部 exe 聚合哈希）
# 设计原则：宁可多打不漏打——任何检测异常一律返回 BUILD（退出码1），绝不因工具故障跳过打包发旧版本。
# 用法：
#   powershell -File tools/build-skip.ps1 -Check -Unit local-app     # 退出码 0=可跳过 1=需打包
#   powershell -File tools/build-skip.ps1 -Record -Unit local-app    # 打包成功(且副作用AutoCommit后)记录基线
# 保险丝：环境变量 NO_BUILD_SKIP=1 时 Check 永远返回 BUILD（强制全量重打）
param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('cloud-desktop','cloud-app','local-desktop','local-app')]
    [string]$Unit,
    [switch]$Check,
    [switch]$Record
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot | Split-Path -Parent
$stateDir  = Join-Path $root '.build-cache'
$stateFile = Join-Path $stateDir 'build-state.json'

# ---------- 单元定义 ----------
#   sources 只含"决定产物内容"的源路径（tools/ 构建脚本不影响产物内容，不入列，避免改工具就误重打）
$unitDefs = @{
    'cloud-desktop' = @{ kind='exe'; artifactDir='app_project\db-yunduan\cloud_desktop\dist'; label='云端桌面exe';
                         sources=@('app_project/db-yunduan/cloud_desktop','public','shared') }
    'cloud-app'     = @{ kind='apk'; artifact='app_project\db-yunduan\惠康中医-云端.apk'; label='云端APP';
                         sources=@('app_project/db-yunduan','public','shared') }
    'local-desktop' = @{ kind='exe'; artifactDir='app_project\db-offline\desktop\dist'; label='本地桌面exe';
                         sources=@('app_project/db-offline/desktop','shared') }
    'local-app'     = @{ kind='apk'; artifact='app_project\db-offline\惠康中医-本地.apk'; label='本地APP';
                         sources=@('app_project/db-offline','shared') }
}

# ---------- 打包流程自身会改写的被跟踪文件（不算"源码变化"，正则匹配 status 路径）----------
#   config.json      : edit-config.ps1 每次打包同步默认配置到 Capacitor/桌面
#   build.gradle     : APP 打包 versionCode/versionName 递增（SideEffectCollect AutoCommit）
#   package.json     : 桌面打包 version 递增（SideEffectCollect autoPatterns）
#   hash-manifest.json / public/downloads/ : 发布阶段产物，非源码
#   注意：手改 build.gradle/package.json 后请删除 .build-cache/build-state.json 强制全量重打
$sideEffectPatterns = @(
    '^app_project/db-offline/app/app/src/main/assets/public/config\.json$',
    '^app_project/db-offline/desktop/config\.json$',
    '^app_project/db-yunduan/cloud_app/app/src/main/assets/public/config\.json$',
    '^app_project/db-yunduan/cloud_desktop/config\.json$',
    '^app_project/db-offline/app(/app)?/build\.gradle$',
    '^app_project/db-yunduan/cloud_app(/app)?/build\.gradle$',
    '^app_project/db-(offline/desktop|yunduan/cloud_desktop)/package\.json$',
    '^public/hash-manifest\.json$',
    '^public/downloads/'
)

# ---------- 工具函数 ----------
function Get-FileSha256([string]$p) {
    try { return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLower() } catch { return $null }
}
function Get-StringSha256([string]$s) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($s))
        return ([BitConverter]::ToString($bytes) -replace '-','').ToLower()
    } finally { $sha.Dispose() }
}
# 产物指纹：APK=单文件sha256；桌面=dist全部exe(按名排序)的 name:sha256 串接再整体哈希
function Get-ArtifactFingerprint($def) {
    if ($def.kind -eq 'apk') {
        $p = Join-Path $root $def.artifact
        if (-not (Test-Path -LiteralPath $p)) { return $null }
        return Get-FileSha256 $p
    }
    $dir = Join-Path $root $def.artifactDir
    if (-not (Test-Path -LiteralPath $dir)) { return $null }
    $exes = @(Get-ChildItem -LiteralPath $dir -Filter '*.exe' -File -ErrorAction SilentlyContinue | Sort-Object Name)
    if ($exes.Count -eq 0) { return $null }
    $parts = $exes | ForEach-Object { "$($_.Name):$(Get-FileSha256 $_.FullName)" }
    return Get-StringSha256 (($parts -join '|'))
}
function Get-HeadCommit {
    try {
        $h = & git -C $root rev-parse HEAD 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $h) { return $null }
        return ($h | Select-Object -First 1).ToString().Trim()
    } catch { return $null }
}
# 源路径工作区是否有未提交改动（排除副作用文件后）
function Get-DirtySources($sources) {
    $lines = @()
    try {
        # -c core.quotepath=false: 中文路径原样输出（默认八进制转义，可读性差）
        $lines = @(& git -C $root -c core.quotepath=false status --porcelain -- @sources 2>$null)
        if ($LASTEXITCODE -ne 0) { return @('<git-status-failed>') }
    } catch { return @('<git-status-exception>') }
    $dirty = @()
    foreach ($ln in $lines) {
        if (-not $ln -or $ln.Length -lt 4) { continue }
        $path = $ln.Substring(3).Trim()
        if ($path.StartsWith('"') -and $path.EndsWith('"')) { $path = $path.Substring(1, $path.Length - 2) }
        # git status 对非 ASCII 路径输出带引号的八进制转义（如 public/downloads/惠康中医-云端.apk），
        # 解码麻烦且 downloads 已按前缀排除，这里对含转义的路径按原始串做前缀匹配即可。
        $isSideEffect = $false
        $pathNoQuote = $path.Trim('"')
        foreach ($pat in $sideEffectPatterns) { if ($pathNoQuote -match $pat) { $isSideEffect = $true; break } }
        if (-not $isSideEffect) { $dirty += $path }
    }
    return ,$dirty
}
function Read-State {
    try {
        if (Test-Path -LiteralPath $stateFile) {
            return Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
        }
    } catch {}
    return $null
}
function Write-State($obj) {
    if (-not (Test-Path -LiteralPath $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }
    $obj | ConvertTo-Json -Depth 5 | Out-File -LiteralPath $stateFile -Encoding UTF8 -Force
}

# ---------- 主逻辑 ----------
$def = $unitDefs[$Unit]
if (-not $def) { Write-Host "[BUILD] 未知单元: $Unit"; exit 1 }

if ($Check) {
    if ($env:NO_BUILD_SKIP -eq '1') { Write-Host "[BUILD] NO_BUILD_SKIP=1 强制全量"; exit 1 }
    $state = Read-State
    $rec = $null
    if ($state -and $state.PSObject.Properties[$Unit]) { $rec = $state.$Unit }
    if (-not $rec) { Write-Host "[BUILD] $Unit 无打包基线记录(首次/基线被清)"; exit 1 }

    $fp = Get-ArtifactFingerprint $def
    if (-not $fp)                       { Write-Host "[BUILD] $Unit 产物缺失或不完整"; exit 1 }
    if ($fp -ne $rec.sha)               { Write-Host "[BUILD] $Unit 产物与基线不一致(被覆盖/删改)"; exit 1 }

    $head = Get-HeadCommit
    if (-not $head)                     { Write-Host "[BUILD] 无法读取 git HEAD"; exit 1 }
    # ★ 比对"源路径是否有新提交"而非全局 HEAD：其他路径(tools/文档)的新提交不影响本端产物内容。
    #   取基线后源路径的全部变更文件，再套用副作用排除正则（与工作区检查同一套），
    #   剩余非空 = 真实源码变化 → 重打；副作用提交(versionCode bump/hash-manifest)不算。
    $changedFiles = @()
    try {
        $changedFiles = @(& git -C $root -c core.quotepath=false log "$($rec.commit)..$head" --name-only --pretty=format: -- @($def.sources) 2>$null) |
                        ForEach-Object { $_.ToString().Trim().Trim('"') } | Where-Object { $_ }
        if ($LASTEXITCODE -ne 0) { Write-Host "[BUILD] 无法比较源码提交历史"; exit 1 }
    } catch { Write-Host "[BUILD] 比较源码提交历史异常"; exit 1 }
    $realChanges = @()
    foreach ($f in $changedFiles) {
        $isSide = $false
        foreach ($pat in $sideEffectPatterns) { if ($f -match $pat) { $isSide = $true; break } }
        if (-not $isSide) { $realChanges += $f }
    }
    if ($realChanges.Count -gt 0) {
        Write-Host "[BUILD] $Unit 源码有新提交(基线 $($rec.commit.Substring(0,8)) 后 $($realChanges.Count) 个文件变化):"
        foreach ($f in ($realChanges | Select-Object -First 6)) { Write-Host "        $f" }
        exit 1
    }

    $dirty = Get-DirtySources $def.sources
    if ($dirty.Count -gt 0) {
        Write-Host "[BUILD] $Unit 工作区有未提交源码改动:"
        foreach ($d in ($dirty | Select-Object -First 8)) { Write-Host "        $d" }
        if ($dirty.Count -gt 8) { Write-Host "        ... 共 $($dirty.Count) 个文件" }
        exit 1
    }
    Write-Host "[SKIP] $Unit 源码与产物指纹一致，产物已是最新(基线: $($rec.time))" -ForegroundColor Green
    exit 0
}

if ($Record) {
    # 安全约束1：只允许在"源码干净"时记录基线——防止把"源码有未提交改动"的状态固化成基线导致后续漏打
    $dirty = Get-DirtySources $def.sources
    if ($dirty.Count -gt 0) {
        Write-Host "[WARN] $Unit 工作区有未提交源码改动，拒绝记录基线(请先提交):"
        foreach ($d in ($dirty | Select-Object -First 8)) { Write-Host "        $d" }
        exit 1
    }
    # 安全约束2：产物新鲜度防线——产物文件修改时间必须 >= 源路径最后一次提交时间，
    #   否则说明产物是旧源码构建的（比最新源码还老），记录该基线会导致下次误 SKIP 发旧版本
    try {
        $lastCommit = & git -C $root log -1 --format=%ci -- @($def.sources) 2>$null
        if ($LASTEXITCODE -eq 0 -and $lastCommit) {
            $lastCommitTime = [DateTime]::Parse(($lastCommit | Select-Object -First 1).ToString().Trim())
            $artifactPath = if ($def.kind -eq 'apk') { Join-Path $root $def.artifact } else { Join-Path $root $def.artifactDir }
            $artifactTime = (Get-Item -LiteralPath $artifactPath -ErrorAction Stop).LastWriteTime
            # 容差30分钟：副作用AutoCommit(versionCode bump等)提交时间晚于产物生成时间（全量打包收纳需时），
            # 旧产物通常早数小时/数天，30分钟容差既放过正常流程又能拦住过期产物
            if ($artifactTime -lt $lastCommitTime.AddMinutes(-30)) {
                Write-Host "[WARN] $Unit 产物($($artifactTime.ToString('MM-dd HH:mm')))早于源码最后提交($($lastCommitTime.ToString('MM-dd HH:mm')))，产物疑似过期，拒绝记录基线(请重新打包)"
                exit 1
            }
        }
    } catch { Write-Host "[WARN] $Unit 产物新鲜度检查异常(跳过该检查继续记录): $_" }
    $fp = Get-ArtifactFingerprint $def
    if (-not $fp) { Write-Host "[ERROR] $Unit 产物缺失，拒绝记录基线"; exit 1 }
    $head = Get-HeadCommit
    if (-not $head) { Write-Host "[ERROR] 无法读取 git HEAD，拒绝记录基线"; exit 1 }
    $state = Read-State
    if (-not $state) { $state = New-Object PSObject }
    $entry = [PSCustomObject]@{ sha = $fp; commit = $head; time = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') }
    if ($state.PSObject.Properties[$Unit]) { $state.$Unit = $entry }
    else { $state | Add-Member -MemberType NoteProperty -Name $Unit -Value $entry }
    Write-State $state
    Write-Host "[OK] $Unit 已记录打包基线 (commit $($head.Substring(0,8)), $($entry.time))" -ForegroundColor Green
    exit 0
}

Write-Host "[ERROR] 需要指定 -Check 或 -Record"; exit 1
