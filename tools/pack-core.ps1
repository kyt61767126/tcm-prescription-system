# pack-core.ps1 - 打包增量基线核心（单一权威源）
# ★ 2026-10-30 P0 去重：Get-TimeStamp / Test-BuildSkip / Record-BuiltUnits 原在
#   one-click-pack.ps1 与 release-menu.ps1 各写一份，且两份 Record-BuiltUnits 行为已分叉
#   （release-menu 版不写 .build-cache/last-run.json → 从发布菜单打包后"本次更新哪几端"
#   摘要失真）。现统一到此文件，one-click-pack 与 release-menu 均 dot-source。
#
# 依赖调用方提供脚本作用域变量：
#   $script:RootDir   仓库根目录
#   $script:BuiltUnits 本次实际执行打包的单元（SKIP 的不计入）
# 依赖 noise-reduce.ps1 的 Write-HostLine（降噪渲染）。
#
# ★ 铁律：last-run.json 只允许「真正执行打包的进程」写入一次。release-menu 通过子进程
#   one-click-pack -AutoMode 打包，子进程已写入基线；父进程再调用会以空 built 覆盖真值，
#   因此 release-menu 禁止调用本函数（已移除调用点）。

function Get-TimeStamp {
    return (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
}

# 检查某端是否可跳过打包（指纹=git HEAD+源码干净+产物哈希 三者一致 → true）
function Test-BuildSkip([string]$unit) {
    if ($env:NO_BUILD_SKIP -eq '1') { return $false }
    $skipTool = Join-Path $PSScriptRoot 'build-skip.ps1'
    if (-not (Test-Path $skipTool)) { return $false }
    & $env:ComSpec /c "powershell -NoProfile -ExecutionPolicy Bypass -File $skipTool -Check -Unit $unit 2>&1" | ForEach-Object { Write-HostLine $_ -Indent '  ' }
    return ($LASTEXITCODE -eq 0)
}

# 记录本次已打包单元的基线（供下次 Check 跳过）+ 写 .build-cache/last-run.json 摘要。
# 必须在"打包成功+副作用 AutoCommit 后"调用（HEAD 才稳定，指纹才可信）。
function Record-BuiltUnits {
    $stateDir = Join-Path $script:RootDir '.build-cache'
    if (-not (Test-Path $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }
    $stateFile = Join-Path $stateDir 'last-run.json'
    try {
        $payload = @{ time = (Get-TimeStamp); built = @($script:BuiltUnits) }
        ConvertTo-Json -InputObject $payload | Out-File -FilePath $stateFile -Encoding utf8
    } catch {
        Write-Host "  [WARN] 更新摘要状态写入失败(不影响打包): $_" -ForegroundColor Yellow
    }
    if (-not $script:BuiltUnits -or $script:BuiltUnits.Count -eq 0) { return }
    $skipTool = Join-Path $PSScriptRoot 'build-skip.ps1'
    if (-not (Test-Path $skipTool)) { return }
    Write-Host ""
    Write-Host "--- 打包增量基线记录 ---" -ForegroundColor Cyan
    foreach ($u in $script:BuiltUnits) {
        & $env:ComSpec /c "powershell -NoProfile -ExecutionPolicy Bypass -File $skipTool -Record -Unit $u 2>&1" | ForEach-Object { Write-HostLine $_ -Indent '  ' }
    }
    $script:BuiltUnits = @()
}
