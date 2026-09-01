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
    [string]$RepoRoot = '',
    [switch]$Assert   # Node/CI 出口模式：未落定 exit 1
)

. (Join-Path $PSScriptRoot 'pack-side-effects.ps1')

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
    $numstat = @(& git -C $RepoRoot diff HEAD --numstat -- $Path 2>$null) | Where-Object { $_ }
    foreach ($ns in $numstat) {
        if ($ns -match '^(\d+)\t(\d+)\t') {
            return ([int]$Matches[1] -eq 0 -and [int]$Matches[2] -gt 0)
        }
    }
    return $false
}

function Get-SourceSettledBlockers {
    param([string]$RepoRoot = (Split-Path $PSScriptRoot -Parent))

    $blockers = New-Object System.Collections.ArrayList
    if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot '.git'))) { return @($blockers) }

    $raw = @(& git -C $RepoRoot -c core.quotepath=false status --porcelain 2>$null) | Where-Object { $_ }
    foreach ($line in $raw) {
        if ($line.Length -lt 4) { continue }
        $status2 = $line.Substring(0, 2)
        $path    = $line.Substring(3).Trim('"')
        if ($status2 -eq '??') { continue }

        # build.gradle 需要 diff 行做精判；其余副作用整文件判定
        $diff = $null
        if ($path -match 'build\.gradle$') {
            $diff = @(& git -C $RepoRoot diff HEAD -- $path 2>$null)
        }
        if (Test-IsPackSideEffect -GitPath $path -DiffLines $diff) { continue }

        # ★ 会话快照回退自动愈合（详见文件头注释）：纯删除 diff = 旧快照覆盖签名
        if (Test-IsSnapshotRevert -RepoRoot $RepoRoot -Path $path) {
            if ($script:SnapshotRevertAutoRestore -contains $path) {
                & git -C $RepoRoot checkout HEAD -- $path 2>$null
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
