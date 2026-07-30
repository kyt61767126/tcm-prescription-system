# fix-release-bat.ps1 - 生成纯英文 CRLF 行尾的 release-all.bat
# 解决 .bat 中文 GBK 乱码和 LF 行尾导致的 cmd.exe 解析错误

$batPath = Join-Path (Split-Path $PSScriptRoot -Parent) "release-all.bat"

$content = @"
@echo off
chcp 65001 >nul
title Huikang TCM Release Pipeline

REM release-all.bat - Top entry point
REM Calls PowerShell script release-menu.ps1 to avoid Chinese GBK encoding issues
REM PowerShell supports UTF-8 and single version selection

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\release-menu.ps1"
set RC=%ERRORLEVEL%
if not "%RC%"=="0" (
    echo.
    echo [ERROR] Script failed with exit code: %RC%
    if not defined NO_PAUSE pause
)

exit /b %RC%
"@

# 强制 CRLF 行尾
$content = $content -replace "`r`n", "`n" -replace "`n", "`r`n"

# 用 ASCII 编码写入（.bat 文件应使用 ASCII 或 GBK，避免 UTF-8 BOM 导致的首行解析问题）
[System.IO.File]::WriteAllText($batPath, $content, [System.Text.Encoding]::ASCII)

Write-Host "[OK] release-all.bat 已重写为纯英文 CRLF 格式: $batPath"
