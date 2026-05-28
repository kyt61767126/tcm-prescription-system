@echo off
chcp 65001 >nul
echo =============================================
echo     中医处方系统 - Cloudflare 部署脚本
echo =============================================
echo.
echo 正在检查项目结构...

if exist "functions\api\sync.js" (
    echo ✅ functions/api/sync.js 已就绪
) else (
    echo ❌ 缺少 functions/api/sync.js
    pause
    exit /b 1
)

if exist "functions/api/auth/login.js" (
    echo ✅ functions/api/auth/login.js 已就绪
) else (
    echo ❌ 缺少 functions/api/auth/login.js
    pause
    exit /b 1
)

if exist "functions/api/prescriptions/index.js" (
    echo ✅ functions/api/prescriptions/index.js 已就绪
) else (
    echo ❌ 缺少 functions/api/prescriptions/index.js
    pause
    exit /b 1
)

echo.
echo =============================================
echo 📁 项目文件结构
echo =============================================
echo.
echo tcm-prescription-system/
echo ├── index.html                    # 前端页面
echo └── functions/
echo     ├── _utils.js                 # 工具函数
echo     └── api/
echo         ├── sync.js               # ✅ 数据同步接口
echo         ├── health.js             # 健康检查
echo         ├── auth/
echo         │   ├── login.js          # 用户登录
echo         │   └── init-admin.js     # 初始化管理员
echo         └── prescriptions/
echo             ├── index.js          # 处方列表/创建
echo             └── [id].js           # 单个处方操作
echo.
echo =============================================
echo 🚀 接下来请您完成以下步骤
echo =============================================
echo.
echo 步骤 1: 推送代码到 GitHub
echo --------------------------
echo 打开终端，运行以下命令：
echo git add .
echo git commit -m "添加 Cloudflare Pages Functions"
echo git push origin main
echo.
echo 步骤 2: 配置 Cloudflare KV Binding
echo ----------------------------------
echo 1. 登录 Cloudflare Dashboard
echo 2. 进入您的 Pages 项目: tcm-prescription-system
echo 3. 点击 Settings - Functions
echo 4. 在 "KV namespace bindings" 点击 "Add binding"
echo 5. 填写:
echo    - Variable name: KV
echo    - KV namespace: 选择 tcm-prescription-kv
echo 6. 添加环境变量: JWT_SECRET = your-secret-key
echo.
echo 步骤 3: 等待自动部署完成
echo ------------------------
echo Cloudflare Pages 会自动检测代码更新并重新部署
echo 部署完成后访问: https://599cb7b0.tcm-prescription-system.pages.dev
echo.
echo =============================================
echo ✨ 部署完成后的功能
echo =============================================
echo.
echo ✅ 处方开具与打印
echo ✅ 跨设备数据同步
echo ✅ 云端永久存储
echo ✅ 用户登录认证
echo ✅ 全球 CDN 加速
echo.
echo 默认管理员账户: admin / admin
echo.
pause
