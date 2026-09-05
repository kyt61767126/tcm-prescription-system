@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
title Huikang-TCM Build Tool

REM ★ [BUILD-LOCK 2026-08-23] Global build mutex - abort if another build is running
REM   并发构建会互相冲突（obfuscate 共享源文件/node_modules/git index/构建缓存）
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\..\tools\build-lock.ps1" acquire -LockPath "%~dp0..\..\..\.build.lock" -Owner "offline-app"
if errorlevel 2 (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] 检测到另一个构建正在运行，共享文件会冲突。请等待其结束后重试；若确认无构建在跑，可删除仓库根目录 .build.lock 后重试。' -ForegroundColor Red"
    if not defined NO_PAUSE pause
    exit /b 1
)

REM 模式识别：默认 = 严格模式（哈希失败强制中断），standard 参数保留兼容（等价严格）
REM 两者均启用签名哈希刷新 + Java 层混淆 + 签名校验；严格模式对哈希失败做强校验
REM ★ 2026-08-21 手动打包统一严格标准：无参（手动双击/脚本直调）不再降级为普通模式，
REM   与一键打包 app-strict 同一标准，杜绝"手动打包哈希刷新失败仍出包"的隐患
set "STRICT_MODE=1"
set "MODE_LABEL=严格模式"
if /i "%~1"=="normal" (
    set "STRICT_MODE="
    set "MODE_LABEL=普通模式(降级)"
)

REM
for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"

REM 统一安装包：单 APK，标准版/机构版由运行时激活码决定（合并 8 包 → 4 包）
set "FLAVOR_TARGET=dingzhi"
set "FLAVOR=本地统一版"
set "FLAVOR_NAME=惠康中医-本地"
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
set "APP_DIR=%SCRIPT_DIR:~0,-1%"
set "OFFLINE_DIR=%APP_DIR%"
for %%I in ("%OFFLINE_DIR%\..") do set "OFFLINE_DIR=%%~fI"
for %%I in ("%OFFLINE_DIR%\..\..") do set "REPO_ROOT=%%~fI"

REM 2026-08-19 Add: Unified build-env gate (8-step: Git/BOM/encoding/version/package/cleanup/disk)
REM Replaces scattered fix-ps1-bom / verify-app-version / verify-no-hardcoded-clinic / pre-flight-check calls (single entry, no missed steps)
echo [0/10] Ensure build environment (BOM / encoding / version gate / APP resource / disk ^>=5GB)...
REM NOTE: -AppDir must point to Gradle project root (where gradlew.bat lives), NOT the inner app module dir
REM ★ 2026-08-19 修复: 传 %APP_DIR%(去尾反斜杠) 而非 %~dp0(尾反斜杠+引号=>\" 被 PowerShell 当转义引号, 吞掉后续参数)
powershell -NoProfile -ExecutionPolicy Bypass -File "%REPO_ROOT%\tools\ensure-build-env.ps1" -Target offline-app -AppDir "%APP_DIR%" -MinDiskSpaceGB 5.0
if errorlevel 1 (
    echo [FATAL] ensure-build-env FAIL, build aborted! Please fix issues above
    if not defined NO_PAUSE pause
    exit /b 1
)
echo.

powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[1/10] Configure clinic info (Flavor: %FLAVOR%)...'"
if defined SKIP_CONFIG (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[SKIP] --skip-config argument detected, skipping config'"
) else (
    powershell -ExecutionPolicy Bypass -File "..\edit-config.ps1" -AutoConfirm
    if errorlevel 1 (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] edit-config.ps1 execution failed, aborting build'"
        goto build_fail
    )
)
echo.

echo [1.5/10] Refresh APK signature hash (normal/strict common, auto anti-repack)...
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '  从 keystore 提取当前证书哈希并注入 LicenseManager.java, 普通模式也启用签名校验'"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\..\tools\generate-sign-hash.ps1" -Version dingzhi 2>nul
if errorlevel 1 (
    if defined STRICT_MODE (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '  [ERROR] 严格模式签名哈希刷新失败，终止打包（防止签名哈希不匹配被拦截）' -ForegroundColor Red"
        goto build_fail
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
rem ===== drift-guard: desktop/index.html vs index-app.html feature drift detection =====
rem 2026-08-26: user admin "edit username" feature was added to desktop/index.html but
rem never ported to index-app.html (the real APP source), silently lost after packaging.
rem This check prints a diff summary of function-name sets before every APK build so
rem any future "desktop-only" feature is caught at build time. Non-blocking (WARN only)
rem because the two files legitimately diverge (Electron-only vs APP-only functions).
call node "%~dp0..\..\..\tools\diff-index-app.cjs" --quiet
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
        goto build_fail
    )
    echo       JAVA_HOME: %JAVA_HOME%
) else (
    java -version >nul 2>&1
    if errorlevel 1 (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] Java not found. Install JDK 17+ and set JAVA_HOME or add java to PATH'"
        goto build_fail
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
REM 2026-09-05 fix false positive: PKCS12 header 3rd byte is length (0x0A = newline),
REM which broke the old ASCII regex ('.' never matches newline). Judge by magic bytes:
REM JKS = FE-ED-FE-ED, PKCS12 = ASN.1 SEQUENCE (first byte 0x30).
echo Verifying keystore integrity...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$jks='app\app-release.jks';" ^
  "$size=(Get-Item $jks).Length;" ^
  "if($size -lt 1000){ Write-Host '[ERROR] keystore file too small ('$size' bytes), possibly corrupted'; exit 1 };" ^
  "$bytes=[System.IO.File]::ReadAllBytes($jks);" ^
  "$magic=[BitConverter]::ToString($bytes[0..3]);" ^
  "$isJks=($magic -eq 'FE-ED-FE-ED'); $isPkcs12=($bytes[0] -eq 0x30);" ^
  "if($isJks){ Write-Host '[OK] keystore format: JKS' } elseif($isPkcs12){ Write-Host '[OK] keystore format: PKCS12' } else { Write-Host '[WARN] keystore header abnormal: '$magic' (expected JKS FE-ED-FE-ED or PKCS12 30-xx)' };" ^
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
REM 2026-08-18 Fix CXX1429: clean .cxx native build cache (stale CMake state/lock breaks configure)
if exist "app\.cxx" (
    rmdir /S /Q "app\.cxx" 2>nul
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] .cxx native build cache cleaned'"
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
REM ★ 2026-08-23 复核修复：apksigner 发现链（本机 ANDROID_HOME 未设置，原单一来源
REM   发现恒失败→签名验证被静默跳过，防破解终验成死代码）
REM   顺序: ANDROID_HOME → ANDROID_SDK_ROOT → local.properties(sdk.dir, gradle实际所用) → C:\Android\Sdk 兜底
set "SDK_ROOT="
set "SDK_RAW="
set "SDK_CAND="
if defined ANDROID_HOME if exist "%ANDROID_HOME%\build-tools" set "SDK_ROOT=%ANDROID_HOME%"
if not defined SDK_ROOT if defined ANDROID_SDK_ROOT if exist "%ANDROID_SDK_ROOT%\build-tools" set "SDK_ROOT=%ANDROID_SDK_ROOT%"
if not defined SDK_ROOT if exist "local.properties" for /f "usebackq tokens=2 delims==" %%s in (`findstr /b /i "sdk.dir=" local.properties 2^>nul`) do set "SDK_RAW=%%s"
if defined SDK_RAW set "SDK_CAND=%SDK_RAW:\\=\%"
if defined SDK_CAND if exist "%SDK_CAND%\build-tools" set "SDK_ROOT=%SDK_CAND%"
if not defined SDK_ROOT if exist "C:\Android\Sdk\build-tools" set "SDK_ROOT=C:\Android\Sdk"
if defined SDK_ROOT (
    for /f "delims=" %%d in ('dir /b /ad "%SDK_ROOT%\build-tools" ^| sort /r') do (
        if not defined APKSIGNER if exist "%SDK_ROOT%\build-tools\%%d\apksigner.bat" set "APKSIGNER=%SDK_ROOT%\build-tools\%%d\apksigner.bat"
    )
)
if defined APKSIGNER (
    REM ★ 2026-08-23 防破解增强：修复原管道校验漏洞（apksigner 失败输出含 ERROR 行时
    REM   findstr 反而匹配成功→失败被放行），改用临时文件保留真实退出码；
    REM   并新增 APK 实际证书 SHA-256 == LicenseManager 碎片化注入哈希 一致性终验
    REM   （P1-2 碎片化存储：明文哈希不再出现于源码；校验工具重组 SIGN_FRAGMENTS 后比对。
    REM     防哈希漂移：注入后 keystore 变更/签名配置错误时，运行时校验会拒绝启动，
    REM     打包期提前拦截，绝不让"启动即闪退"的 APK 流出）
    set "SIGN_OUT=%TEMP%\apksign_verify_%RANDOM%.txt"
    call "%APKSIGNER%" verify --verbose "%APK_FILE%" > "!SIGN_OUT!" 2>&1
    if errorlevel 1 (
        type "!SIGN_OUT!"
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] APK signature verification failed!'"
        del "!SIGN_OUT!" 2>nul
        goto build_fail
    )
    findstr /i "verified warning error" "!SIGN_OUT!"
    del "!SIGN_OUT!" 2>nul
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\..\tools\verify-apk-sign-hash.ps1" -ApkFile "%APK_FILE%" -Apksigner "%APKSIGNER%" -JavaFile "%CD%\app\src\main\java\com\benneng\pres\LicenseManager.java" -OldConstantName EXPECTED_APK_SIGNATURE_SHA256
    if errorlevel 1 (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] APK certificate hash consistency check failed!'"
        goto build_fail
    )
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] APK signature verification passed (v2/v3 + cert hash)'"
) else (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] apksigner not found (ANDROID_HOME / ANDROID_SDK_ROOT / local.properties sdk.dir / C:\Android\Sdk all failed), skipping signature verification'"
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
for /f "tokens=2 delims= " %%v in ('findstr "versionName" "app\build.gradle"') do (
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
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] SHA-256 computed - read-only, manifest updated only at publish time'"
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
for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; (Get-Item '%APK_FULL_PATH%').LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')"') do set "APK_FILE_TIME=%%t"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '============================================' -ForegroundColor Yellow; Write-Host '  APK 打包完成！' -ForegroundColor Yellow; Write-Host '  Path: %APK_FULL_PATH%' -ForegroundColor Yellow; Write-Host '  版本类型: %FLAVOR%' -ForegroundColor Yellow; Write-Host '  版本号: %VERSION_STR%' -ForegroundColor Yellow; Write-Host '  文件时间: %APK_FILE_TIME%' -ForegroundColor Yellow; Write-Host '  Start: %BUILD_START_TIME%' -ForegroundColor Yellow; Write-Host '  End: %BUILD_END_TIME%' -ForegroundColor Yellow; Write-Host '  Total elapsed: %BUILD_ELAPSED%' -ForegroundColor Yellow; Write-Host '============================================' -ForegroundColor Yellow"
if not defined NO_PAUSE (
    set "EXIT_KEY="
    set "EXIT_KEY="
    set /p "EXIT_KEY=Press 0 or Enter to exit: "
)
REM ★ [BUILD-LOCK 2026-08-23] Release global build mutex
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\..\tools\build-lock.ps1" release -LockPath "%~dp0..\..\..\.build.lock" -Owner "offline-app"
exit /b 0

REM ★ 2026-08-23 复核修复：cmd 已知怪癖——双层嵌套块内 exit /b 在被 cmd /c 直调时丢失进程退出码
REM   （实测返回0），release-menu 直调本脚本时构建失败会被误判成功。嵌套失败路径统一 goto 本标签，
REM   在顶层上下文退出保证退出码正确传播；同时释放构建锁（防失败构建残留锁阻塞下次构建）。
:build_fail
if not defined NO_PAUSE pause
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\..\tools\build-lock.ps1" release -LockPath "%~dp0..\..\..\.build.lock" -Owner "offline-app"
exit /b 1
