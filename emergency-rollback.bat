@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

echo ============================================
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '鎯犲悍涓尰 - 绱ф€ュ洖婊氬伐鍏?echo   (浜戠缃戦〉鐗?+ 妗岄潰EXE + APP)'"
echo ============================================
echo.

if "%1"=="" goto :menu
if "%1"=="web" goto :rollback_web
if "%1"=="exe" goto :rollback_exe
if "%1"=="all" goto :rollback_all
goto :menu

:menu
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '閫夋嫨鍥炴粴鎿嶄綔:'"
echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '1. 浜戠缃戦〉鐗堝洖婊?(鎾ら攢鏈€杩戜竴娆it鎻愪氦锛孋loudflare鑷姩閲嶆柊閮ㄧ讲)'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '2. 妗岄潰EXE鍥炴粴 (鍥炴粴latest.json鍒颁笂涓€涓増鏈?'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '3. 鍏ㄩ儴鍥炴粴 (缃戦〉鐗?EXE锛岀揣鎬ユ儏鍐典娇鐢?'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '4. 鏌ョ湅鏈€杩?娆￠儴缃茶褰?echo   5. 閫€鍑?echo.'"
set /p choice=" [1-5]: "

if "%choice%"=="1" goto :rollback_web
if "%choice%"=="2" goto :rollback_exe
if "%choice%"=="3" goto :rollback_all
if "%choice%"=="4" goto :show_deploys
if "%choice%"=="5" goto :eof
goto :menu

:rollback_web
echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[缃戦〉鐗堝洖婊歖 鎾ら攢鏈€杩戜竴娆℃彁浜ゅ苟鎺ㄩ€?..'"
echo.

REM ??echo ??
git log --oneline -3
echo.

set /p confirm="(y/n): "
if /i not "%confirm%"=="y" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '宸插彇娑?    goto :eof'"
)

REM ?git revert HEAD --no-edit
if errorlevel 1 (
    echo.
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[閿欒] git revert 澶辫触锛屽彲鑳芥湁鍐茬獊'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '璇锋墜鍔ㄦ墽琛? git revert HEAD'"
    goto :eof
)

REM GitHubloudflare Pages
git push origin main
if errorlevel 1 (
    echo.
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[閿欒] git push 澶辫触'"
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '璇锋墜鍔ㄦ墽琛? git push origin main'"
    goto :eof
)

echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '鉁?缃戦〉鐗堝洖婊氬畬鎴愶紒'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Cloudflare Pages 灏嗗湪1-2鍒嗛挓鍐呴噸鏂伴儴缃?echo   棰勮鐜 staging 涓嶅彈褰卞搷'"
echo.
goto :eof

:rollback_exe
echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[妗岄潰EXE鍥炴粴]'"
echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '鍙洖婊氱殑娓犻亾:'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'cloud    - 浜戠妗岄潰鐗?echo   dingzhi  - 瀹氬埗鐗堟闈㈢増'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'geren    - 涓汉鐗堟闈㈢増'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'all      - 鎵€鏈夋闈㈢増'"
echo.
set /p channel="?(=cloud): "
if "%channel%"=="" set channel=cloud

echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '姝ｅ湪鏌ヨ鍙洖婊氱殑鐗堟湰...'"
node tools/rollback.js %channel%
echo.
set /p ver="?(?1.1.0): "
if "%ver%"=="" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '鏈緭鍏ョ増鏈彿锛屽凡鍙栨秷'"
    goto :eof
)

set /p confirm="?%channel% ?%ver%?y/n): "
if /i not "%confirm%"=="y" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '宸插彇娑?    goto :eof'"
)

node tools/rollback.js %channel% %ver% --push
echo.
goto :eof

:rollback_all
echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[鍏ㄩ儴鍥炴粴 - 绱ф€ユā寮廬'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '姝ゆ搷浣滃皢:'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '1. 鎾ら攢缃戦〉鐗堟渶杩戜竴娆℃彁浜?echo   2. 鍥炴粴鎵€鏈夋闈XE鍒颁笂涓€涓増鏈?echo.'"
set /p confirm="(y/n): "
if /i not "%confirm%"=="y" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '宸插彇娑?    goto :eof'"
)

echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[1/2] 鍥炴粴缃戦〉鐗?..'"
git revert HEAD --no-edit
git push origin main

echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[2/2] 鍥炴粴妗岄潰EXE (鎵€鏈夋笭閬?...'"
for %%c in (cloud dingzhi geren) do (
    echo.
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '娓犻亾: %%c'"
    node tools/rollback.js %%c 2>nul
 set /p ver="?%%c (=): "
    if not "!ver!"=="" (
        node tools/rollback.js %%c !ver! --push
    )
)

echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '鉁?鍏ㄩ儴鍥炴粴瀹屾垚锛?echo   缃戦〉鐗? Cloudflare 1-2鍒嗛挓鍐呴噸鏂伴儴缃?echo   妗岄潰鐗? 鐢ㄦ埛涓嬫妫€鏌ユ洿鏂版椂鏀跺埌鍥炴粴鐗堟湰'"
echo.
goto :eof

:show_deploys
echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '鏈€杩?娆loudflare Pages閮ㄧ讲:'"
echo.
npx wrangler pages deployment list --project-name=tcm-prescription-system 2>&1 | findstr /R "Production.*main" | Select-Object -First 5
echo.
goto :menu
