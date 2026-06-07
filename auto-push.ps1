Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "自动推送代码到 GitHub 仓库" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "1. 添加所有文件..." -ForegroundColor Yellow
git add .

Write-Host ""
Write-Host "2. 提交更改..." -ForegroundColor Yellow
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
git commit -m "Auto update: $timestamp"

Write-Host ""
Write-Host "3. 推送到远程仓库..." -ForegroundColor Yellow
git push

Write-Host ""
Write-Host "==============================================" -ForegroundColor Green
Write-Host "推送完成！" -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Green
Start-Sleep -Seconds 2