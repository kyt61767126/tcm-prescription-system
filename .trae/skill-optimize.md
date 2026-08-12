# Skill 优化与工作流
> 基于项目历史踩坑总结的 AI 辅助编码最佳实践
> 最后更新：2026-08-12

---

## 一、标准工作流（每次任务必须遵循）

### 1.0 模型调度规则（参见 project_rules.md 第四章）

```
方案/评估 → Seed-2.1-Pro
简单实现 → Seed-Code
复杂后端 → DeepSeek-V4-Flash
大规模重构 → DeepSeek-V4-Pro
批量扫描 → Seed-2.1-Turbo
修改完成 → 必须用 Seed-2.1-Pro 审查
```

### 1.1 任务执行六步法

```
┌─────────────────────────────────────────────────────────────┐
│ Step 1: 信息收集                                             │
│ • 读取 .trae/ 下的 project_rules.md、history_bug_summary.md  │
│ • 搜索相关代码和文件                                         │
│ • 检查 git status 了解当前状态                               │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Step 2: 影响面分析                                           │
│ • 确定涉及的版本（LJ/LB/YJ/YB + WEB）                        │
│ • 确定涉及的文件数                                           │
│ • 列出需要同步的文件清单                                     │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Step 3: 实施修改                                             │
│ • 使用 Edit 工具（优先于 Write）                             │
│ • 单文件单次修改，避免并行修改导致静默失败                    │
│ • 修改前先 Read 获取最新内容                                 │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Step 4: 验证 + 模型审查                                      │
│ • Grep 验证修改生效                                          │
│ • 检查裸引用残留                                             │
│ • 检查跨文件同步一致性                                       │
│ • ★ 必须切回 Seed-2.1-Pro 做独立代码审查                     │
│ • 审查通过才能进入 Step 5                                    │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Step 5: 提交与推送                                           │
│ • git diff --stat 确认修改范围                               │
│ • git commit -m "type: description"                         │
│ • git push origin main --rebase                             │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Step 6: 沉淀                                                 │
│ • 新踩坑追加到 history_bug_summary.md                       │
│ • 新决策追加到 decisions.md                                 │
│ • 更新 project_rules.md 中的相关规范                        │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 验证命令速查

```bash
# 检查裸变量引用（非 window. 前缀）
Grep pattern: [^.]_cloudReachable
Grep pattern: [^.]updateModeStatus

# 检查日期处理
Grep pattern: toISOString().split|toISOString().slice

# 检查版本标识
Grep pattern: 标准版|机构版 (在 index.html 和 login.html 中)

# 检查 config.json 路径
Grep pattern: getExeDirectory.*config

# 检查 window. 防御性初始化
Grep pattern: typeof window._cloudReachable
```

---

## 二、多版本同步矩阵

### 2.1 cloud-api.js 同步清单（10个文件）

| # | 文件路径 | 版本 |
|---|---------|------|
| 1 | `public/cloud-api.js` | 主版本 |
| 2 | `public/electron/cloud-api.js` | 桌面版公共 |
| 3 | `shared/cloud-api.js` | 共享 |
| 4 | `site-admin/cloud-api.js` | 管理后台 |
| 5 | `app_project/db-yunduan/cloud_desktop/cloud-api.js` | YJ |
| 6 | `app_project/db-yunduan/cloud_desktop_geren/cloud-api.js` | YB |
| 7 | `app_project/db-yunduan/cloud_app/app/src/main/assets/public/cloud-api.js` | YJ APP |
| 8 | `app_project/db-yunduan/cloud_app_geren/app/src/main/assets/public/cloud-api.js` | YB APP |
| 9 | `app_project/db-offline/app/app/src/main/assets/public/cloud-api.js` | LJ APP |
| 10 | `app_project/db-offline/app_geren/app/app/src/main/assets/public/cloud-api.js` | LB APP |

### 2.2 版本标识检查清单（8处）

每个桌面版修改版本相关文本后，必须 Grep 验证：

```bash
# 版本类型文本（替换为实际版本名）
Grep "【标准版】" OR "【机构版】" in:
  - index.html (6处: version-tag, tab-hint, textContent, console.log, alert, exportInfo)
  - electron/login.html (1处: version-tag)
  - <title> 标签 (index.html)
```

---

## 三、常见错误模式与应对

### 3.1 TDZ（暂时性死区）

**错误模式**：`let`/`const` 变量在声明前被访问

**应对**：
```javascript
// ❌ 错误
function cloudFetch() {
    if (_cloudReachable) { ... }  // TDZ: ReferenceError
}
let _cloudReachable = null;

// ✅ 正确
if (typeof window._cloudReachable === 'undefined') {
    window._cloudReachable = null;
}
function cloudFetch() {
    if (window._cloudReachable) { ... }
}
```

### 3.2 并行 Edit 静默失败

**错误模式**：同时 Edit 同一文件的多个位置，部分操作失败但无报错

**应对**：
- 串行执行 Edit，每次一个 Edit 操作
- Edit 后立即 Grep 验证
- 避免同一文件超过 3 次并行 Edit

### 3.3 多版本修改不完整

**错误模式**：只修改了一个版本，其他版本遗漏

**应对**：
- 先列出版本矩阵：4桌面版 × 2APP版 × 1网页版
- 逐个版本修改，修改后打勾
- 最终 Grep 全量验证一致性

### 3.4 日期时区问题

**错误模式**：UTC 时间 vs 本地时区混淆

**应对**：
- 前端显示：`toLocaleDateString('sv-SE')`
- 传输/存储：`toISOString()`（明确 UTC）
- 禁止用 `toISOString()` 做本地日期显示

### 3.5 路径不一致

**错误模式**：`getExeDirectory()` vs `getWritableDir()` 混用

**应对**：
- 只读资源：`getExeDirectory()`（exe 目录）
- 写入数据：`getWritableDir()`（用户数据目录）
- 状态文件（config.json, license.dat）始终用 `getWritableDir()`

---

## 四、优化检查清单（每次迭代完成后）

### 4.0 模型调度检查（强制性）
- [ ] 方案阶段使用 `Seed-2.1-Pro`
- [ ] 实现阶段按规则选择模型
- [ ] ★ 修改完成后用 `Seed-2.1-Pro` 做独立审查
- [ ] `GLM`/`Kimi` 系列未被用于主流程
- [ ] `Seed-2.1-Turbo` 仅用于扫描

### 4.1 代码质量
- [ ] 所有跨脚本变量通过 `window` 对象访问
- [ ] 无裸 `_cloudReachable` / `updateModeStatus` 引用
- [ ] 日期处理使用 `toLocaleDateString`
- [ ] 密码处理使用 `AuthCore` 模块
- [ ] 云端请求通过 `cloudFetch` 封装

### 4.2 版本一致性
- [ ] 版本标识8处全量验证
- [ ] `config.json` 路径统一
- [ ] 诊所名/医师名跨版本一致
- [ ] `cloud-api.js` 10个文件同步

### 4.3 功能完整性
- [ ] 激活流程端到端验证
- [ ] 注册向导流程完整
- [ ] 登录流程（云端/离线）正常
- [ ] 权限校验逻辑正确

### 4.4 文档沉淀
- [ ] 新踩坑追加到 `history_bug_summary.md`
- [ ] 新决策追加到 `decisions.md`
- [ ] 更新 `project_rules.md` 相关规范
- [ ] 更新本文件的检查清单

---

## 五、工具使用最佳实践

### 5.1 Read 工具
- 始终在 Edit 之前 Read，获取最新内容
- 大文件分段 Read，offset+limit 定位
- 关注关键行号和上下文

### 5.2 Grep 工具
- 修改后验证效果的首选工具
- 支持 regex、glob、path 过滤
- `-n` 参数显示行号便于定位

### 5.3 Edit 工具
- 优先使用 Edit 而非 Write（保留文件其他内容）
- `old_string` 必须精确匹配
- 单文件串行修改，避免并行

### 5.4 RunCommand 工具
- Git 操作的主要工具
- PowerShell 语法：分号分隔多条命令
- 批量文件操作使用 PowerShell 脚本

---

## 六、迭代优化规则

### 6.1 每次完成任务后
1. **自动沉淀**：新发现的坑追加到 `history_bug_summary.md`
2. **规则更新**：新的决策和规范更新到 `decisions.md` 和 `project_rules.md`
3. **清单更新**：更新本文件的检查清单

### 6.2 新一轮优化开始时
1. **读取历史**：先读取 `.trae/` 下所有文档
2. **检查状态**：确认当前代码状态和规范一致
3. **规划范围**：明确修改涉及的版本和文件

### 6.3 版本迭代时
1. 新增版本时，复制规范检查清单
2. 更新多版本同步矩阵
3. 按8处标识清单验证新版本
