@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

echo ============================================
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '鎯犲悍涓尰 - 棰勫彂甯冨垎鏀鐞嗗伐鍏?'"
echo ============================================
echo.

if "%1"=="merge" goto :merge
if "%1"=="sync" goto :sync
if "%1"=="preview" goto :preview
goto :help

:merge
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[1/4] 鍒囨崲鍒?main 鍒嗘敮...'"
git checkout main
echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[2/4] 鎷夊彇鏈€鏂颁唬鐮?..'"
git pull origin main
echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[3/4] 鍚堝苟 staging 鍒?main...'"
git merge staging --no-ff -m "merge: staging -> main ()"
if errorlevel 1 (
    echo.
    powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[閿欒] 鍚堝苟鍐茬獊锛佽鎵嬪姩瑙ｅ喅鍐茬獊鍚庢墽琛?'"
    echo   git add .
    echo   git commit
    echo   staging-merge.bat push
    goto :eof
)
echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[4/4] 鎺ㄩ€佸埌 GitHub (瑙﹀彂 Cloudflare Pages 鐢熶骇閮ㄧ讲)...'"
git push origin main
echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '鉁?鍚堝苟瀹屾垚锛丆loudflare Pages 灏嗚嚜鍔ㄩ儴缃插埌鐢熶骇鐜銆?'"
goto :eof

:sync
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[1/3] 灏?main 鐨勬渶鏂颁唬鐮佸悓姝ュ埌 staging...'"
git checkout staging
echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[2/3] 鎷夊彇鏈€鏂颁唬鐮?..'"
git pull origin main
echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '[3/3] 鎺ㄩ€?staging...'"
git push origin staging
echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '鉁?staging 宸蹭笌 main 鍚屾銆?'"
git checkout main
goto :eof

:preview
echo.
echo ============================================
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Cloudflare Pages Preview 閮ㄧ讲璇存槑'"
echo ============================================
echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '1. 鍦?Cloudflare Dashboard 涓厤缃?'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'Pages 椤圭洰 -> Settings -> Builds & deployments'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '-> Preview branches -> 娣诲姞 staging'"
echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '2. 鎺ㄩ€佷唬鐮佸埌 staging 鍒嗘敮鍚? Cloudflare 浼氳嚜鍔ㄩ儴缃查瑙?'"
echo    https://[hash].tcm-prescription-system.pages.dev
echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '3. 楠岃瘉閫氳繃鍚? 鎵ц:'"
echo    staging-merge.bat merge
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '灏?staging 鍚堝苟鍒?main, 瑙﹀彂鐢熶骇閮ㄧ讲銆?'"
echo.
goto :eof

:help
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '鐢ㄦ硶:'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'staging-merge.bat merge    - 灏?staging 鍚堝苟鍒?main (楠岃瘉閫氳繃鍚庢墽琛?'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'staging-merge.bat sync     - 灏?main 鏈€鏂颁唬鐮佸悓姝ュ埌 staging'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host 'staging-merge.bat preview  - 鏌ョ湅 Preview 閮ㄧ讲璇存槑'"
echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '宸ヤ綔娴?'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '1. git checkout staging          (鍒囨崲鍒伴鍙戝竷鍒嗘敮)'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '2. 淇敼浠ｇ爜骞舵祴璇?'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '3. git push origin staging       (鎺ㄩ€? Cloudflare 鑷姩閮ㄧ讲棰勮)'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '4. 鍦ㄩ瑙圲RL楠岃瘉閫氳繃'"
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Host '5. staging-merge.bat merge       (鍚堝苟鍒癿ain, 瑙﹀彂鐢熶骇閮ㄧ讲)'"
echo.
