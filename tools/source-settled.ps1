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
# 保险丝：ALLOW_DIRTY_BUILD=1（由调用方检查，本函数不管）
# 非仓库环境（无 .git）：返回空（放行，不误拦）
# ============================================================================
param(
    [string]$RepoRoot = '',
    [switch]$Assert   # Node/CI 出口模式：未落定 exit 1
)

. (Join-Path $PSScriptRoot 'pack-side-effects.ps1')

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
