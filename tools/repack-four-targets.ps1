# ============================================================================
# repack-four-targets.ps1 — 双桌面 + 双 APK 重打包（含产物落位硬核验）
# ----------------------------------------------------------------------------
# 为什么需要本脚本：
#   1) 主进程改动（shared/desktop-fs-ipc.cjs + preload.js）在 asar 内 —— 热更（只换
#      index.html）覆盖不到，必须整包重打才生效；
#   2) Java 桥改动（MainActivity.java / NativeBridge.ets）必须重打 APK；
#   3) 打包链有「增量跳过」（tools/build-skip.ps1 指纹），一旦误判「已是最新」，
#      用户会继续装到旧包却以为已修复（KNOWLEDGE 第 5 章铁律：打包后必须解包 grep 验证）。
#   故本脚本 = 四端整包重打 + 解包核验关键标记，二者缺一不可。
#
# 复用（铁律：打包逻辑单一权威源，禁止另起炉灶 / 禁止直接调 gradle）：
#   实际打包统一委托 tools/one-click-pack.ps1 -AutoMode 3
#   （3=全部：云端桌面 → 云端APP → 离线桌面 → 离线APP）
#
# 核验标记（2026-10-20「自动备份可恢复 + 备份与恢复面板」批次）：
#   桌面 asar ：delete-backup-file（主进程 IPC）/ deleteBackupFile（preload+前端）
#               buildBackupPayload（统一载荷）/ 备份与恢复（面板入口）
#   APP  APK  ：assets/public/index.html 含 buildBackupPayload + 备份与恢复
#               classes*.dex 含 deleteBackupFile（Java 桥方法与注入串）
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\repack-four-targets.ps1
#   powershell ... -File tools\repack-four-targets.ps1 -Force       # 忽略增量跳过，四端强制重打
#   powershell ... -File tools\repack-four-targets.ps1 -SkipPack    # 只核验现有产物，不打包
#   退出码：0=打包成功且四端产物核验通过；1=打包失败或有产物核验不通过
# ============================================================================
param(
    [switch]$Force,      # 强制重打：置 NO_BUILD_SKIP=1，忽略增量跳过（默认尊重跳过）
    [switch]$SkipPack,   # 跳过打包，只做产物核验（打包后单独复核 / CI 用）
    [switch]$NoCommit    # 不自动收纳打包副作用（默认 -AutoCommit，与 一键打包.bat 同口径）
)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# 仓库根 = 脚本上级；被移动时向上找含 app_project 的目录（与 one-click-pack 同口径）
$script:Root = Split-Path $PSScriptRoot -Parent
$probe = $script:Root
while ($probe -and -not (Test-Path (Join-Path $probe 'app_project'))) { $probe = Split-Path $probe -Parent }
if ($probe) { $script:Root = $probe }

# 子构建 .bat / one-click-pack 全程不暂停
$env:NO_PAUSE = '1'
if ($Force) { $env:NO_BUILD_SKIP = '1' } else { Remove-Item Env:\NO_BUILD_SKIP -ErrorAction SilentlyContinue }

# 红字降噪单一权威源（禁止内联复制渲染逻辑）
. (Join-Path $PSScriptRoot 'noise-reduce.ps1')

Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
$script:Latin1 = [System.Text.Encoding]::GetEncoding(28591)
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# 本批必须落进产物的关键标记（改批次时只改这里）
$script:Markers = @{
    AsarAscii = @('delete-backup-file', 'deleteBackupFile', 'buildBackupPayload')
    AsarUtf8  = @('备份与恢复')
    ApkAscii  = @('deleteBackupFile')
    ApkUtf8   = @('buildBackupPayload', '备份与恢复')
}

$script:PackScript = Join-Path $PSScriptRoot 'one-click-pack.ps1'

function Get-TimeText { return (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') }

# 在文本中查标记（Ordinal 精确匹配，避免中文被忽略大小写文化比较干扰）
function Test-Mark {
    param([string]$Text, [string]$Needle)
    if ([string]::IsNullOrEmpty($Text)) { return $false }
    return ($Text.IndexOf($Needle, [System.StringComparison]::Ordinal) -ge 0)
}

# ---- 桌面单元核验：整份 app.asar 双编码扫描（asar 内容为明文拼接，全量扫即最强覆盖）----
function Test-DesktopUnit {
    param([hashtable]$Unit, [datetime]$StartTime, [bool]$CheckFresh)

    $asar = Join-Path $Unit.Dist 'win-unpacked\resources\app.asar'
    $exe = Get-ChildItem (Join-Path $Unit.Dist '*.exe') -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1

    $notes = @()
    $markers = ''

    if (-not (Test-Path -LiteralPath $asar)) {
        if ($exe) { $notes += ('缺少 app.asar（dir 半成品）: ' + $asar) }
        else { $notes += ('未找到打包产物目录: ' + $Unit.Dist) }
        return [PSCustomObject]@{
            Label = $Unit.Label; Kind = '桌面'; Artifact = ($(if ($exe) { $exe.FullName } else { $asar }))
            SizeMB = $(if ($exe) { [math]::Round($exe.Length / 1MB, 1) } else { 0 })
            Time = $(if ($exe) { $exe.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') } else { '-' })
            Ok = $false; Markers = '-'; Notes = ($notes -join '；')
        }
    }

    $fi = Get-Item -LiteralPath $asar
    $bytes = [System.IO.File]::ReadAllBytes($asar)
    $iso = $script:Latin1.GetString($bytes)
    $utf = $script:Utf8NoBom.GetString($bytes)
    $bytes = $null

    $ok = $true
    foreach ($m in $script:Markers.AsarAscii) {
        if (-not (Test-Mark $iso $m)) { $ok = $false; $notes += "asar 缺标记: $m" }
    }
    foreach ($m in $script:Markers.AsarUtf8) {
        if (-not (Test-Mark $utf $m)) { $ok = $false; $notes += "asar 缺标记: $m" }
    }
    $iso = $null; $utf = $null
    $markers = $(if ($ok) { '全部命中' } else { '有缺失' })

    if ($CheckFresh -and $fi.LastWriteTime -lt $StartTime.AddMinutes(-1)) {
        $ok = $false
        $notes += ('asar 非本次产出（文件时间 ' + $fi.LastWriteTime.ToString('HH:mm:ss') + ' 早于本次开始）')
    }
    if (-not $exe) { $notes += '无安装包 exe（可能已被清理，可再跑一次打包出包）' }

    return [PSCustomObject]@{
        Label = $Unit.Label; Kind = '桌面'; Artifact = $asar
        SizeMB = [math]::Round($fi.Length / 1MB, 1)
        Time = $fi.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
        Ok = $ok; Markers = $markers; Notes = ($notes -join '；')
    }
}

# ---- APP 单元核验：取官方目标 APK（严格优先），只解需要的压缩条目 ----
function Select-TargetApk {
    param([string]$UnitDir, [string]$ExpectedName)

    $all = @(Get-ChildItem (Join-Path $UnitDir '*.apk') -ErrorAction SilentlyContinue)
    $exact = @($all | Where-Object { $_.Name -eq $ExpectedName })
    if ($exact.Count -gt 0) { return ($exact | Sort-Object LastWriteTime -Descending | Select-Object -First 1) }
    # 兜底：排除测试包/临时包，取最新
    $prod = @($all | Where-Object { $_.Name -notmatch '测试|test|tmp' })
    if ($prod.Count -gt 0) { return ($prod | Sort-Object LastWriteTime -Descending | Select-Object -First 1) }
    return ($all | Sort-Object LastWriteTime -Descending | Select-Object -First 1)
}

function Read-ZipEntryString {
    param($Zip, [string]$Name, [System.Text.Encoding]$Enc)
    $entry = $Zip.Entries | Where-Object { $_.FullName -eq $Name } | Select-Object -First 1
    if (-not $entry) { return $null }
    $s = $entry.Open()
    try {
        $ms = New-Object System.IO.MemoryStream
        $s.CopyTo($ms)
        $buf = $ms.ToArray()
        $ms.Dispose()
        return $Enc.GetString($buf)
    } finally { $s.Dispose() }
}

function Test-AppUnit {
    param([hashtable]$Unit, [datetime]$StartTime, [bool]$CheckFresh)

    $notes = @()
    $apk = Select-TargetApk -UnitDir $Unit.Dist -ExpectedName $Unit.ApkName
    if (-not $apk) {
        return [PSCustomObject]@{
            Label = $Unit.Label; Kind = 'APP'; Artifact = (Join-Path $Unit.Dist $Unit.ApkName)
            SizeMB = 0; Time = '-'; Ok = $false; Markers = '-'
            Notes = ('未找到 APK: ' + (Join-Path $Unit.Dist $Unit.ApkName))
        }
    }
    if ($apk.Name -ne $Unit.ApkName) { $notes += ('未取到规范名 ' + $Unit.ApkName + '，实际取 ' + $apk.Name) }

    $ok = $true
    $markers = ''
    $zip = $null
    try {
        $zip = [System.IO.Compression.ZipFile]::OpenRead($apk.FullName)

        $html = Read-ZipEntryString -Zip $zip -Name 'assets/public/index.html' -Enc $script:Utf8NoBom
        if ($null -eq $html) {
            $ok = $false; $notes += 'APK 内缺 assets/public/index.html'
        } else {
            foreach ($m in $script:Markers.ApkUtf8) {
                if (-not (Test-Mark $html $m)) { $ok = $false; $notes += "index.html 缺标记: $m" }
            }
            $html = $null
        }

        $dexEntries = @($zip.Entries | Where-Object { $_.FullName -match '^classes\d*\.dex$' })
        if ($dexEntries.Count -eq 0) {
            $ok = $false; $notes += 'APK 内未找到 classes*.dex'
        } else {
            $dexHit = $false
            foreach ($de in $dexEntries) {
                $txt = Read-ZipEntryString -Zip $zip -Name $de.FullName -Enc $script:Latin1
                foreach ($m in $script:Markers.ApkAscii) {
                    if (Test-Mark $txt $m) { $dexHit = $true }
                }
                $txt = $null
                if ($dexHit) { break }
            }
            if (-not $dexHit) {
                $ok = $false
                $notes += ('classes*.dex 缺标记: ' + ($script:Markers.ApkAscii -join ','))
            }
        }
        $markers = $(if ($ok) { '全部命中' } else { '有缺失' })
    } catch {
        $ok = $false; $notes += ('解包 APK 失败: ' + $_.Exception.Message)
    } finally {
        if ($zip) { $zip.Dispose() }
    }

    if ($CheckFresh -and $apk.LastWriteTime -lt $StartTime.AddMinutes(-1)) {
        $ok = $false
        $notes += ('APK 非本次产出（文件时间 ' + $apk.LastWriteTime.ToString('HH:mm:ss') + ' 早于本次开始）')
    }

    return [PSCustomObject]@{
        Label = $Unit.Label; Kind = 'APP'; Artifact = $apk.FullName
        SizeMB = [math]::Round($apk.Length / 1MB, 1)
        Time = $apk.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
        Ok = $ok; Markers = $markers; Notes = ($notes -join '；')
    }
}

# ============================== 主流程 ==============================
$units = @(
    @{ Label = '云端桌面'; Kind = 'desktop'; Dist = (Join-Path $script:Root 'app_project\db-yunduan\cloud_desktop\dist'); ApkName = '' }
    @{ Label = '云端APP';  Kind = 'app';     Dist = (Join-Path $script:Root 'app_project\db-yunduan');                           ApkName = '惠康中医-云端.apk' }
    @{ Label = '离线桌面'; Kind = 'desktop'; Dist = (Join-Path $script:Root 'app_project\db-offline\desktop\dist');             ApkName = '' }
    @{ Label = '离线APP';  Kind = 'app';     Dist = (Join-Path $script:Root 'app_project\db-offline');                          ApkName = '惠康中医-本地.apk' }
)

Write-Host ''
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host '  双桌面 + 双 APK 重打包（含产物落位核验）' -ForegroundColor Cyan
Write-Host ('  开始: ' + (Get-TimeText)) -ForegroundColor Cyan
Write-Host ('  模式: ' + $(if ($SkipPack) { '仅核验产物（不打包）' } elseif ($Force) { '强制重打（忽略增量跳过）' } else { '打包（尊重增量跳过）' })) -ForegroundColor Cyan
Write-Host ('  单元: 云端桌面 / 云端APP / 离线桌面 / 离线APP') -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan

$startTime = Get-Date
$packRc = 0

if (-not $SkipPack) {
    if (-not (Test-Path -LiteralPath $script:PackScript)) {
        Write-Host ('[FATAL] 缺少打包入口: ' + $script:PackScript) -ForegroundColor Red
        exit 1
    }
    Write-Host ''
    Write-Host '--- [1/2] 打包四端（委托 one-click-pack.ps1 -AutoMode 3）---' -ForegroundColor Yellow
    $packArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $script:PackScript, '-AutoMode', '3')
    if (-not $NoCommit) { $packArgs += '-AutoCommit' }
    # 直连模式（无 transcript）：保留子进程彩色输出与实时性，stderr 在 cmd 层合并（PS host 不染红）
    $packRc = Invoke-QuietProcess -FilePath 'powershell' -ArgumentList $packArgs
    if ($packRc -ne 0) {
        Write-Host ''
        Write-Host ('[ERROR] 四端打包失败，退出码: ' + $packRc) -ForegroundColor Red
        Write-Host '  产物核验仍在下方执行（便于判断打到第几端失败）。' -ForegroundColor Yellow
        Write-Host '  完整日志: .build-cache\logs\pack-*.log' -ForegroundColor Yellow
    } else {
        Write-Host ''
        Write-Host '[OK] 四端打包流程完成（成功横幅以 one-click-pack 输出为准）' -ForegroundColor Green
    }
}

Write-Host ''
Write-Host '--- [2/2] 产物落位核验（解 asar / 解 APK grep 关键标记）---' -ForegroundColor Yellow

$results = @()
foreach ($u in $units) {
    if ($u.Kind -eq 'desktop') { $results += Test-DesktopUnit -Unit $u -StartTime $startTime -CheckFresh (-not $SkipPack) }
    else { $results += Test-AppUnit -Unit $u -StartTime $startTime -CheckFresh (-not $SkipPack) }
    $r = $results[-1]
    if ($r.Ok) {
        Write-Host ('  [PASS] ' + $r.Label + ' —— ' + $r.Markers) -ForegroundColor Green
    } else {
        Write-Host ('  [FAIL] ' + $r.Label + ' —— ' + $r.Markers) -ForegroundColor Red
    }
    Write-Host ('         产物: ' + $r.Artifact) -ForegroundColor DarkGray
    Write-Host ('         ' + $r.SizeMB + ' MB | ' + $r.Time + $(if ($r.Notes) { ' | ' + $r.Notes })) -ForegroundColor DarkGray
}

$failed = @($results | Where-Object { -not $_.Ok })
$endTime = Get-TimeText
Write-Host ''
Write-Host '============================================================' -ForegroundColor $(if ($failed.Count -eq 0 -and $packRc -eq 0) { 'Green' } else { 'Red' })
if ($failed.Count -eq 0 -and $packRc -eq 0) {
    Write-Host '  [全部通过] 四端产物已含本批全部关键标记' -ForegroundColor Green
    Write-Host ('  结束: ' + $endTime) -ForegroundColor Green
    Write-Host ''
    Write-Host '  下一步（按需，人工闸）：' -ForegroundColor Yellow
    Write-Host '   - 热更重签：index.html 改动可出热包（桌面 desktop/local、desktop/cloud；APP app-local）' -ForegroundColor Yellow
    Write-Host '   - 真机回归：桌面装机 + APK 装机，验「自动备份落盘 → 面板列出 → 一键恢复 → 删自动/保手动」' -ForegroundColor Yellow
    Write-Host '   - 发布：一键发布.bat（打包产物禁止自动上传官网，须人工检查后上传）' -ForegroundColor Yellow
    Write-Host '============================================================' -ForegroundColor Green
    exit 0
}
if ($SkipPack) {
    Write-Host ('  [未通过] ' + $failed.Count + ' 端现有产物核验失败（本次未打包）') -ForegroundColor Red
} else {
    Write-Host ('  [未通过] ' + $failed.Count + ' 端产物核验失败；打包退出码: ' + $packRc) -ForegroundColor Red
}
foreach ($f in $failed) { Write-Host ('   - ' + $f.Label + ': ' + $f.Notes) -ForegroundColor Red }
if (-not $SkipPack -and $packRc -eq 0 -and $failed.Count -gt 0) {
    Write-Host '  提示：打包成功但标记缺失多因「增量跳过误判已最新」→ 加 -Force 重跑本脚本。' -ForegroundColor Yellow
}
Write-Host ('  结束: ' + $endTime) -ForegroundColor Red
Write-Host '============================================================' -ForegroundColor Red
exit 1
