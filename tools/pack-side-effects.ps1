# ============================================================================
# pack-side-effects.ps1 — 打包副作用文件清单（★ 单一权威源，2026-08-31）
#
# 背景（举一反三）：1.2.194 事故后建「源码落定门」白名单，首版只列桌面版
#   package.json —— 次日 build.gradle versionCode 误拦（APP 打包自身递增）；
#   排查又发现 hash-manifest.json（产物哈希清单，打包自动重写）也不在白名单
#   = 下一次打包后必然再误拦。根因：门禁白名单与 one-click-pack 的
#   SideEffectCollect autoPatterns 是两份各自维护的清单，演化必然漂移。
#   本文件把「打包工具会自动改哪些文件」收敛为一份，两个消费方共用：
#     ① source-settled.ps1   —— 源码落定门：副作用文件不拦（防误报）
#     ② one-click-pack.ps1   — SideEffectCollect：副作用文件自动收纳提交
#   以后新增副作用类型只改这里，两边同时生效。
#
# 铁律（来自 2026-08-31 双事故）：凡"打包自身改动"文件新增（如新版本
#   bump 目标、新产物清单），必须在本清单登记，否则源码落定门误拦
#   （用户打包被红线挡住）或副作用散落（"本机有、仓库无"基线偏差）。
# ============================================================================

# 确定性副作用文件（整文件放行/自动收纳）：打包工具自动递增或重写，
# 不含人工语义。basename 匹配（全仓库范围）。
$script:PackSideEffectExactNames = @(
    'package.json',      # 桌面版版本号递增（bump-version.ps1）
    'build-meta.json',   # 桌面版打包元数据（build.bat 重写）
    'hash-manifest.json' # 产物哈希清单（打包/发布链路重写）
)

# ★ 2026-08-31（晚）发布链路产物路径前缀（首次真实发布实战暴露的盲区）：
#   publish-release.js 发布时同步复制 APK 到 public/downloads/ 并重写
#   public/updates/*/latest.json（触发 Cloudflare 部署的官网产物文件）——
#   它们是发布工具自身写入的副作用，不是 AI 半成品；首次 --push 被落定门
#   误拦（同 build.gradle versionCode 同构事故：工具写产物→白名单盲区）。
#   前缀整目录放行（该目录按设计入库供官网部署，人工不会在其中改源码）。
$script:PackSideEffectDirPrefixes = @(
    '^public/downloads/',
    '^public/updates/'
)

# 特殊副作用（行级精判）：build.gradle 是真实源码（签名/混淆/NDK 配置），
# 只有当 git diff HEAD 的全部 +/- 行均为 versionCode/versionName 时才视为
# 打包副作用——整文件放行会开洞（改坏签名配置必须拦）。
$script:PackSideEffectGradleRegex = '^app_project/.+/build\.gradle$'

# SideEffectCollect 自动收纳范围（与门禁白名单同源派生；此正则仅供
# one-click-pack 按仓库相对路径过滤，保持既有行为）。
function Get-PackSideEffectAutoPatterns {
    return @(
        $script:PackSideEffectGradleRegex
        '^app_project/.+/package\.json$'
        '^public/hash-manifest\.json$'
        '^app_project/.+/hash-manifest\.json$'
    )
}

# 判定一个 git status 路径是否为打包副作用文件。
# $DiffLines：build.gradle 场景传入 `git diff HEAD -- <path>` 的行数组；
#   其余场景传 $null（整文件判定）。
function Test-IsPackSideEffect {
    param(
        [Parameter(Mandatory = $true)][string]$GitPath,   # 仓库相对路径（正斜杠）
        [string[]]$DiffLines = $null
    )
    $base = Split-Path $GitPath -Leaf
    if ($script:PackSideEffectExactNames -contains $base) { return $true }
    foreach ($pfx in $script:PackSideEffectDirPrefixes) {
        if ($GitPath -match $pfx) { return $true }
    }

    if ($GitPath -match $script:PackSideEffectGradleRegex) {
        if ($null -eq $DiffLines) { return $false }   # 无 diff 信息从严：拦
        $changes = @($DiffLines | Where-Object { $_ -match '^[+-]' -and $_ -notmatch '^(\+\+\+|---) ' })
        if ($changes.Count -eq 0) { return $true }    # 无实质行变化（如仅 touch）
        $nonVersion = @($changes | Where-Object { $_ -notmatch '^[+-]\s*(versionCode|versionName)\s' })
        return ($nonVersion.Count -eq 0)
    }
    return $false
}
