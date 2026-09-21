# 离线免费版（free 授权档）实施计划

> 决策已确认（2026-09-21）：① 形态=**同一个安装包 + 授权分档**（惠康中医-本地包不变，激活窗加【免费使用】）；② 开方**不限量**；③ 付费墙=一键备份/恢复/自动备份、Excel/CSV 导入导出、统计报表导出、**拍照录像**、**处方打印（免费版带水印打印，付费版无水印）**；④ 一期覆盖**离线 Windows 桌面 + 离线 APP**；⑤ 免费授权走服务端签名下发（联网领取一次，机器绑定，之后永久离线），不新增 edition key（复用 edition=personal 形态，差异全部由 license.type=free 表达）。

## 一、Repository Research（调研结论）

- 授权类型矩阵已存在：`shared/license/license-manager.js` L150-L167 `LICENSE_TYPE_CONFIG = {trial, personal, pro, voice}`，按类型配 maxPrescriptions/features；validateLicense  licensed 分支 L1814-L1824，到期判定 L1789-L1806（**远期日期即永久，无需新增 perpetual 字段**）。
- 功能权益管道已铺好但渲染层零消费：`shared/license/feature-guard.js`（FEATURES/CN 名/checkFeature fail-closed）；主进程 IPC `license:check-feature`（desktop/electron/main.js L1146-L1154，异常 fail-closed）、preload L133 已暴露。
- 处方计数链现成但本期限 0（不限量）：`shared/license/prescription-counter.js` + IPC can-prescribe/increment/decrement/status（main.js L1090-L1143），free 配 maxPrescriptions=0 即无限。
- 激活链路：激活窗 `app_project/db-offline/desktop/electron/activate-window.html`（版本卡 L348-L368、三 Tab）；在线领取经 `activate.js activateOnline()` POST `/api/license/claim` → 服务端 `functions/api/license/claim.js`（门面）→ `validate.js` 签发；installLicense（license-manager.js L2239-L2406）写 license.dat+建账户+签 config。
- 启动分流闸：desktop/electron/main.js L796-L1011；关键铁律 L1667-L1682「get-app-config 对非正式机构授权一律 merged.edition='personal'」——**free 走验签正式 license，天然被校正为 personal，单用户/隐藏用户管理自动继承，无 UI 形态风险**。
- 功能入口（离线权威源 app_project/db-offline/desktop/index.html）：
  - 备份/恢复/清空：exportData L8615 / importData L8833 / clearAllData L8906；自动备份 dailyAutoBackup L8393（保存后 L7949、启动 L5785、退场 L8413 三触发）；IPC 在 shared/desktop-fs-ipc.cjs L524/541/570/594/618，**均不查权益**。
  - Excel/CSV：exportMedicines L9090、Excel L9115、CSV L9135、importMedicines L9243、历史处方导出 L9153、统计 exportStats；当前零门控。
  - 打印：printPrescription L7636（纵/横向按钮 + 移动端），主进程 print IPC（preload L16）。
  - 拍照录像：photoCaptureBtn2/videoRecordBtn（DOM 第 658 行）+ voice/媒体注入；video-recorder.js 由主进程注入；enableMediaButtons index.html L4902 附近（云端行号，离线同构）。
  - 版本标签：getEditionTag 离线 index.html L1957-L1961；渲染层拿授权类型的途径=AuthCore 缓存/license:check-feature 回传 licenseType（feature-guard L51 已返回）。
- 离线 APP：`app_project/db-offline/app/.../LicenseManager.java` 已解析 v2 签名内容 user|type|issuedAt|expiresAt|maxPrescriptions|features（L1804/L1881-L1891/L2105），type→默认权益映射 L3408-L3422，归一化 L3157-L3172；**加 free 是分支级小改**。风险：Java 验签版本（v2 HMAC/v3，未见 v7 Ed25519）——服务端给 APP 发 free 时须按客户端签名能力下发兼容版本，或复用 APP 现有 validate 通道（实施时第一步核实，见风险 R3）。
- 打包/渠道：package.json productName「惠康中医-本地」appId com.benneng.prescription，NSIS+portable；热更渠道 hot-update/desktop/local；本期同包，**不动打包与渠道**。
- 多端铁律（KNOWLEDGE §2）：shared 权威源改完跑 sync-all.ps1；离线共性只改 db-offline/desktop/index.html → tools/sync-index-app.cjs 33 变换双写 APP；官网 download.html 双副本手工镜像 + diff-cross-version download 对基线；改界面前后跑 check-interface.bat。

## 二、最终权益矩阵

| 功能 | free 免费版 | personal 标准版 | pro 机构版 |
|---|---|---|---|
| 开方/剂数药费/中药库/验方/简码/回收站/本人历史 | ✅ | ✅ | ✅ |
| 处方打印 | ✅ **带水印**（页脚"惠康中医免费版"+二维码，打印 DOM 注入，不改 HTML 结构/CSS） | ✅ 无水印 | ✅ 无水印 |
| 自动热更新 | ✅ | ✅ | ✅ |
| 备份/恢复/自动备份 | 🔒 feature=backup | ✅ | ✅ |
| Excel/CSV 导入导出、统计报表导出 | 🔒 feature=data-export（新增位） | ✅ | ✅ |
| 拍照/录像 | 🔒 feature=media-capture（新增位） | ✅ | ✅ |
| 多用户/收费台/全院查阅 | 形态关闭（personal 继承，隐藏） | 形态关闭 | ✅ |
| 语音 | —（桌面不具备）/ 按现 voice 线 | voice 线 | 按现策略 |
| 有效期 | 永久（expiresAt=2099-12-31） | 年费 | 年费 |

## 三、Files and Modules（权威源 → 分发）

**授权与功能（shared 权威源，sync-all 分发）**
- `shared/license/license-manager.js`：LICENSE_TYPE_CONFIG 加 `free:{maxPrescriptions:0,features:[]}`；hasFeature/getLicenseType 对 free 的只读语义确认；消息文案（feature-guard.js L52-L59 加 free 分支"升级标准版后可用"）；FEATURES 新增 DATA_EXPORT/MEDIA_CAPTURE/PRINT_CLEAN（PRINT_CLEAN=无水印打印，free 缺省→带水印）+ CN 名。→ sync-all Group 4（4 副本）+ feature-guard 副本组。
- `app_project/db-offline/desktop/electron/main.js`：① 新增 IPC `license:claim-free`（调 activate.js 新方法，POST 新端点，成功后 installLicense 并删 trial 标记，重启提示）；② 备份/恢复/自动备份、打印 IPC、媒体注入链在主进程侧加 featureGuard 校验（fail-closed；打印不拦截只回传 watermark=true/false）；③ 启动闸 L852-L858 未授权校正逻辑对 free 确认（预期零改，补注释与测试）。
- `app_project/db-offline/desktop/electron/activate.js`：claimFreeOnline()（仿 activateOnline L83-L120）。
- `app_project/db-offline/desktop/electron/preload.js`：暴露 claimFree；确认 checkFeature 已在。
- `app_project/db-offline/desktop/electron/activate-window.html`：首屏加【免费使用】卡（第 3 张卡，不改现有两卡结构；点击→手机号可选→claim-free→成功重启）；免费/试用按钮互斥逻辑（已领 free 不再显示试用与免费卡）。
- 服务端（新增/修改）：`functions/api/license/claim-free.js`（新端点：schema-guard 验 machineId、限每机一份活跃 free、可重领；调 _lib/license-core 签发 type=free、expiresAt=2099、features=[] 的签名 license；写 KV 记录，复用工单/设备表）；`functions/api/license/_lib/license-core.js` 类型白名单放行 free 且 PAID_LICENSE_TYPES 排除；日志/列表 type 中文标签（list/lookup 最小改动）。

**渲染层（离线权威源 index.html → sync-index-app 双写）**
- `app_project/db-offline/desktop/index.html`：
  - getEditionTag 细分：edition=personal 且 licenseType=free → 标签「离线免费版」（授权类型从启动 IPC/auth-core 缓存读，加一个启动时 license:check-feature 或 get-prescription-status 回传缓存到 window.__licenseType）。
  - 统一升级引导组件（JS 动态注入，不动 HTML 基线）：`requireFeature(featureName, fn)` 包装器——先 await electronAPI.checkFeature，allowed 则执行，否则弹升级框（复用激活窗 openAdminActivate）；备份/导出/统计/拍照入口统一包一层。
  - 打印：printPrescription 前取 PRINT_CLEAN 权益；free 时打印容器注入水印层（CSS 类动态加，**不改静态 HTML/CSS 文件结构**），打印后移除；主进程打印 IPC 同步水印判定双保险。
  - 拍照录像：enableMediaButtons/注入按钮处按 media-capture 门控；移动端按钮同。
  - 自动备份三触发点：free 直接短路跳过（保留手动入口的升级提示）。
- `tools/index-app-transforms.cjs`：若有 APP 专属差异（JS 桥方法名/打印方式）进变换表；原则上 index-app 自动获得全部渲染门控。

**离线 APP 原生（Java）**
- `LicenseManager.java`：type=free 归一（L3157-L3172 默认 features=[]、max=0、永久）；权益查询给 JS 桥的返回加 data-export/media-capture/print-clean；确认 free license 签名版本兼容性（R3）。
- APP 领取免费授权入口：WebView 激活页同卡片走 APP 网络通道（直连 API，白名单已含 pages.dev）；原生侧只读/功能拦截与桌面对齐（打印走 Android 打印框架时查权益；拍照桥拦截）。

**官网/文档**
- `public/download.html` + `site-official/download.html`（镜像双改 + Playwright 双档验证 + diff-cross-version --pair download）：增加"永久免费版"说明（同一下载、安装后选免费使用）、对比表加免费列、FAQ 2-3 条（免费/付费差异、数据如何升级、换机）。
- `.trae/KNOWLEDGE.md`：本轮结论沉淀（free 授权档设计、feature 位清单、水印打印方案、APP 签名兼容结论）。

## 四、Implementation Steps（分阶段，每阶段独立可验证）

1. **阶段 0·授权核心（先跑通单一模块）**：license-manager/feature-guard 加 free 与 3 个新 feature 位 → sync-all 分发 → 服务端 claim-free.js + 白名单（先用 curl/脚本自测签发-验签）→ 桌面 main.js IPC + activate.js + preload + 激活窗卡片 → 机验证：全新机器点【免费使用】→ license.dat 落 free、重启后类型 free、edition=personal、开方无限、标签「离线免费版」；同一机器输入付费激活码→原地变 personal 且数据全在；断网场景走宽限（沿用 trial 宽限口径）。
2. **阶段 1·桌面功能墙+水印**：requireFeature 包装器 → 备份/恢复/自动备份、6 个导出/导入入口、统计导出、拍照录像（渲染+主进程双拦）→ 打印水印（free 带水印/personal 无水印）→ 升级弹窗复用激活窗。check-interface 前后各跑一次（界面铁律）。
3. **阶段 2·离线 APP**：Java free 分支 + 权益桥 + 签名兼容性核实/处置 → index-app 经 sync-index-app.cjs 生成（禁止手改生成副本）→ 安卓真机：领取/标签/四个功能墙/水印打印/拍照拦截/升级付费全链路。
4. **阶段 3·官网+打包+收尾**：download.html 双副本与 FAQ → Playwright 1280/375 双档 → 离线桌面整包打包（pack-desktop 流程，热更不覆盖主进程改动，**必须发新整包**）→ E2E 回归（verify-fs/windows-domain 现有脚本）→ KNOWLEDGE 沉淀 → commit/push（信息含五端生效方式）。

## 五、Dependencies and Considerations

- 私钥不出服务端：免费授权由 Cloudflare function 用现有签名私钥签发；客户端不内置任何签发能力。free 权益最小，伪造 free 无收益，不扩大付费版破解面。
- 每机一份活跃 free（KV 设备记录，可重装重领，同 trial 口径）；手机号选填（留资用于找回/营销，不填凭 machineId 也可领）。
- 免费→付费=installLicense 覆盖同机 license.dat，config/users/处方库零迁移；付费年费过期弹窗增加【降级为免费版继续使用】（claim-free）作为附带优化，防止到期即锁死。
- 水印仅打印期注入 DOM、结束移除，确保 check-interface 基线（静态结构零变化）；二维码内容=官网下载页 URL（实施时确认短链）。
- 不新增 edition key：避开 15 处归一化名单/服务端版本枚举改动；版本显示细分只读 licenseType。
- 云端三端（网页/云桌面/云APP）本期**零改动**（free 是离线授权类型，云端登录响应不产生 free）。

## 六、Validation

- 单元/脚本：服务端 claim-free 签发后用 license-manager verifySignature 本地验签通过；feature-guard 对 free 的全部新位返回 allowed:false、backup 对 personal 放行。
- 桌面真机（优先用新设备/便携版隔离数据目录）：①全新领取 free（有网/无网宽限两条路径）②免费版各功能墙与水印打印 ③付费码升级后功能全开无水印、数据完整 ④付费到期→降级 free ⑤已付费老用户升级安装包后行为不变（回归）。
- 门禁：check-interface 6 OK；sync-all 全绿 + copy-consistency 0 失败；node --check 主进程改动文件；diff-cross-version 四对基线（download 对改完重冻结）；sync-index-app 幂等（重复运行零改动）；E2E verify-fs-domain / verify-windows-domain 双端全绿。
- APP：安卓真机免费/付费两态 + 重装重领 + 打印水印。
- 官网：Playwright 双副本双档无 pageerror。

## 七、Risks

- **R1（高）漏同步事故**：license-manager/feature-guard 多副本 + 离线 APP 双写 + 官网双副本。缓解：只改权威源、每阶段跑 sync-all/copy-consistency/sync-index-app，禁止手改生成副本（KNOWLEDGE 铁律）。
- **R2（高）"未授权强制 personal"铁律误判**：free 必须始终是验签正式 license；宽限模式下不可让 feature 位 fail-open。缓解：渲染层拦截只做体验，**执行点全部在主进程 IPC fail-closed**；宽限态按 trial 同口径（只读/功能不可用），补签名后恢复。
- **R3（中）APP 签名版本兼容**：Java 端验签实现可能不支持服务端当前 v7 Ed25519。缓解：阶段 2 第一步实测；不兼容则服务端按客户端版本号下发 Java 支持的签名格式（license-core 已有多版本签名能力），不放宽验签强度。
- **R4（中）水印影响处方签合规/美观**：缓解——水印仅页脚小字+二维码，不压诊断/药物区；出 1 张样张给用户确认后再铺开。
- **R5（低）时钟回拨**：free 永久授权无月限，计数器不参与，回拨无收益；付费到期判定沿用现有 last-run.dat 机制。
- **R6（低）自动备份短路**：free 跳过自动备份时不产生报错噪音，静默跳过+首次手动点击时一次性引导。
