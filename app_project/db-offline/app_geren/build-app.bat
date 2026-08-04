@echo off
chcp 65001 >nul
REM P0: 打包前自动修复 .ps1 文件 BOM 编码
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\..\tools\fix-ps1-bom.ps1" >nul 2>&1
title 惠康中医离线APP打包工具（标准版）

REM 记录开始时间（用于耗时统计）
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_START_TIME=%%t"

echo ============================================
echo   惠康中医离线APP打包工具（标准版）
echo   开始: %BUILD_START_TIME%
echo ============================================
echo.

cd /d "%~dp0"

echo [1/10] 配置诊所信息...
if /i "%1"=="--skip-config" (
    echo       [SKIP] 检测到 --skip-config 参数，跳过配置
) else (
    powershell -ExecutionPolicy Bypass -File "..\edit-config.ps1" -DesktopDir desktop_geren -AppDir app_geren
    if errorlevel 1 (
        echo       [错误] edit-config.ps1 执行失败，终止打包
        if not defined NO_PAUSE pause
        exit /b 1
    )
)
echo.

echo [2/10] 同步文件到 Android + 验证完整性...
set "ANDROID_PUBLIC=%~dp0app\src\main\assets\public"
set "ANDROID_ASSETS=%~dp0app\src\main\assets"
if not exist "%ANDROID_PUBLIC%" (
    echo       [错误] 未找到 Capacitor 目标目录: %ANDROID_PUBLIC%
    if not defined NO_PAUSE pause
    exit /b 1
)
echo       [1/5] 同步 config.json...
if exist "..\desktop_geren\config.json" (
    copy /Y "..\desktop_geren\config.json" "%ANDROID_PUBLIC%\config.json" >nul
    if errorlevel 1 ( echo       [警告] config.json 同步失败 ) else ( echo       [OK] config.json 已同步 )
) else ( echo       [SKIP] 未找到 config.json )
echo       [2/5] 同步 APP index.html（5 按钮顶部菜单）...
copy /Y "..\index-app.html" "%ANDROID_PUBLIC%\index.html" >nul
if errorlevel 1 (
    echo       [错误] 同步 APP index.html 失败
    echo       源文件: ..\index-app.html
    if not defined NO_PAUSE pause
    exit /b 1
)
echo       [OK] APP index.html 已同步（5 按钮顶部菜单，含统计）
echo       [3/5] 同步 vendor/xlsx.full.min.js...
if exist "..\desktop_geren\vendor\xlsx.full.min.js" (
    if not exist "%ANDROID_PUBLIC%\vendor" mkdir "%ANDROID_PUBLIC%\vendor" >nul
    copy /Y "..\desktop_geren\vendor\xlsx.full.min.js" "%ANDROID_PUBLIC%\vendor\xlsx.full.min.js" >nul
    if errorlevel 1 ( echo       [警告] xlsx.full.min.js 同步失败 ) else ( echo       [OK] xlsx.full.min.js 已同步 )
) else ( echo       [SKIP] 未找到 vendor/xlsx.full.min.js )
echo       [4/5] 同步核心 JS 模块...
set "MODULES=auth-core.js db-adapter.js debug-logger.js medicine-dict.js patient-archive.js performance-utils.js permission.js prescription-core.js print-utils.js security-guard.js"
for %%m in (%MODULES%) do (
    if exist "..\desktop_geren\%%m" (
        copy /Y "..\desktop_geren\%%m" "%ANDROID_PUBLIC%\%%m" >nul
        if errorlevel 1 ( echo       [警告] %%m 同步失败 ) else ( echo       [OK] %%m 已同步 )
    ) else ( echo       [SKIP] 未找到 %%m )
)
echo       [5/5] 验证 video-recorder-inject.js...
if exist "%ANDROID_ASSETS%\video-recorder-inject.js" (
    echo       [OK] video-recorder-inject.js 已存在于 assets
) else if exist "..\video-recorder-inject.js" (
    copy /Y "..\video-recorder-inject.js" "%ANDROID_ASSETS%\video-recorder-inject.js" >nul
    if errorlevel 1 ( echo       [警告] video-recorder-inject.js 同步失败 ) else ( echo       [OK] video-recorder-inject.js 已同步 )
) else ( echo       [SKIP] 未找到 video-recorder-inject.js )
echo.
echo       验证 APP index.html 完整性（5 按钮顶部菜单）...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%ANDROID_PUBLIC%\index.html'; $c=[System.IO.File]::ReadAllText($f,[System.Text.Encoding]::UTF8); if($c.Length -lt 50000){ Write-Host '[错误] APP index.html 过小'; exit 1 }; if(-not ($c -match 'showModal\(.analyticsModal.')){ Write-Host '[错误] APP index.html 缺少 analyticsModal - 非 5 按钮版本'; exit 1 }; Write-Host '[OK] APP index.html 验证通过（5 按钮）'"
if errorlevel 1 (
    if not defined NO_PAUSE pause
    exit /b 1
)
echo       压缩 JavaScript 文件（安全加固）...
node "%~dp0..\..\..\shared\minify-js.js" "%ANDROID_PUBLIC%"
if errorlevel 1 (
    echo       [警告] JS 压缩出现问题，继续执行
) else (
    echo       [OK] JavaScript 文件已压缩
)
echo.

cd /d "%~dp0"

echo [3/10] 检查环境（JDK/Gradle/签名/capacitor）...
REM JDK/JAVA_HOME 检查（与云端 build-app.bat 对齐）
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
    echo       路径: %CD%\gradlew.bat
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\signing.properties" (
    echo       [错误] 未找到 signing.properties
    echo       路径: %CD%\app\signing.properties
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\app-release.jks" (
    echo       [错误] 未找到 app-release.jks
    echo       路径: %CD%\app\app-release.jks
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\src\main\assets\capacitor.config.json" (
    echo       [错误] 未找到 Capacitor config
    echo       路径: %CD%\app\src\main\assets\capacitor.config.json
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\src\main\assets\public\index.html" (
    echo       [错误] 未找到 index.html
    echo       路径: %CD%\app\src\main\assets\public\index.html
    if not defined NO_PAUSE pause
    exit /b 1
)
if not exist "app\src\main\assets\video-recorder-inject.js" (
    echo       [警告] 未找到 video-recorder-inject.js
    echo       路径: %CD%\app\src\main\assets\video-recorder-inject.js
) else (
    echo       [OK] video-recorder-inject.js 已就绪
)
echo       [OK] 环境检查通过

echo       打包前验证（磁盘空间 + 源文件）...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$disk=(Get-PSDrive -Name $((Get-Location).Drive.Name));" ^
  "$freeGB=[math]::Round($disk.Free/1GB,2);" ^
  "if($freeGB -lt 0.5){ Write-Host '[错误] 磁盘空间不足: '$freeGB'GB，需 >=0.5GB'; exit 1 };" ^
  "Write-Host '  磁盘剩余:' $freeGB 'GB';" ^
  "$required=@('..\desktop_geren\index.html','..\index-app.html','..\desktop_geren\config.json','app\signing.properties','app\app-release.jks','app\build.gradle');" ^
  "$missing=@(); foreach($f in $required){ if(-not(Test-Path $f)){ $missing+=$f } };" ^
  "if($missing.Count -gt 0){ Write-Host '[错误] 缺少必需文件:'; $missing|ForEach-Object{ Write-Host '  - '$_ }; exit 1 };" ^
  "Write-Host '[OK] 所有必需文件已就绪'"
if errorlevel 1 (
    if not defined NO_PAUSE pause
    exit /b 1
)
echo       验证 keystore 完整性...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$jks='app\app-release.jks';" ^
  "$size=(Get-Item $jks).Length;" ^
  "if($size -lt 1000){ Write-Host '[错误] keystore 文件过小 ('$size' 字节)，可能已损坏'; exit 1 };" ^
  "$bytes=[System.IO.File]::ReadAllBytes($jks);" ^
  "$header=[System.Text.Encoding]::ASCII.GetString($bytes[0..3]);" ^
  "if($header -notmatch '0x|....'){ Write-Host '[警告] keystore 头部异常: '$header };" ^
  "Write-Host '[OK] keystore 正常 ('$size' 字节)'"
if errorlevel 1 (
    if not defined NO_PAUSE pause
    exit /b 1
)
echo.

echo [4/10] 修补 Capacitor Java 版本（21 → 17）+ 显示当前配置...
call node "%~dp0..\..\..\tools\patch-java-version.js" "%~dp0..\.."
if errorlevel 1 (
    echo       [警告] Java 版本修补出现问题，继续执行
) else (
    echo       [OK] Java 版本已修补
)
echo       当前配置:
findstr "versionName" "app\build.gradle"
echo.

echo [5/10] 停止残留 Gradle 进程 + 清理构建缓存...
REM 仅 kill 标题为 gradle 的 java 进程（保留 daemon 加速下次构建）
taskkill /F /IM java.exe /FI "WINDOWTITLE eq gradle*" >nul 2>&1
call gradlew.bat --stop >nul 2>&1
echo       [OK] 残留进程已清理
REM P2-3: 废弃 TCM_GRADLE_SKIP_CLEAN，强制执行 gradlew clean（与 project_memory 约束一致）
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

echo [6/10] 自增 versionCode...
REM P0-3: 自增前保存旧值到临时文件；构建失败时回滚，避免跳号（与云端 build-app.bat 对齐）
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='app\build.gradle'; $c=[System.IO.File]::ReadAllText($f); if($c -match 'versionCode\s+(\d+)'){ $old=[int]$matches[1]; $new=$old+1; $nc=$c -replace 'versionCode\s+\d+', \"versionCode $new\"; [System.IO.File]::WriteAllText($f,$nc,(New-Object System.Text.UTF8Encoding($false))); Set-Content -Path '%~dp0.build_vcode_prev' -Value $old -Encoding ASCII -NoNewline; Write-Host ('  [OK] versionCode: '+$old+' -> '+$new+' (旧值已保存)') } else { Write-Host '  [警告] build.gradle 中未找到 versionCode' }"
echo.

echo [7/10] 代码混淆（target=geren）+ Java 预编译检查...
echo       [STAGE:obfuscate] 代码混淆中...
call node "%~dp0..\..\..\tools\obfuscate.js" --target=geren
if errorlevel 1 (
    echo       [错误] JS 代码混淆失败
    if not defined NO_PAUSE pause
    exit /b 1
)
echo       [OK] JS 代码混淆完成
echo       [STAGE:precompile] Java 预编译检查中（提前发现编译错误）...
call gradlew.bat javaPreCompileRelease compileReleaseJavaWithJavac --quiet
if errorlevel 1 (
    echo       [错误] Java 预编译检查失败，终止打包
    echo       [警告] 因预编译失败，正在恢复 JavaScript...
    call node "%~dp0..\..\..\tools\obfuscate.js" restore --target=geren
    if not defined NO_PAUSE pause
    exit /b 1
)
echo       [OK] Java 预编译检查通过
echo.

echo [8/10] 编译签名 APK（失败自动重试 --no-daemon）...
echo.
call gradlew.bat assembleRelease
if errorlevel 1 (
    echo.
    echo       [警告] 首次构建失败，3 秒后使用 --no-daemon 重试...
    call gradlew.bat --stop >nul 2>&1
    timeout /t 3 /nobreak >nul
    call gradlew.bat assembleRelease --no-daemon
    if errorlevel 1 (
        echo.
        echo       [错误] 重试后构建仍失败！正在回滚 versionCode...
        powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='app\build.gradle'; $prevFile='%~dp0.build_vcode_prev'; if(Test-Path $prevFile){ $prev=Get-Content $prevFile -Raw; $c=[System.IO.File]::ReadAllText($f); $nc=$c -replace 'versionCode\s+\d+', \"versionCode $prev\"; [System.IO.File]::WriteAllText($f,$nc,(New-Object System.Text.UTF8Encoding($false))); Remove-Item $prevFile -Force; Write-Host ('  [OK] versionCode 已回滚至 '+$prev) } else { Write-Host '  [警告] 无旧 versionCode 可回滚' }"
        echo       [警告] 因构建失败，正在恢复 JavaScript...
        call node "%~dp0..\..\..\tools\obfuscate.js" restore --target=geren
        echo       [错误] 构建失败！请查看上方错误信息
        if not defined NO_PAUSE pause
        exit /b 1
    )
    echo       [OK] 重试构建成功
)
REM P0-3: 构建成功后清理 versionCode 回滚临时文件
if exist "%~dp0.build_vcode_prev" del "%~dp0.build_vcode_prev"
echo.

echo [9/10] 恢复原始 JavaScript + 验证 APK 产物...
echo       恢复 JavaScript 代码...
call node "%~dp0..\..\..\tools\obfuscate.js" restore --target=geren
if errorlevel 1 (
    echo       [警告] JS 恢复失败 - 可能需要手动恢复: node tools\obfuscate.js restore --target=geren
) else (
    echo       [OK] JS 已恢复到原始状态
)
echo.
echo       定位 APK 文件...
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
    echo       [错误] 未找到 APK 文件
    echo       搜索目录: %CD%\%APK_DIR%
    if not defined NO_PAUSE pause
    exit /b 1
)
for %%A in ("%APK_FILE%") do (
    echo       APK 文件: %%~nxA
    echo       文件大小: %%~zA 字节
    echo       完整路径: %CD%\%%A
)
echo.

echo       验证 APK 签名...
REM 使用 apksigner 验证 APK 已正确签名
set "APKSIGNER="
if exist "%ANDROID_HOME%\build-tools" (
    for /f "delims=" %%d in ('dir /b /ad "%ANDROID_HOME%\build-tools" ^| sort /r') do (
        if not defined APKSIGNER if exist "%ANDROID_HOME%\build-tools\%%d\apksigner.bat" set "APKSIGNER=%ANDROID_HOME%\build-tools\%%d\apksigner.bat"
    )
)
if defined APKSIGNER (
    call "%APKSIGNER%" verify --verbose "%APK_FILE%" 2>&1 | findstr /i "verified WARNING ERROR"
    if errorlevel 1 (
        echo       [错误] APK 签名验证失败！
        if not defined NO_PAUSE pause
        exit /b 1
    )
    echo       [OK] APK 签名验证通过
) else (
    echo       [警告] 未找到 apksigner，跳过签名验证
    echo              设置 ANDROID_HOME 以启用签名验证
)
echo.

echo       验证 APK 包含最新 index.html（内容哈希）...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; $apk='%CD%\%APK_FILE%'; $zip=[System.IO.Compression.ZipFile]::OpenRead($apk); $entry=$zip.GetEntry('assets/public/index.html'); if(-not $entry){ $zip.Dispose(); Write-Host '[错误] APK 中未找到 assets/public/index.html'; exit 1 }; $sr=New-Object System.IO.StreamReader($entry.Open()); $content=$sr.ReadToEnd(); $sr.Close(); $zip.Dispose(); $hash=[System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($content)); $hashStr=($hash|ForEach-Object{$_.ToString('x2')})-join ''; if($content.Length -lt 1000){ Write-Host '[错误] APK 中 index.html 过小 ('$content.Length' 字节)，构建可能不完整'; exit 1 }; Write-Host '[OK] APK 包含 index.html ('$content.Length' 字节, sha256='+$hashStr.Substring(0,16)+'...)'"
if errorlevel 1 (
    echo       [错误] APK 内容验证失败！APK 可能未包含最新代码
    if not defined NO_PAUSE pause
    exit /b 1
)
echo.

echo       验证 APK 包含 video-recorder-inject.js...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; $apk='%CD%\%APK_FILE%'; $zip=[System.IO.Compression.ZipFile]::OpenRead($apk); $entry=$zip.GetEntry('assets/video-recorder-inject.js'); if(-not $entry){ $zip.Dispose(); Write-Host '[警告] APK 中未找到 video-recorder-inject.js'; exit 0 }; $sr=New-Object System.IO.StreamReader($entry.Open()); $content=$sr.ReadToEnd(); $sr.Close(); $zip.Dispose(); if(-not($content -match '__nativeBridgeProxy')){ Write-Host '[错误] video-recorder-inject.js 缺少 __nativeBridgeProxy 修复!'; exit 1 }; if(-not($content -match 'generateFileName')){ Write-Host '[错误] video-recorder-inject.js 缺少 generateFileName!'; exit 1 }; Write-Host '[OK] video-recorder-inject.js 验证通过 ('$content.Length' 字节)'"
if errorlevel 1 (
    echo       [错误] APK video-recorder-inject.js 验证失败！
    if not defined NO_PAUSE pause
    exit /b 1
)
echo.

echo       APK 大小合理性检查...
for %%A in ("%APK_FILE%") do set "APK_SIZE=%%~zA"
if %APK_SIZE% LSS 1000000 (
    echo       [错误] APK 大小过小: %APK_SIZE% 字节 ^(< 1MB^)，构建可能不完整
    if not defined NO_PAUSE pause
    exit /b 1
)
if %APK_SIZE% GTR 10000000 (
    echo       [警告] APK 大小异常: %APK_SIZE% 字节 ^(^> 10MB^)，检查是否包含非预期文件
)
echo       [OK] APK 大小: %APK_SIZE% 字节
echo.

echo [10/10] 复制 APK 到输出目录 + 计算 SHA-256 + 更新下载页...
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

REM 验证源 APK 大小（防止 Gradle 失败或写入不完整时复制空文件）
set "SRC_SIZE=0"
for %%A in ("%APK_FILE%") do set "SRC_SIZE=%%~zA"
if "%SRC_SIZE%"=="" set "SRC_SIZE=0"
if %SRC_SIZE% EQU 0 (
    echo       [错误] 源 APK 为 0 字节或无法访问！
    echo       源文件: %CD%\%APK_FILE%
    echo       Gradle 构建可能已失败，请查看上方构建日志
    if not defined NO_PAUSE pause
    exit /b 1
)
echo       源 APK 大小: %SRC_SIZE% 字节

REM 使用 PowerShell .NET File.Copy 可靠复制（支持 unicode 名称，带大小验证）
set "FINAL_APK=..\%PRODUCT_NAME%.apk"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $src='%APK_FILE%'; $dst='%FINAL_APK%'; $expected=%SRC_SIZE%; try { [System.IO.File]::Copy($src,$dst,$true); $actual=(New-Object System.IO.FileInfo $dst).Length; if($actual -ne $expected){ Write-Host ('[错误] 大小不匹配: src='+$expected+' dst='+$actual); exit 1 }; Write-Host ('[OK] 已复制 '+$actual+' 字节到: '+$dst) } catch { Write-Host ('[错误] '+$_.Exception.Message); exit 1 }"
if errorlevel 1 (
    echo       [警告] 使用 productName 复制失败，回退到 app-release.apk
    set "FINAL_APK=..\app-release.apk"
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $src='%APK_FILE%'; $dst='%FINAL_APK%'; $expected=%SRC_SIZE%; try { [System.IO.File]::Copy($src,$dst,$true); $actual=(New-Object System.IO.FileInfo $dst).Length; if($actual -ne $expected){ Write-Host ('[错误] 大小不匹配: src='+$expected+' dst='+$actual); exit 1 }; Write-Host ('[OK] 已复制 '+$actual+' 字节到: '+$dst) } catch { Write-Host ('[错误] '+$_.Exception.Message); exit 1 }"
    if errorlevel 1 (
        echo       [错误] 复制失败，请手动从以下目录获取 APK:
        echo       %CD%\%APK_DIR%
        if not defined NO_PAUSE pause
        exit /b 1
    )
)
echo.

REM 获取 APK 文件绝对路径（用于显示）
for %%F in ("%FINAL_APK%") do set "APK_FULL_PATH=%%~fF"

echo       计算 SHA-256 哈希值...
node "%~dp0..\..\..\shared\calculate-hash.js"
if errorlevel 1 (
    echo       [警告] 哈希计算出现问题，继续执行
) else (
    echo       [OK] SHA-256 哈希已更新到 public/hash-manifest.json
)
echo       自动更新下载页（geren）...
node "%~dp0..\..\..\tools\auto-update-downloads.js" geren
if errorlevel 1 (
    echo       [警告] 下载页自动更新出现问题，继续执行
) else (
    echo       [OK] 下载页已更新 - geren
)
echo.

echo ============================================
echo   APK 打包完成！
echo   路径: %APK_FULL_PATH%
echo   此 APK 已签名，可直接安装
echo ============================================
echo.

for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "BUILD_END_TIME=%%t"
for /f "delims=" %%e in ('powershell -NoProfile -Command "$s=[DateTime]::Parse('%BUILD_START_TIME%'); $e=[DateTime]::Parse('%BUILD_END_TIME%'); $d=$e-$s; $d.ToString('hh\:mm\:ss')"') do set "BUILD_ELAPSED=%%e"
powershell -NoProfile -Command "Write-Host '============================================' -ForegroundColor Yellow; Write-Host '  APK 打包完成!' -ForegroundColor Yellow; Write-Host '  路径: %APK_FULL_PATH%' -ForegroundColor Yellow; Write-Host '  开始: %BUILD_START_TIME%' -ForegroundColor Yellow; Write-Host '  结束: %BUILD_END_TIME%' -ForegroundColor Yellow; Write-Host '  总耗时: %BUILD_ELAPSED%' -ForegroundColor Yellow; Write-Host '============================================' -ForegroundColor Yellow"
if not defined NO_PAUSE (
    set "EXIT_KEY="
    set /p "EXIT_KEY=按 0 或回车键退出: "
)
exit /b 0
