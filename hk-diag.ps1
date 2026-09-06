# 惠康中医（离线桌面版）激活状态诊断
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ud = Join-Path $env:APPDATA 'tcm-prescription'
$sb = New-Object System.Text.StringBuilder

function L($t) { [void]$sb.AppendLine($t) }

L '============================================================'
L ('  惠康中医（离线桌面版）激活状态诊断  ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
L '============================================================'
L ''
L ('[1] 用户数据目录: ' + $ud)
if (Test-Path $ud) { L '    存在' } else { L '    ★★★ 不存在（程序可能从未运行或数据在别处）' }
L ''
L '[2] 数据文件清单:'
if (Test-Path $ud) {
    Get-ChildItem $ud -File | ForEach-Object {
        L ('    {0}  [{1} 字节]  {2}' -f $_.Name, $_.Length, $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm'))
    }
} else { L '    （目录不存在，跳过）' }
L ''
L '[3] 关键文件判定:'
if (Test-Path "$ud\license.dat") { L '    license.dat    存在 = 已装激活码' } else { L '    license.dat    ★不存在 = 激活码未落盘（激活链路断）' }
if (Test-Path "$ud\trial.dat") { L '    trial.dat      ★存在 = 仍标记试用期（正常装码后应清除）' } else { L '    trial.dat      不存在 = 试用期已结束/已清除' }
if (Test-Path "$ud\admin-request-id.dat") { L '    admin-request-id.dat 存在 = 有未完成/未清理的激活申请' } else { L '    admin-request-id.dat 不存在' }
L ''
L '[4] config.json 版本信息:'
$cfgPath = "$ud\config.json"
if (Test-Path $cfgPath) {
    try {
        $c = Get-Content -Raw $cfgPath -Encoding UTF8 | ConvertFrom-Json
        L ('    edition        = ' + $c.edition + $(if ($c.edition -eq 'clinic') { '  ✓机构版' } elseif ($c.edition -eq 'personal') { '  ★标准版（问题所在）' } else { '' }))
        L ('    productName    = ' + $c.productName)
        L ('    clinicName     = ' + $c.clinicName)
        L ('    appMode        = ' + $c.appMode)
        $us = @($c.users)
        L ('    用户数         = ' + $us.Count)
        foreach ($u in $us) {
            $n = [string]$u.username
            if ($n.Length -ge 5) { $n = $n.Substring(0,3) + '****' + $n.Substring($n.Length-2) }
            L ('      - ' + $n + ' | role=' + $u.role + $(if ($u.role -in 'admin','clinic_admin') { '  ✓管理员' } else { '' }))
        }
        if ($c.configSignature) { L '    configSignature = 有' } else { L '    configSignature = ★无（配置未签名）' }
    } catch {
        L ('    ★解析失败: ' + $_.Exception.Message)
    }
} else { L '    config.json 不存在' }
L ''
L '[5] 安装的程序版本:'
$lnk = Get-ChildItem "$env:USERPROFILE\Desktop", 'C:\Users\Public\Desktop' -Filter '*惠康*' | Select-Object -First 1
if ($lnk) {
    $sh = New-Object -ComObject WScript.Shell
    $t = $sh.CreateShortcut($lnk.FullName).TargetPath
    L ('    快捷方式: ' + $lnk.Name)
    L ('    程序路径: ' + $t)
    if ($t -and (Test-Path $t)) {
        $v = (Get-Item $t).VersionInfo
        L ('    文件版本: ' + $v.FileVersion + '  产品版本: ' + $v.ProductVersion)
        L ('    修改时间: ' + (Get-Item $t).LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))
    }
} else { L '    桌面未找到快捷方式（可手动看安装目录内 exe 属性）' }
L ''
L '============================================================'

$out = $sb.ToString()
Write-Host $out
Write-Host '------------------------------------------------------------'
Write-Host ' 诊断内容即将复制到剪贴板，请粘贴发给技术支持。'
Write-Host '------------------------------------------------------------'
try {
    $out | Set-Clipboard
    Write-Host ' ✅ 已复制到剪贴板（可直接 Ctrl+V 粘贴发送）'
} catch {
    $f = Join-Path $env:USERPROFILE 'Desktop\惠康激活诊断结果.txt'
    $out | Out-File $f -Encoding utf8
    Write-Host (' 剪贴板失败，已存到桌面: ' + $f)
}
Write-Host ''
Read-Host '按回车键退出'
