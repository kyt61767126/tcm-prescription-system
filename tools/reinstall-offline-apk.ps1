# ============================================================================
# reinstall-offline-apk.ps1 — 一键卸载旧版离线APP + 安装最新APK（USB/adb）
#
# 用法（推荐双击项目根目录 一键重装离线APP.bat，或手动）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\reinstall-offline-apk.ps1
#   参数：-Yes 跳过卸载确认（自动化）  -SkipLaunch 装完不自动启动
#
# 流程：
#   1. 定位 adb（LOCALAPPDATA / ANDROID_HOME / 常见SDK目录 / PATH）
#   2. 定位最新 APK（db-offline 根 惠康中医-本地.apk，回退 build outputs）
#      并读取 APK 内 build-meta.json 显示打包时间（批次自证，防装错包）
#   3. 检查设备连接（未授权/无设备给出 USB 调试开启指引）
#   4. 卸载 com.benneng.pres.dingzhi（未安装则直接全新安装）
#   5. 复制 APK 到临时 ASCII 路径再安装（规避 adb 中文路径兼容问题），
#      手机屏幕可能弹『允许USB安装』确认框
#   6. 验证 versionCode + 自动拉起 APP
# ============================================================================

param(
    [switch]$Yes,
    [switch]$SkipLaunch
)

# 注意：不用 'Stop'——adb daemon 首启的 stderr 提示在 PS5.1 + 2>&1 重定向下会被
# 误升级为终止错误；所有错误路径均已显式校验（Success 匹配/存在性检查）。
$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$PACKAGE = 'com.benneng.pres.dingzhi'
$PROJECT_ROOT = Split-Path -Parent $PSScriptRoot   # tools/ -> 项目根
$APK_CANDIDATES = @(
    (Join-Path $PROJECT_ROOT 'app_project\db-offline\惠康中医-本地.apk'),
    (Join-Path $PROJECT_ROOT 'app_project\db-offline\app\app\build\outputs\apk\release\app-release.apk')
)

function Ok($m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function Info($m) { Write-Host $m -ForegroundColor Cyan }
function Warn($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Err($m)  { Write-Host "[ERROR] $m" -ForegroundColor Red }

Write-Host "============================================================" -ForegroundColor DarkCyan
Write-Host "  惠康中医离线APP — 卸载旧版 + 安装最新APK" -ForegroundColor DarkCyan
Write-Host "============================================================" -ForegroundColor DarkCyan
Write-Host ""

# ---------- 1. 定位 adb ----------
$adbCandidates = @()
if ($env:LOCALAPPDATA) { $adbCandidates += (Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe') }
if ($env:ANDROID_HOME) { $adbCandidates += (Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe') }
$adbCandidates += @('C:\Android\Sdk\platform-tools\adb.exe', 'D:\Android\Sdk\platform-tools\adb.exe')
$adb = $null
foreach ($c in $adbCandidates) { if (Test-Path $c) { $adb = $c; break } }
if (-not $adb) {
    $cmd = Get-Command adb -ErrorAction SilentlyContinue
    if ($cmd) { $adb = $cmd.Source }
}
if (-not $adb) {
    Err "未找到 adb.exe（Android platform-tools）"
    Info "请安装 Android SDK platform-tools，或设置环境变量 ANDROID_HOME"
    exit 1
}
Ok "adb: $adb"

# ---------- 2. 定位 APK + 批次自证 ----------
$apk = $null
foreach ($c in $APK_CANDIDATES) { if ($c -and (Test-Path $c)) { $apk = $c; break } }
if (-not $apk) {
    Err "未找到离线APP APK"
    Info "路径1: $($APK_CANDIDATES[0])"
    Info "路径2: $($APK_CANDIDATES[1])"
    Info "请先双击 一键打包.bat 打包（选项 2 = 离线端）"
    exit 1
}
$f = Get-Item $apk
Ok "APK: $apk"
Info ("     大小: {0:N0} 字节  |  文件时间: {1}" -f $f.Length, $f.LastWriteTime)

# 读取 APK 内 build-meta.json（版本三元组批次自证）
$buildTime = ''
try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
    $zip = [System.IO.Compression.ZipFile]::OpenRead($apk)
    try {
        $entry = $zip.Entries | Where-Object { $_.FullName -eq 'assets/public/build-meta.json' } | Select-Object -First 1
        if ($entry) {
            $sr = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::UTF8)
            $meta = $sr.ReadToEnd() | ConvertFrom-Json
            $sr.Close()
            $buildTime = "V$($meta.version) | $($meta.archMarker) | Build $($meta.buildTimeLocal)"
        }
    } finally { $zip.Dispose() }
} catch {}
if ($buildTime) { Ok "APK 批次: $buildTime" }
else { Warn "APK 内无 build-meta.json（旧批次包，登录页不显示打包时间）——建议重新打包后再分发" }
Write-Host ""

# ---------- 3. 检查设备 ----------
Info "正在检测已连接的安卓设备..."
$null = & $adb start-server 2>$null
Start-Sleep -Milliseconds 500
$devOut = & $adb devices -l 2>&1
$lines = @($devOut | Where-Object { $_ -match '^\S+\s+(device|unauthorized|offline)\b' })
$ready = @(); $unauth = @()
foreach ($ln in $lines) {
    $status = ($ln -split '\s+')[1]
    if ($status -eq 'device') { $ready += $ln } else { $unauth += $ln }
}
if ($unauth.Count -gt 0 -and $ready.Count -eq 0) {
    Err "设备已连接但未授权 USB 调试"
    Info "请在手机屏幕上找到『允许 USB 调试吗？』弹窗，勾选『一律允许』后点确定"
    Info "若无弹窗：拔掉数据线重插一次即可再次触发"
    exit 1
}
if ($ready.Count -eq 0) {
    Err "未检测到已连接的安卓设备"
    Info "排查步骤："
    Info "  1. 用 USB 数据线连接手机与电脑（需支持数据传输的线，非纯充电线）"
    Info "  2. 开启手机『开发者选项 → USB 调试』"
    Info "     （设置→关于手机→连续点击『版本号』7次开启开发者选项）"
    Info "  3. 手机弹出『允许 USB 调试』时勾选一律允许并确定"
    Info "  4. 部分手机需把 USB 模式从『仅充电』改为『传输文件』"
    Write-Host ""
    Info "（不想用数据线：也可电脑微信发送 APK 到手机安装，装好后打开APP登录页"
    Info "  核对底部版本行 Build 时间是否为上面显示的打包时间，即可确认没装错包）"
    exit 1
}

# ---------- 4. 选择设备 ----------
$serial = $null
if ($ready.Count -eq 1) {
    $serial = ($ready[0] -split '\s+')[0]
    $model = if ($ready[0] -match 'model:(\S+)') { $Matches[1] } else { '' }
    Ok "已连接设备: $serial  $model"
} else {
    Info "检测到多台设备，请选择："
    for ($i = 0; $i -lt $ready.Count; $i++) {
        $model = if ($ready[$i] -match 'model:(\S+)') { $Matches[1] } else { '' }
        Info ("  [{0}] {1}  {2}" -f ($i + 1), ($ready[$i] -split '\s+')[0], $model)
    }
    $sel = Read-Host "输入序号 (1-$($ready.Count)) 后回车"
    $idx = 0
    if (-not [int]::TryParse($sel, [ref]$idx) -or $idx -lt 1 -or $idx -gt $ready.Count) {
        Err "无效选择，已取消"
        exit 1
    }
    $serial = ($ready[$idx - 1] -split '\s+')[0]
}
Write-Host ""

# ---------- 5. 卸载旧版 ----------
$pkgList = & $adb -s $serial shell pm list packages $PACKAGE 2>$null
if ("$pkgList" -match [regex]::Escape($PACKAGE)) {
    Info "手机上已安装旧版本，准备卸载..."
    if (-not $Yes) {
        Warn "卸载将清空该APP全部数据（注册信息/激活状态/处方数据）"
        Warn "—— 适合『新用户全流程测试』场景；如需保留数据请改为手动升级安装"
        $c = Read-Host "确认卸载并安装新APK？(直接回车=继续, 输入 Q=取消)"
        if ($c -match '^[qQ]') { Info "已取消，未做任何改动"; exit 0 }
    }
    $uOut = & $adb -s $serial uninstall $PACKAGE 2>&1
    if ("$uOut" -match 'Success') { Ok "旧版本已卸载" }
    else { Warn "卸载返回: $uOut（若未安装过属正常，继续安装）" }
} else {
    Info "手机上未安装该APP，直接全新安装"
}
Write-Host ""

# ---------- 6. 安装新APK（临时ASCII路径，规避中文路径兼容问题） ----------
$tmpApk = Join-Path $env:TEMP ("hkzy-offline-" + (Get-Date -Format 'yyyyMMddHHmmss') + ".apk")
Copy-Item $apk $tmpApk -Force
try {
    Info "正在安装新APK（请在手机屏幕留意『允许USB安装』确认框，点击允许）..."
    $iOut = & $adb -s $serial install -r $tmpApk 2>&1
    if ("$iOut" -match 'Success') { Ok "安装成功" }
    else {
        Err "安装失败: $iOut"
        Info "常见原因："
        Info "  1. 开发者选项需开启『USB安装』（小米/华为等国产手机常见）"
        Info "  2. 手机存储空间不足"
        Info "  3. 账号登录了手机厂商云服务（如小米需退出小米账号才能USB安装）"
        exit 1
    }
} finally {
    Remove-Item $tmpApk -Force -ErrorAction SilentlyContinue
}

# ---------- 7. 验证 + 启动 ----------
$dump = & $adb -s $serial shell dumpsys package $PACKAGE 2>$null
$vcLine = @($dump | Select-String 'versionCode=') | Select-Object -First 1
if ($vcLine -and $vcLine.Line -match 'versionCode=(\d+)') {
    Ok "已安装 versionCode: $($Matches[1])"
    if ($buildTime) { Info "  批次: $buildTime" }
} else {
    Warn "无法读取版本信息，请手动打开APP在登录页核对版本"
}

if (-not $SkipLaunch) {
    Info "正在启动APP..."
    $null = & $adb -s $serial shell monkey -p $PACKAGE -c android.intent.category.LAUNCHER 1 2>$null
    Ok "APP 已启动——请在登录页核对底部版本行（Build 时间=上方批次时间即正确）"
}
Write-Host ""
Ok "全部完成！"
