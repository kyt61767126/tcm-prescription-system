# 安全政策 / Security Policy

## 报告安全漏洞

如果您发现本项目的安全漏洞，请**不要**在公开 Issue 中提交。请通过以下方式私密报告：

1. **GitHub 私密安全报告**（推荐）：前往仓库 Security 标签页 → "Report a vulnerability"
2. **邮件报告**：发送漏洞详情至项目负责人邮箱

报告时请包含：
- 漏洞类型（如 XSS、SQL注入、认证绕过、信息泄露等）
- 影响范围（云端/离线、桌面/APP/网页、标准版/机构版）
- 复现步骤
- 影响评估
- 建议修复方案（可选）

## 响应时间

- **确认收到**：24 小时内
- **初步评估**：72 小时内
- **修复发布**：根据严重程度，7-30 天内
- **公开披露**：修复发布后 90 天，或与报告者协商一致后

## 安全机制概览

本项目已部署多层安全防护：

### 认证与授权
- PBKDF2-SHA256 密码哈希（100000 iterations，含 salt）
- HMAC-SHA256 无状态 Token（7天 TTL，支持黑名单撤销）
- 三级角色体系：platform_admin / clinic_admin / doctor
- Bearer Token 认证（已移除不安全的 Basic auth）
- 登录失败锁定（5次失败锁定15分钟）
- IP 限流（10次/分钟）
- Token 黑名单（登出/改密时撤销）

### 数据安全
- HTTPS 强制（HSTS + preload）
- CSP 内容安全策略
- CORS 白名单
- 敏感操作审计日志
- KV 存储双重鉴权（Token + 环境变量密钥）

### 客户端防护
- 安卓 Frida/Xposed/Magisk 检测
- 桌面 DevTools 反调试
- APK v3 签名
- 代码混淆（obfuscate.js）
- 完整性校验

## 安全配置清单（部署时必须配置）

### Cloudflare Pages 环境变量
- `AUTH_SECRET`：Token 签名密钥（32+ 字符随机字符串）
- `LICENSE_MASTER_KEY`：License 派生密钥（32+ 字符随机字符串）
- `BACKUP_SECRET`：KV 备份/恢复密钥（32+ 字符随机字符串）
- `AUTH_TOKEN_TTL_HOURS`：Token TTL（默认 168 小时）

### GitHub 仓库设置（建议在网页端启用）
- Settings → Security & analysis → Enable: Dependabot alerts + Code scanning
- Settings → Branches → Branch protection rules: Require status checks (CodeQL + Code Quality)
- Settings → General → Pull Requests: Limit merge permissions

## 支持的版本

| 版本 | 支持状态 |
|------|---------|
| V1.0.0（最新） | ✅ 安全更新支持 |
| V1.0.0 以下 | ❌ 不再支持 |
