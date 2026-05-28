# Cloudflare Workers 部署指南

## 前置要求

1. 已安装 Node.js (v16 或更高版本)
2. 已安装 Wrangler CLI: `npm install -g wrangler`
3. 已登录 Cloudflare 账户: `wrangler login`

## 部署步骤

### 1. 创建 KV Namespace（如果还没有）

在 Cloudflare Dashboard 中创建 KV Namespace，获取 Namespace ID。

### 2. 配置 wrangler.toml

编辑 `worker/wrangler.toml` 文件：

```toml
name = "tcm-prescription-api"
main = "src/index.js"
compatibility_date = "2024-01-01"

kv_namespaces = [
  { binding = "KV", id = "你的KV_NAMESPACE_ID" }
]

[vars]
JWT_SECRET = "你的JWT密钥（建议32位随机字符串）"
```

### 3. 部署到 Cloudflare Workers

```bash
cd worker
wrangler deploy
```

### 4. 获取 API 地址

部署成功后，Wrangler 会显示你的 Worker URL，格式类似：
```
https://tcm-prescription-api.your-subdomain.workers.dev
```

### 5. 配置前端

如果你的前端部署在 Cloudflare Pages，需要：

1. 在 Cloudflare Pages 设置中，添加环境变量：
   - `API_BASE_URL`: 你的 Worker URL（不带末尾斜杠）

2. 或者在部署前端后，在代码中更新 API 调用地址

### 6. 测试 API

```bash
# 健康检查
curl https://your-worker-url.workers.dev/api/health

# 初始化管理员
curl -X POST https://your-worker-url.workers.dev/api/auth/init-admin \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin","name":"管理员"}'

# 登录测试
curl -X POST https://your-worker-url.workers.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'
```

## 常见问题

### Q: Wrangler login 失败？
确保你的网络可以访问 Cloudflare，并且浏览器已登录 Cloudflare 账户。

### Q: KV Namespace ID 在哪里找？
在 Cloudflare Dashboard → Workers & Pages → KV → 找到你的 Namespace → 点击进入，URL 中包含 ID。

### Q: 如何查看部署日志？
```bash
wrangler tail
```

### Q: 如何更新已部署的 Worker？
```bash
cd worker
wrangler deploy
```

## 免费额度说明

- **Workers**: 每天 100,000 请求免费
- **KV Storage**: 每天 100,000 次读写免费
- **带宽**: 每月 10GB 免费

对于个人或小团队使用，这些额度完全足够！
