# 云端版「断网可用 + 联网自动同步」一期（MVP）设计契约（2026-10-19）

> 范围：**仅云端版**（云端网页 / 云桌面 / 云 APP，共用 `public/index.html` 权威源）；不含离线版（本地版）上云、不含照片/视频等媒体文件同步。
> 灰度：复用后台 `allowedMode`（`both`=离线优先+自动同步；`cloud`=保持现状纯云端；`local`=纯本地不同步）。
> 数据范围：处方为主；药品/方剂/用户等字典仍服务端权威、仅缓存。

## 一、目标与验收

1. 断网可正常开方、保存、查看、删除历史（本地 IndexedDB 先落盘）。
2. 恢复网络/启动/回前台/定时自动把本地待同步操作补传云端，并拉取云端增量（含其他设备修改与删除墓碑）。
3. 离线保存/删除不丢失；重试幂等；错误可见（待同步条数/上次同步时间）。
4. 冲突保护：服务端权威；本地未同步改动若与云端新版本冲突，保留本地为「冲突副本」并提示，绝不静默覆盖。
5. 现有 `allowedMode=cloud/local` 行为零回归；`sync=1` 与否的旧 GET 行为零回归。

## 二、服务端契约（functions/api/prescriptions.js）

### 2.1 增量拉取 `GET /api/prescriptions?sync=1&since=<ISO>&limit=200`
- 认证/角色过滤与现有 GET 完全一致（管理员读全所；普通用户/前台按 `ownerAliasesOf` 过滤）。
- `since` 为空 → 全量快照（返回全部未删除记录 + 全部删除墓碑）。
- 变更时间 `changedAt = deletedAt || updatedAt || createdAt || date`。
- 排序：`changedAt` 升序、同时间按 id 升序；`limit` 默认 200、上限 500。
- 返回：
```json
{
  "success": true,
  "serverTime": "2026-10-19T17:30:00.000Z",
  "nextSince": "<本页最后一条 changedAt；无则 serverTime>",
  "hasMore": true,
  "count": 200,
  "data": [ { ...prescription } ],
  "tombstones": [ { "id": "169...", "deletedAt": "..." } ]
}
```
- 删除记录只进 `tombstones`（不返回正文）。
- D1 开启时 `d1LoadPrescriptions(db, clinicId, true)`；D1 为空/未启用回退 KV（`loadAllPrescriptions` + `clinic:{id}:prescriptions_trash`）。
- **时间戳统一为 `getBeijingTime().toISOString()`（伪 UTC，与现有 updatedAt 一致）**：
  - `d1SoftDelete` 增加 `nowIso` 入参（deleted_at 用该值）；
  - `d1Restore` 同时写 `updated_at = nowIso`；
  - `d1MarkPaid` 同时写 `updated_at = nowIso`；
  - KV 恢复/收费分支 `restored.updatedAt = nowIso` / `target.updatedAt = nowIso`。
  - 目的：避免 deleted_at（真 UTC）与 updatedAt（伪北京 UTC）相差 8h 导致增量漏取。
- 不带 `sync` 的 GET/POST/DELETE 行为保持不变。

### 2.2 推送（复用现有接口，不改协议）
- 新增/修改：`POST /api/prescriptions` `{ prescription }`（沿用现有编号分配、D1+KV 双写、返回 `savedPrescription`）。
- 软删除：`DELETE /api/prescriptions?id=`；永久删除：`DELETE ?id=&permanent=true`（复用）。
- 客户端负责幂等与冲突判定（推送前先 pull；重试重复 POST 同 id 为覆盖更新，DELETE 404 视为成功）。

## 三、客户端契约（public/index.html 权威源）

### 3.1 IndexedDB v4
- 新增 `outbox`（keyPath `opId`）：`{ opId, username, type:'upsert'|'delete', id, payload?, permanent?, baseVersion, attempts, createdAt, lastError? }`
- 新增 `sync_state`（keyPath `key`）：`cursor:<username>` → `{ key, value, updatedAt }`。
- 仅 `allowedMode === 'both'`（或未设置时默认 both）启用 outbox 与自动同步；`cloud`/`local` 保持旧行为。

### 3.2 写路径
- 保存：本地 `savePrescriptionToDB` 成功后入 outbox（`baseVersion = record._serverVersion || ''`），然后 `CloudSync.kick()`。
- 删除：本地删除/墓碑后入 outbox（delete），`kick()`。
- `syncPrescriptionToCloud` / `deletePrescriptionFromCloud` 在 both 模式下改为「入队+触发同步」，不再直接抛错给调用方；cloud/local 模式保持旧实现。

### 3.3 同步引擎 CloudSync
- 触发：登录后初始化、`online` 事件、`visibilitychange` 可见、定时（60s，退避到 5min）、保存/删除后 debounce 1.2s、APP resume。
- 状态机：`idle → pulling → pushing`；单实例防重入。
- 顺序：**先 pull 增量 → 再 push outbox**（先识别冲突，避免覆盖云端新版本）。
- pull：分页循环（≤10 页/轮）；应用 server 记录到 IDB/内存；墓碑删除本地并加入本地删除标记；
  - 若本地有同 id 待推送 upsert 且 `server.updatedAt !== baseVersion` → 冲突：服务端版本落本地，本地改动作「冲突副本」（新 id、患者名后加「（冲突副本）」）入 outbox 并提示。
  - 若墓碑与本地待推送 upsert 冲突 → 删除本地、保留冲突副本入 outbox。
- push：最多 20 条/轮；成功用返回 `savedPrescription` 回写本地（编号/updatedAt/userId/_serverVersion）并删 op；网络错误保留并指数退避；401 停止并提示重新登录；单条业务错误 `attempts++` 保留（不阻塞其他条）。
- 游标：`sync_state.cursor:<username>` = 上轮 `nextSince`；首次为空 → 全量。
- 状态 UI：JS 注入右下角小徽标 `#cloudSyncBadge`：「☁️ 已同步 HH:mm」/「⏳ 待同步 N 条」/「⚠️ 离线 · 待同步 N」；点击立即同步。不改 HTML 结构基线。

### 3.4 数据层保护（修复现网丢数据缺陷）
- `getAllUserPrescriptions` 合并本地未同步记录时：**outbox 待推送 id 一律保留**（不再用「有 updatedAt 就当已删」排除）。
- `syncPrescriptionsDBDiff(records, protectedIds)`：待推送 id 不删除、不被云端版本覆盖。
- 删除墓碑过滤继续生效；`prescriptionHistory` 内存同步更新。

## 四、验收/测试（独立验证）

1. 断网保存 → 刷新/重启 → 记录仍在；恢复网络 → 自动上传，云端 GET 可见，待同步归零。
2. 断网删除 → 恢复网络 → 云端软删除、其他端 pull 后消失。
3. 双端并发编辑同一 id → 后同步端产生冲突副本、两端数据均不丢。
4. 重复点击/重复重试 → 云端不重复建单（同 id upsert）、待同步不重复。
5. 断网启动→在线：全量拉取正确、游标推进；再次同步无重复应用。
6. `allowedMode='cloud'/'local'` 或未登录：不产生 outbox、不发同步请求（零回归）。
7. 旧 GET/POST/DELETE（不带 sync）响应行为不变。
8. 门禁：node --check、copy-consistency、check-cv-hashes、check-interface、desktop-license-smoke。

## 五、部署

- 服务端 + 静态（public/auth-core 无关；public/index.html 变更）随 `git push` 由 Pages 部署。
- 云桌面：`generate-desktop-hotupdate.cjs -c cloud` 生成新热更（含 index.html）；客户下次启动拉取。
- 云 APP：在线壳，重进即达。
- 灰度：后台将试点诊所用户 `allowedMode` 保持 `both`；回退把用户改 `cloud`（服务端用户管理已有字段），客户端即回纯云端旧行为。
