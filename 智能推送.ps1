Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Git 提交和推送脚本（自动处理锁定）" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$gitPath = "C:\Program Files\Git\bin\git.exe"
if (-not (Test-Path $gitPath)) {
    Write-Host "✗ Git 未安装" -ForegroundColor Red
    exit 1
}

Write-Host "[1/5] 检查并删除 index.lock..." -ForegroundColor Yellow
$lockPath = ".git\index.lock"
if (Test-Path $lockPath) {
    Remove-Item -Path $lockPath -Force -ErrorAction SilentlyContinue
    Write-Host "  ✓ 锁定文件已删除" -ForegroundColor Green
} else {
    Write-Host "  ✓ 无锁定文件" -ForegroundColor Green
}

Write-Host ""
Write-Host "[2/5] 配置 Git 用户信息..." -ForegroundColor Yellow
& $gitPath config user.name "kyt61767126"
& $gitPath config user.email "61767126@qq.com"
Write-Host "  ✓ 用户信息已配置" -ForegroundColor Green

Write-Host ""
Write-Host "[3/5] 检查远程仓库..." -ForegroundColor Yellow
$remote = & $gitPath remote -v 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "  添加远程仓库..." -ForegroundColor Yellow
    & $gitPath remote add origin https://github.com/kyt61767126/kyt61767126-kyt-zy-cloud.git 2>&1 | Out-Null
    Write-Host "  ✓ 远程仓库已添加" -ForegroundColor Green
} else {
    Write-Host "  ✓ 远程仓库已配置" -ForegroundColor Green
}

Write-Host ""
Write-Host "[4/5] 提交代码..." -ForegroundColor Yellow
Write-Host "  正在暂存所有文件..." -ForegroundColor Cyan
& $gitPath add . 2>&1 | Out-Null

Write-Host "  正在提交..." -ForegroundColor Cyan
$commitResult = & $gitPath commit -m "配置 Cloudflare Pages 部署 - 完善云端功能" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ✗ 提交失败，尝试重新处理锁定..." -ForegroundColor Red
    if (Test-Path $lockPath) {
        Remove-Item -Path $lockPath -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 500
    & $gitPath add . 2>&1 | Out-Null
    $commitResult = & $gitPath commit -m "配置 Cloudflare Pages 部署 - 完善云端功能" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ✗ 提交仍然失败" -ForegroundColor Red
        Write-Host "  错误: $commitResult" -ForegroundColor Red
        exit 1
    }
}
Write-Host "  ✓ 代码已提交" -ForegroundColor Green

Write-Host ""
Write-Host "[5/5] 推送代码..." -ForegroundColor Yellow
Write-Host "  正在推送到 GitHub..." -ForegroundColor Cyan
$pushResult = & $gitPath push -u origin master --force 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ✗ 推送失败" -ForegroundColor Red
    Write-Host "  错误: $pushResult" -ForegroundColor Red
    Write-Host ""
    Write-Host "  可能的原因：" -ForegroundColor Yellow
    Write-Host "  - 网络连接问题" -ForegroundColor White
    Write-Host "  - GitHub 认证失败" -ForegroundColor White
    Write-Host "  - 其他网络错误" -ForegroundColor White
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  ✅ 完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "已成功推送到 GitHub！" -ForegroundColor Cyan
Write-Host "Cloudflare Pages 将自动检测并部署。" -ForegroundColor Cyan
Write-Host ""
Write-Host "提示：部署通常需要 1-3 分钟。" -ForegroundColor Yellow
Write-Host "请访问以下网址查看部署状态：" -ForegroundColor Yellow
Write-Host "https://dash.cloudflare.com/pages/view/kyt61767126-kyt-zy-cloud" -ForegroundColor White
Write-Host ""

exit 0