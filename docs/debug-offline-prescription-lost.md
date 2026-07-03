# Debug Session: offline-prescription-lost

**Status**: [CLOSED] ✅ 已解决
**Session ID**: `offline-prescription-lost`
**Created**: 2026-06-26
**Symptom**: 手机 APP 离线状态历史处方，开通云端权限后处方丢失（用户第二次报告，上次修复未解决）

## 问题描述
- **实际行为**：用户在离线（local）模式下保存了处方，管理员开通云端权限后（mode: local → both），用户重新登录后历史处方不显示
- **预期行为**：开通云端后，本地历史处方应保留并合并云端数据，不丢失
- **复现步骤**：1) local 模式下保存处方 2) 管理员开通云端权限 3) 用户重新登录 4) 历史处方列表为空
- **环境**：Android APP（Capacitor WebView）+ Cloudflare Pages 云端

## 可证伪假设（Hypotheses）

### H1: 用户卸载重装 APP 导致 SQLite 数据被清除
- **观察点**：LocalDB.ready() 成功，但 getPrescriptions 返回空数组（本地确无数据）
- **可证伪**：如果 `localList.length > 0`，假设被证伪

### H2: LocalDB.ready() 失败静默回退云端，本地有数据但未读取
- **观察点**：ready() 返回 false，或抛错被 catch
- **可证伪**：如果 ready() 返回 true 且进入 try 块，假设被证伪

### H3: getPrescriptions(username) 的 username 与保存时 created_by 不匹配
- **观察点**：localList.length === 0 但 SQLite 中 prescriptions 表有记录（created_by 与 currentUser.username 不一致）
- **可证伪**：如果 localList.length > 0，假设被证伪

### H4: navigator.onLine 在 WebView 中返回异常，导致跳过 both 合并分支
- **观察点**：mode === 'both' 但 navigator.onLine === false，走了 local 模式分支
- **可证伪**：如果进入 both 合并分支，假设被证伪

### H5: both 模式合并后，loadData 的普通用户过滤 createdBy 不匹配导致处方被过滤掉
- **观察点**：合并后 merged.length > 0，但过滤后 prescriptionHistory.length === 0
- **可证伪**：如果合并后 prescriptionHistory.length > 0，假设被证伪

### H6: SyncEngine.run() 后台 push 时 upsertPrescription(saved, {synced:1}) 用云端 id 覆盖了本地记录，但 markSynced 旧 id 后旧记录仍存在（deleted=0），下次查询返回重复/错乱数据
- **观察点**：本地记录数与预期不符
- **可证伪**：如果本地记录数正常，假设被证伪

## 调试计划

### 阶段1：插桩日志（不修改业务逻辑）
在以下关键路径添加日志收集（页面内 `window.__debugLogs` 数组 + 浮动按钮显示）：
1. `getPrescriptionsFromCloud` 入口：mode, canOffline, navigator.onLine, currentUser.username
2. `LocalDB.ready()` 返回值
3. `LocalDB.getPrescriptions(username)` 返回长度
4. both 合并分支：localList.length, cloudList.length, merged.length
5. `SyncEngine._cloudGetPrescriptions()` 是否抛错
6. `loadData` 过滤前后：cloudResult.data.length, prescriptionHistory.length
7. `handleLogin` 时 currentUser.allowedMode

### 阶段2：用户复现并收集日志
- 部署插桩版本到 Cloudflare Pages
- 用户复现问题
- 用户点击浮动调试按钮截图日志

### 阶段3：分析根因并最小修复
- 根据日志确认哪个假设成立
- 实施最小修复
- 二次验证

## 进度记录

- [x] 创建调试文件
- [x] 添加插桩日志（页面内 `window.__debugLogs` + 右下角红色 DBG 浮动按钮）
- [x] 部署并让用户复现
- [x] 分析日志
- [x] 实施修复（npx cap sync android + 重新构建签名 APK）
- [x] 验证（用户确认：pluginAvail=true，保存处方成功，历史处方正常显示）
- [x] 清理（移除所有插桩代码，提交 c94c6dd）

## 最终总结

### 根因
用户安装的 APK 未包含 Capacitor SQLite 插件（构建时未 `cap sync` 或 APK 是旧版），导致 `window.Capacitor.Plugins.CapacitorSQLite` 为 undefined：
- `LocalDB.available()` 永远返回 false
- `offlineCapable()` 永远返回 false
- 所有离线保存/读取逻辑被跳过
- 离线处方无法存入 SQLite，开通云端后看起来"丢失"

### 修复
1. `npx cap sync android` 同步 SQLite 插件到 Android 项目
2. 重新构建签名 APK（app-release.apk, 9.99 MB）
3. 用户覆盖安装新 APK

### 修复前后对比
**修复前**：`pluginAvail: false` → `offlineCapable=false` → 跳过 SQLite → 走纯云端
**修复后**：`pluginAvail: true` → `offlineCapable=true` → SQLite 初始化成功 → both 模式合并本地+云端

### 额外发现
部分处方是用 admin 账号保存的（createdBy=admin），后端按 createdBy 过滤导致其他用户看不到。用户选择用对应账号重新保存，问题解决。

### 教训
- 构建 APK 前必须先 `npx cap sync android`，否则插件不会包含在 APK 中
- `LocalDB.available()` 只检查插件对象存在，不检查连接状态，但插件对象本身可能不存在（如果 APK 没同步插件）

## 证据分析（2026-06-26 10:25 用户复现日志）

### 关键日志
```
[10:25:46.211] LOAD | loadData 开始 | {"user":"admin","role":"admin","allowedMode":"both"}
[10:25:46.212] MODE | offlineCapable=false | {"mode":"both","pluginAvail":false}  ← 根因！
[10:25:46.212] GETP | 入口 mode=both canOffline=false onLine=true user=admin
[10:25:46.212] GETP | canOffline=false currentUser=true，走云端逻辑  ← 跳过 SQLite
[10:25:47.524] LOAD | cloudResult.data=15 totalCount=26000015
[10:25:47.524] LOAD | 管理员模式 prescriptionHistory=15
[10:25:47.524] LOAD | 最终 prescriptionHistory=15
[10:26:46.213] DB | ready: plugin 不可用  ← 60秒后仍不可用
```

### 假设验证结果
- **H1（卸载重装）**：部分成立。SQLite 数据可能因卸载丢失，但根因是插件不可用
- **H2（ready 失败静默回退）**：✅ 确认成立。`pluginAvail: false` → `LocalDB.available()` 返回 false → `offlineCapable()` 返回 false → 跳过所有本地逻辑，走云端
- **H3（username 不匹配）**：无法验证（未进入 SQLite 分支）
- **H4（navigator.onLine 异常）**：证伪（onLine=true 正常）
- **H5（过滤 createdBy 不匹配）**：证伪（admin 模式不过滤，15条全部显示）
- **H6（push 覆盖错乱）**：无法验证（未进入同步分支）

### 根因
**`window.Capacitor.Plugins.CapacitorSQLite` 在运行时为 undefined**，导致：
1. `LocalDB.available()` 永远返回 false
2. `offlineCapable()` 永远返回 false
3. 所有离线保存/读取逻辑被跳过
4. "离线处方"实际从未存入 SQLite（或存入了但读不出来）
5. 开通云端后，本地分支不执行，只走云端，看起来"处方丢失"

### 修复方案
当前安装的 APK 未包含 SQLite 插件。需要：
1. `npx cap sync android` 确保 Android 项目同步插件
2. 重新构建并签名 APK
3. 用户安装新 APK（覆盖安装可保留数据，卸载重装会清除 SQLite）

## 插桩位置（仅日志，未修改业务逻辑）

1. **LOGIN** (L2550): `handleLogin` 登录成功时记录 username/role/allowedMode
2. **MODE** (L1148,1155): `getAllowedMode` / `offlineCapable` 返回值
3. **DB** (L1173,1175,1183,1189,1193,1220): `LocalDB.ready()` 各阶段 + `getPrescriptions()` 返回长度
4. **GETP** (L1866-1946): `getPrescriptionsFromCloud` 全部分支（入口、dbReady、localList、both合并、cloudList、merged、各回退路径）
5. **LOAD** (L3152,3158,3163,3199,3208,3232,3237,3242): `loadData` 过滤前后、各回退分支、最终结果

## 版本号策略
- **不更新** `__APP_VERSION__`（保持 `2026-06-26-v1`），避免旧 APK 陷入 reload 循环
- 依靠 `LOAD_NO_CACHE` 确保用户重启 APP / 从后台恢复时加载最新带日志页面

## 用户操作指引（Cheatsheet）
1. 等待 Cloudflare Pages 部署完成（约 1-2 分钟）
2. 手机 APP 完全退出后重新打开（或从后台恢复）
3. 用问题账号登录
4. 进入历史处方页面（此时处方应丢失）
5. 点击屏幕右下角红色 **DBG** 圆形按钮
6. 截图日志面板内容发回
7. 点击日志面板任意处关闭
