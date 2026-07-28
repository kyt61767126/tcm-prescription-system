@echo off
chcp 65001 >nul
title Sync Shared Code to All Versions
setlocal enabledelayedexpansion

set SHARED=%~dp0_shared
set VERSIONS=db-bendi db-dingzhi db-geren

echo ================================================================
echo   Sync _shared/ to all 3 versions
echo ================================================================
echo.

for %%v in (%VERSIONS%) do (
    echo [%%v] Syncing...
    
    REM Sync JS files to root
    copy /Y "%SHARED%\auth-core.js"        "%~dp0%%v\auth-core.js"        >nul
    copy /Y "%SHARED%\db-adapter.js"       "%~dp0%%v\db-adapter.js"       >nul
    copy /Y "%SHARED%\prescription-core.js" "%~dp0%%v\prescription-core.js" >nul
    copy /Y "%SHARED%\patient-archive.js"  "%~dp0%%v\patient-archive.js"  >nul
    copy /Y "%SHARED%\medicine-dict.js"    "%~dp0%%v\medicine-dict.js"    >nul
    copy /Y "%SHARED%\print-utils.js"      "%~dp0%%v\print-utils.js"      >nul
    copy /Y "%SHARED%\performance-utils.js" "%~dp0%%v\performance-utils.js" >nul
    copy /Y "%SHARED%\debug-logger.js"     "%~dp0%%v\debug-logger.js"     >nul
    copy /Y "%SHARED%\permission.js"       "%~dp0%%v\permission.js"       >nul
    copy /Y "%SHARED%\security-guard.js"   "%~dp0%%v\security-guard.js"   >nul

    REM Sync vendor
    if not exist "%~dp0%%v\vendor" mkdir "%~dp0%%v\vendor"
    copy /Y "%SHARED%\vendor\xlsx.full.min.js" "%~dp0%%v\vendor\xlsx.full.min.js" >nul
    
    REM Sync to electron/ (only permission.js, referenced by electron/login.html; other 8 modules loaded by root/index.html, no need to duplicate in electron/)
    copy /Y "%SHARED%\permission.js"       "%~dp0%%v\electron\permission.js"       >nul
    
    REM Sync to android/assets/public/
    set ANDROID=%~dp0%%v\android\app\src\main\assets\public
    if exist "!ANDROID!" (
        copy /Y "%SHARED%\auth-core.js"        "!ANDROID!\auth-core.js"        >nul
        copy /Y "%SHARED%\db-adapter.js"       "!ANDROID!\db-adapter.js"       >nul
        copy /Y "%SHARED%\prescription-core.js" "!ANDROID!\prescription-core.js" >nul
        copy /Y "%SHARED%\patient-archive.js"  "!ANDROID!\patient-archive.js"  >nul
        copy /Y "%SHARED%\medicine-dict.js"    "!ANDROID!\medicine-dict.js"    >nul
        copy /Y "%SHARED%\print-utils.js"      "!ANDROID!\print-utils.js"      >nul
        copy /Y "%SHARED%\performance-utils.js" "!ANDROID!\performance-utils.js" >nul
        copy /Y "%SHARED%\debug-logger.js"     "!ANDROID!\debug-logger.js"     >nul
        copy /Y "%SHARED%\permission.js"       "!ANDROID!\permission.js"       >nul
        copy /Y "%SHARED%\security-guard.js"   "!ANDROID!\security-guard.js"   >nul
        if not exist "!ANDROID!\vendor" mkdir "!ANDROID!\vendor" >nul
        copy /Y "%SHARED%\vendor\xlsx.full.min.js" "!ANDROID!\vendor\xlsx.full.min.js" >nul
        echo   ^> Synced to root + electron/ + android/assets/public/
    ) else (
        echo   ^> Synced to root + electron/ (no android/)
    )

    REM Sync to android/app/src/main/res/xml/ (security & backup rules)
    REM P1-Security (2026-07-25): sync res/xml resources to prevent single-version pollution
    REM Historical bug: db-bendi/network_security_config.xml was polluted by 'gh auth login' command
    REM being accidentally written into the file. Without sync, the pollution persisted undetected.
    set "ANDROID_RES_XML=%~dp0%%v\android\app\src\main\res\xml"
    if exist "!ANDROID_RES_XML!" (
        copy /Y "%SHARED%\res\xml\network_security_config.xml" "!ANDROID_RES_XML!\network_security_config.xml" >nul
        copy /Y "%SHARED%\res\xml\data_extraction_rules.xml"   "!ANDROID_RES_XML!\data_extraction_rules.xml"   >nul
        copy /Y "%SHARED%\res\xml\file_paths.xml"              "!ANDROID_RES_XML!\file_paths.xml"              >nul
        echo   ^> Synced to android/res/xml/ (network_security + data_extraction + file_paths)
    )
    echo.
)

echo ================================================================
echo   All versions synced successfully!
echo ================================================================
echo.
echo   Next steps:
echo   - Run build-app.bat in each version (sync is now built-in)
echo   - Or run pack.bat in each version to build
echo.
if not defined NO_PAUSE pause
