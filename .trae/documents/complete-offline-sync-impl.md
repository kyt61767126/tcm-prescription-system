# 完成 APP 离线 SQLite + 双向同步改造（剩余工作）

## 一、Summary（概要）

延续上一会话已批准的 `offline-sqlite-sync.md` 方案，完成手机 APP 离线优先 + 双向同步改造的**剩余 7 项核心改造 + 1 项修正**。所有改动集中在 `tcm-prescription-system/index.html`（云端网页，APP WebView 直接加载），不改动任何后台 API（`functions/api/*.js`），不改 `wrangler.toml` 与 KV 绑定。

完成后达到的效果：
- 断网可开方、保存、调取药材/方剂（local/both 模式）
- 恢复网络后自动推送离线处方、拉取云端最新数据（both 模式）
- 多端冲突按 `updatedAt` 时间戳解决（云端新则让云端胜）
- 电脑/网页/手机三端共用同一套账号与后台接口

---

## 二、Current State Analysis（现状分析）

### 已完成的工作（验证通过）

| 项 | 文件 | 状态 |
|---|---|---|
| MainActivity.java 删除 injectOfflineScript | `android/.../MainActivity.java` | ✅ 已完成（237 行） |
| LocalDB 模块（17 方法，3 张表） | `index.html` L1100-1196 | ✅ 已注入 |
| SyncEngine 模块（9 方法，push/pull/run/init） | `index.html` L1199-1326 | ✅ 已注入 |
| getAllowedMode / offlineCapable 辅助函数 | `index.html` L1092-1098 | ✅ 已注入 |
| getPrescriptionsFromCloud 离线优先 | `index.html` L1755-1839 | ✅ 已改造 |
| getMedicinesFromCloud 离线优先（去 `_t=`） | `index.html` L1842-1909 | ✅ 已改造 |

### 待完成的剩余工作

| # | 函数 / 位置 | 当前问题 |
|---|---|---|
| 1 | `getFormulasFromCloud` (L1941-1980) | 仍带 `_t=${Date.now()}`，无 LocalDB 缓存 |
| 2 | `savePrescriptionsToCloud` (L2038-2082) | 纯云端 POST，无离线落库（synced=0） |
| 3 | `deletePrescriptionFromCloud` (L2085-2105) | 纯云端 DELETE，无 markDeleted |
| 4 | `saveMedicinesToCloud` (L1912-1938) | 成功后未刷新 LocalDB `medicines_all` |
| 5 | `saveFormulasToCloud` (L1983-2009) | 成功后未刷新 LocalDB `formulas_all` |
| 6 | `loadData` (L2815) | 未调用 `SyncEngine.init()`，定时器/事件监听未启动 |
| 7 | `updateOfflineSyncInfo` (L6580-6601) | 仍读 `localStorage.offline_prescriptions` 旧队列 |
| 8 | `syncOfflinePrescriptions` (L6604-6623) | 旧的 localStorage 实现，需删除并替换为 SyncEngine.run() 触发 |
| 9（修正） | `SyncEngine._cloudGetPrescriptions` (L1209) | URL 带 `?user=<me>` 参数，但后端不读取该参数（被忽略），需去掉以保持清洁 |

### 探索中发现的关键约束（必须在改动中遵守）

1. **`GET /api/prescriptions` 不支持 `?user=me` 参数**：后端按 Authorization 头过滤（普通用户只拿自己的，管理员拿全部）。`SyncEngine._cloudGetPrescriptions` 当前 URL 带了无效参数，需去掉。**不改后端**（用户明确"沿用接口"）。
2. **`updatedAt` 是 ISO 字符串**（非数字）：LocalDB.upsertPrescription 已用 `new Date(ua).getTime()` 转入 `updated_at_ms` 列（L1154），无需改动。
3. **POST /api/prescriptions 无版本校验，`idMap` 后写覆盖前写**：冲突解决必须在客户端推送前完成。`SyncEngine.push` (L1261-1298) 已实现时间戳比较（云端 `cloudMs > localMs` 时跳过推送并让云端覆盖本地），符合要求。
4. **`savePrescriptionsToCloud` 调用方契约**：调用点 L4376 使用 `response.success` 与 `response.savedPrescription`，离线降级时必须返回 `{success:true, savedPrescription:<record>, offline:true}` 保持兼容。
5. **`savePrescriptionsToCloud` 入参是数组**：需遍历每条处方分别 upsert。
6. **`updateOfflineSyncInfo` 调用点**：SyncEngine.run (L1253) 与其他多处 fire-and-forget 调用。改为 `async` 不影响调用方（不 await 也工作）。
7. **`allowedMode` 三态 vs `toggleUserCloudMode` 两态切换**：是既有行为，用户已确认"管理员控制、保持现状"，本次不新增 UI、不改动。
8. **`getAllowedMode` 默认值 `'both'`**：与后端普通用户默认 `'local'` 存在差异，但属既有行为，本次不动。
9. **方剂实际有 `updatedAt` 字段**（POST 时附加），但因全量覆盖不能作增量依据，结论"仅下拉、不上传"仍正确。

---

## 三、Proposed Changes（具体改动方案）

所有改动均在 `c:\Users\61767\Documents\trae_projects\kyt-zy\tcm-prescription-system\index.html`。

### 改动 1：修正 SyncEngine._cloudGetPrescriptions（L1207-1214）

**Why**：去掉无效的 `?user=<me>` 参数，依靠 auth 头语义过滤（后端已实现）。

**How**：将 L1209 改为：
```javascript
const url = CLOUD_API_BASE + '/prescriptions';
```
其余逻辑不变。同步修改 `_cloudDeletePrescription` (L1227) 的 URL，去掉无效的 `&user=...` 段（后端 DELETE 也不读 user 参数，靠 auth 头）：
```javascript
const url = CLOUD_API_BASE + '/prescriptions?id=' + id;
```

### 改动 2：getFormulasFromCloud 离线优先（L1941-1980）

**Why**：方剂库需断网可读，与 getMedicinesFromCloud 同模式。

**How**：整体替换 L1941-1980，新实现：
```javascript
async function getFormulasFromCloud(forceRefresh = false) {
    if (!forceRefresh && DataCache.isValid('formulas')) {
        return DataCache.get('formulas');
    }
    const canOffline = offlineCapable();
    // 1) 离线优先：先查 LocalDB
    if (canOffline) {
        try {
            await LocalDB.ready();
            const cached = await LocalDB.getCache('formulas_all');
            if (cached && Array.isArray(cached) && cached.length > 0) {
                DataCache.set('formulas', cached);
                // both 模式在线时后台同步（不阻塞返回）
                if (getAllowedMode() === 'both' && navigator.onLine) {
                    SyncEngine.run().catch(e => console.warn('SyncEngine 后台同步失败:', e));
                }
                return cached;
            }
        } catch (e) { console.warn('LocalDB formulas 读取失败:', e); }
    }
    // 2) 本地空 + local 模式/离线：返回空数组
    if (!navigator.onLine || getAllowedMode() === 'local') {
        return canOffline ? [] : null;
    }
    // 3) 云端拉取
    try {
        const url = `${CLOUD_API_BASE}/formulas`;  // 去掉 _t 时间戳
        const options = {};
        if (currentUser) {
            const authToken = safeBtoa(`${currentUser.username}:${currentUser.role || 'user'}`);
            options.headers = { 'Authorization': `Basic ${authToken}` };
        }
        const response = await cloudFetch(url, options);
        if (response.success && response.data) {
            DataCache.set('formulas', response.data);
            if (canOffline) {
                try { await LocalDB.setCache('formulas_all', response.data); } catch(e) {}
            }
            return response.data;
        }
    } catch (error) { console.warn('Failed to get formulas from cloud:', error); }
    // 4) fallback
    if (DataCache.has('formulas')) return DataCache.get('formulas');
    if (canOffline) {
        try { return await LocalDB.getCache('formulas_all') || null; } catch(e) {}
    }
    return null;
}
```

### 改动 3：savePrescriptionsToCloud 离线优先写（L2038-2082）

**Why**：断网时处方必须能保存，恢复网络后自动推送。

**How**：整体替换 L2038-2082，新实现：
```javascript
async function savePrescriptionsToCloud(prescriptions) {
    try {
        if (!currentUser) {
            console.error('User not logged in');
            alert('请先登录后再保存处方');
            return null;
        }
        const arr = Array.isArray(prescriptions) ? prescriptions : [prescriptions];
        const canOffline = offlineCapable();
        const isOnline = navigator.onLine;
        const mode = getAllowedMode();

        // 1) local 模式：仅落本地，synced=0
        if (canOffline && mode === 'local') {
            let lastSaved = null;
            for (const p of arr) {
                const record = { ...p, updatedAt: p.updatedAt || new Date().toISOString() };
                await LocalDB.upsertPrescription(record, { synced: 0, deleted: 0 });
                lastSaved = record;
            }
            if (window.updateOfflineSyncInfo) updateOfflineSyncInfo();
            return { success: true, savedPrescription: lastSaved, offline: true };
        }

        // 2) both 模式在线：直连云端，成功后回写本地 synced=1
        if (canOffline && mode === 'both' && isOnline) {
            try {
                const authToken = safeBtoa(`${currentUser.username}:${currentUser.role}`);
                const response = await fetch(`${CLOUD_API_BASE}/prescriptions`, {
                    method: 'POST',
                    headers: { 'Authorization': `Basic ${authToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prescription: arr })
                });
                const data = await response.json();
                if (data.success) {
                    // 云端返回的 savedPrescription（含 updatedAt 等）回写本地
                    const saved = data.savedPrescription || arr[arr.length - 1];
                    try {
                        const savedArr = Array.isArray(saved) ? saved : [saved];
                        for (const s of savedArr) {
                            await LocalDB.upsertPrescription(s, { synced: 1, deleted: 0 });
                        }
                    } catch(e) { console.warn('LocalDB 回写失败:', e); }
                    return data;
                }
                // 云端返回失败：降级落本地
                alert('处方保存失败：' + (data.error || '未知错误'));
                return null;
            } catch (netErr) {
                // 网络异常：降级落本地 synced=0
                console.warn('云端保存网络异常，降级落本地:', netErr);
                let lastSaved = null;
                for (const p of arr) {
                    const record = { ...p, updatedAt: p.updatedAt || new Date().toISOString() };
                    await LocalDB.upsertPrescription(record, { synced: 0, deleted: 0 });
                    lastSaved = record;
                }
                if (window.updateOfflineSyncInfo) updateOfflineSyncInfo();
                return { success: true, savedPrescription: lastSaved, offline: true };
            }
        }

        // 3) both 模式离线：落本地 synced=0
        if (canOffline && mode === 'both' && !isOnline) {
            let lastSaved = null;
            for (const p of arr) {
                const record = { ...p, updatedAt: p.updatedAt || new Date().toISOString() };
                await LocalDB.upsertPrescription(record, { synced: 0, deleted: 0 });
                lastSaved = record;
            }
            if (window.updateOfflineSyncInfo) updateOfflineSyncInfo();
            return { success: true, savedPrescription: lastSaved, offline: true };
        }

        // 4) cloud 模式或不可离线：原纯云端逻辑
        const authToken = safeBtoa(`${currentUser.username}:${currentUser.role}`);
        const response = await fetch(`${CLOUD_API_BASE}/prescriptions`, {
            method: 'POST',
            headers: { 'Authorization': `Basic ${authToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ prescription: arr })
        });
        const data = await response.json();
        if (data.success) return data;
        alert('处方保存失败：' + (data.error || '未知错误'));
        return null;
    } catch (error) {
        console.error('Failed to save prescriptions:', error);
        alert('处方保存失败：' + error.message);
        return null;
    }
}
```

**返回值兼容性**：调用方 L4376 读 `response.success` + `response.savedPrescription`，离线返回的 `{success:true, savedPrescription, offline:true}` 完全兼容。

### 改动 4：deletePrescriptionFromCloud markDeleted（L2085-2105）

**Why**：断网时删除需记录，恢复网络后推送删除到云端。

**How**：整体替换 L2085-2105，新实现：
```javascript
async function deletePrescriptionFromCloud(prescriptionId) {
    try {
        if (!currentUser) {
            console.error('User not logged in');
            return false;
        }
        const canOffline = offlineCapable();
        const isOnline = navigator.onLine;
        const mode = getAllowedMode();

        // 1) local 模式：仅 markDeleted
        if (canOffline && mode === 'local') {
            await LocalDB.markDeleted(prescriptionId);
            if (window.updateOfflineSyncInfo) updateOfflineSyncInfo();
            return true;
        }

        // 2) both 模式离线：markDeleted，待同步推送
        if (canOffline && mode === 'both' && !isOnline) {
            await LocalDB.markDeleted(prescriptionId);
            if (window.updateOfflineSyncInfo) updateOfflineSyncInfo();
            return true;
        }

        // 3) both 模式在线 / cloud 模式：直连云端 DELETE，成功后 markSynced
        const authToken = safeBtoa(`${currentUser.username}:${currentUser.role}`);
        const url = `${CLOUD_API_BASE}/prescriptions?id=${prescriptionId}`;
        const response = await cloudFetch(url, {
            method: 'DELETE',
            headers: { 'Authorization': `Basic ${authToken}` }
        });
        if (response.success && canOffline) {
            try {
                // 云端删除成功，本地标记为已同步删除（避免后续 push 重复推送）
                await LocalDB.markDeleted(prescriptionId);
                await LocalDB.markSynced(prescriptionId);
            } catch(e) {}
        }
        return response.success;
    } catch (error) {
        console.warn('Failed to delete prescription from cloud:', error);
        // 网络异常降级：markDeleted
        if (offlineCapable()) {
            try { await LocalDB.markDeleted(prescriptionId); } catch(e) {}
        }
        return false;
    }
}
```

### 改动 5：saveMedicinesToCloud 成功后刷新 LocalDB（L1912-1938）

**Why**：管理员修改药品后，本地缓存需同步更新，避免下次读取旧值。

**How**：在 L1929-1931 `if (response.success)` 块内追加 LocalDB 写入：
```javascript
if (response.success) {
    DataCache.invalidate('medicines');
    if (offlineCapable()) {
        try { await LocalDB.setCache('medicines_all', medicines); } catch(e) { console.warn('LocalDB medicines 刷新失败:', e); }
    }
}
```

### 改动 6：saveFormulasToCloud 成功后刷新 LocalDB（L1983-2009）

**Why**：与 saveMedicinesToCloud 同模式。

**How**：在 L2000-2002 `if (response.success)` 块内追加：
```javascript
if (response.success) {
    DataCache.invalidate('formulas');
    if (offlineCapable()) {
        try { await LocalDB.setCache('formulas_all', formulas); } catch(e) { console.warn('LocalDB formulas 刷新失败:', e); }
    }
}
```

### 改动 7：loadData 调用 SyncEngine.init()（L2815）

**Why**：SyncEngine.init() 注册 online/visibilitychange 监听与 60s 定时器，但从未被调用，导致自动同步未启动。

**How**：在 `loadData` 函数开头（L2816 `console.log('=== loadData() 开始 ===')` 之前）插入：
```javascript
async function loadData() {
    // 启动同步引擎（幂等，仅首次执行生效；注册 online/visibilitychange/60s 定时器）
    try { SyncEngine.init(); } catch(e) { console.warn('SyncEngine.init 失败:', e); }
    
    console.log('=== loadData() 开始 ===');
    // ... 原逻辑不变
}
```

**注意**：`init()` 必须在 `currentUser` 已设置后调用。loadData 的所有调用点（handleLogin L1960、init L3430/L3548）都在 currentUser 设置之后，符合要求。

### 改动 8：updateOfflineSyncInfo 改读 LocalDB（L6580-6601）

**Why**：旧实现读 `localStorage.offline_prescriptions` 旧队列，与新的 LocalDB 体系不一致，计数永远为 0。

**How**：整体替换 L6580-6601，改为 async 并读 LocalDB：
```javascript
async function updateOfflineSyncInfo() {
    const sectionEl = document.getElementById('offline-sync-section');
    const infoEl = document.getElementById('offline-sync-info');
    const isLocalNormal = currentUser
        && currentUser.role !== 'admin'
        && (currentUser.allowedMode || 'both') === 'local';
    if (sectionEl) {
        sectionEl.style.display = isLocalNormal ? 'none' : '';
    }
    if (!infoEl || isLocalNormal) return;
    const mode = (currentUser && currentUser.allowedMode) || 'both';
    const modeText = mode === 'cloud' ? '仅云端' : mode === 'local' ? '仅离线' : '双模式';
    const onlineStatus = navigator.onLine ? '在线' : '离线';
    let count = 0, syncStatus = null;
    if (offlineCapable()) {
        try {
            count = await LocalDB.countUnsynced();
            syncStatus = await LocalDB.getSyncStatus();
        } catch(e) { console.warn('updateOfflineSyncInfo 读取 LocalDB 失败:', e); }
    }
    const lastPush = syncStatus && syncStatus.last_push ? new Date(syncStatus.last_push).toLocaleString('zh-CN') : '—';
    const lastPull = syncStatus && syncStatus.last_pull ? new Date(syncStatus.last_pull).toLocaleString('zh-CN') : '—';
    infoEl.innerHTML = `
        <div>当前模式: <b>${modeText}</b> (${onlineStatus})</div>
        <div>待同步处方: <b style="color:#f44336;">${count}</b> 条</div>
        <div style="font-size:11px;color:#666;">上次推送: ${lastPush} | 上次拉取: ${lastPull}</div>
        ${count > 0 ? '<button onclick="syncOfflinePrescriptions()" style="margin-top:6px;padding:4px 12px;background:#4caf50;color:white;border:none;border-radius:4px;font-size:12px;">立即同步</button>' : '<span style="color:#4caf50;">✓ 全部已同步</span>'}
    `;
}
```

**注意**：改为 async 后，原 fire-and-forget 调用点（如 SyncEngine.run L1253）无需改动；onclick="updateOfflineSyncInfo()" 也兼容（返回 Promise 被忽略）。

### 改动 9：替换 syncOfflinePrescriptions 为 SyncEngine.run 触发（L6604-6623）

**Why**：旧的 localStorage 实现已废弃，"立即同步"按钮应触发新的 SyncEngine.run()。

**How**：整体替换 L6604-6623：
```javascript
async function syncOfflinePrescriptions() {
    if (!offlineCapable()) {
        alert('当前模式不支持离线同步');
        return;
    }
    if (!navigator.onLine) {
        alert('当前离线，请联网后再同步');
        return;
    }
    if (getAllowedMode() !== 'both') {
        alert('仅双模式(both)支持同步，当前模式: ' + getAllowedMode());
        return;
    }
    alert('开始同步...');
    try {
        await SyncEngine.run();
        alert('同步完成');
    } catch(e) {
        alert('同步失败: ' + e.message);
    }
    updateOfflineSyncInfo();
}
```

**保留函数名 `syncOfflinePrescriptions`**：因为 updateOfflineSyncInfo 的"立即同步"按钮 onclick 仍引用此名，避免改动 HTML。

---

## 四、Assumptions & Decisions（假设与决策）

1. **不改后台 API**：用户明确"原有账号、后台接口全部沿用"。`?user=me` 参数缺失通过"去掉参数、依靠 auth 头"解决，不新增后端代码。
2. **不新增 UI / 模式开关**：用户已确认"管理员控制、保持现状"。`toggleUserCloudMode` 两态切换行为不变。
3. **保留 `syncOfflinePrescriptions` 函数名**：避免改动 HTML onclick 绑定，函数体替换为 SyncEngine.run 触发。
4. **`updateOfflineSyncInfo` 改为 async**：调用方均 fire-and-forget，兼容。
5. **冲突解决策略**：`SyncEngine.push` 已实现——云端 `updatedAt` 更新则跳过推送并让云端覆盖本地（L1280-1282）；本地新或云端无则推送。本次不改动 SyncEngine 内部逻辑。
6. **方剂/药品仅下拉不上传**：`SyncEngine.pull` (L1314-1315) 已实现 `_pullCache('medicines_all'/'formulas_all')`，符合方案。
7. **`allowedMode` 默认值差异**（前端 'both' vs 后端普通用户 'local'）：既有行为，本次不动。
8. **savePrescriptionsToCloud 离线降级返回 `{success:true, offline:true}`**：调用方按 success 判断，不会因 offline 字段破坏逻辑。
9. **删除 markDeleted + markSynced 的语义**：markDeleted 设 deleted=1, synced=0（待推送删除）；markSynced 设 synced=1。云端删除成功后两个都调，避免后续 push 重复推送删除请求。

---

## 五、Verification Steps（验证步骤）

实施完成后，按以下顺序真机回归（参照 offline-sqlite-sync.md 第六章）：

1. **基础登录**：管理员账号登录 APP，确认能正常加载药品/方剂/处方。
2. **LocalDB 初始化**：在 WebView console 执行 `LocalDB.ready()` 返回 true，`LocalDB.countUnsynced()` 返回 0。
3. **断网开方**：飞行模式下新建处方并保存，提示成功（offline 降级），`LocalDB.countUnsynced()` 返回 ≥1。
4. **断网调取**：飞行模式下打开历史处方列表，能看到本地保存的处方；药品/方剂下拉能加载本地缓存。
5. **断网删除**：飞行模式下删除处方，`LocalDB` 中该处方 deleted=1, synced=0。
6. **恢复网络自动同步**：关闭飞行模式，等待 60s 定时器或手动点击"立即同步"按钮，确认 `countUnsynced()` 归零，云端 `/api/prescriptions` GET 能查到该处方。
7. **冲突解决**：在电脑端修改同一处方（updatedAt 更新），手机端恢复网络后 SyncEngine.run，确认手机本地版本被云端版本覆盖。
8. **管理员 toggleUserCloudMode**：切换某用户为 local 模式，该用户登录 APP 后保存处方仅落本地，`/api/prescriptions` GET 查不到。
9. **三端互通**：电脑端开方 → 网页端能看到 → 手机端 SyncEngine.pull 后也能看到。
10. **updateOfflineSyncInfo 显示**：UI 显示正确的模式、在线状态、待同步条数、上次推送/拉取时间。

---

## 六、风险与回退

- **风险 1**：`savePrescriptionsToCloud` 改造后调用方未正确处理 `offline:true` 字段 → 验证步骤 3、6 覆盖；如发现问题，回退为纯云端逻辑（仅删 `offline:true` 分支）。
- **风险 2**：`SyncEngine.init` 在 currentUser 未设置时被调用 → 已确认所有 loadData 调用点都在 currentUser 设置后；如出现 init 时 currentUser 为空，init 内部 `if (!currentUser) return` (L1242) 会保护。
- **风险 3**：LocalDB.ready() 失败（非 Capacitor 环境，如纯浏览器） → `offlineCapable()` 返回 false，所有改动降级为原纯云端逻辑，无功能损失。
- **回退**：所有改动集中在 index.html 单文件，可通过 git revert 单次提交回退；不影响 wrangler.toml、KV 绑定、后台 API。
