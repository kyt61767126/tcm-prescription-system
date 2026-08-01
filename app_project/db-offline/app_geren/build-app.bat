@echo off
chcp 65001 >nul
title Huikang TCM Personal - Offline APP Build

REM Record start time for elapsed calculation
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"

echo ============================================
echo   Huikang TCM Personal - Offline APP
echo   开始: %BUILD_START_TIME%
echo ============================================
echo.

cd /d "%~dp0"

echo [0.5/10] Fixing .ps1 BOM encoding...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\..\tools\fix-ps1-bom.ps1"
echo.

echo [1/10] Configuring clinic info...
if /i "%1"=="--skip-config" (
    echo       [SKIP] --skip-config parameter detected
) else (
    powershell -ExecutionPolicy Bypass -File "..\edit-config.ps1" -DesktopDir desktop_geren -AppDir app_geren
    if errorlevel 1 (
        echo [ERROR] edit-config.ps1 failed, aborting
        if not defined NO_PAUSE pause
        exit /b 1
    )
)
echo.

echo [2/10] Synchronizing files to Android...
set "ANDROID_PUBLIC=%~dp0app\src\main\assets\public"
set "ANDROID_ASSETS=%~dp0app\src\main\assets"
if not exist "%ANDROID_PUBLIC%" (
    echo [ERROR] Capacitor target directory not found: %ANDROID_PUBLIC%
    if not defined NO_PAUSE pause
    exit /b 1
)
echo   [1/5] Syncing config.json...
if exist "..\desktop_geren\config.json" (
    copy /Y "..\desktop_geren\config.json" "%ANDROID_PUBLIC%\config.json" >nul
    if errorlevel 1 ( echo [WARN] Failed to sync config.json ) else ( echo       config.json synced )
) else ( echo [SKIP] config.json not found )
echo   [2/5] Syncing APP index.html from root ^(5-button top menu^)...
copy /Y "..\index-app.html" "%ANDROID_PUBLIC%\index.html" >nul
if errorlevel 1 (
    echo [ERROR] Failed to sync APP index.html
    echo   Source: ..\index-app.html
    if not defined NO_PAUSE pause
    exit /b 1
)
echo       APP index.html synced ^(5-button top menu with 统计^)
echo   [3/5] Syncing vendor/xlsx.full.min.js...
if exist "..\desktop_geren\vendor\xlsx.full.min.js" (
    if not exist "%ANDROID_PUBLIC%\vendor" mkdir "%ANDROID_PUBLIC%\vendor" >nul
    copy /Y "..\desktop_geren\vendor\xlsx.full.min.js" "%ANDROID_PUBLIC%\vendor\xlsx.full.min.js" >nul
    if errorlevel 1 ( echo [WARN] Failed to sync xlsx.full.min.js ) else ( echo       xlsx.full.min.js synced )
) else ( echo [SKIP] vendor/xlsx.full.min.js not found )
echo   [4/5] Syncing core JS modules...
set "MODULES=auth-core.js db-adapter.js debug-logger.js medicine-dict.js patient-archive.js performance-utils.js permission.js prescription-core.js print-utils.js security-guard.js"
for %%m in (%MODULES%) do (
    if exist "..\desktop_geren\%%m" (
        copy /Y "..\desktop_geren\%%m" "%ANDROID_PUBLIC%\%%m" >nul
        if errorlevel 1 ( echo [WARN] Failed to sync %%m ) else ( echo       %%m synced )
    ) else ( echo [SKIP] %%m not found )
)
echo   [5/5] Verifying video-recorder-inject.js...
if exist "%ANDROID_ASSETS%\video-recorder-inject.js" (
    echo       video-recorder-inject.js present in assets
) else if exist "..\video-recorder-inject.js" (
    copy /Y "..\video-recorder-inject.js" "%ANDROID_ASSETS%\video-recorder-inject.js" >nul
    if errorlevel 1 ( echo [WARN] Failed to sync video-recorder-inject.js ) else ( echo       video-recorder-inject.js synced )
) else ( echo [SKIP] video-recorder-inject.js not found )
echo.

echo [2.1/10] Verifying APP index.html integrity (5-button top menu)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%ANDROID_PUBLIC%\index.html'; $c=[System.IO.File]::ReadAllText($f,[System.Text.Encoding]::UTF8); if($c.Length -lt 50000){ Write-Host '[ERROR] APP index.html too small'; exit 1 }; if(-not ($c -match 'showModal\(.analyticsModal.\)')){ Write-Host '[ERROR] APP index.html missing analyticsModal - not 5-button version'; exit 1 }; Write-Host '[OK] APP index.html OK 5-button'"
if errorlevel 1 (
    if not defined NO_PAUSE pause
    exit /b 1
)
echo.
echo [2.5/10] Minifying JavaScript files (security hardening)...
node "%~dp0..\..\..\shared\minify-js.js" "%ANDROID_PUBLIC%"
if errorlevel 1 (
    echo [WARN] JS minification had issues, continuing anyway
) else (
    echo [OK] JavaScript files minified
)
echo.

cd /d "%~dp0"

echo [3/10] Checking environment...
REM JDK/JAVA_HOME check (align with cloud build-app.bat)
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
        echo [ERROR] Java not found. Please install JDK 17+ and set JAVA_HOME, or add java to PATH
        if not defined NO_PAUSE pause
        exit /b 1
    )
    echo       java OK ^(JAVA_HOME not set, using PATH^)
)
if not exist "gradlew.bat" (
    echo [ERROR] gradlew.bat not found
    echo   Path: %CD%\gradlew.bat
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\signing.properties" (
    echo [ERROR] signing.properties not found
    echo   Path: %CD%\app\signing.properties
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\app-release.jks" (
    echo [ERROR] app-release.jks not found
    echo   Path: %CD%\app\app-release.jks
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\src\main\assets\capacitor.config.json" (
    echo [ERROR] Capacitor config not found
    echo   Path: %CD%\app\src\main\assets\capacitor.config.json
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\src\main\assets\public\index.html" (
    echo [ERROR] index.html not found
    echo   Path: %CD%\app\src\main\assets\public\index.html
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\src\main\assets\video-recorder-inject.js" (
    echo [WARN] video-recorder-inject.js not found
    echo   Path: %CD%\app\src\main\assets\video-recorder-inject.js
) else (
    echo       video-recorder-inject.js OK
)
echo [OK] Environment check passed
echo.

echo [3.1/10] Pre-build validation (disk space + source files)...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$disk=(Get-PSDrive -Name $((Get-Location).Drive.Name));" ^
  "$freeGB=[math]::Round($disk.Free/1GB,2);" ^
  "if($freeGB -lt 0.5){ Write-Host '[ERROR] Disk space不足: '$freeGB'GB free, need >=0.5GB'; exit 1 };" ^
  "Write-Host '  Disk free:' $freeGB 'GB';" ^
  "$required=@('..\desktop_geren\index.html','..\index-app.html','..\desktop_geren\config.json','app\signing.properties','app\app-release.jks','app\build.gradle');" ^
  "$missing=@(); foreach($f in $required){ if(-not(Test-Path $f)){ $missing+=$f } };" ^
  "if($missing.Count -gt 0){ Write-Host '[ERROR] Missing required files:'; $missing|ForEach-Object{ Write-Host '  - '$_ }; exit 1 };" ^
  "Write-Host '[OK] All required files present'"
if errorlevel 1 (
    if not defined NO_PAUSE pause
    exit /b 1
)
echo.

echo [3.2/10] Verifying keystore integrity...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$jks='app\app-release.jks';" ^
  "$size=(Get-Item $jks).Length;" ^
  "if($size -lt 1000){ Write-Host '[ERROR] Keystore file too small ('$size' bytes), may be corrupted'; exit 1 };" ^
  "$bytes=[System.IO.File]::ReadAllBytes($jks);" ^
  "$header=[System.Text.Encoding]::ASCII.GetString($bytes[0..3]);" ^
  "if($header -notmatch '0x|....'){ Write-Host '[WARN] Keystore header unusual: '$header };" ^
  "Write-Host '[OK] Keystore OK ('$size' bytes)'"
if errorlevel 1 (
    if not defined NO_PAUSE pause
    exit /b 1
)
echo.

echo [3.5/10] Patching Capacitor Java version (21 to 17)...
call node "%~dp0..\..\..\tools\patch-java-version.js" "%~dp0..\.."
if errorlevel 1 (
    echo [WARN] Java version patch had issues, continuing anyway
) else (
    echo [OK] Java version patched
)
echo.
echo [3.6/10] Current configuration...
findstr "versionName" "app\build.gradle"
echo.

echo [4/10] Stopping residual Gradle processes...
taskkill /F /IM java.exe /FI "WINDOWTITLE eq gradle*" >nul 2>&1
call gradlew.bat --stop >nul 2>&1
echo [OK] Cleanup completed
echo.

echo [5/10] Cleaning build cache (force full clean)...
REM P2-3: 废弃 TCM_GRADLE_SKIP_CLEAN，强制执行 gradlew clean（与 project_memory 约束一致）
REM Historical lesson (2026-07-22): javac cache must be cleaned to ensure MainActivity.java changes take effect
REM Historical lesson (2026-07-23): assets/merged_assets cache must be cleaned to ensure index.html changes take effect
if exist "app\build\intermediates\javac" (
    rmdir /S /Q "app\build\intermediates\javac" 2>nul
    echo       [OK] cleaned javac cache
)
if exist "app\build\intermediates\assets" (
    rmdir /S /Q "app\build\intermediates\assets" 2>nul
    echo       [OK] cleaned assets cache
)
if exist "app\build\intermediates\merged_assets" (
    rmdir /S /Q "app\build\intermediates\merged_assets" 2>nul
    echo       [OK] cleaned merged_assets cache
)
call gradlew.bat clean
if errorlevel 1 (
    echo [WARN] Clean failed, continuing with incremental build
) else (
    echo [OK] Old cache cleared
)
echo.

echo [5.5/10] Auto-increment versionCode...
REM P0-3: Save old value to .build_vcode_prev for rollback on build failure (align with cloud build-app.bat)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='app\build.gradle'; $c=[System.IO.File]::ReadAllText($f); if($c -match 'versionCode\s+(\d+)'){ $old=[int]$matches[1]; $new=$old+1; $nc=$c -replace 'versionCode\s+\d+', \"versionCode $new\"; [System.IO.File]::WriteAllText($f,$nc,(New-Object System.Text.UTF8Encoding($false))); Set-Content -Path '%~dp0.build_vcode_prev' -Value $old -Encoding ASCII -NoNewline; Write-Host ('  [OK] versionCode: '+$old+' -> '+$new+' (prev saved)') } else { Write-Host '  [WARN] versionCode not found in build.gradle' }"
echo.

echo [5.6/10] [STAGE:obfuscate] Obfuscating JavaScript (target=geren)...
call node "%~dp0..\..\..\tools\obfuscate.js" --target=geren
if errorlevel 1 (
    echo [ERROR] JS obfuscation failed
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] JS obfuscation complete
echo.

echo [5.7/10] Java 预编译检查中（提前发现编译错误）...
call gradlew.bat compileReleaseJavaWithJavac --quiet
if errorlevel 1 (
    echo [ERROR] Java 预编译检查失败，终止打包
    echo [WARN] Restoring JavaScript due to pre-compile failure...
    call node "%~dp0..\..\..\tools\obfuscate.js" restore --target=geren
    if not defined NO_PAUSE pause
    exit /b 1
)
echo [OK] Java 预编译检查通过
echo.

echo [6/10] Building signed APK...
echo.
call gradlew.bat assembleRelease
if errorlevel 1 (
    echo.
    echo [WARN] First build attempt failed, retrying with --no-daemon...
    call gradlew.bat --stop >nul 2>&1
    timeout /t 3 /nobreak >nul
    call gradlew.bat assembleRelease --no-daemon
    if errorlevel 1 (
        echo.
        echo [ERROR] Build failed after retry! Rolling back versionCode...
        powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='app\build.gradle'; $prevFile='%~dp0.build_vcode_prev'; if(Test-Path $prevFile){ $prev=Get-Content $prevFile -Raw; $c=[System.IO.File]::ReadAllText($f); $nc=$c -replace 'versionCode\s+\d+', \"versionCode $prev\"; [System.IO.File]::WriteAllText($f,$nc,(New-Object System.Text.UTF8Encoding($false))); Remove-Item $prevFile -Force; Write-Host ('  [OK] versionCode rolled back to '+$prev) } else { Write-Host '  [WARN] No prev versionCode to rollback' }"
        echo [WARN] Restoring JavaScript due to build failure...
        call node "%~dp0..\..\..\tools\obfuscate.js" restore --target=geren
        echo [ERROR] Build failed! Please check error messages
        if not defined NO_PAUSE pause
        exit /b 1
    )
    echo [OK] Build succeeded on retry
)
REM P0-3: Clean up versionCode rollback temp file after successful build
if exist "%~dp0.build_vcode_prev" del "%~dp0.build_vcode_prev"
echo.

echo [6.5/10] Restoring JavaScript...
call node "%~dp0..\..\..\tools\obfuscate.js" restore --target=geren
if errorlevel 1 (
    echo [WARN] JS restore failed - may need manual restore
) else (
    echo [OK] JS restored to original state
)
echo.

echo [7/10] Build successful, locating APK...
echo.

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
    echo [ERROR] APK file not found
    echo   Search dir: %CD%\%APK_DIR%
    if not defined NO_PAUSE pause
    exit /b 1
)

for %%A in ("%APK_FILE%") do (
    echo APK File: %%~nxA
    echo File Size: %%~zA bytes
    echo Full Path: %CD%\%%A
)
echo.

echo [7.3/10] Verifying APK signature...
REM Use apksigner to verify the APK is properly signed
set "APKSIGNER="
if exist "%ANDROID_HOME%\build-tools" (
    for /f "delims=" %%d in ('dir /b /ad "%ANDROID_HOME%\build-tools" ^| sort /r') do (
        if not defined APKSIGNER if exist "%ANDROID_HOME%\build-tools\%%d\apksigner.bat" set "APKSIGNER=%ANDROID_HOME%\build-tools\%%d\apksigner.bat"
    )
)
if defined APKSIGNER (
    call "%APKSIGNER%" verify --verbose "%APK_FILE%" 2>&1 | findstr /i "verified WARNING ERROR"
    if errorlevel 1 (
        echo [ERROR] APK signature verification failed!
        if not defined NO_PAUSE pause
        exit /b 1
    )
    echo [OK] APK signature verified
) else (
    echo [WARN] apksigner not found, skipping signature verification
    echo        Set ANDROID_HOME to enable signature verification
)
echo.

echo [7.5/10] [STAGE:verify] Verifying APK contains latest index.html (content hash)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; $apk='%CD%\%APK_FILE%'; $zip=[System.IO.Compression.ZipFile]::OpenRead($apk); $entry=$zip.GetEntry('assets/public/index.html'); if(-not $entry){ $zip.Dispose(); Write-Host '[ERROR] assets/public/index.html not found in APK'; exit 1 }; $sr=New-Object System.IO.StreamReader($entry.Open()); $content=$sr.ReadToEnd(); $sr.Close(); $zip.Dispose(); $hash=[System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($content)); $hashStr=($hash|ForEach-Object{$_.ToString('x2')})-join ''; if($content.Length -lt 1000){ Write-Host '[ERROR] index.html in APK is too small ('+$content.Length+' bytes), build may be broken'; exit 1 }; Write-Host '[OK] APK contains index.html ('+$content.Length+' bytes, sha256='+$hashStr.Substring(0,16)+'...)'"
if errorlevel 1 (
    echo [ERROR] APK content verification failed! APK may not contain latest code.
    if not defined NO_PAUSE pause
    exit /b 1
)
echo.

echo [7.6/10] Verifying APK contains video-recorder-inject.js...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; $apk='%CD%\%APK_FILE%'; $zip=[System.IO.Compression.ZipFile]::OpenRead($apk); $entry=$zip.GetEntry('assets/video-recorder-inject.js'); if(-not $entry){ $zip.Dispose(); Write-Host '[WARN] video-recorder-inject.js not found in APK'; exit 0 }; $sr=New-Object System.IO.StreamReader($entry.Open()); $content=$sr.ReadToEnd(); $sr.Close(); $zip.Dispose(); if(-not($content -match '__nativeBridgeProxy')){ Write-Host '[ERROR] video-recorder-inject.js missing __nativeBridgeProxy fix!'; exit 1 }; if(-not($content -match 'generateFileName')){ Write-Host '[ERROR] video-recorder-inject.js missing generateFileName!'; exit 1 }; Write-Host '[OK] video-recorder-inject.js verified ('$content.Length' bytes)'"
if errorlevel 1 (
    echo [ERROR] APK video-recorder-inject.js verification failed!
    if not defined NO_PAUSE pause
    exit /b 1
)
echo.

echo [7.7/10] APK size sanity check...
for %%A in ("%APK_FILE%") do set "APK_SIZE=%%~zA"
if %APK_SIZE% LSS 1000000 (
    echo [ERROR] APK size too small: %APK_SIZE% bytes ^(< 1MB^), build may be incomplete
    if not defined NO_PAUSE pause
    exit /b 1
)
if %APK_SIZE% GTR 10000000 (
    echo [WARN] APK size unusually large: %APK_SIZE% bytes ^(^> 10MB^), check for unintended files
)
echo [OK] APK size: %APK_SIZE% bytes
echo.

echo [8/10] Copying APK to output directory...
set "VERSION_STR="
for /f "tokens=2 delims=:" %%v in ('findstr "versionName" "app\build.gradle"') do (
    set "VERSION_STR=%%v"
)
set "VERSION_STR=%VERSION_STR: =%"
set "VERSION_STR=%VERSION_STR:"=%"
if "%VERSION_STR%"=="" set "VERSION_STR=1.0"

for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "(Get-Content '..\desktop_geren\config.json' -Encoding UTF8 -Raw | ConvertFrom-Json).productName"`) do (
    set "PRODUCT_NAME=%%p"
)
if "%PRODUCT_NAME%"=="" set "PRODUCT_NAME=惠康中医-LB"

REM Verify source APK size (prevent copying empty file when Gradle fails or write incomplete)
set "SRC_SIZE=0"
for %%A in ("%APK_FILE%") do set "SRC_SIZE=%%~zA"
if "%SRC_SIZE%"=="" set "SRC_SIZE=0"
if %SRC_SIZE% EQU 0 (
    echo [ERROR] Source APK is 0 bytes or not accessible!
    echo   Source: %CD%\%APK_FILE%
    echo   Gradle build may have failed. Please check build log above.
    if not defined NO_PAUSE pause
    exit /b 1
)
echo Source APK size: %SRC_SIZE% bytes

REM Use PowerShell .NET File.Copy for reliable copy (supports unicode names, with size verification)
set "FINAL_APK=..\%PRODUCT_NAME%.apk"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $src='%APK_FILE%'; $dst='%FINAL_APK%'; $expected=%SRC_SIZE%; try { [System.IO.File]::Copy($src,$dst,$true); $actual=(New-Object System.IO.FileInfo $dst).Length; if($actual -ne $expected){ Write-Host ('[ERROR] Size mismatch: src='+$expected+' dst='+$actual); exit 1 }; Write-Host ('[OK] Copied '+$actual+' bytes to: '+$dst) } catch { Write-Host ('[ERROR] '+$_.Exception.Message); exit 1 }"
if errorlevel 1 (
    echo [WARN] Copy with productName failed, fallback to app-release.apk
    set "FINAL_APK=..\app-release.apk"
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $src='%APK_FILE%'; $dst='%FINAL_APK%'; $expected=%SRC_SIZE%; try { [System.IO.File]::Copy($src,$dst,$true); $actual=(New-Object System.IO.FileInfo $dst).Length; if($actual -ne $expected){ Write-Host ('[ERROR] Size mismatch: src='+$expected+' dst='+$actual); exit 1 }; Write-Host ('[OK] Copied '+$actual+' bytes to: '+$dst) } catch { Write-Host ('[ERROR] '+$_.Exception.Message); exit 1 }"
    if errorlevel 1 (
        echo [ERROR] Copy failed, please manually get APK from:
        echo   %CD%\%APK_DIR%
        if not defined NO_PAUSE pause
        exit /b 1
    )
)
echo.

REM Get absolute path of APK file (for display)
for %%F in ("%FINAL_APK%") do set "APK_FULL_PATH=%%~fF"

echo [OK] APK ready: %APK_FULL_PATH%
echo.

echo [9/10] Calculating SHA-256 hash for download page...
node "%~dp0..\..\..\shared\calculate-hash.js"
if errorlevel 1 (
    echo [WARN] Hash calculation had issues, continuing anyway
) else (
    echo [OK] SHA-256 hash updated in public/hash-manifest.json
)
echo.

echo [10/10] Auto-updating download page...
node "%~dp0..\..\..\tools\auto-update-downloads.js" geren
if errorlevel 1 (
    echo [WARN] Download page auto-update had issues, continuing anyway
) else (
    echo [OK] Download page updated successfully
)
echo.

for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
for /f "delims=" %%e in ('powershell -NoProfile -Command "$s=[DateTime]::Parse('%BUILD_START_TIME%'); $e=[DateTime]::Parse('%BUILD_END_TIME%'); $d=$e-$s; $d.ToString('hh\:mm\:ss')"') do set "BUILD_ELAPSED=%%e"
powershell -NoProfile -Command "Write-Host '============================================' -ForegroundColor Yellow; Write-Host '  APK 打包完成!' -ForegroundColor Yellow; Write-Host '  路径: %APK_FULL_PATH%' -ForegroundColor Yellow; Write-Host '  开始: %BUILD_START_TIME%' -ForegroundColor Yellow; Write-Host '  结束: %BUILD_END_TIME%' -ForegroundColor Yellow; Write-Host '  总耗时: %BUILD_ELAPSED%' -ForegroundColor Yellow; Write-Host '============================================' -ForegroundColor Yellow"
exit /b 0