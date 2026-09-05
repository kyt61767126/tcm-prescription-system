# ============================================================================
# source-settled.ps1 — 源码落定检测（★ 权威入口，2026-08-31）
#
# 调用方（dot-source 本文件后调 Get-SourceSettledBlockers）：
#   1. ensure-build-env.ps1 Step 1.5（4 端 build 唯一咽喉）
#   2. release-menu.ps1 Invoke-SinglePack 前置（一键发布，开始即拦）
#   3. one-click-pack.ps1 AutoMode 前置（一键打包/发布的全部打包入口）
#
# 历史教训（为什么收敛）：门禁逻辑曾内联复制 3 份，上线次日 build.gradle
#   versionCode 误拦（白名单 3 处要同步修），当天收敛单源；又发现
#   hash-manifest.json 漏列 = 下一次打包必再误拦——副作用清单也收敛到
#   tools/pack-side-effects.ps1 单一权威源（与 one-click-pack
#   SideEffectCollect 共用一份清单，杜绝两边各自演化）。
#
# 判定语义：git 工作区相对 HEAD 的修改中，除「打包副作用文件」外存在
#   任何源码修改 = 未落定 → 返回非空 blockers 数组（空数组=落定）。
#   打包副作用白名单（package.json/build-meta.json/hash-manifest.json +
#   build.gradle 纯 versionCode/versionName 行变化）见 pack-side-effects.ps1。
#   未跟踪 ??（dist/build_output 产物）不拦。
#
# ★ 2026-09-01 会话快照回退自动愈合（历史上第 3 次复现后根治）：
#   TRAE 会话恢复会用旧快照静默覆盖工作区已提交文件（3 次吞掉 KNOWLEDGE.md
#   章节，2 次卡死打包门禁）。回退签名 = diff 相对 HEAD「只有删无增」。
#   经验/规则类文档（$SnapshotRevertAutoRestore 清单，正常流程只会追加+
#   立即 commit，不存在「未提交纯删除」的合法状态）命中签名 → 自动从
#   HEAD 恢复并放行（git 是唯一权威源）；其余源码文件命中签名 → 仍拦截，
#   但在 blocker 里附恢复命令提示（防止误吞有意删除的半成品代码）。
#
# 保险丝：ALLOW_DIRTY_BUILD=1（由调用方检查，本函数不管）
# 非仓库环境（无 .git）：返回空（放行，不误拦）
# ============================================================================
param(
    # ★ 2026-09-01 修复：本文件被 ensure-build-env 等 dot-source 时，param 默认值
    #   会写进调用方作用域——原名 $RepoRoot 把 ensure-build-env.ps1 的同名变量
    #   覆盖成 ''，导致 Step 1.5 崩溃（Join-Path 空串）。参数名必须带前缀防碰撞。
    [string]$SettledRepoRoot = '',
    [switch]$Assert   # Node/CI 出口模式：未落定 exit 1
)

. (Join-Path $PSScriptRoot 'pack-side-effects.ps1')

# ★ 2026-09-01 修复（PS 5.1 地雷）：调用方 $ErrorActionPreference='Stop' 时，
#   native 命令（git）stderr 经 2>$null 重定向会把首行 stderr（如 CRLF warning）
#   升级为 terminating NativeCommandError，直接炸掉门禁。所有 git 调用统一走
#   本助手：临时降 EAP=Continue，stderr 合并后过滤丢弃（2>&1 只留 string 行），
#   不产生错误流记录——PS 5.1 的 NativeCommandError 红字/transcript 记录一并消除。
function Invoke-GitQuiet {
    param([string]$RepoRoot, [string[]]$GitArgs)
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        return @(& git -c core.quotepath=false -C $RepoRoot @GitArgs 2>&1) | Where-Object { $_ -is [string] -and $_ }
    } finally {
        $ErrorActionPreference = $prevEap
    }
}

# 快照回退自动愈合清单：.trae/ 经验与规则文档（git 为唯一权威源，追加式维护）
$script:SnapshotRevertAutoRestore = @(
    '.trae/KNOWLEDGE.md',
    '.trae/decisions.md',
    '.trae/history_bug_summary.md',
    '.trae/project_rules.md',
    '.trae/rules/project_rules.md',
    '.trae/skill-optimize.md'
)

# 判定单个文件相对 HEAD 是否为「纯删除」diff（会话快照回退签名）。
# numstat 行格式：<增行数>TAB<删行数>TAB<路径>；二进制为 -TAB- 不匹配（按普通 blocker 处理）。
function Test-IsSnapshotRevert {
    param([string]$RepoRoot, [string]$Path)
    $numstat = Invoke-GitQuiet -RepoRoot $RepoRoot -GitArgs @('diff', 'HEAD', '--numstat', '--', $Path)
    foreach ($ns in $numstat) {
        if ($ns -match '^(\d+)\t(\d+)\t') {
            return ([int]$Matches[1] -eq 0 -and [int]$Matches[2] -gt 0)
        }
    }
    return $false
}

# ★ 2026-09-05 发布部署产物清单（单一权威源，落定门豁免 + publish-release.js git-add 共用）：
#   publish-release.js 流程 = 先写下载页文件（downloads APK / updates 清单 /
#   site-official 镜像）→ 落定门 Assert → 自己 git add+commit+push。这些文件是发布
#   脚本自产数据（非源码），未豁免时门被脚本刚写的文件拦死（鸡生蛋，v2026.09.05-1946
#   发布失败实证），中断残留还会卡死后续 4 端打包咽喉（同入口本文件）。
#   新增下载页部署目录/文件只改这一处，js 端经 Get-ReleaseDeployGitAddPaths 动态获取，
#   杜绝豁免正则与 git-add 路径两处硬编码漂移。
#   注意：发布产物不进 pack-side-effects 自动收纳清单——打包流程不自动提交下载页产物
#   （未经验证的包不带上 git push），下载页文件始终由发布脚本自管。
function Get-ReleaseDeployPatterns {
    return @(
        '^public/downloads/'
        '^public/updates/'
        '^site-official/hash-manifest\.json$'
        '^site-official/updates/'
    )
}
function Get-ReleaseDeployGitAddPaths {
    return @(
        'public/hash-manifest.json'
        'public/downloads/'
        'public/updates/'
        'site-official/hash-manifest.json'
        'site-official/updates/'
    )
}

function Get-SourceSettledBlockers {
    param([string]$RepoRoot = (Split-Path $PSScriptRoot -Parent))

    $blockers = New-Object System.Collections.ArrayList
    if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot '.git'))) { return @($blockers) }

    $raw = Invoke-GitQuiet -RepoRoot $RepoRoot -GitArgs @('-c', 'core.quotepath=false', 'status', '--porcelain')
    foreach ($line in $raw) {
        if ($line.Length -lt 4) { continue }
        $status2 = $line.Substring(0, 2)
        $path    = $line.Substring(3).Trim('"')
        if ($status2 -eq '??') { continue }

        # ★ 发布部署产物豁免（发布脚本自产文件，清单见 Get-ReleaseDeployPatterns 单源）
        $isReleaseDeploy = $false
        foreach ($rp in (Get-ReleaseDeployPatterns)) { if ($path -match $rp) { $isReleaseDeploy = $true; break } }
        if ($isReleaseDeploy) { continue }

        # build.gradle 需要 diff 行做精判；其余副作用整文件判定
        $diff = $null
        if ($path -match 'build\.gradle$') {
            $diff = Invoke-GitQuiet -RepoRoot $RepoRoot -GitArgs @('diff', 'HEAD', '--', $path)
        }
        if (Test-IsPackSideEffect -GitPath $path -DiffLines $diff) { continue }

        # ★ 会话快照回退自动愈合（详见文件头注释）：纯删除 diff = 旧快照覆盖签名
        if (Test-IsSnapshotRevert -RepoRoot $RepoRoot -Path $path) {
            if ($script:SnapshotRevertAutoRestore -contains $path) {
                Invoke-GitQuiet -RepoRoot $RepoRoot -GitArgs @('checkout', 'HEAD', '--', $path) | Out-Null
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "[自愈] $path 疑似被会话快照静默回退（纯删除 diff），已自动从 HEAD 恢复" -ForegroundColor Yellow
                    continue
                }
            }
            [void]$blockers.Add(("{0}  {1}  ← 疑似会话快照回退(纯删除)，若非有意修改可: git checkout HEAD -- {1}" -f $status2.Trim(), $path))
            continue
        }

        [void]$blockers.Add(("{0}  {1}" -f $status2.Trim(), $path))
    }
    return @($blockers)
}

# Node/CI 出口：-Assert 模式——有未落定修改时输出明细并 exit 1（供发布链路
# publish-release.js / auto-update-downloads.js commit 前前置检查）。
if ($Assert) {
    if ($env:ALLOW_DIRTY_BUILD -eq '1') { Write-Output 'SOURCE_SETTLED=FUSE'; exit 0 }
    $b = @(Get-SourceSettledBlockers)
    if ($b.Count -gt 0) {
        Write-Output ("SOURCE_NOT_SETTLED=" + $b.Count)
        $b | ForEach-Object { Write-Output $_ }
        exit 1
    }
    Write-Output 'SOURCE_SETTLED=OK'
    exit 0
}
