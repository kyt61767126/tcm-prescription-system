# 手机 APP 账号与云端权限管控方案

## Context（背景与目标）

当前 APP 通过 WebView 直接加载云端网页（`tcm-prescription-system.pages.dev`），模式行为由 `MainActivity.java` 注入的 `injectOfflineScript` 按 `cloud_currentUser.allowedMode` 驱动。云端网页子模块（`tcm-prescription-system/`）**禁止修改**。

用户提出两条 APP 设置需求：
1. **账号只能管理员云端创建，禁止自助注册，无账号无法登录。**
2. **普通用户默认纯离线（不显示状态、无切换按钮）；管理员后台一键开关云端权限，开通后才可联网同步。**

经探索，部分能力已具备：
- 登录页（`initLoginDropdown` 行1903）下拉框只列云端已有用户、无注册入口按钮 → "无账号无法登录"已满足。
- `getUsers()`（行1851）默认普通用户 `allowedMode='local'`、`handleAddUser`（行2272）新增用户默认 `'local'` → "默认纯离线"已满足。
- `injectOfflineScript` 对 `'local'` 强制离线 → 离线拦截已满足。

缺口需补：
- `registerModal` + `handleRegister`（无鉴权）仍存在于网页，APP 内需封禁；云端 API POST 无鉴权，任何人可覆盖用户列表（最大漏洞）。
- 管理员设置用户模式是三步 `prompt`，不是"一键开关"。
- `local` 普通用户仍可见"离线数据同步"状态区块，需隐藏。

预期结果：APP 内彻底无法注册；云端 API 仅管理员可增删用户、普通用户仅可改自己密码；管理员在账户管理列表对每个普通用户一键开通/关闭云端；纯离线用户无任何模式状态/切换 UI。

---

## 实现方案

### 改动 1：`MainActivity.java` 新增 `injectAccountGuardScript`

文件：[MainActivity.java](file:///c:/Users/61767/Documents/trae_projects/kyt-zy/android/app/src/main/java/com/tcm/prescription/MainActivity.java)

在 `onPageFinished`（行149-154）现有 `injectOfflineScript` 调用旁，追加 1.5s + 3s 两次延迟调用（与离线脚本同时机）；新增 `injectAccountGuardScript(WebView)` 方法，内部 `evaluateJavascript` 执行以下 JS（用 Java 字符串拼接，参照 `injectOfflineScript` 写法）。脚本用 `window._accountGuardInjected` 幂等守卫，不重置。

JS 逻辑三部分：

**(a) 注册封禁**
- 覆盖 `window.showRegisterModal` / `window.handleRegister` 为弹 alert"禁止自助注册，请联系管理员创建账号"。
- 注入 CSS `#registerModal{display:none !important;}` 防御性隐藏注册弹窗。

**(b) 一键开关云端权限**（核心）
- `extractUsername(row)`：从编辑按钮 `onclick="handleEditUser('USERNAME')"` 正则提取 username；兜底从 `.user-item-name` 文本末尾括号解析。
- `readModeFromRow(row)`：从 `.user-item-role span` 文本含"仅离线/仅云端/双模式"判断当前模式。
- `injectToggleButtons()`：遍历 `#userList > .user-item`，admin 行跳过，其余行在 `.user-item-actions` 追加按钮。用 `row.dataset.cloudToggle==='1'` 幂等守卫避免重复注入。`local`→"开通云端"(btn-primary)，`both`→"关闭云端"(btn-warning)。
- `toggleCloud(username, btn)`：调 `window.getUsers()` → 找到用户 → `local↔both` 切换 → 调 `window.saveUsers(users)`（复用云端网页函数，自动带 admin Basic header，通过加固后鉴权）→ 若改的是当前登录用户则同步 `cloud_currentUser` 和 `window.currentUser` → `window.renderUserList()` 重渲染。失败 alert + 按钮恢复。
- 双保险触发注入：① Hook `window.renderUserList`（包裹原函数，`await _orig()` 后调 `injectToggleButtons()`，用 `_accountGuardWrapped` 防重复包装，未就绪时 300ms 重试）；② `MutationObserver` 观察 `#userList` childList 兜底。

**(c) local 普通用户隐藏状态 UI**
- `getLocalUser()`：读 `cloud_currentUser`，`role!=='admin' && allowedMode==='local'` 时返回用户。
- `applyLocalModeHiding()`：对 `#offline-sync-section`（基础设置里的"离线数据同步"区块）`display:none`。`setInterval(applyLocalModeHiding, 1000)` 应对登录/切换后状态变化。
- 注：`updateMobileActionButtons` 已给普通用户只显示"统计分析/修改密码"，无模式栏，无需额外处理。

### 改动 2：`public/functions/api/users.js` POST 分级鉴权

文件：[users.js](file:///c:/Users/61767/Documents/trae_projects/kyt-zy/public/functions/api/users.js)

- OPTIONS 预检 `Access-Control-Allow-Headers` 追加 `Authorization`（行12，防御性）。
- **GET 不加鉴权**（登录下拉 `initLoginDropdown` 依赖）。
- POST 分支（行108起，`body.users` 校验后、写 KV 前）插入：
  1. 解析 `Authorization: Basic` header，`atob`+`TextDecoder` 解码得 `username:role`。
  2. 读 KV 现有用户，`matched` 找到 username；`isAdmin = authRole==='admin' && matched && matched.role==='admin'`（防伪造 role，须 KV 中确为 admin）。
  3. `isSelfRegular = !isAdmin && matched`（合法普通用户改自己信息）。
  4. 非 admin 且非本人 → 403。
  5. 普通用户：用 `keysEqualExcept` diff-check 确保**仅修改自己 password 字段**——用户数不变、他人字段完全一致、自己除 password 外字段一致；否则 403。保护增删用户、改 role/allowedMode、改他人信息。
  6. 鉴权通过后执行原有保存逻辑（行126-152 原样保留）。
- 这样：管理员全权（增删改任意用户/模式）✓；普通用户仅改自己密码 ✓；匿名 POST / 伪造 admin → 403 ✓；`handleRegister` 走 `saveUsersToCloud` 但未登录 `currentUser` 为 null 抛错 + API 403 双重拦截 ✓。

### 改动 3：构建新 APK

用项目既有打包流程（`打包-云端版` 脚本 / `gradlew assembleRelease`），产物签名 APK 输出到 `android/app/build/outputs/apk/release/app-release.apk`，测试前需卸载旧版本。

---

## 关键文件

- [MainActivity.java](file:///c:/Users/61767/Documents/trae_projects/kyt-zy/android/app/src/main/java/com/tcm/prescription/MainActivity.java) — 新增 `injectAccountGuardScript` 方法 + `onPageFinished` 调用点（行149-154 区域）
- [users.js](file:///c:/Users/61767/Documents/trae_projects/kyt-zy/public/functions/api/users.js) — POST 分支加分级鉴权（行108-153 区域），OPTIONS 加 Authorization header
- [tcm-prescription-system/index.html](file:///c:/Users/61767/Documents/trae_projects/kyt-zy/tcm-prescription-system/index.html) — **只读参考**，复用其 `getUsers`/`saveUsers`/`renderUserList`/`saveUsersToCloud` 全局函数和 `#userList`/`#registerModal`/`#offline-sync-section` DOM 结构
- [capacitor.config.ts](file:///c:/Users/61767/Documents/trae_projects/kyt-zy/capacitor.config.ts) — 确认 `server.url` 同源（页面与 API 同域，实际不触发 CORS 预检）

---

## 验证方案

构建 APK 后卸载旧版安装，按以下用例测试：

| 用例 | 步骤 | 预期 |
|------|------|------|
| 注册封禁-函数 | Chrome 远程调试执行 `showRegisterModal()` | alert"禁止自助注册"，弹窗不显示 |
| 注册封禁-API | `curl -X POST .../api/users -H 'Content-Type: application/json' -d '{"users":[]}'`（无 Authorization） | 403 Forbidden |
| 一键开关-注入 | admin 登录 → 账户管理 | 非 admin 行有"开通云端/关闭云端"按钮，admin 行无 |
| 一键开关-开通 | 点 local 用户的"开通云端" | 按钮变"关闭云端"，标签变[双模式]；GET 确认 `allowedMode:'both'` |
| 一键开关-关闭 | 点 both 用户的"关闭云端" | 按钮变"开通云端"，标签变[仅离线]；KV 确认 `local` |
| 一键开关-断网 | 断网点切换 | alert"切换失败"，按钮恢复，KV 未变 |
| local 用户 UI | local 普通用户登录 → 基础设置 | "离线数据同步"区块隐藏，无模式切换入口 |
| both 用户改密 | both 普通用户改自己密码 | 成功（diff-check 通过） |
| 越权拦截 | 用普通用户 header POST 含新增 admin 账号的列表 | 403 |

### 已知限制（文档提醒）
- **管理员勿把自己设为 local**：`handleEditUser` 允许 admin 改自己模式为 local，一旦如此 admin 的 `fetch` 被离线脚本拦截，用户管理失效。云端网页禁改无法在 prompt 流程加保护，需管理员自律。
- **跨设备非实时**：admin 在 A 设备改用户 X 为 local，B 设备上 X 仍按旧 `cloud_currentUser` 行为，直到 X 重新登录/刷新才同步。最终一致。
- **GET 仍返回明文密码**：既有问题（登录下拉需要 GET），本次不在范围内，建议后续单独加固。

---

## 待确认
- 一键开关交互采用"账户管理列表每行加开通/关闭云端按钮"（在 `local↔both` 间切换），未涉及 `cloud`（仅云端）模式——该模式保留给管理员三步 prompt 精细设置。如需调整请指出。
