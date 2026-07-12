# 统一设置：管理员永远云端，普通用户历史处方本地+同步

## Context

当前云端桌面版和云端APP（云端网页版）的用户权限模式不统一：
- 云端桌面版：管理员默认 `both`，普通用户默认 `local`（纯本地，不同步云端）
- 云端网页版：根据 `allowCloud` 标志，管理员走 `cloud`，普通用户走 `offline`（纯本地，不同步云端）

问题：普通用户处方仅存本地，管理员无法从云端查看普通用户的处方数据。

用户要求统一设置为：
- **管理员**（clinic_admin / platform_admin / admin）：永远使用云端功能
- **普通用户**（doctor / user）：历史处方走本地（快速查看），但保存后同步到云端（管理员可见）

## 修改方案

### 1. 云端桌面版（2个文件，相同修改）

**文件**：
- [cloud_desktop/index.html](file:///c:/Users/61767/Documents/trae_projects/kyt-zy/cloud_project/cloud_desktop/index.html) L1407-1408
- [tcm-prescription-system/cloud_project/cloud_desktop/index.html](file:///c:/Users/61767/Documents/trae_projects/kyt-zy/cloud_project/tcm-prescription-system/cloud_project/cloud_desktop/index.html) L1407-1408

**修改 `getAllowedMode()` 函数**（L1407）：

当前代码：
```javascript
function getAllowedMode() {
    return (currentUser && currentUser.allowedMode) || 'both';
}
```

改为：
```javascript
function getAllowedMode() {
    if (!currentUser) return 'both';
    // 统一权限：管理员永远云端，普通用户离线优先+联网同步
    if (isClinicAdmin(currentUser) || isPlatformAdmin(currentUser)) {
        return 'cloud';
    }
    return 'both';
}
```

**修改 `getUsers()` 中的默认 allowedMode**（L2865）：

当前代码：
```javascript
allowedMode: user.allowedMode || (isClinicAdmin(user) ? 'both' : 'local')
```

改为：
```javascript
allowedMode: user.allowedMode || (isClinicAdmin(user) ? 'cloud' : 'both')
```

### 2. 云端网页版/云端APP（React）

**文件**：[tcm-prescription-system/src/utils/api.ts](file:///c:/Users/61767/Documents/trae_projects/kyt-zy/cloud_project/tcm-prescription-system/src/utils/api.ts)

#### 2a. 修改 `loadPrescriptions` 函数（L294-341）

当前逻辑：`appMode === 'offline'` 或 `!currentUserAllowCloud` → 从本地加载；否则从云端加载。

改为：管理员（`user.role === 'admin'`）永远从云端加载；普通用户从本地加载（离线优先），本地空时回退云端。

#### 2b. 修改 `savePrescription` 函数（L226-292）

当前逻辑：`appMode === 'offline'` → 仅存本地；`!currentUserAllowCloud` → 报错；否则存云端+本地。

改为：管理员保存到云端+本地；普通用户保存到本地（synced=0）+ 异步同步到云端。

#### 2c. 修改 `deletePrescription` 函数（L370-401）

当前逻辑：`appMode === 'offline'` → 仅删本地；`!currentUserAllowCloud` → 报错；否则删云端。

改为：管理员从云端删除；普通用户从本地删除 + 异步删除云端。

#### 2d. 修改 `Login.tsx`（L56-62）

当前逻辑：根据 `allowCloud` 设置 `appMode`。

改为：管理员设 `cloud` 模式；普通用户也设 `cloud` 模式（允许保存时同步），但 `loadPrescriptions` 内部根据角色决定数据源。

**文件**：[tcm-prescription-system/src/pages/Login.tsx](file:///c:/Users/61767/Documents/trae_projects/kyt-zy/cloud_project/tcm-prescription-system/src/pages/Login.tsx) L56-62

## 验证方法

1. **管理员登录**：历史处方从云端加载，保存处方直接存云端，行为不变
2. **普通用户登录**：历史处方从本地加载（快速），保存处方时落本地+异步同步云端
3. **管理员查看所有处方**：能在云端看到普通用户同步上来的处方
4. 云端APP和云端桌面程序行为一致
