Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Git 锁定问题彻底解决方案 (PowerShell)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/5] 检查 Git 锁定文件..." -ForegroundColor Yellow
$lockPath = ".git\index.lock"
if (Test-Path $lockPath) {
    Write-Host "  发现锁定文件: $lockPath" -ForegroundColor Red
    try {
        Remove-Item -Path $lockPath -Force -ErrorAction Stop
        Write-Host "  ✓ 锁定文件已删除" -ForegroundColor Green
    } catch {
        Write-Host "  ✗ 无法删除锁定文件，可能有进程持有" -ForegroundColor Red
        Write-Host "  错误: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "  ✓ 未发现锁定文件" -ForegroundColor Green
}

Write-Host ""
Write-Host "[2/5] 检查其他可能的锁定..." -ForegroundColor Yellow
$locks = Get-ChildItem -Path ".git" -Filter "*.lock" -Recurse -ErrorAction SilentlyContinue
if ($locks) {
    foreach ($lock in $locks) {
        Write-Host "  发现: $($lock.FullName)" -ForegroundColor Red
        Remove-Item -Path $lock.FullName -Force -ErrorAction SilentlyContinue
    }
    Write-Host "  ✓ 所有锁定文件已删除" -ForegroundColor Green
} else {
    Write-Host "  ✓ 未发现其他锁定文件" -ForegroundColor Green
}

Write-Host ""
Write-Host "[3/5] 验证 Git 状态..." -ForegroundColor Yellow
$gitPath = "C:\Program Files\Git\bin\git.exe"
if (-not (Test-Path $gitPath)) {
    Write-Host "  ✗ Git 未安装" -ForegroundColor Red
    exit 1
}

Write-Host "  Git 路径: $gitPath" -ForegroundColor Cyan
Write-Host "  测试 Git 命令..."

$output = & $gitPath status 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ Git 正常工作" -ForegroundColor Green
} else {
    Write-Host "  ✗ Git 执行失败" -ForegroundColor Red
    Write-Host "  输出: $output" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[4/5] 检查远程仓库..." -ForegroundColor Yellow
$remote = & $gitPath remote -v 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ 远程仓库已配置:" -ForegroundColor Green
    Write-Host "  $remote" -ForegroundColor Cyan
} else {
    Write-Host "  添加远程仓库..." -ForegroundColor Yellow
    & $gitPath remote add origin https://github.com/kyt61767126/kyt61767126-kyt-zy-cloud.git 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ 远程仓库已添加" -ForegroundColor Green
    } else {
        Write-Host "  ✗ 添加远程仓库失败" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "[5/5] 验证最终状态..." -ForegroundColor Yellow
Start-Sleep -Milliseconds 500
if (Test-Path ".git\index.lock") {
    Write-Host "  ✗ 锁定文件再次出现，可能有后台进程" -ForegroundColor Red
    Write-Host "  建议：请关闭 IDE 后重新尝试" -ForegroundColor Yellow
    exit 1
} else {
    Write-Host "  ✓ 无锁定文件，Git 可正常使用" -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  ✅ 所有检查完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "提示：" -ForegroundColor Cyan
Write-Host "  - 如需推送代码，请运行：" -ForegroundColor Cyan
Write-Host "    git add ." -ForegroundColor White
Write-Host "    git commit -m '您的提交信息'" -ForegroundColor White
Write-Host "    git push -u origin master" -ForegroundColor White
Write-Host ""
Write-Host "  - 如需查看状态：" -ForegroundColor Cyan
Write-Host "    git status" -ForegroundColor White
Write-Host ""

exit 0