# packaging.ps1 - Unified packaging tool menu（方案二：含防盗防破解）
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$scriptDir = $PSScriptRoot

# 从 config.json 读取版本标签作为菜单标题
function Get-VersionLabel {
    try {
        $config = Get-Content (Join-Path $scriptDir 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($config.versionLabel) { return $config.versionLabel }
        if ($config.productName) { return $config.productName }
    } catch {}
    return "本能中医处方系统"
}

function Show-Menu {
    $label = Get-VersionLabel
    Clear-Host
    Write-Host ""
    Write-Host "================================================================"
    Write-Host "  $label - 打包工具（含防盗防破解）"
    Write-Host "================================================================"
    Write-Host ""
    Write-Host "  [1] 打包桌面版 exe     （配置 + 代码混淆 + 打包）"
    Write-Host "  [2] 打包手机 APP        （配置 + 同步 + 打包 APK）"
    Write-Host "  [3] 仅同步文件到 APP   （修改 index.html 后使用）"
    Write-Host "  [4] 仅修改配置         （诊所名称）"
    Write-Host "  [5] 查看当前配置"
    Write-Host "  [6] 启用严格模式        （从已打包 APK 提取签名+dex 哈希并注入）"
    Write-Host "  [7] 一键打包完整版      （桌面 exe + APP APK + 严格模式）"
    Write-Host "  [0] 退出"
    Write-Host ""
    Write-Host "----------------------------------------------------------------"
    Write-Host "  防护说明："
    Write-Host "    [1][2] 默认使用首次锁定模式（首次运行锁定签名）"
    Write-Host "    [6] 启用严格模式后，APK 内硬编码哈希，任何二次打包即拒绝运行"
    Write-Host "    [7] 自动完成：打包->提取哈希->注入->重新打包"
    Write-Host "----------------------------------------------------------------"
    $choice = Read-Host "请选择 [0-7]"
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
    Write-Host "  安全说明：APK 内含反调试 + 完整性校验 + 签名校验"
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
    Write-Host "----------------------------------------------------------------"
    Write-Host "  安全防护状态："
    $guardFiles = Get-ChildItem -Path $scriptDir -Recurse -Filter "SecurityGuard.java" -ErrorAction SilentlyContinue
    if ($guardFiles) {
        $guardContent = Get-Content $guardFiles[0].FullName -Raw -Encoding UTF8
        $signMatch = [regex]::Match($guardContent, 'EXPECTED_SIGN_HASH = "([^"]*)"')
        $dexMatch = [regex]::Match($guardContent, 'EXPECTED_DEX_HASH = "([^"]*)"')
        $signHash = if ($signMatch.Success) { $signMatch.Groups[1].Value } else { "(未知)" }
        $dexHash = if ($dexMatch.Success) { $dexMatch.Groups[1].Value } else { "(未知)" }

        if ([string]::IsNullOrEmpty($signHash)) {
            Write-Host "    签名校验模式: 首次锁定模式（建议启用严格模式以增强防护）"
        } else {
            Write-Host "    签名校验模式: 严格模式 ✓"
            Write-Host "    签名哈希: $signHash"
        }
        if ([string]::IsNullOrEmpty($dexHash)) {
            Write-Host "    Dex 完整性: 首次锁定模式（建议启用严格模式以增强防护）"
        } else {
            Write-Host "    Dex 完整性: 严格模式 ✓"
            Write-Host "    Dex 哈希: $dexHash"
        }
    } else {
        Write-Host "    [警告] 未找到 SecurityGuard.java"
    }
    Write-Host ""
    Read-Host "按回车键继续"
}

function Enable-StrictMode {
    Clear-Host
    Write-Host ""
    Write-Host "================================================================"
    Write-Host "  启用严格模式（从已打包 APK 提取哈希并注入 SecurityGuard.java）"
    Write-Host "================================================================"
    Write-Host ""
    Write-Host "  前置条件："
    Write-Host "  - 已通过菜单 [2] 打包过至少一次 APK"
    Write-Host "  - APK 使用正式签名证书签名"
    Write-Host ""
    Write-Host "  流程："
    Write-Host "  1. 从最新 APK 提取签名 SHA-256"
    Write-Host "  2. 计算 APK 内 classes*.dex 的串联 SHA-256"
    Write-Host "  3. 注入到 SecurityGuard.java 的 EXPECTED_SIGN_HASH / EXPECTED_DEX_HASH"
    Write-Host "  4. 之后重新打包 APK 即启用严格模式"
    Write-Host ""
    Write-Host "----------------------------------------------------------------"
    Write-Host ""
    & "$scriptDir\generate-sign-hash.bat"
    Write-Host ""
    Read-Host "按回车键继续"
}

function Build-All-Strict {
    Clear-Host
    Write-Host ""
    Write-Host "================================================================"
    Write-Host "  一键打包完整版（桌面 + APP + 严格模式）"
    Write-Host "================================================================"
    Write-Host ""
    Write-Host "  自动执行流程："
    Write-Host "  Step A. 打包桌面版 exe"
    Write-Host "  Step B. 打包手机 APP（首次锁定模式 APK）"
    Write-Host "  Step C. 提取 APK 哈希并注入 SecurityGuard.java"
    Write-Host "  Step D. 重新打包手机 APP（严格模式 APK）"
    Write-Host ""
    Write-Host "  最终输出："
    Write-Host "  - 桌面版: dist\*.exe"
    Write-Host "  - 手机 APP: 当前目录\*.apk（已启用严格模式）"
    Write-Host ""
    $confirm = Read-Host "确认开始一键打包？(y/N)"
    if ($confirm -ne "y" -and $confirm -ne "Y") {
        Write-Host "  已取消"
        Start-Sleep -Seconds 1
        return
    }
    Write-Host ""
    Write-Host "================================================================"
    Write-Host "  Step A. 打包桌面版 exe"
    Write-Host "================================================================"
    & "$scriptDir\build.bat"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[错误] 桌面版打包失败，终止一键打包"
        Read-Host "按回车键继续"
        return
    }
    Write-Host ""
    Write-Host "================================================================"
    Write-Host "  Step B. 打包手机 APP（首次锁定模式）"
    Write-Host "================================================================"
    & "$scriptDir\build-app.bat"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[错误] APP 打包失败，终止一键打包"
        Read-Host "按回车键继续"
        return
    }
    Write-Host ""
    Write-Host "================================================================"
    Write-Host "  Step C. 提取 APK 哈希并注入 SecurityGuard.java"
    Write-Host "================================================================"
    & "$scriptDir\generate-sign-hash.bat"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[错误] 哈希提取失败，终止一键打包"
        Write-Host "  您仍可使用菜单 [2] 的 APK（首次锁定模式）"
        Read-Host "按回车键继续"
        return
    }
    Write-Host ""
    Write-Host "================================================================"
    Write-Host "  Step D. 重新打包手机 APP（严格模式 APK）"
    Write-Host "================================================================"
    & "$scriptDir\build-app.bat" --skip-config
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[错误] 严格模式重新打包失败"
        Write-Host "  您仍可使用 Step B 的 APK（首次锁定模式）"
        Read-Host "按回车键继续"
        return
    }
    Write-Host ""
    Write-Host "================================================================"
    Write-Host "  一键打包完成！"
    Write-Host "================================================================"
    Write-Host ""
    Write-Host "  桌面版: $scriptDir\dist\"
    Write-Host "  手机 APP: $scriptDir\*.apk（严格模式）"
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
        "6" { Enable-StrictMode }
        "7" { Build-All-Strict }
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
