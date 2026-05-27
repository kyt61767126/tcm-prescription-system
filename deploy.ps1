# 一键部署脚本
param(
    [string]$message = "更新代码"
)

Write-Host "=== 中医处方系统 - 一键部署 ===" -ForegroundColor Green
Write-Host ""

# 检查 git 状态
Write-Host "[1/4] 检查状态..." -ForegroundColor Cyan
git status

# 添加所有更改
Write-Host ""
Write-Host "[2/4] 添加更改..." -ForegroundColor Cyan
git add .

# 提交
Write-Host ""
Write-Host "[3/4] 提交更改..." -ForegroundColor Cyan
git commit -m $message

# 推送到远程仓库
Write-Host ""
Write-Host "[4/4] 推送到 GitHub..." -ForegroundColor Cyan
git push

Write-Host ""
Write-Host "=== 部署完成！===" -ForegroundColor Green
Write-Host "Cloudflare Pages 将在 1-2 分钟内自动部署" -ForegroundColor Yellow
