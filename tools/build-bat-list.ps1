# build-bat-list.ps1 - 下游构建 .bat 清单（单一权威源）
# ★ 2026-10-30 P0 去重：该清单原在 entry-selfheal.ps1 / one-click-pack.ps1 /
#   release-menu.ps1 三处各写一份（新增下游 bat 要改三处，漏一处即 CRLF 自愈缺口）。
#   现统一到此文件，三处均 dot-source 本文件。
# 新增/删除下游构建 bat 只改这里。
$DownstreamBuildBats = @(
    '重打包四端.bat'
    'app_project\db-yunduan\pack-desktop.bat'
    'app_project\db-yunduan\build-pack.bat'
    'app_project\db-yunduan\build-app.bat'
    'app_project\db-yunduan\cloud_desktop\build.bat'
    'app_project\db-offline\pack-desktop.bat'
    'app_project\db-offline\build-pack.bat'
    'app_project\db-offline\app\build-app.bat'
    'app_project\db-offline\desktop\build.bat'
)
