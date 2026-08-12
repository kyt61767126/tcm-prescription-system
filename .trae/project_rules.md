# 项目规范与约束
> 惠康中医诊所管理系统（TCM Prescription System）
> 最后更新：2026-08-12

---

## 一、版本命名规范

### 1.1 版本类型
| 简码 | 版本名 | edition字段值 | 技术栈 |
|------|--------|-------------|--------|
| LJ | 离线机构版 | `clinic_custom` | Electron |
| LB | 离线标准版 | `personal` | Electron |
| YJ | 云端机构版 | `clinic_custom` | Electron + Cloudflare |
| YB | 云端标准版 | `personal` | Electron + Cloudflare |
| WEB-YJ | 云端机构版(网页) | `clinic_custom` | Pure Web |
| WEB-YB | 云端标准版(网页) | `personal` | Pure Web |

### 1.2 版本标识8处联动规则（强制性）
每个桌面版有 **8处** 版本标识，修改时必须全部验证：

| # | 位置 | 文件 | Grep关键词 |
|---|------|------|-----------|
| 1 | 登录页 version-tag | index.html | `class="version-tag"` |
| 2 | 顶部 tab-hint | index.html | `tab-hint` 内版本文本 |
| 3 | JS IIFE textContent | index.html | `tag.textContent` |
| 4 | console.log | index.html | `惠康中医` 版本 |
| 5 | showHelp() alert | index.html | `showHelp` 内版本 |
| 6 | exportInfo.version | index.html | `exportInfo` |
| 7 | 登录框 version-tag | electron/login.html | `class="version-tag"` |
| 8 | HTML `<title>` | index.html | `<title>`标签 |

**强制检查流程**：每次修改版本相关文本 → Grep验证全部8处 → 确认无误才能提交

---

## 二、目录结构规范

### 2.1 核心目录
```
kyt-zy/
├── public/                    # 云端网页版（site-admin部署源）
│   ├── index.html             # 主界面
│   ├── auth-core.js           # 认证核心
│   ├── cloud-api.js           # 云端API封装
│   └── ...
├── site-admin/                # 云端管理后台
│   ├── index.html             # 后台主界面
│   ├── admin/index.html       # 管理子页面
│   └── cloud-api.js
├── shared/                    # 共享模块
│   └── cloud-api.js
├── app_project/
│   ├── db-yunduan/            # 云端桌面+APP版本
│   │   ├── cloud_desktop/     # YJ 云端机构版
│   │   ├── cloud_desktop_geren/ # YB 云端标准版
│   │   ├── cloud_app/         # YJ APP版
│   │   └── cloud_app_geren/   # YB APP版
│   └── db-offline/            # 离线桌面+APP版本
│       ├── desktop/           # LJ 离线机构版
│       ├── desktop_geren/     # LB 离线标准版
│       ├── app/               # LJ APP版
│       └── app_geren/         # LB APP版
├── .trae/                     # Trae文档与规范
│   ├── documents/             # 设计文档
│   ├── project_rules.md       # ★本文件
│   ├── history_bug_summary.md # ★历史踩坑
│   ├── decisions.md           # ★技术决策
│   └── skill-optimize.md      # ★Skill优化
└── functions/                 # Cloudflare Functions
    └── api/
```

### 2.2 共享文件同步规则
- 云端版：`public/cloud-api.js` → 所有 `cloud-desktop*/cloud-api.js` 必须同步
- 认证模块：`auth-core.js` 在各版本目录均有独立副本，修改需同步所有版本
- 修改 `cloud-api.js` 时必须修改 **8个位置**：
  - `public/cloud-api.js`
  - `site-admin/cloud-api.js`
  - `shared/cloud-api.js`
  - `public/electron/cloud-api.js`
  - `app_project/db-yunduan/cloud_desktop/cloud-api.js`
  - `app_project/db-yunduan/cloud_desktop_geren/cloud-api.js`
  - `app_project/db-yunduan/cloud_app/app/src/main/assets/public/cloud-api.js`
  - `app_project/db-yunduan/cloud_app_geren/app/src/main/assets/public/cloud-api.js`
  - `app_project/db-offline/app/app/src/main/assets/public/cloud-api.js`
  - `app_project/db-offline/app_geren/app/app/src/main/assets/public/cloud-api.js`

---

## 三、编码规范

### 3.1 JavaScript 全局变量访问
**强制性**：所有跨脚本/跨模块的全局变量必须通过 `window` 对象访问。

```javascript
// ✅ 正确
window._cloudReachable = null;
if (window._cloudReachable !== true) { window._cloudReachable = true; }
window.updateModeStatus();

// ❌ 禁止（会导致 TDZ 和多作用域问题）
let _cloudReachable = null;
if (_cloudReachable !== true) { _cloudReachable = true; }
updateModeStatus();
```

### 3.2 日期处理
**强制性**：禁止使用 `toISOString()` 获取本地日期（UTC时区偏移问题）。

```javascript
// ✅ 正确（返回本地时区日期 YYYY-MM-DD）
const today = new Date().toLocaleDateString('sv-SE');

// ❌ 禁止（UTC+8时区00:00-07:59返回前一天）
const today = new Date().toISOString().split('T')[0];
```

### 3.3 密码加密
- 优先使用 `AuthCore.verifyPassword()` 支持 PBKDF2 + SHA-256 + 明文兼容
- 自动升级旧密码格式（SHA-256/明文 → PBKDF2）
- 加盐值：`bnzc_prescription_salt_v1`

### 3.4 构建脚本
- `.bat` 脚本中 `if ( ... ) else ( ... )` 复合语句内的 `echo` 语句，禁止使用未转义的英文括号 `( )`，必须用中文全角括号 `（ ）` 或 `^(` `^)` 转义

---

## 四、AI 模型调度规则（强制性）

### 4.1 模型选择优先级

| 场景 | 指定模型 | 说明 |
|------|---------|------|
| **业务方案、链路梳理、需求拆解、代码审查、风险评估** | `Seed-2.1-Pro` | 强制使用，禁止 Auto Mode 自动切换 |
| **方案确认后代码实现、普通bug修复** | `Seed-Code` | 简单修改 |
| **复杂后端接口、登录激活链路** | `DeepSeek-V4-Flash` | 正式版 |
| **深层疑难bug、跨大量文件大规模重构** | `DeepSeek-V4-Pro` | 高复杂度 |
| **批量扫描项目提取问题** | `Seed-2.1-Turbo` | 仅用于扫描，禁止正式方案输出/审查 |

### 4.2 限制使用模型

| 模型 | 限制 |
|------|------|
| `GLM` 系列 | 不作为业务流程优化主力，仅特殊场景使用 |
| `Kimi` 系列 | 不作为业务流程优化主力，仅特殊场景使用 |
| `Seed-2.1-Turbo` | 禁止用于正式方案输出、审查 |

### 4.3 工作流强制规则

1. **方案阶段**：强制使用 `Seed-2.1-Pro` 输出方案，人工确认
2. **实现阶段**：按上述规则选择模型执行代码修改
3. **审查阶段**：每轮代码修改完成，**必须切回 `Seed-2.1-Pro`** 做独立审查
4. **提交阶段**：审查通过后才能 git commit

### 4.4 调度决策流程
```
收到任务
  │
  ├── 是否为方案/评估类任务？
  │   └── 是 → Seed-2.1-Pro
  │
  ├── 是否为代码实现？
  │   ├── 简单修改 → Seed-Code
  │   ├── 复杂后端/登录 → DeepSeek-V4-Flash
  │   └── 大规模重构 → DeepSeek-V4-Pro
  │
  ├── 是否为批量扫描？
  │   └── 是 → Seed-2.1-Turbo
  │
  └── 修改完成 → 必须用 Seed-2.1-Pro 审查 → 通过才能提交
```

---

## 五、多版本复制修改检查清单（强制性）

每次修改涉及多版本的功能后，必须执行以下检查：

| # | 检查项 | 检查方法 |
|---|--------|---------|
| 1 | 版本显示8处标识 | Grep版本类型文本 |
| 2 | 诊所名/医师名统一 | Grep `clinicName`/`doctorName` |
| 3 | 版本号V1.0.0统一 | Grep `versionCode` |
| 4 | toISOString残留 | Grep `toISOString().split\|slice` |
| 5 | electron目录一致性 | LS对比4个electron目录 |
| 6 | package.json build.files | 对比script引用 |
| 7 | config.json路径 | Grep `getExeDirectory` |
| 8 | cloud-api.js同步 | 验证所有副本 |
| 9 | 全局变量window.前缀 | Grep裸变量引用 |
| 10 | ★APP版防御性初始化 | Grep `typeof window._cloudReachable` in 4 APP copies |

---

## 五、Git 工作流

### 5.1 分支策略
- `main`：生产分支
- 直接在 `main` 上开发（个人项目）
- 提交信息格式：`<type>: <简述> - <详细说明>`

### 5.2 提交前验证
1. `git diff --stat` 确认修改范围
2. Grep/Read 验证修改生效
3. 确认涉及的所有版本都已同步

### 5.3 常见问题
- 远程有新提交时，使用 `git pull origin main --rebase` 而非 `git pull`
- 冲突时先 `git stash` → `git pull --rebase` → `git stash pop`

---

## 六、部署规范

### 6.1 云端网页版
- Cloudflare Pages：`pages_build_output_dir` = `public`（在 wrangler.toml 中配置）
- 修改 `site-admin/` 下的文件必须同步到 `public/` 对应路径
- GitHub Actions 自动部署：push 到 main 后自动构建

### 6.2 桌面版打包
- 4个桌面版独立打包：`build.bat` 在各版本根目录
- 产物路径：`dist/` 目录
- NSIS安装版：激活后 `license.dat` 写入用户数据目录
- **重要**：修改 `activate.js` 和 `license-manager.js` 后必须重新打包

### 6.3 APP版打包
- Capacitor 框架
- 产物为 APK 文件
- `public/index.html` 作为 APP 资源源文件

---

## 七、安全约束

### 7.1 硬性约束（Hard Constraints）
- 禁止在代码中暴露密钥和token
- `AuthCore` 模块处理所有认证逻辑
- 云端API必须通过 `cloud-api.js` 的 `cloudFetch()` 函数调用
- 401响应自动触发登出流程

### 7.2 防御性编程
- 所有跨脚本全局变量使用前先检查 `typeof window.xxx === 'undefined'`
- `cloud-api.js` 顶部必须包含防御性初始化代码
- 错误处理使用 try-catch，禁止静默失败
