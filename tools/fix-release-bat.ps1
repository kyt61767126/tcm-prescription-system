# fix-release-bat.ps1 - 修复「一键发布.bat」（别名转发版）的编码与行尾
#
# ★ 2026-10-30 P3 修复（重要）：
#   本工具旧版会把 一键发布.bat 重写成「直接调用 release-menu.ps1」的英文引导版。
#   P2 之后 一键发布.bat 是统一入口（一键构建发布.bat）的别名转发器，旧模板一旦被
#   执行就会把别名覆盖直连版，丢掉：参数透传（full/pack/publish/hot/verify、--yes）、
#   入口预检、codepage 恢复、退出码透传 —— 属于"工具悄悄回退架构"的真实事故源。
#
#   现行为（幂等、非破坏）：
#     1) 已含别名标记（引用 一键构建发布.bat）→ 只做 CRLF 归一，不重写内容；
#     2) 仍是旧直连版 / 文件缺失 → 才生成别名转发版（UTF-8 无 BOM + CRLF）；
#     3) 任何情况下都不会删除用户的参数解析与预检逻辑。
#
# 说明：别名 bat 内部引用中文文件名，必须先 `chcp 65001`（模板已含），
#       且文件必须是 UTF-8 无 BOM（BOM 会让 cmd 把首行 @echo off 解析成乱码）。

$root = Split-Path $PSScriptRoot -Parent
$batPath = Join-Path $root '一键发布.bat'
$aliasMarker = '一键构建发布.bat'

$content = @"
@echo off
REM ============================================================================
REM  one-click publish - ALIAS entry (kept for muscle memory / desktop shortcuts)
REM
REM  Since 2026-10-30 P2 the build+release kernel is exposed by a single entry:
REM      one-click-build-release.bat  (a.k.a. 一键构建发布.bat)
REM  This file only forwards its arguments there, so both names behave identically:
REM      one-click-publish.bat                          -> interactive menu
REM      one-click-publish.bat full --yes               -> pack + hot-sign + publish + verify
REM      one-click-publish.bat pack cloud desktop       -> pack cloud desktop only
REM      one-click-publish.bat hot [--yes]              -> hot-update check (/ re-sign)
REM      one-click-publish.bat verify                   -> verify published artifacts
REM
REM  Why not just rename: existing docs / shortcuts / knowledge notes reference
REM  "一键发布.bat", and the pack entry ("一键打包.bat") is still its own menu.
REM  Keeping a 10-line forwarder avoids two divergent implementations.
REM ============================================================================
for /f "tokens=2 delims=:" %%c in ('chcp') do set "OLD_CP=%%c"
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

set "UNIFIED=%~dp0一键构建发布.bat"
if not exist "%UNIFIED%" (
    powershell -NoProfile -Command "Write-Host '[ERROR] 一键构建发布.bat not found' -ForegroundColor Red"
    echo   Path: %UNIFIED%
    if not defined NO_PAUSE pause
    set "EXIT_CODE=1"
    goto do_exit
)

call "%UNIFIED%" %*
set "EXIT_CODE=%errorlevel%"
goto do_exit

:do_exit
if defined OLD_CP chcp %OLD_CP: =% >nul
exit /b %EXIT_CODE%
"@

if (Test-Path $batPath) {
    $existing = Get-Content -LiteralPath $batPath -Raw -Encoding UTF8
    if ($existing -and $existing.Contains($aliasMarker)) {
        # 已是别名版：只归一 CRLF，绝不重写内容（保护用户手工补充的参数/预检）
        $normalized = $existing -replace "`r`n", "`n" -replace "`n", "`r`n"
        if ($normalized -ne $existing) {
            [System.IO.File]::WriteAllText($batPath, $normalized, (New-Object System.Text.UTF8Encoding($false)))
            Write-Host "[OK] 一键发布.bat 已是别名版，仅归一 CRLF: $batPath"
        } else {
            Write-Host "[OK] 一键发布.bat 已是别名版且 CRLF 正常，无需改动: $batPath"
        }
        exit 0
    }
    Write-Host "[WARN] 一键发布.bat 不是别名版（疑似旧直连版），将重写为别名转发版" -ForegroundColor Yellow
}

# 强制 CRLF；UTF-8 无 BOM（cmd 遇到 BOM 会把首行解析成乱码）
$content = $content -replace "`r`n", "`n" -replace "`n", "`r`n"
[System.IO.File]::WriteAllText($batPath, $content, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "[OK] 一键发布.bat 已重写为别名转发版（UTF-8 无 BOM + CRLF）: $batPath"
Write-Host "     统一入口: $aliasMarker（无参=交互菜单；full --yes / pack / publish / hot / verify）"
exit 0
