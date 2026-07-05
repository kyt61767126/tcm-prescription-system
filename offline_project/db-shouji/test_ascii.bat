@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

set "HTML_FILE=%TEMP%\test_ascii.html"

(
echo clinicName: 'ClinicA'
echo doctorName: 'DoctorA'
echo ^<div class="clinic-info-name">ClinicA^</div>
echo ^<div id="clinicNameDisplay">ClinicA^</div>
) > "%HTML_FILE%"

echo === BEFORE ===
type "%HTML_FILE%"
echo.

set "NEW_CLINIC=ClinicB"
set "NEW_DOCTOR=DoctorB"

powershell -Command "$file = '%HTML_FILE%'; $clinic = '%NEW_CLINIC%'; $doctor = '%NEW_DOCTOR%'; $content = Get-Content -Path $file -Raw -Encoding UTF8; $content = [regex]::Replace($content, \"clinicName:\s*'[^']*'\", \"clinicName: '$clinic'\"); $content = [regex]::Replace($content, \"doctorName:\s*'[^']*'\", \"doctorName: '$doctor'\"); $content = [regex]::Replace($content, 'clinic-info-name\">[^<]*<', \"clinic-info-name\">$clinic<\"); $content = [regex]::Replace($content, 'clinicNameDisplay\">[^<]*<', \"clinicNameDisplay\">$clinic<\"); [System.IO.File]::WriteAllText($file, $content, [System.Text.Encoding]::UTF8); Write-Output 'OK'"

echo.
echo === AFTER ===
type "%HTML_FILE%"

del "%HTML_FILE%" >nul 2>&1
echo.
pause
