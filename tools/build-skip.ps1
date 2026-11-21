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
#   excludes 排除"路径在 sources 内但该端产物不消费"的子目录：
#     APP 构建会同步 desktop 的 config.json/vendor（build-app.bat 引用），但【不】消费 desktop/electron
#     —— electron 主进程/登录窗改动只影响桌面端，不应触发 APP 重打
#     （2026-08-24 误判实测：11:11 桌面登录框修复被误判为 local-app/cloud-app 需重打）
$unitDefs = @{
    'cloud-desktop' = @{ kind='exe'; artifactDir='app_project\db-yunduan\cloud_desktop\dist'; label='云端桌面exe';
                         sources=@('app_project/db-yunduan/cloud_desktop','public','shared') }
    'cloud-app'     = @{ kind='apk'; artifact='app_project\db-yunduan\惠康中医-云端.apk'; label='云端APP';
                         sources=@('app_project/db-yunduan','public','shared');
                         excludes=@('app_project/db-yunduan/cloud_desktop/electron') }
    'local-desktop' = @{ kind='exe'; artifactDir='app_project\db-offline\desktop\dist'; label='本地桌面exe';
                         sources=@('app_project/db-offline/desktop','shared') }
    'local-app'     = @{ kind='apk'; artifact='app_project\db-offline\惠康中医-本地.apk'; label='本地APP';
                         sources=@('app_project/db-offline','shared');
                         excludes=@('app_project/db-offline/desktop/electron') }
}

# ---------- 打包流程自身会改写的被跟踪文件（不算"源码变化"，正则匹配 status 路径）----------
#   config.json      : edit-config.ps1 每次打包同步默认配置到 Capacitor/桌面
#   build.gradle     : APP 打包 versionCode/versionName 递增（SideEffectCollect AutoCommit）
#   package.json     : 桌面打包 version 递增（SideEffectCollect autoPatterns）
#   build-meta.json  : 桌面打包自动写入版本+构建时间戳（2026-08-24：曾因漏排除导致云端基线拒绝记录）
#   hash-manifest.json / public/downloads/ / public/updates/ : 发布阶段产物，非源码
#   ★ 2026-08-24 修复：public/updates/*/latest.json 是发布时 publish-release.js 写的
#     自动更新元数据（cloud-desktop/cloud-app 的 sources 含 public），不排除会导致
#     每次发布后云端两端必被误判"源码有新提交"而强制无谓重打（version 无谓递增）。
#   ★ 2026-09-14 修复：public/hot-update/* 是 generate-{app,desktop}-hotupdate.cjs 发布的
#     热包产物（离线端经线上拉取），云端两端 sources 含 public 但不消费——纯热包发布后
#     云端两端被误判需重打（智能打包 [4] 预览误报，实测 09-14 20 时段），同性质排除。
#   注意：手改 build.gradle/package.json 后请删除 .build-cache/build-state.json 强制全量重打
$sideEffectPatterns = @(
    '^app_project/db-offline/app/app/src/main/assets/public/config\.json$',
    '^app_project/db-offline/desktop/config\.json$',
    '^app_project/db-yunduan/cloud_app/app/src/main/assets/public/config\.json$',
    '^app_project/db-yunduan/cloud_desktop/config\.json$',
    '^app_project/db-offline/app(/app)?/build\.gradle$',
    '^app_project/db-yunduan/cloud_app(/app)?/build\.gradle$',
    '^app_project/db-(offline/desktop|yunduan/cloud_desktop)/package\.json$',
    '^app_project/db-(offline/desktop|yunduan/cloud_desktop)/build-meta\.json$',
    '^public/hash-manifest\.json$',
    '^public/build-meta\.json$',   # ★ 2026-11-21：发布脚本回写桌面版本号（非源码）
    '^public/downloads/',
    '^public/updates/',
    '^public/hot-update/'
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
# 组装 git pathspec：sources + excludes（:(exclude)path 语法，git status/log 通用）
function Get-SourceSpec($def) {
    $spec = @($def.sources)
    if ($def.excludes) { foreach ($e in $def.excludes) { $spec += ":(exclude)$e" } }
    return ,$spec
}

# ---------- ★ 2026-11-21 热更覆盖判定（能热更的不打包）----------
# 规则：本次源码改动若「全部」能被已签发热包通道覆盖（改动即签名源，或分发副本与签名源同批更新），
#       则跳过整包重打（只重签热包）；任何未覆盖/无法确认的改动一律 BUILD（宁可多打不漏打）。
# 热包文件清单直接读已发布 version.json 的 files[].name，避免与生成器白名单二次维护漂移。
$hotChannelDefs = @{
    # 云桌面：热包源 public/，index.html 与 button-manager.js 用 cloud_desktop 覆盖版
    'cloud-desktop' = @{
        manifest  = 'public/hot-update/desktop/cloud/version.json'
        srcRoot   = 'public'
        overrides = @{
            'index.html'        = 'app_project/db-yunduan/cloud_desktop/index.html'
            'button-manager.js' = 'app_project/db-yunduan/cloud_desktop/button-manager.js'
        }
        mapRoots  = @('shared', 'app_project/db-yunduan/cloud_desktop')
    }
    # 离线桌面：热包源 db-offline/desktop/
    'local-desktop' = @{
        manifest = 'public/hot-update/desktop/local/version.json'
        srcRoot  = 'app_project/db-offline/desktop'
        mapRoots = @('shared')
    }
    # 离线 APP：热包源 assets/public（desktop 同名文件须与 assets 同批更新才算覆盖）
    'local-app' = @{
        manifest = 'public/hot-update/app-local/version.json'
        srcRoot  = 'app_project/db-offline/app/app/src/main/assets/public'
        mapRoots = @('shared', 'app_project/db-offline/desktop')
        # APP index.html 真源（build-app.bat 每次从它复制到 assets/public）
        mapFiles = @{ 'app_project/db-offline/index-app.html' = 'index.html' }
    }
}
# 云端 APP 为在线 WebView 壳：网页层 push 即达（assets 仅离线兜底），改动无需重打 APK。
$cloudAppOnlineRoots = @(
    'public',
    'app_project/db-yunduan/cloud_app/app/src/main/assets/public',
    'app_project/db-yunduan/cloud_desktop',
    'shared'
)
# shared 源 → 分发名映射（auth-core 双权威源 / print-utils 云离双版）
function Get-SharedHotRel([string]$rel) {
    switch -Regex ($rel) {
        '^auth-core/(offline|cloud)\.js$' { return 'auth-core.js' }
        '^auth-core\.js$'                 { return 'auth-core.js' }
        '^print-utils(-offline)?\.js$'    { return 'print-utils.js' }
        default                           { return $rel }
    }
}
# 读某通道热包清单（files[].name → 集合）；缺失/损坏返回 $null（调用方按 BUILD 处理）
function Get-HotFileSet($def) {
    $p = Join-Path $root $def.manifest
    if (-not (Test-Path -LiteralPath $p)) { return $null }
    try {
        $m = Get-Content -LiteralPath $p -Raw -Encoding UTF8 | ConvertFrom-Json
        $set = @{}
        foreach ($f in @($m.files)) { if ($f -and $f.name) { $set[[string]$f.name] = $true } }
        if ($set.Count -eq 0) { return $null }
        return $set
    } catch { return $null }
}
# 单文件是否被热更覆盖：
#   ①改动就是热包签名源 → 覆盖；
#   ②改动是分发副本（shared→auth-core、desktop→APP assets、cloud_desktop→public）→
#     必须本次同批改动了签名源（证明同步脚本已跑），否则热包会签出旧内容 → 整包才可靠。
#   注：签名源里 index.html/button-manager.js 的覆盖版与 public 版按设计不同内容
#   （Electron/APP 专属块），不能按字节比对；public 侧被覆盖版取代 → 视为与整包无关。
function Test-HotCovered([string]$path, $def, $hotSet, $changedSet) {
    $p = $path -replace '\\', '/'
    $candidates = @()   # @{ rel = ...; isSrc = $true/$false }
    $src = $def.srcRoot
    if ($p -ieq $src -or $p.StartsWith("$src/")) {
        $candidates += @{ rel = $p.Substring($src.Length).TrimStart('/'); isSrc = $true }
    }
    foreach ($mr in @($def.mapRoots)) {
        if ($p -ieq $mr -or $p.StartsWith("$mr/")) {
            $rel = $p.Substring($mr.Length).TrimStart('/')
            if ($mr -eq 'shared') { $rel = Get-SharedHotRel $rel }
            $candidates += @{ rel = $rel; isSrc = $false }
        }
    }
    if ($def.mapFiles) {
        foreach ($k in $def.mapFiles.Keys) {
            if ($p -ieq ($k -replace '\\', '/')) {
                $candidates += @{ rel = $def.mapFiles[$k]; isSrc = $false }
            }
        }
    }
    foreach ($c in $candidates) {
        $rel = $c.rel
        if (-not $rel -or -not $hotSet.ContainsKey($rel)) { continue }
        $hasOverride = ($def.overrides -and $def.overrides.ContainsKey($rel))
        if ($c.isSrc) {
            # 被覆盖的 public 侧文件（如 public/index.html）不参与桌面包 → 与整包无关
            return $true
        }
        $targetRel = if ($hasOverride) { $def.overrides[$rel] } else { "$src/$rel" }
        $targetRel = $targetRel -replace '\\', '/'
        if ($changedSet.ContainsKey($targetRel)) { return $true }
        if ($p -ieq $targetRel) { return $true }
    }
    return $false
}
# 云端 APP：网页层路径（在线即达）视为无需重打
function Test-CloudAppOnlineCovered([string]$path) {
    foreach ($r in $cloudAppOnlineRoots) {
        if ($path -ieq $r -or $path.StartsWith("$r/")) { return $true }
    }
    return $false
}
# ★ 2026-08-31 产物形态黑名单（build_output 残留事故举一反三）：
#   未跟踪(??)的"构建产物形态"目录/文件不算源码脏——按设计新增源码应触发重打，
#   但打包中断残留的产物目录（win-unpacked/dist 等）既非源码也不会被产物构建消费，
#   之前仅靠 .gitignore 兜底（时间戳变体漏网 → 基线拒绝记录误报）。
#   此处按 basename/形态正则双保险：.gitignore 漏登记新变体时不再误报。
$productShapePatterns = @(
    '^build_output',            # Electron 备用输出目录（含时间戳变体）
    '^_backup_asar',
    '^win-unpacked$',
    '^dist[^/]*$'               # dist / dist_new / dist_old_* / dist_v*
)
# 源路径工作区是否有未提交改动（排除副作用文件后）
function Get-DirtySources($def) {
    $spec = Get-SourceSpec $def
    $lines = @()
    try {
        # -c core.quotepath=false: 中文路径原样输出（默认八进制转义，可读性差）
        $lines = @(& git -C $root -c core.quotepath=false status --porcelain -- @spec 2>$null)
        if ($LASTEXITCODE -ne 0) { return @('<git-status-failed>') }
    } catch { return @('<git-status-exception>') }
    $dirty = @()
    foreach ($ln in $lines) {
        if (-not $ln -or $ln.Length -lt 4) { continue }
        $xy = $ln.Substring(0, 2)
        $path = $ln.Substring(3).Trim()
        if ($path.StartsWith('"') -and $path.EndsWith('"')) { $path = $path.Substring(1, $path.Length - 2) }
        # git status 对非 ASCII 路径输出带引号的八进制转义（如 public/downloads/惠康中医-云端.apk），
        # 解码麻烦且 downloads 已按前缀排除，这里对含转义的路径按原始串做前缀匹配即可。
        $isSideEffect = $false
        $pathNoQuote = $path.Trim('"')
        foreach ($pat in $sideEffectPatterns) { if ($pathNoQuote -match $pat) { $isSideEffect = $true; break } }
        if ($isSideEffect) { continue }
        # ★ 2026-08-31：未跟踪的产物形态目录不算源码脏（.gitignore 漏网兜底，双保险）
        if ($xy -match '\?') {
            $top = ($pathNoQuote -split '/')[0]
            $isProduct = $false
            foreach ($pat in $productShapePatterns) { if ($top -match $pat) { $isProduct = $true; break } }
            if ($isProduct) { continue }
        }
        # ★ 2026-08-24 修复：stat 幻影复核——入口 self-heal 脚本(fix-bat-crlf/fix-ps1-bom)
        #   重写 bat/ps1（内容不变仅 mtime 变）会让 git status 持续报 modified（eol 属性 +
        #   stat 缓存过期），git diff 却为空。对"已跟踪且非新增"文件用内容级 diff 复核：
        #   与 HEAD 无真实差异 = 幻影，不算脏；untracked(??) 无 HEAD 可比，直接算脏。
        if ($xy -notmatch '\?') {
            & git -C $root diff --quiet HEAD -- $path 2>$null
            if ($LASTEXITCODE -eq 0) { continue }
        }
        $dirty += $path
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
    #   取基线后源路径的全部变更文件（含 excludes 排除），再套用副作用排除正则（与工作区检查同一套），
    #   剩余非空 = 真实源码变化 → 重打；副作用提交(versionCode bump/hash-manifest)不算。
    $specArgs = Get-SourceSpec $def
    $changedFiles = @()
    try {
        $changedFiles = @(& git -C $root -c core.quotepath=false log "$($rec.commit)..$head" --name-only --pretty=format: -- @specArgs 2>$null) |
                        ForEach-Object { $_.ToString().Trim().Trim('"') } | Where-Object { $_ }
        if ($LASTEXITCODE -ne 0) { Write-Host "[BUILD] 无法比较源码提交历史"; exit 1 }
    } catch { Write-Host "[BUILD] 比较源码提交历史异常"; exit 1 }
    $realChanges = @()
    foreach ($f in $changedFiles) {
        $isSide = $false
        foreach ($pat in $sideEffectPatterns) { if ($f -match $pat) { $isSide = $true; break } }
        if (-not $isSide) { $realChanges += $f }
    }
    # git log --name-only 会按提交重复列同一文件 → 去重（避免"文件数"虚高、同一文件重复打印）
    $realChanges = @($realChanges | Select-Object -Unique)
    if ($realChanges.Count -gt 0) {
        # ★ 2026-11-21：先判定是否全部可由热更覆盖（能热更的不打包）
        $covered = @(); $notCovered = @()
        $hotDef = $hotChannelDefs[$Unit]
        if ($hotDef) {
            $hotSet = Get-HotFileSet $hotDef
            if ($hotSet) {
                $changedSet = @{}
                foreach ($f in $realChanges) { $changedSet[($f -replace '\\', '/')] = $true }
                foreach ($f in $realChanges) {
                    if (Test-HotCovered $f $hotDef $hotSet $changedSet) { $covered += $f } else { $notCovered += $f }
                }
            } else { $notCovered = $realChanges }
        } elseif ($Unit -eq 'cloud-app') {
            foreach ($f in $realChanges) {
                if (Test-CloudAppOnlineCovered $f) { $covered += $f } else { $notCovered += $f }
            }
        } else { $notCovered = $realChanges }

        if ($notCovered.Count -eq 0 -and $covered.Count -gt 0) {
            Write-Host "[HOT-ONLY] $Unit 本次 $($covered.Count) 个改动全部可由热更覆盖，跳过整包（无需重新打包）"
            foreach ($f in ($covered | Select-Object -First 6)) { Write-Host "        $f" }
            if ($covered.Count -gt 6) { Write-Host "        ... 共 $($covered.Count) 个文件" }
            Write-Host "        下一步: 一键构建发布.bat hot --yes （重签热包并推送）"
            exit 0
        }

        Write-Host "[BUILD] $Unit 源码有新提交(基线 $($rec.commit.Substring(0,8)) 后 $($realChanges.Count) 个文件变化，其中 $($notCovered.Count) 个不可热更):"
        foreach ($f in ($notCovered | Select-Object -First 6)) { Write-Host "        $f" }
        if ($notCovered.Count -gt 6) { Write-Host "        ... 共 $($notCovered.Count) 个不可热更文件" }
        exit 1
    }

    $dirty = Get-DirtySources $def
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
    $dirty = Get-DirtySources $def
    if ($dirty.Count -gt 0) {
        Write-Host "[WARN] $Unit 工作区有未提交源码改动，拒绝记录基线(请先提交):"
        foreach ($d in ($dirty | Select-Object -First 8)) { Write-Host "        $d" }
        exit 1
    }
    # 安全约束2：产物新鲜度防线——产物文件修改时间必须 >= 源路径最后一次提交时间，
    #   否则说明产物是旧源码构建的（比最新源码还老），记录该基线会导致下次误 SKIP 发旧版本
    try {
        $lastCommit = & git -C $root log -1 --format=%ci -- @(Get-SourceSpec $def) 2>$null
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
