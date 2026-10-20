# 云处方写入侧假成功 — 实施计划

> 依赖顺序：T1（取证定因）→ T2（服务端不吞错+列自愈）→ T3（客户端按结论决策）→ T4（一次性对账回填）→ T5（端间模式一致）→ T6（门禁/多端同步/验收）。
> 界面保护：全部改动仅 JS 逻辑与 Functions；受保护 HTML 结构/CSS 一律不动，改后跑 `check-interface.bat`。
> 铁律：改 `shared/auth-core*` → 双路径同步（`sync-auth-core.ps1` + `sync-all.ps1`）；改 `public/index.html` → sync-all 分发 6 端副本；`cloud-api` 8 副本。**未经用户确认不 commit / 不 push。**

## Task 1: 取证定因（不改码）
- **Status**: `blocked`（2026-10-20：症状自行消失（用户重登/刷新后正常），无法复现；需保留复现时段的 Pages 函数日志与 D1/KV 只读权限才能落定）
- **Priority**: high
- **Depends On**: None
- **Description**:
  - 取用户新开处方（问诊时间/患者名可定位）的 id 与 clinicId，分别在 **KV 日分片**与 **D1** 中查找，判定属哪一类：
    1. KV 有 / D1 无 → 事实 3（列缺失等）导致 D1 upsert 被吞；
    2. KV 有 / D1 有但 GET 不可见 → `created_by` 归属或 `clinic_id`/`deleted_at` 过滤不一致；
    3. KV 无 / D1 无 → POST 根本没到达（改为查 Pages 函数访问日志与客户端请求）。
  - 精确命令（按实际 environment 名替换）：
    - `npx wrangler d1 execute <DB> --remote --command "SELECT id, patient_name, created_by, clinic_id, deleted_at, created_at, updated_at FROM prescriptions WHERE clinic_id='<cid>' ORDER BY created_at DESC LIMIT 10;"`
    - `npx wrangler d1 execute <DB> --remote --command "PRAGMA table_info(prescriptions);"`（对照 [prescriptions.js#L518-L522](file:///d:/trae_projects/kyt-zy/functions/api/prescriptions.js#L518-L522) 的写入列）
    - `npx wrangler kv key get --binding=<KV> "clinic:<cid>:prescriptions:<YYMMDD>"`（当天分片）
    - Cloudflare 控制台 → Pages 函数日志，检索 `[D1] upsert prescription failed:`
  - 产出：`受影响 id 清单 + 缺失环节结论 + 原始命令输出` 记入本任务交付物（追加到本文件下方或 PR 描述）。
- **Acceptance Criteria Addressed**: AC-6
- **Test Requirements**:
  - `rule` TR-1.1: 三个数据面（D1 / KV / 函数日志）至少两方对齐并给出明确缺失环节；证据：命令原始输出。
  - `rule` TR-1.2: 给出受影响处方的 id 清单（供 T4 回填与验收）；证据：清单文件。

## Task 2: 服务端 — D1 写入失败不吞错 + 列自愈完善
- **Status**: `done`（2026-10-20；未提交，待用户确认）
- **Priority**: high
- **Depends On**: T1
- **Description**:
  - [`functions/api/prescriptions.js`](file:///d:/trae_projects/kyt-zy/functions/api/prescriptions.js)
    - `dualWritePrescription`（L630-L635）：D1 异常时返回 `{ d1Ok:false, d1Error }`（KV 写入保留，保底不丢方）；POST 主流程收集该结果。
    - POST 响应体（L1029-L1040）新增 `d1WriteFailed: bool`、`storedIn: 'd1+kv'|'kv'`、`d1Error`（仅错误摘要，不含数据）。
    - 该分支追加 `writeAuditLog(kv, clinicId, username, role, 'prescription_d1_write_failed', <id>, context.request, { error })`。
    - `d1UpsertPrescription`（L515-L533）捕获 "no such column" 类错误 → `await ensurePrescriptionSchema(db, {force:true})` → 重试一次。
  - [`functions/api/_lib/prescriptions-store.js`](file:///d:/trae_projects/kyt-zy/functions/api/_lib/prescriptions-store.js)
    - `ensurePrescriptionSchema`（L73-L99）列清单扩展为**全部被 D1 语句引用的列**：`registration_fee, dose_count, extra, media_files, fee_status, paid_at, paid_by, pay_method, deleted_at, deleted_by`（`deleted_at/deleted_by` 被查询过滤与软删语句引用，缺失会导致 D1 读整段失败）；支持 `force` 参数绕过单飞缓存重查。
  - 保持 KV 写入路径不变（回滚安全）。
- **Acceptance Criteria Addressed**: AC-1, AC-2, AC-5
- **Test Requirements**:
  - `rule` TR-2.1: 本地/隔离环境强制 `d1UpsertPrescription` 抛错 → 响应含 `d1WriteFailed:true`、`storedIn:'kv'`，且 KV 日分片确有该 id；证据：请求响应 + KV 查询。
  - `rule` TR-2.2: 人为删除 D1 某列（或指向缺列表）→ 一次 POST 后自动补列并写入成功、无 `d1WriteFailed`；证据：`PRAGMA table_info` + 查询。
  - `rule` TR-2.3: 不带 `sync` 的旧 GET/POST/DELETE 响应语义不变（仅新增字段）；证据：响应 diff。

## Task 3: 客户端 — push 按服务端结论决策，不再静默删 op
- **Status**: `done`（2026-10-20；未提交，待用户确认）
- **Priority**: high
- **Depends On**: T2
- **Description**:
  - [`public/index.html`](file:///d:/trae_projects/kyt-zy/public/index.html) `CloudSync.push`（L2742-L2794）upsert 分支：
    - 收到 `resp.d1WriteFailed === true` 时：**不删除 op**，`attempts++`，`state.lastError = '云端存储异常'`，移动端节流 toast（复用 `_lastErrToastAt` 5 分钟口径），并 `console.warn` 带 id。
    - 注意与既有"永久删除 `PERMANENTLY_DELETED` 丢弃 op"分支的先后判别顺序互不干扰。
  - `_renderSettingsStatus`（L2895）与角标文案（L2926-L2934）：`lastError` 为存储异常时显示可操作文案"数据已在本机，请稍后重试或联系客服"。
  - `syncPrescriptionToCloud` 直传分支（L9287）收到 `d1WriteFailed` 时同样抛错（而非静默 return），交由调用方 `.catch` 提示。
- **Acceptance Criteria Addressed**: AC-1, AC-5
- **Test Requirements**:
  - `rule` TR-3.1: mock 服务端返回 `{success:true,d1WriteFailed:true}` → outbox 仍有该 op、角标非"已同步"；证据：探针单测输出。
  - `rule` TR-3.2: 正常成功响应仍删除 op、角标回绿（零回归）；证据：探针单测输出。
  - `rule` TR-3.3: `node --check` 通过；证据：命令输出。

## Task 4: 一次性对账回填（KV → D1）
- **Status**: `pending`
- **Priority**: high
- **Depends On**: T1, T2
- **Description**:
  - 复用/扩展 [`functions/api/migrate.js`](file:///d:/trae_projects/kyt-zy/functions/api/migrate.js) 的处方段：按 T1 的 id 清单（或全诊所）把 KV 日分片中的处方 upsert 进 D1；先 `dry-run` 输出 `{待回填条数, id 清单}`，`?confirm=1` 才写；逐条 upsert 幂等，失败继续并汇总。
  - 需管理员鉴权（platform/clinic admin）；回填不动 KV、不删任何数据。
  - 回填后验证三路可见：全量 GET、`sync=1`、登录预取。
- **Acceptance Criteria Addressed**: AC-3
- **Test Requirements**:
  - `rule` TR-4.1: `dry-run` 输出的条数/清单与 T1 取证一致；证据：端点响应。
  - `rule` TR-4.2: `confirm` 执行后 `SELECT COUNT(*)` 增量 = 回填条数；证据：d1 execute 输出。
  - `rule` TR-4.3: 云端网页版（同账号）历史列表出现该方；证据：截图。
  - `rule` TR-4.4: 重复执行 `confirm` 不产生重复行（按 id upsert）；证据：两次 COUNT 对比。

## Task 5: 端间模式一致（云页面 local→both）
- **Status**: `pending`
- **Priority**: medium
- **Depends On**: None
- **Description**:
  - [`public/index.html`](file:///d:/trae_projects/kyt-zy/public/index.html)：云端登录落地后（`route.source==='cloud'` 与本地表命中两路都要），若 `currentUser.allowedMode === 'local'` 则置为 `'both'`（云页面代表云网页/云桌面/云 APP，均有 token 与 `CLOUD_API_BASE`）。
  - **不动** `app_project/db-offline/*`、`app_project/db-offline/index-app.html`、离线 hot-update 副本（离线 APP/桌面必须保持 local）。
  - 改后 `sync-all.ps1` 分发 6 端副本（含 `app_project/db-yunduan/cloud_app/app/src/main/assets/public/index.html`、`app_project_harmony/huikang-cloud/.../rawfile/index.html`、`public/hot-update/desktop/cloud/index.html`）。
- **Acceptance Criteria Addressed**: AC-4, AC-5
- **Test Requirements**:
  - `rule` TR-5.1: 云页面登录后 `currentUser.allowedMode !== 'local'`（离线页面仍为 local）；证据：两端 console 截图。
  - `rule` TR-5.2: `sync-all.ps1 -VerifyOnly` 全绿、`check-interface.bat` 6 OK；证据：命令输出。

## Task 6: 门禁、多端同步与验收
- **Status**: `pending`
- **Priority**: high
- **Depends On**: T2, T3, T4, T5
- **Description**:
  - 跑：`node --check`（权威源与副本）、`tools\copy-consistency.cjs`、`check-interface.bat`、`tools\diff-cross-version.cjs`、`sync-all.ps1 -VerifyOnly`、`check-cv-hashes`。
  - 服务端 + 静态随 `git push` 由 Pages 部署（functions 即时生效）。
  - 云桌面：`generate-desktop-hotupdate.cjs -c cloud` 生成热更（客户下次启动即达）；云 APP 在线壳重进即达、无需重打 APK。
  - 交付：T1 取证记录、T4 回填报告、AC-1~AC-6 证据汇总；**等用户确认后再 commit/push**。
- **Acceptance Criteria Addressed**: AC-1~AC-6
- **Test Requirements**:
  - `rule` TR-6.1: 上述门禁命令全绿；证据：命令输出。
  - `rule` TR-6.2: 端到端复验：云桌面新开一方 → 云端网页版 + 云 APP 同账号均能看到（含 AC-1 的失败可见态验证）；证据：录屏/截图。
  - `rubric` TR-6.3: 按 AC-6 复评根因证据链，≥4；证据：评审记录。

---

## 验证记录（2026-10-20，T2+T3 实施后）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 语法 | `node --check functions/api/prescriptions.js` / `_lib/prescriptions-store.js` | 0 / 0 |
| 客户端假成功回归 | `node tools/cloud-sync-fake-success-test.cjs` | **6 PASS / 0 FAIL** |
| 同上（修复前基线） | 同一脚本 + `git show HEAD:public/index.html` 导出的旧版 | **3 PASS / 3 FAIL**（T1 三条全红 = 缺陷证据） |
| 界面保护 | `check-interface.bat` | 6 OK, 0 CHANGED, 0 MISSING |
| 多端同步 | `tools/sync-all.ps1` + `-VerifyOnly` | HTML 副本与权威源一致 / All files are in sync |
| 副本一致性 | `node tools/copy-consistency.cjs` | 100 副本 / 0 失败 |

改动文件：`functions/api/prescriptions.js`、`functions/api/_lib/prescriptions-store.js`、[public/index.html](file:///d:/trae_projects/kyt-zy/public/index.html) + 3 份云副本（sync-all 分发）；新增 [tools/cloud-sync-fake-success-test.cjs](file:///d:/trae_projects/kyt-zy/tools/cloud-sync-fake-success-test.cjs)（尚未接入门禁）。
**未提交、未 push**（等用户确认）。

### 备注：本次报障的另一种解释
用户反馈「重登/刷新后就能看到」→ 该次现象也可能是**读侧（客户端列表/缓存）在页面会话内存中未刷新**，而非写入丢失。T2/T3 消除的是"写入侧假成功"这一类可能长期不可见、且客户端显示"已同步"的最危险情形；若要彻底排查读侧，需保留复现时段的函数日志（POST 是否带 `d1WriteFailed`）。
