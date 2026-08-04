@echo off
chcp 65001 >nul
REM P0: 打包前自动修复 .ps1 文件 BOM 编码
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\fix-ps1-bom.ps1" >nul 2>&1
title 惠康中医云端APP打包工具

REM 记录开始时间（用于耗时统计）
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"

echo ============================================
echo   惠康中医云端APP打包工具
echo   开始: %BUILD_START_TIME%
echo ============================================
echo.

set "PROJECT_DIR=%~dp0cloud_app"
set "ANDROID_DIR=%PROJECT_DIR%"
set "APK_OUTPUT_DIR=%ANDROID_DIR%\app\build\outputs\apk\release"

cd /d "%ANDROID_DIR%"

echo [1/10] 检查环境（JDK/Gradle/签名/capacitor）...
REM JDK/JAVA_HOME 检查（Gradle 构建必需）
if defined JAVA_HOME (
    if not exist "%JAVA_HOME%\bin\java.exe" (
        echo       [错误] JAVA_HOME 指向无效路径: %JAVA_HOME%
        if not defined NO_PAUSE pause
        exit /b 1
    )
    echo       JAVA_HOME: %JAVA_HOME%
) else (
    java -version >nul 2>&1
    if errorlevel 1 (
        echo       [错误] 未找到 Java，请安装 JDK 17+ 并设置 JAVA_HOME，或将 java 加入 PATH
        if not defined NO_PAUSE pause
        exit /b 1
    )
    echo       [OK] java 可用^(JAVA_HOME 未设置，使用 PATH^)
)
if not exist "gradlew.bat" (
    echo       [错误] 未找到 gradlew.bat
    echo       路径: %ANDROID_DIR%\gradlew.bat
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\signing.properties" (
    echo       [错误] 未找到 signing.properties
    echo       路径: %ANDROID_DIR%\app\signing.properties
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\app-release.jks" (
    echo       [错误] 未找到 app-release.jks
    echo       路径: %ANDROID_DIR%\app\app-release.jks
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\src\main\assets\capacitor.config.json" (
    echo       [错误] 未找到 Capacitor config
    echo       路径: %ANDROID_DIR%\app\src\main\assets\capacitor.config.json
    if not defined NO_PAUSE pause
    exit /b 1
)
echo       [OK] 环境检查通过
echo.

echo [2/10] 修补 Capacitor Java 版本（21 → 17）+ 同步共享文件...
call node "%~dp0..\..\tools\patch-java-version.js" "%~dp0..\.."
if errorlevel 1 (
    echo       [警告] Java 版本修补出现问题，继续执行
) else (
    echo       [OK] Java 版本已修补
)
set "SHARED_DIR=%~dp0..\..\shared"
set "ASSETS_PUBLIC=%ANDROID_DIR%\app\src\main\assets\public"
if exist "%SHARED_DIR%\auth-core.js" (
    copy /Y "%SHARED_DIR%\auth-core.js" "%ASSETS_PUBLIC%\auth-core.js" >nul
    echo       [OK] auth-core.js 已同步
) else (
    echo       [警告] shared\auth-core.js 未找到
)
if exist "%SHARED_DIR%\permission.js" (
    copy /Y "%SHARED_DIR%\permission.js" "%ASSETS_PUBLIC%\permission.js" >nul
    echo       [OK] permission.js 已同步
) else (
    echo       [警告] shared\permission.js 未找到
)
echo.

echo [3/10] 同步 APP 版本号 + 自增 versionCode...
REM 从 cloud_desktop/index.html 读取 __APP_VERSION__，注入到 MainActivity.EXPECTED_APP_VERSION
REM 避免 MainActivity/index.html 版本不匹配导致每次启动都清缓存
REM sync-app-version.ps1 自动同步 cloud_app 和 cloud_app_geren 两个 APP
set "CLOUD_DIR_TMP=%~dp0"
set "CLOUD_DIR_TMP=%CLOUD_DIR_TMP:~0,-1%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-app-version.ps1" "%CLOUD_DIR_TMP%"

REM 自增 versionCode，确保每次构建单调递增
REM 避免 Android 因 versionCode 重复而拒绝升级安装
REM P1-12: 自增前保存旧值到临时文件；构建失败时回滚，避免跳号
powershell -NoProfile -ExecutionPolicy Bypass -Command "$g='%ANDROID_DIR%\app\build.gradle'; $c=Get-Content $g -Raw -Encoding UTF8; if($c -match 'versionCode\s+(\d+)'){ $old=[int]$matches[1]; $new=$old+1; $nc=$c -replace 'versionCode\s+\d+', \"versionCode $new\"; [System.IO.File]::WriteAllText($g,$nc,(New-Object System.Text.UTF8Encoding $false)); Set-Content -Path '%~dp0.build_vcode_prev' -Value $old -Encoding ASCII -NoNewline; Write-Host ('  [OK] versionCode: '+$old+' -> '+$new+' (旧值已保存)') } else { Write-Host '  [警告] build.gradle 中未找到 versionCode' }"
echo.

echo [4/10] 停止残留 Gradle 进程 + 清理构建缓存...
REM P1-15: 仅 kill 标题为 gradle 的 java 进程（保留 daemon 加速下次构建）
REM 不调用 gradlew --stop（会杀掉 daemon，下次构建需冷启动 JVM）
taskkill /F /IM java.exe /FI "WINDOWTITLE eq gradle*" >nul 2>&1

REM P2-3: 废弃 TCM_GRADLE_SKIP_CLEAN，强制执行 gradlew clean（与离线版 build-app.bat 一致）
REM 历史教训(2026-07-22): javac 缓存必须清理才能确保 MainActivity.java 修改生效
REM 历史教训(2026-07-23): assets/merged_assets 缓存必须清理才能确保 index.html 修改生效
if exist "app\build\intermediates\javac" (
    rmdir /S /Q "app\build\intermediates\javac" 2>nul
    echo       [OK] 已清理 javac 缓存
)
if exist "app\build\intermediates\assets" (
    rmdir /S /Q "app\build\intermediates\assets" 2>nul
    echo       [OK] 已清理 assets 缓存
)
if exist "app\build\intermediates\merged_assets" (
    rmdir /S /Q "app\build\intermediates\merged_assets" 2>nul
    echo       [OK] 已清理 merged_assets 缓存
)
call gradlew.bat clean
if errorlevel 1 (
    echo       [警告] clean 失败，继续增量构建
) else (
    echo       [OK] 旧缓存已清理
)
echo.

echo [5/10] 代码混淆（cloud target - 含 cloud_app assets）...
REM 代码混淆防止 APK assets 被反编译
call node "%~dp0..\..\tools\obfuscate.js" --target=cloud
if errorlevel 1 (
    echo       [错误] JS 代码混淆失败
    if not defined NO_PAUSE pause
    exit /b 1
)
echo       [OK] JS 代码混淆完成
echo.

echo [6/10] Java 预编译检查（提前发现编译错误）...
call gradlew.bat javaPreCompileRelease compileReleaseJavaWithJavac --quiet
if errorlevel 1 (
    echo       [错误] Java 预编译检查失败
    echo       [警告] 因预编译失败，正在恢复 JavaScript...
    call node "%~dp0..\..\tools\obfuscate.js" restore --target=cloud
    if not defined NO_PAUSE pause
    exit /b 1
)
echo       [OK] Java 预编译检查通过
echo.

echo [7/10] 编译签名 APK...
echo.
call gradlew.bat assembleRelease
if errorlevel 1 (
    echo.
    echo       [错误] 构建失败！正在回滚 versionCode...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$g='%ANDROID_DIR%\app\build.gradle'; $prevFile='%~dp0.build_vcode_prev'; if(Test-Path $prevFile){ $prev=Get-Content $prevFile -Raw; $c=Get-Content $g -Raw -Encoding UTF8; $nc=$c -replace 'versionCode\s+\d+', \"versionCode $prev\"; [System.IO.File]::WriteAllText($g,$nc,(New-Object System.Text.UTF8Encoding $false)); Remove-Item $prevFile -Force; Write-Host ('  [OK] versionCode 已回滚至 '+$prev) } else { Write-Host '  [警告] 无旧 versionCode 可回滚' }"
    echo       [警告] 因构建失败，正在恢复 JavaScript...
    call node "%~dp0..\..\tools\obfuscate.js" restore --target=cloud
    echo       [错误] 构建失败！请查看上方错误信息
    if not defined NO_PAUSE pause
    exit /b 1
)
REM P1-12: 构建成功后清理 versionCode 回滚临时文件
if exist "%~dp0.build_vcode_prev" del "%~dp0.build_vcode_prev"
echo.

echo [8/10] 恢复原始 JavaScript 代码 + 验证 APK 产物...
REM 恢复 JS 代码
call node "%~dp0..\..\tools\obfuscate.js" restore --target=cloud
if errorlevel 1 (
    echo       [警告] JS 恢复失败 - 可能需要手动恢复: node tools\obfuscate.js restore --target=cloud
) else (
    echo       [OK] JS 已恢复到原始状态
)
echo.
echo       定位 APK 文件...
set "APK_FILE="
if exist "%APK_OUTPUT_DIR%\app-release.apk" (
    set "APK_FILE=%APK_OUTPUT_DIR%\app-release.apk"
) else (
    for %%f in ("%APK_OUTPUT_DIR%\*.apk") do (
        set "APK_FILE=%%f"
    )
)
if "%APK_FILE%"=="" (
    echo       [错误] 未找到 APK 文件
    echo       搜索目录: %APK_OUTPUT_DIR%
    if not defined NO_PAUSE pause
    exit /b 1
)
for %%A in ("%APK_FILE%") do (
    echo       APK 文件: %%~nxA
    echo       文件大小: %%~zA 字节
)
echo.

echo [9/10] 验证 APK 内容 + 复制到输出目录...
echo       验证 APK 包含最新 auth-core.js...
REM P3: 云端 APP 从 URL 加载，APK 内无 index.html。改为验证 auth-core.js
powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; try { $zip=[System.IO.Compression.ZipFile]::OpenRead('%APK_FILE%'); $entry=$zip.GetEntry('assets/public/auth-core.js'); if($entry){ $sz=$entry.Length; if($sz -lt 1000){ Write-Host '[错误] APK auth-core.js 过小:' $sz '字节'; exit 1 }; Write-Host '[OK] APK auth-core.js:' $sz '字节 (云端 APP 从 URL 加载 index.html)' } else { Write-Host '[错误] APK 中未找到 auth-core.js'; exit 1 }; $zip.Dispose() } catch { Write-Host '[错误] APK 验证失败:' $_.Exception.Message; exit 1 }"
if errorlevel 1 (
    echo       [错误] APK 内容验证失败！APK 可能未包含最新代码
    if not defined NO_PAUSE pause
    exit /b 1
)

echo       读取产品名称和版本号...
set "PRODUCT_NAME="
for /f "delims=" %%p in ('powershell -NoProfile -Command "(Get-Content '..\cloud_desktop\package.json' -Encoding UTF8 -Raw | ConvertFrom-Json).build.productName"') do (
    set "PRODUCT_NAME=%%p"
)
if "%PRODUCT_NAME%"=="" set "PRODUCT_NAME=惠康中医-YJ"

set "VERSION_STR="
for /f "tokens=2 delims=:" %%v in ('findstr "versionName" "app\build.gradle"') do (
    set "VERSION_STR=%%v"
)
set "VERSION_STR=%VERSION_STR: =%"
set "VERSION_STR=%VERSION_STR:"=%"
if "%VERSION_STR%"=="" set "VERSION_STR=1.0"

set "FINAL_APK=%~dp0%PRODUCT_NAME%.apk"

copy /Y "%APK_FILE%" "%FINAL_APK%" >nul
if errorlevel 1 (
    echo       [警告] 复制失败，请手动从以下目录获取 APK:
    echo       %APK_OUTPUT_DIR%
) else (
    echo       [OK] 已复制到: %FINAL_APK%
)
echo.

echo [10/10] 自动更新下载页 & 完成...
echo       更新下载页（cloud）...
node "%~dp0..\..\tools\auto-update-downloads.js" cloud
if errorlevel 1 (
    echo       [警告] 下载页自动更新出现问题，继续执行
) else (
    echo       [OK] 下载页已更新 - cloud
)
echo.
echo       更新下载页（geren-cloud）...
node "%~dp0..\..\tools\auto-update-downloads.js" geren-cloud
if errorlevel 1 (
    echo       [警告] 下载页自动更新（geren-cloud）出现问题，继续执行
) else (
    echo       [OK] 下载页已更新 - geren-cloud
)
echo.
echo ============================================
echo   打包完成！
echo   APK 路径: %FINAL_APK%
echo   此 APK 已签名，可直接安装
echo ============================================
echo.

for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
for /f "delims=" %%e in ('powershell -NoProfile -Command "$s=[DateTime]::Parse('%BUILD_START_TIME%'); $e=[DateTime]::Parse('%BUILD_END_TIME%'); $d=$e-$s; $d.ToString('hh\:mm\:ss')"') do set "BUILD_ELAPSED=%%e"
powershell -NoProfile -Command "Write-Host '============================================' -ForegroundColor Yellow; Write-Host '  APK 打包完成!' -ForegroundColor Yellow; Write-Host '  路径: %FINAL_APK%' -ForegroundColor Yellow; Write-Host '  开始: %BUILD_START_TIME%' -ForegroundColor Yellow; Write-Host '  结束: %BUILD_END_TIME%' -ForegroundColor Yellow; Write-Host '  总耗时: %BUILD_ELAPSED%' -ForegroundColor Yellow; Write-Host '============================================' -ForegroundColor Yellow"
if not defined NO_PAUSE (
    set "EXIT_KEY="
    set /p "EXIT_KEY=按 0 或回车键退出: "
)
exit /b 0
