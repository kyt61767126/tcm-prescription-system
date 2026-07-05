@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

set "HTML_FILE=%TEMP%\test_config.html"

echo clinicName: '本能堂中医诊所'> "%HTML_FILE%"
echo doctorName: '张大夫'>> "%HTML_FILE%"
echo ^<div class="clinic-info-name">本能堂中医诊所^</div>>> "%HTML_FILE%"
echo ^<div id="clinicNameDisplay">本能堂中医诊所^</div>>> "%HTML_FILE%"

echo === 替换前 ===
type "%HTML_FILE%"
echo.

set "NEW_CLINIC=惠民中医诊所"
set "NEW_DOCTOR=李大夫"

powershell -Command "$file = '%HTML_FILE%'; $clinic = '%NEW_CLINIC%'; $doctor = '%NEW_DOCTOR%'; $content = Get-Content -Path $file -Raw -Encoding UTF8; $content = [regex]::Replace($content, \"clinicName:\s*'[^']*'\", \"clinicName: '$clinic'\"); $content = [regex]::Replace($content, \"doctorName:\s*'[^']*'\", \"doctorName: '$doctor'\"); $content = [regex]::Replace($content, 'clinic-info-name\">[^<]*<', \"clinic-info-name\">$clinic<\"); $content = [regex]::Replace($content, 'clinicNameDisplay\">[^<]*<', \"clinicNameDisplay\">$clinic<\"); [System.IO.File]::WriteAllText($file, $content, [System.Text.Encoding]::UTF8); Write-Output 'OK'"

echo.
echo === 替换后 ===
type "%HTML_FILE%"

del "%HTML_FILE%" >nul 2>&1
echo.
pause
