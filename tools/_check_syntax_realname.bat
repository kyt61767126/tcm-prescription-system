@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion
set FAIL=0
echo ====== node --check 语法校验（11处 auth-core + 2处 login.js）======
for %%f in (
  "shared\auth-core.js"
  "shared\auth-core\offline.js"
  "app_project\db-offline\desktop\auth-core.js"
  "app_project\db-offline\desktop\electron\auth-core.js"
  "app_project\db-offline\app\app\src\main\assets\public\auth-core.js"
  "public\auth-core.js"
  "public\electron\auth-core.js"
  "site-admin\auth-core.js"
  "app_project\db-yunduan\cloud_desktop\auth-core.js"
  "site-admin\electron\auth-core.js"
  "app_project\db-yunduan\cloud_desktop\electron\auth-core.js"
  "app_project\db-yunduan\cloud_app\app\src\main\assets\public\auth-core.js"
  "app_project\db-offline\desktop\electron\login.js"
  "app_project\db-yunduan\cloud_desktop\electron\login.js"
) do (
  node --check %%f >nul 2>&1
  if !errorlevel!==0 (
    echo [OK] %%~f
  ) else (
    echo [FAIL] %%~f
    node --check %%f
    set /A FAIL+=1
  )
)
echo.
if %FAIL%==0 (echo 全部 13 个文件语法校验通过) else (echo 失败数量: %FAIL%)
exit /b %FAIL%
