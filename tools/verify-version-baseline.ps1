# ============================================================================
#  verify-version-baseline.ps1
#  ★ 2026-09-23 新增：打包前"版本基线漂移"门禁（1.0.253/254 重名覆盖事故防呆）
#
#  事故场景：
#    上一次打包 bump 了 package.json version / build.gradle versionCode，但
#    版本号副作用没有入库（直接调 ps1 未带 -AutoCommit / AutoCommit 推送失败 /
#    事后 git checkout 还原过版本文件），HEAD 里的版本基线落后于 dist 中
#    已存在的最新产物。此时再打包：
#      - 桌面：bump 出来的 Setup 版本与现存产物【同名覆盖】，且达不到预期版本号
#        （HEAD=1.0.252 + dist 已有 253 → 本次又出 253，用户预期的 254 消失）；
#      - APP：versionCode 被原地踩两遍，R8 产物无法区分先后。
#
#  检测（4 个打包单元）：
#    形态B（工作区遗留 bump）：工作区版本号 ≠ git HEAD 版本号 → FAIL
#    形态A（bump 丢失但产物留下，仅桌面可检出）：
#                            dist 中 exe 文件名最高版本 > HEAD 版本 → FAIL
#    APP 形态A：APK 文件名不含 versionCode，aapt 非通用依赖，不做低成本检测，
#              靠形态B + -AutoCommit 默认开启收口。
#
#  退出码：0=通过（含全部 WARN 跳过）；2=检出漂移（调用方必须中止打包）；
#          1=本脚本自身异常（调用方按 WARN 放行，不得因工具故障阻断打包）。
#  保险丝：ALLOW_VERSION_DRIFT=1 时调用方根本不启动本脚本。
#
#  用法：
#    powershell -NoProfile -ExecutionPolicy Bypass -File tools\verify-version-baseline.ps1
# ============================================================================
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

try {
    # --- 定位仓库根（向上找 .git）---
    $repoRoot = Split-Path $MyInvocation.MyCommand.Path -Parent
    while ($repoRoot -and -not (Test-Path (Join-Path $repoRoot '.git'))) {
        $repoRoot = Split-Path $repoRoot -Parent
    }
    if (-not $repoRoot) { throw '无法定位仓库根（.git 不存在）' }
    Push-Location $repoRoot

    # --- git 可用性 ---
    $gitVer = & git --version 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host '[version-baseline][WARN] git 不可用，跳过版本基线检测' -ForegroundColor Yellow
        exit 0
    }

    # 单元定义：Type=desktop 查 package.json+dist exe；Type=app 查 build.gradle versionCode
    $units = @(
        @{ Label='本地桌面'; Type='desktop'; PkgRel='app_project/db-offline/desktop/package.json';
           DistRel='app_project/db-offline/desktop/dist' }
        @{ Label='云端桌面'; Type='desktop'; PkgRel='app_project/db-yunduan/cloud_desktop/package.json';
           DistRel='app_project/db-yunduan/cloud_desktop/dist' }
        @{ Label='本地APP'; Type='app'; GradleRel='app_project/db-offline/app/app/build.gradle' }
        @{ Label='云端APP'; Type='app'; GradleRel='app_project/db-yunduan/cloud_app/app/build.gradle' }
    )

    $drifts = @()

    foreach ($u in $units) {
        if ($u.Type -eq 'desktop') {
            $rel = $u.PkgRel
            $abs = Join-Path $repoRoot ($rel -replace '/', '\')
            if (-not (Test-Path $abs)) {
                Write-Host ("[version-baseline][WARN] {0}：版本文件缺失，跳过 ({1})" -f $u.Label, $rel) -ForegroundColor Yellow
                continue
            }
            # HEAD 中已提交版本
            $headText = (& git show "HEAD:$rel" 2>$null) -join "`n"
            if ($LASTEXITCODE -ne 0 -or $headText -notmatch '"version"\s*:\s*"([^"]+)"') {
                Write-Host ("[version-baseline][WARN] {0}：无法读取 git HEAD 版本，跳过" -f $u.Label) -ForegroundColor Yellow
                continue
            }
            [version]$headVer = $Matches[1]
            # 工作区当前版本
            $workText = Get-Content $abs -Raw -Encoding UTF8
            [version]$workVer = if ($workText -match '"version"\s*:\s*"([^"]+)"') { $Matches[1] } else { $null }

            $unitDrift = $false
            if ($workVer -and $workVer -ne $headVer) {
                Write-Host ("[version-baseline][DRIFT] {0}：工作区 package.json 版本 {1} 未入库（HEAD={2}）——上次打包的版本号递增没有提交" -f $u.Label, $workVer, $headVer) -ForegroundColor Red
                $drifts += ("{0}：未入库的版本号 {1}（HEAD={2}），请先补提交版本号副作用，或 git checkout 还原该文件" -f $u.Label, $workVer, $headVer)
                $unitDrift = $true
            }
            if (-not $unitDrift) {
                # 形态A：dist 中最高版本的 exe 不得高于 HEAD 基线
                $distDir = Join-Path $repoRoot ($u.DistRel -replace '/', '\')
                if (Test-Path $distDir) {
                    $maxExe = $null
                    Get-ChildItem (Join-Path $distDir '*.exe') -ErrorAction SilentlyContinue | ForEach-Object {
                        if ($_.Name -match '(\d+\.\d+\.\d+)') {
                            $cand = [version]$Matches[1]
                            if (-not $maxExe -or $cand -gt $maxExe) { $maxExe = $cand }
                        }
                    }
                    if ($maxExe -and $maxExe -gt $headVer) {
                        Write-Host ("[version-baseline][DRIFT] {0}：dist 最新产物版本 {1} 高于 HEAD 基线 {2}——本次打包只会重新生成 {1} 并同名覆盖，不会得到 {3}" -f $u.Label, $maxExe, $headVer, ([version]::new($maxExe.Major, $maxExe.Minor, $maxExe.Build + 1))) -ForegroundColor Red
                        $drifts += ("{0}：dist 产物 {1} > HEAD {2}（上次打包版本号未入库/被还原）。处理：确认 {1} 产物去留——要保留则先把 package.json 版本对齐/补提交到 {1}；要废弃则归档 dist 中 {1} 的 exe 后重打" -f $u.Label, $maxExe, $headVer)
                    } else {
                        Write-Host ("[version-baseline][OK] {0}：HEAD 基线 {1}，dist 最高产物 {2}" -f $u.Label, $headVer, ($(if ($maxExe) { $maxExe } else { '无' }))) -ForegroundColor Green
                    }
                } else {
                    Write-Host ("[version-baseline][OK] {0}：HEAD 基线 {1}（dist 不存在，首打）" -f $u.Label, $headVer) -ForegroundColor Green
                }
            }
        }
        else {
            # APP 单元：只检形态B（工作区 versionCode/versionName 与 HEAD 不一致）
            $rel = $u.GradleRel
            $abs = Join-Path $repoRoot ($rel -replace '/', '\')
            if (-not (Test-Path $abs)) {
                Write-Host ("[version-baseline][WARN] {0}：build.gradle 缺失，跳过 ({1})" -f $u.Label, $rel) -ForegroundColor Yellow
                continue
            }
            $headText = (& git show "HEAD:$rel" 2>$null) -join "`n"
            if ($LASTEXITCODE -ne 0 -or $headText -notmatch 'versionCode\s+(\d+)') {
                Write-Host ("[version-baseline][WARN] {0}：无法读取 git HEAD versionCode，跳过" -f $u.Label) -ForegroundColor Yellow
                continue
            }
            $headCode = [int]$Matches[1]
            $headName = if ($headText -match 'versionName\s+"([^"]+)"') { $Matches[1] } else { '' }
            $workText = Get-Content $abs -Raw -Encoding UTF8
            $workCode = if ($workText -match 'versionCode\s+(\d+)') { [int]$Matches[1] } else { -1 }
            $workName = if ($workText -match 'versionName\s+"([^"]+)"') { $Matches[1] } else { '' }

            if ($workCode -ge 0 -and ($workCode -ne $headCode -or $workName -ne $headName)) {
                Write-Host ("[version-baseline][DRIFT] {0}：工作区 build.gradle 版本 versionCode={1}/versionName={2} 未入库（HEAD={3}/{4}）——上次打包的版本号递增没有提交" -f $u.Label, $workCode, $workName, $headCode, $headName) -ForegroundColor Red
                $drifts += ("{0}：未入库的 versionCode={1}（HEAD={2}），请先补提交 build.gradle 版本号副作用，或 git checkout 还原该文件" -f $u.Label, $workCode, $headCode)
            } else {
                Write-Host ("[version-baseline][OK] {0}：HEAD versionCode={1}" -f $u.Label, $headCode) -ForegroundColor Green
            }
        }
    }

    if ($drifts.Count -gt 0) {
        Write-Host ''
        Write-Host '========================================' -ForegroundColor Red
        Write-Host ('[FATAL] 版本基线漂移 {0} 处，打包中止（防止产物重名覆盖/假新版本）' -f $drifts.Count) -ForegroundColor Red
        Write-Host '========================================' -ForegroundColor Red
        $i = 0
        foreach ($d in $drifts) { $i++; Write-Host ("  {0}. {1}" -f $i, $d) -ForegroundColor Yellow }
        Write-Host ''
        Write-Host '  常规修复（推荐）：双击 一键打包.bat 正常打包会自动 -AutoCommit 收纳版本号；' -ForegroundColor Yellow
        Write-Host '    若版本号已被还原而产物保留：按上面各条提示补提交或归档旧产物后重打。' -ForegroundColor Yellow
        Write-Host '  确认要强制继续（自担重名覆盖风险）：set ALLOW_VERSION_DRIFT=1 后重跑。' -ForegroundColor DarkGray
        exit 2
    }

    Write-Host '[version-baseline] 版本基线检测通过 OK（HEAD 版本号不落后于现存产物）' -ForegroundColor Green
    exit 0
}
catch {
    Write-Host "[version-baseline][WARN] 检测脚本自身异常，跳过不阻断打包: $($_.Exception.Message)" -ForegroundColor Yellow
    exit 1
}
finally {
    Pop-Location 2>$null
}
