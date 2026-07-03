# 工作日报 — 2026-06-26

> **目的**：总结今日所有修改、当前状态、已知问题与下一步建议，方便后续会话/账户继续优化完善项目。
> **项目**：中医处方系统（kyt-zy） — Capacitor WebView 混合 APP + Cloudflare Pages 云端

---

## 一、今日完成事项总览

### 1. 离线 SQLite + 双向同步改造（核心功能）
- **目标**：手机 APP 从纯网页套壳升级为混合架构，支持断网开方、本地存储、联网自动同步
- **状态**：✅ 已完成代码改造并部署，核心保存功能已修复，待真机完整回归测试

### 2. 账号管控功能（延续昨日）
- **状态**：✅ 已完成（昨日部署，今日验证）

### 3. APP 退出逻辑优化（延续昨日）
- **状态**：✅ 已完成

### 4. 离线保存处方 Bug 修复（今日重点调试）
- **状态**：✅ 根因已定位并修复，待最终验证

---

## 二、详细修改清单

### 2.1 离线 SQLite + 双向同步改造（commit cf8b02b）

**文件**：[tcm-prescription-system/index.html](file:///c:/Users/61767/Documents/trae_projects/kyt-zy/tcm-prescription-system/index.html)

完成 9 项改动：

| # | 改动 | 位置 | 说明 |
|---|------|------|------|
| 1 | SyncEngine 修正云端 API 调用 | L1207-L1233 | 去掉无效的 `?user=` 参数，靠 Authorization 头过滤 |
| 2 | getFormulasFromCloud 离线优先 | L1942-L1998 | 先查 LocalDB，本地空+local模式返回[]，云端成功回写缓存 |
| 3 | savePrescriptionsToCloud 离线优先写 | L2062-L2152 | local 落本地 synced=0；both 在线直连云端回写 synced=1；both 离线落本地 synced=0 |
| 4 | deletePrescriptionFromCloud markDeleted | L2154-L2198 | local/both 离线 markDeleted；both 在线/cloud 云端删除后标记已同步 |
| 5 | saveMedicinesToCloud 刷新 LocalDB | L1930-L1936 | 云端保存成功后刷新本地 medicines_all 缓存 |
| 6 | saveFormulasToCloud 刷新 LocalDB | L2020-L2026 | 云端保存成功后刷新本地 formulas_all 缓存 |
| 7 | loadData 调用 SyncEngine.init() | L2914-L2917 | 启动同步引擎（幂等），注册 online/visibilitychange/60s 定时器 |
| 8 | updateOfflineSyncInfo 改读 LocalDB | L6683-L6712 | 改为 async，读 countUnsynced + getSyncStatus |
| 9 | syncOfflinePrescriptions 替换为 SyncEngine.run | L6714-L6736 | 函数名保留兼容 onclick，内部调用 SyncEngine.run() |

**新增模块**（上一会话注入，本次未改动）：
- `LocalDB` 模块（L1100-L1196）：17 个方法，3 张表（prescriptions/cache_kv/sync_status）
- `SyncEngine` 模块（L1199-L1326）：9 个方法（push/pull/run/init 等）
- `getAllowedMode()`/`offlineCapable()` 辅助函数（L1092-L1098）

### 2.2 离线保存处方 Bug 修复（今日重点）

发现并修复了**两个层级的根因**：

#### 根因1：LocalDB.ready() 未前置调用（commit 417824d）
- **问题**：`savePrescriptionsToCloud` 的离线分支调用 `LocalDB.upsertPrescription` 前未先调用 `LocalDB.ready()` 初始化数据库连接
- **症状**：抛错 `Run: database tcm_prescription not opened`
- **修复**：所有离线分支在调用 LocalDB 写入/删除方法前都先 `await LocalDB.ready()`
- **影响文件**：[savePrescriptionsToCloud](file:///c:/Users/61767/Documents/trae_projects/kyt-zy/tcm-prescription-system/index.html#L2095-L2105) + [deletePrescriptionFromCloud](file:///c:/Users/61767/Documents/trae_projects/kyt-zy/tcm-prescription-system/index.html#L2208-L2218)

#### 根因2：SQLite 插件方法名错误（commit f59462f）
- **问题**：`LocalDB.ready()` 调用了 `sqlite.setSecret({secret:...})`，但 vanilla JS 插件对象的正确方法是 `sqlite.setEncryptionSecret({passphrase:...})`
- **症状**：抛错 `sqlite.setSecret is not a function`
- **原因**：`setSecret` 是 `SQLiteConnection` wrapper 类的方法名，vanilla JS 插件对象（`window.Capacitor.Plugins.CapacitorSQLite`）不存在此方法
- **修复**：`setSecret` → `setEncryptionSecret`，参数 `secret` → `passphrase`，并先 `isSecretStored()` 检查避免重复设置
- **验证来源**：[plugin.js 源码 L68-L76](file:///c:/Users/61767/Documents/trae_projects/kyt-zy/node_modules/@capacitor-community/sqlite/dist/plugin.js#L68-L76)

#### 调试过程清理（commit 7716433）
- 清理所有 `debug-point offline-save-fail` 注释和 `[DBG xxx]` alert 诊断代码
- 保留所有修复逻辑

### 2.3 账号管控功能（延续昨日，commit 97cd41a / 2fde76e）
- POST /api/users 加分级鉴权（admin 全权 / 普通用户仅改自己密码 / 匿名 403）
- 注册封禁、一键开关云端、local 用户隐藏状态 UI 直接实现于云端 index.html
- toggleUserCloudMode 在 local↔both 两态切换

### 2.4 APP 退出逻辑优化（commit 3e112aa / d0a99c1）
- MainActivity.java 新增 AndroidAppExit JavaScript Interface（exit() 调用 finish()）
- doLogout 优先调用 `window.AndroidAppExit.exit()`，移除退出确认消息
- 点击退出按钮直接返回手机主屏

---

## 三、当前部署状态

### 3.1 云端网页（Cloudflare Pages）
- **URL**：https://tcm-prescription-system.pages.dev
- **最新 commit**：`7716433`（已验证部署上线）
- **状态**：✅ 已部署最终清理版（含所有修复，无诊断代码残留）

### 3.2 Android APK
- **路径**：[android/app/build/outputs/apk/release/app-release.apk](file:///c:/Users/61767/Documents/trae_projects/kyt-zy/android/app/build/outputs/apk/release/app-release.apk)
- **大小**：9.99 MB（符合 15MB 限制）
- **签名**：已签名（signing.properties 配置）
- **注意**：APK 是基于 cf8b02b 构建的，云端网页已更新到 7716433。由于 APP 使用 `server.url` 远程加载云端页面，**无需重新构建 APK**，重启 APP 即可加载最新代码

### 3.3 Git 提交历史（今日）

**子模块 tcm-prescription-system**：
```
7716433 cleanup: 清理 offline-save-fail 调试诊断代码
f59462f fix: LocalDB.ready() 修正 SQLite 插件方法名 setSecret→setEncryptionSecret
417824d fix: savePrescriptionsToCloud/deletePrescriptionFromCloud 调用 LocalDB.ready() 前置
cf8b02b feat: 完成离线 SQLite + 双向同步改造
```

**主仓库 kyt-zy**：
```
ae12159 feat: 离线 SQLite + 双向同步改造（android + submodule 引用更新）
```

---

## 四、架构与关键约束（必读）

### 4.1 整体架构
```
┌─────────────────────────────────────────────┐
│  Android APP (Capacitor 8 WebView)          │
│  ├── server.url → 云端 index.html (远程加载) │
│  ├── @capacitor-community/sqlite (本地 DB)  │
│  ├── AndroidAppExit JS Interface            │
│  └── LOAD_NO_CACHE (禁用缓存)               │
└──────────────┬──────────────────────────────┘
               │ HTTPS
┌──────────────▼──────────────────────────────┐
│  Cloudflare Pages + Functions + KV          │
│  ├── /api/prescriptions (GET/POST/DELETE)   │
│  ├── /api/medicines (GET/POST)              │
│  ├── /api/formulas (GET/POST)               │
│  └── /api/users (GET/POST 分级鉴权)         │
└─────────────────────────────────────────────┘
```

### 4.2 离线模式三态（allowedMode）
| 模式 | 说明 | 同步行为 |
|------|------|----------|
| `cloud` | 纯云端 | 不使用本地 DB，所有操作直连云端 |
| `local` | 纯离线 | 仅落本地 SQLite，不自动同步 |
| `both` | 离线优先+自动同步 | 离线落本地 synced=0，在线直连云端+60s 定时同步 |

- 普通用户默认 `local`
- 管理员默认 `both`（admin）
- `toggleUserCloudMode` 只在 local↔both 两态切换

### 4.3 关键约束（🔴 禁止违反）
1. **绝对禁止删除或修改 wrangler.toml**（KV 绑定的永久配置）
2. **绝对禁止在 Cloudflare Dashboard 删除 KV 命名空间绑定**
3. **所有离线逻辑必须内联在云端 index.html**（WebView 加载远程 URL 时自动可用 Capacitor 插件）
4. **不改后台 API**（`?user=me` 参数后端不支持，靠 auth 头过滤）
5. **所有调用 LocalDB 写入/删除方法前必须先 `await LocalDB.ready()`**
6. **vanilla JS 插件方法名是 `setEncryptionSecret`（参数 passphrase），不是 `setSecret`**

### 4.4 Capacitor SQLite vanilla JS API 正确调用顺序
```javascript
const sqlite = window.Capacitor.Plugins.CapacitorSQLite;
// 1. 检查 secret 是否已存储
const { result } = await sqlite.isSecretStored();
// 2. 未存储则设置加密密码
if (!result) await sqlite.setEncryptionSecret({ passphrase: 'your-secret' });
// 3. 创建连接
await sqlite.createConnection({ database: 'db_name', encrypted: true, mode: 'secret', version: 1 });
// 4. 打开数据库
await sqlite.open({ database: 'db_name' });
// 5. 执行 SQL
await sqlite.execute({ database: 'db_name', statements: 'CREATE TABLE...' });
await sqlite.run({ database: 'db_name', statement: 'INSERT...', values: [...] });
const { values } = await sqlite.query({ database: 'db_name', statement: 'SELECT...', values: [...] });
```

---

## 五、已知问题与待办（重要）

### 5.1 🔴 离线保存的处方没有编号、门诊号（今日新报告，未修复）
- **现象**：普通用户离线状态下保存的处方，历史处方列表中没有编号（prescriptionNo）和门诊号（outpatientNo）
- **原因**：
  - 在线模式：编号由云端 POST /api/prescriptions 生成，返回 `savedPrescription`（含编号）+ `nextPrescriptionNo`
  - 离线模式（local）：`savePrescriptionsToCloud` 返回本地构造的 record，**没有编号字段**
  - 调用方 L4804: `const nextNo = response.nextPrescriptionNo || '';` 离线时为空
- **建议修复方案**：
  - 方案A：离线时生成临时编号（如 `OFFLINE-{timestamp}`），同步后由云端覆盖为正式编号
  - 方案B：从本地 SQLite 读取该用户最大编号+1，生成顺序编号
  - 方案C：离线时编号留空，UI 显示"待同步"，同步完成后刷新
- **影响位置**：[savePrescription 函数 L4742-L4854](file:///c:/Users/61767/Documents/trae_projects/kyt-zy/tcm-prescription-system/index.html#L4742-L4854)

### 5.2 🟡 离线保存 Bug 修复待最终验证
- **状态**：两个根因已修复并部署，但用户选择退出调试，未完成 post-fix 验证
- **验证步骤**：
  1. 重启 APP（完全关闭后重开，加载最新云端页面）
  2. 普通用户登录（如 wgj）
  3. 断开网络
  4. 填写处方并保存
  5. 预期：弹出"处方保存成功"toast，不再有"处方保存失败"
  6. 恢复网络，观察 SyncEngine 是否自动推送（60s 定时器或 visibilitychange 触发）

### 5.3 🟡 真机完整回归测试（10 项）
- [ ] 普通用户离线开方保存
- [ ] 普通用户离线删除处方
- [ ] 普通用户离线调取历史处方
- [ ] 普通用户离线药品下拉（本地缓存）
- [ ] 普通用户离线方剂下拉（本地缓存）
- [ ] 联网后自动同步推送（SyncEngine.push）
- [ ] 联网后自动同步拉取（SyncEngine.pull）
- [ ] 多端冲突解决（updatedAt 时间戳比较）
- [ ] 管理员 both 模式在线直连云端
- [ ] 非 Capacitor 环境（PC 浏览器）自动降级纯云端

---

## 六、Memory 更新记录

今日更新了 [project_memory.md](file:///c:/Users/61767/.trae-cn/memory/projects/-c-Users-61767-Documents-trae-projects-kyt-zy/project_memory.md)：

1. **修正错误记录**：Capacitor SQLite vanilla JS API 方法名 `setSecret` → `setEncryptionSecret`（参数 `secret` → `passphrase`）
2. **新增教训**：所有调用 LocalDB 写入/删除方法前必须先 `await LocalDB.ready()`
3. **新增教训**：`LocalDB.available()` 只检查插件对象存在，不检查连接是否已 open

---

## 七、下一步优化建议（优先级排序）

### P0（紧急）
1. **修复离线处方编号问题**（见 5.1）— 用户已报告，影响核心功能
2. **完成离线保存 Bug 的 post-fix 验证**（见 5.2）

### P1（重要）
3. **真机完整回归测试**（见 5.3）— 确保离线功能稳定
4. **离线模式 UI 优化** — 历史处方列表区分"已同步/待同步"状态
5. **同步状态可视化** — 在设置页显示上次同步时间、待同步数量

### P2（增强）
6. **离线药品/方剂搜索** — 当前离线只能从缓存全量下拉，不支持搜索
7. **冲突解决 UI** — 当云端和本地都有更新时，提示用户选择
8. **离线数据导出** — 支持导出本地 SQLite 数据为 JSON 备份
9. **APK 重新构建** — 当前 APK 基于 cf8b02b，云端已更新到 7716433，虽然无需重装但建议定期重建保持一致

---

## 八、快速复现指南（供下一会话）

### 验证离线保存是否已修复
```bash
# 1. 确认云端已部署最新代码
curl -s https://tcm-prescription-system.pages.dev/ | grep -o "setEncryptionSecret"

# 2. APP 操作
# 重启 APP → 普通用户登录 → 断网 → 填写处方 → 保存
# 预期：弹出"处方保存成功"toast
```

### 查看当前部署版本
```bash
cd tcm-prescription-system
git log --oneline -3
# 应看到：7716433 cleanup / f59462f fix setEncryptionSecret / 417824d fix ready() 前置
```

### 重新构建 APK（如需要）
```bash
cd android
.\gradlew.bat assembleRelease --no-daemon
# 输出：android/app/build/outputs/apk/release/app-release.apk
```

---

**报告生成时间**：2026-06-26
**报告人**：AI 助手（GLM-5.2）
**下次会话建议**：优先处理 5.1 离线处方编号问题，然后完成 5.2 验证
