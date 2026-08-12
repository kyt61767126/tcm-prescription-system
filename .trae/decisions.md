# 技术决策记录 (ADR)
> Architecture Decision Records - 记录关键技术决策的上下文、选择和后果
> 最后更新：2026-08-12

---

## ADR-001: 全局变量通过 window 对象访问

**日期**：2026-08-12
**状态**：已采纳

### 背景
项目中多个 `cloud-api.js` 文件和 HTML 内联脚本需要共享 `_cloudReachable` 和 `updateModeStatus` 变量。最初使用 `let` 声明，在某些加载顺序下触发 TDZ（Temporal Dead Zone）错误，导致 `_cloudReachable is not defined`。

### 决策
所有跨脚本共享的全局变量统一通过 `window` 对象访问。

```javascript
// 初始化
if (typeof window._cloudReachable === 'undefined') {
    window._cloudReachable = null;
}
if (typeof window.updateModeStatus !== 'function') {
    window.updateModeStatus = function() { /* no-op */ };
}

// 使用
if (window._cloudReachable !== true) { window._cloudReachable = true; }
window.updateModeStatus();
```

### 后果
- ✅ 优点：消除 TDZ 问题，作用域明确，调试方便
- ❌ 缺点：需要逐文件修改，所有引用点都要加 `window.` 前缀
- ⚠️ 注意：所有 `cloud-api.js` 文件和 `site-admin/index.html` 内联脚本必须保持一致

---

## ADR-002: 日期处理使用 toLocaleDateString('sv-SE')

**日期**：2026-08-09
**状态**：已采纳

### 背景
项目中大量使用 `new Date().toISOString().split('T')[0]` 获取"当天日期"。`toISOString()` 返回 UTC 时间，在 UTC+8 时区的 00:00-07:59 之间会返回前一天的日期。

### 决策
统一使用 `new Date().toLocaleDateString('sv-SE')`。

**理由**：
- `sv-SE` locale 恰好返回 ISO 格式 `YYYY-MM-DD`
- 使用浏览器本地时区
- 无需额外库

### 影响
- 7个文件 × 每文件8处需要替换
- 云端网页版推送即生效，桌面版需重新打包

---

## ADR-003: 密码加密采用 PBKDF2 + SHA-256 + 明文兼容

**日期**：2026-08-08
**状态**：已采纳

### 背景
旧版本使用 SHA-256 明文哈希验证密码，存在彩虹表攻击风险。

### 决策
1. 使用 PBKDF2 算法（10000次迭代 + SHA-256）
2. 旧密码格式自动升级
3. 向后兼容明文密码

### 实现
```javascript
async function verifyPassword(password, stored) {
    // 尝试 PBKDF2
    if (stored.startsWith('pbkdf2:')) { ... }
    // 尝试 SHA-256
    else if (stored.startsWith('sha256:')) { ... }
    // 明文兼容
    else { ... }
}
```

---

## ADR-004: 云端API统一通过 cloudFetch() 封装

**日期**：2026-08-08
**状态**：已采纳

### 背景
多个模块直接使用 `fetch()` 调用云端 API，导致认证、超时、错误处理逻辑分散。

### 决策
所有云端请求必须通过 `cloudFetch()` 函数：
- 自动附加认证头
- 统一超时处理（30秒）
- 云端可达性检测
- 离线缓存降级

```javascript
// ✅ 正确
cloudFetch('/api/prescription', { method: 'POST', body: data });

// ❌ 禁止
fetch('/api/prescription', { method: 'POST', body: data });
```

---

## ADR-005: 版本标识8处联动检查

**日期**：2026-08-09
**状态**：已采纳

### 背景
修改版本文本时经常遗漏位置，导致打包后版本显示错误。

### 决策
建立8处检查清单，每次修改版本相关文本后必须全量验证：

| # | 位置 | 文件 |
|---|------|------|
| 1 | 登录页 version-tag | index.html |
| 2 | 顶部 tab-hint | index.html |
| 3 | JS IIFE textContent | index.html |
| 4 | console.log | index.html |
| 5 | showHelp() alert | index.html |
| 6 | exportInfo.version | index.html |
| 7 | 登录框 version-tag | electron/login.html |
| 8 | HTML `<title>` | index.html |

---

## ADR-006: 多版本同步策略

**日期**：2026-08-08
**状态**：已采纳

### 背景
项目有4个桌面版 + 3个网页/APP版，同一功能需要在多个副本中同步修改。

### 决策
- **共享模块**：`cloud-api.js` 等核心模块在 `shared/` 和 `public/` 维护主版本
- **同步清单**：每次修改前列出所有需要同步的文件
- **验证方法**：修改后用 Grep 全量验证一致性

### 各版本目录
```
db-yunduan/
├── cloud_desktop/          # YJ 云端机构版
├── cloud_desktop_geren/    # YB 云端标准版
├── cloud_app/              # YJ APP版
└── cloud_app_geren/        # YB APP版
db-offline/
├── desktop/                # LJ 离线机构版
├── desktop_geren/          # LB 离线标准版
├── app/                    # LJ APP版
└── app_geren/              # LB APP版
```

---

## ADR-007: 激活流程 requestId 持久化

**日期**：2026-08-10
**状态**：已采纳

### 背景
管理员审核通过时，如果客户端已关闭激活窗口，无法获取license。

### 决策
`requestId` 持久化到 `admin-request-id.dat`，启动时自动恢复轮询。

### 状态恢复逻辑
```javascript
function autoRestoreAdminRequest() {
    const requestId = loadAdminRequestId();
    if (!requestId) return;

    // 检查状态
    switch (status) {
        case 'activated': // 自动获取license并重启
        case 'pending':   // 恢复轮询
        case 'rejected': // 提示拒绝原因
        default:          // 清除本地记录
    }
}
```

---

## ADR-008: 部署到 Cloudflare Pages

**日期**：2026-08-08
**状态**：已采纳

### 背景
云端网页版需要稳定的托管服务。

### 决策
使用 Cloudflare Pages 部署，通过 GitHub Actions 自动构建。

### 关键配置
- `pages_build_output_dir` = `public`（在 wrangler.toml 中配置）
- 修改 `site-admin/` 下的文件必须同步到 `public/` 对应路径
- 认证密钥存储在 Cloudflare 环境变量中

---

## ADR-009: APP版cloud-api.js必须包含防御性初始化

**日期**：2026-08-12
**状态**：已采纳

### 背景
APP版 `cloud-api.js` 从桌面版模板复制时，遗漏了 `typeof window._cloudReachable` / `typeof window.updateModeStatus` 防御性初始化代码块。当 APP 环境中 `window.updateModeStatus` 未定义时，`cloudFetch()` 会抛出 `TypeError`。

### 决策
所有版本（桌面版+APP版）的 `cloud-api.js` 必须在文件头部包含防御性初始化：
```javascript
if (typeof window._cloudReachable === 'undefined') {
    window._cloudReachable = null;
}
if (typeof window.updateModeStatus !== 'function') {
    window.updateModeStatus = function() { /* no-op */ };
}
```

### 检查方法
```bash
# 验证所有APP版是否包含防御性初始化
Grep 'typeof window._cloudReachable' in 4 APP cloud-api.js copies
```

### 后果
- ✅ 优点：APP环境下独立运行不会因全局变量缺失而崩溃
- ❌ 缺点：需要在每次同步时检查4个APP副本
- ⚠️ 注意：APP构建产物在 `.gitignore` 中，需手动维护

---

## ADR-010: AI 模型调度规则

**日期**：2026-08-12
**状态**：已采纳

### 背景
项目需要明确不同场景下应使用的 AI 模型，确保方案质量和代码实现的可靠性。不同模型在方案生成、代码实现、审查等方面各有优势，需要建立明确的调度规则。

### 决策

| 场景 | 指定模型 |
|------|---------|
| 业务方案、链路梳理、需求拆解、代码审查、风险评估 | `Seed-2.1-Pro`（强制） |
| 方案确认后简单代码实现、普通bug修复 | `Seed-Code` |
| 复杂后端接口、登录激活链路 | `DeepSeek-V4-Flash` |
| 深层疑难bug、跨大量文件大规模重构 | `DeepSeek-V4-Pro` |
| 批量扫描项目提取问题 | `Seed-2.1-Turbo`（仅扫描） |

### 限制规则
- `GLM` 系列、`Kimi` 系列：仅特殊场景使用
- `Seed-2.1-Turbo`：禁止用于正式方案输出、审查

### 工作流强制
1. 方案阶段强制使用 `Seed-2.1-Pro`
2. 实现阶段按规则选择模型
3. **每轮修改完成必须切回 `Seed-2.1-Pro` 审查**
4. 审查通过后才能提交

### 后果
- ✅ 优点：确保方案质量，避免 Auto Mode 切换导致的模型不稳定
- ❌ 缺点：需要手动切换模型，增加操作步骤
- ⚠️ 注意：`Seed-2.1-Pro` 作为最终审查模型，是硬性要求
