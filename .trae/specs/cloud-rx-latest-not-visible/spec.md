# 云桌面新开处方对其它端不可见（写入侧静默假成功）— 规格

## Overview
- **Summary**: 云桌面（云网页/云桌面/云 APP 共用 `public/index.html` 权威源）新开的处方，在**同一账号**的云端网页版、云 APP 中都看不到；云桌面右下角同步标记却显示「☁️ 已同步」（outbox 无待推送、无错误）。判定为**写入侧假成功**：`POST /api/prescriptions` 返回 `success:true`，但该记录对任何读路径都不可见。
- **Purpose**: 医疗数据"保存成功但查不到"是最高级别数据可信问题；且当前客户端仅凭 HTTP 200 就删除待同步操作（[index.html#L2765-L2767](file:///d:/trae_projects/kyt-zy/public/index.html#L2765-L2767)），一旦服务端"假成功"，用户端**永久**认为已同步、无任何补救迹象。
- **Target Users**: 全部云端版用户（云网页 / 云桌面 / 云 APP）。
- **Impact**: 用户按"已同步"操作（换机、告知他人、依赖云端备份），实际云上没有该方。

## Verified Facts（代码实锤，含行号）
1. **写侧吞错**：`dualWritePrescription`（[prescriptions.js#L630-L635](file:///d:/trae_projects/kyt-zy/functions/api/prescriptions.js#L630-L635)）对 D1 写入异常 `catch` 后**只 `console.error`**；POST 仍继续 KV 写入并返回 `success:true`（[L1030](file:///d:/trae_projects/kyt-zy/functions/api/prescriptions.js#L1030)）。→ 客户端删除 op、角标变绿。
2. **读侧 D1 优先且不并 KV**：GET 只要 D1 返回 ≥1 行就**不再读 KV**（[L728-L736](file:///d:/trae_projects/kyt-zy/functions/api/prescriptions.js#L728-L736)）；增量 `sync=1` 同样只在 D1 **零行**时才回退 KV（[L366-L408](file:///d:/trae_projects/kyt-zy/functions/api/prescriptions.js#L366-L408)）；登录预取是**纯 D1** 快路径（[users.js#L2651-L2678](file:///d:/trae_projects/kyt-zy/functions/api/users.js#L2651-L2678)）。→ **KV 有、D1 没有的记录，在所有端都不可见**（正是本次症状）。
3. **D1 列自愈不完整**：`ensurePrescriptionSchema` 只保证 `registration_fee` / `dose_count`（[prescriptions-store.js#L73-L99](file:///d:/trae_projects/kyt-zy/functions/api/_lib/prescriptions-store.js#L73-L99)），而 upsert 的列包含 `media_files, extra, fee_status, paid_at, paid_by, pay_method`（[prescriptions.js#L515-L532](file:///d:/trae_projects/kyt-zy/functions/api/prescriptions.js#L515-L532)）。任一列在**线上 D1** 缺失即整条 INSERT 失败 → 被事实 1 吞掉 → 事实 2 使其不可见。仓库历史上"本机无法起 wrangler/workerd，D1 加列只能靠运行时 ALTER"（同文件注释 L73-L80）说明线上表结构是**增量补列**而来，属高风险面。
4. **端间模式不对称**：`allowedMode='local'` 在 Capacitor（云 APP）**保持 local**，在网页/桌面被升级为 `both`（[auth-core.js#L1608-L1613](file:///d:/trae_projects/kyt-zy/public/auth-core.js#L1608-L1613)）；本地用户管理建号写死 `allowedMode:'local'`（[index.html#L5364](file:///d:/trae_projects/kyt-zy/public/index.html#L5364)）。→ 同账号在不同端的离线同步行为不一致。
5. **同账号多端 = 单设备互斥**：后登录端顶掉前者的 session，前者再调用即 401；401 时 `getAllUserPrescriptions`（[index.html#L11863](file:///d:/trae_projects/kyt-zy/public/index.html#L11863) 起）会清登录态并返回空列表。本次已排除为主因（若为 401，push 会失败并保留 op，角标应显示待同步/失败，与"☁️ 已同步"不符）。
6. **已排除**：POST / DELETE / 墓碑全链路时间戳统一为 `getBeijingTime().toISOString()`（伪北京 UTC，契约见 [L283-L286](file:///d:/trae_projects/kyt-zy/functions/api/prescriptions.js#L283-L286)），与增量 `serverTime/nextSince` 同基准 → **不存在 8 小时时基错位**（此前怀疑不成立）。

## Goals
- G1 让"云端实际没存上"**不可能被静默隐藏**：服务端写失败必须回传、客户端必须保留待同步并可见。
- G2 KV↔D1 分叉**可探测、可对账自愈**（一次性回填 + 常态化不再产生分叉）。
- G3 线上已受影响的处方**补回可见**（不丢方）。
- G4 端间同步行为一致（云 APP 与云桌面/网页同一账号同规则）。

## Non-Goals
- 不改受保护 HTML 结构/CSS（仅 JS 逻辑）；`check-interface.bat` 必须仍 6 OK。
- 不改单设备会话互斥策略（安全产品决策，另立项）。
- 不改 `sync=1` 协议既有字段语义（只新增冗余字段，老客户端零回归）。
- 不在 GET 读路径上合并 KV 扫描（[KNOWLEDGE 2026-10-09 KV list 配额治理](file:///d:/trae_projects/kyt-zy/.trae/KNOWLEDGE.md) 明确禁止 listAllKeys，改用"保证 D1 写成功 + 一次性回填"）。

## Functional Requirements
- **FR-1 D1 写失败不吞错**：`dualWritePrescription` 保留 KV 写入（保底不丢方），但**捕获 D1 错误并向上返回**（`{ d1Ok:false, d1Error }`）；POST 在响应中带 `d1WriteFailed:true` 与 `storedIn:'kv'`；同时写 `writeAuditLog`（action `prescription_d1_write_failed`）供运维告警。
- **FR-2 列自愈扩展 + 失败重试**：`ensurePrescriptionSchema` 覆盖 `prescriptions` 表全部写入列（含 `extra`、`media_files`、`fee_status`、`paid_at`、`paid_by`、`pay_method`、`deleted_at`、`deleted_by`、`user_id`）；`d1UpsertPrescription` 在遇到 "no such column" 类错误时，**先补齐列再重试一次**。
- **FR-3 客户端按服务端结论决策**：`CloudSync.push` 在 `resp.success` 但 `resp.d1WriteFailed` 时：**保留 op**（`attempts++`，走既有 5 次封顶逻辑）、置 `state.lastError`（角标显示 ⚠ 而非 ☁️ 已同步）、移动端补一条节流提示。
- **FR-4 一次性对账回填**：新增/复用运维端点，把"KV 有、D1 无"的处方按 id 回填 D1（dry-run 先出计数与清单，`confirm` 才写），回填后 GET / 增量 / 登录预取三路立即可见。
- **FR-5 端间模式一致**：云页面（`public/index.html`）登录落地后，将 `currentUser.allowedMode === 'local'` 升级为 `both`（**只在云页面做**，离线页面 `app_project/db-offline/*` 与 `index-app.html` 不动，避免离线 APP 被升级）。
- **FR-6 可观测**：`CloudSync` 角标 tooltip / 设置明细在 `d1WriteFailed` 后展示"云端存储异常，数据已在本机，请稍后重试或联系客服"。

## Non-Functional Requirements
- **NFR-1 零回归**：`allowedMode=cloud/local`、未登录、旧 GET/POST/DELETE（不带 `sync`）行为不变；老客户端（不识别新字段）不受影响。
- **NFR-2 多端同步**：`public/index.html`（2 权威源 + sync-all 生成 6 端副本）、`auth-core.js`（11 副本，经 `sync-auth-core.ps1`）改动须全量同步并 `sync-all.ps1 -VerifyOnly` 全绿。
- **NFR-3 门禁**：`node --check`、`copy-consistency.cjs`、`check-interface.bat`、`check-cv-hashes`、`diff-cross-version.cjs` 全绿；服务端函数随 push 由 Pages 部署。
- **NFR-4 幂等**：回填/对账全部按 id upsert，可重复执行。
- **NFR-5 安全**：回填端点需管理员鉴权（platform/clinic admin），不接受匿名或普通用户调用；不改动越权面。

## Acceptance Criteria

### AC-1: 假成功不再出现（rule）
- **Given**: 人为让 D1 upsert 失败（缺失列 / 强制抛错）
- **When**: 客户端保存并 push 该处方
- **Then**: 客户端**不删除** op，角标显示 ⚠ 且文案含"云端存储异常"；服务端响应 `d1WriteFailed:true`
- **Pass Condition**: 客户端 IndexedDB outbox 仍有该 op；角标非"☁️ 已同步"；响应体字段存在
- **Evidence**: 单测/探针输出 + 客户端状态截图

### AC-2: 列自愈覆盖全列（rule）
- **Given**: 线上 D1 缺 `extra`（或任一写入列）
- **When**: 执行一次 POST 保存
- **Then**: 自动 ALTER 补列并写入成功，`d1WriteFailed` 不出现
- **Pass Condition**: 该 id 在 `SELECT ... WHERE id=?` 可查到
- **Evidence**: wrangler d1 execute 查询输出 + 函数日志

### AC-3: KV 有 D1 无的记录恢复可见（rule）
- **Given**: 存在 KV-only 处方（本次故障遗留）
- **When**: 执行对账回填
- **Then**: 回填后云端网页版 / 云 APP / 云桌面全量 GET 均能看到该 id
- **Pass Condition**: 回填前后 `SELECT COUNT(*)` 差 = 回填条数；三端历史列表出现该方
- **Evidence**: 回填报告（计数+id 清单）+ 三端截图

### AC-4: 端间行为一致（rule）
- **Given**: 同一账号在云 APP 与云桌面登录
- **When**: 查看同步状态
- **Then**: 两端 `allowedMode` 均非 `local`（为 `both`），两端都显示同步角标/圆点并可补传
- **Pass Condition**: 两端 `currentUser.allowedMode` 一致且 ≠ local
- **Evidence**: 两端 F1 基础设置「☁️ 云端同步」明细截图

### AC-5: 门禁与零回归（rule）
- **Given**: 改动完成
- **When**: 跑全部门禁
- **Then**: 全绿；离线端（`allowedMode` 仍 local）行为不变
- **Pass Condition**: 各门禁命令输出全绿；离线端仍不产生 outbox/同步请求
- **Evidence**: 命令输出

### AC-6: 诊断闭环质量（rubric）
- **Dimension**: 根因是否被运行时证据证实（而非推测）
- **Scale**: 1-5；1 = 仅凭代码猜测；3 = 有 1 项证据（D1/KV 其一）；5 = D1 行 + KV 行 + 函数日志三方对齐，明确缺失环节与受影响 id 清单
- **Pass Threshold**: >= 4
- **Evidence**: 取证记录（命令与原始输出）

## Assumptions
- 线上 `clinicId`、账号为同一账号（用户已确认：桌面与 APP 同一账号；云端网页版看不到该方）。
- 运维侧可用 wrangler 读 KV/D1 与 Pages 函数日志（HANDOFF 载明 wrangler 已认证）。
- 桌面端确实执行了一次 `POST /api/prescriptions`（角标绿 = op 已删，仅成功路径会删）。

## Open Questions
- 线上 D1 `prescriptions` 表实际列清单（T1 取证直接回答）。
- 是否需要"常态化对账"（每日巡检 KV/D1 差集并告警）——建议先做一次性回填，按 T1 结论再决定。
