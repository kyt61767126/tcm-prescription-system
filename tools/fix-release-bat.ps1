# fix-release-bat.ps1 - 生成纯英文 CRLF 行尾的一键发布.bat
# 解决 .bat 中文 GBK 乱码和 LF 行尾导致的 cmd.exe 解析错误

$batPath = Join-Path (Split-Path $PSScriptRoot -Parent) "一键发布.bat"

$content = @"
@echo off
setlocal enableextensions
cd /d "%~dp0"

REM One-Click Publish (Chinese name entry, symmetric with one-click-pack.bat)
REM Calls PowerShell script release-menu.ps1 to avoid Chinese GBK encoding issues
REM PowerShell supports UTF-8 and single version selection

set "RELEASE_PS1=%~dp0tools\release-menu.ps1"
if not exist "%RELEASE_PS1%" (
    powershell -NoProfile -Command "Write-Host '[ERROR] release-menu.ps1 not found'"
    echo   Path: %RELEASE_PS1%
    if not defined NO_PAUSE pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%RELEASE_PS1%"
set "EXIT_CODE=%errorlevel%"

if %EXIT_CODE% neq 0 (
    echo.
    powershell -NoProfile -Command "Write-Host '[ERROR] One-click publish exited with code: %EXIT_CODE%'"
)
echo.
if not defined NO_PAUSE pause
"@

# 强制 CRLF 行尾
$content = $content -replace "`r`n", "`n" -replace "`n", "`r`n"

# 用 ASCII 编码写入（.bat 文件应使用 ASCII 或 GBK，避免 UTF-8 BOM 导致的首行解析问题）
[System.IO.File]::WriteAllText($batPath, $content, [System.Text.Encoding]::ASCII)

Write-Host "[OK] 一键发布.bat 已重写为纯英文 CRLF 格式: $batPath"
