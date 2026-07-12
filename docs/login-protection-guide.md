# 登入功能保护机制文档

> 本文档记录项目登入功能的关键文件、流程、保护规则，确保后续优化过程中不误伤登入逻辑。

## 一、登入功能关键文件清单

### 1.1 离线桌面版（db-bendi / db-dingzhi / db-geren）

| 文件 | 关键函数/位置 | 作用 |
|------|-------------|------|
| `index.html` | `handleLogin()` (~第896行) | 登入主流程：获取输入→验证→成功/失败处理 |
| `index.html` | `getUsers()` (~第868行) | 从localStorage读取用户列表，无则返回默认用户 |
| `index.html` | `getDefaultUsers()` (~第796行) | 返回默认用户（admin/admin, doctor1/123456, doctor2/123456） |
| `index.html` | `hashPassword()` (~第839行) | SHA-256+salt哈希密码，失败回退明文 |
| `index.html` | `isPasswordHashed()` (~第851行) | 检测密码是否已哈希（64位hex） |
| `index.html` | `ensurePasswordsHashed()` IIFE (~第880行) | 启动时自动迁移明文密码为哈希 |
| `index.html` | `saveUsers()` (~第892行) | 保存用户列表到localStorage |
| `electron/preload.js` | `loginSuccess` / `getCurrentUser` / `getAppConfig` | IPC桥接 |
| `electron/main.js` | `login-success` handler (~第346行) | 保存登录态、创建主窗口 |
| `electron/main.js` | `get-current-user` handler (~第359行) | 返回当前登录用户 |
| `electron/main.js` | `get-app-config` handler (~第364行) | 返回config.json配置 |
| `electron/main.js` | `saveLoginState()` (~第127行) | 保存登录状态到userData |
| `electron/main.js` | `installCSP()` (~第145行) | CSP必须包含 `'unsafe-inline'` 和 `file:` |

### 1.2 云端桌面版（cloud_desktop）

| 文件 | 关键函数/位置 | 作用 |
|------|-------------|------|
| `index.html` | `handleLogin()` (~第3005行) | 调用云端API验证（POST /api/users?login=true） |
| `index.html` | `getUsers()` (~第2851行) | 从云端获取用户列表 |
| `index.html` | `getUsersFromCloud()` (~第2189行) | 云端用户获取 |
| `index.html` | `getDefaultUsers()` (~第2154行) | 默认用户（仅备用） |
| `electron/preload.js` | `loginSuccess` / `getLoggedInUser` / `getIndexHtmlContent` | IPC桥接 |
| `electron/main.js` | `login-success` / `get-logged-in-user` / `get-index-html-content` handler | IPC处理 |

### 1.3 Android 版本

Android版本登入逻辑内嵌在 `public/index.html` 中，与桌面版共用同一套函数（handleLogin/getUsers/hashPassword），但通过 NativeBridge 而非 electronAPI 与原生层通信。

## 二、登入流程详解（离线版）

```
用户输入用户名+密码 → 点击"确定"
  ↓
handleLogin()
  ↓
getUsers() → localStorage.getItem('local_systemUsers')
  ↓ 无数据
getDefaultUsers() → [{admin/admin}, {doctor1/123456}, {doctor2/123456}]
  ↓
hashPassword(password) → crypto.subtle.digest('SHA-256', salt+password)
  ↓ 失败时catch → 返回明文password
users.find(u => u.username === username && u.password === hashedPwd)
  ↓ 匹配成功
currentUser = user
localStorage.setItem('user_login_data', ...)
隐藏loginOverlay → 显示main-container
updateUserDisplay()
await loadData()  ← 注意：异步加载处方/药品数据
refreshUserInterface()
updatePrescriptionPaper()
await window.electronAPI.loginSuccess(user)  ← 通知主进程
  ↓ 匹配失败
显示"用户名或密码错误"
```

### 启动时密码迁移（异步，不阻塞登入）

```
ensurePasswordsHashed() IIFE
  ↓
getUsers() → 遍历用户
  ↓ 密码未哈希
hashPassword(u.password) → 替换为哈希值
saveUsers(users) → 保存到localStorage
  ↓ 异常
.catch(e => console.error('密码迁移失败:', e))  ← 不影响页面加载
```

## 三、各版本登入差异对比

| 维度 | 离线版(db-bendi等) | 云端版(cloud_desktop) |
|------|-------------------|---------------------|
| 验证方式 | 本地localStorage | 云端API（POST /api/users?login=true） |
| 用户来源 | local_systemUsers | 云端数据库 |
| 密码哈希 | crypto.subtle SHA-256+salt | 后端处理 |
| 登录态存储 | user_login_data | cloud_currentUser + cloud_isLoggedIn |
| IPC通知 | loginSuccess | loginSuccess |
| 网络依赖 | 无 | 需要联网 |
| 默认用户 | admin/admin等 | 无（必须云端验证） |

## 四、登入功能保护规则

### 4.1 禁止修改的文件/函数（除非专门处理登入问题）

- `handleLogin()` 函数体
- `getUsers()` / `getDefaultUsers()` / `saveUsers()`
- `hashPassword()` / `isPasswordHashed()`
- `ensurePasswordsHashed()` IIFE
- `electron/main.js` 中的 `login-success` / `get-current-user` / `get-app-config` handler
- `electron/preload.js` 中的 `loginSuccess` / `getCurrentUser` / `getAppConfig` 暴露
- `installCSP()` 中的 `script-src` 策略（必须包含 `'unsafe-inline'` 和 `file:`）

### 4.2 优化时检查清单

每次修改index.html或electron相关文件后，执行以下检查：

- [ ] **语法检查**：`node check_syntax.js`（或用vm.Script验证script块语法）
- [ ] **函数存在性**：确认handleLogin/getUsers/hashPassword/getDefaultUsers均存在
- [ ] **IPC完整性**：确认preload.js中loginSuccess/getCurrentUser/getAppConfig未删除
- [ ] **CSP策略**：确认script-src仍包含'unsafe-inline'和file:
- [ ] **DOM元素**：确认loginOverlay/loginUsername/loginPassword/loginError存在
- [ ] **onclick绑定**：确认登录按钮onclick="handleLogin()"未被移除
- [ ] **默认用户**：确认getDefaultUsers()返回的用户凭据正确

### 4.3 优化修改与登入的关系

以下修改已确认**不影响登入**：

| 修改项 | 原因 |
|--------|------|
| formatPrice() | 仅在表格渲染调用，不在handleLogin流程中 |
| sortPrescriptionsByTimeDesc() | 仅在处方列表排序调用，不在登入流程中 |
| __APP_VERSION__ | 仅定义全局变量，登入流程未引用 |
| saveBackupFile参数顺序 | 仅在备份/恢复时调用，登入不涉及 |
| video-recorder.js音频降级 | dom-ready时注入，有try-catch保护 |
| video-recorder.js提示统一 | 仅影响录像UI，与登入无关 |

### 4.4 登入问题排查流程

当报告"无法登入"时，按以下顺序排查：

1. **确认现象**：点击"确定"无反应？提示"用户名或密码错误"？界面空白？程序崩溃？
2. **用户操作**：确认用户名/密码输入正确（常见原因！）
3. **语法检查**：`node -e "const vm=require('vm');const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const m=h.match(/<script[^>]*>([\s\S]*?)<\/script>/i);try{new vm.Script(m[1]);console.log('OK')}catch(e){console.error(e.message)}"`
4. **IPC检查**：确认preload.js和main.js中login相关handler完整
5. **CSP检查**：确认CSP允许unsafe-inline
6. **运行时检查**：运行打包后程序，查看控制台日志
7. **数据检查**：确认localStorage中local_systemUsers数据未损坏

## 五、多端登入一致性保障

### 5.1 跨版本同步修改规则

当需要修改登入逻辑时，必须同步修改所有版本：
- `offline_project/db-bendi/index.html`
- `offline_project/db-dingzhi/index.html`
- `offline_project/db-geren/index.html`
- `offline_project/db-bendi/android/app/src/main/assets/public/index.html`
- `offline_project/db-dingzhi/android/app/src/main/assets/public/index.html`
- `offline_project/db-shouji/android/app/src/main/assets/public/index.html`
- `cloud_project/cloud_desktop/index.html`（如涉及云端登入）

### 5.2 多用户场景

- 默认用户：admin（管理员）、doctor1/doctor2（普通用户）
- 密码迁移：启动时自动将明文密码哈希化，兼容旧数据
- 权限区分：admin可查看所有处方，普通用户只能查看自己的

### 5.3 多端设备

- 桌面端：Electron + contextBridge IPC
- Android端：Capacitor + NativeBridge
- 云端Web：fetch API + 后端验证
- 数据隔离：各端localStorage独立，用户数据通过userData目录持久化

## 六、版本历史

| 日期 | 修改内容 | 影响 |
|------|---------|------|
| 2026-07-08 | 初始创建 | 建立登入保护机制 |
| 2026-07-08 | 排查"无法登入"问题 | 确认代码无问题，根因为用户名输入错误 |
