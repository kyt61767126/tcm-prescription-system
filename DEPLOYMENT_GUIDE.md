# 中医处方系统 - 完整部署指南

## 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         前端 (Cloudflare Pages)                 │
│                   https://tcm-prescription-system.pages.dev/    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    index.html                               │ │
│  │  - 用户界面                                                  │ │
│  │  - 表单处理                                                  │ │
│  │  - 数据展示                                                  │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              ↕
                              ↕ HTTP/HTTPS API
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                       后端 (Vercel/Render)                      │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    Express.js API                           │ │
│  │  - 用户认证 (JWT)                                           │ │
│  │  - 数据 CRUD 操作                                           │ │
│  │  - 业务逻辑处理                                              │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              ↕
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      数据库 (MongoDB Atlas)                      │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  - Users (用户账户)                                         │ │
│  │  - Prescriptions (处方历史)                                 │ │
│  │  - Settings (用户设置)                                     │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## 一、云端数据库配置 (MongoDB Atlas)

### 1.1 注册 MongoDB Atlas

1. 访问 [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. 使用邮箱注册账户（推荐使用 Google 账户）
3. 完成邮箱验证

### 1.2 创建免费集群

1. 点击 **Build a Database**
2. 选择 **FREE**  tier
3. 选择区域：**Singapore** 或 **Tokyo**（距离中国近，速度快）
4. 点击 **Create**

等待 1-3 分钟，集群创建完成。

### 1.3 配置数据库用户

1. 进入 **Security** → **Database Access**
2. 点击 **Add New Database User**
3. 配置：
   - Authentication Method: **Password**
   - Username: `tcm-admin`（自定义）
   - Password: 强密码（至少12位，包含字母和数字）
   - Database Privileges: **Read and write to any database**
4. 点击 **Add User**

### 1.4 配置网络访问

1. 进入 **Security** → **Network Access**
2. 点击 **Add IP Address**
3. 选择 **Allow Access from Anywhere (0.0.0.0/0)**
4. 点击 **Confirm**

### 1.5 获取连接字符串

1. 点击 **Database** → **Connect**
2. 选择 **Connect your application**
3. 复制连接字符串，类似：
   ```
   mongodb+srv://<username>:<password>@cluster.mongodb.net/tcm-prescription?retryWrites=true&w=majority
   ```
4. 替换 `<username>` 和 `<password>` 为第 1.3 步创建的用户信息

### 1.6 测试连接

打开 `server/mongodb-setup.html` 文件，在浏览器中运行，按照向导测试连接。

## 二、后端服务器部署

### 2.1 本地测试（可选）

1. 安装 Node.js（版本 >= 16）
2. 复制配置：
   ```bash
   cd server
   cp .env.example .env
   ```

3. 编辑 `.env` 文件：
   ```env
   MONGODB_URI=mongodb+srv://your-username:your-password@cluster.mongodb.net/tcm-prescription
   JWT_SECRET=your-secret-key-here
   PORT=3000
   ```

4. 安装依赖：
   ```bash
   npm install
   ```

5. 启动服务器：
   ```bash
   npm start
   ```

6. 测试 API：
   ```bash
   curl http://localhost:3000/api/health
   ```

### 2.2 部署到 Vercel（推荐）

#### 方式一：使用 Vercel CLI

1. 安装 Vercel CLI：
   ```bash
   npm install -g vercel
   ```

2. 登录：
   ```bash
   vercel login
   ```

3. 部署：
   ```bash
   cd server
   vercel
   ```

4. 按照提示配置：
   - Set up and deploy? **Yes**
   - Which scope? 选择你的账户
   - Link to existing project? **No**
   - Project name: `tcm-prescription-api`
   - Directory: `./`
   - Override settings? **No**

5. 配置环境变量：
   - 进入 Vercel Dashboard
   - 选择你的项目 → **Settings** → **Environment Variables**
   - 添加：
     - `MONGODB_URI`: 你的 MongoDB 连接字符串
     - `JWT_SECRET`: 你的 JWT 密钥
   - 点击 **Save**
   - 重新部署

6. 记录 API 地址，例如：`https://tcm-prescription-api.vercel.app`

#### 方式二：使用 GitHub 部署

1. 将 `server` 目录推送到 GitHub
2. 登录 [Vercel](https://vercel.com)
3. 点击 **New Project**
4. 导入你的 GitHub 仓库
5. 配置：
   - Framework Preset: **Node.js**
   - Root Directory: `./server`
   - Build Command: `npm install && npm start`
6. 添加环境变量（同上）
7. 点击 **Deploy**

### 2.3 部署到 Railway（备选）

1. 访问 [Railway](https://railway.app)
2. 使用 GitHub 登录
3. 点击 **New Project** → **Deploy from GitHub repo**
4. 选择仓库和 `server` 目录
5. Railway 会自动检测 Node.js 并部署
6. 添加环境变量（同上）
7. 记录 API 地址

### 2.4 部署到 Render

1. 访问 [Render](https://render.com)
2. 使用 GitHub 登录
3. 点击 **New** → **Web Service**
4. 导入仓库，选择 `server` 目录
5. 配置：
   - Environment: **Node**
   - Build Command: `npm install`
   - Start Command: `npm start`
6. 添加环境变量（同上）
7. 点击 **Create Web Service**

## 三、前端配置

### 3.1 修改 API 地址

编辑 `index.html` 文件，找到 API 配置部分：

```javascript
// API 配置
const API_BASE_URL = 'https://your-api-url.vercel.app'; // 替换为你的后端地址
```

### 3.2 配置跨域支持

后端已配置 CORS，如果需要修改：

编辑 `server/server.js`：

```javascript
app.use(cors({
    origin: ['https://tcm-prescription-system.pages.dev'],
    credentials: true
}));
```

## 四、数据迁移（可选）

如果已有本地数据，需要迁移到云端：

### 4.1 导出本地数据

1. 打开本地处方系统
2. 进入 **数据管理** → **导出数据**
3. 导出为 JSON 文件

### 4.2 导入到云端

由于当前系统使用 localStorage，需要手动迁移：

1. 打开浏览器开发者工具（F12）
2. 在控制台执行：
   ```javascript
   // 导出数据
   const data = {
       prescriptionHistory: JSON.parse(localStorage.getItem('cloud_user_YOUR_USERNAME_prescriptionHistory') || '[]'),
       settings: JSON.parse(localStorage.getItem('cloud_user_YOUR_USERNAME_settings') || '{}')
   };
   console.log(JSON.stringify(data, null, 2));
   ```

3. 复制输出内容
4. 在云端系统中导入

## 五、功能测试

### 5.1 测试用户注册

```bash
curl -X POST https://your-api-url.vercel.app/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"test123456","name":"测试用户"}'
```

### 5.2 测试用户登录

```bash
curl -X POST https://your-api-url.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"test123456"}'
```

### 5.3 测试处方保存

```bash
curl -X POST https://your-api-url.vercel.app/api/prescriptions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{"patientName":"张三","patientAge":"35","medicines":[]}'
```

### 5.4 浏览器测试

1. 打开前端系统
2. 注册/登录账户
3. 创建一条处方
4. 在另一个设备或浏览器中登录同一账户
5. 验证数据是否同步

## 六、费用说明

### 6.1 完全免费套餐

| 服务 | 费用 | 配额 |
|------|------|------|
| MongoDB Atlas | ✅ 免费 | 512MB 存储，共享 RAM |
| Vercel | ✅ 免费 | 100GB 带宽/月 |
| Railway | ✅ 免费 | 500MB 内存，有限运行时 |
| Cloudflare Pages | ✅ 免费 | 无限带宽，无限请求 |

### 6.2 什么时候需要付费

- MongoDB Atlas：存储超过 512MB
- Vercel：带宽超过 100GB/月
- Railway：需要更多内存或持久运行时

### 6.3 个人使用建议

对于个人或小团队使用，以上免费配额完全足够！

## 七、安全建议

### 7.1 生产环境必做

1. ✅ 使用强密码（JWT_SECRET 至少 32 位）
2. ✅ 限制 CORS 源（只允许你的前端域名）
3. ✅ 启用 MongoDB Atlas Network Peering
4. ✅ 定期备份数据库
5. ✅ 监控 API 调用量和错误率

### 7.2 JWT 密钥生成

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

## 八、故障排查

### 8.1 常见问题

**Q: MongoDB 连接失败**
- 检查连接字符串格式是否正确
- 确认用户名和密码正确
- 检查 IP 白名单是否配置
- 确认集群状态为 "Available"

**Q: API 返回 401 未授权**
- 检查 JWT token 是否正确传递
- 确认 token 未过期（默认 30 天）
- 检查 Authorization header 格式：`Bearer <token>`

**Q: CORS 错误**
- 确认后端 CORS 配置包含前端域名
- 检查浏览器控制台的完整错误信息

**Q: Vercel 部署失败**
- 检查环境变量是否正确配置
- 查看 Vercel 构建日志
- 确认 package.json 的 start 脚本正确

### 8.2 日志查看

- Vercel: Dashboard → Your Project → Logs
- Railway: Project → Deployments → View Logs
- Render: Services → Your Service → Logs

## 九、联系与支持

如果遇到问题，可以：
1. 查看 [MongoDB Atlas 文档](https://docs.atlas.mongodb.com/)
2. 查看 [Vercel 文档](https://vercel.com/docs)
3. 查看 [Node.js Express 文档](https://expressjs.com/)

---

**祝你部署成功！🎉**
