# ============================================================================
#  gen-code-sign-cert.ps1 — 生成 Windows 代码签名自签证书（任务3）
#
#  用途：
#    1. 生成自签代码签名证书（Code Signing Self-Signed Certificate）
#    2. 导出 .pfx 文件（含私钥，用于 electron-builder 签名 exe）
#    3. 提示用户配置 3 端 package.json 的 win.certificateFile 字段
#
#  限制：
#    - 自签证书不会被 Windows 信任，SmartScreen 仍会拦截首次运行
#    - 真正消除 SmartScreen 警告需要购买 OV/EV 代码签名证书
#    - 自签证书的作用：保证 exe 完整性 + 防篡改（用户可手动加入信任根）
#
#  使用方法：
#    cd c:\Users\61767\Documents\trae_projects\kyt-zy
#    powershell -NoProfile -ExecutionPolicy Bypass -File tools\gen-code-sign-cert.ps1
#
#  生成的文件：
#    tools\certs\惠康中医-codesign.pfx       (证书 + 私钥，密码保护)
#    tools\certs\惠康中医-codesign.cer       (证书公钥，可分发给用户)
#
#  密码：
#    从 tools/certs/cert-password.txt 读取（该文件已被 .gitignore 排除，不会入库）
#    若文件不存在，则交互式输入
# ============================================================================

# P1-安全加固: 证书密码从本地 cert-password.txt 读取，避免硬编码泄露
$CertPasswordFile = Join-Path $PSScriptRoot 'certs\cert-password.txt'
if (Test-Path $CertPasswordFile) {
    $CertPassword = (Get-Content $CertPasswordFile -Raw).Trim()
} else {
    Write-Host "⚠️  cert-password.txt 未找到，请输入证书密码：" -ForegroundColor Yellow
    $securePwd = Read-Host -AsSecureString
    $CertPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePwd))
}
$CertSubject = 'CN=惠康中医软件, O=本能堂中医诊所, C=CN'
$CertName = '惠康中医-代码签名证书'
$PfxPath = Join-Path $PSScriptRoot 'certs\惠康中医-codesign.pfx'
$CerPath = Join-Path $PSScriptRoot 'certs\惠康中医-codesign.cer'

# 创建 certs 目录
$CertDir = Split-Path $PfxPath -Parent
if (-not (Test-Path $CertDir)) {
    New-Item -Path $CertDir -ItemType Directory -Force | Out-Null
    Write-Host "✅ 创建证书目录: $CertDir" -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " 生成 Windows 代码签名自签证书" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "证书主题: $CertSubject"
Write-Host "PFX 路径: $PfxPath"
Write-Host "CER 路径: $CerPath"
Write-Host "密码:     $CertPassword"
Write-Host ""

# 检查是否已存在旧证书
if (Test-Path $PfxPath) {
    Write-Host "⚠️  发现已存在旧证书，是否覆盖？(Y/N)" -ForegroundColor Yellow
    $confirm = Read-Host
    if ($confirm -ne 'Y' -and $confirm -ne 'y') {
        Write-Host "已取消" -ForegroundColor Red
        exit 0
    }
    Remove-Item $PfxPath -Force
    Remove-Item $CerPath -Force -ErrorAction SilentlyContinue
}

# 1. 生成自签证书（PowerShell New-SelfSignedCertificate）
Write-Host "[1/4] 生成自签证书..." -ForegroundColor Yellow
try {
    # Code Signing EKU OID: 1.3.6.1.5.5.7.3.3
    # 必须用 -Type CodeSigningCert 才能用于代码签名
    $cert = New-SelfSignedCertificate `
        -Subject $CertSubject `
        -Type CodeSigningCert `
        -KeyAlgorithm RSA -KeyLength 4096 `
        -HashAlgorithm SHA256 `
        -NotAfter (Get-Date).AddYears(5) `
        -CertStoreLocation 'Cert:\CurrentUser\My' `
        -FriendlyName $CertName

    if ($null -eq $cert) {
        throw '证书生成失败'
    }
    Write-Host "✅ 自签证书已生成: $($cert.Thumbprint)" -ForegroundColor Green
} catch {
    Write-Host "❌ 生成证书失败: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "可能原因:" -ForegroundColor Yellow
    Write-Host "  1. 需要管理员权限运行 PowerShell（请以管理员身份运行）"
    Write-Host "  2. Windows 不支持 New-SelfSignedCertificate（旧版系统）"
    Write-Host "  3. 替代方案：用 OpenSSL 生成证书"
    exit 1
}

# 2. 导出 PFX（含私钥，密码保护）
Write-Host ""
Write-Host "[2/4] 导出 PFX 文件（含私钥）..." -ForegroundColor Yellow
try {
    $pwd = ConvertTo-SecureString -String $CertPassword -Force -AsPlainText
    $certPath = "Cert:\CurrentUser\My\$($cert.Thumbprint)"
    Export-PfxCertificate -Cert $certPath -FilePath $PfxPath -Password $pwd | Out-Null
    Write-Host "✅ PFX 已导出: $PfxPath" -ForegroundColor Green
} catch {
    Write-Host "❌ 导出 PFX 失败: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# 3. 导出 CER（公钥证书，可分发给用户加入信任根）
Write-Host ""
Write-Host "[3/4] 导出 CER 文件（公钥）..." -ForegroundColor Yellow
try {
    Export-Certificate -Cert $certPath -FilePath $CerPath | Out-Null
    Write-Host "✅ CER 已导出: $CerPath" -ForegroundColor Green
} catch {
    Write-Host "⚠️  导出 CER 失败（不影响打包，可忽略）: $($_.Exception.Message)" -ForegroundColor Yellow
}

# 4. 从当前用户存储删除证书（避免误用未导出的副本）
Write-Host ""
Write-Host "[4/4] 清理证书存储..." -ForegroundColor Yellow
try {
    Remove-Item -Path $certPath -Force
    Write-Host "✅ 已从 Cert:\CurrentUser\My 移除临时证书副本" -ForegroundColor Green
} catch {
    Write-Host "⚠️  清理证书存储失败（不影响功能）: $($_.Exception.Message)" -ForegroundColor Yellow
}

# 完成
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " ✅ 自签证书生成完成" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "【生成的文件】"
Get-ChildItem $CertDir | ForEach-Object {
    $size = '{0:N1} KB' -f ($_.Length / 1KB)
    Write-Host "  $($_.Name)  ($size)"
}
Write-Host ""
Write-Host "【密码】 已保存在 cert-password.txt（gitignore 排除，不会入库）"
Write-Host ""
Write-Host "【下一步操作】"
Write-Host "1) 检查 3 端 package.json 是否已配置 win.certificateFile"
Write-Host "   证书密码通过 cert-password.txt + CSC_KEY_PASSWORD 环境变量自动注入"
Write-Host "   - app_project/cloud_desktop/package.json"
Write-Host "   - app_project/db-geren/package.json"
Write-Host "   - app_project/db-dingzhi/package.json"
Write-Host ""
Write-Host "2) 首次打包前需把证书加入 Windows 信任根（仅本机测试用）："
Write-Host "   certutil -addstore -user Root `"$CerPath`""
Write-Host ""
Write-Host "3) 分发给用户时附带 .cer 文件，让用户手动加入信任根："
Write-Host "   双击 .cer → 安装证书 → 本地计算机 → 受信任的根证书颁发机构"
Write-Host ""
Write-Host "【限制说明】"
Write-Host "  - 自签证书不会被 Windows SmartScreen 信任，首次运行仍会提示风险"
Write-Host "  - 真正消除 SmartScreen 警告需要购买 OV/EV 代码签名证书（约 $200-400/年）"
Write-Host "  - 自签证书的优势：保证 exe 完整性 + 防篡改 + 用户可手动加入信任"
Write-Host ""
