@echo off
chcp 65001 >nul
REM P0: .ps1 BOM
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\..\tools\fix-ps1-bom.ps1" >nul 2>&1
title Huikang-TCM Build Tool

REM 模式识别：standard = 严格模式（哈希失败强制中断），无参 = 普通模式
REM 两者均启用签名哈希刷新 + Java 层混淆 + 签名校验；strict 额外对哈希失败做强校验
set "STRICT_MODE="
set "MODE_LABEL=普通模式"
if /i "%~1"=="standard" (
    set "STRICT_MODE=1"
    set "MODE_LABEL=严格模式"
)

REM
for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"

REM 统一安装包：单 APK，标准版/机构版由运行时激活码决定（合并 8 包 → 4 包）
set "FLAVOR_TARGET=dingzhi"
set "FLAVOR_NAME="
set "FLAVOR_CAP="
set "APK_NAME=惠康中医-本地"
set "ASSEMBLE_TASK=:app:assembleRelease"
set "APK_DIR=app\build\outputs\apk\release"


echo ============================================
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Huikang TCM Offline APP Build Tool (%FLAVOR_NAME%)'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '打包模式: %MODE_LABEL%'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Flavor: %FLAVOR%'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Start: %BUILD_START_TIME%'"
echo ============================================
echo.

cd /d "%~dp0"

set "SCRIPT_DIR=%~dp0"
set "OFFLINE_DIR=%SCRIPT_DIR:~0,-1%"
for %%I in ("%OFFLINE_DIR%\..") do set "OFFLINE_DIR=%%~fI"
for %%I in ("%OFFLINE_DIR%\..\..") do set "REPO_ROOT=%%~fI"

REM ★ 2026-08-17 新增：版本号一致性预检（举一反三杜绝离线APP版本不一致）
REM 打包前检查：index-app.html __APP_VERSION__ = desktop/index.html __APP_VERSION__
REM 任何不一致直接 exit 1 终止打包
echo [0/10] Version consistency precheck (offline APP group)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%REPO_ROOT%\tools\verify-app-version-consistency.ps1" -Target offline -RepoRoot "%REPO_ROOT%"
if errorlevel 1 exit /b 1
echo.

REM ★ 2026-08-17 新增：诊所名/医师名硬编码反模式扫描（举一反三预防）
REM 禁止运行期回退值写死"本能堂"字面量 / 禁止config版本变化时清空用户诊所名。
REM 任何违规直接 exit 1 终止打包，防止登录框/处方PDF回显过时诊所名的bug复发。
echo [0.5/10] Hardcoded clinic-name anti-pattern scan (prevent regression)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%REPO_ROOT%\tools\verify-no-hardcoded-clinic.ps1" -RepoRoot "%REPO_ROOT%"
if errorlevel 1 exit /b 1
echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[1/10] Configure clinic info (Flavor: %FLAVOR%)...'"
if defined SKIP_CONFIG (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[SKIP] --skip-config argument detected, skipping config'"
) else (
    powershell -ExecutionPolicy Bypass -File "..\edit-config.ps1"
    if errorlevel 1 (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] edit-config.ps1 execution failed, aborting build'"
        if not defined NO_PAUSE pause
        exit /b 1
    )
)
echo.

REM Pre-flight check: detect leftover from previous abnormal exit (.build_vcode_prev/.bak/configuration-cache/Gradle daemon)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\..\tools\pre-flight-check.ps1" -Target %FLAVOR_TARGET% -AppDir "%~dp0app"
echo.

echo [1.5/10] Refresh APK signature hash (normal/strict common, auto anti-repack)...
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '  从 keystore 提取当前证书哈希并注入 LicenseManager.java, 普通模式也启用签名校验'"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\..\tools\generate-sign-hash.ps1" -Version dingzhi 2>nul
if errorlevel 1 (
    if defined STRICT_MODE (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '  [ERROR] 严格模式签名哈希刷新失败，终止打包（防止签名哈希不匹配被拦截）' -ForegroundColor Red"
        if not defined NO_PAUSE pause
        exit /b 1
    )
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '  [WARN] 签名哈希刷新失败，使用当前已编译哈希继续（不影响构建）' -ForegroundColor Yellow"
)
echo.

echo [2/10] Sync files to Android + verify integrity...
set "ANDROID_PUBLIC=%~dp0app\src\main\assets\public"
set "ANDROID_ASSETS=%~dp0app\src\main\assets"
if not exist "%ANDROID_PUBLIC%" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] Capacitor target directory not found: %ANDROID_PUBLIC%'"
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [1/5] Sync config.json...
if exist "..\desktop\config.json" (
    copy /Y "..\desktop\config.json" "%ANDROID_PUBLIC%\config.json" >nul
 if errorlevel 1 ( echo [] config.json ) else ( echo [OK] config.json )
) else ( echo [SKIP] config.json )
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[2/5] Sync APP index.html (5-button top menu)...'"
copy /Y "..\index-app.html" "%ANDROID_PUBLIC%\index.html" >nul
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] Failed to sync APP index.html'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Source file: ..\index-app.html'"
    if not defined NO_PAUSE pause
    exit /b 1
)
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] APP index.html synced (5-button top menu, with analytics)'"
echo [3/5] Sync vendor/xlsx.full.min.js...
if exist "..\desktop\vendor\xlsx.full.min.js" (
    if not exist "%ANDROID_PUBLIC%\vendor" mkdir "%ANDROID_PUBLIC%\vendor" >nul
    copy /Y "..\desktop\vendor\xlsx.full.min.js" "%ANDROID_PUBLIC%\vendor\xlsx.full.min.js" >nul
 if errorlevel 1 ( echo [] xlsx.full.min.js ) else ( echo [OK] xlsx.full.min.js )
) else ( echo [SKIP] vendor/xlsx.full.min.js )
echo [4/5] Sync core JS modules...
set "MODULES=auth-core.js db-adapter.js debug-logger.js medicine-dict.js patient-archive.js performance-utils.js permission.js prescription-core.js print-utils.js security-guard.js"
for %%m in (%MODULES%) do (
    if exist "..\desktop\%%m" (
        copy /Y "..\desktop\%%m" "%ANDROID_PUBLIC%\%%m" >nul
 if errorlevel 1 ( echo [] %%m ) else ( echo [OK] %%m )
 ) else ( echo [SKIP] %%m )
)
echo [5/5] Verify video-recorder-inject.js...
if exist "%ANDROID_ASSETS%\video-recorder-inject.js" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] video-recorder-inject.js already exists in assets'"
) else if exist "..\video-recorder-inject.js" (
    copy /Y "..\video-recorder-inject.js" "%ANDROID_ASSETS%\video-recorder-inject.js" >nul
 if errorlevel 1 ( echo [] video-recorder-inject.js ) else ( echo [OK] video-recorder-inject.js )
) else ( echo [SKIP] video-recorder-inject.js )
echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Verifying APP index.html integrity (5-button top menu)...'"
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $f='%ANDROID_PUBLIC%\index.html'; $c=[System.IO.File]::ReadAllText($f,[System.Text.Encoding]::UTF8); if($c.Length -lt 50000){ Write-Host '[ERROR] APP index.html too small'; exit 1 }; if(-not ($c -match 'showModal\(.analyticsModal.')){ Write-Host '[ERROR] APP index.html missing analyticsModal - not 5-button version'; exit 1 }; Write-Host '[OK] APP index.html verification passed (5-button)'"
if errorlevel 1 (
    if not defined NO_PAUSE pause
    exit /b 1
)
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Minifying JavaScript files (security hardening)...'"
node "%~dp0..\..\..\shared\minify-js.js" "%ANDROID_PUBLIC%"
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] JS minification had issues, continuing'"
) else (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] JavaScript files minified'"
)
echo.

cd /d "%~dp0"

powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[3/10] Check environment (JDK/Gradle/signing/capacitor)...'"
REM JDK/JAVA_HOME build-app.bat
if defined JAVA_HOME (
    if not exist "%JAVA_HOME%\bin\java.exe" (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] JAVA_HOME points to invalid path: %JAVA_HOME%'"
        if not defined NO_PAUSE pause
        exit /b 1
    )
    echo       JAVA_HOME: %JAVA_HOME%
) else (
    java -version >nul 2>&1
    if errorlevel 1 (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] Java not found. Install JDK 17+ and set JAVA_HOME or add java to PATH'"
        if not defined NO_PAUSE pause
        exit /b 1
    )
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] java available (JAVA_HOME not set, using PATH)'"
)
if not exist "gradlew.bat" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] gradlew.bat not found'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Path: %CD%\gradlew.bat'"
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\signing.properties" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] signing.properties not found'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Path: %CD%\app\signing.properties'"
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\app-release.jks" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] app-release.jks not found'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Path: %CD%\app\app-release.jks'"
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\src\main\assets\capacitor.config.json" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] Capacitor config not found'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Path: %CD%\app\src\main\assets\capacitor.config.json'"
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\src\main\assets\public\index.html" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] index.html not found'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Path: %CD%\app\src\main\assets\public\index.html'"
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\src\main\assets\video-recorder-inject.js" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] video-recorder-inject.js not found'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Path: %CD%\app\src\main\assets\video-recorder-inject.js'"
) else (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] video-recorder-inject.js ready'"
)
echo [OK] Environment check passed

powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Pre-build verification (disk space + source files)...'"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$disk=(Get-PSDrive -Name $((Get-Location).Drive.Name));" ^
  "$freeGB=[math]::Round($disk.Free/1GB,2);" ^
  "if($freeGB -lt 0.5){ Write-Host '[ERROR] Insufficient disk space: '$freeGB'GB, need >=0.5GB'; exit 1 };" ^
  "Write-Host '  Disk free:' $freeGB 'GB';" ^
  "$required=@('..\desktop\index.html','..\index-app.html','..\desktop\config.json','app\signing.properties','app\app-release.jks','app\build.gradle');" ^
  "$missing=@(); foreach($f in $required){ if(-not(Test-Path $f)){ $missing+=$f } };" ^
  "if($missing.Count -gt 0){ Write-Host '[ERROR] Missing required files:'; $missing|ForEach-Object{ Write-Host '  - '$_ }; exit 1 };" ^
  "Write-Host '[OK] All required files ready'"
if errorlevel 1 (
    if not defined NO_PAUSE pause
    exit /b 1
)
echo Verifying keystore integrity...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$jks='app\app-release.jks';" ^
  "$size=(Get-Item $jks).Length;" ^
  "if($size -lt 1000){ Write-Host '[ERROR] keystore file too small ('$size' bytes), possibly corrupted'; exit 1 };" ^
  "$bytes=[System.IO.File]::ReadAllBytes($jks);" ^
  "$header=[System.Text.Encoding]::ASCII.GetString($bytes[0..3]);" ^
  "if($header -notmatch '0x|....'){ Write-Host '[WARN] keystore header abnormal: '$header };" ^
  "Write-Host '[OK] keystore OK ('$size' bytes)'"
if errorlevel 1 (
    if not defined NO_PAUSE pause
    exit /b 1
)
echo.

powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[4/10] Patch Capacitor Java version (21 -> 17) + show current config...'"
call node "%~dp0..\..\..\tools\patch-java-version.js" "%~dp0..\.."
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] Java version patch had issues, continuing'"
) else (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] Java version patched'"
)
echo Current config:
findstr "versionName" "app\build.gradle"
echo.

echo [5/10] Stop lingering Gradle processes + clean build cache...
REM kill gradle java daemon
taskkill /F /IM java.exe /FI "WINDOWTITLE eq gradle*" >nul 2>&1
call gradlew.bat --stop >nul 2>&1
echo [OK] Lingering processes cleaned
REM P2-3: TCM_GRADLE_SKIP_CLEAN gradlew clean project_memory
REM 2026-07-22: javac MainActivity.java
REM 2026-07-23: assets/merged_assets index.html
if exist "app\build\intermediates\javac" (
    rmdir /S /Q "app\build\intermediates\javac" 2>nul
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] javac cache cleaned'"
)
if exist "app\build\intermediates\assets" (
    rmdir /S /Q "app\build\intermediates\assets" 2>nul
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] assets cache cleaned'"
)
if exist "app\build\intermediates\merged_assets" (
    rmdir /S /Q "app\build\intermediates\merged_assets" 2>nul
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] merged_assets cache cleaned'"
)
call gradlew.bat clean
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] clean failed, continuing incremental build'"
) else (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] Old cache cleaned'"
)
REM Purge configuration cache after clean (fixes annotationProcessors.json stale cache)
if exist ".gradle\configuration-cache" rmdir /S /Q ".gradle\configuration-cache" 2>nul

echo.

echo [6/10] Increment versionCode...
REM P0-3: build-app.bat
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $f='app\build.gradle'; $c=[System.IO.File]::ReadAllText($f); if($c -match 'versionCode\s+(\d+)'){ $old=[int]$matches[1]; $new=$old+1; $nc=$c -replace 'versionCode\s+\d+', \"versionCode $new\"; [System.IO.File]::WriteAllText($f,$nc,(New-Object System.Text.UTF8Encoding($false))); Set-Content -Path '%~dp0.build_vcode_prev' -Value $old -Encoding ASCII -NoNewline; Write-Host ('  [OK] versionCode: '+$old+' -> '+$new+' (old value saved)') } else { Write-Host '  [WARN] versionCode not found in build.gradle' }"
echo.

powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[7/10] Code obfuscation (target=%FLAVOR_TARGET%) + Java pre-compile check...'"
echo [STAGE:obfuscate] Code obfuscating...
call node "%~dp0..\..\..\tools\obfuscate.js" --target=%FLAVOR_TARGET%
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] JS code obfuscation failed'"
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] JS code obfuscation completed
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[STAGE:precompile] Java pre-compile checking (catch compile errors early)...'"
call gradlew.bat :app:javaPreCompile%FLAVOR_CAP%Release :app:compile%FLAVOR_CAP%ReleaseJavaWithJavac --quiet
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] Java pre-compile check failed, aborting build'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] Restoring JavaScript due to pre-compile failure...'"
    call node "%~dp0..\..\..\tools\obfuscate.js" restore --target=%FLAVOR_TARGET%
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] Java pre-compile check passed
echo.

powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[8/10] Compile signed APK (%FLAVOR_NAME%)...'"
echo.
call gradlew.bat %ASSEMBLE_TASK%
if errorlevel 1 (
    echo.
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] Build failed! Rolling back versionCode...'"
    powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $f='app\build.gradle'; $prevFile='%~dp0.build_vcode_prev'; if(Test-Path $prevFile){ $prev=Get-Content $prevFile -Raw; $c=[System.IO.File]::ReadAllText($f); $nc=$c -replace 'versionCode\s+\d+', \"versionCode $prev\"; [System.IO.File]::WriteAllText($f,$nc,(New-Object System.Text.UTF8Encoding($false))); Remove-Item $prevFile -Force; Write-Host ('  [OK] versionCode rolled back to '+$prev) } else { Write-Host '  [WARN] No old versionCode to rollback' }"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] Restoring JavaScript due to build failure...'"
    call node "%~dp0..\..\..\tools\obfuscate.js" restore --target=%FLAVOR_TARGET%
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] Build failed, see Gradle error log above'"
    if not defined NO_PAUSE pause
    exit /b 1
)
REM P0-3: versionCode
if exist "%~dp0.build_vcode_prev" del "%~dp0.build_vcode_prev"
echo.

echo [9/10] Restore original JavaScript + verify APK artifact...
echo Restoring JavaScript code...
call node "%~dp0..\..\..\tools\obfuscate.js" restore --target=%FLAVOR_TARGET%
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] JS restore failed - may need manual restore: node tools\obfuscate.js restore --target=dingzhi'"
) else (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] JS restored to original state'"
)
echo.
echo Locating APK file...
set "APK_DIR=app\build\outputs\apk\release"
set "APK_FILE="
if exist "%APK_DIR%\app-release.apk" (
    set "APK_FILE=%APK_DIR%\app-release.apk"
) else (
    for %%f in ("%APK_DIR%\*.apk") do (
        set "APK_FILE=%%f"
    )
)
if "%APK_FILE%"=="" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] APK file not found'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Search dir: %CD%\%APK_DIR%'"
    if not defined NO_PAUSE pause
    exit /b 1
)
for %%A in ("%APK_FILE%") do (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'APK file: %%~nxA'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'File size: %%~zA bytes'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Full path: %CD%\%%A'"
)
echo.

echo Verifying APK signature...
REM apksigner APK
set "APKSIGNER="
if exist "%ANDROID_HOME%\build-tools" (
    for /f "delims=" %%d in ('dir /b /ad "%ANDROID_HOME%\build-tools" ^| sort /r') do (
        if not defined APKSIGNER if exist "%ANDROID_HOME%\build-tools\%%d\apksigner.bat" set "APKSIGNER=%ANDROID_HOME%\build-tools\%%d\apksigner.bat"
    )
)
if defined APKSIGNER (
    call "%APKSIGNER%" verify --verbose "%APK_FILE%" 2>&1 | findstr /i "verified WARNING ERROR"
    if errorlevel 1 (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] APK signature verification failed!'"
        if not defined NO_PAUSE pause
        exit /b 1
    )
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] APK signature verification passed'"
) else (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] apksigner not found, skipping signature verification'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Set ANDROID_HOME to enable signature verification'"
)
echo.

powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Verifying APK contains latest index.html (content hash)...'"
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.IO.Compression.FileSystem; $apk='%CD%\%APK_FILE%'; $zip=[System.IO.Compression.ZipFile]::OpenRead($apk); $entry=$zip.GetEntry('assets/public/index.html'); if(-not $entry){ $zip.Dispose(); Write-Host '[ERROR] assets/public/index.html not found in APK'; exit 1 }; $sr=New-Object System.IO.StreamReader($entry.Open()); $content=$sr.ReadToEnd(); $sr.Close(); $zip.Dispose(); $hash=[System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($content)); $hashStr=($hash|ForEach-Object{$_.ToString('x2')})-join ''; if($content.Length -lt 1000){ Write-Host '[ERROR] APK index.html too small ('$content.Length' bytes), build may be incomplete'; exit 1 }; Write-Host '[OK] APK contains index.html ('$content.Length' bytes, sha256='+$hashStr.Substring(0,16)+'...)'"
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] APK content verification failed! APK may not contain latest code'"
    if not defined NO_PAUSE pause
    exit /b 1
)
echo.

echo Verifying APK contains video-recorder-inject.js...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.IO.Compression.FileSystem; $apk='%CD%\%APK_FILE%'; $zip=[System.IO.Compression.ZipFile]::OpenRead($apk); $entry=$zip.GetEntry('assets/video-recorder-inject.js'); if(-not $entry){ $zip.Dispose(); Write-Host '[WARN] video-recorder-inject.js not found in APK'; exit 0 }; $sr=New-Object System.IO.StreamReader($entry.Open()); $content=$sr.ReadToEnd(); $sr.Close(); $zip.Dispose(); if(-not($content -match '__nativeBridgeProxy')){ Write-Host '[ERROR] video-recorder-inject.js missing __nativeBridgeProxy fix!'; exit 1 }; if(-not($content -match 'generateFileName')){ Write-Host '[ERROR] video-recorder-inject.js missing generateFileName!'; exit 1 }; Write-Host '[OK] video-recorder-inject.js verification passed ('$content.Length' bytes)'"
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] APK video-recorder-inject.js verification failed!'"
    if not defined NO_PAUSE pause
    exit /b 1
)
echo.

echo APK size sanity check...
for %%A in ("%APK_FILE%") do set "APK_SIZE=%%~zA"
if %APK_SIZE% LSS 1000000 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] APK size too small: %APK_SIZE% bytes (< 1MB), build may be incomplete'"
    if not defined NO_PAUSE pause
    exit /b 1
)
if %APK_SIZE% GTR 10000000 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] APK size abnormal: %APK_SIZE% bytes (> 10MB), check for unexpected files'"
)
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] APK size: %APK_SIZE% bytes'"
echo.

echo [10/10] Copy APK to output dir + compute SHA-256 + update download page...
set "VERSION_STR="
for /f "tokens=2 delims=:" %%v in ('findstr "versionName" "app\build.gradle"') do (
    set "VERSION_STR=%%v"
)
set "VERSION_STR=%VERSION_STR: =%"
set "VERSION_STR=%VERSION_STR:"=%"
if "%VERSION_STR%"=="" set "VERSION_STR=1.0"

for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; (Get-Content '..\desktop\config.json' -Encoding UTF8 -Raw | ConvertFrom-Json).productName"`) do (
    set "PRODUCT_NAME=%%p"
)
if "%PRODUCT_NAME%"=="" set "PRODUCT_NAME=%APK_NAME%"

REM APK Gradle
set "SRC_SIZE=0"
for %%A in ("%APK_FILE%") do set "SRC_SIZE=%%~zA"
if "%SRC_SIZE%"=="" set "SRC_SIZE=0"
if %SRC_SIZE% EQU 0 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] Source APK is 0 bytes or inaccessible!'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Source file: %CD%\%APK_FILE%'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Gradle build may have failed, see build log above'"
    if not defined NO_PAUSE pause
    exit /b 1
)
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Source APK size: %SRC_SIZE% bytes'"

REM Use PowerShell .NET File.Copy for reliable copy (supports unicode names, with size verification)
set "FINAL_APK=%OFFLINE_DIR%\%APK_NAME%.apk"
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $ErrorActionPreference='Stop'; $src='%APK_FILE%'; $dst='%FINAL_APK%'; $expected=%SRC_SIZE%; try { [System.IO.File]::Copy($src,$dst,$true); $actual=(New-Object System.IO.FileInfo $dst).Length; if($actual -ne $expected){ Write-Host ('[ERROR] Size mismatch: src='+$expected+' dst='+$actual); exit 1 }; Write-Host ('[OK] Copied '+$actual+' bytes to: '+$dst) } catch { Write-Host ('[ERROR] '+$_.Exception.Message); exit 1 }"
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] Copy with productName failed, falling back to app-release.apk'"
    set "FINAL_APK=%OFFLINE_DIR%\app-release.apk"
    powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $ErrorActionPreference='Stop'; $src='%APK_FILE%'; $dst='%FINAL_APK%'; $expected=%SRC_SIZE%; try { [System.IO.File]::Copy($src,$dst,$true); $actual=(New-Object System.IO.FileInfo $dst).Length; if($actual -ne $expected){ Write-Host ('[ERROR] Size mismatch: src='+$expected+' dst='+$actual); exit 1 }; Write-Host ('[OK] Copied '+$actual+' bytes to: '+$dst) } catch { Write-Host ('[ERROR] '+$_.Exception.Message); exit 1 }"
    if errorlevel 1 (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] Copy failed, manually get APK from:'"
        echo       %CD%\%APK_DIR%
        if not defined NO_PAUSE pause
        exit /b 1
    )
)
echo.

REM APK
for %%F in ("%FINAL_APK%") do set "APK_FULL_PATH=%%~fF"

echo Computing SHA-256 hash...
node "%~dp0..\..\..\shared\calculate-hash.js"
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] Hash computation had issues, continuing'"
) else (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] SHA-256 hash updated to public/hash-manifest.json'"
)
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Auto-updating download page (%FLAVOR_TARGET%)...'"
node "%~dp0..\..\..\tools\auto-update-downloads.js" %FLAVOR_TARGET%
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] Download page auto-update had issues, continuing'"
) else (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] Download page updated - %FLAVOR_TARGET%'"
)
echo.

echo ============================================
echo APK 打包完成！
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Path: %APK_FULL_PATH%'"
echo 此APK已签名，可直接安装
echo ============================================
echo.

for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
for /f "delims=" %%e in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $s=[DateTime]::Parse('%BUILD_START_TIME%'); $e=[DateTime]::Parse('%BUILD_END_TIME%'); $d=$e-$s; $d.ToString('hh\:mm\:ss')"') do set "BUILD_ELAPSED=%%e"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '============================================' -ForegroundColor Yellow; Write-Host '  APK 打包完成！' -ForegroundColor Yellow; Write-Host '  Path: %APK_FULL_PATH%' -ForegroundColor Yellow; Write-Host '  Start: %BUILD_START_TIME%' -ForegroundColor Yellow; Write-Host '  End: %BUILD_END_TIME%' -ForegroundColor Yellow; Write-Host '  Total elapsed: %BUILD_ELAPSED%' -ForegroundColor Yellow; Write-Host '============================================' -ForegroundColor Yellow"
if not defined NO_PAUSE (
    set "EXIT_KEY="
    set "EXIT_KEY="
    set /p "EXIT_KEY=Press 0 or Enter to exit: "
)
exit /b 0
