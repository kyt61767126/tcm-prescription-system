# Cloudflare Pages Functions 部署指南

## 📁 项目结构

```
tcm-prescription-system/
├── functions/
│   ├── _utils.js
│   └── api/
│       ├── health.js
│       └── auth/
│           ├── init-admin.js
│           └── login.js
│       └── prescriptions/
│           ├── index.js
│           └── [id].js
├── index.html
└── _headers
```

## 🚀 部署步骤

### 1. 确保 Cloudflare Pages 已连接您的仓库

在 [Cloudflare Dashboard](https://dash.cloudflare.com/) → Pages 中：
- 确保您的项目已连接到 GitHub/GitLab 仓库
- 或者使用 Wrangler CLI 直接部署

### 2. 配置 KV Namespace

#### 方法 A: 通过 Cloudflare Dashboard 配置

1. 进入您的 Pages 项目 → Settings → Functions
2. 找到 **KV namespace bindings** 部分
3. 添加绑定：
   - **Variable name**: `KV`
   - **KV namespace**: 选择您的 `tcm-prescription-kv` 命名空间

#### 方法 B: 通过 wrangler.toml 配置

在项目根目录创建 `wrangler.toml`：

```toml
name = "tcm-prescription-system"
pages_build_output_dir = "."
compatibility_date = "2024-01-01"

kv_namespaces = [
  { binding = "KV", id = "b1ab3e4b6b83341958cef369fcbf94933" }
]

[vars]
JWT_SECRET = "your-secret-key-change-this-in-production"
```

### 3. 配置环境变量

在 Pages 项目设置 → Environment variables 中添加：

- **JWT_SECRET**: 您的密钥（建议32位随机字符串）

### 4. 部署

#### 方式一：Git 自动部署（推荐）

1. 将代码推送到您的 Git 仓库
2. Cloudflare Pages 会自动检测并部署
3. 部署完成后，在项目主页可以看到部署状态

#### 方式二：使用 Wrangler 手动部署

```bash
# 安装 Wrangler（如果还没安装）
npm install -g wrangler

# 登录
wrangler login

# 部署
wrangler pages deploy . --project-name=tcm-prescription-system
```

## 📝 API 端点列表

部署成功后，以下端点将可用：

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/auth/init-admin` | POST | 初始化管理员 |
| `/api/auth/login` | POST | 用户登录 |
| `/api/prescriptions` | GET | 获取处方列表（需认证） |
| `/api/prescriptions` | POST | 创建处方（需认证） |
| `/api/prescriptions/:id` | GET | 获取单个处方（需认证） |
| `/api/prescriptions/:id` | PUT | 更新处方（需认证） |
| `/api/prescriptions/:id` | DELETE | 删除处方（需认证） |

## ✅ 部署后测试

### 1. 初始化管理员账户

```bash
curl -X POST https://your-project.pages.dev/api/auth/init-admin \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin","name":"管理员"}'
```

### 2. 登录

```bash
curl -X POST https://your-project.pages.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'
```

### 3. 健康检查

```bash
curl https://your-project.pages.dev/api/health
```

## 🎯 前端配置

您的前端代码已经使用相对路径调用 API（如 `/api/prescriptions`），这在 Pages 环境下会自动工作，无需修改！

## 📊 KV 数据结构

```
user_admin               - 管理员用户数据
user_doctor1             - 医生用户数据
prescription_admin_xxx   - admin 的处方数据
prescription_doctor1_xxx - doctor1 的处方数据
```

## 🔧 故障排查

### Q: Functions 返回 404？
确保 Functions 目录结构正确，文件名和路径完全匹配。

### Q: KV 绑定错误？
检查 Pages 项目设置中 KV namespace 是否正确绑定，变量名必须是 `KV`。

### Q: 本地开发测试？
使用 `wrangler pages dev .` 在本地启动预览服务器。

## 🆓 免费额度

- **Pages Functions**: 每天 100,000 次调用
- **KV Storage**: 每天 100,000 次读写
- **带宽**: 每月 10GB
- **静态文件**: 无限

完全满足个人或小团队使用！
