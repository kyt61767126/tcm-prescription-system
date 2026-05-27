# 中医处方系统后端 API

基于 Node.js + Express + MongoDB 的后端服务器。

## 功能特性

- ✅ 用户认证（注册、登录、JWT令牌）
- ✅ 处方历史数据 CRUD 操作
- ✅ 用户设置数据管理
- ✅ 跨设备数据同步
- ✅ 数据隔离（用户只能访问自己的数据）

## 技术栈

- **运行时**: Node.js
- **框架**: Express.js
- **数据库**: MongoDB
- **认证**: JWT + bcryptjs
- **验证**: express-validator

## 快速开始

### 1. 安装依赖

```bash
cd server
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env`，并配置：

```env
MONGODB_URI=your-mongodb-connection-string
JWT_SECRET=your-secret-key
PORT=3000
```

### 3. 启动服务器

开发模式：
```bash
npm run dev
```

生产模式：
```bash
npm start
```

## API 端点

### 认证接口

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/auth/register` | 用户注册 |
| POST | `/api/auth/login` | 用户登录 |
| GET | `/api/auth/me` | 获取当前用户信息 |

### 处方接口

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/prescriptions` | 获取所有处方 |
| GET | `/api/prescriptions/:id` | 获取单个处方 |
| POST | `/api/prescriptions` | 创建处方 |
| PUT | `/api/prescriptions/:id` | 更新处方 |
| DELETE | `/api/prescriptions/:id` | 删除处方 |

### 设置接口

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/settings` | 获取用户设置 |
| PUT | `/api/settings` | 更新用户设置 |

## 部署

### 使用 Vercel

1. 创建 Vercel 项目
2. 配置环境变量
3. 部署

### 使用 Render

1. 创建 Web Service
2. 配置环境变量
3. 部署

### 使用 Railway

1. 创建新项目
2. 添加 MongoDB 数据库
3. 部署

## 数据库

推荐使用 MongoDB Atlas 免费套餐：
- 512MB 存储空间
- 共享 RAM
- 100个连接

## 许可证

MIT
