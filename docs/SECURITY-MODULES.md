# 惠康中医诊所管理系统 - 安全防护/打包分发/用户管理模块化文档

> 本文档记录三大核心模块的架构、配置、优化方向和 checklist，便于后续持续优化。
> 更新时间：2026-07-23 | 基于 commit：d70a4fd + P1 密钥管理优化

---

## 目录

1. [安全防护模块](#一安全防护模块)
2. [打包分发模块](#二打包分发模块)
3. [用户管理模块](#三用户管理模块)
4. [密钥管理专项](#四密钥管理专项)
5. [影响分析](#五影响分析)
6. [优化 checklist](#六优化-checklist)

---

## 一、安全防护模块

### 1.1 桌面端（Electron 4端）

| # | 防护措施 | 实现位置 | 强度 | 说明 |
|---|---------|---------|------|------|
| 1 | **CSP 内容安全策略** | `electron/main.js` installCSP() | 强 | default-src 'self'，限制远程脚本 |
| 2 | **contextIsolation=true** | `electron/main.js` getSharedWebPrefs() | 强 | 渲染进程无法直接访问 Node.js |
| 3 | **nodeIntegration=false** | 同上 | 强 | 禁止渲染进程 require Node 模块 |
| 4 | **DevTools 反调试** | `electron/main.js` installDevToolsGuard() | 中 | 仅 app.isPackaged 启用，拦截 F12/Ctrl+Shift+I |
| 5 | **asarmor ASAR 防解包** | `electron/afterPack.js` | 中 | 100GB bloat patch 防 ASAR 解包 |
| 6 | **Windows exe 代码签名** | `tools/certs/` + `build.bat` | 强 | CSC_KEY_PASSWORD 环境变量注入 |
| 7 | **路径白名单校验** | `electron/main.js` isPathAllowed() | 强 | 仅允许 downloads 目录及子目录 |
| 8 | **save-user-data 安全 key** | `electron/main.js` isSafeKey() | 强 | 正则 `/^[a-zA-Z0-9_-]{1,64}$/` |
| 9 | **safeStorage 加密** | `auth-core.js` + `preload.js` | 强 | Windows DPAPI 系统级加密 |
| 10 | **prompt/alert/confirm polyfill** | `electron/main.js` dom-ready | - | 替代 Electron 原生 dialog 缺陷 |
| 11 | **JS 代码混淆** | `tools/obfuscate.js` | 弱-中 | 打包时混淆，打包后恢复源码 |

### 1.2 APP 端（Android 4端）

| # | 防护措施 | 实现位置 | 强度 | 说明 |
|---|---------|---------|------|------|
| 1 | **模拟器检测** | `MainActivity.java` isEmulator() | 中 | 检查 Build 属性 |
| 2 | **Frida 检测** | `MainActivity.java` | 中 | 检查 frida-server 端口、libfrida.so |
| 3 | **Xposed 检测** | `MainActivity.java` | 中 | 检查 Xposed Bridge |
| 4 | **APK 签名校验** | `MainActivity.java` | 强 | GET_SIGNING_CERTIFICATES (API 28+) |
| 5 | **networkSecurityConfig** | `res/xml/network_security_config.xml` | 强 | 限制明文传输 |
| 6 | **proguard 混淆** | `proguard-rules.pro` | 中 | minify+shrink+allowaccessmodification |
| 7 | **APK v1+v2 签名** | `build.gradle` signingConfigs.release | 强 | 密码环境变量注入 |
| 8 | **JS 代码混淆** | `obfuscate.js --target` | 弱-中 | Android assets/public 目录 |

### 1.3 云端 API（Cloudflare Pages Functions）

| # | 防护措施 | 实现位置 | 强度 | 说明 |
|---|---------|---------|------|------|
| 1 | **CORS 白名单** | `functions/api/users.js` getAllowedOrigins() | 强 | 仅允许 pages.dev 子域 + 本地开发 |
| 2 | **登录失败锁定** | `functions/api/users.js` recordLoginFailure | 强 | 5 次失败后 15 分钟锁定 |
| 3 | **IP 限流** | `functions/api/users.js` checkIpRateLimit | 强 | 10 次/分钟 |
| 4 | **审计日志** | `functions/api/users.js` writeAuditLog | 中 | 保留 90 天 |
| 5 | **角色权限分级** | `functions/api/_lib/auth.js` | 强 | platform_admin > clinic_admin > doctor |
| 6 | **HMAC-SHA256 token** | `functions/api/_lib/auth.js` hmacSign | 强 | 无状态 + 黑名单撤销 |
| 7 | **PBKDF2 密码哈希** | `functions/api/_lib/auth.js` pbkdf2Hash | 强 | 100000 iterations |
| 8 | **AUTH_SECRET 环境变量** | `functions/api/_lib/auth.js` getSecret() | 强 | Cloudflare Pages 后台配置 |
| 9 | **Token 黑名单** | `functions/api/_lib/auth.js` revokeAllUserTokens | 强 | 登出/改密时撤销 |

### 1.4 客户端运行时防护

| # | 防护措施 | 实现位置 | 强度 | 说明 |
|---|---------|---------|------|------|
| 1 | **反调试检测** | `security-guard.js` _startAntiDebug() | 弱 | debugger 语句 + 时间差检测，仅记录日志 |
| 2 | **DevTools 窗口尺寸检测** | `security-guard.js` | 弱 | window 尺寸差判断 |
| 3 | **完整性校验** | `security-guard.js` _checkIntegrity() | 弱 | exe/APK 自校验 |
| 4 | **可关闭机制** | `localStorage.securityGuardDisabled` | - | 临时关闭，便于调试 |

---

## 二、打包分发模块

### 2.1 项目结构（5端）

```
cloud_project/
  ├── cloud_desktop/     # 云端桌面版（Electron 35）
  │   ├── electron/      # main.js, preload.js, license-manager.js, activate.js
  │   ├── afterPack.js   # asarmor 钩子
  │   ├── pack.bat       # 打包入口
  │   └── pack-desktop.bat
  └── cloud_app/         # 云端 APP 版（Capacitor + Android）
      └── android/

offline_project/
  ├── db-bendi/          # 离线本地版（Electron + Android）
  ├── db-geren/          # 离线个人版
  ├── db-dingzhi/        # 离线定制版
  └── _shared/           # 共享资源（auth-core.js, license/）

shared/                  # 共享前端资源（index.html）
tools/                   # 共享工具脚本
  ├── certs/             # 代码签名证书
  ├── obfuscate.js       # JS 混淆工具
  ├── pack.ps1           # 离线打包脚本
  ├── one-click-pack.ps1 # 一键打包入口
  ├── prompt-modal.html  # P0 prompt polyfill UI
  └── prompt-preload.js  # P0 prompt polyfill preload

functions/api/           # Cloudflare Pages Functions（API 后端）
  ├── users.js           # 用户管理 API
  ├── license/           # 激活码系统
  │   ├── validate.js    # 激活码校验
  │   ├── generate.js    # 激活码生成
  │   └── _lib/license-core.js  # 核心库
  └── _lib/auth.js       # 认证库
```

### 2.2 打包流程

#### Electron 桌面打包流程
1. 关闭残留进程（taskkill）
2. 清理旧 build 产物
3. JS 代码混淆（obfuscate.js）
4. 设置 CSC_KEY_PASSWORD 环境变量（从 cert-password.txt 读取）
5. 准备 win-unpacked 目录（prepare-win-unpacked.js）
6. electron-builder --prepackaged（跳过 app-builder.exe 解包）
7. 恢复原始 JS 代码
8. 验证 exe 输出

#### Android APP 打包流程
1. build.gradle 配置（minifyEnabled + proguard + ABI 过滤）
2. generateBuildTimeFile 任务（生成打包时间戳）
3. JS 代码混淆（obfuscate.js --target）
4. Gradle assembleRelease
5. 输出 APK 到 `app/build/outputs/apk/release/`

### 2.3 版本号管理

| 端 | versionCode | versionName 格式 |
|----|-------------|-----------------|
| 离线3端 APP | 递增 | `1.0.${BUILD_TIME}`（如 1.0.20260723-1430） |
| 云端 APP | 递增 | `1.15.${BUILD_TIME}` |
| 桌面版 | - | 通过 package.json |

### 2.4 证书管理

| 证书类型 | 文件 | 入库状态 | 密码来源 |
|---------|------|---------|---------|
| Windows exe 代码签名 | `tools/certs/惠康中医-codesign.pfx` | .gitignore 排除 | `tools/certs/cert-password.txt`（.gitignore 排除） |
| Windows 公钥证书 | `tools/certs/惠康中医-codesign.cer` | 可入库 | - |
| Android 签名 | 各端 `signing.properties` | .gitignore 排除 | 环境变量 `TCM_STORE_PASSWORD`/`TCM_KEY_PASSWORD` |

### 2.5 编码规范

| 文件类型 | 编码 | BOM | 说明 |
|---------|------|-----|------|
| .bat | UTF-8 无 BOM | 无 | 顶部必须 `chcp 65001 >nul` |
| .ps1 | UTF-8 | 有 | PowerShell 5.1 靠 BOM 识别编码 |
| .js | UTF-8 无 BOM | 无 | Node.js 默认 UTF-8 |
| .json | UTF-8 无 BOM | 无 | JSON 规范要求 UTF-8 |

### 2.6 界面保护规则

- **禁止修改** index.html 的 `<body>` 内 DOM 结构、`<style>` 部分、mobileNav/mobileActionBar 配置
- **禁止修改** login.html/login.js 的 UI 部分
- 优化前必须运行 `check-interface.ps1` 建立基线
- 优化后必须运行 `check-interface.ps1` 验证界面未被破坏
- 只允许修改 main.js/MainActivity.java/auth-core.js/build.gradle/proguard/build.bat 等逻辑文件

---

## 三、用户管理模块

### 3.1 角色体系

| 角色 | 常量 | 权限 | 说明 |
|------|------|------|------|
| 平台总管理员 | `ROLE_PLATFORM_ADMIN` | 最高 | 管理所有诊所、平台管理员；可初始化/重置 |
| 诊所管理员 | `ROLE_CLINIC_ADMIN` | 中 | 管理本诊所用户 |
| 医生 | `ROLE_DOCTOR` | 低 | 开具处方 |

### 3.2 用户字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `username` | string | 登录账号（英文/拼音，全局唯一） |
| `name` | string | 显示名称 |
| `role` | string | 角色（platform_admin/clinic_admin/doctor） |
| `clinicId` | string | 所属诊所 ID |
| `clinicName` | string | 所属诊所名称 |
| `allowedMode` | string | 允许模式：both/offline/cloud |
| `cloudEnabled` | boolean | 是否允许云端 |
| `allowSavePrescription` | boolean | 是否允许保存处方 |
| `passwordHash` | string | PBKDF2-SHA256 密码哈希 |
| `salt` | string | 密码盐（16字节 hex） |
| `createdAt` | ISO string | 创建时间 |
| `updatedAt` | ISO string | 更新时间 |

### 3.3 KV 存储结构

| KV Key | 用途 | TTL |
|--------|------|-----|
| `system:platform_admins` | 平台管理员列表 | 永久 |
| `system:clinics` | 诊所列表 | 永久 |
| `clinic:{id}:users` | 诊所用户列表 | 永久 |
| `login_fail:{username}` | 登录失败计数 | 15 分钟 |
| `audit_log:{clinicId}:{date}` | 审计日志 | 90 天 |
| `revoked_token:{token}` | Token 黑名单 | token 有效期 |
| `ip_rate:{ip}` | IP 限流计数 | 60 秒 |
| `license:{code}` | 激活码记录 | 永久 |
| `license_log:{code}` | 激活码操作日志 | 永久（最多 200 条） |
| `ratelimit:license:{ip}:{hour}` | 激活码校验限流 | 1 小时 |

### 3.4 API 端点清单

#### 用户管理 API（`functions/api/users.js`）

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/users?action=bootstrap` | 无（仅首次） | 初始化平台管理员 |
| POST | `/users?action=reset-platform-admin` | 无（已有管理员时） | 重置平台管理员密码 |
| POST | `/users?login=true` | 无 | 登录 |
| GET | `/users?platform-admins=true` | platform_admin | 列出平台管理员 |
| GET | `/users?check=username` | platform_admin | 诊断用户 |
| GET | `/users?clinics=true` | platform_admin | 列出诊所 |
| POST | `/users?clinic=create` | platform_admin | 创建诊所 |
| POST | `/users?action=change-password` | 本人 | 修改密码 |
| POST | `/users`（保存） | admin | 保存用户 |
| **GET** | **`/users?action=export`** | **admin** | **批量导出用户**（P1 新增） |
| **POST** | **`/users?action=import`** | **admin** | **批量导入用户**（P1 新增） |

#### 激活码 API（`functions/api/license/`）

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/api/license/validate` | 无（速率限制） | 激活码校验 |
| POST | `/api/license/generate` | platform_admin | 生成激活码 |
| GET | `/api/license/list` | platform_admin | 列出激活码 |
| GET | `/api/license/status?code=...` | platform_admin | 查询激活码状态 |
| GET | `/api/license/logs?code=...` | platform_admin | 查询激活码日志 |

### 3.5 离线授权系统

#### 授权流程
1. 客户端安装后启动 → 试用期（默认 7 天）
2. 试用期结束 → 弹出激活窗口
3. 用户输入激活码 → 调用 `/api/license/validate` 校验
4. 校验通过 → 写入 `license.dat`（AES-256-CBC 加密 + HMAC 签名）
5. 后续启动 → 读取并验证 `license.dat`

#### 授权码格式
- `BNZC-XXXX-XXXX-XXXX-XXXX`（去除易混淆字符 0/O/1/I）
- 支持多设备授权（maxDevices，默认 1，上限 10）
- 支持诊所名绑定（clinicName）

#### 版本分级
| 类型 | maxPrescriptions | features |
|------|-----------------|----------|
| trial | 30 | [] |
| personal | 0（无限） | ['backup'] |
| pro | 0（无限） | ['backup', 'sync', 'multi-device', 'priority-support'] |

#### 签名版本
| 版本 | 算法 | 签名内容 | 说明 |
|------|------|---------|------|
| v1 | HMAC-SHA256 | user\|type\|issuedAt\|expiresAt | 最旧版 |
| v2 | HMAC-SHA256 | v1 + maxPrescriptions\|features | 增加版本分级 |
| v3 | HMAC-SHA256 | v2 + clinicName\|machineId\|licenseBinding | 增加三因子绑定 |
| v5 | ECDSA P-256 | 同 v3 内容 | 非对称签名（私钥仅云端） |

---

## 四、密钥管理专项

### 4.1 密钥清单

| # | 密钥类型 | 位置 | 当前状态 | 风险 |
|---|---------|------|---------|------|
| 1 | **AUTH_SECRET** | `functions/api/_lib/auth.js` | ✅ Cloudflare 环境变量 | 安全 |
| 2 | **LICENSE_HMAC_KEY** | `electron/license-manager.js:18` | ⚠️ 硬编码 + P1 masterKey 派生 | 已优化 |
| 3 | **CONFIG_SIGN_KEY** | `electron/license-manager.js:40` | ⚠️ 硬编码 + P1 masterKey 派生 | 已优化 |
| 4 | **PASSWORD_SALT** | `_shared/auth-core.js:13` | ⚠️ 硬编码（仅浏览器降级路径） | 中 |
| 5 | **LICENSE_MASTER_KEY** | Cloudflare 环境变量 | ✅ 可选配置 | 安全 |
| 6 | **LICENSE_SIGN_PRIVATE_KEY** | Cloudflare 环境变量 | ⚠️ 未配置，默认跳过 v5 验签 | 中 |
| 7 | **Windows exe 签名密码** | `tools/certs/cert-password.txt` | ✅ 文件注入 | 安全 |
| 8 | **Android 签名密码** | 环境变量 + signing.properties | ✅ 环境变量优先 | 安全 |

### 4.2 P1 密钥管理优化方案（已实施）

#### 设计
1. **云端** `license-core.js`：在 `buildLicenseData` 中添加可选 `masterKey` 字段
   - 从 Cloudflare 环境变量 `LICENSE_MASTER_KEY` 读取
   - 未配置则不下发（客户端 fallback 到硬编码）
   - `masterKey` 不参与签名内容（在签名计算后添加）
   - **P1-3 升级**：`getLicenseHmacKey()` 改为 async，若配置了 `LICENSE_MASTER_KEY` 则签名密钥也派生自 masterKey（`SHA256(masterKey + ':license-hmac:v1')`），与客户端保持一致

2. **客户端** `license-manager.js`：新增 `setLicenseDataContext()` / `getEffectiveHmacKey()` / `getEffectiveConfigSignKey()`
   - 优先从 license.dat 中的 `masterKey` 派生 HMAC 密钥（`SHA256(masterKey + ':license-hmac:v1')`）
   - 旧 license 无 `masterKey` 字段 → fallback 到硬编码 `LICENSE_HMAC_KEY`（向后兼容）
   - `verifySignature` 开头调用 `setLicenseDataContext(data)` 缓存 license 数据
   - `verifyConfigIntegrity` 使用 `getEffectiveConfigSignKey()` 派生密钥
   - `validateLicense` 返回结果携带 `license.masterKey`（透传给 renderer）

3. **客户端渲染层** `auth-core.js`：自动注入 masterKey
   - 模块加载时自动调用 `electronAPI.license.getStatus()` 获取 license
   - 若 status 包含 `masterKey`，调用 `AuthCore.setMasterKey(status.masterKey)` 注入
   - 注入后 `hashPassword` / `hashPasswordWithUser` 优先使用 `(PASSWORD_SALT + ':' + masterKey)` 作为盐
   - 未注入时 fallback 到纯 `PASSWORD_SALT`（向后兼容旧版本与旧哈希）
   - 旧 PWDv1/PWDv2/XORv1/XORv2 解密逻辑不受影响（RUNTIME_KEY 在模块加载时计算定值）

4. **影响范围**
   - 旧 license：继续用硬编码密钥验签（向后兼容）
   - 新激活的 license（配置 LICENSE_MASTER_KEY 后）：用 masterKey 派生密钥验签（更安全）
   - license.dat 加密/解密逻辑不变（仍用 machineId+硬件指纹派生）
   - 密码哈希盐动态化：每个安装使用不同盐值，破解单一安装不会泄露其他安装密码

#### 配置方法（Cloudflare Pages 后台）

**步骤 1：登录 Cloudflare 控制台**
1. 访问 https://dash.cloudflare.com/
2. 选择对应账号 → Pages → 选择 `tcm-prescription-system` 项目

**步骤 2：进入环境变量配置**
1. 项目详情页 → Settings → Environment variables
2. 选择 Production 环境（重要：仅 Production 环境的变量对线上生效）

**步骤 3：添加 LICENSE_MASTER_KEY（必选）**
- 变量名：`LICENSE_MASTER_KEY`
- 值：32+ 字符随机字符串
  - 推荐用命令生成：`openssl rand -hex 32` 或 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  - 示例：`a1b2c3d4e5f6...`（请勿使用示例值，必须自己生成）
- 类型：Plain text（**不要用 Encrypt**，因为 Cloudflare Functions 需明文读取；如需加密请用 Secrets 但需 Functions 兼容）
- 注意：一旦设置并激活新 license 后**不可更改**，否则已激活的 license 会全部失效

**步骤 4：（可选）添加 LICENSE_HMAC_KEY**
- 仅当需要覆盖默认硬编码 HMAC 密钥时配置
- 变量名：`LICENSE_HMAC_KEY`
- 值：32+ 字符随机字符串
- 注意：若同时配置了 `LICENSE_MASTER_KEY`，则 `LICENSE_HMAC_KEY` 不生效（masterKey 派生优先）

**步骤 5：（可选，强烈推荐）添加 LICENSE_SIGN_PRIVATE_KEY 启用 ECDSA v5 非对称验签**
- 步骤：
  1. 本地运行 `node tools/gen-ecdsa-keys.cjs` 生成密钥对
  2. 私钥（PEM 格式整段）填入 Cloudflare Secrets：变量名 `LICENSE_SIGN_PRIVATE_KEY`
  3. 公钥（PEM 格式整段）填入 `license-manager.js` 的 `ECDSA_VERIFY_PUBLIC_KEY_PEM` 常量
  4. 重新打包 4 端 exe
- 优势：私钥仅云端持有，即使客户端源码完全泄露也无法伪造 license（HMAC 密钥派生虽然安全，但 ECDSA 提供更强的非对称保证）

**步骤 6：触发部署使变量生效**
- 推送任意 commit 到 GitHub main 分支会自动触发 Cloudflare Pages 重新部署
- 或在 Cloudflare Pages 后台手动触发部署：Deployments → Retry deployment

#### 验证配置是否生效
1. **生成新激活码**：在管理后台 `/admin/index.html` 生成激活码，激活后查看 license.dat 解密内容是否包含 `masterKey` 字段
2. **客户端日志检查**：启动桌面版查看 DevTools Console 是否出现 `[AuthCore] masterKey 已从 license 注入`
3. **API 日志检查**：在 Cloudflare Pages Functions 日志中应出现 `[License] 已附加 masterKey（客户端将派生动态密钥）`

#### 失效与回滚
- **配置后**：新激活的 license 自动含 masterKey，旧 license 不受影响
- **撤销 masterKey**：删除 Cloudflare 环境变量 → 重新部署 → 新激活的 license 不再含 masterKey 字段（已激活的 license 仍可正常使用，因客户端会自动 fallback 到硬编码密钥验签）
- **更新 masterKey 值**：仅影响新激活的 license，旧 license（含旧 masterKey）仍按其 masterKey 派生密钥验签

### 4.3 后续优化方向

1. **PASSWORD_SALT 迁移**：当前 `auth-core.js:13` 硬编码 `'bnzc_prescription_salt_v1'`
   - 风险较低（仅浏览器/WebView 降级路径使用，safeStorage 优先）
   - 后续可通过 masterKey 派生（需修改 auth-core.js）

2. **ECDSA v5 验签启用**：
   - 生成 ECDSA P-256 密钥对：`node tools/gen-ecdsa-keys.cjs`
   - 私钥存 Cloudflare Secrets: `LICENSE_SIGN_PRIVATE_KEY`
   - 公钥已嵌入客户端（`license-manager.js` ECDSA_VERIFY_PUBLIC_KEY_PEM）

3. **masterKey 加密存储**：当前 masterKey 明文存储在 license.dat 中（license.dat 本身已加密）
   - 后续可用 machineId+硬件指纹 对 masterKey 二次加密

---

## 五、影响分析

### 5.1 P0 修复：管理员编辑按钮失效

- **根因**：`handleEditUser` 调用 `await prompt(...)`，Electron BrowserWindow 中 `window.prompt()` 默认返回 null
- **影响范围**：云端桌面版 + 离线3端桌面版
- **修复方案**：4端 main.js 添加 `dialog:prompt` IPC handler + dom-ready 注入 polyfill + preload.js 暴露 prompt 方法
- **生效方式**：桌面版需重新打包 exe；APP 从 URL 加载无需重新打包

### 5.2 P1 密钥管理优化影响

- **影响范围**：所有新激活的 license
- **向后兼容**：旧 license 继续用硬编码密钥（无影响）
- **生效方式**：
  - 云端 API：自动生效（Cloudflare Pages 重新部署后）
  - 客户端：需重新打包 exe（4端 license-manager.js 已更新）
  - 配置：需在 Cloudflare Pages 后台设置 `LICENSE_MASTER_KEY` 环境变量

### 5.3 P1 用户管理 API 增强影响

- **新增端点**：`GET /users?action=export` + `POST /users?action=import`
- **影响范围**：仅新增功能，不影响现有端点
- **生效方式**：云端 API 自动生效（Cloudflare Pages 重新部署后）
- **使用方式**：前端可通过 fetch 调用，支持 JSON 格式导入导出

### 5.4 安全防护措施的潜在影响

#### DevTools 反调试
- **影响**：开发环境无影响（仅 app.isPackaged 启用）
- **风险**：低

#### CSP
- **影响**：限制远程脚本和 connect-src
- **缓解**：已包含云端 API 域名白名单

#### 路径白名单
- **影响**：仅允许 downloads 目录
- **缓解**：支持用户手动选择目录

#### 模拟器/Frida/Xposed 检测
- **影响**：仅记录日志，不强制退出
- **风险**：极低

---

## 六、优化 checklist

### P0（已完成）
- [x] 修复管理员编辑按钮失效（prompt polyfill）
- [x] 4端 main.js 添加 dialog:prompt IPC handler
- [x] 4端 preload.js 暴露 prompt 方法
- [x] 创建共享 prompt-modal.html + prompt-preload.js

### P1（已完成）
- [x] 密钥管理优化：masterKey 下发 + 运行时派生
- [x] 用户管理 API 增强：批量导入导出
- [x] 创建模块化文档（本文档）
- [x] **P1-3：masterKey 完整闭环**（云端派生签名 + 客户端派生验签 + 渲染层注入密码哈希盐）

### P1（待完成 - 用户操作）
- [ ] Cloudflare Pages 后台配置 `LICENSE_MASTER_KEY` 环境变量（参考 4.2 节配置方法）
- [ ] 4端桌面版重新打包 exe（使 license-manager.js + auth-core.js 修改生效）
- [ ] 3端离线 APP 重新打包 APK（使 auth-core.js 修改生效）

### P2（后续优化）
- [ ] ECDSA v5 验签启用（生成密钥对 + 配置 Cloudflare Secret）
- [x] ~~PASSWORD_SALT 迁移到 masterKey 派生~~（P1-3 已完成，auth-core.js 自动注入）
- [ ] masterKey 加密存储（machineId+硬件指纹 二次加密）
- [ ] 安全防护措施运行时自检（定期校验 asarmor/proguard 完整性）
- [ ] 审计日志可视化（管理员后台查看）
- [ ] 密码强度校验（最少 8 位 + 数字字母组合）
- [ ] 用户锁定状态查询 + 主动解锁
- [ ] 用户操作历史查询

### P3（低优先级）
- [ ] Android R8 进一步优化（移除未使用代码）
- [ ] Electron sandbox 启用评估（需重构 preload API）
- [ ] 前端批量导入导出 UI（CSV 上传/下载）
