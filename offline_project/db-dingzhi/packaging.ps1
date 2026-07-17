# packaging.ps1 - 定制版打包工具
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$scriptDir = $PSScriptRoot

function Show-Menu {
    Clear-Host
    Write-Host ""
    Write-Host "================================================================"
    Write-Host "  本能中医处方系统 - 定制版打包工具"
    Write-Host "================================================================"
    Write-Host ""
    Write-Host "  [1] 打包桌面版 exe （配置 + 代码混淆 + 打包）"
    Write-Host "  [2] 打包手机 APP   （配置 + 同步 + 打包 APK）"
    Write-Host "  [3] 仅同步文件到 APP（修改 index.html 后使用）"
    Write-Host "  [4] 仅修改配置      （诊所名称）"
    Write-Host "  [5] 查看当前配置"
    Write-Host "  [0] 退出"
    Write-Host ""
    Write-Host "----------------------------------------------------------------"
    $choice = Read-Host "请选择 [0-5]"
    return $choice
}

function Build-Desktop {
    Clear-Host
    Write-Host "================================================================"
    Write-Host "  打包桌面版 exe"
    Write-Host "================================================================"
    Write-Host ""
    & "$scriptDir\build.bat"
    Write-Host ""
    Write-Host "================================================================"
    Write-Host "  桌面版打包完成！输出目录: $scriptDir\dist\"
    Write-Host "================================================================"
    Read-Host "按回车键继续"
}

function Build-App {
    Clear-Host
    Write-Host "================================================================"
    Write-Host "  打包手机 APP (APK)"
    Write-Host "================================================================"
    Write-Host ""
    & "$scriptDir\build-app.bat"
    Write-Host ""
    Write-Host "================================================================"
    Write-Host "  手机 APP 打包完成！APK: $scriptDir\*.apk"
    Write-Host "================================================================"
    Read-Host "按回车键继续"
}

function Sync-Only {
    Clear-Host
    Write-Host "================================================================"
    Write-Host "  同步文件到 APP"
    Write-Host "================================================================"
    Write-Host ""
    & "$scriptDir\sync-to-app.bat"
    Write-Host ""
    Read-Host "按回车键继续"
}

function Config-Only {
    Clear-Host
    Write-Host "================================================================"
    Write-Host "  修改配置"
    Write-Host "================================================================"
    Write-Host ""
    & "$scriptDir\edit-config.ps1"
    Write-Host ""
    Read-Host "按回车键继续"
}

function Show-Config {
    Clear-Host
    Write-Host "================================================================"
    Write-Host "  当前配置信息"
    Write-Host "================================================================"
    Write-Host ""
    $config = Get-Content (Join-Path $scriptDir 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    Write-Host "  诊所名称: $($config.clinicName)"
    Write-Host "  医师姓名: $($config.doctorName)"
    Write-Host "  版本标签: $($config.versionLabel)"
    Write-Host "  产品名称: $($config.productName)"
    Write-Host ""
    Write-Host "  已注册用户:"
    foreach ($u in $config.users) {
        Write-Host "    - $($u.name) ($($u.username), $($u.role))"
    }
    Write-Host ""
    Read-Host "按回车键继续"
}

while ($true) {
    $choice = Show-Menu
    switch ($choice) {
        "1" { Build-Desktop }
        "2" { Build-App }
        "3" { Sync-Only }
        "4" { Config-Only }
        "5" { Show-Config }
        "0" { Write-Host ""; Write-Host "再见！"; Start-Sleep 1; exit }
        default { Write-Host ""; Write-Host "  [错误] 无效选择"; Start-Sleep 2 }
    }
}
