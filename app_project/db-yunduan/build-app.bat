@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

title Huikang-TCM Build Tool

REM ★ [BUILD-LOCK 2026-08-23] Global build mutex - abort if another build is running
REM   并发构建会互相冲突（obfuscate 共享源文件/node_modules/git index/构建缓存）
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\build-lock.ps1" acquire -LockPath "%~dp0..\..\.build.lock" -Owner "cloud-app"
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

for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"

REM 统一安装包：单 APK，标准版/机构版由运行时激活码决定（合并 8 包 → 4 包）
set "FLAVOR=云端统一版"
set "FLAVOR_NAME=惠康中医-云端"
set "FLAVOR_CAP="
set "APK_NAME=惠康中医-云端"
set "ASSEMBLE_TASK=:app:assembleRelease"
set "APK_DIR=app\build\outputs\apk\release"

echo ============================================
echo   Huikang TCM Cloud APP Builder (%FLAVOR_NAME%)
echo   打包模式: %MODE_LABEL%
echo   版本类型: %FLAVOR%
echo   Start: %BUILD_START_TIME%
echo ============================================
echo.

REM --- Path setup (use absolute paths, no relative) ---
set "SCRIPT_DIR=%~dp0"
set "CLOUD_DIR=%SCRIPT_DIR:~0,-1%"
set "ANDROID_DIR=%CLOUD_DIR%\cloud_app"
for %%I in ("%CLOUD_DIR%\..\..") do set "REPO_ROOT=%%~fI"

REM 2026-08-19 Add: Unified build-env gate (8-step: Git/BOM/encoding/version/package/cleanup/disk)
REM Replaces scattered fix-ps1-bom / verify-app-version / verify-no-hardcoded-clinic / pre-flight-check calls (single entry, no missed steps)
echo [0/10] Ensure build environment (BOM / encoding / version gate / APP resource / disk ^>=5GB)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%REPO_ROOT%\tools\ensure-build-env.ps1" -Target cloud-app -AppDir "%ANDROID_DIR%" -MinDiskSpaceGB 5.0
if errorlevel 1 (
    echo [FATAL] ensure-build-env FAIL, build aborted! Please fix issues above
    if not defined NO_PAUSE pause
    exit /b 1
)
echo.

REM ★ 2026-08-18 Add: Clinic/Doctor info config step (align with offline edit-config.ps1)
REM Manual build: interactive edit; one-click build (one-click-pack.ps1 with SKIP_CONFIG=1): sync only
echo [0.6/10] Configure clinic info (Flavor: %FLAVOR%)...
if defined SKIP_CONFIG (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[SKIP] SKIP_CONFIG env detected, skipping config'"
) else (
    powershell -ExecutionPolicy Bypass -File "%~dp0edit-config.ps1" -AutoConfirm
    if errorlevel 1 (
        powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[ERROR] edit-config.ps1 execution failed, aborting build'"
        if not defined NO_PAUSE pause
        exit /b 1
    )
)
echo.

if not exist "%ANDROID_DIR%\gradlew.bat" (
    echo [ERROR] cloud_app directory not found: %ANDROID_DIR%
    echo   Ensure cloud_app exists under db-yunduan/
    if not defined NO_PAUSE pause
    exit /b 1
)

cd /d "%ANDROID_DIR%"

echo [1/10] Check environment (JDK/Gradle/signing/capacitor)...
if defined JAVA_HOME (
    if not exist "%JAVA_HOME%\bin\java.exe" (
        echo [ERROR] JAVA_HOME points to invalid path: %JAVA_HOME%
        if not defined NO_PAUSE pause
        exit /b 1
    )
    echo       JAVA_HOME: %JAVA_HOME%
) else (
    java -version >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Java not found. Install JDK 17+ and set JAVA_HOME or add java to PATH
        if not defined NO_PAUSE pause
        exit /b 1
    )
    echo       Java: found in PATH
)
if not exist "gradlew.bat" (
    echo [ERROR] gradlew.bat not found
    echo   Path: %ANDROID_DIR%\gradlew.bat
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\signing.properties" (
    echo [ERROR] signing.properties not found
    echo   Path: %ANDROID_DIR%\app\signing.properties
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\app-release.jks" (
    echo [ERROR] app-release.jks not found
    echo   Path: %ANDROID_DIR%\app\app-release.jks
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\src\main\assets\capacitor.config.json" (
    echo [ERROR] Capacitor config not found
    echo   Path: %ANDROID_DIR%\app\src\main\assets\capacitor.config.json
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] Environment check passed
echo.

echo [1.5/10] Refresh APK signature hash (normal/strict common, auto anti-repack)...
echo   从 keystore 提取当前证书哈希并注入 SecurityGuard.java, 普通模式也启用签名校验
powershell -NoProfile -ExecutionPolicy Bypass -File "%CLOUD_DIR%\..\..\tools\generate-sign-hash.ps1" -Version cloud 2>nul
if errorlevel 1 (
    if defined STRICT_MODE (
        echo   [ERROR] 严格模式签名哈希刷新失败，终止打包（防止签名哈希不匹配被拦截）
        if not defined NO_PAUSE pause
        exit /b 1
    )
    echo   [WARN] 签名哈希刷新失败，使用当前已编译哈希继续（不影响构建）
)
echo.

echo [2/10] Patch Capacitor Java version (21 -^> 17) + sync shared files...
call node "%CLOUD_DIR%\..\..\tools\patch-java-version.js" "%CLOUD_DIR%\.."
if errorlevel 1 (
    echo [WARN] Java version patch had issues, continuing...
) else (
    echo [OK] Java version patched
)
set "SHARED_DIR=%CLOUD_DIR%\..\..\shared"
set "ASSETS_PUBLIC=%ANDROID_DIR%\app\src\main\assets\public"
if exist "%SHARED_DIR%\auth-core.js" (
    copy /Y "%SHARED_DIR%\auth-core.js" "%ASSETS_PUBLIC%\auth-core.js" >nul
    echo [OK] auth-core.js synced
) else (
    echo [WARN] shared\auth-core.js not found
)
if exist "%SHARED_DIR%\permission.js" (
    copy /Y "%SHARED_DIR%\permission.js" "%ASSETS_PUBLIC%\permission.js" >nul
    echo [OK] permission.js synced
) else (
    echo [WARN] shared\permission.js not found
)
REM 2026-08-18 Add: sync config.json (clinic/doctor info, signed by edit-config.ps1) to APP assets
if exist "%CLOUD_DIR%\cloud_desktop\config.json" (
    copy /Y "%CLOUD_DIR%\cloud_desktop\config.json" "%ASSETS_PUBLIC%\config.json" >nul
    echo [OK] config.json synced to assets
) else (
    echo [WARN] cloud_desktop\config.json not found
)
echo.

echo [3/10] Sync APP version code + increment versionCode...
powershell -NoProfile -ExecutionPolicy Bypass -File "%CLOUD_DIR%\sync-app-version.ps1" "%CLOUD_DIR%"

REM versionCode increment
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $g='%ANDROID_DIR%\app\build.gradle'; $c=Get-Content $g -Raw -Encoding UTF8; if($c -match 'versionCode\s+(\d+)'){ $old=[int]$matches[1]; $new=$old+1; $nc=$c -replace 'versionCode\s+\d+', \"versionCode $new\"; [System.IO.File]::WriteAllText($g,$nc,(New-Object System.Text.UTF8Encoding $false)); Set-Content -Path '%CLOUD_DIR%\.build_vcode_prev' -Value $old -Encoding ASCII -NoNewline; Write-Host ('  [OK] versionCode: '+$old+' -> '+$new+' (old value saved)') } else { Write-Host '  [WARN] versionCode not found in build.gradle' }"
echo.

echo [4/10] Stop lingering Gradle processes + clean build cache...
taskkill /F /IM java.exe /FI "WINDOWTITLE eq gradle*" >nul 2>&1
call gradlew.bat --stop >nul 2>&1
echo [OK] Lingering processes cleaned

REM 2026-08-18 Fix CXX1429: clean .cxx native build cache (stale CMake state/lock breaks configure)
if exist "app\.cxx" (
    rmdir /S /Q "app\.cxx" 2>nul
    echo [OK] .cxx native build cache cleaned
)

if exist "app\build\intermediates\javac" (
    rmdir /S /Q "app\build\intermediates\javac" 2>nul
    echo [OK] javac cache cleaned
)
if exist "app\build\intermediates\assets" (
    rmdir /S /Q "app\build\intermediates\assets" 2>nul
    echo [OK] assets cache cleaned
)
if exist "app\build\intermediates\merged_assets" (
    rmdir /S /Q "app\build\intermediates\merged_assets" 2>nul
    echo [OK] merged_assets cache cleaned
)
call gradlew.bat clean
if errorlevel 1 goto :clean_failed
echo [OK] Old cache cleaned
goto :clean_done

:clean_failed
echo [WARN] gradlew clean failed, force removing build directory...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $p='app\build'; if(Test-Path $p){ try{ Remove-Item -Path $p -Recurse -Force; Write-Host '[OK] build dir force deleted' }catch{ Write-Host '[WARN] Some files locked, waiting 2 seconds retry...'; Start-Sleep -Seconds 2; try{ Remove-Item -Path $p -Recurse -Force; Write-Host '[OK] build dir retry deleted' }catch{ Write-Host '[ERROR] build dir cannot be deleted, please close locked processes'; Write-Host $_.Exception.Message } } }"
call gradlew.bat clean
if errorlevel 1 (
    echo [WARN] clean retry failed, continuing incremental build
) else (
    echo [OK] retry clean succeeded
)

:clean_done
if exist ".gradle\configuration-cache" rmdir /S /Q ".gradle\configuration-cache" 2>nul

echo.

echo [5/10] Code obfuscation (cloud target - with cloud_app assets)...
call node "%CLOUD_DIR%\..\..\tools\obfuscate.js" --target=cloud
if errorlevel 1 (
    echo [ERROR] JS code obfuscation failed
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] JS code obfuscation completed
echo.

echo [6/10] Java pre-compile check (Flavor: %FLAVOR%)...
call gradlew.bat :app:javaPreCompile%FLAVOR_CAP%Release :app:compile%FLAVOR_CAP%ReleaseJavaWithJavac --quiet
if errorlevel 1 (
    echo [ERROR] Java pre-compile check failed
    echo [WARN] Restoring JavaScript due to pre-compile failure...
    call node "%CLOUD_DIR%\..\..\tools\obfuscate.js" restore --target=cloud
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] Java pre-compile check passed
echo.

echo [7/10] Compile signed APK (%FLAVOR_NAME%)...
echo.
call gradlew.bat %ASSEMBLE_TASK%
if errorlevel 1 (
    echo.
    echo [ERROR] Build failed! Rolling back versionCode...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $g='%ANDROID_DIR%\app\build.gradle'; $prevFile='%CLOUD_DIR%\.build_vcode_prev'; if(Test-Path $prevFile){ $prev=Get-Content $prevFile -Raw; $c=Get-Content $g -Raw -Encoding UTF8; $nc=$c -replace 'versionCode\s+\d+', \"versionCode $prev\"; [System.IO.File]::WriteAllText($g,$nc,(New-Object System.Text.UTF8Encoding $false)); Remove-Item $prevFile -Force; Write-Host ('  [OK] versionCode rolled back to '+$prev) } else { Write-Host '  [WARN] No old versionCode to rollback' }"
    echo [WARN] Restoring JavaScript due to build failure...
    call node "%CLOUD_DIR%\..\..\tools\obfuscate.js" restore --target=cloud
    echo [ERROR] Build failed, see Gradle error log above
    if not defined NO_PAUSE pause
    exit /b 1
)
if exist "%CLOUD_DIR%\.build_vcode_prev" del "%CLOUD_DIR%\.build_vcode_prev"
echo.

echo [8/10] Restore original JavaScript + verify APK...
call node "%CLOUD_DIR%\..\..\tools\obfuscate.js" restore --target=cloud
if errorlevel 1 (
    echo [WARN] JS restore failed - may need manual restore: node tools\obfuscate.js restore --target=cloud
) else (
    echo [OK] JS restored to original state
)
echo.

echo Locating APK file...
set "APK_FILE="
if exist "%APK_DIR%\app-release.apk" (
    set "APK_FILE=%APK_DIR%\app-release.apk"
) else (
    for %%f in ("%APK_DIR%\*.apk") do (
        set "APK_FILE=%%f"
    )
)
if "%APK_FILE%"=="" (
    echo [ERROR] APK file not found
    echo Search dir: %CD%\%APK_DIR%
    if not defined NO_PAUSE pause
    exit /b 1
)
for %%A in ("%APK_FILE%") do (
    echo   APK: %%~nxA
    echo   Size: %%~zA bytes
)
echo.

echo [9/10] Verify APK content + copy to output...
echo Verifying APK contains latest auth-core.js...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.IO.Compression.FileSystem; try { $zip=[System.IO.Compression.ZipFile]::OpenRead('%APK_FILE%'); $entry=$zip.GetEntry('assets/public/auth-core.js'); if($entry){ $sz=$entry.Length; if($sz -lt 1000){ Write-Host '[ERROR] APK auth-core.js too small:' $sz 'bytes'; exit 1 }; Write-Host '[OK] APK auth-core.js:' $sz 'bytes' } else { Write-Host '[ERROR] auth-core.js not found in APK'; exit 1 }; $zip.Dispose() } catch { Write-Host '[ERROR] APK verification failed:' $_.Exception.Message; exit 1 }"
if errorlevel 1 (
    echo [ERROR] APK content verification failed! APK may not contain latest code
    if not defined NO_PAUSE pause
    exit /b 1
)

REM ★ 2026-08-23 防破解增强：APK 签名终验（对齐离线版）+ 证书哈希一致性校验
REM   1) apksigner verify：v2/v3 签名方案必须通过（v1-only 易被重打包）
REM   2) APK 实际证书 SHA-256 必须 == SecurityGuard.java 注入的 EXPECTED_SIGN_HASH
REM      （防哈希漂移：注入后 keystore 变更/签名配置错误时，运行时签名校验会拒绝启动，
REM        打包期提前拦截，绝不让"启动即闪退"的 APK 流出）
echo Verifying APK signature (v2/v3 + cert hash consistency)...
set "APKSIGNER="
if exist "%ANDROID_HOME%\build-tools" (
    for /f "delims=" %%d in ('dir /b /ad "%ANDROID_HOME%\build-tools" ^| sort /r') do (
        if not defined APKSIGNER if exist "%ANDROID_HOME%\build-tools\%%d\apksigner.bat" set "APKSIGNER=%ANDROID_HOME%\build-tools\%%d\apksigner.bat"
    )
)
if defined APKSIGNER (
    set "SIGN_OUT=%TEMP%\apksign_verify_%RANDOM%.txt"
    call "%APKSIGNER%" verify --verbose "%APK_FILE%" > "!SIGN_OUT!" 2>&1
    if errorlevel 1 (
        type "!SIGN_OUT!"
        echo [ERROR] APK signature verification failed!
        del "!SIGN_OUT!" 2>nul
        if not defined NO_PAUSE pause
        exit /b 1
    )
    findstr /i "verified warning error" "!SIGN_OUT!"
    del "!SIGN_OUT!" 2>nul
    powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $out = & '%APKSIGNER%' verify --print-certs '%APK_FILE%' 2>&1 | Out-String; if($out -notmatch 'certificate SHA-256 digest:\s*([0-9a-fA-F:]+)'){ Write-Host '[ERROR] Cannot extract APK cert SHA-256 from apksigner output'; exit 1 }; $apkHash = ($matches[1] -replace ':','').ToLower(); $guard = Get-Content '%CLOUD_DIR%\cloud_app\app\src\main\java\com\tcm\prescription\SecurityGuard.java' -Raw -Encoding UTF8; $injected=''; if($guard -match 'EXPECTED_SIGN_HASH\s*=\s*\x22([0-9a-fA-F]{64})\x22'){ $injected=$matches[1].ToLower() }; if(-not $injected){ Write-Host '[ERROR] EXPECTED_SIGN_HASH not found in SecurityGuard.java'; exit 1 }; if($apkHash -ne $injected){ Write-Host ('[ERROR] Cert hash mismatch! APK='+$apkHash); Write-Host ('       Injected='+$injected); Write-Host '       APK will self-exit at runtime (signature check). Aborting build.'; exit 1 }; Write-Host ('[OK] APK cert SHA-256 == SecurityGuard.EXPECTED_SIGN_HASH ('+$apkHash.Substring(0,16)+'...)')"
    if errorlevel 1 (
        echo [ERROR] APK certificate hash consistency check failed!
        if not defined NO_PAUSE pause
        exit /b 1
    )
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[OK] APK signature verification passed (v2/v3 + cert hash)'"
) else (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[WARN] apksigner not found, skipping signature verification'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Set ANDROID_HOME to enable signature verification'"
)
echo.

echo Reading product name and version...
set "PRODUCT_NAME=%APK_NAME%"

set "VERSION_STR="
for /f "tokens=2 delims= " %%v in ('findstr "versionName" "app\build.gradle"') do (
    set "VERSION_STR=%%v"
)
set "VERSION_STR=%VERSION_STR: =%"
set "VERSION_STR=%VERSION_STR:"=%"
if "%VERSION_STR%"=="" set "VERSION_STR=1.0"

set "FINAL_APK=%CLOUD_DIR%\%APK_NAME%.apk"

REM Copy APK
set "SRC_SIZE=0"
for %%A in ("%APK_FILE%") do set "SRC_SIZE=%%~zA"
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $ErrorActionPreference='Stop'; $src='%APK_FILE%'; $dst='%FINAL_APK%'; $expected=%SRC_SIZE%; try { [System.IO.File]::Copy($src,$dst,$true); $actual=(New-Object System.IO.FileInfo $dst).Length; if($actual -ne $expected){ Write-Host ('[ERROR] Size mismatch: src='+$expected+' dst='+$actual); exit 1 }; Write-Host ('[OK] Copied '+$actual+' bytes to: '+$dst) } catch { Write-Host ('[ERROR] '+$_.Exception.Message); exit 1 }"
if errorlevel 1 (
    echo [WARN] Copy failed, manually get APK from:
    echo       %CD%\%APK_DIR%
    if not defined NO_PAUSE pause
    exit /b 1
)
echo.

echo [10/10] Auto-update download page + complete...
echo Updating download page (%FLAVOR%)...
node "%CLOUD_DIR%\..\..\tools\auto-update-downloads.js" cloud
if errorlevel 1 (
    echo [WARN] Download page update had issues, continuing...
) else (
    echo [OK] Download page updated - cloud
)
echo.

REM 提取 versionCode（构建序号，证明是否为最新一次打包）+ APK 文件时间
set "VERSION_CODE_STR="
for /f "tokens=2 delims= " %%v in ('findstr "versionCode" "app\build.gradle"') do set "VERSION_CODE_STR=%%v"
if "%VERSION_CODE_STR%"=="" set "VERSION_CODE_STR=?"
for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; (Get-Item '%FINAL_APK%').LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')"') do set "APK_FILE_TIME=%%t"

echo ============================================
echo   APK 打包完成！
echo   Path: %FINAL_APK%
echo   版本类型: %FLAVOR%
echo   版本号: %VERSION_STR% (versionCode %VERSION_CODE_STR%)
echo   文件时间: %APK_FILE_TIME%
echo ============================================
echo.

for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
echo 开始: %BUILD_START_TIME%  结束: %BUILD_END_TIME%
echo.

if not defined NO_PAUSE (
    set "EXIT_KEY="
    set /p "EXIT_KEY=Press Enter to exit: "
)
endlocal
REM ★ [BUILD-LOCK 2026-08-23] Release global build mutex
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\build-lock.ps1" release -LockPath "%~dp0..\..\.build.lock" -Owner "cloud-app"
exit /b 0
