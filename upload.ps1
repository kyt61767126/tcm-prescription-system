Write-Host "========================================" -ForegroundColor Cyan
Write-Host "    快易通中医处方系统 - 一键上传" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$lockFile = ".git/index.lock"
if (Test-Path $lockFile) {
    Write-Host "[清理] 检测到 Git 锁定文件，正在清理..." -ForegroundColor Yellow
    Remove-Item -Path $lockFile -Force -ErrorAction SilentlyContinue
}

Write-Host "[1/4] 正在检查修改..." -ForegroundColor Green
git status
Write-Host ""

Write-Host "[2/4] 正在添加所有修改..." -ForegroundColor Green
git add .
Write-Host ""

$message = Read-Host "请输入更新说明（如：完善用户系统）"
Write-Host ""

Write-Host "[3/4] 正在提交修改..." -ForegroundColor Green
git commit -m "$message"
Write-Host ""

Write-Host "[4/4] 正在上传到 GitHub..." -ForegroundColor Green
git push origin main
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "    上传完成！" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Cloudflare Pages 会自动检测到更新并部署。" -ForegroundColor Gray
Write-Host "约1-2分钟后访问您的云端网址即可看到最新版本。" -ForegroundColor Gray
Write-Host ""
Read-Host "按 Enter 键退出"