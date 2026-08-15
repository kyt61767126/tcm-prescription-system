@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM P0: .ps1 BOM fix
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\fix-ps1-bom.ps1" >nul 2>&1

title Huikang-TCM Build Tool

for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"

REM 统一安装包：单 APK，标准版/机构版由运行时激活码决定（合并 8 包 → 4 包）
set "FLAVOR="
set "FLAVOR_NAME="
set "FLAVOR_CAP="
set "APK_NAME=惠康中医-云端"
set "ASSEMBLE_TASK=:app:assembleRelease"
set "APK_DIR=app\build\outputs\apk\release"

echo ============================================
echo   Huikang TCM Cloud APP Builder (%FLAVOR_NAME%)
echo   Flavor: %FLAVOR%
echo   Start: %BUILD_START_TIME%
echo ============================================
echo.

REM --- Path setup (use absolute paths, no relative) ---
set "SCRIPT_DIR=%~dp0"
set "CLOUD_DIR=%SCRIPT_DIR:~0,-1%"
set "ANDROID_DIR=%CLOUD_DIR%\cloud_app"

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

REM Pre-flight check
powershell -NoProfile -ExecutionPolicy Bypass -File "%CLOUD_DIR%\..\..\tools\pre-flight-check.ps1" -Target cloud -AppDir "%ANDROID_DIR%"
echo.

echo [2/10] Patch Capacitor Java version (21 -> 17) + sync shared files...
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
echo.

echo [3/10] Sync APP version code + increment versionCode...
powershell -NoProfile -ExecutionPolicy Bypass -File "%CLOUD_DIR%\sync-app-version.ps1" "%CLOUD_DIR%"

REM versionCode increment
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $g='%ANDROID_DIR%\app\build.gradle'; $c=Get-Content $g -Raw -Encoding UTF8; if($c -match 'versionCode\s+(\d+)'){ $old=[int]$matches[1]; $new=$old+1; $nc=$c -replace 'versionCode\s+\d+', \"versionCode $new\"; [System.IO.File]::WriteAllText($g,$nc,(New-Object System.Text.UTF8Encoding $false)); Set-Content -Path '%CLOUD_DIR%\.build_vcode_prev' -Value $old -Encoding ASCII -NoNewline; Write-Host ('  [OK] versionCode: '+$old+' -> '+$new+' (old value saved)') } else { Write-Host '  [WARN] versionCode not found in build.gradle' }"
echo.

echo [4/10] Stop lingering Gradle processes + clean build cache...
taskkill /F /IM java.exe /FI "WINDOWTITLE eq gradle*" >nul 2>&1
call gradlew.bat --stop >nul 2>&1

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
call gradlew.bat --stop >nul 2>&1
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

echo Reading product name and version...
set "PRODUCT_NAME=%APK_NAME%"

set "VERSION_STR="
for /f "tokens=2 delims=:" %%v in ('findstr "versionName" "app\build.gradle"') do (
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

echo ============================================
echo   APK Build Complete!
echo   Path: %FINAL_APK%
echo   Flavor: %FLAVOR%
echo   Version: %VERSION_STR%
echo ============================================
echo.

for /f "delims=" %%t in ('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
echo Start: %BUILD_START_TIME%  End: %BUILD_END_TIME%
echo.

if not defined NO_PAUSE (
    set "EXIT_KEY="
    set /p "EXIT_KEY=Press Enter to exit: "
)
endlocal
exit /b 0
