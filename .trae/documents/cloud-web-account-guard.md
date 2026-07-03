# 云端网页直接实现账号管控方案

## 背景

上一轮通过 `MainActivity.java` 的 `injectAccountGuardScript` 注入 JS 实现"注册封禁 + 一键开关云端 + local 用户隐藏状态 UI"，但**实测功能不生效**（注入时序、DOM 结构、函数引用不可控）。

用户决定**正式解除"禁止修改 tcm-prescription-system 子模块"的硬约束**，直接修改云端网页源码（index.html）实现这些功能。

探索发现云端网页已具备大部分基础设施：
- 注册入口实际已无 HTML 调用点（`showRegisterModal` 无 caller，`registerModal` 是死代码）
- `#offline-sync-section` + `updateOfflineSyncInfo` 已原生存在
- `syncOfflinePrescriptions` 已原生存在
- `allowedMode` 字段已在 `getUsers`/`renderUserList`/`handleEditUser`/`handleAddUser` 中贯通
- 普通用户默认 `allowedMode='local'`、管理员默认 `'both'` 已就绪

## 目标

1. **账号只能管理员云端创建**：注册功能彻底封禁（函数体改为 alert + 删除 registerModal HTML）
2. **普通用户默认纯离线**：已是默认值，无需改
3. **普通用户不显示状态、无切换按钮**：在 `updateOfflineSyncInfo` 中对 local 非管理员隐藏 `#offline-sync-section`
4. **管理员后台一键开关云端权限**：在 `renderUserList` 中为每个非 admin 用户追加"开通云端/关闭云端"按钮，一键切换 `local ↔ both`
5. **开通后才可联网同步**：`injectOfflineScript` 已按 `allowedMode` 控制 fetch/XHR 拦截，无需改

## 改动清单

### 改动 1：封禁注册功能

**文件**：`tcm-prescription-system/index.html`

**1a. 重写 `showRegisterModal`（2050-2056 行）**

将函数体改为直接 alert，不再打开 modal：

```javascript
function showRegisterModal() {
    alert('本系统禁止自助注册，请联系管理员创建账号。');
}
```

**1b. 重写 `handleRegister`（2058 行起）**

将函数体改为直接 alert（保留函数名避免调用点报错）：

```javascript
async function handleRegister() {
    alert('本系统禁止自助注册，请联系管理员创建账号。');
}
```

**1c. 删除 `registerModal` HTML（537-566 行）**

整段删除 `<div id="registerModal" class="modal">...</div>`，消除死代码。

### 改动 2：管理员一键开关云端权限

**文件**：`tcm-prescription-system/index.html`

**2a. 修改 `renderUserList`（2156-2180 行）**

在每行 `.user-item-actions` 中为非 admin 用户追加一键切换按钮。原 `<button class="user-item-btn btn-primary" onclick="handleEditUser('${user.username}')">编辑</button>` 后面插入：

```javascript
${user.username !== 'admin' ? (mode === 'local'
    ? `<button class="user-item-btn btn-primary" style="background:#2196f3;" onclick="toggleUserCloudMode('${user.username}')">开通云端</button>`
    : `<button class="user-item-btn btn-warning" style="background:#ff9800;color:white;" onclick="toggleUserCloudMode('${user.username}')">关闭云端</button>`
) : ''}
```

**2b. 新增 `toggleUserCloudMode` 函数**（插入到 `handleEditUser` 之前，约 2182 行前）

```javascript
async function toggleUserCloudMode(username) {
    if (!currentUser || currentUser.role !== 'admin') {
        alert('只有管理员可以切换云端权限');
        return;
    }
    const users = await getUsers();
    const user = users.find(u => u.username === username);
    if (!user) return;
    const currentMode = user.allowedMode || 'both';
    const newMode = currentMode === 'local' ? 'both' : 'local';
    user.allowedMode = newMode;
    const saveSuccess = await saveUsers(users);
    // 若改的是当前登录用户，同步本地状态
    if (currentUser.username === username) {
        currentUser.allowedMode = newMode;
        localStorage.setItem('cloud_currentUser', JSON.stringify(currentUser));
        updateUserDisplay();
    }
    await renderUserList();
    const modeText = newMode === 'local' ? '仅离线' : '双模式';
    alert(saveSuccess
        ? `✅ 已切换为【${modeText}】\n数据已同步到云端。`
        : `⚠️ 已切换为【${modeText}】\n云端同步失败，可在设置中手动同步。`);
}
```

### 改动 3：local 普通用户隐藏离线同步状态

**文件**：`tcm-prescription-system/index.html`

**修改 `updateOfflineSyncInfo`（6319-6332 行）**

在函数开头加段，判断当前用户是否为 local 非管理员，若是则隐藏整个 `#offline-sync-section`，否则显示并继续原有逻辑：

```javascript
function updateOfflineSyncInfo() {
    const sectionEl = document.getElementById('offline-sync-section');
    const infoEl = document.getElementById('offline-sync-info');
    // 普通用户且纯离线模式：隐藏整个区块（不显示状态、无切换按钮）
    const isLocalNormal = currentUser
        && currentUser.role !== 'admin'
        && (currentUser.allowedMode || 'both') === 'local';
    if (sectionEl) {
        sectionEl.style.display = isLocalNormal ? 'none' : '';
    }
    if (!infoEl || isLocalNormal) return;
    // ... 以下保留原有逻辑
    const mode = (currentUser && currentUser.allowedMode) || 'both';
    const modeText = mode === 'cloud' ? '仅云端' : mode === 'local' ? '仅离线' : '双模式';
    // ... 原有 innerHTML 渲染不变
}
```

### 改动 4：加固 handleEditUser 模式修改权限

**文件**：`tcm-prescription-system/index.html`

在 `handleEditUser`（2182 行）的模式选择 prompt 之前加一道防御：若当前用户非 admin，跳过模式修改步骤（防御纵深，即使 UI 被绕过也改不了）。

实际由于 `showUserManageModal` 已有 admin 校验，普通用户进不来此弹窗，此改动为可选加固。**本次暂不改**，避免过度工程。

### 改动 5：移除 MainActivity.java 的注入脚本

**文件**：`android/app/src/main/java/com/tcm/prescription/MainActivity.java`

**5a. 删除 `injectAccountGuardScript` 方法**（394-511 行）

整段删除。

**5b. 删除 `onPageFinished` 中的两次 `postDelayed` 调用**（156-157 行）

删除：
```java
// 注入账号管控脚本（注册封禁 + 一键开关云端 + local用户隐藏状态UI）
new Handler().postDelayed(() -> injectAccountGuardScript(view), 1500);
new Handler().postDelayed(() -> injectAccountGuardScript(view), 3000);
```

**保留**：`injectOfflineScript`（离线处方缓存，正常工作中）、`injectLayoutFixScript`（布局修正）。

### 改动 6：部署云端 + 重建 APK

**6a. 部署云端网页**
```bash
cd tcm-prescription-system
git add index.html
git commit -m "feat: 账号管控直接实现于云端网页（注册封禁+一键开关云端+local用户隐藏状态UI）"
git push origin main
```
Cloudflare Pages 自动部署（约 1-2 分钟生效）。

**6b. 重建 APK**
```powershell
cd android
.\gradlew.bat assembleRelease
```
新 APK 路径：`android/app/build/outputs/apk/release/app-release.apk`

### 改动 7：更新 project_memory.md

解除"禁止修改 tcm-prescription-system 子模块 index.html"的硬约束，记录新决策：
- 账号管控功能（注册封禁、一键开关云端、local UI 隐藏）直接在云端网页 index.html 中实现
- 仅 `injectOfflineScript`（离线处方缓存）保留在 MainActivity.java
- users.js 的 POST 分级鉴权保留作为 API 层防御纵深

## 验证步骤

| # | 测试项 | 操作 | 预期 |
|---|---|---|---|
| 1 | 注册封禁 | 浏览器控制台执行 `showRegisterModal()` | 弹 alert "本系统禁止自助注册…" |
| 2 | registerModal 已删 | 检查 DOM `document.getElementById('registerModal')` | 返回 `null` |
| 3 | 一键开关-按钮出现 | admin 登录 → 账户管理 | 非 admin 用户行有"开通云端"或"关闭云端"按钮 |
| 4 | 一键开关-开通 | 点击 local 用户的"开通云端" | 弹"已切换为【双模式】"，按钮变"关闭云端" |
| 5 | 一键开关-关闭 | 点击 both 用户的"关闭云端" | 弹"已切换为【仅离线】"，按钮变"开通云端" |
| 6 | local 用户 UI 隐藏 | local 普通用户登录 → 基础设置 | `#offline-sync-section` 不可见 |
| 7 | admin 仍可见状态 | admin 登录 → 基础设置 | `#offline-sync-section` 正常显示模式与待同步数 |
| 8 | APP 同步生效 | 卸载旧 APK → 安装新 APK → 测试 1-7 | 与网页版行为一致 |
| 9 | 离线处方缓存不受影响 | local 用户保存处方 | 处方进入 `offline_prescriptions` 队列（`injectOfflineScript` 仍工作） |

## 假设与决策

1. **保留 `injectOfflineScript` 不动**：离线处方缓存是独立功能，之前正常工作，本次不触碰。
2. **保留 users.js POST 分级鉴权不动**：作为 API 层防御纵深，即使前端被绕过也无法越权。
3. **保留 `handleEditUser` 三步 prompt**：作为管理员精细编辑（改用户名/姓名/密码/模式）的补充入口，一键按钮只切换 `local↔both`。
4. **一键开关不涉及 `cloud` 模式**：`cloud`（仅云端）保留给三步 prompt 精细设置，避免一键按钮误操作。
5. **改动影响所有平台**（网页、Electron、APP）：所有改动对所有平台行为一致且合理——注册封禁、admin 专属一键开关、local 用户隐藏状态，在所有平台都适用。
6. **解除 index.html 修改禁令**：用户明确授权。仅 `wrangler.toml` 和 KV 绑定仍禁止触碰。

## 已知限制

- 一键开关仅在 `local↔both` 间切换；`cloud` 模式需走三步 prompt。
- 跨设备非实时：admin 在 A 设备改 X 模式，B 设备上 X 需重新登录/刷新才同步（这是 KV 读取特性，非本次改动引入）。
- GET /api/users 仍返回明文密码（既有问题，本次不在范围内）。
