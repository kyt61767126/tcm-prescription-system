# ============================================================================
#  sync-license.ps1 — 同步 license 核心模块到 4 端桌面版
#
#  用途：
#    修改 _shared/license/ 下的 3 个主版本文件后，运行此脚本同步到 4 端
#    避免手工修改 4 份文件容易遗漏的问题
#
#  使用：
#    cd D:\trae_projects\kyt-zy\offline_project\_shared\license
#    .\sync-license.ps1                # 同步到全部 4 端
#    .\sync-license.ps1 -VerifyOnly    # 仅校验，不同步（CI/CD 用）
#
#  目标端（4 个）：
#    offline_project\db-bendi\electron\
#    offline_project\db-geren\electron\
#    offline_project\db-dingzhi\electron\
#    cloud_project\cloud_desktop\electron\
#
#  主版本文件（在此目录下修改）：
#    license-manager.js       (55076 bytes)
#    feature-guard.js         (3772 bytes)
#    prescription-counter.js  (5558 bytes)
# ============================================================================

param(
    [switch]$VerifyOnly = $false
)

# 项目根目录（脚本所在目录的祖父）
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $ScriptDir))

# 4 端 electron 目录的相对路径
$Targets = @(
    @{ Name = 'db-bendi';       Dir = "offline_project\db-bendi\electron" },
    @{ Name = 'db-geren';       Dir = "offline_project\db-geren\electron" },
    @{ Name = 'db-dingzhi';    Dir = "offline_project\db-dingzhi\electron" },
    @{ Name = 'cloud_desktop'; Dir = "cloud_project\cloud_desktop\electron" }
)

# 3 个核心模块文件
$Files = @('license-manager.js', 'feature-guard.js', 'prescription-counter.js')

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " 同步 license 核心模块到 4 端桌面版" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "项目根目录: $ProjectRoot"
Write-Host "主版本目录: $ScriptDir"
Write-Host "模式: $(if ($VerifyOnly) { '仅校验' } else { '同步' })"
Write-Host ""

# 校验主版本文件存在
$missingSource = @()
foreach ($f in $Files) {
    $srcPath = Join-Path $ScriptDir $f
    if (-not (Test-Path $srcPath)) {
        $missingSource += $f
    }
}
if ($missingSource.Count -gt 0) {
    Write-Host "❌ 主版本文件缺失: $($missingSource -join ', ')" -ForegroundColor Red
    exit 1
}

# 校验 / 同步
$mismatchCount = 0
$syncCount = 0

foreach ($target in $Targets) {
    $targetDir = Join-Path $ProjectRoot $target.Dir
    if (-not (Test-Path $targetDir)) {
        Write-Host "❌ 目标目录不存在: $($target.Dir)" -ForegroundColor Red
        $mismatchCount++
        continue
    }

    Write-Host "[$($target.Name)]" -ForegroundColor Yellow

    foreach ($f in $Files) {
        $srcPath = Join-Path $ScriptDir $f
        $dstPath = Join-Path $targetDir $f

        $srcHash = (Get-FileHash $srcPath -Algorithm SHA256).Hash
        if (Test-Path $dstPath) {
            $dstHash = (Get-FileHash $dstPath -Algorithm SHA256).Hash
        } else {
            $dstHash = $null
        }

        if ($srcHash -eq $dstHash) {
            Write-Host "  ✅ $f 已同步" -ForegroundColor Green
        } else {
            if ($VerifyOnly) {
                Write-Host "  ❌ $f 不一致 (需要同步)" -ForegroundColor Red
                $mismatchCount++
            } else {
                try {
                    Copy-Item -Path $srcPath -Destination $dstPath -Force
                    $newHash = (Get-FileHash $dstPath -Algorithm SHA256).Hash
                    if ($newHash -eq $srcHash) {
                        Write-Host "  ✅ $f 已同步 (覆盖)" -ForegroundColor Green
                        $syncCount++
                    } else {
                        Write-Host "  ❌ $f 同步后仍不一致" -ForegroundColor Red
                        $mismatchCount++
                    }
                } catch {
                    Write-Host "  ❌ $f 同步失败: $($_.Exception.Message)" -ForegroundColor Red
                    $mismatchCount++
                }
            }
        }
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
if ($VerifyOnly) {
    if ($mismatchCount -eq 0) {
        Write-Host " ✅ 校验通过：所有 4 端文件与主版本一致" -ForegroundColor Green
        exit 0
    } else {
        Write-Host " ❌ 校验失败：$mismatchCount 个文件不一致，请运行 sync-license.ps1 同步" -ForegroundColor Red
        exit 1
    }
} else {
    if ($mismatchCount -eq 0) {
        if ($syncCount -eq 0) {
            Write-Host " ✅ 全部 4 端已是最新（无需同步）" -ForegroundColor Green
        } else {
            Write-Host " ✅ 已同步 $syncCount 个文件到 4 端" -ForegroundColor Green
        }
        exit 0
    } else {
        Write-Host " ⚠️  部分同步失败：$mismatchCount 个文件" -ForegroundColor Yellow
        exit 1
    }
}
Write-Host "========================================" -ForegroundColor Cyan
