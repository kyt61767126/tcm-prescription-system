# 离线 SQLite + 双向同步实施方案

## 一、概述

将手机 APP 从"纯网页套壳（必须联网）"改造为"离线优先 + 联网自动双向同步"架构，参照电脑端桌面程序的本地存储思路，但采用 Capacitor SQLite（用户已确认）作为本地数据库。

目标：
- 断网可正常开方、保存处方、调取药材；
- 联网后自动上传离线处方，并拉取电脑端/网页端的最新数据；
- 多端数据冲突按时间戳处理（处方有 `updatedAt`）；
- **完全沿用现有账号与后台接口**（不新增 API），冲突解决在客户端完成；
- 电脑、网页、手机三端通过云端 KV 实现互通。

模式开关：沿用已实现的 `allowedMode`（管理员后台一键切换，用户已确认"保持现状"），不新增用户侧切换 UI。
- `cloud`：纯云端，绕过 SQLite（现有行为）；
- `local`：纯离线，只读写 SQLite，不触发同步（管理员已关闭该用户云端权限）；
- `both`：离线优先 + 自动双向同步（本方案核心）。

## 二、现状分析

### 2.1 架构现状
- `capacitor.config.ts` 的 `server.url` 指向云端 `https://tcm-prescription-system.pages.dev`，本地 `src/` React 代码**运行时不加载**。因此所有离线逻辑必须写在云端网页 `tcm-prescription-system/index.html` 中。
- Capacitor 桥（`window.Capacitor.Plugins.*`）对远程 URL 同样注入，`@capacitor-community/sqlite` 已在 `capacitor.plugins.json` 注册、`capacitor.config.ts` 启用加密，但目前**完全未使用**。
- `src/utils/database.ts` 是一份 SQLite 参考实现（含 `synced` 字段、`getUnsyncedPrescriptions`/`markPrescriptionSynced` 模式），可作为 schema 与同步模式的设计参考，但运行时不参与。

### 2.2 现有离线层（待删除）
`MainActivity.java` 的 `injectOfflineScript`（L216–391）用 fetch/XHR 拦截 + localStorage 做离线，存在三个致命 bug：
1. **键名不匹配**：写入 `offline_prescriptions_<username>`，但 `index.html` 的 `updateOfflineSyncInfo`(L6302) 读 `offline_prescriptions` → 待同步计数恒为 0；
2. **药品缓存键漂移**：`getMedicinesFromCloud`(L1585) URL 带 `_t=${Date.now()}`，每次请求键都变 → 永远命中不了缓存；
3. **同步函数残缺**：`syncOfflinePrescriptions`(L6311) 用相对 URL `/api/prescriptions`、无 Authorization 头、body 是队列元数据而非处方本体 → 同步必然失败。

本方案用 SQLite + 客户端同步引擎整体替换该层，上述 bug 随删除自动消除。

### 2.3 数据模型与同步可行性
| 数据 | updatedAt | 写权限 | 同步策略 |
|---|---|---|---|
| 处方 prescriptions | ✅ 有 | 各用户写自己的 | 双向同步，时间戳冲突解决 |
| 药品 medicines | ❌ 无 | 仅管理员 | **仅下拉**（全量替换本地缓存），不上传 |
| 方剂 formulas | ❌ 无 | 仅管理员 | 仅下拉，不上传 |
| 用户 users | — | 仅管理员 | 登录强制走云端（硬约束），不入本地同步 |

云端 `POST /api/prescriptions`（`functions/api/prescriptions.js` L621）用 `idMap` 按 id 去重覆盖、**无版本校验**；处方 id 为客户端 `Date.now()` 生成。因此冲突解决必须在客户端**推送前**完成：先 GET 云端列表比较 `updatedAt`，再决定推送或跳过。

## 三、设计决策与约束

1. **SQLite 逻辑位置**：全部内联在 `index.html`（云端网页单文件），通过 `window.Capacitor.Plugins.CapacitorSQLite` 调用插件。不依赖 `src/`。
2. **数据库**：单库 `tcm_prescription`（加密，secret 复用 `database.ts` 的 `'secret'`），APP 卸载时随应用数据目录自动清除（满足硬约束）。
3. **用户隔离**：单库共享，处方按 `created_by` 列隔离（与云端 GET `?user=` 语义一致）。
4. **存储形态**：处方按行存储（需 `synced`/`updated_at` 索引）；药品/方剂以整段 JSON 存单行（匹配云端全量覆盖模型）。
5. **冲突规则**：处方按 `updatedAt` 时间戳——本地新则推送，云端新则拉取覆盖；同 id 同时间默认云端胜。药品/方剂无时间戳，云端全量覆盖本地（last-cloud-wins）。
6. **不改动后台 API**：仅用现有 `GET/POST /api/prescriptions`、`GET /api/medicines`、`GET /api/formulas`。无新增端点。
7. **模式开关**：复用现有 `allowedMode` + `toggleUserCloudMode`，不新增 UI。
8. **登录**：保持硬约束——登录强制联网校验（`/api/users`），登录成功后才初始化 SQLite 并触发首次同步。

## 四、实施方案

### 4.1 [MainActivity.java] 移除 injectOfflineScript
**文件**：`android/app/src/main/java/com/tcm/prescription/MainActivity.java`

- 删除 `injectOfflineScript(WebView webView)` 整个方法（L216–391）；
- 删除 `onPageFinished` 中对它的两次调用（L158、L159–162 的 postDelayed）；
- 保留：`injectLayoutFixScript`、`WebChromeClient`(onJsPrompt/Alert/Confirm)、`AndroidAppExit` JS 接口、URL 校验/reload 逻辑。

理由：离线职责整体迁至 `index.html` + SQLite；原生层不再拦截 fetch/XHR，避免与客户端同步引擎双重拦截冲突。

### 4.2 [index.html] 新增 LocalDB 模块（SQLite 封装）
**文件**：`tcm-prescription-system/index.html`（在 `<script>` 内、现有函数定义区前新增）

内联一段 vanilla JS 模块 `LocalDB`，封装 Capacitor SQLite 原生 API：

```javascript
const LocalDB = {
  DB: 'tcm_prescription',
  SECRET: 'secret',
  _ready: null,
  async ready() { /* 首次调用：setSecret → createConnection → open → createTables；幂等 */ },
  async exec(sql) { /* execute DDL */ },
  async run(sql, values) { /* run DML，返回 changes */ },
  async query(sql, values) { /* query SELECT，返回 values 数组 */ },
};
```

调用约定（基于 `@capacitor-community/sqlite` 插件契约）：
- `Capacitor.Plugins.CapacitorSQLite.setSecret({secret})` → `createConnection({database, encrypted:true, mode:'secret', version:1})` → `open({database})`；
- DDL：`execute({database, statements})`；DML 带绑定值：`run({database, statement, values})`；SELECT：`query({database, statement, values})`。
- 实现时核对已安装插件版本的实际签名（实现步骤 0 验证桥可用性）。

**建表 SQL**：
```sql
CREATE TABLE IF NOT EXISTS prescriptions (
  id INTEGER PRIMARY KEY,          -- 云端处方 id (Date.now())
  data TEXT NOT NULL,              -- 完整处方 JSON
  updated_at TEXT,                 -- 冲突比较用
  updated_at_ms INTEGER,           -- updatedAt 转 ms，便于比较
  created_by TEXT,                 -- 用户隔离
  synced INTEGER DEFAULT 0,        -- 0=待推送, 1=已同步
  deleted INTEGER DEFAULT 0        -- 本地软删除标记
);
CREATE INDEX IF NOT EXISTS idx_pres_synced ON prescriptions(synced);
CREATE INDEX IF NOT EXISTS idx_pres_user ON prescriptions(created_by);

CREATE TABLE IF NOT EXISTS cache_kv (
  key TEXT PRIMARY KEY,            -- 'medicines_all' / 'formulas_all'
  data TEXT NOT NULL,              -- 整段 JSON 数组
  cached_at TEXT
);

CREATE TABLE IF NOT EXISTS sync_status (
  id INTEGER PRIMARY KEY DEFAULT 1,
  last_push TEXT,
  last_pull TEXT,
  pending_count INTEGER DEFAULT 0
);
```

LocalDB 暴露的语义方法（实现参考 `src/utils/database.ts` 的模式）：
- `getPrescriptions(username)` → `SELECT data FROM prescriptions WHERE created_by=? AND deleted=0 ORDER BY updated_at_ms DESC`
- `upsertPrescription(p)` → `INSERT OR REPLACE` 写入 id/data/updated_at/updated_at_ms/created_by/synced
- `getUnsyncedPrescriptions()` → `SELECT data FROM prescriptions WHERE synced=0 AND deleted=0`
- `markSynced(id)` → `UPDATE prescriptions SET synced=1 WHERE id=?`
- `markDeleted(id)` → `UPDATE prescriptions SET deleted=1, synced=0 WHERE id=?`
- `setCache(key, json)` / `getCache(key)` → cache_kv 读写
- `setSyncStatus(...)` / `getSyncStatus()`

### 4.3 [index.html] 离线优先读写改造
改造现有云端读写函数，按 `allowedMode` 分支。读取/写入均先经过 LocalDB。

**getPrescriptionsFromCloud(forceRefresh)** (L1516)：
- `cloud`：保持现有纯云端逻辑；
- `local`/`both`：先查 LocalDB；
  - 本地有数据 → 返回本地（`forceRefresh` 且在线且 `both` 时，后台触发一次 pull 同步，但即时返回本地）；
  - 本地空且在线且 `both` → 拉云端，写入 LocalDB 后返回；
  - 本地空且 `local` → 返回空（首次离线无缓存）。

**getMedicinesFromCloud(forceRefresh)** (L1577)：
- `local`/`both`：先查 LocalDB `cache_kv.medicines_all`；本地有则返回；本地空且在线 → 拉云端（**去掉 `_t=` 时间戳**，改由 LocalDB 缓存控制新鲜度）写入缓存后返回；
- 同时保留现有"云端失败回退缓存"逻辑作为第二道兜底。

**savePrescriptionsToCloud(prescriptions)** (L1745)：
- 先 `upsertPrescription` 写入 LocalDB（`synced=0`，`updatedAt=now`）；
- `cloud` 或（在线且 `both`）：立即尝试推送——调用同步引擎推送该条，成功则 `markSynced`；
- `local` 或离线：仅写本地，`synced` 保持 0，等待联网自动同步。
- 返回值结构与原函数一致（兼容调用方）。

**deletePrescriptionFromCloud(id)** (L1792)：
- LocalDB `markDeleted(id)`（`synced=0`，进入待同步队列）；
- 在线且 `both`：调用现有云端 DELETE；成功后 `markSynced`。
- 软删除同步：推送阶段对 `deleted=1 AND synced=0` 的条目执行云端 DELETE。

**saveMedicinesToCloud(medicines)** (L1619)：管理员药品编辑仍直连云端（在线必须）；成功后刷新 LocalDB `cache_kv.medicines_all`。不支持离线编辑药品。

### 4.4 [index.html] 双向同步引擎
新增 `SyncEngine` 对象，仅 `both` 模式在线时执行：

```javascript
const SyncEngine = {
  _running: false,
  async run() { /* 防重入；依次 push() → pull() → updateSyncStatus() → updateOfflineSyncInfo() */ },
  async push() { /* 推送本地未同步 */ },
  async pull() { /* 拉取云端更新 */ },
};
```

**push()（处方，时间戳冲突解决）**：
1. `getUnsyncedPrescriptions()`（含 `deleted=1` 的软删除）；
2. 先 `GET /api/prescriptions?user=<me>`（带 Basic auth）取云端当前列表，建 `id→cloudP` 映射；
3. 对每条本地 p：
   - 若 `p.deleted=1`：云端有同 id → DELETE；云端无 → 直接 `markSynced`（已删且云端无）；
   - 若 `p.deleted=0`：
     - 云端有同 id 且 `cloudP.updatedAt > p.updatedAt` → **云端胜**：用 cloudP 覆盖本地 + `markSynced`；
     - 否则（云端无，或本地更新）→ `POST /api/prescriptions` body `{prescription:[p]}`（带 Basic auth），成功后 `markSynced`；
4. 推送失败（网络/5xx）保留 `synced=0`，下次重试。

**pull()（处方下拉）**：
1. `GET /api/prescriptions?user=<me>`；
2. 对每条云端 p：本地无，或本地 `updated_at_ms < cloudP.updatedAt` → `upsertPrescription(p)` + `markSynced`；
3. 本地有、云端无、且本地 `synced=1` 的条目：保留（可能被云端软删，暂不主动删本地，避免误删；可后续按 `prescriptions_trash` 增强）。

**pull()（药品/方剂，全量覆盖）**：
1. `GET /api/medicines` → `setCache('medicines_all', data)`；
2. `GET /api/formulas` → `setCache('formulas_all', data)`；
3. 不上传。

### 4.5 [index.html] 网络事件与触发时机
- 登录成功后：`await LocalDB.ready()` → 若 `both` 且在线，`SyncEngine.run()`（首次拉取 + 推送离线积压）；
- `window.addEventListener('online', () => { if(mode==='both') SyncEngine.run(); })`；
- APP 从后台恢复：现有 `onResume` 刷新 WebView 之外，页面 `visibilitychange`/`pageshow` 触发 `SyncEngine.run()`（`both` 且在线）；
- 兜底定时器：`both` 模式在线时每 60s 触发一次 `SyncEngine.run()`（轻量，pull 命中云端缓存时成本低）；
- `local` 模式不触发任何同步；`cloud` 模式不初始化 SQLite。

### 4.6 [index.html] UI 同步状态显示
改造 `updateOfflineSyncInfo()` (L6287)：
- 待同步计数改读 LocalDB：`SELECT COUNT(*) FROM prescriptions WHERE synced=0`（修复原来读错 localStorage 键导致恒 0 的 bug）；
- 显示 `last_pull`/`last_push` 时间（来自 `sync_status`）；
- "立即同步"按钮调用 `SyncEngine.run()`（替代残缺的 `syncOfflinePrescriptions`，后者删除）；
- `local` 模式普通用户隐藏区块的逻辑保留不变（已实现）。

## 五、实施顺序

0. **验证桥可用性**：在 `index.html` 临时打印 `window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorSQLite`，构建 APK 在真机确认桥注入正常、`setSecret/createConnection` 可调用。（若桥不可用需先排查 Capacitor 配置，再继续。）
1. **删除 `MainActivity.java` 的 `injectOfflineScript`**（方法体 + 两处调用），消除现存 bug 与双重拦截。
2. **index.html 注入 LocalDB 模块 + 建表**，`ready()` 幂等初始化；登录成功后调用。
3. **改造读取函数**（处方/药品/方剂）为离线优先，验证 `both` 模式在线读、断网读。
4. **改造写入函数**（保存处方/删除处方）为离线优先写 LocalDB，`synced=0`。
5. **实现 SyncEngine.push()**（含时间戳冲突解决）+ `pull()`（处方 + 药品/方剂）。
6. **接网络事件触发**（online、首登、visibilitychange、60s 定时器）。
7. **改造 `updateOfflineSyncInfo`** 读 LocalDB 计数 + 删除旧 `syncOfflinePrescriptions`。
8. **部署云端 + 构建 APK**，按验证清单真机回归。

## 六、验证步骤

1. **离线开方**：飞行模式下登录（首次需在线登录后断网）→ 开方保存 → 数据落 LocalDB → 处方列表/历史可查。
2. **离线调药**：飞行模式打开药品库 → 显示 LocalDB 缓存；搜索药材正常。
3. **联网自动上传**：离线存 3 条处方 → 关闭飞行模式 → 自动 `SyncEngine.run()` → 云端/电脑端可见这 3 条，本地 `synced=1`、待同步计数归 0。
4. **下拉同步**：电脑端新增/改价 → 手机联网 → 手机端拉到最新；药品价格更新（验证去掉 `_t=` 后缓存可控）。
5. **冲突解决**：同一处方在手机离线改、电脑端同时改 → 联网后 `updatedAt` 较新者胜，另一端下次 pull 对齐。
6. **模式开关**：管理员把某用户切到 `local` → 该用户断网可开方、联网不上传；切回 `both` → 自动补传。
7. **`cloud` 模式**：管理员设某用户 `cloud` → 该用户不初始化 SQLite，纯云端，行为同改造前。
8. **卸载清除**：卸载 APP 后重装 → 本地 SQLite 已清空（应用数据目录随卸载删除）。
9. **回归**：登录、退出（直接回主屏）、药品管理（管理员）、处方预览全屏、底部导航/顶部操作栏布局不变。
10. **包大小**：APK 仍 < 15MB（SQLite 插件已在内，无新增大依赖）。

## 七、风险与回退

- **桥不可用风险**：步骤 0 先验证；若远程 URL 下桥未注入，回退方案是用 `@capacitor/preferences`（已注册）存 JSON 替代 SQLite，但失去加密与索引能力，仅作兜底。
- **冲突误覆盖**：POST 按 id 覆盖无版本校验——已通过"推送前先 GET 比较 updatedAt"规避；极端同毫秒冲突默认云端胜，可接受。
- **药品无 updatedAt**：明确仅下拉、不上传，避免双向冲突；管理员手机端改药需在线直连云端。
- **回退**：若 SQLite 方案上线异常，可独立还原 `injectOfflineScript`（git 回滚 `MainActivity.java`）+ 临时把用户设为 `cloud` 模式绕过 SQLite 路径，云端数据不受影响（本地库只读不写云端结构）。
- **不动 wrangler.toml / KV 绑定**：本方案仅改 `index.html` 与 `MainActivity.java`，不触碰云端基础设施配置。
