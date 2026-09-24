<#
.SYNOPSIS
    惠康中医系统 · 云端客服离线激活生成 license.dat 一键脚本
.DESCRIPTION
    无需上传设备文件，填入客户 3 项信息一键生成离线授权文件到桌面
.NOTES
    使用人：客服（或自任客服的管理员）
    使用前：仅修改【2】区段的 3 处客户信息，不要改动其他内容
    密钥：自动读取本机 %USERPROFILE%\.hktzy\license-export-secret.txt，
          严禁把密钥粘贴进本脚本，严禁把密钥文件外传
    环境要求：客服电脑可联网（客户机器断网不影响）
#>

$ErrorActionPreference = 'Continue'

try {
    # ==========【1、客服密钥（自动读取本机密钥文件，禁止把密钥写进本脚本）】==========
    $secretPath = Join-Path $env:USERPROFILE '.hktzy\license-export-secret.txt'
    if (-not (Test-Path $secretPath)) {
        Write-Host "=====================================" -ForegroundColor Red
        Write-Host "❌ 未找到客服密钥文件" -ForegroundColor Red
        Write-Host "=====================================" -ForegroundColor Red
        Write-Host ""
        Write-Host "密钥文件路径：$secretPath" -ForegroundColor Yellow
        Write-Host "请联系管理员获取密钥文件，保存为上述路径后重新运行。" -ForegroundColor Yellow
        throw "密钥文件不存在"
    }

    $exportSecret = (Get-Content -Path $secretPath -Raw -ErrorAction Stop).Trim()
    if ($exportSecret -notmatch '^[0-9a-fA-F]{64}$') {
        Write-Host "=====================================" -ForegroundColor Red
        Write-Host "❌ 密钥文件内容格式错误" -ForegroundColor Red
        Write-Host "=====================================" -ForegroundColor Red
        Write-Host ""
        Write-Host "密钥应为 64 位十六进制字符（0-9 a-f）。" -ForegroundColor Yellow
        Write-Host "请勿在密钥前后添加空格、引号或其他文字。" -ForegroundColor Yellow
        Write-Host "如确认文件无误仍报错，请联系管理员重新发放密钥文件。" -ForegroundColor Yellow
        throw "密钥格式错误"
    }

    $headers = @{
        "Content-Type" = "application/json"
        "X-Export-Secret" = $exportSecret
    }

    # ==========【2、客服仅修改下方 3 个引号内客户信息】==========
    $body = @{
        code = "BNZC-此处替换为激活码-XXXX-XXXX"
        machineId = "此处替换为客户32位机器ID"
        clinicName = "此处替换为客户诊所全称"
    } | ConvertTo-Json -Compress

    # 检查客户信息是否已修改
    if ($body -match '此处替换') {
        Write-Host "=====================================" -ForegroundColor Red
        Write-Host "❌ 请先修改脚本中的客户信息！" -ForegroundColor Red
        Write-Host "=====================================" -ForegroundColor Red
        Write-Host ""
        Write-Host "操作方法：" -ForegroundColor Yellow
        Write-Host "  1. 右键此 .ps1 文件 → 用记事本打开"
        Write-Host "  2. 找到【2】区段，修改 3 个引号内的内容："
        Write-Host '     code       = "客户激活码 BNZC-XXXX-XXXX-XXXX-XXXX"'
        Write-Host '     machineId  = "客户32位机器ID"'
        Write-Host '     clinicName = "客户诊所全称"'
        Write-Host "  3. 保存文件（Ctrl+S）"
        Write-Host "  4. 再次双击 start-license.bat 启动"
        throw "客户信息未修改"
    }

    # ==========【3、调用云端离线授权接口】==========
    Write-Host "正在调用云端接口，请稍候..." -ForegroundColor Cyan
    $resp = Invoke-RestMethod -Method Post `
        -Uri "https://tcm-prescription-system.pages.dev/api/license/export-license" `
        -Headers $headers `
        -Body $body `
        -ContentType "application/json"

    # ==========【4、检查返回结果并保存文件】==========
    if (-not $resp.success) {
        Write-Host "=====================================" -ForegroundColor Red
        Write-Host "❌ 生成失败：$($resp.error)" -ForegroundColor Red
        Write-Host "=====================================" -ForegroundColor Red
        Write-Host ""
        Write-Host "常见错误对照：" -ForegroundColor Yellow
        Write-Host "  · 激活码不存在       → 激活码输入错误，让客户重新复制"
        Write-Host "  · 激活码已被禁用     → 联系管理员在后台启用"
        Write-Host "  · 激活码已过期       → 联系管理员延期"
        Write-Host "  · 诊所名不一致       → 让客户从激活窗口复制完整诊所名（含全角字符）"
        Write-Host "  · machineId 长度错误 → 让客户重新复制 32 位机器ID"
        Write-Host "  · 操作过于频繁       → 每小时限 20 次，稍后再试"
        throw "接口返回失败"
    }

    # 自动保存授权文件到桌面 license.dat
    $desktopPath = [Environment]::GetFolderPath("Desktop")
    if (-not (Test-Path $desktopPath)) {
        # 桌面路径异常时回退到用户目录
        $desktopPath = $env:USERPROFILE
        Write-Host "⚠ 桌面路径不存在，回退到 $desktopPath" -ForegroundColor Yellow
    }
    $outputFile = Join-Path $desktopPath "license.dat"
    $resp.license | Out-File -FilePath $outputFile -Encoding utf8 -NoNewline

    # ==========【5、打印成功提示 + 授权信息】==========
    Write-Host ""
    Write-Host "=====================================" -ForegroundColor Green
    Write-Host "✅ 离线激活文件已生成" -ForegroundColor Green
    Write-Host "=====================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "📁 文件路径：$outputFile"
    Write-Host ""
    Write-Host "=== 授权信息（请核对）==="
    Write-Host "用户名:   $($resp.licenseInfo.user)"
    Write-Host "版本类型: $($resp.licenseInfo.type)"
    Write-Host "签发时间: $($resp.licenseInfo.issuedAt)"
    Write-Host "到期时间: $($resp.licenseInfo.expiresAt)"
    Write-Host "处方上限: $($resp.licenseInfo.maxPrescriptions) (0=无限)"
    Write-Host "功能列表: $($resp.licenseInfo.features -join ', ')"
    Write-Host "诊所名:   $($resp.licenseInfo.clinicName)"
    Write-Host "设备配额: $($resp.licenseInfo.maxDevices) (已绑定 $($resp.licenseInfo.devicesCount) 台)"
    Write-Host ""
    Write-Host "=== 下一步操作 ===" -ForegroundColor Cyan
    Write-Host "1. 把桌面 license.dat 文件通过微信/QQ/邮件发给客户"
    Write-Host "2. 微信发送 .dat 文件可能被拦截，建议改后缀为 .txt 发送，客户接收后改回 .dat"
    Write-Host "3. 让客户在激活窗口点击「📁 导入离线激活文件」选择该文件"
    Write-Host "4. 客户看到授权信息弹窗，核对诊所名后点击「确定」"
    Write-Host "5. 软件提示「✅ 激活成功」并自动重启"
    Write-Host ""
    Write-Host "=====================================" -ForegroundColor Green
    Write-Host "脚本执行完毕" -ForegroundColor Green
    Write-Host "=====================================" -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "=====================================" -ForegroundColor Red
    Write-Host "❌ 脚本执行异常" -ForegroundColor Red
    Write-Host "=====================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "错误信息：$($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "排查清单：" -ForegroundColor Cyan
    Write-Host "  1. 客服电脑是否能正常上网？（关闭代理/加速器重试）"
    Write-Host "  2. 密钥文件是否存在于 $env:USERPROFILE\.hktzy\ 且内容为 64 位字符？"
    Write-Host "  3. 返回 401/403 → 密钥已失效，联系管理员重新发放密钥文件"
    Write-Host "  4. 返回 429 → 操作过于频繁，每小时限 20 次，稍后再试"
    Write-Host "  5. 网络超时 → 检查网络后重试"
    Write-Host ""
    Write-Host "如无法解决，请截图本窗口联系技术支持" -ForegroundColor Yellow
}
finally {
    Write-Host ""
    Read-Host "按回车键关闭窗口"
}
