# License 域数据防御架构（举一反三）

## Context（为什么做）

2026-09-06/07 连续三起同类事故，均为"数据无守门、无生命周期、无体检"的结构性缺陷：

1. **脏数据入库**：客户端 getMachineId 桥失败 → 错误 JSON 串被当 machineId 上报 → 真实客户的设备绑定写入垃圾 key `device_version:{"success":false,...}`（已单点修复 setDeviceVersion 校验，但其余字段/入口无统一守门）
2. **数据无生命周期**：待付款订单永不过期，测试单/弃单永久占据后台列表（已修 admin-list 7 天惰性过期，但清理依赖"恰好有人打开列表"）
3. **手工清理漏删**：历次清 KV 只删 admin_req 漏删 order:/active_order: → 堆积 11 个孤儿键（已一次性清理，但清理工具全是 tools/_tmp 一次性脚本，下次复发还要现写）

**目标**：三层防御架构，杜绝同类问题——入口守门（schema-guard）→ 单一写者（写域全收口）→ 自愈巡检（后台数据体检）。**范围仅 license 域**（历史事故 100% 集中于此；users.js 的 clinic: 域不动，避免过度工程）。纯云函数 + 后台页改动，客户端五端零改动零重打包。

**关键事实（已探明）**：
- `active_order:{machineId}` 是 license 域唯一未收口进 license-write-service.js 的写入（order-submit.js L346-356 散写）
- `bindOrderToRequest` 对 orderNo 零校验（同族缺口）
- 后台页两份副本（public/admin/index.html 250790 字节 vs site-admin/admin/index.html 244950 字节）**已双向漂移**：public 独有免费开通白名单（13 处）、site-admin 独有风控/用量监控（8 处）——**不能整文件复制同步，必须等价增量双改**
- 界面保护基线（.interface-lock.json）只覆盖 6 份业务页，admin 页不在基线内，加区块不违界面铁律（free_pass 区块/风控 tab 均有历史先例）
- KV license 域量级极小（约 40 order 键、4 条 device_version），扫描无成本压力

## 架构三件套

### A. schema-guard.js — 字段校验单一来源 + KV key 工厂

**新建** `functions/api/license/_lib/schema-guard.js`（零依赖纯函数叶子模块，约 180 行）：

- `RE` 正则集：machineId（`/^[A-Za-z0-9_-]{8,64}$/`，与已上线 setDeviceVersion 规则一致）/ phone / orderNo（对齐 order-submit L166）/ requestId / licenseCode
- `isValidMachineId/isValidPhone/isValidOrderNo/isValidRequestId/isValidLicenseCode`（machineId 显式拒 unknown/undefined 字面量）
- `normalizeOrderNo(v)`（trim+大写）
- `KV_PREFIX` 裸常量（体检/清理路径用——脏 key 恰恰要能枚举删除）
- `kvKey` 工厂（**写路径专用**：adminReq(rid)/adminPhone(phone)/order(orderNo)/activeOrder(mid)/deviceVersion(mid)/testMachine(mid) 等——非法入参直接 throw，杜绝构造垃圾 key）

**收口 5 个文件（内联校验改引用，行为/文案不变）**：
1. `license-core.js`：setDeviceVersion 内联正则 → isValidMachineId；setTestMachine/removeTestMachine 补校验（core 层纵深防御）
2. `license-write-service.js`：upsertFreePass/removeFreePass 手机号正则 → 引用；**bindOrderToRequest 补 isValidOrderNo**（堵零校验缺口，调用方已前置校验故零行为变化）；createAdminRequest 补工厂校验；内部拼 key 改走 kvKey
3. `order-submit.js` / `admin-submit.js` / `free-pass.js`：入口校验改引用（文案不变）

### B. active_order 写入收口 — license 域最后一块散写

**license-write-service.js 新增**：
- `ACTIVE_ORDER_MAX_AGE_MS = 48h`（语义随索引收口单一副本）
- `bindActiveOrder(kv, machineId, entry)`（kvKey 工厂校验 mid；**值结构五字段必须与现网 L347-353 逐字段一致**——隐式契约，改了幂等读就失配）
- `unbindActiveOrder(kv, machineId)`（裸前缀纯 delete——清理路径必须能删脏键）
- `getActiveOrder(kv, machineId)`（order-submit L265 幂等读一并收口）

**调用方改造**：
- `order-submit.js`：本地常量/幂等读/散写 → 三个新函数（保留 try/catch 与 warn 日志原文）
- `admin-list.js` purgeExpiredPendingPayment：`'active_order:'+mid` 直删 → `unbindActiveOrder`（包进现有 jobs 数组）
- write-service 头注释铁律：写域从四类 key 扩为五类（+active_order）

### C. admin-data-audit.js — 数据体检 API + 后台按钮

**新建** `functions/api/license/admin-data-audit.js`（结构对齐 admin-test-machine.js：CORS/POST action 分发/parseAuthHeader+isPlatformAdmin）：

- **action=scan（纯只读）**：内部判定函数 `_classifyOrderMapping/_classifyActiveOrder/_classifyKeyShape/_classifyFreePassIndex`，检测五类问题：
  1. orphan_order（映射指向不存在的 admin_req）
  2. stale_active_order（目标缺失/超 48h）
  3. dirty_key（key 的 id 段不匹配格式正则——正则宽松取向防误报，上线前用存量键全量核对）
  4. expired_pending_payment（超 7 天，cascadeKeys 列出 order:/active_order: 级联键）
  5. free_pass_index_broken
- 响应含 `typeLabel` 中文（前端零映射）、`cascadeKeys`（前端确认时明示连带删除）、summary.byType 计数、200 条截断保护
- **action=clean（幂等）**：每键四步——get 重验证（**复用 scan 同一 classify 函数，禁止重写判定——防漂移误删**）→ 备份原值 → 删主键+级联键 → 记 result（deleted/skipped/failed）
- **备份**：整批写入 `audit_backup:{时间戳}` 单键 + `audit_backup_index`（cap 20 FIFO，超出删最老）；恢复走 wrangler node 脚本（延续 logs/kv-backup 惯例，不做恢复 UI）

**后台页等价增量双改**（public/admin/index.html + site-admin/admin/index.html，锚点：两份共有的 tabAdminActivate 区块末尾 + loadTestMachines 函数前）：
- "开始体检"按钮 + 报告容器（复用现有 filter-bar/table-box/alert 样式，不改 CSS）
- JS 三个函数：`runDataAudit()` / `renderAuditReport(data)`（summary + issues 表 + 复选框）/ `cleanAuditSelection()`（confirm 显示删除键数+级联键+备份键名）
- **一致性验证**：提取两份新增区块分别哈希对比（不能 fc 整文件——已双向漂移）

## 实施顺序（3 个 commit，独立可回滚）

| Commit | 内容 | 验证 |
|---|---|---|
| 1（A） | schema-guard.js + 5 文件收口 | node --check .mjs 副本 ×6；test-schema-guard.cjs（合法/非法边界 + kvKey 抛错 + **存量真实键全量核对不误伤**） |
| 2（B） | write-service 三函数 + order-submit/admin-list 改调用 | node --check ×3；test-active-order-binding.cjs（值结构与现网五字段一致 + 垃圾 mid 抛错 + unbind 纯删） |
| 3（C） | admin-data-audit.js + 双后台页增量 + KNOWLEDGE 条目三十四 | node --check；test-admin-data-audit.cjs（mock kv：五类分类正确 + scan 零写入 + clean 备份完整 + 重复 clean 全 skipped 幂等 + free_pass 索引重建）；双副本新增区块哈希一致；部署后线上点体检验收 |

## 复用清单

- 认证：`functions/api/_lib/auth.js` 的 parseAuthHeader/isPlatformAdmin（注意路径是上级 _lib）
- 备份 FIFO 思想：appendLicenseLog L200 上限模式
- 自测模式：tools/_tmp/*.cjs 复刻逻辑 + mock kv 断言（历次惯例）
- wrangler 特殊字符 key 操作：node 直调 wrangler.js 入口（条目三十三③）

## 风险与对策

1. **双后台页漂移**（最大执行风险）：等价增量双改 + 新增区块哈希对比；不整文件复制
2. **dirty_key 正则误报**：上线前用 dump-admin-kv 模式全量核对存量键；宁可宽松不可误报（条目"宁可漏检不可误报"）
3. **与 admin-list 惰性清理竞态**：clean 重验证后 skip 属正常，前端文案预设"已清理/已跳过（可能已被自动处理）"两种结果
4. **bindActiveOrder 值结构契约**：与现网五字段逐字段一致，自测断言锁定
5. **ESM 验证陷阱**：node --check 必须 .mjs 副本

## 端到端验证

1. 语法：全部改动文件 node --check .mjs 通过
2. 自测：3 个 test-*.cjs 全绿（含存量键核对）
3. 部署：git push 后 Cloudflare Pages 自动部署（云函数 + public/admin 立即生效）
4. 线上验收：后台登录 → 激活审核 tab → 点"开始体检" → 预期报告 0 或极少（9-6 已手工清过）；可写一个测试垃圾键验证 dirty_key 检出 → 勾选清理 → 确认备份键生成、KV 复核删除成功
5. 五端无需重打包（纯服务端+后台页）
