# ============================================================================
#  printer-paper-a5.ps1 — 诊所机器打印机纸张检查/修复（免管理员）
#
#  用途：
#    桌面端「惠康中医」处方笺需要 A5（148×210mm）纸。Electron 35 在 Windows 走的是
#    原生系统打印对话框，pageSize 选项对对话框纸张无效，纸张取自 Windows 每用户
#    打印首选项（User Print Ticket，存 HKCU）。因此：
#      - 检查：报告每台本地打印机的「对话框默认纸」「驱动是否支持 A5」；
#      - 修复：把指定/默认打印机的 per-user 纸张设为 ISOA5（无需管理员、重启保留）。
#
#  参数：
#    （无参数）        = 检查模式（只读，不改任何设置）
#    -Fix              = 把「默认打印机」设为 A5
#    -Fix -All         = 把所有支持 A5 的本地打印机都设为 A5
#    -Fix -Printer 名称 = 只把指定打印机设为 A5
#
#  退出码：0=正常/A5 就绪；2=默认打印机不是 A5（需 -Fix）；3=驱动不支持 A5；1=脚本异常
#
#  注意：全程不需要管理员权限；只改每用户首选项，不动打印机服务器端默认配置。
# ============================================================================
[CmdletBinding()]
param(
    [switch]$Fix,
    [switch]$All,
    [string]$Printer = '',
    [switch]$SaveReport   # 额外把结果写成文本报告（每台机器跑一次，便于回收比对）
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
    Add-Type -AssemblyName System.Printing -ErrorAction Stop
} catch {
    Write-Host "[FATAL] 无法加载 System.Printing（系统组件缺失）: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

$A5 = 'ISOA5'

function Get-LocalPrinters {
    $list = @()
    try {
        $list = @(Get-Printer | Where-Object { $_.Type -eq 'Local' })
    } catch {
        $list = @()
    }
    if ($list.Count -eq 0) {
        # 兜底：Get-Printer 不可用时用 System.Printing 枚举
        $server = New-Object System.Printing.LocalPrintServer
        $list = @($server.GetPrintQueues() | Where-Object { $_.IsLocal -eq $true } | ForEach-Object {
            [pscustomobject]@{ Name = $_.Name; DriverName = $_.QueueDriver.Name }
        })
    }
    return $list
}

function Test-SupportsA5($queue) {
    try {
        $caps = $queue.GetPrintCapabilities()
        foreach ($s in $caps.PageMediaSizeCapability) {
            if ($s.PageMediaSizeName -eq $A5) { return $true }
        }
        return $false
    } catch {
        return $null   # 驱动不支持能力查询（虚拟打印机常见）
    }
}

function Get-UserPaper($queue) {
    try {
        $t = $queue.UserPrintTicket
        if ($t -and $t.PageMediaSize -and $t.PageMediaSize.PageMediaSizeName) {
            return [string]$t.PageMediaSize.PageMediaSizeName
        }
    } catch {}
    return ''
}

function Get-PrinterDefaultPaper([string]$name) {
    try {
        $cfg = Get-PrintConfiguration -PrinterName $name -ErrorAction Stop
        return [string]$cfg.PaperSize
    } catch { return '' }
}

function Test-IsDefaultPrinter([string]$name) {
    try {
        $w = Get-CimInstance Win32_Printer -Filter ("Name='" + ($name -replace "'", "''") + "'") -ErrorAction Stop
        return ($w.Default -eq $true)
    } catch { return $false }
}

# 纸张名归一：System.Printing 用枚举名（ISOA4/ISOA5），Get-PrintConfiguration 用 "A4"/"A5"，
# 两者必须归一后比较，否则会把已是 A5 的机器误判为"需设置"。
function Convert-PaperLabel([string]$v) {
    if (-not $v) { return '' }
    $u = $v.ToUpperInvariant()
    if ($u -match 'A5') { return 'A5' }
    if ($u -match 'A4') { return 'A4' }
    if ($u -match 'A3') { return 'A3' }
    if ($u -match 'LEGAL') { return 'Legal' }
    if ($u -match 'LETTER') { return 'Letter' }
    if ($u -match 'B5') { return 'B5' }
    return $v
}

function Set-UserPaperA5($queue) {
    $t = $queue.UserPrintTicket
    if ($null -eq $t) {
        $t = New-Object System.Printing.PrintTicket
    }
    $t.PageMediaSize = New-Object System.Printing.PageMediaSize([System.Printing.PageMediaSizeName]::ISOA5)
    $queue.UserPrintTicket = $t
    $queue.Commit()
    $read = $queue.UserPrintTicket
    if ($read -and $read.PageMediaSize -and $read.PageMediaSize.PageMediaSizeName -eq $A5) { return $true }
    return $false
}

$printers = Get-LocalPrinters
if ($printers.Count -eq 0) {
    Write-Host "[FATAL] 未找到本地打印机（请先安装打印机驱动）" -ForegroundColor Red
    exit 1
}

$server = New-Object System.Printing.LocalPrintServer
$defaultName = ''
try {
    $defaultQueue = [System.Printing.LocalPrintServer]::GetDefaultPrintQueue()
    if ($defaultQueue) { $defaultName = $defaultQueue.Name }
} catch {}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  打印机纸张检查（A5 = 148x210mm）" -ForegroundColor Cyan
Write-Host ("  时间: {0}   模式: {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $(if ($Fix) { '修复' } else { '只读检查' })) -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$needFixDefault = $false
$unsupportedDefault = $false
$rows = @()

foreach ($p in $printers) {
    $name = $p.Name
    $isDef = Test-IsDefaultPrinter $name
    if ($isDef -and -not $defaultName) { $defaultName = $name }

    $queue = $null
    try { $queue = $server.GetPrintQueue($name) } catch {}

    $supportsA5 = $null
    $userPaper = ''
    if ($queue) {
        $supportsA5 = Test-SupportsA5 $queue
        $userPaper = Get-UserPaper $queue
    }
    $printerPaper = Get-PrinterDefaultPaper $name

    # 「对话框默认纸」= per-user 首选项；未设置则跟随打印机默认纸
    $effective = if ($userPaper) { $userPaper } else { $printerPaper }
    $effNorm = Convert-PaperLabel $effective
    $effectiveLabel = if ($effNorm) { $effNorm } else { '(未设置)' }
    if ($effective -and $effNorm -and $effective -ne $effNorm) {
        $effectiveLabel = "$effNorm ($effective)"
    }

    $verdict = ''
    $color = 'Gray'
    if ($effNorm -eq 'A5') {
        $verdict = '[OK] 对话框默认就是 A5'
        $color = 'Green'
    } elseif ($supportsA5 -eq $true) {
        $verdict = '[需设置] 默认不是 A5，可一键修复（-Fix）'
        $color = 'Yellow'
        if ($isDef) { $needFixDefault = $true }
    } elseif ($supportsA5 -eq $false) {
        $verdict = '[不支持] 该驱动无 A5 选项（换驱动或打印机）'
        $color = 'Red'
        if ($isDef) { $unsupportedDefault = $true }
    } else {
        $verdict = '[未知] 驱动不支持能力查询，建议打印时人工确认'
        $color = 'DarkYellow'
    }

    $defMark = if ($isDef) { ' (默认打印机)' } else { '' }
    Write-Host ("打印机: {0}{1}" -f $name, $defMark) -ForegroundColor White
    Write-Host ("  驱动        : {0}" -f $p.DriverName) -ForegroundColor DarkGray
    Write-Host ("  对话框默认纸: {0}" -f $effectiveLabel) -ForegroundColor $color
    Write-Host ("  每用户首选项: {0}" -f $(if ($userPaper) { $userPaper } else { '(未设置，跟随打印机默认)' })) -ForegroundColor DarkGray
    Write-Host ("  打印机默认纸: {0}" -f $(if ($printerPaper) { $printerPaper } else { '(读取失败)' })) -ForegroundColor DarkGray
    Write-Host ("  支持 A5     : {0}" -f $(if ($supportsA5 -eq $true) { '是' } elseif ($supportsA5 -eq $false) { '否' } else { '未知' })) -ForegroundColor DarkGray
    Write-Host ("  结论        : {0}" -f $verdict) -ForegroundColor $color
    Write-Host ""

    $rows += [pscustomobject]@{
        Name       = $name
        IsDefault  = $isDef
        Effective  = $effectiveLabel
        UserTicket = $userPaper
        PrinterDef = $printerPaper
        SupportsA5 = $supportsA5
        Verdict    = $verdict
    }
}

# ★ -SaveReport：把本次检查结果落成文本，便于在其他诊所机器跑一遍后回收比对
#   （含机器名/时间/默认打印机/每台打印机的有效纸张与结论）
if ($SaveReport) {
    try {
        $outDir = Split-Path $PSScriptRoot -Parent
        if (-not (Test-Path $outDir)) { $outDir = $PSScriptRoot }
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $safeHost = ($env:COMPUTERNAME -replace '[\\/:*?"<>|]', '_')
        $reportPath = Join-Path $outDir ("打印机纸张报告_" + $safeHost + "_" + $stamp + ".txt")
        $body = @()
        $body += "惠康中医 - 打印机纸张检查报告"
        $body += ("机器名: {0}" -f $env:COMPUTERNAME)
        $body += ("用户  : {0}" -f $env:USERNAME)
        $body += ("系统  : {0}" -f ([System.Environment]::OSVersion.VersionString))
        $body += ("时间  : {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
        $body += ("模式  : {0}" -f $(if ($Fix) { '修复' } else { '只读检查' }))
        $body += ("默认打印机: {0}" -f $(if ($defaultName) { $defaultName } else { '(未设置)' }))
        $body += ""
        $body += ("共 {0} 台本地打印机" -f $rows.Count)
        $body += ""
        # 每台一段（中文字段名 + 值，避免 CJK 宽度导致表格错位）
        foreach ($r in $rows) {
            $a5 = if ($r.SupportsA5 -eq $true) { '是' } elseif ($r.SupportsA5 -eq $false) { '否' } else { '未知' }
            $body += ("打印机: {0}{1}" -f $r.Name, $(if ($r.IsDefault) { '   <== 默认打印机' } else { '' }))
            $body += ("  对话框默认纸 : {0}" -f $r.Effective)
            $body += ("  每用户首选项 : {0}" -f $(if ($r.UserTicket) { $r.UserTicket } else { '(未设置，跟随打印机默认)' }))
            $body += ("  打印机默认纸 : {0}" -f $(if ($r.PrinterDef) { $r.PrinterDef } else { '(读取失败)' }))
            $body += ("  驱动支持 A5  : {0}" -f $a5)
            $body += ("  结论         : {0}" -f $r.Verdict)
            $body += ""
        }
        $body | Set-Content -Path $reportPath -Encoding UTF8
        Write-Host ("[报告] 已保存: {0}" -f $reportPath) -ForegroundColor Cyan
        Write-Host ""
    } catch {
        Write-Host ("[WARN] 报告保存失败(不影响检查): {0}" -f $_.Exception.Message) -ForegroundColor Yellow
    }
}

if (-not $Fix) {
    Write-Host "--------------------------------------------" -ForegroundColor Cyan
    Write-Host ("汇总: 共 {0} 台本地打印机，默认打印机 = {1}" -f $rows.Count, $(if ($defaultName) { $defaultName } else { '(未设置)' })) -ForegroundColor Cyan
    if ($unsupportedDefault) {
        Write-Host "[结论] 默认打印机的驱动不支持 A5，无法自动设置，请更换驱动/打印机" -ForegroundColor Red
        exit 3
    } elseif ($needFixDefault) {
        Write-Host "[结论] 默认打印机不是 A5 —— 在目标机器上运行本脚本加 -Fix 即可（免管理员）" -ForegroundColor Yellow
        Write-Host "       例: 检查打印机纸张A5.bat -Fix" -ForegroundColor Yellow
        exit 2
    } else {
        Write-Host "[结论] 默认打印机的对话框默认纸已是 A5，无需设置" -ForegroundColor Green
        exit 0
    }
}

# ------------------------- 修复模式 -------------------------
Write-Host "--------------------------------------------" -ForegroundColor Cyan
Write-Host "  开始修复为 A5" -ForegroundColor Cyan
Write-Host "--------------------------------------------" -ForegroundColor Cyan

$targets = @()
if ($Printer) {
    $targets = @($rows | Where-Object { $_.Name -eq $Printer })
    if ($targets.Count -eq 0) {
        Write-Host "[ERROR] 未找到打印机: $Printer" -ForegroundColor Red
        exit 1
    }
} elseif ($All) {
    $targets = @($rows)
} else {
    $targets = @($rows | Where-Object { $_.IsDefault })
    if ($targets.Count -eq 0 -and $defaultName) {
        $targets = @($rows | Where-Object { $_.Name -eq $defaultName })
    }
    if ($targets.Count -eq 0) {
        Write-Host "[ERROR] 系统未设置默认打印机；请用 -Printer <名称> 指定，或加 -All" -ForegroundColor Red
        exit 1
    }
}

$okCount = 0
$skipCount = 0
$failCount = 0

foreach ($t in $targets) {
    if ($t.SupportsA5 -eq $false) {
        Write-Host ("[SKIP] {0} ：驱动不支持 A5" -f $t.Name) -ForegroundColor Yellow
        $skipCount++
        continue
    }
    if ($t.UserTicket -eq $A5) {
        Write-Host ("[OK]   {0} ：已是 A5（无需修改）" -f $t.Name) -ForegroundColor Green
        $okCount++
        continue
    }
    try {
        $queue = $server.GetPrintQueue($t.Name)
        $done = Set-UserPaperA5 $queue
        if ($done) {
            Write-Host ("[SET]  {0} ：已设为 A5（148x210mm），无需管理员，重启后保留" -f $t.Name) -ForegroundColor Green
            $okCount++
        } else {
            Write-Host ("[FAIL] {0} ：写入后回读仍不是 A5（驱动可能拒绝该纸张）" -f $t.Name) -ForegroundColor Red
            $failCount++
        }
    } catch {
        Write-Host ("[FAIL] {0} ：{1}" -f $t.Name, $_.Exception.Message) -ForegroundColor Red
        $failCount++
    }
}

Write-Host ""
Write-Host ("修复汇总: 成功 {0} / 跳过 {1} / 失败 {2}" -f $okCount, $skipCount, $failCount) -ForegroundColor Cyan
if ($failCount -gt 0) { exit 1 }
if ($okCount -eq 0 -and $skipCount -gt 0) {
    Write-Host "[结论] 目标打印机驱动不支持 A5，无法自动设置（请换驱动/打印机，或打印时人工选纸）" -ForegroundColor Red
    exit 3
}
exit 0
