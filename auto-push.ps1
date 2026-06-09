Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  一键推送代码到 GitHub 仓库" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""

# 设置 Git 用户名和邮箱（可选）
git config user.name "Trae AI"
git config user.email "trae@example.com"

Write-Host "1. 检查当前分支..." -ForegroundColor Yellow
$branch = git rev-parse --abbrev-ref HEAD
Write-Host "   当前分支: $branch" -ForegroundColor Green

Write-Host ""
Write-Host "2. 检查修改状态..." -ForegroundColor Yellow
$status = git status --porcelain
if (-not $status) {
    Write-Host "   没有需要提交的修改" -ForegroundColor Red
    Write-Host ""
    Write-Host "==============================================" -ForegroundColor Cyan
    Write-Host "操作已取消" -ForegroundColor Yellow
    Write-Host "==============================================" -ForegroundColor Cyan
    Start-Sleep -Seconds 3
    exit
}

Write-Host "   发现以下修改:" -ForegroundColor Green
git status --short
Write-Host ""

Write-Host "3. 添加所有文件..." -ForegroundColor Yellow
git add .
Write-Host "   ✓ 文件已添加" -ForegroundColor Green

Write-Host ""
Write-Host "4. 提交更改..." -ForegroundColor Yellow
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$commitMessage = "修复网页版历史处方显示问题 | $timestamp"
git commit -m $commitMessage
Write-Host "   ✓ 提交成功" -ForegroundColor Green

Write-Host ""
Write-Host "5. 推送到远程仓库..." -ForegroundColor Yellow
git push origin $branch
if ($LASTEXITCODE -eq 0) {
    Write-Host "   ✓ 推送成功" -ForegroundColor Green
} else {
    Write-Host "   ✗ 推送失败，请检查网络连接或权限" -ForegroundColor Red
    Start-Sleep -Seconds 5
    exit
}

Write-Host ""
Write-Host "==============================================" -ForegroundColor Green
Write-Host "  推送完成！等待自动部署..." -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Green
Write-Host ""
Write-Host "提示: Cloudflare Pages 会自动检测并部署更新" -ForegroundColor Yellow
Start-Sleep -Seconds 3