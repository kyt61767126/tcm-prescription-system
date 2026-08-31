# ============================================================================
# source-settled.ps1 — 源码落定检测（★ 单一权威源，2026-08-31）
#
# 调用方（dot-source 本文件后调 Get-SourceSettledBlockers）：
#   1. ensure-build-env.ps1 Step 1.5（4 端 build 唯一咽喉）
#   2. release-menu.ps1 Invoke-SinglePack 前置（一键发布，开始即拦）
#   3. one-click-pack.ps1 AutoMode 前置（一键打包/发布的全部打包入口）
#
# 历史教训（为什么收敛为单源）：门禁逻辑曾内联复制 3 份，2026-08-31
#   离线桌面打包被误拦——白名单漏了 APP 版 build.gradle versionCode
#   自动递增（打包自身改动），3 处需同时修。副本演化=事故根因
#   （同 artifact-locate.js 教训）。改本文件 = 三处同步生效。
#
# 判定语义：git 工作区相对 HEAD 的修改中，除「打包自身产物」外存在
#   任何源码修改 = 未落定 → 返回非空 blockers 数组（空数组=落定）。
#
# 白名单（不拦）：
#   ??           未跟踪文件（dist/build_output 等构建产物）
#   package.json / build-meta.json（桌面版打包版本 bump，全路径 basename 匹配）
#   build.gradle 且全部改动行仅为 versionCode/versionName（APP 版打包 bump；
#     行级 diff 精判——build.gradle 其余内容是真实源码，整文件放行会开洞）
#
# 保险丝：ALLOW_DIRTY_BUILD=1（由调用方检查，本函数不管）
# 非仓库环境（无 .git）：返回空（放行，不误拦）
# ============================================================================
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

        $base = Split-Path $path -Leaf
        if ($base -eq 'package.json' -or $base -eq 'build-meta.json') { continue }

        if ($base -eq 'build.gradle') {
            # git diff HEAD 含 staged+unstaged（对齐 status --porcelain 的语义）
            $diff = @(& git -C $RepoRoot diff HEAD -- $path 2>$null) |
                Where-Object { $_ -match '^[+-]' -and $_ -notmatch '^(\+\+\+|---) ' }
            $nonVersion = @($diff | Where-Object { $_ -notmatch '^[+-]\s*(versionCode|versionName)\s' })
            if ($diff.Count -gt 0 -and $nonVersion.Count -eq 0) { continue }   # 纯版本 bump → 放行
        }

        [void]$blockers.Add(("{0}  {1}" -f $status2.Trim(), $path))
    }
    return @($blockers)
}
