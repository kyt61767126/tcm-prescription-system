# menu-core.ps1 - 交互菜单 / 结果横幅 / 官方链接（单一权威源）
# ★ 2026-10-30 P3 去重：此前 one-click-pack.ps1 与 release-menu.ps1 各自维护
#   Read-MenuChoice（EOF 防僵尸）、中文 pause、版本/范围选择菜单、发布结果横幅、
#   官网/Release URL（脚本内硬编码 12 处）。任一处修文案都要双改、且已出现漂移
#   （如 rc=3「无需发布」两处文案不一致）。现全部收敛到本模块：
#     1) Read-MenuChoice：菜单读入口（EOF 即报错退出，防 170MB 僵尸日志）
#     2) Enable-CnPause：中文 pause 覆盖（AutoMode 下 -Skip 变空操作）
#     3) Show-VersionMenu / Show-PackModeMenu / Show-VersionPicker：版本/范围选择
#     4) Show-PublishResult / Show-FinalSummary / Show-NextStepHint：结果横幅
#     5) $global:HKZY_OfficialUrls：下载页与 Release 链接唯一来源
#   用法（在入口脚本顶部）：
#     . (Join-Path $PSScriptRoot 'menu-core.ps1')
#     $global:HKZY_MenuUsageHint = '  非交互打包请用: ...'   # EOF 时的指引（多行用 `n）
#     Enable-CnPause -Skip:$script:SkipPause
#
#   约定：本模块只做「显示 + 选择 + 退出」，禁止放任何打包/发布/写盘业务逻辑。

$global:HKZY_OfficialUrls = @{
    Download = 'https://tcm-prescription-system.pages.dev/download'
    Release  = 'https://github.com/kyt61767126/tcm-prescription-system/releases'
}

# 非交互环境（stdin 关闭）时 Read-MenuChoice 打印的指引；由调用脚本按场景覆盖
if (-not $global:HKZY_MenuUsageHint) { $global:HKZY_MenuUsageHint = '' }

# ★ 2026-09-05 防僵尸菜单（15:40 事故根因架构修复）：
#   非交互环境（stdin 被管道/重定向/自动化宿主关闭）调用交互菜单时，Read-Host 恒返回
#   $null → switch default → 死循环 Clear-Host+Read-Host，每秒刷一屏产生 170MB+ 僵尸日志。
#   统一菜单读入口：EOF 即明确报错退出并指引非交互入口。
#   注意：用户直接按回车返回 ""（空串，正常重显菜单）；EOF 才是 $null，二者严格区分。
function Read-MenuChoice {
    param(
        [Parameter(Mandatory = $true)][string]$Prompt,
        [string]$Hint = ''
    )
    $c = Read-Host $Prompt
    if ($null -eq $c) {
        Write-Host ""
        Write-Host "[FATAL] 标准输入已关闭：交互菜单在非交互环境（管道/自动化调用）中运行。" -ForegroundColor Red
        $useHint = if ($Hint) { $Hint } else { $global:HKZY_MenuUsageHint }
        if ($useHint) { Write-Host $useHint -ForegroundColor Yellow }
        exit 1
    }
    return $c
}

# ★ 2026-09-01 中文暂停提示：覆盖内置 pause（英文 "Press Enter to continue..."），
#   调用脚本所有 pause 调用点自动变为中文提示，无需逐处修改。
#   -Skip：非交互/自动模式，把 pause 变空操作（原 AutoMode 行为）。
function Enable-CnPause {
    param([switch]$Skip)
    Remove-Item alias:pause -ErrorAction SilentlyContinue
    if ($Skip) {
        function global:pause {}
    } else {
        function global:pause {
            $null = Read-Host '按回车键继续...'
        }
    }
}

# ============ 版本选择（发布/全流程：打包 / 发布 / 打包+发布+验证）============
function Show-VersionMenu {
    param(
        [string]$Action,        # pack / publish / full
        [switch]$AllowSmart     # ★ 2026-10-30 P7：打包动作额外给「智能打包」项（返回 smart）
    )
    while ($true) {
        Clear-Host
        $actionLabel = switch ($Action) {
            "pack"    { "打包" }
            "publish" { "发布" }
            "full"    { "打包 + 发布 + 验证" }
        }
        # ★ 2026-10-30 P6：全流程的「全部」走智能打包（AutoMode 4），菜单文案须如实标注，
        #   否则用户以为仍是全量重打（文案与实际行为漂移是历史误报源）。
        $allLabel = if ($Action -eq 'full') { "全部2个版本（智能打包：自动检测需重打的端）" } else { "全部2个版本" }
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  选择版本 - $actionLabel" -ForegroundColor Cyan
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  [1] 云端版"
        Write-Host "  [2] 本地版"
        Write-Host "  [3] $allLabel"
        if ($AllowSmart) {
            # ★ 2026-10-30 P7：原「一键打包.bat 菜单 [4] 智能打包」并入统一入口，
            #   语义 = AutoMode 4（先打印四端「重打/跳过」计划，整组无改动连配置同步都不跑）。
            Write-Host "  [4] 智能打包（自动检测需重打的端，推荐日常）" -ForegroundColor Yellow
        }
        Write-Host "  [0] 返回主菜单"
        Write-Host ""
        $prompt = if ($AllowSmart) { "请选择 [0-4]" } else { "请选择 [0-3]" }
        $choice = Read-MenuChoice $prompt
        switch ($choice) {
            "1" { return "cloud" }
            "2" { return "dingzhi" }
            "3" { return "all" }
            "4" { if ($AllowSmart) { return "smart" } }
            "0" { return "" }
            default { Write-Host "无效选择" -ForegroundColor Red; Start-Sleep -Seconds 1 }
        }
    }
}

# ============ 范围选择（桌面 / APP / 全部）============
# $ScopeTitle: "打包" / "发布" —— 同一菜单复用于打包与发布范围选择（返回值语义一致：desktop/app/all）
function Show-PackModeMenu {
    param([string]$ScopeTitle = "打包")
    while ($true) {
        Clear-Host
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  选择$ScopeTitle范围" -ForegroundColor Cyan
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  [1] 桌面 exe"
        Write-Host "  [2] 手机 APP"
        Write-Host "  [3] 桌面 + APP (全部)"
        Write-Host "  [0] 返回主菜单"
        Write-Host ""
        $choice = Read-MenuChoice "请选择 [0-3]"
        switch ($choice) {
            "1" { return "desktop" }
            "2" { return "app" }
            "3" { return "all" }
            "0" { return "" }
            default { Write-Host "无效选择" -ForegroundColor Red; Start-Sleep -Seconds 1 }
        }
    }
}

# ============ 纯选择器（打包菜单用：只返回版本，不执行打包）============
# ★ 2026-10-30 P3：原 one-click-pack.ps1 的 Show-PickVersionMenu 是「菜单 + 打包编排」
#   混在一起；本函数只负责选择（返回 cloud/dingzhi/all/""），执行留在调用方。
function Show-VersionPicker {
    param(
        [string]$Title,
        [string]$AllLabel = '云端+本地'
    )
    while ($true) {
        Clear-Host
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  $Title" -ForegroundColor Cyan
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  [1] 云端版"
        Write-Host "  [2] 本地版"
        Write-Host "  [3] $AllLabel"
        Write-Host "  [0] 返回主菜单"
        Write-Host ""
        $choice = Read-MenuChoice "请选择 [0-3]"
        switch ($choice) {
            "1" { return "cloud" }
            "2" { return "dingzhi" }
            "3" { return "all" }
            "0" { return "" }
            default { Write-Host "无效选择" -ForegroundColor Red; Start-Sleep -Seconds 1 }
        }
    }
}

# ============ 各版本独立打包入口说明 ============
# ★ 2026-10-30 P7：原在 one-click-pack.ps1 内部；入口收敛后两个菜单都要用，迁到共享内核。
function Show-StandaloneUsage {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  各版本独立打包入口" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  云端版 (app_project/db-yunduan):" -ForegroundColor Yellow
    Write-Host "    pack-desktop.bat       打包桌面版"
    Write-Host "    pack-app.bat           打包手机APP (严格模式)"
    Write-Host ""
    Write-Host "  本地版 (app_project/db-offline):" -ForegroundColor Yellow
    Write-Host "    pack-desktop.bat       打包桌面版"
    Write-Host "    pack-app.bat           打包手机APP (严格模式)"
    Write-Host ""
    Write-Host "  提示: 直接双击对应目录下的 bat 文件即可" -ForegroundColor DarkGray
    Write-Host "  提示: 也可用统一入口单端打包 —— 一键构建发布.bat pack cloud app" -ForegroundColor DarkGray
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    pause
}

# ============ 统一发布结果汇总（明确中文提示）============
# ★ 2026-09-01 新增：发布环节结束后统一输出成败大字块 + 产物入口 + 生效提示，
#   替代原先"只有下一步指引、成败要回翻日志"的弱提示。
function Show-PublishResult {
    param(
        [int]$ExitCode,
        [string]$Label = "发布"
    )
    Write-Host ""
    if ($ExitCode -eq 0) {
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "  [发布成功] $Label" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "  下载页: $($global:HKZY_OfficialUrls.Download)"
        Write-Host "  Release: $($global:HKZY_OfficialUrls.Release)"
        Write-Host "  Cloudflare Pages 将在 1-2 分钟内自动部署下载页" -ForegroundColor Yellow
    } else {
        Write-Host "========================================" -ForegroundColor Red
        Write-Host "  [发布失败] $Label （退出码: $ExitCode）" -ForegroundColor Red
        Write-Host "========================================" -ForegroundColor Red
        Write-Host "  完整原因与补救方法见上方 [ERROR] 明细块；常见原因:"
        Write-Host "  - 网络超时（上传 75MB exe 需 5-10 分钟，可重跑恢复）"
        Write-Host "  - 源码未落定（先 commit 再发布）"
        Write-Host "  - 合规检查未通过（按提示修复后重试）"
        Write-Host "  重跑入口: 本菜单 [3] 智能发布（产物 hash 未变会自动续传）"
    }
}

# ============ 最终结果汇总（结束前明确中文提示）============
# ★ 2026-09-01 新增：菜单动作结束后、返回菜单/暂停前，统一输出最终汇总块——
#   产物位置 + 发布状态 + 下一步指引，用户不需回翻日志即知"结果如何、东西在哪、
#   接下来做什么"（此前副作用收纳后直接 Press Enter，结果提示弱）。
function Show-FinalSummary {
    param([string]$ActionLabel = "本次操作")
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "  $ActionLabel 已结束" -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "  产物位置（本机最新打包版本）:"
    Write-Host "    云端桌面 exe : app_project\db-yunduan\cloud_desktop\dist\"
    Write-Host "    云端手机 APP : app_project\db-yunduan\惠康中医-云端.apk"
    Write-Host "    离线桌面 exe : app_project\db-offline\desktop\dist\"
    Write-Host "    离线手机 APP : app_project\db-offline\惠康中医-本地.apk"
    Write-Host "  发布状态: 打包产物不会自动上传官网（安全规范，需人工确认）" -ForegroundColor Yellow
    Write-Host "  如需发布 : 双击 一键构建发布.bat → 选 [3] 智能发布（仅上传有变化的产物）"
    Write-Host "  下载页   : $($global:HKZY_OfficialUrls.Download)"
    Write-Host "============================================" -ForegroundColor Cyan
}

# ============ 发布后「下一步指引」小块（菜单内多处复用）============
function Show-NextStepHint {
    Write-Host ""
    Write-Host "--------------------------------------------"
    Write-Host "  下一步指引:" -ForegroundColor Yellow
    Write-Host "  - 建议运行 [5] 验证 URL"
    Write-Host "  - 下载页: $($global:HKZY_OfficialUrls.Download)"
    Write-Host "  - Release: $($global:HKZY_OfficialUrls.Release)"
    Write-Host "--------------------------------------------"
}
