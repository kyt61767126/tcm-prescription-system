# 🧑‍⚕️ 中医处方系统 - Cloudflare 免费架构

## 🏗️ 项目架构

```
┌─────────────────────────────────────────────────────────────┐
│                    前端页面 (Cloudflare Pages)               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              index.html (单页应用)                  │   │
│  │  - 处方开具界面                                     │   │
│  │  - 处方历史展示                                     │   │
│  │  - 处方打印功能                                     │   │
│  │  - 药品库管理                                       │   │
│  │  - 用户登录/注册                                    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  API 接口 (Pages Functions)                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  functions/api/auth/login.js       # 用户登录       │   │
│  │  functions/api/auth/init-admin.js  # 初始化管理员   │   │
│  │  functions/api/prescriptions/      # 处方 CRUD      │   │
│  │  functions/api/sync.js             # 数据同步       │   │
│  │  functions/api/health.js           # 健康检查       │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    云端存储 (Cloudflare KV)                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  tcm-prescription-kv                               │   │
│  │  ├── user_admin              # 管理员用户数据     │   │
│  │  ├── prescription_admin_xxx  # 处方记录           │   │
│  │  └── ...                     # 更多数据           │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## 📁 项目文件结构

```
tcm-prescription-system/
├── index.html                    # 前端单页应用
├── DEPLOY_PAGES.md               # Pages 部署指南
├── functions/                    # Cloudflare Pages Functions
│   ├── _utils.js                 # 共享工具函数
│   └── api/
│       ├── health.js             # /api/health
│       ├── sync.js               # /api/sync (数据同步)
│       └── auth/
│           ├── login.js          # /api/auth/login
│           └── init-admin.js     # /api/auth/init-admin
│       └── prescriptions/
│           ├── index.js          # /api/prescriptions (GET/POST)
│           └── [id].js           # /api/prescriptions/:id (GET/PUT/DELETE)
├── server/                       # 本地开发服务器 (可选)
└── worker/                       # Cloudflare Workers (可选)
```

## 🔌 API 接口列表

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/auth/login` | POST | 用户登录 |
| `/api/auth/init-admin` | POST | 初始化管理员 |
| `/api/prescriptions` | GET | 获取处方列表 |
| `/api/prescriptions` | POST | 创建处方 |
| `/api/prescriptions/:id` | GET | 获取单个处方 |
| `/api/prescriptions/:id` | PUT | 更新处方 |
| `/api/prescriptions/:id` | DELETE | 删除处方 |
| `/api/sync` | POST | 数据同步 (upload/download/sync) |

## ⚡ 数据同步流程

```
用户登录 → 自动触发同步 → 双向同步本地与云端数据
         ↓
创建/修改处方 → 自动上传到云端 → 多设备实时同步
```

## 🚀 一键部署到 Cloudflare Pages

### 前提条件
1. 在 Cloudflare Dashboard 创建 KV Namespace: `tcm-prescription-kv`
2. 获取 KV Namespace ID

### 部署步骤

1. **连接仓库到 Cloudflare Pages**
   - 登录 Cloudflare Dashboard → Pages → Create a project
   - 选择您的 GitHub/GitLab 仓库

2. **配置项目设置**
   - Build command: 留空（纯静态页面）
   - Build output directory: `/`
   - Root directory: `/`

3. **配置 KV Binding**
   - Settings → Functions → KV namespace bindings
   - Add binding:
     - Variable name: `KV`
     - KV namespace: 选择 `tcm-prescription-kv`

4. **添加环境变量**
   - Settings → Environment variables
   - Add variable: `JWT_SECRET` = `your-secret-key-here`

5. **部署**
   - 点击 "Save and Deploy"
   - 等待部署完成

## 🆓 免费额度说明

| 服务 | 免费额度 |
|------|----------|
| Pages 访问次数 | 每天 100,000 次 |
| Pages Functions | 每天 100,000 次调用 |
| KV 读写 | 每天 100,000 次 |
| 带宽 | 每月 10GB |
| 存储 | 1GB |

**完全满足诊所日常使用需求！**

## 📱 访问地址

部署成功后，您的网站地址类似：
```
https://xxx.tcm-prescription-system.pages.dev
```

**默认管理员账户：**
- 用户名：`admin`
- 密码：`admin`

## 🔄 数据同步原理

1. **登录时自动同步**：用户登录后，系统自动对比本地和云端数据
2. **智能合并**：根据 `updatedAt` 时间戳判断哪个版本更新
3. **双向同步**：本地新增的上传到云端，云端新增的下载到本地
4. **永久存储**：数据存储在 Cloudflare KV，跨设备访问保持一致

## ✅ 功能特性

- ✅ 处方开具与打印
- ✅ 药品库管理
- ✅ 处方历史记录
- ✅ 用户登录认证
- ✅ 跨设备数据同步
- ✅ 响应式设计（支持手机/平板/电脑）
- ✅ 全球 CDN 加速

---

**🎉 您的中医处方系统已经可以部署到 Cloudflare 了！**

只需在 Cloudflare Dashboard 完成 KV Binding 配置，然后重新部署即可享受完整的云端同步功能！
