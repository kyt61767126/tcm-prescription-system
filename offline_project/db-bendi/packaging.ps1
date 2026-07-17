# packaging.ps1 - Unified packaging tool menu
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$scriptDir = $PSScriptRoot

function Show-Menu {
    Clear-Host
    Write-Host ""
    Write-Host "================================================================"
    Write-Host "  本能中医处方系统 - 本地版打包工具"
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
    Write-Host ""
    Write-Host "================================================================"
    Write-Host "  打包桌面版 exe"
    Write-Host "================================================================"
    Write-Host ""
    Write-Host "  将执行以下步骤："
    Write-Host "  1. 关闭残留进程"
    Write-Host "  2. 修改配置（诊所名称）"
    Write-Host "  3. 代码混淆"
    Write-Host "  4. npm build 打包"
    Write-Host "  5. 恢复原始代码"
    Write-Host ""
    Write-Host "  输出目录: dist\"
    Write-Host ""
    Write-Host "----------------------------------------------------------------"
    Write-Host ""
    & "$scriptDir\build.bat"
    Write-Host ""
    Write-Host "================================================================"
    Write-Host "  桌面版打包完成！"
    Write-Host "  输出目录: $scriptDir\dist\"
    Write-Host "================================================================"
    Read-Host "按回车键继续"
}

function Build-App {
    Clear-Host
    Write-Host ""
    Write-Host "================================================================"
    Write-Host "  打包手机 APP (APK)"
    Write-Host "================================================================"
    Write-Host ""
    Write-Host "  将执行以下步骤："
    Write-Host "  1. 修改配置（诊所名称）"
    Write-Host "  2. 同步文件到 Android assets"
    Write-Host "  3. Gradle 编译签名 APK"
    Write-Host "  4. 复制 APK 到当前目录"
    Write-Host ""
    Write-Host "  输出文件: 当前目录下的 .apk 文件"
    Write-Host ""
    Write-Host "----------------------------------------------------------------"
    Write-Host ""
    & "$scriptDir\build-app.bat"
    Write-Host ""
    Write-Host "================================================================"
    Write-Host "  手机 APP 打包完成！"
    Write-Host "  APK 文件: $scriptDir\*.apk"
    Write-Host "================================================================"
    Read-Host "按回车键继续"
}

function Sync-Only {
    Clear-Host
    Write-Host ""
    Write-Host "================================================================"
    Write-Host "  同步文件到 APP"
    Write-Host "================================================================"
    Write-Host ""
    Write-Host "  将以下文件同步到 Android assets 目录："
    Write-Host "  - index.html"
    Write-Host "  - config.json"
    Write-Host "  - 所有 JS 模块（auth-core.js, permission.js 等）"
    Write-Host "  - vendor/xlsx.full.min.js"
    Write-Host "  - video-recorder-inject.js"
    Write-Host ""
    Write-Host "  使用场景: 修改了 index.html 或 JS 文件后，打包前先同步"
    Write-Host ""
    Write-Host "----------------------------------------------------------------"
    Write-Host ""
    & "$scriptDir\sync-to-app.bat"
    Write-Host ""
    Read-Host "按回车键继续"
}

function Config-Only {
    Clear-Host
    Write-Host ""
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
    Write-Host ""
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

# Main loop
while ($true) {
    $choice = Show-Menu
    switch ($choice) {
        "1" { Build-Desktop }
        "2" { Build-App }
        "3" { Sync-Only }
        "4" { Config-Only }
        "5" { Show-Config }
        "0" {
            Write-Host ""
            Write-Host "再见！"
            Start-Sleep -Seconds 1
            exit
        }
        default {
            Write-Host ""
            Write-Host "  [错误] 无效选择，请重新输入"
            Start-Sleep -Seconds 2
        }
    }
}
