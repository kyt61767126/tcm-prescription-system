# packaging.ps1 - Cloud project unified packaging tool（方案二：含防盗防破解）
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$scriptDir = $PSScriptRoot

function Show-Menu {
    Clear-Host
    Write-Host ""
    Write-Host "================================================================"
    Write-Host "  云端版 - 打包工具（含防盗防破解）"
    Write-Host "================================================================"
    Write-Host ""
    Write-Host "  [1] 打包桌面版 exe     （Electron 代码混淆 + 打包）"
    Write-Host "  [2] 打包手机 APP        （Capacitor 同步 + 打包 APK）"
    Write-Host "  [3] 查看当前配置"
    Write-Host "  [4] 启用签名严格模式    （从已打包 APK 提取签名哈希并注入）"
    Write-Host "  [5] 一键打包完整版      （桌面 exe + APP APK + 签名严格模式）"
    Write-Host "  [0] 退出"
    Write-Host ""
    Write-Host "----------------------------------------------------------------"
    Write-Host "  防护说明："
    Write-Host "    [2] 默认启用 Root 检测 + 调试器检测（详见 SecurityGuard.java）"
    Write-Host "    [4] 启用签名严格模式后，APK 内硬编码签名哈希，任何二次打包即拒绝运行"
    Write-Host "    [5] 自动完成：打包->提取哈希->注入->重新打包"
    Write-Host "----------------------------------------------------------------"
    $choice = Read-Host "请选择 [0-5]"
    return $choice
}

function Build-Desktop {
    Clear-Host
    Write-Host ""
    Write-Host "================================================================"
    Write-Host "  打包云端桌面版 exe（Electron）"
    Write-Host "================================================================"
    Write-Host ""
    Write-Host "  将执行以下步骤："
    Write-Host "  1. 关闭残留进程"
    Write-Host "  2. 清理旧构建产物"
    Write-Host "  3. JavaScript 代码混淆"
    Write-Host "  4. npm build 打包"
    Write-Host "  5. 恢复原始代码"
    Write-Host ""
    Write-Host "  输出目录: cloud_desktop\dist\"
    Write-Host ""
    Write-Host "----------------------------------------------------------------"
    Write-Host ""
    & "$scriptDir\cloud_desktop\build.bat"
    # P1-19: 检查子脚本退出码，失败时不显示"完成"
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "================================================================"
        Write-Host "  [ERROR] 桌面版打包失败！退出码: $LASTEXITCODE"
        Write-Host "  请查看上方错误日志"
        Write-Host "================================================================"
        Read-Host "按回车键继续"
        return
    }
    Write-Host ""
    Write-Host "================================================================"
    Write-Host "  桌面版打包完成！"
    Write-Host "  输出目录: $scriptDir\cloud_desktop\dist\"
    Write-Host "================================================================"
    Read-Host "按回车键继续"
}

function Build-App {
    Clear-Host
    Write-Host ""
    Write-Host "================================================================"
    Write-Host "  打包云端手机 APP (APK)"
    Write-Host "================================================================"
    Write-Host ""
    Write-Host "  将执行以下步骤："
    Write-Host "  1. 同步 shared 文件到 cloud_app"
    Write-Host "  2. 清理旧构建缓存"
    Write-Host "  3. Gradle 编译签名 APK"
    Write-Host "  4. 复制 APK 到当前目录"
    Write-Host ""
    Write-Host "  输出文件: 当前目录下的 .apk 文件"
    Write-Host ""
    Write-Host "  安全说明：APK 内含 Root 检测 + 调试器检测 + 签名校验（SecurityGuard.java）"
    Write-Host "----------------------------------------------------------------"
    Write-Host ""
    & "$scriptDir\build-app.bat"
    # P1-19: 检查子脚本退出码，失败时不显示"完成"
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "================================================================"
        Write-Host "  [ERROR] 手机 APP 打包失败！退出码: $LASTEXITCODE"
        Write-Host "  请查看上方错误日志"
        Write-Host "================================================================"
        Read-Host "按回车键继续"
        return
    }
    Write-Host ""
    Write-Host "================================================================"
    Write-Host "  手机 APP 打包完成！"
    Write-Host "  APK 文件: $scriptDir\*.apk"
    Write-Host "================================================================"
    Read-Host "按回车键继续"
}

function Show-Config {
    Clear-Host
    Write-Host ""
    Write-Host "================================================================"
    Write-Host "  当前云端配置信息"
    Write-Host "================================================================"
    Write-Host ""
    # 从 cloud_desktop/package.json 读取 productName
    $pkgFile = Join-Path $scriptDir 'cloud_desktop\package.json'
    if (Test-Path $pkgFile) {
        try {
            $pkg = Get-Content $pkgFile -Raw -Encoding UTF8 | ConvertFrom-Json
            Write-Host "  产品名称: $($pkg.build.productName)"
            Write-Host "  应用ID:   $($pkg.name)"
            Write-Host "  版本号:   $($pkg.version)"
        } catch {
            Write-Host "  [警告] 无法解析 package.json"
        }
    } else {
        Write-Host "  [警告] 未找到 cloud_desktop/package.json"
    }

    # 从 cloud_app/app/build.gradle 读取 applicationId 和 versionName
    $gradleFile = Join-Path $scriptDir 'cloud_app\app\build.gradle'
    if (Test-Path $gradleFile) {
        Write-Host ""
        Write-Host "  Android 配置:"
        $gradleContent = Get-Content $gradleFile -Raw -Encoding UTF8
        $appIdMatch = [regex]::Match($gradleContent, 'applicationId\s+"([^"]+)"')
        if ($appIdMatch.Success) {
            Write-Host "    applicationId: $($appIdMatch.Groups[1].Value)"
        }
        $versionNameMatch = [regex]::Match($gradleContent, 'versionName\s+"([^"]+)"')
        if ($versionNameMatch.Success) {
            Write-Host "    versionName:   $($versionNameMatch.Groups[1].Value)"
        }
    }

    # 从 capacitor.config.json 读取云端URL
    $capFile = Join-Path $scriptDir 'cloud_app\app\src\main\assets\capacitor.config.json'
    if (Test-Path $capFile) {
        Write-Host ""
        Write-Host "  Capacitor 配置:"
        try {
            $cap = Get-Content $capFile -Raw -Encoding UTF8 | ConvertFrom-Json
            Write-Host "    云端URL: $($cap.server.url)"
        } catch {}
    }

    Write-Host ""
    Write-Host "----------------------------------------------------------------"
    Write-Host "  安全防护状态（SecurityGuard.java）："
    $guardFiles = Get-ChildItem -Path $scriptDir -Recurse -Filter "SecurityGuard.java" -ErrorAction SilentlyContinue
    if ($guardFiles) {
        $guardContent = Get-Content $guardFiles[0].FullName -Raw -Encoding UTF8
        $signMatch = [regex]::Match($guardContent, 'EXPECTED_SIGN_HASH = "([^"]*)"')
        $signHash = if ($signMatch.Success) { $signMatch.Groups[1].Value } else { "" }

        if ([string]::IsNullOrEmpty($signHash)) {
            Write-Host "    APK 签名校验: 跳过（EXPECTED_SIGN_HASH 为空，建议启用严格模式）"
        } else {
            Write-Host "    APK 签名校验: 严格模式 ✓"
            Write-Host "    签名哈希: $signHash"
        }
        # 安全检测开关
        $rootMatch = [regex]::Match($guardContent, 'ENABLE_ROOT_CHECK = (true|false)')
        $debugMatch = [regex]::Match($guardContent, 'ENABLE_DEBUGGER_CHECK = (true|false)')
        $rootOn = if ($rootMatch.Success) { $rootMatch.Groups[1].Value } else { "?" }
        $debugOn = if ($debugMatch.Success) { $debugMatch.Groups[1].Value } else { "?" }
        Write-Host "    Root 检测:    $rootOn"
        Write-Host "    调试器检测:   $debugOn"
        Write-Host "    文件路径: $($guardFiles[0].FullName)"
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
    Write-Host "  启用签名严格模式（从已打包 APK 提取签名哈希并注入 SecurityGuard.java）"
    Write-Host "================================================================"
    Write-Host ""
    Write-Host "  前置条件："
    Write-Host "  - 已通过菜单 [2] 打包过至少一次 APK"
    Write-Host "  - APK 使用正式签名证书签名"
    Write-Host ""
    Write-Host "  流程："
    Write-Host "  1. 从最新 APK 提取签名 SHA-256"
    Write-Host "  2. 注入到 SecurityGuard.java 的 EXPECTED_SIGN_HASH"
    Write-Host "  3. 之后重新打包 APK 即启用签名严格模式"
    Write-Host ""
    Write-Host "  说明：Root 检测 + 调试器检测默认已启用，无需此步骤"
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
    Write-Host "  一键打包完整版（桌面 + APP + 签名严格模式）"
    Write-Host "================================================================"
    Write-Host ""
    Write-Host "  自动执行流程："
    Write-Host "  Step A. 打包桌面版 exe"
    Write-Host "  Step B. 打包手机 APP（默认模式 APK：Root+调试器检测）"
    Write-Host "  Step C. 提取 APK 签名哈希并注入 SecurityGuard.java"
    Write-Host "  Step D. 重新打包手机 APP（签名严格模式 APK）"
    Write-Host ""
    Write-Host "  最终输出："
    Write-Host "  - 桌面版: cloud_desktop\dist\*.exe"
    Write-Host "  - 手机 APP: 当前目录\*.apk（已启用签名严格模式）"
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
    & "$scriptDir\cloud_desktop\build.bat"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[错误] 桌面版打包失败，终止一键打包"
        Read-Host "按回车键继续"
        return
    }
    Write-Host ""
    Write-Host "================================================================"
    Write-Host "  Step B. 打包手机 APP（默认模式：Root+调试器检测）"
    Write-Host "================================================================"
    & "$scriptDir\build-app.bat"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[错误] APP 打包失败，终止一键打包"
        Read-Host "按回车键继续"
        return
    }
    Write-Host ""
    Write-Host "================================================================"
    Write-Host "  Step C. 提取 APK 签名哈希并注入 SecurityGuard.java"
    Write-Host "================================================================"
    & "$scriptDir\generate-sign-hash.bat"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[错误] 签名哈希提取失败，终止一键打包"
        Write-Host "  您仍可使用菜单 [2] 的 APK（默认模式）"
        Read-Host "按回车键继续"
        return
    }
    Write-Host ""
    Write-Host "================================================================"
    Write-Host "  Step D. 重新打包手机 APP（签名严格模式 APK）"
    Write-Host "================================================================"
    & "$scriptDir\build-app.bat"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[错误] 签名严格模式重新打包失败"
        Write-Host "  您仍可使用 Step B 的 APK（默认模式）"
        Read-Host "按回车键继续"
        return
    }
    Write-Host ""
    Write-Host "================================================================"
    Write-Host "  一键打包完成！"
    Write-Host "================================================================"
    Write-Host ""
    Write-Host "  桌面版: $scriptDir\cloud_desktop\dist\"
    Write-Host "  手机 APP: $scriptDir\*.apk（签名严格模式）"
    Write-Host ""
    Read-Host "按回车键继续"
}

# Main loop
while ($true) {
    $choice = Show-Menu
    switch ($choice) {
        "1" { Build-Desktop }
        "2" { Build-App }
        "3" { Show-Config }
        "4" { Enable-StrictMode }
        "5" { Build-All-Strict }
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
