# 惠康中医项目 · 共享经验知识库（PROJECT KNOWLEDGE）

> 本项目**跨 work 账户共享的"统一大脑"**，随 Git 走，任何账户/电脑打开同一仓库即读到同一份经验。
> **以本文件为单一权威源**，各账户本地 `project_memory.md` 只是它的刷新副本（由 `学习经验.bat` 灌入）。
> 2026-08-30 归纳瘦身版：历史过程记录已压缩为主题化规范，所有规则以本版最新确定为准。
> 维护方式：每轮优化完成后**更新对应主题区块**（合并而非追加），保持精简。

## 0. 跨账户共享使用说明（新人必读）

* AI 本地记忆 `project_memory.md` 在 `C:\Users\<Windows用户>\.trae-cn\memory\projects\...`，**绑定账户**；换账户登录看不到旧经验。

* **新账户首次登录必做**：双击 `.trae\学习经验.bat` → 本文件同步到当前账户本地记忆（AI 每次打开项目自动加载）。定位记忆目录用精确哈希名，禁止 `*-kyt-zy*` 通配（会误匹配 offline-project 等其它子项目）。

* **读取**：每次会话开始先 Read 本文件（`.trae/rules/project_rules.md` 已配置自动提示）。

* **沉淀**：每次优化完成后把「结论+生效方式」合并进本文件对应章节 → git commit + push（或双击 `同步推送经验.bat`）。

* 约定：本地记忆永远由本文件派生，禁止反向把过期旧内容抄回仓库。

## 1. 会话安全与工作流（每次会话开始必查）

* TRAE SOLO CN 会话恢复会**静默覆盖工作区到旧快照**（无确认弹窗）→ 每次会话开始先 `git status` 验证，异常用 git checkout 恢复（工作区相对 HEAD 只有删无增=纯回退可安全恢复）。

* 修改完成自动 commit + push（Cloudflare Pages 部署依赖 GitHub 推送），无需用户要求；commit message 必须包含生效方式段落。

* 优化完成后必须提示各端生效方式：云端网页（自动部署）/ 云桌面（是否重打 exe）/ 云端APP（是否重打 APK）/ 离线桌面（是否重打 exe）/ 离线APP（是否重打 APK）。

* 基线（interface-lock）必须随代码一起 git 提交，杜绝"本机有、别人没有"。

* ★ 2026-09-01 模型调度铁律（GLM-5.3 专属补贴 0.4x 版 · 本平台内置无 Flash，仅 GLM-5.3 四折）—— 禁止 Auto Mode 自动切模型，严格按「一句话决策法」手动选：

  **① 一句话决策法（小白必背，不要查表）：**

  ```
  ▸ 我要做【方案/决策/工期/评估/代码审查】→ Seed-2.1-Pro（强制）；决策完再让 GLM-5.3 过一遍（几乎免费的交叉意见，0.4x≈1×积分当量）
  ▸ 我要做【写代码/改代码/修 Bug】→ 一律 GLM-5.3（0.4x 补贴）。同 Seed-Code 价位（≈1×基准），但 Terminal-Bench 3.0 28.3 分（前代 4.6 分），DeepSWE 66.9 > DeepSeek V4-Pro 62.7，CyberGym 安全第一
  ▸ 我要做【扫清单/找差异/批量读代码】→ Seed-2.1-Turbo。纯提取无推理，0.8× 最便宜最快
  ▸ 代码改完了 → 必须切 Seed-2.1-Pro 独立审查（铁律，灯下黑必防）；若改的是【激活/登录/数据库/安全接口】高风险链路 → Pro 审查完再追加 GLM-5.3 安全视角二查（多花 <1 单位，纯安全保险）
  ▸ 月底了 → 全代码库 GLM-5.3 做一次完整白盒漏洞扫描（CyberGym 84.5% 挖洞能力，现 0.4x≈0.8 单位成本，从「建议项」升格为「强制必做」，预防 admin-status 级漏洞）
  ▸ 代码彻底崩了（调 3 天调不出）→ DeepSeek V4-Pro（竞技编程最强 Codeforces 3206），同时让 GLM-5.3 交叉看一遍（双核定位最快切根因）
  ```

  **② 三段式分工流程（省 40% 积分 + 质量不降）：** 扫（Turbo 批量拉清单）→ 策（Pro 做方案决策）→ 实（GLM-5.3 写代码）。禁止把「扫清单+做决策+写代码」全堆给 Seed-2.1-Pro 一把梭。

  **③ 9 大场景详细模型矩阵（含积分当量对比，基准=Seed-Code=1×）：**

  | # | 场景                                          | 推荐模型                                                                  | 积分当量                       | 高效/稳定/经济                                                  | 备注                       |
  | - | ------------------------------------------- | --------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------- | ------------------------ |
  | 1 | 🧭 战略决策（可行性/工期/方案/风险评估/上架策略）                | Seed-2.1-Pro 强制 + GLM-5.3 交叉二意见                                       | 2.5× + 1×                  | 中文业务语境最贴合 + 跨领域HLE补充                                      | 决策错=100×返工，Pro 一次写对最省钱   |
  | 2 | 🔍 批量扫描提取（6份index差异/8处版本号/桥方法清单）            | Seed-2.1-Turbo 专属                                                     | ≈0.8×                      | 提取专用                                                      | 仅输出结构化列表，不做判断            |
  | 3 | 💻 简单代码修改（<200行 版本号/文案/脚本/按钮）               | Seed-Code 或 GLM-5.3（同价位任选）                                            | 1× / 1×                    | GLM一次写对率更高（少返工更省）                                         | 小白用户直接选 GLM 更省心          |
  | 4 | 💻 中等实现（200-1000行 下载器/漏洞修复/桥方法翻译）           | **GLM-5.3（主推荐）** + Pro 审查                                             | 1×                         | 同价位旗舰写中型代码                                                | 中等任务返工率降低 50%            |
  | 5 | 🔐 高复杂度后端/安全链路（HUKS/License验签/激活Bridge/云授权） | **GLM-5.3（主推荐）** ｜ DeepSeek V4-Flash（谷时高缓存命中>70%备选）                   | 1× / ≈0.6×                 | CyberGym 安全基因 + DeepSWE 66.9 修复率第一                        | 安全链路贵 0.4× 换安全升一档极划算     |
  | 6 | 🆘 深层疑难Bug/大重构（白屏/加密错/数据损坏/架构变）             | **DeepSeek V4-Pro（第一）** + GLM-5.3 双核交叉定位                              | 3× + 1×                    | V4-Pro竞技编程最强；GLM补安全视角                                     | 双核交叉省 2-3 轮反复排查，远大于增加的1× |
  | 7 | ✅ 代码独立审查（每轮强制）                              | **Seed-2.1-Pro 日常强制** + 高风险修改后追加 GLM-5.3 二查 + **月底强制 GLM-5.3 全库漏洞扫描** | 2.5× ×N + 1××N追加 + ≈0.8×/月 | **最值的一环**：Pro审查+GLM月扫=避 admin-status 级漏洞≈省50-100单位修复+客户损失 | 独立新轮次新开Pro，不可顺手写代码模型自审   |
  | 8 | 📝 文案/合规文档                                  | 隐私政策→Seed-2.1-Pro；其他文案→GLM-5.3                                        | 2.5× / 1×                  | Pro合规严谨，GLM文案流畅同价                                         | <br />                   |
  | 9 | 🎨 视觉/多模态（当前无GLM-5V）                        | 截图转文字描述 + Seed/GLM 纯文本理解                                              | 1×                         | <br />                                                    | 等平台后续支持多模态模型再补           |

  **④ 经济性&鸿蒙B方案预算参考：** GLM-5.3 0.4x补贴后≈1×（和Seed-Code同价位，能力对标原价 2.5× 档）。鸿蒙B方案开发 5 周周期全量积分预算：原 68 单位 → 新 57.8 单位（显省 15%），含返工率降低隐性收益合计省 30-40%；月底 GLM 全库扫从「建议」升格「强制必做」（≈0.8单位，白捡 CyberGym 全球第一挖洞能力）。
  **⑤ 强制合规：** 每轮代码修改完成 → 切回 Seed-2.1-Pro 独立审查（不可自审自己写的代码）；改完立即跑 check-interface.bat 验界面保护；月度 GLM 全库漏洞扫纳入 §1 必查与 §9 安全防破解联动清单。

## 2. 多端文件同步清单（漏同步 = 历史主因 bug，改动必查）

**index.html「2 权威源 + 全自动传播链」**（★ 2026-09-13 P1 收口，替代旧「6 份手工同步」——改界面从 6 处收敛为 **2 处手改点**，其余 4 份全部生成）：

| 副本 | 文件 | 维护方式 |
|---|---|---|
| **云端权威源** | `public/index.html` | **手改点①（云系唯一手改处）** |
| → 云桌面 | `db-yunduan/cloud_desktop/index.html` | `sync-html.ps1` 自动生成（sync-all Group 11） |
| → 云APP assets | `db-yunduan/cloud_app/app/src/main/assets/public/index.html` | 同上（09-13 收编回链；云APP WebView 实载线上 public，本地 assets 仅打包兜底） |
| **离线权威源** | `db-offline/desktop/index.html` | **手改点②（离线系唯一手改处）** |
| → 离线APP 打包源 | `db-offline/index-app.html` | `sync-index-app.cjs` 应用 33 条变换表自动生成（sync-all Group 13） |
| → 离线APP assets | `db-offline/app/app/src/main/assets/public/index.html` | 生成器同一 buffer 双写 |

* **改云系共性功能**（云网页/云桌面/云APP）：只改 `public/index.html` → 跑 `sync-all.ps1`（或单跑 `sync-html.ps1`）。
* **改离线共性功能**（离线桌面+离线APP 同改）：只改 `db-offline/desktop/index.html` → 跑 `node tools/sync-index-app.cjs`（或 sync-all.ps1，Group 13 自动含）。APP 专属差异（手机布局/Android 桥/启动竞态等 33 项）进变换表 `tools/index-app-transforms.cjs`（T01-T34 编号审定；**T22 已废弃永不复用**——escapeJs 吞参欠债条目，删除后桌面修复自动流灌）。
* **跨版本功能移植**（云端↔离线，两产品形态深度分叉）：仍需人工双侧移植，`diff-cross-version.cjs` 三层基线守卫兜底单边漏改（CI 第 7 道：Tier A 单侧新增函数/Tier B 同体函数单边改动/Tier C 新增分叉均红灯）。
* **禁止直接改 4 份生成副本**（云桌面/云APP assets/index-app/离线APP assets）——手改会被下次生成静默覆盖；生成器 mustReplaceOnce 硬校验保证锚点失配大声失败，不会错写。

* 官网购买页只需同步 2 份：`public/download.html` ↔ `site-official/download.html`（镜像关系，HTML 和 JS 都要同步；**禁止运行 \_build\_sites.cjs**，历史漂移未收编）。

* ★ 2026-09-08 **【流程铁律】客户端功能优化 → 官网说明自动同步**：每次改动客户端功能/流程/交互（四端任一），完成代码 commit 前必须「官网说明扫描 → 过时即改 → 双副本同步」一步不漏：
  - **扫描点**（改什么查哪里）：①注册/激活/购买流程 → 官网「📝 注册开通」「📋 安装说明」Tab 流程卡片与步骤图；②更新机制 → 「🔄 桌面程序更新方案」三步说明；③账号/密码规则 → 各处「默认 admin」相关提示；④界面截图 → 若 UI 有可见变化须 Playwright 重拍（手法见条目五十三）；⑤FAQ 文字。
  - **执行方式**：rg 关键词扫描双副本 download.html（如 `rg -n "旧流程关键词" public/download.html site-official/download.html`），命中过时表述即改；镜像版大段 JS 改动用 node 脚本写入+回读+语法三重验证（Edit 假成功历史教训）。
  - **验证收尾**：Playwright 双副本过一遍相关 Tab（桌面 1280 + 手机 375 双档），commit 信息注明「官网说明已同步」；漏同步=官网教客户旧流程（如 2026-09-08 发现「定期访问本页面对比版本号」旧说法未随更新直达功能升级）。
  - **生效提醒**：官网说明改动 push 即部署生效（无需打包），但对应客户端功能需各自打包后才真正可用——commit 信息必须写清两端生效方式差异。

* ★ 2026-09-09 **官网 download.html 板块布局全局优化**（客户旅程重排 + 去冗余）：①Tab 按客户旅程重排「下载→安装→注册→购买→邀请→对比→FAQ」（site-official 无 promo Tab 属历史合法差异，保持 6 Tab 只调顺序）；②下载中心顶部加「三步快速开始」渐变指引卡（①选版本下载→②安装登录→③开通使用，switchTab 联动）；③安装说明 Tab 删 3 张与他 Tab 重复的卡（各版本概览→改为一行「相关指引」链接卡；激活流程/云端账户开通流程整卡删除），注册开通 Tab 删与 5 步向导重复的 4 步自助申请卡；④下载卡新增「文件大小」行（hash-manifest size 字节→fmtSizeMB 显示，桌面卡含安装版+便携版）；⑤releaseNotes 摘要化——20KB+ 多版本累积日志默认只显示最新版前 3 条要点（renderNotesWithToggle，点链接展开/收起）；⑥FAQ 16 条分 5 组（版本与试用/账号与激活/下载与安装/数据与恢复/购买与订阅，.faq-group-title 样式；同日按用户要求升级为紫色渐变底 #667eea→#764ba2 + 白色粗体 15px，对齐页头/按钮主视觉突出标题，浅紫 0.08 透明底对比度太弱已弃用）。
  - **教训（本次实测踩坑）**：会话中断恢复后双副本呈"半同步"状态——site-official 已调用 fmtSizeMB 却无函数定义（JS ReferenceError）、public 缺 size-cloud 行、两副本 FAQ 分组各只有 2 组且不一致。**铁律：官网双副本改动必须 Playwright 双副本双档（1280/375）验证后才允许 commit**，脚本模式存 `tools/_tmp/verify-download-page.cjs`（含 pageerror 断言/Tab 顺序/FAQ 分组语义/notes 展开交互/手机档横滚，本轮 90 断言全过）；FAQ 展开是 max-height 0.3s 过渡，断言可见性前须等 400ms。

* **auth-core.js 双权威源**：`shared/auth-core/offline.js`（试用版→3 副本）+ `cloud.js`（无试用→8 副本），改副本必须回写权威源后跑 `tools/sync-auth-core.ps1`，否则打包被旧版覆盖（历史"神秘回退"根因）。

* `cloud-api.js` 有 **8 处副本**需同步；APP 版 cloud-api.js 必须含 `typeof window._cloudReachable === 'undefined'` 防御性初始化。

* ★ 2026-09-13 **离线系 index.html 生成模式**（P1-B 收口，替代旧「双源纪律」人工移植）：`index-app.html` 不再手工维护——由 `db-offline/desktop/index.html`（离线权威源）经 `tools/sync-index-app.cjs` 应用 33 条字面变换自动生成（同 buffer 双写 index-app.html + assets 副本，SHA256 自校验；`--verify-only` 漂移守卫）。**铁律：①改离线共性功能只改 desktop/index.html，APP 专属差异进 `tools/index-app-transforms.cjs` 变换表，改完跑生成器——禁止手改 index-app/assets；②工作流顺序 = 先 `sync-shared-blocks` 再跑生成器（锚点落入 USER-STORE/USER-ADMIN 标记块自动红灯，该块单独管理）；③生成器 mustReplaceOnce：每条 find 恰好命中 1 次，失配 exit 1 输出条目 id/修复指引——禁止依赖脆弱锚点；④接线上表 Group 13，pre-push ②/CI ②自动生效；build-app.bat 拷贝链不动，`diff-index-app.cjs` 降级为语义级冗余守卫（函数集对比，基线 .drift-baseline.json）。** 首次落地验收：生成后 `git status` 零改动（字节级复刻现存文件）+ 重复运行幂等；B0 已完成反向移植欠债审查（09-03 统一路由/09-06 密码自愈已移植桌面；09-11 激活码核验判 APP 专属进变换表 T15-T17）。

* shared JS（button-manager/edition-lock/performance-utils 等 8 个业务模块）：改 `shared/` 权威源后跑 `sync-all.ps1`。★ 2026-09-13 P2-A1：db-adapter.js / patient-archive.js 经全端触点审计（动态访问/IIFE/构建链/工具脚本 33 轮扫描）确认零消费，连同 22 份物理副本、sync-all Group 1 / obfuscate MODULE\_FILES / generate-hot-update / build-app.bat MODULES / 两桌面 package.json build.files / APP\_MODE 过期注释一并移除；官网 WAF 敏感路径黑名单与软著历史文档中的名称引用按防御/存档设计保留。

* ★ 2026-09-13 **桌面更新器 update-manager.cjs 单一权威源**（P0-1 架构收口）：云桌面+离线桌面 main.js 原各内嵌 ~250 行同构更新器（仅渠道 URL 不同，历史人肉双改）——现抽为 `shared/update-manager.cjs`（createDesktopUpdateManager 工厂，checkUrl/downloadPageUrl 入参注入渠道差异，checkForUpdate + handleWindowOpen 两个接线点），双 main.js require 接线（每份 -250 行）。分发：sync-all **Group 12** → 2 个 electron 目录 + copy-consistency **新组**（2 副本硬哈希门，与 electron-logger.cjs/pe-guard.cjs 同位同构）。**铁律：①改更新逻辑只改 shared/update-manager.cjs，禁止再改两份 main.js 内嵌副本（改了会在 copy-consistency 门被拦或打包时 Auto-FIX 覆盖）；②main.js 只保留 UPDATE_CHECK_URL/UPDATE_DOWNLOAD_URL 渠道常量与两个接线点；③新增 shared/ cjs 模块必须三处登记——sync-all.ps1 加 target 组 + copy-consistency.cjs 加 GROUPS + 确认打包 build.files 覆盖（electron/**/* 默认已含）**。生效方式：云桌面/离线桌面需重打包；其他端不受影响。

* ★ 2026-09-13 **P2-A 减法+安全三件套**（死重移除 + API 收缩 + escapeHtml 归一，观察期内提前执行项）：
  1. **死模块移除**：db-adapter.js / patient-archive.js 全端 22 份物理副本删除，分发链（sync-all Group 1 / obfuscate MODULE\_FILES / generate-hot-update / build-app.bat MODULES / 两桌面 package.json build.files）同步摘除；APP\_MODE 端配置注释由「供 db-adapter.js 自动检测」改「供 button-manager/桌面身份判定消费」（html-sync-check DropLineRules 新旧双条目兼容比对）。
  2. **prescription-core.js 收缩到真实 API 面**：全库触点审计（`PrescriptionCore\.\w+` 命名空间调用 + 动态访问 + cjs/java/ets）实锤唯一活 API = getAutoJianfa（7 份 index.html 防御式调用），原 17 个工具函数（escapeHtml/formatPrice/排序/金额/校验/构建/频率/编号等）自创建即被内联同名实现遮蔽零调用，整体删除（411→185 行）；PaperHistoryToggle 自执行特性整段保留。**同步盲区永久堵漏：site-admin×2/云端APP assets/鸿蒙 rawfile 四副本此前手工维护（stock-core/symptom-dict 同款盲区），本轮手工同步后 copy-consistency.cjs 新增 prescription-core 专用组（10 副本硬哈希），总组数 8/61 副本**。
  3. **escapeHtml 归一（减法式）**：模块死轨删除后唯一活实现 = 各端内联版（强 5 字符 `&<>"'`，云↔离线同体由 diff-cross-version Tier B 基线第 escapeHtml 条目守护）；admin/site-admin/症状字典页均为强 5 字符版；electron main.js 确认框 3 字符弱版仅用于文本节点上下文且配套 escapeAttr——全端无转义缺口。
  验收：sync-all 全绿 / copy-consistency 61 副本 0 失败 / smoke 157/157 / 界面基线 6 OK / 跨版本三层基线全绿 / getAutoJianfa 功能测试（炮制前缀/排除表/普通煎）通过。生效方式：云端网页 push 即生效；云桌面/离线桌面/云端APP/离线APP需各自重打包（减少包体与攻击面）；已装机设备热更后旧模块文件残留磁盘但不加载（无害）。

* ★ 2026-09-13 **P2-B1 site-admin 手工双轨副本跨端基线守护**（观察期内低风险收口：零 HTML 改动零行为改动，纯加门禁）：
  1. **盲区实锤**：`site-admin/index.html`（10513 行、9 个 script、263 函数面）是全库**最后一个脱管的万行级手工副本**——与 `public/index.html` 同源分叉（public 含压缩区块 / site-admin 全展开，格式根本不同），共面 142 函数（42 同体 + 101 分叉）+ 仅 public 113 + 仅 site-admin 103；历史靠人工「8副本统一」刷同步（登录框/操作界面/中药库/实名防护 4+ 次大手工提交），且 _build_sites.cjs 的白名单 `cp` 步骤会整文件覆盖它——生成链与手工双轨并存，html-sync-check / copy-consistency / check-interface 均不覆盖。
  2. **方案**：diff-cross-version.cjs 重构为**多对基线**（PAIRS 数组 + `--pair` 选择）：desk 对（public↔离线桌面，strict span 哈希，原行为不变）+ 新增 siteadmin 对（**normalized 哈希**：字符串感知剔空白+注释后比对——字符串字面量内空白保留防误判同体，注释差异判分叉入 Tier C）。基线文件按对独立（`.cross-version-baseline.json` / `.cross-version-baseline-siteadmin.json`），`--update-baseline --pair <id>` 单对重冻结（防误冻其他对观察基线）。
  3. **接线**：CI 第7道门同一调用自动扩为双对；本地 pre-push 升**十道门**（⑩=diff-cross-version 双对，push 时拦截不等 CI）。desk 对基线键名迁移（tierA\_onlyCloud/onlyDesk→onlyA/onlyB，仅存函数名清单不存哈希值、Tier B 靠双侧相等性判定，重冻结语义等价：27/3/181/48 与旧基线逐项一致）。
  4. **红灯冒烟验收**：Tier A（site-admin 新增 `__p2bSmokeA` 单侧函数→红灯 exit=1）✅ / Tier B（`deleteRow` 单边改注释→红灯 exit=1）✅ / 还原后双对全绿 ✅。生效方式：纯门禁改动，五端零重打包零部署影响，push 即生效。
  **铁律：改 public/index.html 或 site-admin/index.html 的共面函数后，push 前跑 `node tools/diff-cross-version.cjs` 看双对是否红灯；红灯=漏改对侧（共面函数需双侧同步改）或新增分叉（人工确认后 `--update-baseline --pair siteadmin` 归档）。**

* ★ 2026-09-13 **SA 双站架构收口**（网站后台管理 + 官网下载页，安全减法 + 稳定门禁，观察期内低风险项）：
  1. **SA-1 安全减法（死重与毁灭性工具物理清除）**：①删 `site-admin/electron/` 整目录（16 文件 ~800KB）——第一代「惠康堂」桌面壳遗留（README 品牌仍是惠康堂、存图目录「惠康堂处方图片」与现行「惠康中医媒体」双轨）：**无 package.json 无打包入口、site-admin/index.html 零引用、从未在本仓库打包分发**，唯一身份是同步链 target（历史每轮改 auth-core/permission 都要为死代码刷 2 份副本）；②删根目录 `_build_sites.cjs`（rmrf 整站重建脚本，铁律「禁止运行」但物理存在——误触即毁灭 site-admin/site-official 手工成果，「禁止」不如「不存在」）；③删 5 个历史临时工具（`_check_syntax_realname.bat/js`、`_authcore_diff.js`、`_sync_authcore_realname.js`、`_sync_authcore_adminblock.js`，CI/pre-push 零引用）。摘链：sync-auth-core.ps1 cloud targets 9→8（**长期口径漂移就此自洽：注释 8/实际 9/汇总 11 → 全部对齐 8+3=11**）、copy-consistency 63→60 副本（permission/normalize-config/prescription-core 三组各去 site-admin/electron 条目）。**顺手根治：sync-auth-core.ps1 无 BOM——PowerShell 5.1 将 UTF-8 中文按 ANSI 误读，新增注释恰形成破坏 token 才暴露；已补 EF BB BF（对齐 sync-all/html-sync-check 惯例：含中文的 .ps1 必须带 BOM）。** **BOM 二次实锤（2026-09-13 11:24 pack 红灯）：AI Write/Edit 工具重写 .ps1 会剥离 BOM——dfd71e18 编辑 generate-hot-update.ps1 时 BOM 丢失入库，本地 ensure-build-env 自动补回后形成「1 字节未提交修复」→ 源码落定门持续红灯阻断打包（-AutoCommit 只收纳打包成功后的副作用，救不了打包前就脏的状态）。铁律：AI 编辑 .ps1 后立即校验 BOM（丢了当场补齐提交），全量扫描命令 `node -e` 见 git 历史 1535e61a。** 验收：copy-consistency 60/0 失败、auth-core 8 targets 全绿、sync-all 全绿、site-admin 5 页面本地资源引用完整（删除后零悬空引用）。
  2. **SA-2 官网下载页双副本 lines 基线门禁**：public/download.html（4359 行）↔ site-official/download.html（4167 行）双副本手工镜像，332 行差异全靠人工纪律 + Playwright 双档，**push 级零门禁**（09-13 实锤过漂移：site-official 落后 public 需手工修）。函数级三层基线盖不住（差异主体是 HTML 文案/FAQ/流程卡片，不在 JS 函数 span 内）→ diff-cross-version.cjs 新增第三对 `download`，专用 **lines 模式**：全内容「规范化行多重集」差集（逐行字符串感知剔空白+行/块注释+整行 HTML 注释，计重复次数），冻结 185+34 合法差异行为基线；新差异行=红灯（单边新增/单边改文案，旧行消失+新行出现全捕获），基线行消失=INFO（同步收敛），双侧同步改=静默不报警。红灯冒烟三态验收：单边改 FAQ 文案→红灯 exit=1（精确到行+哪侧缺+处置指引）✅ / 双侧同步改函数名→零新增红灯 ✅ / 还原后三对全绿 ✅。接线：CI 第7道门 + pre-push ⑩同一调用自动扩为三对。
  **铁律：改 public/download.html 或 site-official/download.html 任意内容后（HTML 文案/FAQ/流程卡/JS），push 前跑 `node tools/diff-cross-version.cjs --pair download`；红灯=单边改动漏同步对侧（双副本需双侧同步改），确认合法差异后 `--update-baseline --pair download` 归档。** 生效方式：纯减法+门禁改动，五端零重打包；site-admin 瘦身随下次部署生效（副本减少降低发布体积）；auth-core 同步面 12→11 份。
  3. **SA-3 执行结果（xlsx 收口执行 + site-admin 拆分侦察否决）**：
     - **xlsx 全链核清**：各端 index.html 内联的 loadXlsxLibrary 均为 stock-core.js 薄委托（2026-09-12 B期设计），候选链 `['xlsx.full.min.js', 'vendor/xlsx.full.min.js']` 双路径——云端 public/云桌面根路径副本（build.files 含 root xlsx）与离线桌面 vendor/ 副本（build.files 含 vendor/**）**均按需加载，全部是活文件**。实际可执行项仅两件：①删 `site-official/xlsx.full.min.js`（881KB **纯孤儿**：全站 HTML 零引用、hash-manifest 零条目、工具链零引用——历史整目录拷贝残留）；②修正 site-admin/index.html 两处陈旧注释（L9291/L9337 谎称「head 已静态引入」，实际 716 行注释确认按需加载、head 无 script 标签——注释误导后来者以为 881KB 静态阻塞）。
     - **site-admin 管理面/业务面拆分——侦察否决（数据存档防重复侦察）**：全文件 10513 行 = 单一 9009 行内联 IIFE（L1501-10510）承载全部 246 函数；103 个仅 site-admin 的管理函数与 143 个业务共面函数**全程交错**（每千行段 admin 4~25 个：L1500-2499 admin17、L3500-4499 admin23、L7500-8499 admin25……最大连续聚集段仅 13 函数@L4199）。**结论：无干净物理边界，强拆=在生产管理台上对共享闭包做 103 处外科手术**，观察期收益纯维护性（593KB 文件大小非运行时问题，P2-B1 基线已封住漂移风险）→ **定性 P2-B 专属**，且正解应是「site-admin 由 public 变换表生成」（同 index-app.html 生成模式）而非手工拆分。
     验收：三对基线全绿（siteadmin normalized 剥注释=纯注释改动零影响）+ check-interface 6 OK + download 页/download 双副本零改动（无 Playwright 义务触发）。生效方式：五端零重打包；site-official 下次部署瘦身 881KB。


* ★ 2026-09-13 **B2-1 桌面文件域收口**（desktop-fs-ipc.cjs 单一权威源，P0 update-manager 同款工厂模式推广）：云桌面+离线桌面 main.js 各内嵌 ~650 行文件域同构代码（19 个 IPC handler：媒体保存/查找/重命名 + 备份读写/一键恢复/自动备份 + 用户数据 + fs:read-prescriptions-json；20 个工具函数：目录解析/路径白名单/文件名清洗），历史靠人工双刷——现等体抽取为 `shared/desktop-fs-ipc.cjs`（createDesktopFileIpc 工厂，ipcMain/app/dialog/shell/BrowserWindow 入参注入，模块本体零差异；39 项逐项哈希终验双端字节级同体，仅 list-backup-files 注释一字差异归一）。双 main.js 各净减 650 行（2769/2134 行），只保留端配置、license/登录/窗口域与 5 个外部使用点（getExeDirectory/getDownloadsDirectory/migrateLegacyDataToCentral/sanitizeFileName/getDataDirectory destructure 引入，whenReady 迁移/will-download 落盘/change-password 回退）。分发：sync-all **Group 14** → 2 个 electron 目录 + copy-consistency **新组**（2 副本硬哈希门）。**配套工具修复：check-ipc-consistency.js 原只扫 main.js——抽出后必误报，已改为合并扫描同目录全部 .cjs 模块（handler 注册面 = main.js + electron/*.cjs）。** 验收：node --check 双端 ✅ / 模块功能冒烟 46/46（stub electron：19 handler 全注册、媒体 find/rename/delete 回路、备份 save/list/read/delete 回路、user-data 读写回路、路径白名单拒绝）✅ / 十道门全绿（含 IPC 一致性双端 + copy-consistency 63 副本 0 失败）✅ / **真实 Electron E2E 双端 25+25（新增 `e2e/verify-fs-domain.cjs` 双桌面各一份：dev electron + 源码 electron/main.js 直启测最新代码（免重打包即回归），三重隔离 BNZC_E2E_DATA + PORTABLE_EXECUTABLE_DIR（便携分支接管媒体/data/备份/config，绝不触碰真实「安装盘\惠康中医媒体」）+ marker；F1 用户数据回环+路径穿越拒绝 / F2 媒体保存字节级校验+查找 / F3 重命名旧查无新命中 / F4 备份读写回环 / F5 自动备份增删回环 / F6 白名单正删+越权拒绝；killApp 用 taskkill /T 树杀防 GPU 孤儿进程锁 leveldb）。B2 后续每轮抽取（窗口域/安全域等）完成后重跑两份脚本即完成文件域回归。** **铁律：改文件域（媒体/备份/用户数据/路径白名单）只改 shared/desktop-fs-ipc.cjs，禁止再改两份 main.js；新增 electron 域 handler 在模块内注册后双端自动同获。** 生效方式：云桌面/离线桌面需重打包；云端网页/两端 APP 不受影响。**B2 后续候选（未做）：窗口域/安全域/对话框域抽取（desktop-windows/security/dialog），验证本轮打包发布无恙后再推进。**

* ★ 2026-09-13 **B2-2 桌面窗口域收口**（desktop-windows.cjs 单一权威源，B2-1 工厂模式升级版——**窗口域有状态**）：双端 main.js 各内嵌 ~322 行窗口域同构代码 6 函数（focusWindow/getSharedWebPrefs/installDevToolsGuard/injectVideoRecorder/createMainWindow/createLoginWindow，含 240x360 登录窗自适应/1400x900 主窗/DevTools 反调试三重防护/密码框反自动填充注入/视频录制注入/will-navigate+window.open 双拦截），历史靠人工双刷——现等体抽取为 `shared/desktop-windows.cjs`。**与 B2-1 的关键差异（有状态域的抽取范式）：mainWindow/loginWindow/currentLoggedInUser 仍是 main.js 模块级 let 变量（体外约 50 处直接引用零改动），模块经访问器（get/set 闭包）读写，双端 main.js 保持各自状态所有权——纯依赖注入（B2-1 无状态）升级为依赖注入+状态访问器。** 接线点在 updateManager 创建之后（createLoginWindow 内引用 updateManager.handleWindowOpen/checkForUpdate 与 sendStartupHeartbeat，均工厂入参注入）。分发：sync-all **Group 15** → 2 个 electron 目录 + copy-consistency **新组**（2 副本硬哈希门，62 副本总量）+ build.files `electron/**/*` 通配已覆盖（无需改打包配置）。验收：node --check 三文件 ✅ / copy-consistency 62 副本 0 失败 ✅ / IPC 一致性 82 handler ✅ / 界面基线 6 OK ✅ / **真实 Electron E2E 双端 19+19（新增 `e2e/verify-windows-domain.cjs` 双桌面各一份，与 verify-fs-domain.cjs 同款三重隔离+登录链路；W1 登录窗 240 宽/340-460 高自适应/resizable=false（app.evaluate 主进程侧读真实 BrowserWindow getBounds） / W2 密码框 type=text+webkitTextSecurity=disc / W3 登录→主窗 / W4 主窗尺寸区间+最小 1024x700 / W5 dom-ready 注入链三标记（__videoRecorderInjected/__nativeDialogsInjected/__dataErrorToastFiltered）/ W6 alert/confirm 原生替换 / W7 远程整页导航阻断 / W8 window.open 不新窗 / W9 登录窗 closed→setLoginWindow(null) 回写）/ **B2-1 文件域回归双端 25+25 全绿**（证明窗口域抽取零破坏）。**E2E 时序坑（双端脚本都踩了）：dom-ready 注入链是串行 await，权限完成≠注入链跑完——W2/W5 断言必须先 waitForFunction 轮询等标记（8s 超时）再逐项断言，否则机器慢时竞态红灯；主窗 1400x900 是请求值，屏幕工作区不足时 Electron clamp 收缩（实测 1280x672），断言用区间不用等值。** **铁律：改窗口域（尺寸/防护/注入/导航拦截）只改 shared/desktop-windows.cjs，禁止再改两份 main.js；main.js 体内只留工厂接线（1 处 require + 11 个入参）。** 生效方式：云桌面/离线桌面需重打包；云端网页/两端 APP 不受影响。

* ★ 2026-09-14 **P3-A 桌面操作层三合一收口**（对话框域收口 + 崩溃韧性补强 + 死代码清理，「稳定高效安全」落地下轮）：①**对话框域**：dialog:alert-sync / confirm-sync / prompt 三 handler（双端除 prompt 窗 title 外字节级同体）抽为 `shared/desktop-dialog.cjs`（工厂入参 promptTitle 注入端差异：离线'惠康中医诊所管理系统 V1.0.0'/云端'请输入'），配套 prompt-modal.html + prompt-preload.js 同组同位分发（desktop-dialog.cjs 内 path.join(__dirname,...) 依赖同目录布局，asar 内与开发目录均正确）；prompt-modal.html 双端 `<title>` 统一为"请输入"（小输入窗标题无功能影响），tools/prompt-preload.js 第三份重复删除。②**崩溃韧性**：新增 `shared/desktop-crash-guard.cjs`——此前双端仅有 uncaughtException/unhandledRejection 兜底，render-process-gone（渲染进程崩溃=白屏无恢复）完全缺失；现主窗/登录窗崩溃自动销毁旧壳重建（登录态由渲染层 localStorage/auth-core 自恢复），clean-exit 过滤防正常关窗误报，60s 滑窗 >=3 次熔断（提示后销毁全部窗口依赖 window-all-closed 自然退出，不抢跑 quit 保住日志写入），prompt 小窗等临时窗口崩溃仅审计，child-process-gone（GPU/Utility）Electron 自动重启仅记日志；窗口经访问器注入复用 desktop-windows 的 createMainWindow/createLoginWindow（模块边界不交叉防成环）。③**死代码**：packaging-read-config/write-config/done 三 handler（渲染层与 preload 零引用）+ packagingWindow 声明 + 孤儿文件 shared/packaging-config.html 删除，双端 main.js 各净减 ~155 行。分发：sync-all **Group 17**（dialog 三文件）+ **Group 18**（crash-guard）→ 2 个 electron 目录 + copy-consistency **4 新组**（72 副本总量）+ build.files `electron/**/*` 已覆盖。验收：node --check 全过 / sync-all 全绿 / copy-consistency 72 副本 0 失败 / check-interface 6 OK / 模块冒烟 34/34（stub electron：alert/confirm returnValue 契约、prompt submit/cancel/X 三路径+监听清理防泄漏、crash-guard clean-exit 过滤/非主壳仅审计/主壳重建/熔断/熔断后沉默/子进程审计）/ IPC 一致性双端 OK。**铁律：改对话框或崩溃韧性逻辑只改 shared/desktop-dialog.cjs / desktop-crash-guard.cjs，禁止再改两份 main.js 内嵌副本。** 生效方式：纯主进程改动（不在热更白名单）→ 云桌面/离线桌面需重打包发新整包生效；云端网页/两端 APP/服务端零影响。P3 后续：P3-B 用户域+生命周期杂项域（约 700 行同体重复）、P3-C 登录域 login.js 双端统一（先差异审计）。

* ★ 2026-09-13 **P2-B site-admin 共享函数层生成模式收口**（sync-siteadmin.cjs，P2-B1 基线守护的执行器补全——SA-3 侦察否决手工拆分后选定的「渐进式生成」落地）：P2-B1 已给 site-admin 双轨副本装了「探测器」（diff-cross-version siteadmin 对三层基线），本轮补上「执行器」——**42 同体函数（tierB\_sameBody 快照）从人工双刷升级为标记块自动同步**。方案：`public/index.html` 权威源按函数名字符串感知括号配平提取（async 前缀/嵌套括号/注释/模板串安全）→ **raw 字节级原样传播**到 site-admin 侧 `// >>> SYNCED-FN <name> …勿手改…` / `// <<< SYNCED-FN-END <name>` 标记块内（public 权威源零标记零改动）。**三分层架构**：共享层 42 函数（本工具生成，--check 字节级校验）+ 分叉层 101 函数（diff-cross-version siteadmin 对 Tier A/C 红灯守护，人工移植收敛后入 SYNCED\_FNS 清单转生成）+ 独有层（113/103 各自独立维护）。**与 SA-3 全文件变换表方案的取舍**：全文件生成需为 101 分叉函数建变换表（=强拆风险搬进生成器），标记块模式先收口最大公约数 42 函数零风险落地，分叉函数渐进收敛——每收敛一个就少一个 Tier C 分叉条目。**互锁防误刷**：bootstrap 仅标记「两侧规范化同体」的函数（分叉函数拒绝标记，防把 site-admin 分叉版本静默覆盖成 public 版本）；函数双侧各恰好 1 次（重名/缺失红灯）；权威源删函数红灯（清单移除+决定去留）；孤儿标记红灯。**验收**：diff 全量人工审查（+112/-28 = 84 标记行 + 14 函数纯空白风格差异 `=> {`→`=>{` + closeMediaViewer 2 处注释文本差异——零逻辑改动）✅ / 内联 script 3 块 new Function 语法 0 错 ✅ / 跨版本三对基线绿 ✅ / 界面基线 6 OK ✅ / **双红灯冒烟**：手改标记块→--check 红灯→同步模式自愈复绿 ✅ / public 权威源单边改函数名→sync-siteadmin + diff-cross-version 双门红灯→git checkout 还原全绿 ✅ / **浏览器对照冒烟**（Edge 通道 file:// 加载）：生成版 vs 原始版错误画像逐条一致（ERR\_FILE\_NOT\_favicon + 跨域 Script error + CONFIG 由部署环境注入，均为环境固有非本轮引入）、页面侧 SYNCED-FN 标记数 42 恰好命中 ✅。**接线**：sync-all.ps1 **Group 16**（-VerifyOnly→--check）→ CI ② / pre-push ② 同一调用自动覆盖；pre-push ② 注释更新。**siteadmin 基线对保留决策**：不退役——Tier B 对 42 生成函数此后恒绿（raw 拷贝规范化必然相等），但 Tier A（函数名单差集冻结）+ Tier C（101 分叉函数白名单）仍是分叉层唯一门禁，退役即裸奔。**铁律：改 public/index.html 的共面函数后，除了原有 sync-html/diff-cross-version 流程，还必须跑 `node tools/sync-siteadmin.cjs`（或整个 sync-all.ps1）把 42 共享函数刷进 site-admin 标记块；禁止手改 site-admin 标记块内函数（手改即漂移红灯，且会被同步覆盖）；分叉函数收敛流程 = 人工移植两侧规范化同体 → SYNCED\_FNS 登记 → 跑同步（此后该函数免手工维护）。** 生效方式：纯 JS 空白/注释级改动（零逻辑零行为），site-admin 静态站随下次部署生效，五端零重打包。

* ★ 2026-09-13 **分叉函数渐进收敛第 1 轮**（Tier C 101→82，SYNCED\_FNS 42→64）：对 101 个分叉函数做行级 LCS 分类侦察（onlyA/onlyB 规模 + 平台标记 + SUSPECT 假终点剔除），**高置信收敛 19 个**（public 权威源胜出方向）+ **移植 3 个 tierA onlyA 函数**（getEffectiveJianfa/escapeJs/injectRecycleBinButton，锚点插在首个消费者函数前）。收敛带修复的实锤 bug：deleteFromRecycleBin id 归一化（String 兼容）、showPatientNameDropdown onclick 转义（escapeHtml→escapeJs 上下文错误）、\_\_medicineTableFirewall 3→15 行闪动（B 全站 15 行标准）、switchMobileTab 快捷操作栏永久隐藏、updatePrescriptionPaper 处方签 jianfa 显示；带 feature parity：selectFormula/selectMedicine jianfa 自动带入（B 已加载 prescription-core.js，PrescriptionCore 守卫内建）。**分类否决清单（平台有意分叉，勿强并）**：DataCache 缓存层（restoreFromRecycleBin 的 invalidate 是 B 专有行为）、存储后端（local\_\* vs setUserItem/cloud\_\*）、编号方案（getGlobalMaxSerial vs getDailySequence）、DOM 结构（DOM\_CACHE 多字段 vs getElementById 多输入框）、分页机制（\_\_historyCurrentPage vs historyDisplayCount）、addEmptyRow（B 版自带渲染，7 处调用点依赖它——收敛需连坐 7 个调用者，暂缓）。**执行流程范式**：diff 侦察→依赖核查（A 版引用符号在 B 的存在性）→A 全文人工审查→bottom-up 一次性应用（替换+插入）→raw 自验（22 新增 + 42 原有全一致）→SYNCED\_FNS 登记（64）→bootstrap 打标→diff-cross-version INFO 收敛事件→`--update-baseline --pair siteadmin` 重冻结→浏览器冒烟（错误画像逐条对照 + typeof 22/22 + 纯函数调用）。**坑：Tier C 含扫描器假象**——正则字面量含引号（如 `/[<>"'&]/g`）会让字符串感知配平失步（A 侧 throw、B 侧"配平"到 1558 行外的假终点），escapeHtml（2449/2924 行）与 showSearchDropdown/apply/getDefaultUsers/reset 即此类——侦察时须以行数比>2.5 或>400 行打 SUSPECT 剔除，这类函数永远进不了 SYNCED\_FNS（findSpans 会 throw）。生效方式：site-admin 静态站随下次部署生效，五端零重打包。

* ★ 2026-09-13 **分叉函数渐进收敛第 2 轮 = 正向收敛饱和确认**（Tier C 82→80，SYNCED\_FNS 64→66）：对剩余 82 个 Tier C 做同款 LCS 分类侦察——78 可分析、4 扫描器假象（apply/getDefaultUsers/reset/showSearchDropdown，正则含引号致配平失步，上轮已录）；**零平台标记候选池仅 9 个，其中 7 个不可正向收敛**：4 个「B 胜出」（selectPatientName 模糊匹配+最新记录自动填充电话地址年龄 / createChart retryCount+isMobile 响应式图表 / importMedicines 进价缺失校验+parseMedicineRow / renderUserList allowedMode 云端模式管理 UI——管理台功能更强，正向 B←A 会**降级** site-admin）+ 3 个权限模型分叉（analyzeMonthlyStats 管理台全量视角 vs 医师端 filterPrescriptionsByPermission 权限隔离 / showClinicPrescriptions 收费台角色标题 / filterPrescriptionsByPermission AuthCore vs 本地 isClinicAdmin 签名差异）。**本轮仅收敛 2 个**：renderRememberedUsers（A 版对象/字符串双兼容覆盖 B 版 entry+trim，B 侧 6 调用点格式全覆盖）+ debounce（B 版全局单例 searchDebounceTimer 且零调用者=死代码，A 版标准闭包多实例安全，统一实现零风险）。**结论性判断：正向收敛（B←A）已饱和，Tier C 剩余 80 个 = 真平台分叉，不再值得批量推进。** 后续仅两条路：①日常 bug 修复顺带收敛（若 public 修 bug 改到共面函数，site-admin 同步吸收）；②**反向收敛候选存档**（把 B 胜出的 createChart 响应式图表/selectPatientName 模糊填充/importMedicines 进价校验移植进 public 权威源——属 public 功能增强，动五端需单独立项）。**坑（上轮已踩复发）：浏览器冒烟红灯判定过滤字符串要含中文前缀**——console.error 实际文案是「全局错误： Script error.」「Failed to load resource: net::ERR\_FILE\_NOT\_FOUND」，仅匹配 'Script error' 子串即可，勿匹配完整消息。基线重冻结：Tier B 66 / Tier C 80 / onlyA 110。生效方式：site-admin 静态站随下次部署生效，五端零重打包。

* ★ 2026-09-13 **反向收敛第 3+4 轮（B 胜出能力移植进 public 权威源，Tier C 80→78，SYNCED\_FNS 66→69）**：第 2 轮存档的「反向收敛候选」当日立项执行（第 2 轮存档描述保留于上条）。**第 3 轮**：createChart（retryCount+isMobile 响应式图表+canvas 失败重试）+ selectPatientName（模糊匹配+最新记录排序自动填充电话地址年龄）——B 功能增强版函数体字节级替换进 public（apply-reverse.cjs），desk 同步（apply-desk.cjs），SYNCED\_FNS 66→68。**第 4 轮（importMedicines 进价校验专项）**：parseMedicineRow（进价列 row[2] 严格校验：null/undefined/''/NaN → costPrice 置 null 不自动填 0，return \{medicine, hasMissingPrice\}）B 版原样移植 public 后**两侧规范化同体 → 直接入生成层** SYNCED\_FNS 68→69；连带 A 侧能力增强（仍 Tier C 分叉、不入生成层）：importMedicines 三通道（Excel/CSV/JSON）missingPriceMedicines 收集 + processImportedMedicines 双参（missingPriceMedicines = \[\] 默认值）+ executeImportMethod 统计弹窗升级（「进价缺失：XX 条 + 异常药材名单」附在追加/覆盖/合并三种完成提示后）。**costPrice null 语义下游兼容性核查（反向移植前置必查范式）**：A 侧 6 处消费点全兼容——默认药品迁移处 null 回填 price×0.8 / formatPrice(null)→''（显式三分支判断）/ 编辑 modal \`m.costPrice || 0\` / 导出表 \`|| '0'\` / 成本统计 parseFloat fallback 链→0——null 语义在 A 侧是既有设计而非破坏。**三硬分叉保留（importMedicines 链不入 SYNCED\_FNS 的定性）**：XLSX 加载器（A=loadXlsxLibrary→StockCore 链，B=loadXLSX 内联三合一，**B 侧不加载 StockCore——统一加载器须先给 B 补 StockCore，不划算**）+ 存储后端（A=localStorage local\_medicines，B=saveMedicinesToCloud 云端闭环）+ modal 交互（A=showImportMethodModal 全局 onclick 三函数链，B=showImportModePicker Promise 版——A 链三函数已核查无外部调用点，本轮仍保留 A 版以零界面改动落地）。**执行范式**：共享替换表 apply-import.cjs 对 public+desk 各应用一次（8 条替换双侧全命中 = desk 与 public 旧版 Tier B 字节级同体的直接证据）→ sync-html 云系 2 副本 → sync-index-app 33 变换双写 → sync-siteadmin 打标 69 → diff-cross-version 4 对基线重冻结（desk Tier B 182 / siteadmin 69+78+110/102）→ 浏览器冒烟三页面 38/38。**坑：带默认值参数的函数 .length 不计默认参数**（\`f(a, b=\[\])\` 的 length=1，ES2015 规范）——冒烟断言双参签名勿用 .length，用源码特征 \`String(fn).includes('missingPriceMedicines = []')\`。**剩余反向收敛候选清零：renderUserList 永久否决（权限模型真分叉），importMedicines 链已完成能力移植（仅函数级同体因三硬分叉不可达）。反向收敛方向就此收官，Tier C 剩余 78 个全部为真平台分叉。** 生效方式：云端网页即时生效；云端APP WebView 实载线上 public 即时生效（assets 兜底随下次 APK）；云桌面/离线桌面随下次打包 exe；离线APP 随下次打包 APK；site-admin 仓库层生效（分离部署后 huikang-admin 随下次部署）。


* ★ 2026-09-13 **线上部署拓扑实测与 DEPLOY 文档勘误**（打包验证 site-admin 时顺带核实）：`DEPLOY-站点分离部署说明.md` 所述分离拓扑（huikang-admin←site-admin/、huikang-official←site-official/）与实际不符——经 Cloudflare Pages API（build\_config.destination\_dir）+ 线上逐字节抓取核实：**三个 Pages 项目（tcm-prescription-system / huikang-admin / huikang-official）destination\_dir 全部 = `public/`**，互为完整镜像（huikang-admin 的 /api 同样活跃，401=鉴权正常），全部 Git 集成 push 即部署；`huikangzy.com` 三个自定义域名均无 DNS 解析（域名失效），实际入口只有 \*.pages.dev；全部客户端（桌面 CSP/更新/心跳、APP capacitor）指向 `tcm-prescription-system.pages.dev`。**推论**：① `site-admin/` 与 `site-official/` 目录当前不部署于任何线上端点，是仓库内维护副本（分别由 P2-B 生成模式+基线门禁、SA-2 双副本门禁守护——门禁价值不依赖部署）；② 凡涉及这两目录的改动，「生效方式」只能说「仓库层生效、无线上端点」，不得再说「随下次部署生效」（此前多轮总结有此误判，含 SA-3 的 881KB 瘦身表述）；③ site-admin 收敛零线上风险：收敛方向 B←A，public（=线上实际内容）零改动。DEPLOY 文档已加勘误横幅。**重整为分离部署（改 huikang-admin destination\_dir）留作可选路径**：需 Cloudflare 后台改配置+绑定 KV/D1+域名重整，收益是管理台独立于主站（安全边界），成本是新拓扑验证一轮——未立项前维持三镜像现状。

* ★ 2026-09-13 **重整分离部署执行 + adminconsole 双副本门禁（第 4 对）**（用户拍板后当日执行）：① **Cloudflare PATCH 切换**（`PATCH /accounts/{acct}/pages/projects/{name}` build\_config.destination\_dir，wrangler OAuth token 复用）：huikang-admin `public→site-admin`、huikang-official `public→site-official`、主域 tcm-prescription-system 不动（**全部客户端零改动零风险**）——规则9 拓扑恢复，官网域不再服务完整工作站+admin+API。② **切换前置核查全过**：业务端点 CORS+OPTIONS 预检全齐（users/prescriptions/medicines/formulas 等，仅 backup-kv/restore-kv 无 CORS 但仅同源控制台调用）；site-admin 工作站 API 硬编码主域（CLOUD\_API\_BASE=tcm-prescription-system.pages.dev/api，CSP connect-src 已放行）；hash-manifest/updates 双副本（public↔site-official）字节同步。③ **顺带实锤修复（admin 控制台双轨双向漂移）**：public/admin（线上主域 /admin/）有 09-10 下载漏斗+测试设备清理但**缺 09-11/09-12 license 双源警示+续费同步提示 21 行**（线上功能缺口——管理员审核/续费诊所看不到离线端 license 警示）；site-admin/admin 反向缺漏斗。统一方案=public 基底+移植 21 行 license UI→双副本字节级一致（295334B，语法 0 错），**新增 diff-cross-version 第 4 对 `adminconsole`**（public/admin/index.html ↔ site-admin/admin/index.html，lines 模式，基线=空差集）：红灯冒烟=真实代码行单边改→RED/复原→4 对全绿（**坑：整行 HTML 注释被 lines 规范化剔除——测注释行不会红灯，不是门禁失效**）。④ 前置发现记录：`site-official/_routes.json` 的 `rules` 字段是 \_redirects 风格历史设计，Pages 实际不解析（敏感路径隔离由目录分离本身保证）；`/admin/*` JWT Worker 校验未实施（现状=控制台客户端登录门+API 服务端 Bearer，与主域一致）。**铁律：改管理台控制台（public/admin/index.html）后必须同步 site-admin/admin/index.html（字节级镜像，adminconsole 门禁红灯拦截单边改）**；huikangzy.com 三域名仍失效，入口=*.pages.dev。生效方式：push 触发 Git 集成自动部署（三项目），site-admin 两轮收敛+admin 统一随部署上线；五端客户端零重打包。

* shared 组件新增 IIFE 必须过 `node tools\smoke-runtime.cjs --all`（无 DOM 沙箱全量加载，凡 window.* API 一律 try-catch 包裹——S7 红线：无 DOM 环境加载不得抛错）。

* ★ 2026-09-10 **symptom-dict.js 云端APP副本同步盲区**（医师框 60px 修复两轮未生效实锤）：`cloud_app/app/src/main/assets/public/symptom-dict.js` **不在 sync-all.ps1 清单、不在 build-app.bat 打包前拷贝链**（云端打包只拷 auth-core.js/permission.js/config.json），且该副本被 8-21 遗留混淆版占据（历史 obfuscate 还原漏此文件）。事故链：改 shared 权威源 → sync-all 全绿（该副本不在清单=校验不到）→ 云端APP 打包继续用旧版 → 修复静默丢失。**铁律：改 shared/symptom-dict.js 后必须手工 Copy-Item 到 `cloud_app/app/src/main/assets/public/`，并解包 APK 验证 `doctorName{flex:0 0 90px` 等特征串存在**（离线APP assets 副本在 sync-all 清单内无此问题）。同轮次发现：云端打包脚本末尾 `set /p` 交互提示在无人值守/后台调用时挂起——后台跑 pack-app.bat 必须先 `set NO_PAUSE=1`（离线/云端 build-app.bat 均已支持该开关）。

* ★ 2026-09-09 **user-store.js 双路径同步铁律**（2069f13d→打包被拦实锤）：`shared/user-store.js` 有**两条独立分发路径，漏一条=打包中断**：
  1. **7 份 index.html 内联标记块**（USER-STORE block）→ `node tools/sync-shared-blocks.cjs`
  2. **2 份独立 js 副本**（`db-offline/desktop/electron/user-store.js` + `db-yunduan/cloud_desktop/electron/user-store.js`，login.html 独立加载）→ `node tools/copy-consistency.cjs --fix`
  事故链：phone 修复只跑了路径1 → push 六道门全绿（当时门不含 copy-consistency）→ 云桌面打包时 copy-consistency FAIL+Auto-FIX 覆盖独立副本 → 产生未提交"源码修改"（user-store.js 是真实源码不能进副作用白名单）→ 云端APP 被源码落定门拦截。
  **铁律：改 shared/user-store.js（及 user-admin.js）后必须双跑两条同步 + `copy-consistency.cjs` 纯检查确认 5 组 42 副本全绿再 commit。** 已同步收口：pre-push 升七道门（⑦=copy-consistency）、CI verify-unified 升六重防线（⑥=copy-consistency），独立副本漂移从此 push 时拦截。

* ★ 2026-09-09 **离线APP「打包源覆写回滚」铁律**（金额修复 29f9a06d 被打回旧版实锤）：`db-offline/index-app.html` 是离线APP 的**打包源**，`build-app.bat` 每次 APK 打包执行 `copy /Y index-app.html → assets/public/index.html`——assets 只是构建产物副本。事故链：金额显示修复（formatPrice）只改了 assets 副本、漏了打包源 → push 全绿（无门监控这对文件）→ 当晚打包源覆写副本 → **已提交修复在新 APK 中静默回滚**（¥356.0025 浮点 bug 复活，versionCode 261 报废重打 262）。**铁律：改离线APP 的 index.html 一律改打包源 `db-offline/index-app.html`，再 Copy-Item 到 assets；直接改 assets 必被下次打包覆写。** 已收口：html-sync-check.ps1 新增第③节「离线APP source/assets 字节级一致性」（SHA256 比对，随 pre-push ①运行），改源漏副本/改副本漏源均在 push 时拦截。同类隐患备忘：build-app.bat 还从 desktop\ 复制 config.json/vendor/共享 js 模块到 assets——共享 js 三点（shared→desktop→assets）已被 copy-consistency 链覆盖，vendor 库基本不手改，风险敞口就是 HTML 这对，已堵。**★ 2026-09-13 P1-B 后此铁律升级：index-app.html 本身也升级为生成产物（desktop 权威源 + 变换表 → sync-index-app.cjs），"改打包源"进一步上移为"改 desktop/index.html 权威源"——三级链每一级都有门禁兜底。**

* ★ 2026-09-10 **手机端布局改造 + 云端APP隔离铁律**（桌面/手机布局差异 → 隔离）：操作界面把「剂数+输入框（doseCountInput3）」从诊断行移到价格行（剂数/每剂/药费/诊疗/总计一行）、「医师（doctorName）与诊断同排」——**仅手机端生效**（离线APP：`db-offline/index-app.html` 打包源 + assets；云端APP：`cloud_app/app/src/main/assets/public/index.html`；鸿蒙：`rawfile/index.html`），**桌面端保持原样（剂数仍在诊断行）**。**架构矛盾**：`public/index.html`（权威源）同时驱动云桌面+云APP，桌面/手机布局冲突无法同一源供给 → 把云APP 从 `tools/sync-html.ps1` 与 `tools/html-sync-check.ps1` 的 `$Targets` 移除，**隔离独立维护**（同离线端 index-app.html 模式）；云桌面继续跟随权威源（桌面布局）。改该类布局时：桌面/网页=只改权威源 `public/index.html` 后跑 sync-html.ps1 同步云桌面；手机=按上面三处独立改，勿改权威源（否则污染云桌面/云端网页）。**★ 2026-09-13 P1-A 已解除隔离：public 权威源现含双实例响应式（冲突根源消解），云APP assets 重新纳入 sync-html.ps1 / html-sync-check.ps1 $Targets 自动生成链；云APP WebView 实载线上 public/，本地 assets 仅打包兜底，可随权威源自动传播。鸿蒙 rawfile 仍独立（搁置期）。**

* 改 index.html JS 后必查（2026-09-13 P1/P2-B1/P2-B 后新流程）：①改云系 → `sync-html.ps1` 生成 + `html-sync-check.ps1` 绿；②改离线系 → `node tools/sync-index-app.cjs` 生成 + `--verify-only` 绿；③改共面函数（public↔site-admin 的 66 共享函数，收敛饱和后仅日常修复增补）→ `node tools/sync-siteadmin.cjs` 刷标记块 + `--check` 绿；④跨版本改动 → `node tools/diff-cross-version.cjs` 三对基线绿（desk + siteadmin + download，单边漏改红灯）；⑤push 前十道门自动兜底（②含 Group 11+13+16 生成校验、⑩含跨版本三对）。

* ★ 2026-09-02 **index.html 云端副本从手工复制升级为权威源生成模式**（`tools/sync-html.ps1`，观察期毕业）：改 `public/index.html`（权威源）→ 跑 `sync-html.ps1`（已并入 sync-all.ps1 Group 11）→ 副本自动重生成（端配置块 EDITION/PRODUCT\_NAME/APP\_MODE+身份注释原样保留，其余全部自动传播）。**禁止直接改云桌面/云APP副本**。历史事故链：手工复制时代权威源修复漏同步副本→CI 红灯；权威源累积 3 份重复 hideUserTypeSelect IIFE；注释位置漂移——且 html-sync-check 的 ±30 行窗口重对齐把前两类真实漂移掩盖成"IN SYNC"。安全设计：生成器对 EDITION/APP\_MODE 赋值行多于 1 次的结构异常直接报错拒写（宁可失败不可错写）。

* ★ 2026-09-02 **git pre-push 本地拦截门**（`.githooks/pre-push`，`git config core.hooksPath .githooks` 已启用，入库共享；2026-09-07 六道 → 09-09 七道 → 09-10 八道 → 09-11 九道 → 2026-09-13 P2-B1 **十道**）：push 前自动跑 ①html-sync-check ②sync-all -VerifyOnly ③注入幂等 ④check-interface ⑤auth-core 11 副本 ⑥激活/登录参数探针 ⑦copy-consistency ⑧manifest 版本 SSOT ⑨桌面 build.files 清单 ⑩跨版本双对基线（desk + siteadmin）十道秒级校验，漂移推不到 GitHub（CI 红灯从"事后发现"变"事前拦截"）。紧急绕过 `git push --no-verify`（事后必须补跑）。克隆/换机后需重跑一次 `git config core.hooksPath .githooks` 激活。

* ★ 2026-09-02 **CI 红灯第二根因（pwsh/powershell 跨平台坑）**：`test-source-settled.ps1` 子进程硬编码 `powershell`——GitHub ubuntu runner 只有 `pwsh`，第 5 道门必炸。修复：子进程 shell 跟随宿主 `$PSVersionTable.PSEdition -eq 'Core' ? 'pwsh' : 'powershell'`。**铁律：CI 会跑的 ps1 里调用子进程 shell 一律按此判定，禁止硬编码 powershell**（Windows 专用打包链路 one-click-pack/release-menu 等不受影响）。教训：本地门禁全绿 ≠ CI 绿——本地 Windows 永远有 powershell，此类问题只在 ubuntu 暴露；红灯时先看 `gh run view --log-failed` 远端日志而非只跑本地。

- CI 三重校验闭环（2026-08-31 升级四重：`.github/workflows/verify-unified.yml`：check-interface → sync-all -VerifyOnly → html-sync-check → check-injection-idempotency 注入幂等性门），推送红灯即漏同步/漏防呆。红灯修复：界面改动→重建基线一并提交；shared 改动→本地 sync-all 后提交；HTML 副本→以权威源回改；注入幂等→改整段重写/补守卫，确属守卫兜底审查后 `--update-baseline` 收录。

- ★ 2026-08-30 发布链路收口 `tools/artifact-locate.js`（单一权威模块）：产物路径配置/APK 定位（项目根产物优先→gradle 输出回退→public/downloads 旧包）/fromBuild 标记/同步 downloads（带 sha 校验）只有这一份；auto-publish.js、publish-release.js、auto-update-downloads.js 三工具全部 require 引用，**禁止再自维护产物路径配置**（历史三工具三份路径各自演化=发布事故架构根因）。自检命令 `node tools/artifact-locate.js --check`（源不一致/半成品嫌疑 WARN+exit 1）。

- ★ 2026-08-31 发布产物命名规范（用户明确要求）：本地版 GitHub Release 上传名统一英文 **huikang-local\[-setup]-x.x.x.exe / huikang-local.apk**（与云端 huikang-cloud 对仗），**禁止拼音 dingzhi 对外展示**。实现：publish-release.js prepareUploadFile 内 UPLOAD\_NAME\_KEY={dingzhi:'local'} 映射——内部 APP\_CONFIG key 'dingzhi' 不动（manifest dingzhi→local 双 key 镜像依赖），只映射上传文件名。GitHub 资产改名用 `gh api -X PATCH repos/{o}/{r}/releases/assets/{id} -f name=新名`（v2026.08.31 已改 3 个：setup/便携/apk；旧 1.0.158 两个保留原名防断链）；hash-manifest.json + updates/local/latest.json 的 URL 同步替换；桌面 electron-updater 读 latest.json url 自动跟随。官网 download.html（两份镜像）同轮新增：①safeDownload 下载确认机制——下载前 confirm 弹窗显示程序友好名（downloadFileDisplayName 把 huikang-local-setup-1.0.159.exe → 惠康中医-本地 安装版 1.0.159，兼容旧 dingzhi 名），确认后才开始下载+toast 显示"正在下载：程序名"；②APP 安装风险提示块——向客户说明无风险+提示原因（非商店渠道分发的 APP 系统一律提示，不代表检测到病毒）+处理方式（仍然安装）；③桌面步骤补"浏览器下载完成弹保留/放弃时选保留"。

* 批量 replace\_all 后必须 Grep 验证字面量归零（并行 Edit 会静默失败）。

* 全局变量一律 `window.xxx` 访问；跨脚本/跨 IIFE 调用一律 `typeof fn === 'function' && fn(...)` 防御式写法。

* **云端 APP 是 WebView 壳，内容取自线上 public/**：改云端 APP 界面必须在 `public/` 改并推 GitHub，改 APK 内 assets/public 无效。

* ★ 2026-09-14 **编辑用户被存量值拦死（表单编辑校验只约束"本次修改"铁律）**：离线APP 291 实锤——管理员只想改用户名（jlh→jihuo），医师姓名字段未动（存量"激活1"），保存被 08-31 加的「医师姓名必须纯中文≥2汉字」无条件校验拦死（存量值含数字过不了正则）。修复：`confirmEditUser` 校验改为 **`newName !== 原值` 才做格式校验**（`const origUser = getUsers().find(...)` 前置读原值，getUsers 纯读无副作用）——未变更字段零阻塞、一旦修改新值必须合规。改动 3 权威源（public + db-offline/desktop + 鸿蒙 rawfile）经 sync-all 全链传播 7 份 index.html，冒烟 8/8（存量不合规未动放行/合规未动放行/改合规放行/改英文/单字/含数字拦截/用户不存在兜底）。**铁律：表单编辑保存的格式校验必须区分「存量未变更」与「本次新输入」——编辑≠新增，存量值不追溯；无条件校验旧数据会把用户永久锁死在"什么都改不了"状态。同类排查点：今后给编辑类表单加任何格式校验，先问一句"存量数据若不合规，用户还能改别的字段吗"。** 生效：云端网页/云端APP（WebView 实载线上）push 即生效；离线APP 走 app-local 热包（291 已装机无需重打）；离线桌面走 desktop/local 热包或下次打包；云桌面/鸿蒙随下次打包。

## 3. 界面保护铁律

* 优化前必须运行 `check-interface.bat` 建立基线，优化后再运行验证；WARN 立即 git checkout 恢复或经用户确认后重建基线。

* 三端界面已适配，**禁止改动** index.html 的 body 内 DOM 结构、`<style>` 部分、mobileNav/mobileActionBar 按钮配置、login.html/login.js 的 UI 部分。只允许修改 main.js/MainActivity.java/auth-core.js/cloud-api.js/build.gradle/proguard/build.bat 等逻辑文件。必须改界面文件时先告知用户并获得明确同意。

* 基线只校验 body 到首个 script 的 DOM 结构——CSS/JS 修改不触发基线 WARN，但不代表可以改样式。

* 登录框已全端统一紫（#667eea/#764ba2/rgba(102,126,234)），**禁止再引入按版本变色机制**（JS 切 root class 保留但无视觉变化，首帧恒紫）。

* login 文件架构定性（勿盲统一）：login.js 功能双源（云桌面=云端账户登录/离线桌面=本地验证，377 行差异）按端维护；login.html 桌面双版仅 3 处合法差异（CSP 指令集/version-tag/离线特有 loginDoctorName 行）；public/electron/login.html 与桌面版平行演化，统一属界面改版需用户确认。

* 登录框下拉框和预填功能必须过滤真实医师姓名和手机号，仅显示通用用户名，读取时自动清理历史遗留实名数据。

* 手机端「清空」改「统计」入口（\_\_replaceTopClearWithStats，<=768px 运行时 JS 注入）HTML DOM 零改动——同类需求沿用此模式。

- ★ 2026-08-31 上架前多机型显示审计方法论（Playwright 实测）：内置 browser 子代理视口不可调（resizeTo 被禁），用 `app_project/db-offline/desktop/node_modules/playwright-core` + `chromium.launch({channel:'msedge'})`（本机无 Chrome/ms-playwright 浏览器，Edge 必备）写临时脚本跑 4 档主流 CSS 宽度（360×640 红米/375×667 iPhone SE/393×873 华为小米/412×915 三星，isMobile+hasTouch+DPR3），页面内 evaluate 断言 scrollWidth>clientWidth（横向溢出）、getBoundingClientRect 越界元素、表格 scrollWidth>父容器（横滚）。实锤并修复：**360px 档处方表格 8 列 min-width 合计 365px+边框=366px 超容器 6px 触发横滚**——768 断点列宽（28/50/80/45/35/45/50/32）按 375px+ 设计，360 档需在既有 `max-width:360px` 断点内追加紧凑列宽（26/44/70/40/32/42/46/30 合计 330px，药物列弹性吸收剩余）。铁律：**表格列 min-width 合计必须 ≤ 最小目标机 CSS 宽度减边框余量；新增列/改列宽时按"最小支持机型 360px"心算合计再收口**。改动属 <style> 范畴（不触发 interface 基线），已 7 份 index.html 全同步。复测四档全绿（无横滚/无越界元素/表格零溢出）。审计脚本模式存 tools/\_tmp/（不入库），复用时照 viewport-audit.cjs 重建。

* onclick 属性选择器是全局耦合：新增同 onclick 按钮会被旧的隐藏/查询规则误伤；APP 隐藏规则已限定 settingsModal 容器内。

* ★ 2026-08-31 云端系 CSP 漏 pages.dev（用户实报"wgj 管理员下 wyx/zsy 普通用户不显示"根因，curl 实测 CORS 允许 \* 后仍失败锁定 CSP）：**云端系 3 份 index.html（public/云桌面/云APP assets）的** **`connect-src 'self'`** **全漏 pages.dev，离线系 4 份全有**——历史 CSP 修复只覆盖了离线系。云桌面 file:// 加载 + 渲染进程 cloudFetch 直连 pages.dev + CSP 'self' 三条件齐备=拦截（第 8 章高频坑在云端系复发）；login.html 的 CSP 一直有 pages.dev → "登录正常但主界面云端功能静默回退本地"隐蔽分裂（fetchCloudClinicUsers 失败回退本地表只显示 wgj 自己）。修复=云端系 3 份 CSP 追加 `https://tcm-prescription-system.pages.dev https://*.pages.dev`（head 安全策略，不触界面基线）。**CSP 三条件判定法（第 8 章）以后每次检查全部 7 份，不能只查单系**。

* ★ 2026-08-31 取消「正式/测试用户」区分（用户上架前明确要求，全 7 份 index.html）：显示层四处——列表徽章 \[正式]/\[测试] 删除、编辑弹窗「用户类型」下拉删除（JS 动态生成直接删）、confirmEditUser/handleAddUser 的 userType 硬编码 'production'（数据层字段保留，历史 test 值编辑保存时自动归一）；newUserType 下拉为**静态 HTML（基线保护）→ 运行时 JS 注入隐藏**（hideUserTypeSelect IIFE，沿用 \_\_replaceTopClearWithStats 零 DOM 改动模式）。批量同步用字面量替换脚本（每处 count===1 验证）+ 内联 script new Function 语法快检（注意：打印模板字符串含假 `<\/script>` 会截断正则提取，7 份恒 fail 1 处 'Unexpected identifier video' 属提取器误报——比对 HEAD 同样 fail 即可证明非新引入）。

* ★ 2026-08-31 用户打包与 AI 修改并行时序坑（1.2.194 实测）：用户 15:45 自打云桌面 exe，而第三轮修复 16:03 才 commit——asar 解包 grep 实锤只含第二轮修复（幽灵过滤+保底），不含 CSP/userType 取消。**判断用户 exe 是否含修复，唯一可靠方法是解包 asar 搜标记（dist/win-unpacked/resources/app.asar 是明文拼接可直接 indexOf），build 时间线/git commit 时间推断都不可靠**；且 asar 里搜 CSP 标记会误中 electron/login.html（其 CSP 恒含 pages.dev 具体域名），必须用 `https://*.pages.dev`（仅 index.html 修复版有）或功能级标记（hideUserTypeSelect）区分。另：会话恢复静默回滚本日再中一次（KNOWLEDGE.md 第三轮条目工作区丢失 → git checkout HEAD -- 恢复）。

* `window.APP_VERSION='V1.0.0'` 是单一数据源（getEditionTag() 旁，6 份 index.html 各有），JS 硬编码版本号全部引用该常量，升版本每端只改 1 行。

- 修改版本相关文本必须同步检查 **8 处版本标识**：①登录页 version-tag ②顶部 tab-hint ③JS IIFE textContent ④console.log ⑤showHelp alert ⑥exportInfo.version ⑦electron/login.html version-tag ⑧index.html `<title>`。版本号(V1.0.0)和版本类型文本(离线/云端+标准版/机构版)是两回事，分别核对。每次 Edit 后 Grep 验证生效。

- ★ 2026-08-30 APP 首开/二开版本号不一致（Build 号竞态）：MainActivity 注入 Build 号的 js2 带提前 return 守卫（`__appBuildSuffix__`）——首次 0ms 注入时守卫已置位但 DOM 未就绪，600/1500ms 重试全被守卫短路 → 首开无 Build 号；且页面侧 applyEditionTags 重写 .version-tag/document.title 会抹掉事后注入的 Build。修复三层：①js2 去守卫（各挂载点 indexOf 检查天然幂等）；②js2 注入 `window.__APP_BUILD__` 并主动调 applyEditionTags()；③applyEditionTags 拼接 __APP\_BUILD__（index-app.html+assets 副本）。铁律：**带重试的注入脚本禁用一次性守卫短路重试；页面动态重写的元素，注入数据要走页面自己的渲染函数（注入变量+触发重渲染），别用事后 DOM 正则**。

* 离线APP改版本必须同步改 index-app.html 打包源；MainActivity Build 号注入匹配运行时 DOM 文本（V\[0-9.]+ 正则），与源码运行时拼接兼容。

- ★ 2026-08-31 登录页 footer 重复拼接 Build 号（用户实报"V1.0.0 Build 203 Build 203 Build 203..."）：双 APP MainActivity js2 里 `.login-footer` 的正则 `replace(/(\|\s*版本:\s*V[0-9.]+)/,'$1 Build N')` **无幂等守卫**——捕获组 `V[0-9.]+` 不含已拼上的 Build，js2 每次执行（onPageFinished 每触发一次就注入 0/600/1500ms ×3，页面重载再 ×3）就再拼一个，累积 3\~5 个；而 `<title>`/`.version-tag` 分支本就有 `indexOf('Build')===-1` 守卫所以不重复。修复=footer 分支补同款守卫（离线 com.benneng.pres + 云端 com.tcm.prescription 两份 MainActivity）。铁律：**"往 DOM 文本追加后缀"的注入语句，每一条都必须自带"已含目标后缀则跳过"的幂等守卫（或每次从常量整段重写）——重试型注入脚本里逐条核对，别信注释里"天然幂等"的笼统结论**。

- ★ 2026-08-31 举一反三源头治理（版本显示单一写者架构 + CI 幂等性门）：①**单一写者收口**——applyEditionTags 新增挂载点3接管 `.login-footer`（整段重写 `'微信号: hktzy1688 | 版本: ' + APP_VERSION + (__APP_BUILD__ ? ...)`，天然幂等；7 份 index.html 全同步：public 权威源/云桌面/云APP assets/index-app.html 打包源/离线APP assets/离线桌面/根 index.html），云端三份 title 补 `__APP_BUILD__` 拼接；Java js2 的正则追加降级为**带守卫的过渡兜底**（页面已渲染含 Build 时自动 no-op，新旧 APK/页面组合均安全：新 APK+旧页面=兜底补一次；新 APK+新页面=页面渲染兜底跳过；仅旧 APK 重复拼接=换 APK 即愈）。②**CI 防呆**——`tools/check-injection-idempotency.cjs`（+基线 `tools/.injection-baseline.json` 8 条守卫兜底收录）扫 app\_project Java 注入串+注入型 JS 资产的三类高危模式（`textContent +=`/`innerHTML +=`/`'$1" + 动态后缀`正则追加），新增未收录即 exit 1，基线条目消失也 fail 强制清理；已入 verify-unified.yml 第 4 道门（三重→四重防线）。③**DOM 文本注入三原则（新铁律）**：注入只写数据（变量）+触发页面渲染函数，DOM 文本派生只在页面渲染函数整段重写；兜底注入必须逐条带"已含后缀则跳过"守卫；新增注入语句过不了 CI 门（要么幂等要么审查后进基线）。

* 打包产品命名：惠康中医+版本（如惠康中医本地）；安装后登录界面显示「惠康中医诊所管理系统」。

* 打印/照片/视频文件命名包含门诊号（处方编号\_患者姓名），排列顺序为处方签图片、面诊照片、诊疗视频。

## 5. 打包规范

* APK 输出路径统一到项目根目录（离线APP→db-offline 根，云端APP→db-yunduan 根）；一键打包默认严格模式（Java 混淆+签名哈希硬校验），无需回车确认。

* 桌面版打包前必须检查所有桌面版 package.json 的 build.files 是否包含新增脚本文件（cloud\_desktop/cloud\_desktop\_geren/db-offline desktop/db-offline/desktop\_geren），漏了=exe 缺脚本函数未定义。

* ★ 2026-09-03 打包中途红/黄字判读口诀（小白高频误报，看结尾不看中途）：一键打包**只要结尾出现绿色「[打包成功]」横幅=产物合格**，中途红/黄字多为无害过程输出——gradle WARNING（flatDir/overridePathCheck，历史恒在）、login.html 未检出版本 token（标注不阻断）、\[SIGN\]\[OK\] status=UnknownError（自签名未信任根=预期）、.gradle configuration-cache 残留 WARN。**真正要处理的红字只有 5 种**：结尾红色「打包失败」横幅、\[FATAL\] 验收门未通过、\[ERROR\] 源码未落定、\[ERROR\] 检测到另一个构建正在运行、\[SIGN\]\[ERROR\]。事后取证看 `.build-cache\logs\pack-*.log`（transcript 全程转录，控制台关闭不丢失）。2026-09-05 已根治其中的 keystore header abnormal 误报：build-app.bat 自检改为按 magic 字节判定格式（JKS=FE-ED-FE-ED、PKCS12 首字节 0x30）——旧 ASCII 正则 "." 不匹配 PKCS12 头部第 3 字节 0x0A（换行符）而误报。

* ★ 2026-09-08 红字源头根治（口诀的工程化落地）：中途红字的机制是 **PS 5.1 host 把"未捕获的原生命令/子 PowerShell/node 的 stderr"一律渲染红色**——链路中凡 `& powershell -File xxx` 裸调用/只管道 stdout、Start-Process 直跑 node（publish-release/verify-release 的 console.error、git/curl 输出），子进程 stderr 全部红显。收口为单一权威源 **`tools/noise-reduce.ps1`**：①Write-HostLine（管道逐行，ErrorRecord→黄）；②Invoke-QuietProcess（经 cmd 外壳 `... 2>&1` 合并 stderr 后渲染=白/黄，返回真实退出码；**默认直连模式**=Start-Process 保留子进程彩色输出+实时性+返回值干净，**-Capture 模式**=输出流经本进程可被 Start-Transcript 捕获落盘——one-click-pack 内（有 pack-\*.log 取证铁律）的验收门/CRLF 自愈/edit-config 必须 -Capture，release-menu（无 transcript）用直连保彩色）。已修 one-click-pack.ps1 / release-menu.ps1 / entry-selfheal.ps1 约 20 处透传点 + 两个入口 bat 真错误行补红。铁律：①**Start-Process 直连子进程的输出不进 transcript**——凡在带 Start-Transcript 的脚本内调子命令必须 -Capture，否则违反"任何失败可事后取证"；②**Start-Process 不更新 $LASTEXITCODE**，退出码必须取函数返回值（改一处漏一处=失败被误判成功）；③新调用点禁止再内联 if ErrorRecord 渲染，一律 dot-source noise-reduce.ps1；④真失败（[ERROR]/[FATAL]/失败横幅）永远显式 ForegroundColor Red——降噪只针对过程噪声，绝不吞退出码。**★ 2026-09-12 终极补丁（PS 层 2>&1 红染漏网实测）**：①上面的 Write-HostLine（ErrorRecord→黄）**拦不住真控制台红染**——PS 层「& xxx 2>&1 | ForEach-Object …」管道产生的 ErrorRecord 在双击 .bat 弹出的 PS 5.1 host 窗口仍被 host 直接渲染红色（09-12 用户把 gradle WARNING/混淆进度「Dir: public」误读为打包失败），Write-HostLine 只是下游消费方、染色发生在 host 层、消费拦不住；②**根治唯一解＝stderr 在 cmd 层合并**：把 2>&1 写进 cmd /c 命令串（& $env:ComSpec /c "xxx … 2>&1" | ForEach-Object { Write-HostLine $_ }），PS 永远只见到纯文本行（白字）；③已收口 8 处透传点：one-click-pack ×3（Test-BuildSkip/Record-BuiltUnits/Invoke-BatFile）+ release-menu ×3 + entry-selfheal ×1 + noise-reduce Invoke-QuietProcess 渲染模式 ×1，排查手法=Select-String「ForEach-Object { Write-HostLine」全量核对每处调用形态；④**禁止新增「& xxx 2>&1 | ForEach-Object { Write-HostLine … }」形态的 PS 层管道**——新调用点一律 cmd 层合并形态。

* ★ 2026-08-31 源码落定门（1.2.194 事故根因防呆，架构级补缺）：用户在 AI 修改源码进行中双击打包 → exe 静默装走"当时磁盘状态"（实测缺当日修复）；而现有全部铁闸只验「产物内部一致」（版本/标记/签名/asar/fuse/E2E），无一验「打包起点是否落定」——装走旧代码时门禁全绿。**布防已收敛为两层单一权威源**：`tools/source-settled.ps1`（Get-SourceSettledBlockers + **-Assert Node 出口**（发布链路 commit 前置，exit 1=未落定），三处 dot-source：①ensure-build-env Step 1.5（4 端 build 唯一咽喉）②release-menu Invoke-SinglePack 前置③one-click-pack AutoMode 前置）+ `tools/pack-side-effects.ps1`（**打包副作用清单权威源**，与 one-click-pack SideEffectCollect autoPatterns 共用一份：package.json/build-meta.json/hash-manifest.json 整文件放行 + build.gradle 纯 versionCode/versionName 行变化行级精判——整文件放行会开洞，签名混淆配置是真实源码）。保险丝 ALLOW\_DIRTY\_BUILD=1。**永久单测** **`tools/test-source-settled.ps1`** **入 CI 第五重防线**（verify-unified.yml：界面基线/shared 同步/HTML 副本/注入幂等/落定门单测）——纯函数断言（A 系）+ 差值集成断言（B 系，不依赖基线干净，CI 友好）+ Node 出口断言（C 系）。铁律：①**用户在 AI 修改过程中打包是真实高频场景，打包链路必须显式防御"源码未落定"，不能指望用户自觉**；②**门禁/清单逻辑禁止内联复制多份**——首版 3 副本次日 build.gradle versionCode 误拦，又发现 hash-manifest.json 漏列=下一次打包必再误拦（两份副作用清单各自演化的实证），全部收敛单源（同 artifact-locate.js 教训）；③**凡"打包自身改动"新增文件类型必须登记 pack-side-effects.ps1**，否则误拦用户或副作用散落；④**防呆机制本身必须有永久单测**（临时脚本用完即删=回归无守护，误报当天才补测）；⑤判断产物是否含某修复仍以 asar 搜功能级标记为准（见上条）。

* ★ 2026-08-31（晚）"工作区脏检测"全链收敛+发布 commit 半成品混入收口（build\_output 残留事故举一反三）：用户一键发布成功但末段 WARN"拒绝记录基线"——根因是 8/29 打包中断残留的 `build_output_日期_时间/` 目录未被 .gitignore 覆盖（只忽略固定名 `build_output/`），被 build-skip 基线检查当"未提交源码"。**系统性排查发现全仓共 5 处独立的 git status 脏检测**，收口为：①`.gitignore` 补 `build_output_*/`（时间戳变体）；②build-skip.ps1 加**产物形态黑名单** `$productShapePatterns`（build\_output\*/\_backup\_asar/win-unpacked/dist\* 的顶层目录正则——.gitignore 漏登记新变体时的双保险，`??` 且顶层命中即不算源码脏）；③publish-release.js / auto-update-downloads.js 的 git 段加**源码落定前置**（调 source-settled.ps1 -Assert）——此前 `git add 指定路径` 后用全局 status 判非空就 commit：`??` 使 status 恒非空 → staged 半成品会被 `git commit -m` 一并提交推送（1.2.194 在发布链路的镜像变体）；④单测扩到 22 项（A10-A13 产物形态/A14-A16 官网产物放行/B6-B7 Assert 出口）。铁律：**①凡"构建产物目录"命名出现新变体（时间戳/old/new/v 后缀），必须同时登记 .gitignore 与 build-skip productShapePatterns 两处（后者是漏网兜底）；②发布链路 commit 前必须跑与打包同源的落定检查，禁止"add 指定路径+全局 status 判空"模式（?? 恒非空，必混入）；③存量残留产物目录直接删除（win-unpacked 纯产物无源码），不 git add 入库**。

* ★ 2026-08-31（夜）首次真实发布实战：落定门又拦下发布工具自身产物（第 3 个白名单盲区，与 versionCode 同构）——publish-release.js `--confirm --push` 全流程（合规 8 项检查过 → Release v2026.08.31 创建+6 产物上传 → public/downloads 同步复制+latest.json 更新）最后 git 段被自家落定门拦：发布工具**刚写入**的官网产物（public/downloads/\*.apk、public/updates/\*/latest.json）被当"未提交源码修改"。修复：pack-side-effects.ps1 新增 `$PackSideEffectDirPrefixes` 路径前缀整目录放行（public/downloads/、public/updates/——该目录按设计入库供 Cloudflare 部署，人工不在其中改源码），单测 A14-A16 回归。铁律：**①副作用白名单的枚举维度有三层——basename（版本文件）+ 路径前缀（发布产物目录）+ 行级 diff（build.gradle 混合源码），新工具链落成后必须先走一次真实全流程才能暴露盲区（三个盲区全是实战炸出来的，纸面审计想不到）；②落定门防的是"AI/人改源码未提交"，凡是"工具自身在流程中写入的文件"都属副作用——给新流程接门禁时必须同步盘点该流程会写哪些路径**。

* ★ 2026-09-09 **落定门第 4 类拦截源——"打包流程内嵌的同步器 Auto-FIX 源码副本"**（phone 修复 2069f13d 实战）：多目标顺序打包（云桌面→云端APP→…）中，前目标 preflight 的 copy-consistency 发现独立副本漂移 → **Auto-FIX 用权威源覆盖**（工作区产生真实源码修改）→ 后目标被源码落定门拦截（报"2 个未提交的源码修改"）。user-store.js 是真实源码**不能进副作用白名单**（开洞），正确防法=**漂移在 push 时就被七道门⑦拦住**（根因前移），打包时 copy-consistency 自然全绿、Auto-FIX 零触发。铁律：①**AI 改 shared/ 权威源后必须完成全部分发路径同步再 push**（user-store 双路径见 §2）；②**AI/后台环境跑 one-click-pack.ps1 必须带 `-AutoMode 1|2|3`**——不带参数会弹交互菜单，无 stdin 环境直接 FATAL"标准输入已关闭"（本次事故叠加项）；③顺序打包中途某目标失败时，前目标已 AutoCommit 的副作用是干净的，先 `git status` 分辨"白名单副作用（收纳）vs 真实源码修改（人工审）"再续跑。

* 桌面版问题排查先运行 build.bat 确认打包成功（pre-build-check.js 能发现 build.files 缺失），再查代码逻辑，勿盲目改 index.html/main.js 注入。

* 打包增量跳过（build-skip 指纹）可能误判「已是最新」→ 打包后必须解包 grep 验证关键修复标记；可疑时 `NO_BUILD_SKIP=1` 强制重打。

* 云端APP tools/obfuscate.js 会混淆 assets JS——解包 APK 后 grep 找不到 ≠ 没打进（index.html 未混淆可 grep 验证，其他 JS 需按混淆与否区分）。

* 安全优化后必须验证 4 端 APP 打包流程：预编译→非严格打包→严格模式打包→APK 签名哈希。

* 离线桌面打包固定两段式：`--dir`(rcedit 完成) → `pe-zone-sign embed+verify` 阻塞门禁 → `--prepackaged` 出 nsis/portable（electron-builder 顺序 afterPack→rcedit，afterPack 内嵌入的哈希必被 rcedit 作废）。

* ★ 2026-08-30 上架加固 P1-3 Electron Fuses（二进制级关调试注入后门）：`tools/flip-electron-fuses.cjs` flip/check 双模式统一写入复核（RunAsNode/EnableNodeCliInspectArguments/EnableNodeOptionsEnvironmentVariable=off + OnlyLoadAppFromAsar=on；@electron/fuses 纯 ESM 无 main 必须 require dist/index.js，两个桌面版 node\_modules 已装 devDep）。**顺序铁律：E2E(未fuse) → fuse → .bnzc 重嵌(覆盖fuse后字节) → 签名 → NSIS**——fuse 关 --inspect 会灭 Playwright inspector 连接（E2E 永久超时实锤），离线版 E2E 前移至 \[7.8/9]（Phase 1 --dir 后）、云端版前移至 \[8.01/9]（prepare-win-unpacked 后），管线末尾原 E2E 位改为 fuse check + `tools/smoke-launch.cjs` 冒烟启动（无调试参数真实启动，兼守「PE 区段嵌入必须实际启动」铁律）。坑：spawn 相对路径 + cwd=exe 目录时 Windows 按子进程新 cwd 解析必 ENOENT，被启动 exe 必须 path.resolve 转绝对路径。

* ★ 2026-08-30 上架加固 P1-2 ASAR 完整性校验 + P1-1 签名时间戳（双端实打包验证通过）：`tools/embed-asar-integrity.cjs`（+ asar-integrity-resource.ps1）把 app.asar 头 JSON 的 SHA256 嵌入主 exe PE 资源（type=Integrity/name=ElectronAsar），配合 fuse EnableEmbeddedAsarIntegrityValidation → 运行时 asar 头被篡改即 FATAL 拒启（实测篡改 1 字节 131ms 崩溃）。哈希=双 pickle 布局（size 在文件偏移 4；\[8..8+size) 内 payloadSize/strLen/JSON 串，只哈希 JSON 字节不含 padding）；file 键=asar 相对 exe 目录反斜杠小写。**顺序铁律（更新）：embed-asar-integrity（flip 之前，离线 \[7.85/9]/云端 \[8.015/9]）→ fuse → .bnzc → 签名 → NSIS**；fuse 开而资源缺=启动即崩。★悬空证书表坑：对已签名 exe UpdateResource 会重建资源节致旧证书表悬空 → 后续 Set-AuthenticodeSignature 报 "not a valid Win32 application"（exe 能跑但永远不可再签）→ 嵌入前必须清零证书表目录项（工具已内置；.bnzc 哈希排除证书表不受影响）。P1-1：sign-exe.ps1 新增 -TimestampServer（env 兜底 SIGN\_TIMESTAMP\_SERVER）——正式 CA 证书打时间戳（证书过期后签名仍有效），自签名默认不打；PS 5.1 时间戳失败不抛异常而是返回 SignerCertificate=null → 必须显式检测降级为无时间戳重签（WARN 不阻断）。验证基线：离线 1.0.154 / 云端 1.2.187 最终 exe 三链全过（fuse 5/5 + 资源与 asar 实况字节一致 + 签名存在（UnknownError=自签未信任根，预期）+ smoke-launch 真实启动；云端冒烟显示"软件激活"属预期——隔离 userData 无许可）。

* ★ 2026-08-30 上架加固 P2-1 ASAR 全文件哈希校验（堵 fuse 只验头的等长内容篡改洞，双端实测通过）：P1-2 的 EnableEmbeddedAsarIntegrityValidation 只校验 asar 头 JSON——攻击者改内容区字节不动头即绕过。修复：`.bnzc` 区段升级 **ver=2 双哈希**（payload 192 字节：exe 哈希 offset 8 + asar 全文件 SHA256 offset 72；ver=1 128 字节旧格式只读兼容，asar 字段空=64 个 '0'）。链路：①`shared/pe-guard.cjs` 权威源（三副本 git diff --no-index 验证一致）buildZonePayload 双哈希/verifyZone 双比对；②`tools/pe-zone-sign.cjs` embed/verify 第二参数传 asar 路径；③双端 `electron/self-check.js` runAsarIntegrityCheck 用 original-fs 流式重算 app.asar 全文件哈希（避开 Electron asar 路径拦截），失配 dialog.showErrorBox + app.exit(1)（弹窗模态阻塞=篡改程序永远进不了登录窗，实测 40s 强杀观察法验证）；④双端 build.bat 终版 embed 传 asar 路径 + verify 复验 + pack-gate 尾部 verify 三道门。**时序铁律：终版 embed（含 asar 哈希）之后不得再改 app.asar**（签名只动证书表不影响，.bnzc 哈希排除证书表）。验证基线：离线 1.0.155 / 云端 1.2.188 实打包 + smoke + 篡改负例（内容区 60% 偏移翻 1 字节 → 自检日志"ASAR 内容校验失配"+弹窗阻断退出，恢复后哈希一致）+ pack-gate full 全过。铁律：**Electron 官方 fuse asar 校验只保头不保内容，内容级防篡改必须自建全文件哈希链（嵌入→运行时重算→失配阻断）**。

* ★ 2026-08-30 上架加固 P3-1 will-navigate 主框架导航防护（最终轮，双端实打包+smoke 验证通过）：此前只拦了 window\.open（setWindowOpenHandler），但渲染进程被诱导整页跳转（location.href 改写/链接点击）时 will-navigate 不拦 → 远程页面继承 preload API 面。修复：双端 main.js（mainWindow+loginWindow）+ activate.js（activateWindow）共 6 处补 `webContents.on('will-navigate')`——非 `file://` 一律 event.preventDefault()+console.warn（应用内页面切换全走 file:// 不受影响，外部跳转本就走 shell.openExternal）。铁律：**Electron 导航防护必须 window\.open（setWindowOpenHandler）与主框架（will-navigate）两路都拦，只拦一路等于漏半边**。P3-1 同轮审计结论：license ECDSA/Ed25519 非对称签名链代码完备（v5\~v7 分层+客户端公钥轮换槽）。★ 2026-08-30 已完成部署收口：私钥在 `tools/secrets/`（LICENSE\_SIGN\_PRIVATE\_KEY.pem + LICENSE\_SIGN\_ED25519\_PRIVATE\_KEY.pem，gitignore 保护不入库，与客户端内置公钥配对已验证），经 `npx wrangler pages secret put` 配置到 tcm-prescription-system production 环境（AUTH\_SECRET/BACKUP\_SECRET/LICENSE\_EXPORT\_SECRET/LICENSE\_MASTER\_KEY 原有齐全），空 commit 触发新部署注入运行时（Pages secrets 变更必须新部署才生效）。经验：本机 wrangler OAuth 凭证过期后刷新失败；dash.cloudflare.com 对部分国内电信 IP 返回 403（登录页被风控拦截，浏览器登录报"验证出现问题"），**换手机流量热点（关手机 WiFi 只共享流量）即可正常登录授权**；api.cloudflare.com 不受影响，PowerShell 无浏览器指纹的请求恒 403 属正常（真人浏览器不受影响）。
  ★ 2026-08-30 license 签名端到端验证 + v6 潜伏 bug 修复（commit c4a0a431）：注入测试激活码到生产 KV（license:{CODE}，结构与 admin-approve 一致）→ validate API 真实签发 → 用客户端 license-manager.js 同款验签逻辑+内置公钥复验。验证发现 buildLicenseData 的 v6/v7 块**各自**调用 getNextSerial+randomHexBytes，data.sigSerial/sigNonce 被 v7 覆盖为 (N+1)/nonceB，而 signatureV6 实签值是 N/nonceA → license 下发字段与 v6 签名内容必然失配、v6 永远验不过（客户端 v7 优先才未暴露；若未来 Ed25519 私钥缺失降级 v6，fail-closed 将全拒）。修复=v7 块复用 v6 已写入的 serial/nonce。修复后生产 e2e 实测：v7/v6/v5 三签名全过 + 篡改负例（改 expiresAt 续命 10 年）正确拒绝。铁律：**多版本签名共存时，后签版本覆盖共享防重放字段（sigSerial/sigNonce）必须复用前版值而非重新生成**；license e2e 验证法沉淀：wrangler OAuth token 可直接操作 KV REST API（/accounts/{acc}/storage/kv/namespaces/{ns}/values/{key}），注入→签发→复验→清理全链路可控，测试后必须清 license:/license\_log:/license\_serial:/device\_version:/ratelimit:code: 全部关联 key 并复查。
  ★ 2026-08-30 最终轮防护审计（渲染层/IPC/WebView 三线，零代码变更全通过）：①双端 Electron 全部窗口 contextIsolation=true/nodeIntegration=false（sandbox 关闭为保留原生 prompt/confirm 的既定取舍）；②双端全部文件类 IPC（read/delete/open/save-backup/read-backup/read-file-as-base64/saveVideoFile/find-media-files）均有 sanitizeFileName（basename+清洗）+isPathAllowed（resolve+relative 白名单）双校验，find-media-files 为内联清洗（搜参数非路径）；③云APP WebView 全严（file/content/universal/mixed 全关+host 白名单+桥 caller 校验），离线APP fileFromFile=false+URL 白名单+桥 caller 校验，双 APP manifest 干净（allowBackup=false/cleartext=false/networkSecurityConfig/仅 launcher exported），均未开 setWebContentsDebuggingEnabled；④离线桌面 login.html 无 CSP 但 0 fetch 0 外联（纯本地验证，无暴露面）。**已论证并保留的残余风险**：离线APP `setAllowUniversalAccessFromFileURLs(true)` 不能关——Electron 同内核实验实证：关掉后 file→file XHR 全断（连白名单路径内都断），而 index.html 启动时同步 XHR `config.json`（L721，init 前必须完成）完全依赖它；CSP 对 file: 源无法做路径级限定（实验实证），connect-src 的 'self' 对 file:// 页面等于全 file 域。攻击前提是本地页面先出现 XSS（现有攻击面=导入恶意备份 JSON+innerHTML 渲染）；若未来要收口，正确路径是把 config.json 改为 Java 桥注入（而非动 WebView 设置或 CSP）。铁律：**file:// 协议页面的同源 XHR 依赖 allowUniversalAccessFromFileURLs，动这个开关前必须先排查同步 config.json 类启动加载；CSP 源表达式对 file: 协议无路径匹配能力，别指望用 CSP 收窄 file 域**。
  ★ 2026-08-30（晚）XSS 渲染层收口（上条"导入恶意备份 JSON+innerHTML"残余攻击面已封堵，6 份 index.html 同步）：全量扫描 onclick+模板插值与 innerHTML 插值后发现 5 个真实注入点——①\_\_renderHistoryPage 的 `onclick="loadHistory(${p.id})"`/`deleteHistory(${p.id})`（id 入 JS 上下文，恶意备份 id='1);alert(1);//' 即注入）；②renderCaseList 同款 loadHistory/deleteCase + `${p.totalAmount || 0}`（字符串直接入 HTML）；③renderFormulaList 的 `(c.dosage || '')`（未转义入 HTML）。攻击链实锤：importDataFromJson 零净化（HMAC 失败可确认继续、旧备份无 \_hmac 直接跳过），formulas/prescriptionHistory 原样入存储。修复（渲染期强转，覆盖导入/云端同步/本地全部数据源）：id/totalAmount 用 `Number(x)||0` 强转（注入串→NaN→0 惰性化，正常数字/数字字符串原样通过，11 组正负例语义测试全过），dosage 用 escapeHtml(String(...))。验证：check-interface 基线前后一致 + html-sync-check IN SYNC + diff-index-app exit 0 + 旧注入点字面量 6 份全归零。铁律：**innerHTML 模板里的 onclick 属性是"JS 上下文注入"（escapeHtml 防不住，必须 Number 强转/escapeJs），与 HTML 文本注入是两码事；数字字段直接** **`${p.x || 0}`** **不强转=给恶意备份留字符串注入口**。

* PE 区段嵌入类修改（pe-guard）验证必须实际启动被嵌入的 exe，仅跑哈希校验不查布局会放过 "not a valid application" 级损坏；改 `shared/pe-guard.cjs` 后用 `git diff --no-index` 验证三处副本一致（shared + db-offline/desktop/electron + db-yunduan/cloud\_desktop/electron）。

* pack-gate.ps1 打包验收门：历次打包事故固化为一道阻断门，打包流程走它验收。

* **打包产物（程序/APK）禁止自动上传官方下载网站**，必须人工检查合规后手动上传。

* ★ 2026-08-30 发布链路 APK 双位置坑（"新 APK 无法发布"根因，举一反三全链修复）：打包产物 APK 按规范输出到**项目根**（db-offline/db-yunduan 根），而发布链路三工具各自扫不同旧源——auto-publish.js/publish-release.js 只扫 **public/downloads/**（上次发布的旧 APK）→ sha 比对恒"无变化"；auto-update-downloads.js 只扫 **gradle 输出目录**（打包失败残留半成品会被复制发布）。三工具已统一为"项目根构建产物优先（fromBuild 标记），不存在才回退"：publish-release.js 在 --confirm+合规检查通过后同步复制进 public/downloads（带 sha256 校验，预演/检查模式不落盘）；auto-update-downloads.js 检查与 --confirm 同源（项目根优先，与 gradle 输出 sha 不一致打 WARN）。git 段 pull --rebase 必须带 **--autostash**（本地常有未暂存源码改动，rebase 拒绝脏工作区直接失败）。铁律：**凡"构建产物目录"与"发布扫描目录"分离的设计，发布工具必须双位置扫描或发布前显式同步，否则增量比对必失效**。

* 打包脚本 if 块内 echo 禁止未转义英文括号；Gradle daemon 模式必须一致（不混用 --no-daemon）；`.bat` 含中文必须 UTF-8 无 BOM + `chcp 65001` 且 CRLF 换行。

* ★ 2026-09-10 **manifest 版本号 SSOT 双轨一致性铁律**（下载页 APP 卡片显示"v1.0.0"不完整事故，第八道门建门）：hash-manifest.json 有**两个写入方**——publish-release.js（一键发布）与 auto-update-downloads.js（手动发布），手动轨曾只写裸 versionName（"1.0.0"）而一键轨写 `V{versionName}.{versionCode}`（"V1.0.0.283"），双轨格式漂移 → 下载页 APP 卡片版本缺号（用户看不到 versionCode 无法与 APP 内 V1.0.0.283 对齐）。根治三层：①双轨统一格式 `'V' + versionName + '.' + versionCode`（auto-update-downloads.js L216-225 / publish-release.js getAndroidVersion）；②**第八道门 `tools/check-manifest-version.cjs`**（pre-push ⑧）——{cloud,local,dingzhi}.apk.version 必须 `^V\d+\.\d+\.\d+\.\d+$` 四段式、versionCode 必须与尾段同源同值、sha256/size/url/fileName/updateTime 五要素齐备、dingzhi/local 镜像一致（download.html 读 local key）；③download.html 前端兜底——version 三段式时自动拼 apk.versionCode 字段显示。**安卓 startApkUpdateCheck 用 versionCode 整数比较不受 version 字段影响，但版本显示链路（下载页/APP内/管理后台）全部依赖 SSOT 格式**。铁律：**①凡两个以上脚本写同一配置文件（manifest/lock/baseline），格式规则必须门禁强制不能靠脚本自觉——第三轨出现时门禁自动拦截；②APK 版本显示口径唯一：V{versionName}.{versionCode}（软著要求 versionName 恒 1.0.0，区分度全靠 versionCode），任何新增展示位必须从 manifest.apk.version 取值且过第八道门格式校验；③版本相关 bug 排查先查双轨写入方格式是否一致（node tools/check-manifest-version.cjs 秒级定位）**。

* ★ 2026-09-13 **机构版误显标准版三连修（版本标签多写入方·双数据源分叉，王桂杰实报二连）**：症状=授权状态「✅ 已激活（机构版）」正确而顶栏/标题【云端标准版】错误。**根因链（跨两轮才挖穿）**：①版本标签渲染函数 applyEditionTags/getEditionTag 有**多个数据源**——CONFIG.versionLabel（打包默认）、CONFIG.edition（auth-core 缓存恢复）、登录 clinicEdition（运行时权威），优先级=versionLabel 最先；②**云端桌面真实主流程=login.js 登录窗→主进程 login-success→index.html Electron 自动登录分支（不走 handleLogin）**，自动登录分支从不调 refreshVersionTags → 标签停在启动帧打包默认（统一包=cloud_personal 标准版）——**修 bug 前必须先确认用户实际走哪条链路，冒烟要复刻真实链路而不是惯常路径**（第一轮修 handleLogin 路径=无效修复）；③ auth-core restoreEditionFromCache 只恢复 CONFIG.edition 不写 versionLabel → 分歧窗口内任何 applyEditionTags 调用（含 loadBuildMeta 异步回调）都渲染错标签。**三连修**：补丁1（handleLogin edition 优先级对齐+本地表回写 clinicEdition）、补丁2（自动登录分支补 refreshVersionTags+缓存回退，端到端冒烟 9/9 复刻真实链路）、守卫（getEditionTag 一致性检查——versionLabel 与 edition 分档判定相反时以 edition 派生为准，渲染层对任何数据分歧免疫；分装机版本两者一致零影响）。**铁律：①同一 UI 元素的多个数据源必须明确唯一权威（运行时登录态>打包默认），渲染函数对非权威源要带一致性守卫；②登录态恢复类逻辑（restoreEditionFromCache）凡改派生字段（edition）必须同步改其渲染缓存字段（versionLabel），否则留分歧窗口；③离线桌面 getEditionTag 本就是 edition 派生（无 versionLabel 优先）天然免疫——新功能抄实现前先看哪个端的设计更免疫，照抄免疫设计而非缺陷设计**。

* ★ 2026-09-14 **隐藏 input(type=date) 程序化 click() 不弹日期面板（改日期首版点击无反应根因）**：首版照抄 📁 相册导入的「display:none + input.click()」模式，但**file input 是浏览器特例**（程序化 click 允许弹文件选择器），**date input 隐藏时 click() 在 Chromium/WebView 一律不弹面板**（连 headless 里都会触发 cancel 事件）——同款模式不可类推。二版改为**可见轻量模态**：动态创建 overlay+panel（内联样式零 CSS 文件改动），可见的 `<input type=date>` 用户点击原生弹面板（手机 WebView 日期滚轮/桌面日历），+ 确定/取消按钮 + Enter 提交/Esc 取消/遮罩点击关闭 + 编号不变提示。**同轮连坐修复：loadHistory 旧记录 patientAge/patientPhone/patientAddress 字段缺失时直接赋值 `undefined` → input.value 变字面量字符串 "undefined" 上处方签纸面（用户实报「年龄 undefined 电话 undefined」）——历史数据加载赋值必须 `!= null ? val : ''` 兜底**。铁律：**①程序化唤起原生选择器只对 file input 可靠；date/color/select 类 input 要弹原生面板必须元素可见（或 showPicker()+手势，WebView 支持度不一不可依赖），交互入口一律用可见模态承载；②`el.value = obj.field` 赋值前想清楚 field 缺失时 undefined 会被转成 "undefined" 字符串（value/textContent 都是 String() 语义），旧数据加载赋值必带 != null 兜底；③「照抄既有模式」前先确认浏览器行为对该 input type 是否同样成立**。生效：云端网页随部署即时生效；云桌面/离线桌面需重打包 exe；云端APP/离线APP 需重打包 APK。

* ★ 2026-09-14 **处方改日期功能（补录历史处方）+ 统计日期优先级反转**：用户需求「历史栏添加不同日期的处方或修改处方日期」→ 方案 A 落地：历史条目 📅 按钮 → 隐藏 `<input type=date>` click() 唤起（手机 WebView 原生日期滚轮/桌面日历面板）→ onchange 后改 `record.date` + `record.createdAt`（**保留原时分秒仅换日期**，患者分析时间线连续）+ updatedAt/updatedBy → savePrescriptionToDB + syncPrescriptionToCloud 非阻塞（D1 upsert `date=excluded.date` 落地新日期；云端 created\_at 列为首建语义不更新）。**语义约定（医疗系统标准做法）：处方编号（YYMMDD+序号=录入流水）不变，就诊日期独立可改；媒体文件按「患者名\_处方编号」前缀匹配不随日期变**。**连坐修正（日期消费点全量优先级反转 p.date>createdAt）**：getFilteredPrescriptions/analyzePatients/analyzeVisitTrend/月统计共 4 处（public）+ 4 处（离线桌面）+ site-admin SYNCED 3 处自动传播 + 2 处分叉手工统一——不改则云端拉取记录（createdAt 恒首建值）下补录日期在分析页不生效。**冒烟工程坑（两次踩坑实录）**：①headless 中 `<input type=date>` 的 `click()` 无法打开选择器反而触发 cancel 事件 → oncancel 移除 input → 测试须打桩 `HTMLInputElement.prototype.click` 后手动派发 change；②`prescriptionHistory` 是脚本级 `let`（**不挂 window**），`window.prescriptionHistory=...` 赋值创建的是独立 window 属性、脚本函数读到的还是原 let 绑定——evaluate 注入脚本级 let 变量必须用**裸标识符赋值**（全局词法绑定可从后续脚本直接赋值）。铁律：**①新增「可修改的业务日期」必须全量排查日期消费点优先级（统计/分析/排序/导出），任一消费点仍把系统时间戳放首位就会出现"改了日期但某页不认"的半生效状态；②跨 script 注入测试数据先确认目标变量声明方式（var=window 属性可覆盖 / let=全局词法绑定须裸标识符赋值）；③headless 测日期选择器：click() 打桩 + 手动 dispatchEvent('change')，真实用户路径=选择器选值触发 change，测试语义等价**。生效：云端网页随部署即时生效；云桌面/离线桌面需重打包 exe；云端APP/离线APP 需重打包 APK；site-admin 随下次部署。

* ★ 2026-09-14 **手机APP处方签无法缩放（touch 事件只投递给手指起始元素）**：媒体查看器（拍照录像/处方签查看）的捏合缩放监听原挂在 `img` 上——**touch 事件的目标=手指落下的那个元素**，处方签是窄长图，双指捏合的第二指常落在图片外黑边（`mediaSingleView` 容器上）→ img 永远收不到第二指 touchstart → touchState 停在 pan → 缩放死；且黑边起手的单指拖动同样死（监听不在容器上）、手机 WebView 根本不触发 `dblclick`（双击重置形同虚设）。**修复（loadMediaSingleFile 四分支同修：public 双分支 + db-offline/desktop 双分支）**：①touchstart/touchmove/touchend/touchcancel 全部改挂 `view`（mediaSingleView 铺满观察区且自带 `touch-action:none`）——黑边起手全部生效，img 上的事件冒泡到 view 同样命中；②touchstart 里 `e.preventDefault()`（防 Android WebView 原生手势抢占合成 mouse 事件 + 长按弹出菜单）；③手机双击重置改为 touchstart 内 300ms 双触检测（复刻 dblclick）；④touchend 双指抬一指时重锚基线无缝转拖动（原来一抬全清空）；⑤补 touchcancel。**验证：合成 TouchEvent 冒烟（TouchEvent+Touch 构造器）修复前 0/3 实锤 → 修复后 9/9（云端APP assets/离线APP index-app/离线桌面 × 黑边捏合/拖动/双击重置），4 对跨版本基线全绿**。铁律：**①移动端手势监听必须挂「铺满交互区的容器」（touch-action:none）而非内容元素本身——touch/mouse 事件目标机制不同（touch=起始元素钉死，mouse=hover 元素追踪），挂在 img 上等于只认「两指都从图片上起手」的完美手势；②手机 WebView 的 dblclick 靠不住，双击交互必须 touchstart 手写时间窗检测；③「滚轮/双指缩放」的提示文案与实际手势能力必须冒烟对齐（合成 TouchEvent 复刻真实手势是低成本验证法）**。生效：云端网页随部署即时生效；云端APP/离线APP 需重打包 APK；云桌面/离线桌面需重打包 exe（桌面鼠标操作此前本就正常，纯顺带）。

* ★ 2026-09-14 **验方设置「新增验方」补齐处方药物输入环节（4 连 prompt 数据残缺）**：症状=验方设置里新增的验方，调用时开不出任何药。根因=旧版 showAddFormulaForm 用 4 连 prompt 只收名称/简码/功效/主治，**composition 恒为空数组**——药物组成只能靠主界面「存验方」录入，验方设置入口形同虚设。修复=重写为 **JS 动态创建表单模态**（零 HTML/CSS 文件改动，界面基线 6/6 零影响）：基本信息 + 药物组成编辑器（药名 datalist 药品库联想 + 数量 g 多行增删），保存组装 composition（price 经 getMedicineByName 从药品库自动补齐，与 selectFormula 消费端 `c.price||med?.price` 双向兼容）。**踩坑（冒烟两次红灯实录）**：①动态拼 HTML 的元素 id（`__afInd`）与保存时 querySelector 查询 id 首版写成两个样（`__afIndication` vs `__afInd`）→ null.value 保存静默失败——**动态模态的 id 是 HTML 拼串与查询两处手写点，写完必须 grep 交叉核对**；②冒烟脚本自身也用旧 id → 修 HTML 后脚本跟着改，三端才全绿。**基线知识**：嵌套函数（addRow 声明在 showAddFormulaForm 函数体内）会被 diff-cross-version 提取器当独立函数条目——本轮 desk 对入 Tier B 同体（双侧同体嵌套）、siteadmin 对入 Tier A onlyA（site-admin 无验方功能，showAddFormulaForm 本就 onlyA，属合法分叉非漏改）。验证：冒烟 30/30（public/离线桌面/云APP × 弹窗/三重必填/持久化/行增删/取消零副作用/selectFormula 消费兼容）+ sync-siteadmin 69/0 + sync-all 幂等 + 4 对基线全绿。生效：云端网页 push 即生效；云桌面/离线桌面需重打包 exe；云端APP/离线APP 需重打包 APK。

* ★ 2026-09-14 **桌面端静默热更新重建（带 Ed25519 验签三道门禁，旧版无验签被移除的正确教训）**：需求=免下载安装的静默热更（仅 HTML/JS 业务层）。**历史审定**：旧热更新（hot-update.js，22343bc5 于 08-17 删除）是「下载 zip 解压到 userData + 直接 loadFile」的**无验签裸远程代码加载**——删除正确，不是热更新不能做，是没验签不能做。**重建架构（vs 旧版本质差异）**：①逐文件清单下载（放弃 zip）——零解压依赖、天然增量（本地同 sha256 直接复制，只拉变更文件）、每文件独立校验；②三道门禁全 fail-closed——Ed25519 验签（version.json 清单签名，私钥 tools/secrets/ 不入库，公钥常量内置 hot-update-core.cjs 与 license v7 同一信任根）→ 逐文件 SHA256 → resolveHotEntry 每次启动全量复验，任何一关失败自动回退 asar 打包版（**asar 永不改动 → fuse 完整性/.bnzc 双哈希/Pre-build 探针链全部保持有效**）；③config.json **绝不热更**（含密码哈希+configSignature）——desktop-windows.cjs 在热入口生效时从 asar 复制模板到热目录（等价原同步 XHR 行为，运行时权威仍是 userData 覆盖层）。**模块布局**：shared/hot-update-core.cjs（纯逻辑零 Electron 依赖→可 node 单测）+ update-manager.cjs 组装（注入 net.fetch/userData/hotUpdateUrl，opts 不传则禁用向后兼容）+ desktop-windows.cjs 两接线点（L240 loadFile 前 resolveHotEntry、登录窗 dom-ready checkHotUpdate 并行整包检查）+ 两份 main.js 各 1 行 hotUpdateUrl 渠道参数。**三处登记**：sync-all Group 12（update-manager 组加 hot-update-core.cjs，同组同位因相对 require）+ copy-consistency 新组（64 副本）+ build.files electron/**/* 天然覆盖。**发布流程**：`node tools/generate-desktop-hotupdate.cjs -c cloud|local [-n 序号]` 生成 public/hot-update/desktop/<channel>/（散文件+version.json，同日重发加 -n 2）→ git push → Cloudflare Pages 自动部署 → 客户端登录窗 dom-ready 后 1.5s 静默检查 → 增量下载原子 swap（current→old-<ts>，pending→current，成功删 old）→ **下次启动生效**（登录窗淡绿横幅轻提示）。**铁律：①热包文件清单必须与 index.html 实际 script src 引用 + StockCore.loadXlsxLib 双候选链（xlsx 根/vendor）对齐，漏一个文件=对应功能静默 404；②Ed25519 公钥常量在 hot-update-core.cjs 与 license-manager.js 两处出现，轮换密钥必须两处同步；③签名消息构造 buildSignMessage 生成工具与客户端两份实现必须逐字符一致（改一处必改另一处）；④热版本号 YYYY.MM.DD-N 与 app 三段版本号是两条独立曲线（.hot-version vs app.getVersion），永不混用**。验证：冒烟 19/19（真实包验签+篡改负例×5+冷启动 swap+增量只下 1 文件+resolveEntry 复验+本地篡改隔离回退+已最新零下载）+ copy-consistency 64/0 + 4 对基线全绿 + 界面基线 6/6。生效：本轮仅代码入库（**客户端需重打包一次 exe 作为热更新基建载体**，此后 HTML/JS 层改动全部走热更免重装）；云端APP 天然热更不受影响；离线APP 热更属 Phase 2（Android Java 侧，待后续确认）。

* ★ 2026-09-14 **离线APP 静默热更新 Phase 2a（HotUpdateManager.java 客户端执行端）**：桌面 Phase 1 的 Android 同构——同一信任根（license v7 同一把 Ed25519）、同一发布链（Cloudflare Pages 散文件+签名 manifest）、同一回退哲学（assets 打包版永久兜底，APK v1/v2/v3 签名/NativeGuard/SecurityGuard 防篡改链全部保持有效）。**协议与桌面同构但隔离**：签名消息前缀 'app-hotupdate-v1'（≠桌面 'desktop-hotupdate-v1'）+ channel 'app-local'（≠桌面 cloud/local，**协议绑定：manifest.channel 必须等于常量才认——防桌面热包喂 APP**）+ minAppCode 硬门禁（APP 特有：热包 JS 依赖 AndroidNative 桥接口，原生层升级后旧 APK 装新热包会调到不存在的桥方法 → localAppCode < minAppCode 时 VERIFY_NEED_APK 跳过热更转整包通道）。**模块**：app_project/db-offline/app/.../HotUpdateManager.java（纯逻辑静态方法零 android.* 依赖可 JUnit——日志经可注入 Logger 默认 null；org.json 走 testImpl 真实实现；Ed25519/Base64/hex 全内嵌纯 Java——minSdk=24 无 java.util.Base64 且 JVM 测试无 android.util.*；网络路径 HttpURLConnection 不进 JUnit 留 Phase 2c E2E）。**MainActivity 三处接线**：loadLocalAssetWithRetry 热入口分支（resolveEntry 复验过→file://<filesDir>/hot-update/current/index.html，失败→原 assets URL；setAllowFileAccess(true) 已覆盖）+ configureWebView 防重入块（与 startApkUpdateCheck 并行）+ startHotUpdateCheck/injectHotUpdateToast（淡绿横幅 6s，与桌面同款）。**关键设计决策：Ed25519 内嵌同构副本而非抽公共类**——LicenseManager 是 license 链敏感文件（P0 保护范围），为其重构的回归成本远高于独立 RFC 8032 数学副本（标准固定内容无逻辑漂移风险，仅密钥轮换时同步公钥常量）；热更场景不做 Java/native 双路互检（那是 license 防本地 hook 的特殊要求；热更威胁模型是 MITM/恶意 CDN，HTTPS+Ed25519 已覆盖）。**JUnit 25/25（Node 签发↔Java 验签跨实现交叉验证）**：fixture 由 tools/gen-hotupdate-test-fixture.cjs 用真私钥签发生成（Ed25519 确定性签名→fixture 可 diff 入库，CI 无私钥可跑；**密钥轮换后须重跑 fixture 且公钥常量三处同步：Java HOT_ED25519_PUBLIC_KEY_HEX + LicenseManager.ED25519_VERIFY_PUBLIC_KEY_HEX + fixture 脚本**），覆盖验签/篡改负例×6/STALE×2/首次不算 STALE/NEED_APK/resolveEntry 好坏目录/Ed25519 独立向量（空消息，绕开常量测数学）/Base64/hex/sha256 已知向量。**踩坑实录（Java 侧）**：①lambda 体内 catch (Throwable t) 与外层 Thread t 重名→编译错（lambda 禁止遮蔽外层局部变量）；②org.json:20240303 真实实现 JSONException 是受检异常（android.jar bundled 版不受检）→测试方法全部 throws Exception；③PowerShell 双引号内 node -e 的 $1 被插值吃掉→正则替换毁掉全部方法名（**PowerShell 传 node 内联脚本必须单引号或写临时 .cjs**）。**Phase 2b/2c 待办**：生成工具 generate-app-hotupdate.cjs（含 license 链绝不进清单铁律——security-guard/license-manager/calculate-hash.js 留 APK 权威层，只热 UI/业务层）+ E2E 三场景（生效/篡改回退/minAppCode 拦截）+ 废弃旧 generate-hot-update.ps1。生效：本轮仅客户端执行端入库（**离线APP 需重打包一次 APK 作为热更基建载体**）。

* ★ 2026-09-14 **离线APP 静默热更新 Phase 2b（generate-app-hotupdate.cjs 发布工具端）**：Phase 2a 客户端执行端的发布链配套——`node tools/generate-app-hotupdate.cjs [-n 同日序号] [-m minAppCode] [-o 测试输出目录]`，产物 public/hot-update/app-local/（散文件+version.json，URL 与 HotUpdateManager.HOT_UPDATE_BASE_URL 逐字对应）。**源=APK 打包源 assets/public（权威源 index-app.html 的同步目标）→ 热包与 APK 永远同源自洽**。**★★ license 链绝不进清单铁律（三层落地）★★**：①工具内置 15 文件 FORBIDDEN 硬断言表（security-guard.js/license\*/calculate-hash.js/config.json/cordova\*/build-time.js/build-meta.json/afterPack.js/cloud-api.js/button-manager.js/edition-lock.js/electron/\*），清单与排除表交集立即报错（防手滑加回）；②**排除依据=加载链实证而非直觉**——security-guard.js 虽被 index.html 引用但业务代码零依赖 window.SecurityGuard（IIFE 自启动），热版 404 无副作用、APK 原生 SecurityGuard 不受影响；license/\* 不被 APP 页面引用（授权权威在 Java LicenseManager）；config.json 含密码哈希+configSignature；③**auth-core.js 是铁律唯一例外（必须进清单）**：它是 P1-9 校验对象但更是页面登录核心——热目录页面同步 XHR 相对路径读热目录，**setAllowFileAccessFromFileURLs(false) 封死「热版页面跨目录引用 assets 敏感文件」的路**，不进清单=热版登录全废；P1-9 校验的是 assets 副本（永不变）→ 校验与热更互不干扰，工具检测 auth-core.js 哈希变更时打印「桥协议兼容警告」（须评估提升 minAppCode）。**MainActivity 补接线（Phase 2b 第 4 处）**：ensureHotConfigTemplate——热入口生效时从 assets 复制 config.json 模板到热目录 current/（幂等缺失才补；swap 后新 current 无此文件→每次启动补齐；**运行时权威仍是 Java config.json 权威层**，对齐桌面 desktop-windows.cjs 从 asar 复制模板先例；页面 L755 同步 XHR 'config.json' 相对路径在热目录解析）。**工具三重自检（防生成「客户端必拒收」的包）**：Node 公钥自验签名+产物落盘回读逐文件哈希复验+模拟 Java verifyManifest 全门禁（白名单/文件数≤50/单文件≤20MB/index.html 必在/hotVersion 正则）——Java 端门禁常量镜像进工具（MAX_FILES/MAX_FILE_BYTES/SAFE_NAME_RE）。**冒烟 60/60**：结构/排除铁律×12/散文件哈希×12/与 APK 打包源逐字节一致×12/签名验签/篡改负例×3（hotVersion/文件哈希/伪造签名）/无孤儿文件。**minAppCode 默认读 build.gradle versionCode（287）**——⚠️ 冒烟实证：已发布 APK 284 < 287 → VERIFY_NEED_APK 转整包通道，**正式热包须等含 Phase 2a 客户端的 APK（≥287）发布后再发**（本轮产物仅留 .build-cache 冒烟目录未入 public/）。**废弃旧 generate-hot-update.ps1**（无验签 zip 包+MD5 旧协议，与 Phase 2a 客户端不兼容；引用链已查无功能依赖——latest.json/hash-manifest 仅历史 release notes 提及）。铁律：**①热包文件清单的每个排除决策必须基于「页面实际加载链」实证（script src 引用/动态加载/XHR 相对路径三链全查），凭文件名直觉排除=热版页面静默缺件；②WebView FileURLs 交叉访问禁用时（安全默认），热目录页面无法引用 assets 文件——热包必须自包含全部运行时引用（或像 config.json 由原生侧补模板）；③发布工具必须内置消费端门禁镜像自检——生成侧与验签侧门禁不一致=生成「客户端必拒收」的包且无任何报错**。生效：工具+MainActivity 入库（离线APP 下次重打包携带 ensureHotConfigTemplate；**正式热包发布流程：APK 287 打包发布 → node tools/generate-app-hotupdate.cjs → git push**）。Phase 2c 待办：真机 E2E 三场景（生效/篡改回退/minAppCode 拦截）。

* ★ 2026-09-14 **离线APP 静默热更新 Phase 2c（真机 E2E 三场景 + CRLF 入库哈希漂移修复）**：华为 ANA-AN00（Android 12）真机全链路实证，**APK 288（build-app.bat 打包，versionCode 287→288 副作用随首版热包 commit 一并收纳）**。**场景 A（生效）全闭环 ✓**：①基线——线上无热包时 Cloudflare Pages SPA fallback 对 version.json 返回 index.html 200（非 404！）→ 客户端 JSON 解析异常 → catch logw「静默更新失败（保持 current 不变）」fail-closed 静默放弃（主流程零影响，整包通道「已是最新 288」并行不干扰）；②发布——generate-app-hotupdate 产物 push 后 Cloudflare Pages Git 构建正常部署（配额未耗尽），线上 12/12 文件哈希字节级==manifest；③下载+swap——「发现新热版本 2026.09.14-1（本地 无）→ 静默下载 → 已就绪」全程 4.6s/2115KB；④生效——重启后「[hot-update] 已从 assets 复制 config.json 模板到热目录（Phase 2b ensureHotConfigTemplate）+ 加载热更新版入口 file:///data/user/0/<pkg>/files/hot-update/current/index.html」双日志，SSOT 注入 V1.0.0.288、NativeBridge 桥调用正常、登录页截图渲染完整（【离线机构版】V1.0.0.288）；⑤附加实证——**全新安装用户自动获取**（卸载重装后 4.9s 静默下载）+ **增量升级 18ms**（-1→-3 全部文件 current 同哈希免下载，纯本地复制）。**场景 C（minAppCode 拦截）✓**：线上发 minAppCode=999 测试包（-n 2）→ 设备 288 重启 logcat「热包要求 APK build ≥ 999（当前 288），转整包更新通道」双日志（verifyManifest NEED_APK + onNeedApk 回调）→ 不下载不打扰、本地已生效版本 -1 保持不受影响 → 正常包（-n 3, minAppCode 288）覆盖恢复。**场景 B（篡改回退）真机受三重客观限制**：release 包非 debuggable（run-as 不可写 filesDir）+ debug 包被 APK 签名校验拦截（logcat「APK 签名校验：Java 指纹不匹配→signature_mismatch 拒绝启动」——防篡改链反证有效）+ allowBackup=false（adb backup 通道封死）→ 磁盘层篡改注入无路径，**逻辑层以 JUnit resolveEntry_tamperedFile_quarantinedAndFallback + resolveEntry_missingEntryFile_quarantined 2 用例覆盖收口**（威胁模型=磁盘位翻转/三方工具破坏，Ed25519+SHA256 复验门禁在 resolveEntry 每次启动全量复跑）。**★★ 过程中抓出并修复真 bug：CRLF 入库哈希漂移 ★★**：首发热包 push 前验证发现 auth-core/medicine-dict/performance-utils 3 文件磁盘 CRLF、git eol 入库转 LF → 线上部署 LF 字节 ≠ version.json 的 CRLF 哈希 → **客户端逐文件 SHA256 校验必失败（fail-closed 拒收整包）**；修复=生成器文本文件（.js/.html/.json）CRLF→LF 规范化后再哈希/写产物（磁盘产物==git 入库==线上部署==version.json 四方一致），commit ec778612；**验证入库哈希必须用 `git cat-file -p` 原始字节流——`git show | node` 经 PowerShell 管道会被编码转换破坏字节流产生假差异（len 差 9KB 的假象）**。**Cloudflare Pages 行为两发现**：①SPA fallback 使不存在的 version.json 返回 200+HTML（非 404）——客户端 JSON 解析异常兜住，行为安全但日志文案是「静默更新失败」而非「无更新」（未来可用 Accept: application/json 头或专属 404 规则优化）；②`/index.html` 路径 308 重定向到目录路径 `/`（默认文档）——Android HttpURLConnection（OkHttp 桥接）自动跟随 308，真机下载哈希校验通过实证（其余 11 文件无后缀问题直连 200）。**E2E 工程坑**：①华为设备 USB 安装需手机端人工确认（INSTALL_FAILED_ABORTED: User rejected，连英文路径重装时点确认即过）；②logcat 缓冲区滚动极快（系统日志淹没 APP 日志）——**观察 APP 日志必须 `-s TAG:V` 过滤流式捕获或缩短 dump 延迟**，--pid dump 全量 35s 后应用日志已被滚掉；③装配任务名是 `:app:assembleDebug`（flavor 不进 variant 维度，无 assembleDingzhiDebug）。铁律：**①热包发布类工具的字节指纹必须按「git 入库规范化后」内容计算（git show/cat-file 验证而非磁盘文件自查）——CRLF/BOM/autocrlf 任何 eol 策略差异都会让线上内容≠清单哈希；②真机 E2E 的「线上内容验证」要走到字节级哈希（状态码 200 不等于内容正确——308 重定向与 SPA fallback 都会制造假 200）；③E2E 三场景设计时先验证「注入手段是否存在」（debuggable/run-as/backup 三通道），防篡改链健全的 APP 天然封死本地注入——逻辑层单测+线上链路真机是务实组合**。生效：**离线APP 热更全链路（Phase 2a/2b/2c）正式投产**——此后 UI/业务层改动发 `node tools/generate-app-hotupdate.cjs` + git push 即静默送达（用户下次启动生效）；仅 Android 原生层改动才需重打包 APK。当前线上热包=2026.09.14-6（minAppCode 288，在线心跳 10 分钟上报 + AndroidNative APP 判据修正；离线桌面 local 2026.09.14-3 同步热发）。

* ★ 2026-09-02 **APK 版本号 SSOT（Gradle=唯一权威源，详案已归档）**：显示版本号统一 **V{versionName}.{versionCode}**——MainActivity `injectAppVersionSSOT()`（onPageFinished 读 PackageInfo 注入覆盖 `window.APP_VERSION`，0/600/1500ms 三次幂等重试）+ 发布脚本 `readAppDisplayVersion()` 双侧从真实构建元信息取值。禁止：①多处硬编码版本串；②APK 抄桌面 latest.json（两条 versionCode 曲线，历史错判两次）；③改 HTML 字符串硬编码版本（不进客户安装包，等于自娱自乐）。**新增显示注入前必须 grep 宿主函数内既有注入机制——同一 DOM 挂载点的两个写入者必然叠加（Build N 双显事故）**。全过程 → `.trae/archive/2026-08-31-09-03-misc-experiences.md`。

* ★ 2026-09-11 **一键打包新增 [4] 智能打包（傻瓜式自动选择端）**：背景=用户"昨天已打包、今天只改部分端"时靠人工判断选 [1][2][3] 范围，易选大（无谓重打+versionCode 无谓递增）或选漏。实现（one-click-pack.ps1）：`Invoke-SmartPack` 先对四端跑 build-skip.ps1 -Check 增量检测（基线后该端源路径提交比对+工作区+产物指纹三要素），**先打印「[重打]/[跳过] + 触发文件清单」计划再执行**，只对有改动的版本组调 Build-Cloud/Build-Offline（整组无改动连配置同步都跳过）。入口：交互菜单 `[4] 智能打包 ★推荐` / 自动模式 `一键打包.bat 4` / 纯预览 `one-click-pack.ps1 -SmartPlanOnly`（只出报告不打包）。注意：**shared/ 通用模块（auth-core/observer）改动会波及四端全部标记重打——这是诚实检测不是误报**（auth-core.js 副本真实变了），急赶时间可人工选 [2]/[6] 缩小范围。铁律：**增量检测的判定粒度是"该端消费的源路径"，新增打包单元时必须在 build-skip.ps1 $unitDefs 登记其 sources/excludes（desktop/electron 只影响桌面不进 APP 的 excludes 先例）**。

* ★ 2026-09-11 **E2E 打包门"假失败"加固（Defender 首扫超时，2026-09-11 08:22 事故）**：用户 08:08 手动跑 [2] 本地版，桌面打包在 [7.8/9] pre-fuse E2E 的 E1（本地账号登录→等主窗口）30s 超时失败中止——**事后单跑同一 win-unpacked 产物 E1 5 秒通过、全 6 条 25 秒通过**，根因=打包流水线内 electron-builder/asarmor 刚写完 exe，首启被 Defender 实时扫描+高负载拖慢，45s 等待不够（假失败，产物本身合格）。修复（db-offline/desktop + db-yunduan/cloud_desktop 两个 e2e/run-e2e.cjs 同步）：①主窗口等待 45s→90s；②findWindow 超时消息改按实际 timeoutMs 显示（原硬编码"30s"误导）；③**失败用例立即重试一次**（全新 userData 重走完整断言，要过就得完整过，不产生假绿灯；重试通过在汇总标注"第2次重试通过，首启抖动"）。铁律：**E2E 门禁的等待超时必须按"流水线内首启最坏情况"（杀软扫描）设定而非"平时单跑速度"；带门禁的自动化流程对环境抖动类失败必须重试兜底——假失败代价=用户白等 20 分钟全流程重跑，而重试成本仅几十秒**。

* ★ 2026-09-14 **云端APP打开/登录提速（cv+immutable 缓存架构 + 登录 API 非关键写异步化）**：根因=三层"防旧页面"机制叠加把缓存彻底废掉——MainActivity 每次启动 `clearCache(true)`（08-23 治"线上更新不生效"加）+ 时间戳 URL（09-10 治清缓存异步竞争加）+ `_headers` 全 JS `max-age=0` → **每次冷启动全量重下约 1MB**（index.html 637KB + auth-core 317KB + 11 业务 JS）。四件套落地：①**内容哈希 cv + immutable 长缓存**——13 个根级业务 JS 的 script src 带 `?cv=<SHA-256前8位>`（`tools/check-cv-hashes.cjs` 校验/`--update` 重刷，幂等）+ `_headers` 13 条精确规则 `public, max-age=31536000, immutable`——内容变→cv变→URL变→缓存键变→必拉新，长缓存自失效；②**MainActivity 移除 clearCache(true)**——HTML 必新由时间戳 URL 保证（唯一保证，长期保留）、业务 JS 必新由 cv 保证、localStorage 本就不在清理范围；③**门禁机制化**：pre-push ⑪ + CI 8/8 强制 cv===文件当前哈希（2026-08-20 auth-core 24h 强缓存卡旧版教训的机制化根治——忘 bump cv=线上永不生效）；④**users.js 登录端点 11 处非关键写 waitUntil 化**（审计日志/失败计数清理，writeAuditLog 全函数 try/catch 零抛错故 waitUntil 安全；限流/锁定/PBKDF2/设备绑定等授权正确性路径保持 await 不动）。**★★ CF Pages `_headers` 拼接坑（首轮部署线上实测抓出）★★**：CF Pages 对多规则同名 header 是**append 拼接**而非 Nginx 式覆盖——13 条精确 immutable 规则与 `/*.js` 兜底同时命中根级 JS，拼出双 Cache-Control 头 `max-age=31536000, immutable, public, max-age=0, must-revalidate`，max-age=0 压掉 immutable；修复=删除 `/*.js` 兜底行——CF Pages 对未命中规则的静态资源**默认即** `public, max-age=0, must-revalidate`（version.json 实证），默认值就是兜底，热包 304 语义不变。**标准工作流（改业务 JS 后必走）**：改 shared/ 权威源 → `sync-all.ps1` → `node tools/check-cv-hashes.cjs --update` → `sync-html.ps1` 传播副本 → push（十二道门，2026-09-17 起含 ⑫ scan-undefined-consts 未定义常量扫描）。铁律：**①immutable 长缓存必须配内容哈希 URL——无内容哈希的长缓存=卡旧版（08-20 教训）；②新增根级业务 JS 引用必须两处同步登记（check-cv-hashes.cjs TARGETS + _headers 精确规则），漏一处=门禁误拦或缓存不生效；③CF Pages `_headers`「精确规则+通配兜底」同名头是拼接——**让每个路径只命中一条 Cache-Control 规则**是唯一安全写法，覆盖直觉在这里不成立；④Android WebView 磁盘缓存对 max-age=0 不重新验证（历史实锤）——"更新必生效"要留在 HTML 层（no-cache 头/时间戳 URL）不能靠清 JS 缓存实现**。配套：一键打包 AutoMode 新增单端组合 `1a/1d/2a/2d`（仅一端源码真实变化时缩围重打，门禁链与组模式同源；本轮先例：云APP 提速重打而云桌面 file:// 无 HTTP 缓存无谓重打）。生效：云端网页 push 即生效（二次打开业务 JS 零网络请求、登录 API 提速）；云桌面/云端网页登录即时受益；云端APP 需重打 APK（缓存头改动即时下发，移除 clearCache 须新 APK；已装机用户走应用内更新横幅）；离线双端不受影响（无 HTTP 缓存层）。

* ★ 2026-09-15 **登录提速二期（首屏处方随登录响应下发 + 服务端前置检查并行）**：实测登录感知 ~2.5-3s = 登录 API 1.5s（网络 961ms 国内→CF 固有下限 + 服务端 583ms 串行 KV）+ 登录后 `/prescriptions` GET **又一次完整往返 ~1s** + IndexedDB 写回。两刀落地：①**登录响应携带首屏处方（prescriptions 字段）**——服务端在密码验证/全部闸门通过后，与 writeUserSession **并行**跑 D1 快路径查询（一次 SQL ~50ms，零额外响应延迟），角色过滤与 GET /prescriptions 同规则（admin/cashier 全所、其余本人）；客户端 `cloud.js` 三层透传（authenticate→login→loginWithUsernamePassword），`getAllUserPrescriptions` 命中预取即跳过 GET 往返（合并本地未同步/filterOutDeleted/写 IndexedDB 逻辑同体复用，一次性消费保新鲜度）。②**前置三查并行**——checkLoginLocked 与 findUserForLogin Promise.all（原本串行两次 KV get 各 60-300ms）。**保底设计**：预取仅 D1 启用+有数据+≤2000 条才带字段，否则客户端走原 GET 流程（行为完全不变，KV 回退路径 loadAllPrescriptions 串行扫日期 key 绝不进登录关键路径）；**串号防御**——handleLogin 入口清 `window.__loginPrefetchedPrescriptions` 残留（上次登录未消费的旧值跨账号切换会串号显示他人处方）。**D1 读取共享化**：d1LoadPrescriptions/d1RowToPrescription 从 prescriptions.js 抽至 `_lib/prescriptions-store.js`（users.js 与 prescriptions.js 共享，行转换逻辑单源）。铁律：**①"登录后必然立刻发生的下一个 GET"是登录提速的第一候选——服务端一次 D1/KV 读（~50ms）换客户端一整次 HTTP 往返（~1s）是最高杠杆比；②跨请求传递一次性数据用"设置即消费"模式（登录入口清残留+首次读取即置 null），localStorage 持久化跨会话数据=串号温床；③登录响应附加数据必须与服务端原 GET 端点同源同规则（同 SQL、同角色过滤），否则两条数据路径悄悄分叉**。生效：云端网页 push 即生效；云端APP WebView 实载线上 public 下次打开自动生效（无需重打 APK）；云桌面随下次重打 exe（线上 auth-core.js 经 cv 自动失效刷新）；离线双端不涉及（不走云端登录）。

* ★ 2026-09-15 **APP预览缩放（viewport 禁缩放下的局部手势方案）**：预览tab处方签无法自由收放——viewport `user-scalable=no`（防输入框聚焦自动放大）全局禁了捏合缩放。**局部手势方案**（不动全局 viewport）：双指捏合 0.5~3x **围绕手势中点**（平移补正公式 t2 = t0 + (a−t0)·(1−s2/s0)，a=手势开始时(中点−纸片rect左上)+当期平移）、缩放后单指平移、双击复位、进tab自动复位+首次toast提示；transform-origin 必须设 `0 0` 配合公式（默认 center 会导致推导失配）。**★★ 共享函数层引用新符号的致命坑 ★★**：switchMobileTab 在 site-admin 共享函数清单（sync-siteadmin.cjs 69 函数）——函数体被机械同步进 site-admin，若直接调用同文件新增的 `_pvZoomReset()`，site-admin 无此定义 → ReferenceError 全挂。铁律：**共享函数体内引用可选新能力必须防御式 `if (typeof window._xxx === 'function') window._xxx()`，模块把能力挂 window**（`window._previewZoomReset` 先例）。跨版本基线处置：desk 对双侧同体新增函数 → `--update-baseline --pair desk` 收编 Tier B 监控；siteadmin 对 Tier A 新增单侧函数（site-admin 无缩放模块）→ 确认设计内分叉后 `--update-baseline --pair siteadmin` 归档。验证注意：离线桌面 index.html 的 new Function 提取检查有存量误报（模板字符串），HEAD 对照排除法可区分存量/新引入。生效：离线APP 291 热包 2026.09.15-1（打开两次）；云端网页/APP push 即生效；桌面双端+鸿蒙随下次重打包。

* ★ 2026-09-15 **存验方表单化 + 三个连环坑**：手机APP端「存验方」4 连 prompt（名称/简码/功效/主治）无药物输入环节——空处方存出的验方 composition 恒空数组，调用时开不出任何药。修复：saveAsFormula 复用验方设置表单模态（showAddFormulaForm 加 prefillItems 参数预填当前处方药物，标题动态「存为验方（已带入当前处方药物）」；无参调用=原行为）。**连环坑①（鸿蒙手工副本漏同步）**：09-14 验方表单化只改了 public/db-offline 双权威源，鸿蒙 rawfile 的 showAddFormulaForm 仍是 4 连 prompt 旧版（composition 恒空 bug 原样滞留）——**手工副本是同步盲区，凡改共面功能必须 grep 鸿蒙副本同款实现**（本轮完整移植表单版顺带修复）。**连环坑②（cv 漏刷）**：上轮 A5 打印修复改了 print-utils.js 但未 bump cv（4810bc5f 滞留）——**验证输出经 `Select-Object -Last N` 截断后 FAIL 行被吃掉只显示提示文字**，铁律：**验证命令必须看 exit code 或完整输出，管道截断会掩盖 FAIL**；immutable 长缓存下漏 bump cv=已装机用户永不生效。**连环坑③（热包序号覆盖）**：generate-app-hotupdate.cjs 的 seq 默认 1 且不自动递增——当天已发过热包（-1/-8）再跑默认 -n 会同号覆盖，**同号版本客户端不更新（版本比较相等即跳过）**；铁律：**发当天第 N+1 个热包必须 -n <今日最大序号+1> 手动指定**（先 git log 查当日已发序号）。生效：离线APP 291 热包 2026.09.15-9（打开两次）；云端网页/APP push 即生效；桌面双端+鸿蒙随下次重打包。

* ★ 2026-09-15 **离线APP热更新一次到位（智能热重载）**：热更新需"打开两次"（首次拉包安装、重启生效）——启动先加载本地版本保证秒开，页面加载完才后台检查下载，swap 完成时当前 WebView 已在跑旧代码只能下次启动生效。优化（MainActivity.java）：onApplied 时 evaluateJavascript 探测页面状态——idle=登录页且焦点不在输入框（含账号预填未聚焦）→ **直接 reloadHotEntry 重载热入口，当次打开即生效**；typing/op → 不打断保持原提示。**判定必须用焦点而非输入框值**：登录页有账号预填（local_rememberedUsername），按值判断 idle 永不成立。toast 文案区分"已生效"（当次应用）与"重启后生效"（不打断场景）。reload 后 onPageFinished → configureWebView 的 hotUpdateCheckStarted 已置位不会二次检查。多次热包本身一次拉最新全量快照（无逐级安装问题），优化的是"下载完成→生效"最后一跳。**★★ minAppCode 自动抬升坑 ★★**：generate-app-hotupdate.cjs 默认 minAppCode=build.gradle versionCode——**重打 APK 后 build.gradle 已 bump，直接跑热包工具会把 minAppCode 抬到新版，291 及以下装机用户全部命中 onNeedApk 转整包通道收不到热包**；铁律：**打完 APK 再发热包必须 -m 288 显式钉住（或按热包实际依赖的最低桥接口版本指定）**。配套坑：打包 -AutoCommit 的 git add 遇 .git/objects Permission denied 时副作用滞留工作区（下次打包"源码未落定"门拦截）——手动 git add 收纳即可；打包期间并发改源文件同样触发该门，**顺序=先打完包再改源码**。非交互发布：`node tools/publish-release.js --confirm --push --changed-only`（release-menu 的 Read-MenuChoice 在管道环境恒 EOF 直接 fatal）。生效：APK 292（GitHub Release+latest.json+官网）；291 及以下走应用内更新通道；292 装机首次打开自动拉最新热包+智能热重载当次生效。

* ★ 2026-09-15 **产品决策：离线机构版不做「前台收费」角色（已移植后整体撤销）**：用户反馈离线APP机构版添加新用户缺「前台收费（机构版）」→ 已按云端版完整移植（角色下拉/handleAddUser 读角色/收费工作台徽章+收费弹窗+本地记账/禁开方拦截，双端 index.html）→ 用户提出根本质疑：**离线不联网，多用户=同机切换账号，无多设备并发**。评估：云端合理（多设备同时登录+D1 实时同步，医师诊室开方+前台收费处收费的标准工作流）；离线意义有限——数据流通✅（本地库共享）、权限隔离✅、收费审计✅，但**多设备并发❌（离线无实时同步，"医师边开方前台边收费"不成立）、单机换账号繁琐❌**；真正需要前台收费的机构基本选云端版，离线客户多为单医师一人全包。用户决策：移除。`git checkout` 撤销两份 index.html（改动未提交未发热包，线上热包 -11/-3、APK 292 均不含 cashier，零善后零发布）。铁律：**①离线版「前台收费」角色是产品禁区，勿再移植（云端版保留不动）；②角色分工类功能的价值前提是"多设备并发+实时同步"——单机数据共享撑不起工作流价值，移植角色前先问目标端的并发模型；③存量注意：离线版 newUserRole 下拉显示「普通用户+管理员」但 handleAddUser 锁死 newRole='user'（唯一管理员防多开，死选项属刻意设计非 bug）**。

* ★ 2026-09-17 **CI 门禁接线两教训（scan-undefined-consts CI 生效验证时连环抓出）**：**①CI 步骤必须加进「实际会跑的 workflow」**——本仓库工作流是直接 push main，`verify-unified.yml`（push 触发，八重→九重防线）才是主 CI；`code-quality.yml` 是 **pull_request 触发**，直接 push 永不执行，把新门禁只加进它=CI 侧空谈（首次接线即中招，gh run list 实锤 code-quality 从未在 push 链上跑过）。铁律：**加 CI 步骤前先 `gh run list` 确认目标 workflow 在真实工作流中会被触发，PR/手动触发的 workflow 只能作旁路兜底**。**②cv 哈希门禁的本地绿/CI 红漂移**——check-cv-hashes.cjs 原按磁盘原始字节（Windows CRLF）算 SHA，git eol 入库转 LF → CI checkout LF 内容哈希不同 → verify-unified 8/8 **连续 7 次 failure**（f21f8a7 起，本地 pre-push ⑪ 却恒绿），与 09-14 热包 CRLF 入库哈希漂移同根（auth-core/medicine-dict/performance-utils 3 文件）；根治=sha8 统一 CRLF→LF 规范化后哈希（本地=CI=线上三侧同基线），--update 重刷 3 cv + sync-html 传播。铁律：**凡「内容哈希」类门禁必须按 git 入库规范化内容计算（磁盘字节≠入库字节≠CI 字节），验证闭环必须看到 CI run 绿色结果才算生效（gh run watch），本地绿≠CI 绿**。CI 红灯历史应常查：连续红会淹没后续真实红灯（本次 7 连红期间若引入真回归无法察觉）。

* ★ 2026-09-15 **激活码常显 + 桌面热包 CRLF 根因修复 + minAppCode 抬升事故修复（三合一）**：**①激活码常显（评估=需要）**——客户换机重激活/到期续费/授权找回/客服核查均需提供激活码，此前仅激活成功瞬间可见，之后无处可查只能找管理员；实现（offline.js 权威源+3副本）：已激活用户在「基础设置→授权状态」区显示 🔑激活码+点击复制（textContent 写码防注入），四来源取码 `getLicenseCode()`（StorageAdapter → localStorage → electronAPI.license.getActivationRecord → 机器码联网找回 admin-status，全兜底静默跳过），与邀请码卡片共用幂等防重复策略（querySelectorAll 清旧卡）。**②桌面热包 CRLF 根因（-1 起双渠道从未送达）**——generate-desktop-hotupdate.cjs 漏了 APP 工具已有的行尾铁律归一化：源文件（sync 链 PREPEND 头）含 CRLF 时按磁盘字节算哈希，git 入库 eol=lf 剥 CR → 线上 LF ≠ 清单 CRLF 哈希 → 客户端逐文件 SHA256 门禁 fail-closed 拒收整包静默回退 asar（**无任何报错，热更新"从未生效"只有线上哈希对比才能实锤**）；修复=对齐 generate-app-hotupdate.cjs 的 normalizeLf+回读复验，重打 local -8/cloud -5 双渠道（staged-blob 验证 ALL-OK）。**③minAppCode -11~-15 抬升事故**——「打完 APK 再发热包必须 -m 288 钉住」铁律只靠人记，-11 实际复发（裸跑工具默认读已 bump 的 build.gradle 292，288-291 装机 11:00 起收不到热包转整包通道）；修复=工具防呆——未传 -m 时**继承上一包 minAppCode**（无上一包才读 build.gradle，显式 -m 仍可覆盖且打印来源），-16 已钉回 288。**④产品决策：云端三端（云端APP/网页/云桌面）不做激活码显示（2026-09-16 用户确认）**——用户问"云端APP、桌面程序是否需要激活码"，评估结论=不需要：云端授权模型=**账号订阅**（手机号+密码，登录即激活，cloud.js 优先级1=账号状态，界面文案"登录即可使用，无需激活"），激活码只是服务端后台资产（付款审批后自动落账号，用户全程见不到）；客户端本地无码可显（`license:code` 仅云桌面旧本地license路径写入）；换设备/续费/客服核查全凭手机号。对比离线版码=用户唯一凭据（换机/重装/续费必须出示、丢了只能找管理员）所以离线双端需要常显。铁律：**激活码类凭据显示需求按授权模型判断——"码+机器码"模型（离线）需要常显，"账号订阅"模型（云端）勿加（硬加会让云端用户误以为要记码，与"登录即可用"定位冲突）**。**桥依赖安全论证法**：热包快照对 288+ 兼容的判定依据=grep 全部 `AndroidNative.invoke` 命令+成员引用（invoke/getAppConfig/printPrescription/getMediaStats/saveBackupFile/quitApp/printHtml/openExternalUrl/getMachineId，最新 getAppConfig 09-06 引入，全部 ≥288 装机 09-14 后构建均含），不是凭感觉。铁律：**①桌面热包生成工具与 APP 工具是平行实现，一处修 bug 必查另一处同款实现（本次 CRLF 就是 APP 修过桌面漏修）；②"必须记得传参数"类铁律复发一次就必须工具化防呆（继承默认+来源打印）；③热包哈希验证必须 staged-blob/`git cat-file blob :path` 级别（模拟入库后字节），工作树自查会漏 CRLF 漂移**。生效：离线APP 288-292 全部装机热包 app-local 2026.09.15-16（minAppCode 288，288-291 恢复送达）；离线桌面 desktop/local 2026.09.15-8（首次真正热更送达）；云桌面 desktop/cloud 2026.09.15-5（首次真正热更送达）；云端网页/APP 不涉及（auth-core 是 offline 版）。验证方法：离线APP 完全退出打开两次（292 当次生效）→ 基础设置→授权状态 显示激活码点击复制；桌面重启软件生效。

* ★ 2026-09-16 **热更新一键回滚（Layer 0 服务端重签发布回滚，rollback-hotupdate.cjs）**：需求=热包出问题时「一键恢复上一版本，确保用户正常使用」。**完整操作手册 → `.trae/documents/热更新一键回滚SOP.md`**（何时用/决策树/CLI/时效/FAQ/红线）。**原理（零客户端改动）**：热包是全量快照，两端客户端版本判定均为 `hotVersion !== 本地 && signedAt > 本地signedAt`（HotUpdateManager.java L164 / hot-update-core.cjs L176）→ **把旧内容重新签名发布为更高版本号，全体客户端视为"升级"即完成全量回滚**。**分层设计**：Layer 0 服务端重签回滚（已实现，分钟级恢复）；Layer 1 客户端本地保留+坏版本屏蔽表（需下次 APK/exe 发版，暂缓）；Layer 2 界面按钮（骑 Layer 1）；Layer 3 自动健康检测回滚（不建议——误判风险高且 Layer 0 已分钟级）。**用法**：双击 `一键回滚热包.bat`（交互菜单：渠道 1/2/3 → 版本列表 → 回车=上一版 → 回车=整包 → dry-run 计划 → y 确认写盘 → 可选自动 git add+commit+push）；CLI 等价 `node tools/rollback-hotupdate.cjs -c <channel> [-v 版本] [-f 文件1,文件2] [--dry-run] [--yes]`。**决策树**：新热包大面积翻车 → 整包回滚上一版（默认）；仅个别文件坏 → `-f` 单文件回滚（清单=当前版，指定文件取目标版字节，其余客户端零重下）。**安全机制**：minAppCode 取当前与目标较小值（最大送达面，绝不在回滚时抬门槛）；文件哈希一律从 git blob 重算（绝不沿用旧清单哈希——自动修正 CRLF 时代的清单病）；零变化硬中止 exit 1（防发布无意义版本跳变）；写盘后回读复验+签名公钥自验，失败自动 `git checkout --` 还原渠道目录；目标≠当前、版本数≥2、-f 文件须在双清单存在等前置守卫。**恢复时效**：git push → CF Pages 部署（~1-2 分钟）→ 客户端下次启动拉取生效；离线APP 292+ 登录页空闲时当次生效（智能热重载）；**回滚的回滚对称**——又想回最新版，再次回滚到该版本即可（版本号继续向上，客户端永远只认"更高的版本号"）。铁律：**①buildSignMessage 签名消息构造现有 4 份实现（Java 客户端 / generate-app-hotupdate / generate-desktop-hotupdate / rollback-hotupdate）必须逐字符一致，改一处必改其余三处；②回滚发布后必须 git push（工具可代劳）——只写盘不推送=线上还是坏版本；③git 历史是回滚唯一素材源，渠道目录的 version.json 提交历史即发布史，勿 force-push 改写热包历史**。工程坑：**Node readline 管道竞态**——piped 输入一次性到达时 line 事件可能在 question 注册前发出被丢（交互流程静默退出 exit=0），交互工具必须用队列式 ask()（lineQueue+waiters 配对），TTY 与管道测试双可靠。生效：纯服务端工具无客户端改动，三端无需任何发布；已验证 --list/dry-run/单文件/零变化中止/管道交互全流程。

* ★ 2026-09-16 **热更新回退 Layer 1+2（客户端本地回退三件套 + 登录页「回退上一版」入口，双桌面端+离线APP 三端落地）**：Layer 0 重签回滚覆盖「服务端可响应」场景，但**门禁验的是「完整性」≠「正确性」**——签名哈希全过但内容有 bug 的热包，服务端重签也需分钟级+客户下次启动；离线客户更可能收不到回滚包。Layer 1 三件套（双端同构）：①**swap 保留 previous**（current→previous 不再删 old-\<ts\>，~2MB 磁盘换秒级本地恢复）；②**坏版本黑名单** `.hot-blacklist`（`[{hotVersion,signedAt,reason,at}]` 上限 5 条 FIFO；rollbackLocal 记录 + checkUpdate 拒绝重灌同一 hotVersion + resolveEntry 启动时 current 命中黑名单→自动本地回退（防 rollbackLocal 半途中断残局）；**Layer 0 重签发布=新版本号，天然不命中黑名单，两通道零冲突**）；③**rollbackLocal 静态回退**（拉黑 current → previous 全量复验通过晋升 current 并恢复 .hot-version / 否则隔离 current 回打包版兜底；桌面 asar、APP assets）。**Layer 2 界面入口稳定设计（核心：入口不依赖热版本页面 JS 存活——热包 JS 崩了按钮还得在）**：桌面=登录窗 login.html 属 asar 域永不热更，update-manager.cjs injectHotRollbackEntry 在 `.footer-section` 注入 9px 小链接，点击 window.open(`kyt-desktop-hot-rollback://start`) → setWindowOpenHandler 拦截（复用整包更新横幅同款 scheme 模式）；APP=MainActivity onPageFinished 延迟 400ms 原生注入（evaluateJavascript 常量字符串），链接挂 **loginOverlay 内部**（.login-overlay 是 fixed 全屏层，登录成功 display:none 时链接自动消失，无需清理逻辑），点击 AndroidNative.invoke('hotRollback') → rollbackLocal → 主线程 reloadHotEntry 当次生效（无需重启APP）。探测判据 getActiveHotState（current 验签通过且未拉黑）+ loginOverlay 可见 + hasPrevious 区分文案「回退上一版/恢复内置版本」。**回退后无需重启**：回退动作本身毫秒级同步重命名，登录成功进主界面时 resolveEntry 已走恢复的版本。**验证**：桌面冒烟 39/39（smoke-hot-update.cjs 新用例 7-11：no-current/swap 保留 previous/rollbackLocal 恢复/黑名单拒绝重灌零下载/黑名单版本摆回 current 自动回退/无 previous 回 asar）+ APP JUnit 34/34（HotUpdateManagerTest ⑨ 新组 9 用例：黑名单去重 FIFO/verifyHotDir/rollbackLocal 四场景/resolveEntry 黑名单自动恢复/getActiveHotState；**fixture 双版本扩展**——gen-hotupdate-test-fixture.cjs 新增 manifestPrev 2026.09.13-1 独立真实签名，黑名单拉黑的是版本号，previous 与 current 必须不同版本才能测「恢复后递归复验通过」链路）+ copy-consistency 72/0 + 界面基线 6/6。**双端语义对齐点**：坏 previous 复验失败只告警不删（留现场；下次 swap 前 deleteTree 清理，不污染链路）。铁律：**①回退入口的宿主必须与热版本隔离（asar 域页面 / APK 原生层注入），挂在热包 JS 里=坏版本把自救按钮一起带走；②注入 UI 挂宿主容器内（loginOverlay）而非 body——宿主隐藏时注入物自动消失，省掉手动清理和登录后遮挡；③黑名单键=hotVersion 字符串，Layer 0 重签回滚发新版本号，故两通道永久正交，勿改成内容哈希键**。生效：**云桌面/离线桌面需重打一次 exe、离线APP 需重打一次 APK（Layer 1 基建随包生效，此后回退能力常驻）；云端网页/云端APP 不涉及（无桌面热更通道）**。Layer 3 自动健康检测回滚维持不做（误判风险，Layer 0+1+2 已覆盖分钟级/秒级/自助三档）。

* ★ 2026-09-16 **登录框记住用户名「单条 × 删除」（全端统一）**：需求=下拉里多余的用户名/手机号残留只能点选填充或退出登录全清一刀切，加**每条右侧小 ×**（hover 变红）单条删除，五端统一。**实现分层**：①AuthCore 新增 `removeRememberedUser(username)` API（cloud.js/offline.js 双权威源+导出；过滤 auth:rememberedUsers + 单值键 auth:rememberedUsername 切换剩余首条/清除 + **老单值键 cloud_/local_/rememberedUsername 等值清理**——防 loadRememberedUsers 兜底捞回已删项；离线版顺带 _isGenericUsername 读时清理）；②页面层（public + db-offline/desktop 双权威源 index.html）：renderRememberedUsers 每条动态注入 ×（DOM createElement+内联样式 flex 布局靠右，**不改静态 HTML/CSS**，界面基线 6/6 零破坏）+ removeRememberedUser 页面函数（AuthCore 优先→localStorage local_* 双写键回退，模式对齐 saveRememberedUser；删后重渲染+输入框显示被删值时切换剩余首条；**剩 0 条自动隐藏 ▼ 按钮**复用现有空数组逻辑）；③双桌面登录窗 electron/login.js（asar 域独立实现，无 AuthCore）：merged 项标记 source:'remembered'，**仅记忆来源显示 ×，config.users 本机注册账户不显示**（× 会误导为"删除账户"）；removeRememberedUsername 清 local_* + **顺带清 auth:\***（同 origin 共享 localStorage，防主窗口 loginOverlay 下拉复活）；④site-admin：旧版 removeRememberedUser 只清 asyncStorage cloud_rememberedUsers 备份（AuthCore 优先读链下**删后刷新复活 bug**）——升级为 AuthCore 新 API + cloud_* 备份键 + local_* 三域全清（保留 Tier C 合法分叉，基线已归档）。**分发链实操**：sync-all.ps1 覆盖 html×4 生成副本+siteadmin SYNCED-FN（renderRememberedUsers 已在 69 函数清单自动传播），但 **auth-core 11 副本必须单独跑 sync-auth-core.ps1**（sync-all Group 1 注释明示 excluded；copy-consistency 只验副本间一致，副本全旧=全绿是盲区——**改 shared/auth-core 后 sync-all 跑完必查 git status 是否出现 11 份 auth-core.js 变更，没有=漏跑**）。跨版本基线：desk 对 removeRememberedUser 双侧同体新增→--update-baseline --pair desk 收编 Tier B（188）；siteadmin 对 Tier C 分叉归档（79）。验证：冒烟 26/26（tools/_tmp/smoke-remove-remembered.cjs：3条保存→删中间/删预填/删最后/大小写不敏感/老key兜底不复活/删不存在无副作用，双权威源各 13 断言）+ copy-consistency 72/0 + 界面 6/6 + node --check 全过。铁律：**①登录窗（electron/login.js）与主界面（index.html）是两套独立登录实现+三套存储键（local_*/auth:*/cloud_*），任何删除/写入类操作必须三键联清否则跨界面复活；②共享函数层（SYNCED-FN）函数体引用的新函数必须在 site-admin 侧真实存在（本例 removeRememberedUser 两侧都有所以 SYNCED-FN 同步安全——先查 target 侧定义再改 public 引用）**。生效：云端网页 push 即生效；云端APP WebView 实载线上 public 自动生效（无需重打 APK）；云桌面/离线桌面——index.html/auth-core.js 走热更通道（下次「一键发布」生成热包即送达），electron/login.js 属 asar 需重打 exe（**最简=下次发版一次性重打包**）；离线APP index-app.html+auth-core 走热包、无需重打 APK（292+ 装机热包送达即生效）；site-admin push 即生效。

* ★ 2026-09-16 **admin 控制台「🔑 账户安全」入口（自助改登录用户名/密码，防用户名枚举）**：背景=https://tcm-prescription-system.pages.dev/admin/ 用 `admin` 通用名——攻击字典第一位，去掉了"用户名一半保密性"；撞库一次成功防不住（锁定只拦多次失败）。**实现**：①后端 users.js change-password 端点放宽——newPassword 从必填改为「与 newUsername 至少一项」（支持**仅改名不轮换密码**，newPassword 空时保留原 passwordHash/salt；改名后照旧 revokeAllUserTokens 强制重登；message 三分支区分仅改名/仅改密/都改）；②前端 admin/index.html 顶栏「🎫 工单审批」后加 🔑 账户按钮 + accountModal 弹窗（当前密码必填验身份，新用户名/新密码选填至少一项；**前端预检与后端同规则**：非中文/`^[A-Za-z0-9_-]+$`/2-30 位/非手机号/非同名；成功 alert 后 doLogout——服务端已撤 token 必须重登）。**双副本纪律**：public/admin/index.html ↔ site-admin/admin/index.html 是 adminconsole 对（lines 模式，基线=空差集字节镜像）——**改完 public 侧必须 Copy-Item 镜像到 site-admin/admin/，fc /b 验字节一致**；admin 页不在 check-interface 6 份主界面基线内（HTML 改动零影响），也不带 cv 参数（HTML 不长缓存，无 cv bump 需求）。**验证**：diff-cross-version 四对全绿（adminconsole 空差集保持）+ users.js 动态 import ESM 语法 + admin 页内联 JS 用 vm.Script 纯编译检查（tools/_tmp/check-admin-inline.cjs，189KB 主 script 块 OK）。**安全自审**：弹窗显示用户名用 textContent、错误走 showAlert(textContent)，无 innerHTML 注入面；端点要求 Bearer token 且只能改自己（username 必须=token 用户），无枚举/越权面。铁律：**①改 admin 控制台=改 public/admin/index.html 后必须镜像 site-admin/admin/（有实锤事故：09-10 漏斗只进 public、09-11 license 警示只进 site-admin，双向漂移各缺一块）；②后端"放宽必填参数"类改动先全仓 grep 调用方确认旧行为兼容（本例所有现有调用方都传 newPassword，放宽无破坏）**。生效：纯服务端+两站静态页改动，push 即部署（Cloudflare Pages Git 构建），五端零重打包；admin 后台页强刷（Ctrl+F5）可见新按钮。

## 6. 数据存储布局（现行 v3，2026-08-29 定稿）

**桌面版（离线/云端同布局）**：

* 媒体（拍照录像）：`安装盘根目录\惠康中医媒体\downloads\YYYY-MM\`。重装软件/重装C盘均不丢；根目录无权限自动回退 %APPDATA%；便携版 exe 同级。

* 处方文字数据：`安装盘\惠康中医媒体\data\`（data/\*.json）。备份/换机只拷「惠康中医媒体」一个文件夹。

* getUserData() 用候选数组兼容读旧位置；migrateLegacyDataToCentral() 启动自动迁移（不覆盖不删旧）。

* ★ getCentralDataDir 用模块级 let 缓存，只能在运行时（IPC/whenReady）调用，禁止模块顶层调用。

* 排查桌面媒体问题顺序：安装盘\惠康中医媒体\downloads → %APPDATA%\userData\downloads → 安装目录 downloads。

* 云端版处方主存在服务器，data 是本地缓存。

**APP 版（离线/云端）**：

* 媒体专属目录：getExternalFilesDir（卸载即清空，数据保留依赖一键备份）。

* ~~本地数据加密：db-adapter.js 字段级 XOR+Base64~~ **已退役（2026-09-13 P2-A1 核实）**：db-adapter.js 连同其 \_encRecord/\_decRecord 加密在 script 标签被注释时代就已停止加载，全库零消费者，模块已整体删除；当前 IndexedDB/localStorage 处方数据为明文落盘（如需恢复静态加密属新功能决策，非回归修复）。

**备份/恢复（已验证正常，2026-08-29 用户确认）**：

* APP：原生 saveBackupFile → `Downloads/中医处方系统/`；恢复优先「备份列表一键恢复」（listBackupFiles/readBackupFile），离线APP恢复含账号表 local\_systemUsers+基础设置（重装后原账号直接登录），云端版不含（账号在服务器）。

* 桌面：IPC save-backup-file → `惠康中医媒体\downloads\中医处方系统\` 子目录；list-backup-files/read-backup-file IPC 一键恢复（兼容存量根目录备份）。

**★ 数据安全与备份全景（2026-09-09 定稿，诊所删除不再丢数据）**：

**云端三层防护**：
1. **处方软删除** → `prescriptions_trash` KV（保留10000条，可恢复）；永久删除需先入回收站，总有恢复窗口
2. **诊所删除前自动备份** → 删除前将全部业务KV（prescriptions/trash/medicines/formulas/users/序号）备份到 `clinic_backup_{clinicId}_{timestamp}`，再物理删除
3. **KV全量备份** → 管理员手动 `backup-kv.js`，保留5份

**离线自动备份**（无需用户操作）：
1. **每日本地备份** → 首次保存处方时触发，localStorage 保留10份
2. **文件自动备份** → `userData/backups/backup_YYYYMMDD_HHmmss.json`，每日启动+应用退出时触发
3. **IndexedDB备份** → 无Electron环境时回退
4. **保留策略** → 7天内每日、4周内每周、12月内每月
5. **手动导出** → `Downloads/中医处方系统/本地_{医师}_{时间}.json`（用户主动备份，永久保留）

**恢复方式**：
- 处方回收站：客户端 🗑️ 按钮恢复（30天内）
- 诊所数据恢复：`POST /users?clinic=restore&backupKey=clinic_backup_{id}_{ts}&clinicId={新诊所ID}`（platform_admin）
- KV全量恢复：`restore-kv.js`（platform_admin）
- 离线备份恢复：客户端「导入」→ 备份列表一键恢复

**铁律**：删除诊所/处方前系统自动备份，禁止任何"无备份直接物理删除"的代码路径。

* **APP 端功能判断禁止依赖 IS\_ELECTRON 常量**（shim 在 onPageFinished 注入，顶层常量已固化为 false），必须运行时判断 `window.electronAPI && window.electronAPI.xxx`。

* ★ 2026-09-06 第十一轮（机构版按钮错显·启动竞态根治）：**页面解析期（内联 IIFE 同步执行段）调 electronAPI.xxx 在安卓 APP 上必然静默跳过**——shim 在 onPageFinished 才注入，解析期 `window.electronAPI` 不存在，`if (window.electronAPI && window.electronAPI.getAppConfig)` 整段不执行 → CONFIG.edition 恒为出厂 personal → 机构版激活登录后仍被 enforceStandardEditionButtons 强制标准版对齐（错显【修改密码】）。根治=index-app.html 该 IIFE 增加 `else if (window.AndroidNative && typeof window.AndroidNative.invoke === 'function')` 分支：**同步直调 `AndroidNative.invoke('getAppConfig','{}')`（addJavascriptInterface 在 loadUrl 前注册，解析期即可用；JavaBridge 线程同步返回 JSON 字符串）**，结果同步入 CONFIG + resolve `__appConfigReady`（自动登录免 800ms 等待）。时序安全性论证（改动前必须核对）：①全部 DOM 在 body 单行（L664）先于内联脚本（L669 起）解析，同步分支执行时按钮节点已存在；②applyEditionTags/enforceStandardEditionButtons/updateUserDisplay 与 IIFE 同属一个 script 块，函数声明提升全可用；③CONFIG（const）在 IIFE 前已初始化。铁律：**安卓端启动期（解析期）需要原生能力时，唯一可靠通路是 AndroidNative.invoke 同步直调，禁止只写 electronAPI 路径等 shim；改这类启动竞态代码前必须逐一核对 DOM 解析顺序/函数声明提升/TDZ 三个时序前提**。同日审计佐证：同日 4 次成功打包 APK 内 index.html 哈希全相同（0be38f6e），证明"工作区已改但未 commit/未打包"是用户实测不生效的头号原因——**每轮修复后必须确认 修复已 commit + 打包产物哈希已变化，再交给用户测试**。

* JS 桥三层防御：Java invoke() 必须 catch(Throwable)；shim 层拦截 null/'null'/''；前端 result null 安全。WebView 桥异常表现为「返回 null」而非 JS 异常。

* ★ 2026-08-30 重装激活登录失败双坑（用户实测 13398628212/admin123 失败）：①备份导出 users 恒为 \[]——`JSON.parse(localStorage.getItem('local_systemUsers'))` 读的是 XORv1 加密串必抛异常，「备份含账号表」从未真正生效；修复=先 simpleDecrypt 再 parse（4 处离线系 index.html）。②重装自愈只自动填手机号不填密码，密码栏留空被静默写成 admin；修复=auth-core 激活提交前密码留空弹 confirm 明确告知。排查铁律：用户"激活后登录不上"先让 TA 试 admin。

* ★ 2026-08-30 登录兜底自愈+账号映射（双坑修复后仍登录失败，诊断版实锤两根因）：①启动自愈（startLicenseCheck 2 秒延迟）依赖桥注入时序，桥静默返回 null 时激活账号没进 localStorage——handleLogin 兜底：找不到账号时当场调 getActivationUsers 从 config 拉激活账号补入再匹配（标记 LoginSelfHeal）。②Tab2「激活码直输」submit(code,user) 只传 CONFIG.doctorName（可能是出厂默认"XXX"）→ Java 建账号 username=医师名、无 phone → 输手机号永远找不到——个人标准版登录输入未命中时映射到实际激活账号（有 phone 优先，否则非内置 admin）。登录失败排查利器：失败提示屏显「本地N个账号\[用户名(手机号掩码)]密码\[哈希/明文N字]」诊断行。铁律：**凡依赖启动时序+异步桥的自愈，必须在用户操作路径上再做同步兜底**。

* ★ 2026-08-30 底部快捷栏永久消失（用户实报）：switchMobileTab 统一设内联 `mobileActionBar.style.display='none'`，而 CSS 媒体查询 `display:block` 无 !important 压不过内联——点导航/按返回键切走再回门诊后快捷栏（录像/拍照/保存/清空/改密）消失。修复=case 'prescription' 清空内联样式交还 CSS。铁律：**JS 设过的内联 display:none 要恢复必须显式清空（style.display=''），别指望无 !important 的 CSS 规则接管**。

* ★ 2026-08-31 桌面版一键恢复双故障（用户实测云桌面：备份成功、目录 9 个 json，恢复却报"未找到"+选择器打不开）：①**fs.promises 没有 existsSync**——main.js 顶部 `const fs = require('fs').promises`，而 list-backup-files/read-backup-file 调 `fs.existsSync` 抛 TypeError → handler catch 返回 success:false → 前端 else 误报"未找到备份文件"；save-backup-file 恰用 fse.ensureDirSync 不触发 → "备份成功却找不到"隐蔽分裂。修复=`require('fs').existsSync`（云/离桌面 main.js 各 2 处）。铁律：**fs.promises 只覆盖 promise 化 API（readdir/stat/readFile/writeFile✓），existsSync/accessSync 等同步族不存在，混用静默炸 handler**；后端 handler 返回 {success:false,error} 时前端文案必须显示 error（否则异常被伪装成"无文件"）。②**alert 后 input.click() 打不开文件选择器**——alert 已替换为主进程原生同步 dialog（阻塞 renderer 主线程）→ 用户激活丢失 → Chromium 静默拒绝 FileChooser（需 user activation）。修复=新增 open-backup-picker IPC（主进程 dialog.showOpenDialog + 读文件返回 json，无激活限制），preload 暴露 openBackupPicker，6 份 index.html importDataByFilePicker Electron 环境优先走 IPC，浏览器/APP 路径不变。铁律：**渲染层弹过 alert/confirm（原生同步 dialog）后再触发 input.click() 一律不可靠，桌面版文件选择必须走主进程 dialog IPC**。云桌面命名前缀=「本地\_」（cloud\_desktop index.html exportData fileName 规则），别拿前缀区分是哪个端写的备份。

## 7. 官网付费与激活闭环（现行链路 · 2026-09-12 精简版）

**价格体系（年费订阅，双端独立授权）**：本地标准版 99 元/年（单用户）、本地机构版 299 元/年（3-5 用户）、云端标准版 199 元/年（单用户）、云端机构版 399 元/年（3-5 用户）。桌面/手机激活码独立授权，双端使用需分别购买。试用：免费 7 天，admin/admin 登入，限离线桌面/APP，云端无试用；**内置 admin/admin 仅试用期有效，激活后自动失效**。

**★ 机构版一码多机产品语义（2026-08-30 定稿）**：机构版桌面一个激活码授权 **3-5 台电脑**（默认 5），每台设备管理员通过用户管理添加普通用户（唯一管理员锁死 role=user，**不加硬上限**——加第 6 个也不拦）；离线机构版各台电脑数据独立，云端机构版账号在服务器任意电脑可登。多设备授权框架=license `devices` 数组 + `maxDevices` 1-10 + validate.js 多机校验/换机自动解绑最旧/同码重激活/同设备版本互斥 device_version。**发码默认值下沉服务端**：admin-approve.js 与 activate-from-ticket.js 漏传 maxDevices 时按 type 兜底（pro=5 / personal=2）。铁律：**发码类默认策略必须放服务端按 type 兜底，不能依赖某个前端页面恰好传参——同仓库多入口各自演化，漏传入口就是策略漏洞**。

**付费流程（现行）**：选版本 → 填信息下单（order-submit.js，pending_payment 不进待审列表）→ 扫收款码 → 付款确认（order-paid.js：支付方式+转账单号后6位或 AUTO 自动匹配，转 pending 入待审）→ 后台核对付款信息一键激活 → 客户 order-status.js 30 秒轮询自助领码。

**付款确认双通道**：①普通通道=填转账单号尾 6 位（下载页输入框带「📎尾6」一键暂填订单号末 6 位+「?教程」弹窗）；②自动匹配通道=「✅ 已付款 · 不用填转账单号 · 自动匹配」按钮（txnLast6='AUTO' → KV payTxnLast6='AUTO-MATCH'，后台弹窗显示 4 维核对卡：时间±15min/金额/店名/手机号后4位）。**铁律**：自动匹配≠自动通过，生成激活码永远是人工二次把关；订单量突破 100 单/天需下线 AUTO 入口（同日同 payMethod+同 price ≥5 单即回退）；**AUTO-MATCH 是合法枚举值**，任何消费方不能渲染成"未付款"。

**客户端导引闭环**：客户端激活等待界面/工单成功面板有「去官网付款」导引（→ 官网 `?mid=识别码&ed=版本意图&cn/n/p/wx/r` 自动预填设备识别码+版本+客户信息，自动跳 Step2 显示价格）。admin-status.js 支持 machineId 兜底——客户端轮询自己 requestId 未激活时，扫描最近 200 条找同 machineId 已激活的官网订单返回 activated+license。**铁律：WebView 内 window.open/target=_blank 一律不可靠，外部跳转必须走原生桥（openExternalUrl）+ URL 严格白名单（仅官网 download.html 前缀）**。

**登录框入口全景（现行）**：云端纯网页无入口（设计如此）/云端APP首帧注入/云桌面 login.js 注入/离线APP auth-core 2s 注入/离线桌面 login.html 静态链接。「📝 注册开通」一页式注册已不是任何端登录框入口（openCloudRegister 保留做兜底）。

**收款码防替代**：运行时 SHA-256 校验（两份 download.html 内嵌 PAY_QR_PINS，不匹配隐藏收款码+警告拦截）+ CI 校验（verify-payqr.cjs）。更换收款码：jsQR 验新图域名 → 算新哈希 → 同步 3 文件 4 位置 → CI 绿灯。

**激活自愈四段一致**（重装/换机）：① /api/license/lookup 凭激活码+machineId 返回原激活信息；② validate.js 手机号核验（clientPhone===recordPhone → phoneVerified 放行）；③ showActivateModal 输码 change 自动联网识别填手机号；④ Java activateOnline 透传 phone。**改激活链路必须保持四段一致**。

**邀请码自愈四层一致**：onAdminActivated 存 StorageAdapter('license:code')；Java installAdminLicense 的 licenseCode 参数 JS桥→case→MainActivity→LicenseManager 四层透传；服务端 invite.js machineId 兜底；loadInviteInfo 联网找回。**签名变更时四层参数必须同步**。

### 付款→激活→登录 架构收敛规范（2026-09-03 落地，现行）

**唯一写服务铁律**：所有写端（admin-submit/order-submit/order-paid/admin-approve/admin-cancel/admin-delete/free-pass）**必须经过** `functions/api/license/_lib/license-write-service.js` 5 个原子函数（createAdminRequest / updateAdminRequestStatus / cancelAdminRequest / deleteAdminRequest / markOrderPaid）。**禁止任何云函数直接 KV.put/delete(admin_req: / admin_phone: / admin_req_index / order:)**。管理员侧任何"标记已付款"通道必须复用 markOrderPaid 统一写入口。**KV 派生索引（admin_phone/order 映射）必须随主记录同删同重建——删除类接口要列出该记录写入过的所有 key 逐项清理**。

**客户端统一观察者**：`shared/service/activation-observer.js = ObserveActivationStatus({requestId, machineId, phone, shortCircuitResult, persistPending})`——start() 先三通道 resume（localStorage→IPC→Preferences），再 **0s 立即 poll**，然后才 setInterval(5000)；shortCircuitResult.activated+license → 0s 立即 emit；cancelled+machineId → 自动 fallback 自救；持久化 password 一律加密（ENC: safeStorage 优先 / XORv2: 兜底，加密失败 fail-safe 不存明文）。**铁律：凡异步轮询（setInterval/setTimeout）做关键业务副作用，必须在前置条件满足时（服务端已告知 activated）立即同步执行，禁止依赖 N 秒后调度——首个执行永远是 T+N，窗口被用户操作打断就是永久 bug**。

**桌面 IPC 与断点续传**：双桌面 `license:check-admin-status` 签名对齐 `(requestId, machineId)`；双桌面 main.js app.whenReady() 创建登录窗口前 10s 超时自检（loadAdminRequestId→checkAdminStatus→activated→解密→installLicense→清持久化，失败不阻断）。**铁律：桌面渲染进程 file:// 协议下 fetch 跨域会被 CORS 静默拦截——任何桌面端云端 API 查询（resume/Observer/polling）必须优先走 Electron IPC（_queryAdminStatus 统一通道），fetch 只做兜底**。

### 历史案例铁律速查（过程细节见归档）

- **账户接管 P0 铁律**：凡匿名/未认证接口，仅凭公开标识符（手机号/邮箱/用户名）命中记录后，**禁止执行密码重置/账号创建/权限变更等账号写操作**——必须附加"请求者持有秘密"校验（requestId 持有者或 machineId 归属命中）。license 这类"绑定请求者自身设备"的数据可下发，密码/账号类绝不可。
- **换机安全等级铁律**：换机逻辑能否自动放行，取决于凭证是不是"秘密"——validate.js 凭证是激活码（付费秘密）可自动放行，admin-submit 凭证仅手机号（自报半公开）禁止自动解绑。换机正当路径：客服核验后后台换机解绑 / free_pass 白名单；机构版多机走 Tab2 输同一激活码。
- **运维修复铁律**：已付款客户出现问题**先 KV 取证再动手，禁止删除数据重走流程**（激活记录+admin_phone 索引+order 映射是"已付款复用→自动领码"链路依据）。数据已彻底误删的重建通道=free_pass 免费开通白名单（唯一无需客户再付款的通道）。
- **密码错位修复口径**：多次提交激活表单时生效密码=首次领码成功那一刻的表单密码；客户恢复=试当天填过的密码，不行则卸载重装（machineId 设备级不变）全新建号。"防止覆盖"类保护（keepLocalPwd）设计时必须同时提供确定性重置路径。
- **并行编辑铁律**：同一文件的多个 Edit 必须串行（并行=各基于同一快照，后写覆盖先写静默丢改）；改完必须 grep/read 磁盘验证，禁止只信工具返回的"成功"。
- **明文密码铁律**：涉及明文密码的任何持久化必须先加密并 fail-safe，绝不为断点续传方便明文写磁盘（合规红线）。
- **跳转第三方表单必须携带已填信息**（否则填错即支持成本）；**所有等外部状态的流程要"页面生命周期不唯一"思维**：visibilitychange+focusin+定时三重触发，单次查询永远不够。
- **下载页付款引导文案**要明确"不用留在这里等激活码，回 APP 会自动弹提示"——用户等待不告知就会一直等，等烦了乱点=二次提交=限流=新问题。

### 归档索引（2026-09-12 梳理）

2026-08-30~09-04 付费激活链全部历史过程（CORS 三处修复、换机自动解绑审查回滚、源生堂/Mate 70 七案排障、admin-approve license:undefined P0、付款 URL 参数化、visibility 断点续传、尾6位优化、AUTO 自动匹配上线实测、KV 归零操作规范、明文加密补漏、时序 bug 根治、账户接管 P0、7 写端收敛 P2 迁移细节）已归档至 **`.trae/archive/2026-08-30-09-04-pay-activation-cases.md`**。查根因链/KV 取证命令/客户恢复口径/Commit 号去归档文件。
## 7.5 【收官记录】P2 客户端收敛全部完成（2026-09-03，5 commit：6429939a / dde5a133 / a84ff93c / 4d774342 / 0538e2f5）

### A. 已完成（全部已推送上线）
1. **写端 7/7 API 收敛 ✅ 已推送上线**（6429939a / dde5a133 / a84ff93c，Pages 已部署）：admin-submit / order-submit / order-paid / admin-approve / admin-cancel / admin-delete / free-pass 全部经 `functions/api/license/_lib/license-write-service.js`（8 个原子函数：createAdminRequest / bindOrderToRequest / updateAdminRequestStatus(alreadyLicensed 去重) / cancelAdminRequest / deleteAdminRequest / markOrderPaid / upsertFreePass / removeFreePass / listFreePass）。线上冒烟 6 路由 400/403 无 500 ✓。
2. **客户端双端激活三入口委托 ActivationObserver ✅ 已推送（4d774342）+ 浏览器运行时验证 PASS**：线上 `window.ObserveActivationStatus` 为 function、0s 首次 poll 实测通过（node --check 覆盖不了的 prepend 顺序已线上实证）：
   - `shared/auth-core/offline.js`：L3488-3492 加 pollTimer/pollCount/currentActivationObserver 变量；L4099-4186 submit 成功分支改为「Observer 存在→统一走（三通道持久化+shortCircuitResult 立即领码+5s 轮询）；Observer 未加载→退旧 3 段代码兼容」；L4163-4244 startPolling 改为 Observer 委托外壳（0s 立即 poll、machineId fallback 自救、fetchAdminStatus 走 IPC/直连分流）。resumeAdminPendingRequest 保留原实现兜底（Observer 内部也有三通道 resume）。
   - `shared/auth-core/cloud.js`：完全对称改动（L3246-3249 / L3799-3885 / L3907-3982）。
   - `shared/service/activation-observer.js`：L269-296 _pollOnce 增加 opts.fetchAdminStatus 注入点（桌面 CORS 铁律：渲染进程 file:// 必须 IPC）。
3. **sync-auth-core.ps1 prepend 机制 ✅**：Observer 代码以文件头前置方式拼进 11 份 auth-core.js 副本（0 HTML 改动，绕开"禁止改 HTML 结构"铁律）；VerifyOnly 模式同样构建 prepend 临时文件对比（否则 pre-push 卡死）。**已运行 sync：11 副本 SYNC ✓，node --check 全 0 ✓，VerifyOnly ✓，sync-all ✓，check-interface 6 OK ✓**。
4. `app_project/db-yunduan/cloud_desktop/electron/` activate.js（checkAdminStatus 双参+cancelled 自救）与 main.js（IPC 双参对齐+启动断点续传）在 P1 commit 已推送。

### B. P2 登录统一路由 ✅ 已完成推送（0538e2f5，2026-09-03）
1. **loginWithUsernamePassword 四处收敛 ✅**：`shared/auth-core/cloud.js` + `offline.js` 权威源新增统一路由函数（用户名/手机号双匹配 + 密码多盐兼容验证 + cloud 选项控制云端回退）；`public/index.html` handleLogin、离线 `index-app.html`、双桌面 login.js（离线 users 本地数组 / 云端 users+cloud:true）全部改为 `AuthCore.loginWithUsernamePassword` 单点调用；鸿蒙 rawfile index.html 手工对齐。11 份 auth-core 副本经 sync-auth-core.ps1 同步（prepend Observer 保留），check-interface 6 OK + sync-all VerifyOnly 全绿 + node --check 全过 + pre-push 三道门通过。
2. **剩余唯一待办 = 各端打包**：离线桌面 / 离线 APP / 云端桌面 / 云端 APP / 鸿蒙需各自重打包才会带上 Observer + 登录统一路由（云端网页随 Pages 部署即刻生效）。
3. **★ 2026-09-09（2069f13d）补丁——路由收敛后仍有"上游剥字段"盲区**：用户实测离线桌面"手机号注册→改名→手机号无法登录"。根因≠统一路由（其 phone 匹配正确），而是**喂给路由的用户数组在更早一层就被剥掉了 phone**：双桌面 login.js `normalizeUser` 只保留 username/password/name/role 四字段（config 源 + localStorage 源 + 登录成功回写镜像三处全过它），shared/user-store.js `getDefaultUsers` 同病。教训：**字段保真链路审计 = 从持久化源头到认证入口逐跳检查字段是否随行**，新增"phone/别名类登录凭证"功能时，任何 `map(u => ({...精选字段}))` 的规范化函数都是嫌疑点；改名回填（8-26 修复）写对了 config.json，但登录窗读数时又把它洗掉了。修法=三处 normalize/getDefault 补 `phone: u.phone || ''` + sync-shared-blocks 同步 7 副本。桌面端密码哈希=全局盐（bnzc_prescription_salt_v1），verifyPassword 全局盐回退链天然兼容，无需动 auth-core。

### C. 本会话踩坑（必须传承）
1. **★ Edit 工具改 .ps1/.bat 会剥 UTF-8 BOM**：中文注释的 UTF-8 文件无 BOM 时 Windows PowerShell 5.1 按 GBK 读 → 中文双字节吞掉后续 ASCII 括号/花括号 → "Missing closing ')' " 解析错（报错行号是误导，实际错在文件头编码）。**修法：编辑 .ps1 后立即执行**：
   ```powershell
   $p="tools\xxx.ps1"; $c=[IO.File]::ReadAllText($p,[Text.UTF8Encoding]::new($false)); [IO.File]::WriteAllText((Resolve-Path $p),$c,[Text.UTF8Encoding]::new($true))
   ```
   再用 `Parser::ParseFile` 验证。本会话 sync-auth-core.ps1 踩过 2 次。
2. **sync-auth-core VerifyOnly 必须与 Sync 同构**：verify 若用"纯源"对比"prepend 后目标"→ 永远 DIFF → pre-push 三道校验失败。已修（verify 也构建 prepend 临时文件）。
3. `pollTimer = 0` 伪句柄：Observer 委托后旧代码 `clearInterval(pollTimer)` 调用处仍安全（clearInterval 对非 timer 值不抛错）。
4. auth-core 副本里 Observer 在文件头 IIFE 执行、auth-core 主体在其后 → 同一 `<script>` 内顺序执行，`window.ObserveActivationStatus` 在主体运行前已定义。offline/cloud 内取用写法：`global.ObserveActivationStatus || (global.window && global.window.ObserveActivationStatus)`。
5. 服务端 free-pass list 上限 500；upsert 保留原 addedAt/addedBy 不覆盖。

### D. 关键坐标（复用）
- 线上 https://tcm-prescription-system.pages.dev；KV namespace b1ab3e4b683341958cef369fcbf94933
- Mate 70 复现用户：15109308569 / machineId 77a6ccd7869f63059a1e48306fa8b962 / REQ-0MTL9X5KD-CD54
- 服务端写服务：functions/api/license/_lib/license-write-service.js（唯一写层）
- 客户端观察者：shared/service/activation-observer.js（经 sync-auth-core.ps1 prepend 进 11 副本）

★ 2026-09-04（十二）激活审核通过后仍显示「需管理员激活」P0 —— 自助注册诊所 status=test 被登录闸门 403（华为 P40 / 后续多客户）。**现象**=客户自助注册「管理员激活」申请 → 管理员审核通过 license 已签发 → 客户端重启直接登录，users.js 返回 403 PENDING_APPROVAL → 前端强制拉回"需管理员激活"弹窗=客户感知"激活后登不上，再激活再通过=死循环"。**根因**=自助注册 provisionCloudAccount 新建诊所 status=test；管理员 admin-approve 审核通过命中已有同名诊所分支时，旧代码只补 edition+offlineCarrier，**不碰 status** → 诊所永远停在 test → users.js L1319 闸门 `clinic.status==='test'` 打 403。**双路修复（Commit 20c94216 + 客户端自愈）**：①provisionCloudAccount 已有同名诊所分支强制 status 升级：条件 `!=='active'`（test 与 disabled 都升级）→ 写 `status='active'` + `updatedAt=now` + clinicsDirty + console.log 证据链；②客户端 admin-status activated 分支无条件调 provisionCloudAccount（L150）→ 就算审核通过时的函数版本还是旧代码，客户端每 5 秒轮询 admin-status 时 provisionCloudAccount 仍会自愈。**生效方式**：后端函数随 git push Pages **自动部署即刻生效**（云端 APP/云端桌面/离线 APP 客户端**无需重打包**）。

★ 2026-09-04（十三）官网付款确认后提示框植入位置 P2 + 激活成功后双 alert 强提示。**现象**=客户付款后点内嵌 Step3 表单提交 → 提示框（绿框）仍插在 Step3 下方，但 Step3 被 `display:none` 切走 → 客户看不到提示 → 误以为没提交成功/要等激活码；另：付款成功+激活成功后没挡在最前面的强提示，客户依旧停留官网 = 切回 APP 关闭窗口又不知要重启。**修复（Commit dae59afb，两份 download.html 镜像）**：①提示框插入顺序=先 `goStep(4)` → 再 `orderStatusBox.parentNode insertBefore` → 兜底 Step4 firstChild → 再兜底 body（三层可见区兜底）；②付款提交成功后立刻弹 alert（全局守卫 `__payFinishAlertDone` 幂等）"✅ 付款信息已登记成功！请现在就回到惠康中医客户端……"；③激活生成成功后弹第二个 alert（守卫 `__activatedAlertDone` 幂等），云端版追加「登录账号：手机号 / 初始密码 admin」。**生效方式**：官网 2 份镜像随 Pages push **自动部署即刻生效**（纯前端 H5，客户端零改动）。

★ 2026-09-04（十四）离线 APP 激活成功后"重启后依旧要管理员激活"死循环加固（华为 P40，Commit 11c7cb73，P0 三级防线）。**根因链**：①Java 层 installAdminLicense 写入后自验 validateLicense 返回 invalid（license.dat 写入格式/损坏/权限/机型差异）→ 旧代码只加 warning 不影响 `result.success=true` → **Bridge 把 success=true 返回给 JS**；②JS 层走 "✅ 激活成功" 分支；③客户（或 APP 自动）重启 → Java 层冷启动再 validate 还是 invalid → 弹原生"前往激活"窗口 → 客户以为没激活 → 再激活 → 审核通过 → 回到 ①。**三层加固缺口对齐策略**（不跨层大修，按 KNOWLEDGE §2.4）：**第一层 Java 覆盖** [MainActivity.installAdminLicense](file:///d:/trae_projects/kyt-zy/app_project/db-offline/app/app/src/main/java/com/benneng/pres/MainActivity.java#L2482-L2499) 自验失败时强制 `result.put("success", false)` + 注入 error/verifyType/verifyDetail 三字段 + return；**第二层 JS 再自验** offline.js onAdminActivated 安装完成后立即 `electronAPI.license.validate()` → `ok = inst.success && selfVerified`（双层与）；**第三层自动重启兜底** → 成功页 setTimeout 1.5s 自动 restart + 按钮文案改「🔄 立即重启」，消除小白用户"激活成功忘了重启=回到 Java 层 invalid"。同步与同构：断点续传 `_resumeCompleteActivation` 同样做 JS 自验，不另写一套。**生效方式**：后端 API 无改动；客户端 auth-core offline.js 3 份离线副本已随 sync-auth-core 全同步；→ **离线 APP/离线桌面 exe 需重打包** 新包才生效（旧 APP 仍会走旧 success=true 漏覆盖路径），华为 P40 客户必须**彻底卸载重装（勾清除数据）** 清旧 license.dat 残留。

## 7.6 【铁律 §7.6】离线 APP/桌面 注册→付款→激活→登录 架构永久约束（5 条铁律，Commit 140d301e + 140d301e-Patch2，Phase 1+2 架构重构）

### 条目十九（架构铁律 1-5 · 下次打开项目自动遵循，不可违背）
**铁律 1 · Single-Writer 纯镜像（用户账号源只有 Java config.json）**：
- 权威写层=Java `LicenseManager.syncCreateActivationUser` → 写 `filesDir/config.json:users[]`（离线 APP/桌面）。
- 前端 `localStorage:local_systemUsers` 是**纯只读镜像层**；桥 `getActivationUsers` 回调做 UPSERT 同步时，**参数 `keepLocalPwd` 永远强制设为 false**（不能"保护"用户改过的 localStorage 哈希——用户真要改密码只能通过正式"修改密码接口→写回 Java config.json"的正式路径，否则 Single-Writer 被破坏）。
- 验收：`keepLocalPwd=true` 在任何 addLocalActivationUser 调用处=违规。

**铁律 2 · UPSERT Always（exists=true 时强制覆盖写最新）**：
- Java `syncCreateActivationUser` 命中 exists=true 时，**必须 UPSERT 强制覆盖 password/phone/name/role + lastPwdUpdatedAt + updatedAt = System.currentTimeMillis()**。绝对禁止 `if (exists) return;`（只 INSERT 不 UPDATE=永远保留客户首次自设的旧密码=断点续传后客户改的新密码永不生效=死锁三阶）。
- 前端 UPSERT 同步时比较 `__lastT = max(桥返回时间戳, localStorage.lastPwdUpdatedAt)`；时间戳方向=新→强制覆盖（双保险，未来即使 keepLocalPwd 回归也不会乱序）。

**铁律 3 · 密码哈希成功-only（失败分支 NEVER 写 hashPassword）**：
- `ensurePasswordsHashed` 可以诊断计算哈希，但**只能用于 console 显示/调试输出**，禁止把计算出的哈希回写 `local_systemUsers[idx].password`。
- **唯一允许写哈希的代码路径**=认证成功分支（`loginWithUsernamePassword` 成功 return 前）：`hashPassword(plain) + saveUsers(user)`；失败分支仅诊断、不写本地用户数组。
- 验收：任何 `saveUsers(users)` 调用点在登录失败路径=违规。

**铁律 4 · ReadyPromise 统一闸门（登录竞态 100% 消灭）**：
- 启动 `startLicenseCheck` 首步挂全局 `__activationUsersReadyPromise = getActivationUsers().catch(()=>null)`（无桥环境立即 resolve）；
- **唯一认证入口 `AuthCore.loginWithUsernamePassword` 函数最开头（第 1 行代码）** 必须 `await Promise.resolve(global.__activationUsersReadyPromise || Promise.resolve())` 闸门。
- 所有 HTML 表单 submit / 桌面端 login.js / 旧封装全部走 `AuthCore.loginWithUsernamePassword` = 单一闸门统一挡"启动 <30ms 手速竞态=只有 admin 登不上"。

**铁律 5 · FSM v2 单状态源（激活状态零漂移）**：
- 激活状态唯一权威读=`window.__getLicenseStateV2()`、唯一写=`window.__setStateV2(nextState, meta)`（localStorage key `license:state:v2`，6 状态机：`unactivated | pending_payment | pending_approval | activated_installing | activated_ready | expired_disabled`）。
- **旧 5 处分散读（resumeAdminPendingRequest/checkLicense/admin-status 轮询/activateModal/激活成功清 pending）永不删除**（向后兼容零回归）。
- 所有新节点（admin-submit 成功 / onAdminActivated 开头 / onAdminActivated 成功 / _resumeCompleteActivation 收尾 / checkLicense 结果）**必须同步 setStateV2**，保证 v2 与旧分散键一致=未来新诊断只看 v2 单权威，不被旧 5 键漂移误导。

### 条目二十（验收矩阵 · 5 类真实验收场景必须 100% 绿）
**客户 13398628216 行为矩阵（架构重构前🟥🟧，现在应全🟩）**：
| # | 场景 | 前置 | 期望结果 | 铁律守护 |
|---|---|---|---|---|
| A | 填错密码 N 次（错误明文自动变哈希） | 激活成功后，登录时故意填 10 次错误密码 | 桥自愈 UPSERT（从 Java config.json 读最新正确明文密码）→ keepLocalPwd=false 强制覆盖 → 输入正确明文一次登录成功 | 铁律1 + 铁律3 |
| B | 激活弹窗/断点续传改密码（多次重激活） | 首次激活→点"重新激活/审核未通过重新提交"→**在激活窗口改设新密码**→审核通过 | Java UPSERT 覆盖 exists=true 旧密码 → 桥同步 UPSERT localStorage → ReadyPromise 闸门 → 输入新密码一次登录成功 | 铁律2 + 铁律4 |
| C | 杀 APP 后台重开（断点续传） | 提交激活→杀 APP 后台→重开 APP | FSM v2 migrate：旧 `license:adminReqPending`→`pending_approval`（无损）→ resumeAdminPendingRequest 轮询 → 激活成功 SET_READY，可直接登录 | 铁律5 |
| D | 用户手速竞态（启动 10ms 就点登录） | 重开 APP 立即点击登录（<30ms，桥自愈 UPSERT 回调还没到） | ReadyPromise 闸门挡在 AuthCore 认证开头 → 等 getActivationUsers Promise 完（UPSERT 同步完手机号账号）再比对密码 → 正确登录 | 铁律4 |
| E | 卸载重装（清所有数据） | 彻底卸载重装勾清除数据→重开 APP | 断点续传读取 adminReqPending → admin-status activated → onAdminActivated SET_INSTALLING → installAdminLicense 成功 UPSERT → SET_READY → 输入激活密码一次成功（以后 A-D 场景都不会再锁死） | 铁律1+2+4+5 |
**验收指令**：用离线 APP/桌面真机跑 5 场景，A-D 连续 3 次全部一次登录成功=通过；E 每次通过=架构闭环。

### 条目廿一（FSM v2 迁移规则 · 新代码只写 setStateV2 节点）
1. **迁移幂等**：启动 `_migrateLicenseStateV1ToV2()` 读取以下旧键无损映射——`license:adminReqPending→pending_approval`；`license:activatedDoneFlag=true→activated_ready`；`license:validateResult.invalid & expired/disabled→expired_disabled`；否则→unactivated。迁移完成后 `prevState=migrate:yes` 写 meta，后续启动 detect v2 存在直接跳过（幂等 0 副作用）。
2. **节点同步清单（现在已补齐）**：
   - ✅ admin-submit 成功→SET(PENDING_APPROVAL, {requestId, phone, ts})
   - ✅ order-paid 成功（order-submit order-paid 流程）→SET(PENDING_PAYMENT, {orderId})
   - ✅ onAdminActivated 函数开头→SET(ACTIVATED_INSTALLING, {requestId, licenseMessage})
   - ✅ onAdminActivated 成功分支（清 adminReqPending 之后）→SET(ACTIVATED_READY, {activatedAt})
   - ✅ _resumeCompleteActivation 收尾→installed ? SET(ACTIVATED_READY) : (INST/PENDING_APP→SET(UNACTIVATED, {lastError}))
   - ✅ checkLicenseAndShowActivate result.valid→非 pending_*→SET(ACTIVATED_READY)；result.valid=false & expired/disabled→SET(EXPIRED_DISABLED, {expireReason})
3. **禁止状态直接写 localStorage**：任何新代码只能 `__setStateV2(next, meta)`，不能 `StorageAdapter.setItem('license:state:v2', rawStr)`=破坏 reducer 元数据链。
4. **向后兼容**：旧代码 `StorageAdapter.getItem('license:adminReqPending')` / old 5 处分散读**永不删除**，直到全链路（APP/桌面/鸿蒙/云端）100% 切换到 v2 ≥1 个月后才可制定删除计划。
5. **调试入口**：开发者控制台 `window.__getLicenseStateV2()` 实时查看 state/meta；`window.__setStateV2('unactivated')`（测试迁移）。

★ 2026-09-04（十九）【方案B · 注册前置架构】现行总纲（离线 APP/桌面「先注册 → 后激活」，账号创建与激活彻底解耦）：**注册 = 本地建号（唯一密码写点）→ 试用/登录 → 激活 = 纯 license 安装（永不碰密码）**。出厂默认 admin 从"登录入口"降级为"待清理的幽灵数据"。五条现行规则：

1. **密码写点唯一化（取代条目十九·铁律2"激活 UPSERT 强制覆盖密码"——适用前提"账号由激活流程创建"已不存在）**：密码全链路仅 **3 个合法写点**（① `registerLocalUser` 注册 ② 修改密码正式接口 ③ 账号不存在时激活收尾兜底建号，LicenseManager.java L3754 注释即此清单）；`syncCreateActivationUser` exists 分支**密码保留**（只在空时补，绝不覆盖、不刷 lastPwdUpdatedAt）。验收：激活链路任何位置"无条件写 password"=违规。
2. **注册入口（auth-core 运行时注入，0 HTML 改动）**：`showLocalRegisterModal()` 收集诊所名/医师名/11 位手机号/密码（≥8 位含字母+数字，禁用 admin）；注册信息加密存 `localStorage:license:registrationInfo`；双端桥=APP Java `registerLocalUser`（LicenseManager L3643）+ 桌面 IPC `license:register-local-user`（main.js L2712）。登录框入口动态切换（`injectLoginEntry`）：本地桥+未激活+未注册→"📝 注册开通"，否则→"管理员激活"。
3. **幽灵 admin 双保险**：① 两个 local adapter 的 `authenticate` 均拦截 `admin/admin`（未注册→"请先完成注册"；已注册→"内置默认账户已停用，请使用注册的手机号登录"）；② 注册后物理移除仅当 password 为明文 'admin' 或出厂哈希 `2f1e152d…`（sha256('bnzc_prescription_salt_v1'+'admin')，与出厂 config.json 一致；宁可漏删不可误删）。
4. **激活流程适配（已注册用户零重复输入）**：激活 Tab1 表单用 `license:registrationInfo` 预填诊所名/医师名/手机号；手机号与注册一致时**跳过密码步骤**（自动填两个密码框后自动提交）。注册状态判定 `isLocalRegisteredAsync` 双源：localStorage 注册信息 ∪ 桥 config.json 已有手机号账号（升级设备场景）。
5. **新装机 SOP**：首次启动 → "注册开通" → 填诊所/医师/手机号/密码 → 登录试用 → 需正式使用时走管理员激活（表单已预填，密码步骤自动跳过）。

### 条目廿三（2026-09-15 已激活设备换号提交 → 同设备已激活短路）
**现象**：已激活机器码换新手机号重新注册→提交激活→**先跳付款页，随后又提示"已激活"**（跳变困惑 + 已建订单存在重复付款风险）。
**根因**：已激活短路口径不齐——order-submit/admin-submit 只按**手机号**查已激活记录（换号场景查不到→建单付款页），而 admin-status 轮询/断点续传带 **machineId 兜底扫描**会命中本机旧授权→返回 activated→客户端装码提示已激活。两套正常机制（防重复购买 vs 重装自愈闭环）口径不一致导致中间态矛盾。
**修复**（order-submit.js / admin-submit.js 各加一块，均按 machineId 扫描 admin_req_index 前 200 条，口径对齐 admin-status 兜底）：
1. order-submit：手机号短路之后、checkDeviceVersion 之前 → 命中返回 `status:'activated'`（客户端 auth-core 既有 activated 短路处理直接桥装码收尾，全程无付款页）。
2. admin-submit：手机号短路之后、支付前置校验之前 → 命中返回 `status:'activated' + license`（桌面端走等待轮询→admin-status 装码）。
**★ 安全铁律（机器码维度短路的账号操作禁区）**：机器码是客户端自报参数（不可信），扫描命中的是**旧手机号**记录——**绝不做 provisionCloudAccount/normalizeActivationPassword 等账号操作**（会重置旧号密码=匿名接管，违反 2026-09-03 P0 决策）；仅可返回 activated+license（license 绑定 machineId，他机验签必失败）。admin-submit 版本短路出口必须过 getDeviceBlock（封锁设备不下发）+ ensureLicenseV7（重签自愈）。
**语义**：已激活设备换号提交 = 本机已有有效授权，无需购买；纯服务端修复（CF Pages Functions）全端立即生效，无需热包/重打包。

**★ 收尾三缺口（同日补全，服务端短路返回后各端对 activated 响应的处理必须逐一核对）**：
1. **官网 Step2（public/download.html + site-official 双副本镜像）**：原只判 `data.success` → 短路响应被当建单成功 → toast"请扫码付款"+跳 Step3 付款页 = 重复付款诱导。补 `data.status==='activated'` 分支：绿色提示框"本机已有有效授权，无需重复购买"，不进 Step3、不轮询。
2. **云端 orderFlow（cloud.js → 8 副本）**：trySubmitDirectOrder 后无 activated 短路处理 → 照走 adminWaiting 付款等待。补：activated 无 license → 立即凭 requestId 查 admin-status 领码收尾，失败退轮询。
3. **云桌面激活窗口（electron/activate-window.html asar 层）**：原 `saveAndRestart(res.license||'')` 会把空 license 落盘（order-submit 短路不带 license）。补：有 license 直接装码；无 license → showWaiting+轮询领码（admin-status 对旧 activated 记录正常下发）。
**发布链**：服务端+官网+cloud.js 副本 push（cv 门会拦 auth-core 的 cv 漂移 → `check-cv-hashes.cjs --update` + `sync-html.ps1` 重推）→ 云桌面热包 `-c cloud -n 3`（auth-core 短路收尾）→ 云桌面重打包（activate-window asar 层）。离线端不受本轮影响（offline.js 无改动，auth-core 内容未变无需重发热包）。

### 条目廿二（2026-09-15 试用到期直通 · 版本页手机号=直通开关）
**背景**：试用到期用户反馈激活仍要填"注册开通信息"表单。试用/存量未注册用户本地已有诊所名+医师姓名（试用期设置过），唯一缺口是手机号。
**方案（APP `shared/auth-core/offline.js` 弹窗 + 桌面 `electron/activate-window.html` 激活窗口，双端同款）**：
1. 版本选择页新增联系电话输入框（`editionPhone`）；手机号有效 + 点版本卡 = 自动补齐表单（诊所名/医师姓名本地预存、手机号带过去）→ 标记直通 → 复用标准校验收集链路直接提交 → 直建订单直达付款页。手机号留空/无效 = 原表单流程零影响（激活码/工单路径不变）。
2. 密码语义（对齐方案B先例）：已注册用户（表单手机号=注册手机号）直通用注册密码（现场等解密 1.5s race 兜底，未就绪退回表单走「下一步」方案B）；未注册（试用到期）密码留空 → APP 端提交 payload `password:''`（服务端默认 admin）+ 桌面端 submitBtn `pwdRaw||'admin'` 归一。
3. 本地诊所名/医师姓名缺失时：落入表单补填（手机号已带上，缺失字段标红）——绝不提交空值。
4. 直通标记一次性消费（消费即清），校验失败/付款返回重试不误直通。

**★ 分层生效矩阵（本次新沉淀，改激活链路必查）**：
| 载体 | 文件 | 生效方式 |
|---|---|---|
| 离线APP 弹窗 | auth-core.js（11 副本协议） | APP 热包即覆盖（288-292 全装机） |
| 桌面·主窗口弹窗（登录后只读横幅入口） | `db-offline/desktop/auth-core.js` | 桌面热包可覆盖（在清单） |
| 桌面·独立激活窗口（试用到期主链路：main.js→activate.js→`path.join(__dirname,'activate-window.html')`） | `db-offline/desktop/electron/activate-window.html` | **asar 层不在热包清单且主进程直接 loadFile——必须重打安装包**（build-skip 会因 electron/ 目录变化正确识别） |
| 桌面·登录窗口 | `electron/auth-core.js` + login.html | 同上 asar 层，重打包生效 |

**发布 SOP（激活类改动）**：commit 源码 → `generate-app-hotupdate.cjs -n N` + `generate-desktop-hotupdate.cjs -c local -n M` → commit+push（CF Pages 自动部署）→ 桌面 asar 层改动跑 `one-click-pack.ps1 -AutoMode 2d`（单打本地桌面，APP 已热包覆盖无需重打 APK）。

### 历史过程归档索引（2026-09-12 梳理）

★ 2026-09-04~09-06 激活/登录架构的全部过程记录（AR-01~03 审查修复、交接备忘、方案B 发布闭环与独立审核、E2E 补全、试用只读模式、原生领码自愈、条目十三回归事故、同族门控、数据治理 30 条）已归档至 **`.trae/archive/2026-09-04-06-offline-activation-arch-log.md`**。其中铁律已固化进 `tools/probe-param-matrix.cjs` 断言库（19 断言）与 sync-all/copy-consistency 门禁，主文件不再保留过程性重复；查历史根因链/验证过程/Commit 号去归档文件。**跨条目通用教训摘录（高频复用）**：

- **弹窗闭包变量=快照**：`showXxxModal` 初始化时读的数据源在弹窗存活期间不会自动刷新，"先开弹窗再改数据"的链路必须在弹窗内重新读。
- **auth-core 运行时注入**凡按 `loginOverlay` 定位登录框的，必须同时处理桌面登录窗（特征=有 `btnOk` 无 `loginOverlay`）。
- **"服务端已知状态+本地缺件"的修复责任必须放原生层**（Java/主进程），JS WebView 只能做快路径。
- **恢复类功能（服务端状态→本地落盘）必须穷举全部落盘路径逐条门控**（Tab1 轮询/断点续传/自愈/原生 sync），防服务器残留劫持全新安装。
- **删除聚合根（诊所）必须枚举所有指向它的旁路引用**（激活申请/索引/订单映射/在线会话），"删除"是全生命周期操作。
- **桥方法清单对齐审计**：桌面 preload.js 每个 electronAPI 方法，安卓 shim 必须同名同参数同语义。
- **"版本号一致"≠"安装包一致"**：同 versionCode 多次打包靠 build-meta.js buildSeq 区分批次。
- **wrangler KV 删除后立即 get 复核可能仍返回旧值**（边缘延迟 1 分钟内），复核失败≠删除失败。
- **异步预填（解密/桥调用）必须存 Promise 让消费点可 await**，纯 fire-and-forget `.then()` 赋值必踩竞态。
★ 2026-09-14（二十一）**【离线端在线统计归零根治】后台诊所管理「在线：🖥️桌面 X · 📱APP X」离线端恒 0**：客户反馈「惠康康中医诊所 离线APP已在线，后台显示 桌面 0 · APP 0 · 网页 0」。根因三叠加：①users.js 在线统计唯一口径 = `user_session`（云端登录会话，loginAt ≤15min 计在线）——**离线端本地登录不写 user_session，永远不计入**；②客户端心跳 24h 一次且无定时器（仅启动/激活触发一次）；③服务端 heartbeat 对 lastHeartbeat 7 天节流落库且顶层字段不区分设备。修复（服务端 push 即生效 + 客户端走热包）：**①heartbeat.js**——`devices[].lastHeartbeat` 设备级心跳时间戳**每次无条件刷新**（在线口径唯一数据源），与端形态变更合并为一次 updateLicense（减少 KV 写）；心跳审计日志仍 7 天一条控写放大；心跳限流 30/h→**120/h**（10 分钟周期下单台 6 次/h，多设备诊所共用出口 IP 原额度必误 429）。**②users.js**（clinics 列表）——新增 offlineOnlineMap：`listAllKeys(kv,'license:')` 批量读（20/批并行），status=**'used'** 的记录取 devices[].lastHeartbeat ≤15 分钟计在线，clientClass 分桶 desktop/app（未知兜底桌面），按 clinicName 归诊所；与 user_session 口径零重叠（云端端 cloud.js 链路不调 /api/license/heartbeat）。**③offline.js（权威源+sync-auth-core 3 副本）**——心跳周期 24h→**10min**；请求体显式上报 `productClass:'offline' + clientClass`（Capacitor=app / electronAPI.activate 桥=desktop，与 collectDeviceIdentity 同口径，服务端权威覆盖写 devices 元数据）；新增 `startHeartbeatTimer()` 10 分钟定时器（startLicenseCheck 启动接线，performHeartbeatCheck 内部自门控未激活零副作用）——**无定时器是旧版在线秒归零的直接原因**。坑：**license 已激活状态值是 'used' 不是 'activated'**（'activated' 是 admin_req 激活申请域的状态值）——过滤条件写错会漏掉全部离线诊所在线数据。生效方式：服务端 + 管理后台 push 即部署——旧客户端（24h 心跳）从每次启动/每日心跳后 15 分钟窗口内可见在线（过渡态）；**持续在线需客户端送达**：离线APP/离线桌面 auth-core.js 均在双端热更清单内（generate-app-hotupdate / generate-desktop-hotupdate），发热包 + push 即静默送达（下次启动生效，无需重打包 APK/exe）；云端四端不涉及（在线统计走 user_session 原口径）。写量评估：20 台活跃设备 × 6 次/h ≈ 1.2k KV 写/天，付费额度内。

★ 2026-09-14（二十二）**【在线统计端到端实测打通 + 端形态误报 web 事故修复】**：热包 -5 送达惠康康 APP 后 19:33 心跳成功写入 devices[].lastHeartbeat（服务端修复部署实证 ✓，后台诊所管理当即可见在线）——但**客户端判据在离线 APP 上误报 clientClass='web'**，权威覆盖冲掉原 app 标记（📱 误入 🖥️ 桶）。根因：离线 APP 虽是 Capacitor BridgeActivity，但页面在 file://（含热更目录）上下文实测 **window.Capacitor 不存在**；APP 桥 electronAPI.activate 又无桌面独有的 showExpireAlert → 判据链落到 'web' 兜底。修复（热包 -6 / desktop-local -3）：**①客户端（offline.js）**——APP 判据改用 `window.AndroidNative`（MainActivity addJavascriptInterface 注册，WebView 级接口任何页面加载路径恒存在，含热更 file:// 页）或 Capacitor；桌面保持 showExpireAlert；**判据不确定时省略 clientClass 字段绝不推 'web'**（body 用 Object.assign 条件拼装）；**②服务端（heartbeat.js）**——显式上报改**按字段覆盖**：仅覆盖客户端明确上报的字段，省略字段绝不清空已有值（防部分上报把 clientClass 冲成 null/错值）。KV 已污染的 clientClass='web' 无需手工修：-6 送达后下一次显式 'app' 上报自动纠正（权威覆盖正向利用）。铁律：**①端形态判据必须用「目标环境恒存在且他端恒不存在」的桥对象——WebView 环境 Capacitor 注入不可依赖（加载路径相关），addJavascriptInterface 对象才恒定；②显式权威覆盖协议下「不确定就省略」——错报（覆盖掉正确值）比漏报（保留原值+嗅探补空）危害大一个量级；③部分字段上报必须配按字段覆盖的服务端语义，否则省略字段=清空字段**。生效：服务端 push 即部署；客户端热包 app-local 2026.09.14-6（minAppCode 288）+ desktop/local 2026.09.14-3 随 push 静默送达，重启两次后生效。**✓ 端到端实测闭环（2026-09-14 20:37）**：APK289 手机重启两次后 -6 生效，KV 中 clientClass web→app 自愈（AndroidNative 判据上报），后台诊所管理正确显示「📱APP 1」——服务端时间戳→热包送达→端形态纠正→后台分桶全链路验证通过；注意 wrangler OAuth token 有效期 1h，诊断脚本读 KV 报 401/空记录时先 `npx wrangler whoami` 刷新再查。

★ 2026-09-14（二十）**【平台校验三阶段计划·阶段1已落地】claim 端形态上报语义修正 + 双端授权漏洞定性**：评估「桌面/手机激活码独立授权，双端使用需分别购买」定价规则的技术执行现状——**validate.js 对 productClass/clientClass 只记录不校验（L468-488 仅 devices 元数据），同一码可跨桌面/APP 激活白嫖双端**（线上实证 BNZC-Y6TT 同码挂 desktop+app）。三阶段方案：①语义修正（已做）②服务端观察模式（记日志不拦截，量化跨端频率）③硬拦截（需客户端补标识+重打包）。**阶段1实修 3 处 clientClass 值 'app' 错填 productClass 域**（污染 KV devices 元数据/后台「类型」列/heartbeat 嗅探难补）：offline.js 离线APP直连claim→`productClass:'offline'+clientClass:'app'`、offline.js 云端APP分支→`'cloud'+'app'`、cloud.js 云端APP claim→`'cloud'+'app'`；sync-auth-core 11 副本全同步 + 重发 app-local 热包 2026.09.14-4。**claim 链路端标识现状备忘（阶段3清单）**：JS 直连路径已修正上报✓；桌面主进程 activate.js（submit→claim）与离线APP Java activateOnline（LicenseManager L3838 请求体）**均不发端标识**——硬拦截前必须补齐（APP 需 versionCode≥289 重打包、桌面需重打包）；发码侧仅 admin-approve 路径写 devices[0].clientClass（源自申请 appModeCarrier），generate.js 手动发码无载体字段。生效方式：离线APP（≥288）热更自动下发下次启动生效；云端网页/site-admin push 即生效；云桌面/离线桌面/云端APP 随下次重打包；服务端零部署影响。**★ 阶段2 已落地（2026-09-14 同日）**：validate.js 新增 **platform-mismatch-observed** 日志事件（位置后经阶段3轮修正为激活写操作之前，见下）——判定：请求端 clientClass 存在 && 已绑定设备**任一**端形态存在且与请求端不一致 → 记日志放行不拦截（较方案初稿 devices[0] 更严：多设备码不漏报，且与阶段3硬拦截判定语义完全一致，切换零改判）；**错位存量归一**：productClass==='app' 的历史错位记录映射为 clientClass='app' 参与比对（与 heartbeat 兜底同源容忍）；**存量回填**：existingDevice 同设备重激活时空形态补空（仅补空不覆盖，与 heartbeat 嗅探同语义），加速阶段3覆盖率积累；桌面请求当前不带 clientClass → 三条件不满足不记录（数据不足不误报，桌面补发属阶段3）。观察数据查看：后台 license 日志（license_log:{code}）按 action=platform-mismatch-observed 过滤。单测 tools/_tmp/test-platform-observe.mjs **21/21**（触发 10 + 负向 6 + 回填 5）+ 回归 device-block 15/15、ensure-v7 10/10。**★ 阶段3准备已落地（2026-09-14 同日第二轮）**：①**客户端 3 处补发端标识**——离线桌面 activate.js（`productClass:'offline'+clientClass:'desktop'`）、云桌面 activate.js（`'cloud'+'desktop'`）、离线APP Java LicenseManager activateOnline L3838 reqBody（`"offline"+"app"`，Java 热更覆盖不到须随下个整包 versionCode 发版）；auth-core JS 直连 3 处阶段1已修，**全部 6 处激活入口标识齐备**。②**服务端硬拦截开关就绪**——validate.js 平台校验块新增 KV 开关 `config:platform-check={"mode":"enforce"}`：enforce 跨端 403 拒绝（文案"双端使用需分别购买授权"+platform-mismatch-denied 日志），默认/observe/开关读取失败一律放行记观察日志——**切换零代码零部署**（后台改 KV 键即生效，删键即回滚）。③**位置铁律（单测抓到的真实缺陷）**：平台校验块必须在任何激活写操作（ensureInviteCode/buildLicenseData/updateLicense）之前且在 auto-unbind 与 licenseUser 定义之后——首版放 updateLicense 后，enforce 拒绝时新设备已写入 devices（占 maxDevices 名额+污染后续比对+TDZ 引用崩溃），单测 D1"拒绝后设备列表不变"抓出后前移；auto-unbind 的 devices.shift() 仅改内存不落库，enforce 拒绝时自动回滚语义正确。④**探针 G4 新断言**（tools/probe-param-matrix.cjs，20/20）：6 处激活入口端形态标识完备性防回退（桌面 body.productClass=、Java reqBody.put、auth-core 双源字面量）。单测扩至 **30/30**（新增 D 组 enforce 开关 9 断言）。生效方式：服务端 push 即生效（observe 默认不变，客户端零影响）；离线桌面/云桌面随下次重打包带补发；离线APP Java 路径随下个整包 versionCode≥290 发版（JS 直连路径已随阶段1热包生效）。**切换 enforce 前置条件**：①桌面双端+APP 重打包发版覆盖率足够 ②观察日志确认存量跨端码规模 ③存量跨端用户迁移策略（同设备重激活也会被拦，需客服通道）。**★ 载体已重打就绪（2026-09-14 四端智能打包：本地APP versionCode 290/云端APP 302/离线桌面 1.0.246/云桌面 1.2.248，asar×2+APK×2 解包验证 productClass/clientClass 标识齐备，副作用 commit 235bc668 已推送）——**★ 2026-09-14 晚已发布 v2026.09.14**（本地APP 291 / 本地桌面 1.0.247 当晚重打**内置在线心跳 auth-core**，云端APP 302 / 云桌面 1.2.248 随晨间产物一并上线；发布链 publish-release --changed-only --confirm --push，六产物合规检查全过，hash-manifest/latest/site-official 三处同步，commit 4e807a20；⚠️ 智能打包 [4] 误报备注：build-skip 云端两端 units 的 sources 误含 `public/hot-update/*` 热包产物路径（热包产物≠端源码），纯热包发布后跑智能打包会对云端两端误标重打——本次按既有先例人工缩围 `一键打包.bat 2` 只重打真实变更的本地两端，待修 build-skip unitDefs excludes）→ 余下：覆盖率观察（旧版客户端激活仍无标识，观察日志可量化剩余规模）→ 存量迁移策略后再切 enforce**。**★ 首次观察数据（2026-09-14 晚，KV REST 遍历 license_log/device_version/license 全量）**：阶段2上线（当日 16:28 部署）后暂无任何激活（observed=0/denied=0，观察模式零误报）；存量全景 10 码——**跨端码仅 1 个（BNZC-Y6TT 惠康堂：2 桌面+2 app 混挂，9/9~9/13）**；旧客户端无标识激活 4 台（8/29~9/3 激活，device_version 无 clientClass 但 license devices 已被 heartbeat 嗅探回填 app——重激活须装新版客户端才带标识）。观察工具（只读，token 运行时取 wrangler config）：`tools/_tmp/analyze-platform-coverage.cjs`（device_version 标识分类+观察日志+当日激活）+ `tools/_tmp/analyze-license-devices.cjs`（全码 devices 跨端全景）——本机 workerd 崩溃 wrangler kv 命令不可用时走此 KV REST 通道。**★ 惠康堂跨端码迁移已执行（2026-09-14 晚，分支B：真实客户）**：KV 直改完全复刻 status.js action=unbind 语义（devices 过滤 + 旧字段 machineId/activatedAt 指向剩余首台 + license_log 追加 2 条 action=unbind 迁移日志），BNZC-Y6TT 剩 2 台 desktop 单端化——**enforce 前置条件③（存量迁移）达成，跨端存量归零**。备份（回滚用）：`tools/_tmp/y6tt-backup-license.json`/`y6tt-backup-log.json`；迁移脚本：`tools/_tmp/migrate-y6tt-unbind.cjs`（前置断言+复读验证）。排查结论：browser- 设备无激活日志/无 activatedIp（9/11 前旧版非标路径写入），但全库设备**新增**路径唯一（validate.js 激活，enforce 可拦），心跳/管理端只补字段不新增——解绑后不会被自动加回。运营提醒：需联系客户王桂杰告知 APP 端已解绑、桌面照常、APP 端如需使用另行处理。

## 8. 桌面版技术规范

* **登录预填：已彻底取消（2026-09-06 Commit 2202236f，取代 9-04"来源单一化"方案）**：`initLoginInput` **不再做任何用户名自动预填**——登录框永远空白+聚焦；记住的账户仅保留**手动下拉切换**（renderUsernameDropdown，点▼选择）。演进史：8-27 恢复预填 → 9-04 收窄为"仅 localStorage 记住的用户名"（历史 bug：config.users 单账户分支无法区分出厂模板 admin，全新安装首次启动即预填 admin/admin）→ 9-06 用户实测"升级新版后自动显示旧记住的用户名，不像新客户"后**彻底取消**。理由：预填链路多次引发历史 bug + 升级安装 userData 不清导致残留展示；而手动下拉保留全部便利。

* **桌面版云端 HTTP 必须走主进程**（file:// 直连被 CORS 拦截，Origin: null 不在白名单，fetch 静默 TypeError）：IPC 代理或 activate.js 内 fetch。APP 端 <http://localhost> 在白名单可直连。新增桌面版云端接口沿用 postInviteQuery 分流模式。

* **CSP** **`connect-src 'self'`** **拦截云端 API（高频坑）**：判定某 index.html 是否被拦看三件事——①是否 file:// 本地 WebView/Electron loadFile 加载（非 pages.dev 同源）②渲染进程是否 fetch pages.dev 云端 API ③connect-src 是否含 pages.dev，三者具备才是 bug。修复：head 的 `connect-src 'self';` 追加 `https://tcm-prescription-system.pages.dev https://*.pages.dev;`（只改 head 安全策略，不动 body/样式）。

* 桌面管理员激活走主进程流程（activate-window + submitAdminRequest/saveLicense IPC），不经过 auth-core onAdminActivated。


* **激活页面状态感知（2026-09-04 Commit 2fe38576）**：activate-window.html 的"立即试用"按钮（startTrialBtn）不能写死永远可见。页面加载时必须调 window.electronAPI.license.getStatus()（底层是 licenseManager.validateLicense()），根据 	ype 字段分支：
  - 	ype === 'trial' 或 undefined → 保持按钮可见（试用中 / 全新未启动过）
  - 	ype === 'trial_expired' → 隐藏按钮，提示"⚠️ 试用期已结束，无法再次试用"
  - 	ype === 'licensed' → 隐藏按钮，提示"✅ 已激活正式授权"
  - 其他异常 type（binding_mismatch / tampered / expired / debugger / invalid / config_tampered）→ 隐藏按钮
  根因：试用过期弹框提示"该设备已完成一次试用"，但激活页面仍显示"立即试用"按钮——UI 逻辑矛盾。* 激活窗口 activate-window\.html：QR 库从官网 CDN 加载（失败自动降级链接文本）；checkAdminStatus IPC 链（preload→main→activate.js）透传 machineId。

## 9. 安全防破解铁律

* 核心原则：**宁可漏检不可误报**。只有 APK 签名校验允许 toastAndExit 阻塞运行；Root/调试器/Frida/Xposed/模拟器检测只能 Log.w 记录日志。

* 安全检测关键词黑名单（gmain/busybox/ro.debuggable=1 等）禁止用作检测特征。

* 安全优化不得破坏正常打包流程，不得导致正常用户闪退。

* ★ 2026-09-11 **License 验签加固 阶段0+1**（对称 HMAC 密钥泄露收敛）：①安卓 `LicenseManager.java` V5 ECDSA 验签失败改 fail-closed 直接拒绝（原降级 HMAC=攻击者篡改后重算 HMAC 可绕过；对齐桌面 2026-08-16 修复，L1881）；②服务端 `license-write-service.js` 新增 `ensureLicenseV7(kv, record, context)`——存量 licenseBase64 无 signatureV7 时用 license:{code} 权威记录重签（锚点确定性重算、expiresAt 不漂移、幂等零写入），接入 **3 个存量下发出口**：admin-status.js activated 返回前（L262，须在过期拦截之后）、admin-submit.js 手机号短路（L350）+ 设备维度短路（L522）；validate/admin-approve/activate-from-ticket/export-license 均新鲜签发（buildLicenseData 内含 V7，license-core.js L512）无需接入；entitlement.js 不下发 license；③六端加 `HMAC_SUNSET_DATE='2027-03-31'` 截断：无 V5/V6/V7 且 issuedAt≥截断日的纯 HMAC license 一律拒绝（shared/license/license-manager.js 权威源+4 副本+Java，拒绝原因 `hmac_sunset` 提示"联网完成一次在线验证"）——存量旧文件（截断日前签发）放行保兼容，攻击者用泄露对称密钥伪造的新文件全网拒绝。**出口审计铁律：新增任何读取存量 licenseBase64 下发的路径必须过 ensureLicenseV7；rg -l licenseBase64 functions/api/license/ 全查出口是唯一可靠手段**。单测：`tools/_tmp/test-hmac-sunset.cjs` + `test-ensure-v7.mjs`（各 10 断言，Windows 坑：ESM 用 pathToFileURL 导入、CJS 加载 ESM 需先复制改 .cjs 后缀）。生效：服务端 push 即部署；客户端改动须重打包（离线APP/离线桌面 APK+exe、云桌面 exe；云端APP 读线上 public 自动跟随）。

* ★ 2026-09-11 **License 验签加固 阶段2（对称密钥轮换）**：①客户端硬编码密钥改 `LICENSE_HMAC_KEYS` 数组（[0]=V2 新密钥 `bnzc_tcm_license_v2_94b8…`、[1]=V1 旧密钥 `bnzc_tcm_license_key_v1_2026` 已泄露只读兼容）——写路径（加密/签名）默认取 [0]，读路径遍历全档，旧密钥文件读后重存自动迁移 V2；②双档日落：V1 档 `LEGACY_HMAC_SUNSET_DATE='2026-08-01'`（V5 上线 2026-07-21+10 天缓冲，收紧 8 个月伪造窗口、存量真文件 issuedAt 必然更早零误伤），V2 档维持 `HMAC_SUNSET_DATE='2027-03-31'`；③masterKey 派生分支同样应用 LEGACY 截断（masterKey 明文随 license 下发可被提取，不堵则成为绕过硬编码档位的前门）；④本地加密全链路分档：license.dat（ENC2/ENC1×三级派生 HKDF→SHA256含hwFp→SHA256无hwFp）、trial/last-run/count/verify-state/activation-record 均为"写用 V2、读遍历 V2→V1"；⑤`generateSignature/V3/V1` 增加 ikm 重载（Java 显式 hmacSha256WithKey / JS 可选参数），verifySignature 硬编码 fallback 分档遍历+V1 档截断设 `hmac_sunset` 拒绝原因（与 masterKey 分支同标记引导联网自愈）。**服务端 HMAC signature 字段仍按 V1 签发**（新客户端主线 V7 非对称验签，V2 档为未来服务端切换预留防御位——服务端切换时只需 license-core.js 换密钥，客户端零改动）。**坑：①Java 重载歧义——`generateSignature(data)` 与 `generateSignature(data, ikm)` 并存 OK，但 verifyMasterKeyConsistency 必须用无 ikm 版（masterKey 派生语义）；②deriveXxxHkdf 加参后必须全查调用点（本轮 4 处遗漏 verifyState/activationRecord 编译才暴露，`rg "derive\w+\((getMachineId|mid)\)"` 可查单参残留）；③V1 档截断只认 issuedAt≥2026-08-01，无 issuedAt（NaN/0）不拦防误伤**。单测：`tools/_tmp/test-key-rotation.cjs` 25 断言（V1/V2 档边界、masterKey 截断、ENC2/ENC1 旧文件、迁移后 HMAC 档位、未知密钥负向）+ 阶段1b 单测 10 断言回归全绿。轮换此数组/截断日需同步：shared 权威源+4 副本（sync-all）+ Java（两处常量+语义注释）。生效：客户端须重打包（离线APP APK/离线桌面 exe/云桌面 exe；云端APP 自动跟随）。

* ★ 2026-09-12 归档：验签加固实施计划全文存 `docs/license-signature-hardening-plan.md`（历史调研稿，含攻击路径/风险回滚表；阶段 0/1/P1/P2 已于 2026-09-11 实施完毕见上，实施细节以本文件条目为准）。**阶段 3 清理期（约 2028-03）执行时按该计划操作**——删四端 HMAC 验签代码 + LEGACY 公钥前，必须 wrangler 遍历统计确认 KV 全量 license 已 V7 + 客服公告存量长周期离线用户。

* ★ 2026-09-11 **防破解安全审查 P0 执行点门 + P2 设备封锁闭环**（打包后 APP 防破解再审查产出）：**P0 试用白嫖堵口**：JS 层授权门（__licenseReadOnly/canPrescribe 桥）可被 Frida hook 绕过、IndexedDB 数据写入 Java 拦不住，但**打印与计数必经 Java 层**——LicenseManager 抽取 `isTrialReadOnly()`（validateLicense 无效且 type∈{trial_expired,trial_limit_reached}），`printHtml` 打印门 Toast 拒绝 + `incrementPrescriptionJson` 计数门返回 `trial_read_only`，canPrescribe 复用同函数去重；异常放行（红线 fail-open 不误伤）。**P2 安全画像封锁**：verifyOnline 上报 `securityProfile{rooted,debugger,fridaDetected}`（isFridaInjected=端口27042+/proc/self/maps 特征），服务端 verify.js 强信号（fridaDetected 或 integrityState≥2）→ `blockDevice` 落 `device_block:{machineId}` + 403；弱信号（root/debugger）仅 integrity_flag 审计；四下发出口全接封锁检查（verify/validate/admin-status/admin-submit×2 短路点）→ 攻击者"换码无用"在线能力卡死，本地零阻塞维持红线。**审查发现"伪造封锁 DoS"并已修复**：verify 无认证且 machineId/fridaDetected 全是客户端提交参数，攻击者拿到他人 machineId 可伪造强信号封锁真实客户设备——修复=封锁 TTL 180→**7 天**（单次伪造误伤上限 7 天自动恢复；真实攻击设备 KV 过期后再 verify 强信号即再封、在线能力实质持续卡死；已封锁设备 verify 入口拒绝**不续期**，防正常设备常规验证无意续期导致永不能自愈；持续定向伪造靠 integrity_flag 审计人工识别+客服删键解封）。**坑：单测 mockKV 隔离——postVerify 固定绑定全局 env 导致 A1/A2 独立 KV 失效（封锁落错库污染后续 C 组），mock 测试函数必须支持 envOverride 注入**。单测 `tools/_tmp/test-device-block.mjs` 15 断言（强/弱信号、不续期、TTL=7 天、count 聚合、删键解封、旧客户端兼容）。生效：服务端 push 即部署；P0 客户端改动须重打包（离线APP APK/离线桌面 exe/云桌面 exe；云端APP 自动跟随线上 public）。

* ★ 2026-09-11 **P1 验签 NDK 下沉（V7 Ed25519 双路互检，补缺口 C）**：Java 层 `Ed25519.verify` 可被 Frida hook 返回 true 一键绕过 → 验签核心数学（SHA-512 + gf 域运算 radix 2^16×16 limbs int64_t + ge 点运算 + sc_reduce512）**纯 C++14 重写**下沉 `securityguard.cpp`（离线APP，与 APK 签名校验同款 JNI_OnLoad 动态注册 + XOR 脱敏 0x5A/0xA5^0x1C，新增 `nativeVerifyEd25519([B[B[B)I` + `nativeSelfTest()I` 同一 RegisterNatives 批次）。**双路互检**（LicenseManager.verifyEd25519SignatureV7 升级）：native 可用且自测过 → Java/native 双路；双路一致通过放行（密钥轮换任一公钥通过即可）/双路一致失败试下一公钥/★**分叉 → fail-closed 拒绝 + 粘性标记 `sEdVerifyForkDetected`**（进程级 volatile，防被后续 verifyApkSignature 覆盖 lastIntegrityState 丢失）→ verifyOnline 上报 integrityState=2 → 服务端 device_block（复用 P2 封锁闭环，换码无用在线能力卡死）。**关键设计决策**：①V7 分叉**不走云端仲裁**（与 APK 签名分叉相反）——云端 verify 只能确认 KV 授权记录存在，无法证明本地 license 数据未被篡改，分叉场景 license 内容本身可疑，仲裁放行=放过篡改数据；②`NativeGuard.tryVerifyEd25519` 返回**三态 Boolean**（null=native 路瞬时失效 OOM/未注册）→ 调用方降级 Java 单路，**绝不能当"验签失败"参与分叉判定**（native 异常误判 hook=违反宁可漏检不可误报红线）；③native 自测（RFC 8032 §7.1 TEST1-3+随机×2+篡改负向×2，OpenSSL 对拍后嵌入 .cpp）失败 → 纯 Java 降级不误伤，自测结果进程内缓存；④无 __int128（armeabi-v7a 32 位 ABI 兼容）。**常量零手抄**：`tools/_tmp/gen-ed25519-vectors.mjs`（Java 权威十进制常量→C++ 数组+测试向量）+ `gen-sha512-const.mjs`（素数立方根/平方根整数算法生成 K/H0 并与 Node crypto 对拍）。**坑：①恢复会话续写 .cpp 时嵌套 `namespace {` 多开少闭——大括号不平衡且 JNI_OnLoad 被包进匿名 namespace（符号不导出），ninja 报"to match this '{'" 才暴露；**大段 .cpp 续写后必须数 namespace 开闭配对**；②云端APP（db-yunduan/cloud_app）有**独立副本** securityguard.cpp/NativeGuard（类路径 com/tcm/prescription，仅 APK 签名 1 方法）——无 V7 离线验签需求**不可盲同步**：若把 3 方法注册表复制过去，Java 类未声明的方法使 RegisterNatives 抛 NoSuchMethodError → 整批失败 → 云端APP APK 签名 native 校验全失效（降级但保护削弱）；多端同步先确认功能归属再动手**；③**gf_mul wrap-around 后单次 carry 不充分**——38×t[i+16] 折叠（2^256≡38 mod p）进位需多轮传播，链式平方 v^6 limb 累积达 4.2 万亿、再乘即溢出 int64_t（桌面 OpenSSL 对拍全对、真机自测才暴露）→ 必须 3 次 gf_carry 充分规约；④**sc_reduce512 逐位减 L 比较**——r[8] 与 L 高位恒为 0 相等时残留 cmp=1，`cmp&&!ge` 误判 r==L 执行减法 → 下溢 k 值错 → 必须显式 greater/allEqual 双状态变量，仅 r>L 或 r==L 才减。真机数学 bug 排查手法：**把数学层拆独立 harness（tools/_tmp/gf_test2.cpp、sc_test2.cpp）adb push 真机直跑，与 Node 对拍逐字节定位**（WSL 不可用时用 Node 本地生成期望值）。验证：externalNativeBuildDebug（armeabi-v7a+arm64-v8a）+ compileDebugJavaWithJavac 全绿、testDebugUnitTest 6/0/0、check-interface 6 OK；**versionCode 274 真机全流程通过**（注册→试用→激活→登录，native 自测过、无双路分叉、无降级日志），打包产物 13 项安全核验全过（v2+v3 双签名、.so 仅 JNI_OnLoad 导出无 Java_ 符号、三 native 方法注册字符串在册、LicenseManager 类名从 dex 消失仅 NativeGuard/MainActivity 最小保留、debug 段已剥离、allowBackup=false/明文流量禁用）。生效：**仅离线APP，须重打包 APK**（离线桌面/云桌面是 Electron 无 NDK 不适用，云端APP 在线授权模式无 V7 验签不涉及，服务端零改动）。

* ★ 2026-09-11 **P1 桌面完整性上报闭环（安卓 P2 封锁的桌面对齐，"只看不管"→"上报封锁"）**：桌面 self-check 三路校验（exe 签名/.bnzc 区段/asar）原先只写日志，篡改者无任何后果 → 本轮打通"客户端聚合上报 → 服务端 blockDevice → 三端点在线能力卡死"闭环。**桌面端（双端 db-offline/desktop + db-yunduan/cloud_desktop，self-check.js 字节级一致、main.js 插入块同构仅 productClass offline/cloud 之差）**：①self-check.js 新增 `_integrity{exeSignature,peZone,asar}` 聚合（'ok'/'unavailable'环境原因/'tampered'证据/'tampered_hash'铁证/null=未完成）+ `getIntegrityState()`——**优先级 3>2>1>0 且篡改证据优先于未完成**（不等 PowerShell 慢回调）；**坑：「不适用」必须显式置 ok**——旧版 exe 无 .bnzc 区段（present=false）或 ver=1 无 asar 哈希时第三路不会启动，若留 null 会被误判"未完成"报弱信号 1，正版老用户每次上报 1（无害但语义脏）；②main.js `reportDesktopIntegrity()` whenReady 后 **25s 延迟**上报（等 PowerShell 15s 超时窗+asar 流式哈希），POST /api/license/status {machineId,integrityState,productClass,clientClass}，403/失败一律静默（本地使用不阻断红线）；**坑：license-manager.js 的 startHeartbeat 是死代码**（导出但 main.js 从不调用，历史遗留）——上报别挂它上面，直接 whenReady+setTimeout 独立通路。**服务端**：status.js 心跳通道（无需 action 的 POST）新增①已封锁设备 403（不续期）②integrityState 强信号（整数且 0≤x≤3 校验，非法值 null 容忍）≥2 → blockDevice(reason=desktop_integrity_tamper)+403 ③每 IP 60/h 限速（本通道可写 KV 落封锁，防伪造强信号洪水灌库；管理员 action 分支不受影响）；entitlement.js 加纯读封锁检查（getDeviceBlock 仅 kv.get——**纯只读铁律不破**，封锁写入只在 status/verify）；heartbeat.js 同接封锁检查。**语义表与安卓 verify.js INTEGRITY_LABELS 对齐**：0=ok/1=check_unavailable/2=tamper_evidence（.bnzc 失配/bad-zone/exe 未签名/指纹不符）/3=signature_hash_mismatch（exe HashMismatch 铁证）；asar 失配仍走 app.exit(1) 强阻断（无机会上报也无需上报）。单测：`tools/_tmp/test-desktop-integrity-block.mjs` 21 断言（强信号→封锁→**三端点 403→count 恒 1 不续期**→无效值容忍 7 例（字符串/小数/越界/缺省/弱信号）→正常回归→entitlement 零业务写）；`tools/_tmp/test-selfcheck-aggregate.cjs` 10 断言（Module._load mock electron/child_process/pe-guard 三依赖，聚合优先级矩阵全覆盖）。**安全设计**：桌面客户端上报是"自证其罪"（攻击者可删上报代码），价值在于纵深——删 self-check.js 改动=改 asar=触发 asar 强阻断 exit；改 exe 区段=.bnzc 失配=每次启动上报封锁；闭环把"破解成本"从"改完永久用"抬到"改完本地可用但在线能力永卡死"。生效：**服务端 push 即部署**（对现有客户端零影响——旧桌面/APP 不带 integrityState 字段照常放行）；**桌面端改动须重打包**（离线桌面 exe + 云桌面 exe 各重打；APP/云端网页不涉及）。

* ★ 2026-09-12 **风控告警 IPv6 误报根治（/48 归并 + ABAB 判定 + 过期跳过 + 管理端 IP 排除）**：后台风控告警页全量误报（2 高危 + 1 中危全部误报、真实盗版 0）——①惠康堂：两个 IPv6 地址同属 `240e:342:588e::/48`（同一电信宽带，当天换设备重激活）；②测试码：WiFi(IPv6)→蜂窝(IPv4) 1 分钟切换 + 次日 `reactivate-denied-expired`（正是到期重激活修复的验证码）；③费医生：电信 WiFi 激活 3 天后移动蜂窝心跳（标准换网）。**根因**：旧逻辑把"每个 IPv6 地址"当独立 IP——IPv6 时代每设备（甚至每次重连）都有独立全局地址，多 IP 判定天然海量误报且随 IPv6 普及恶化。**修复（admin-risk.js，判定逻辑抽为 export 纯函数 networkKey/effectiveExpiryMs/classifyMultiIp 供单测，Pages Functions 额外命名导出不影响路由）**：①**networkKey**：IPv6 按 /48 前缀归并（前 3 组，展开 :: 压缩、剥离 %zone、::ffff: 映射提 v4），IPv4 原样；②**高危三条件全备才报**：ABAB 往复（某网络 ≥2 个会话块）∧ ≥2 次相邻会话切换间隔 <24h ∧ 授权支持多设备（maxDevices≥2 或真实设备≥2，`browser-` 伪设备不算）——单设备授权跨网/一次性换网/手机 WiFi↔蜂窝双栈切换全部封顶中危；③**过期码整体跳过**：expiresAt 为空按 issuedAt+days 推导（有效期语义与 offline_90d 对齐，永久码 days=0 视为未过期）；④**ADMIN_ACTIONS 黑名单**（generate/scan/extend/update/restore/invite-reward*/resign-v7-selfheal）：管理员动作的 IP 来自管理员浏览器非客户设备，计入则"办公室生成+家中激活"的码全部误报中危。**告警字段**：ips=归并后网络（带 /48 后缀自解释）、新增 ipsRaw 保留原始地址（UI 不消费新字段零改动）。**单测** `tools/_tmp/test-risk-ipv6.cjs` 29 断言（/48 归并 10 例含压缩/zone/映射、过期推导 5 例、线上实捕数据回放 5 例、合成盗版 5 例：两机 ABAB 快切多设备=唯一高危、单设备/慢交替/单次快切=中危、同网络多地址=无告警、主循环静态验证 4 例）。**铁律：任何"多 IP"类风控判定必须先做 IPv6 /48 归并（运营商分配单宽带的典型粒度）；"IP 数量"在 IPv6 时代不等于"使用位置数量"；管理端动作必须从客户流量判定中剥离。**生效：纯服务端 push 即部署（Cloudflare Pages），后台点「重新扫描」即见 0 高危；客户端零改动无需重打包。

* ★ 2026-08-31 开放前官网安全审查（40+ Pages Functions 全面审计，详案已归档 `.trae/archive/2026-08-31-09-03-misc-experiences.md`）铁律：**①凡「客户端提交的标识参数」（machineId/phone/requestId）用于跨记录匹配时，命中的他人记录只能做无副作用读取——凡有写副作用（重置密码/开通账号）的调用必须限定「参数持有者本人记录」路径**；②KV `login_fail:{username}` 键的 TTL（24h 保计数）与锁定时长（按次数阶梯封顶 1h）是两回事。审查确认安全项：登录渐进锁定+IP 限流+防枚举哑哈希、dl.js 严格域名白名单（无 SSRF/开放代理）、admin-\* 强制 platform_admin 鉴权、ticket/trial 限流、处方 API 按创建者过滤、\_headers 安全头齐全。

* ★ 2026-09-14 **设备封锁诊断三定律（"重装后疑似云端拉黑"排查闭环）**：测试机 release 288 卸载重装后出现注册开通页，一度推断"debug 包 INTEGRITY_FAIL=3 强信号已触发 blockDevice 拉黑 machineId"，KV 实锤证伪（零封锁记录）。三条铁律：①**封锁是否发生以 KV 为唯一裁决，禁靠客户端本地日志反推云端状态**——`npx wrangler kv key list --binding KV --prefix "device_block:" --remote`（`integrity_flag:` 同理；本机 workerd 报错时加 --remote 走线上），空=从未封锁。勿信"debug 包跑过强信号"式推断：**verifyOnline() 首行 readLicense 为 null 即短路返回不发网络请求（LicenseManager.java verifyOnline），无 license.dat 的篡改包（debug 包/卸载重装态）强信号永不上报云端**——封锁语义是"已激活设备的在线能力"，全新安装态根本没有上报通路；②**machineId 签名域天然隔离**——machineId=SHA256(ANDROID_ID|packageName|versionName|厂商|型号)，Android 8+ 的 ANDROID_ID 按 APK 签名密钥分域，debug 包与 release 包即使同一台机器也各持不同 machineId/hwFp（试用/封锁/激活绑定均不串扰），"debug 包触发的封锁波及 release"结构性不成立；③**卸载重装=出厂三清**——license.dat + config.json（本地账号）+ 试用文件全清，重装后必现「有效试用 + 注册开通页」：试用期内云端试用注册幂等放行（trial_fp:{hwFp} 在活跃窗口直接 allowed），valid=true 才会打 `[Integrity] 代码完整性校验通过` 日志（MainActivity 仅 valid 分支调 verifyJsIntegrity，见此日志≠已激活，也可能是试用态）。恢复正常路径=原手机号重新注册 → 登录 → 输原激活码（同签名 APK machineId 未变仍在 devices 秒恢复）。封锁文案全文备查：**"设备安全校验未通过，请更换设备或联系客服处理"**（HTTP 403，云端 10 出口统一：validate[claim 转发]/admin-submit×2/admin-status/verify×2/entitlement/heartbeat/status×2；客户端 LicenseManager.java activateOnline 透传 error 字段直显）。

## 10. 排查验证方法论

* **报错文案会误导定位**：防静默包装只报 e.message 不报行号，「Cannot read 'success'」可能来自链路上任何一个 await——必须通读整条调用链。

* **浏览器 E2E 是实锤根因最佳手段**：git HEAD 版+真实 shim+mock 桥复现逐字一致报错 → 改后同环境验证。E2E 三坑：页面 JS 字符串内含 `<head>`（打印模板），注入脚本必须 IndexOf 首处插入禁止全局 replace；CSP upgrade-insecure-requests 需在测试副本移除；alert 需在 head 注入捕获。

* E2E 竞态类问题单次通过不算数：须 dev electron + 真实 app.asar（run-e2e 兜底模式 B）连跑 5 次以上；fused exe 按设计阻断 CDP，不能直接跑 Playwright E2E（超时≠业务失败）。

* 检查工具的「容错」（±30 行窗口重对齐/规范化）会把真实漂移洗成「IN SYNC」——修漂移前先审计检查器本身有没有盲区；同症状多轮复现=多个独立根因叠加，修掉一层后必须看远端日志确认下一层（gh run view --log-failed），不能本地绿就收工。

* 测试页面改动必须带缓存穿透参数（?v=xxx），浏览器缓存会测到旧版误判。

* async 按钮处理函数必须有外层 catch（含防静默包装），否则异常=点击无反应。

* npx http-server 本机可能卡死 → 用手写静态服务器 `tools/_tmp/qrcrop/static-server.cjs`；<http://127.0.0.1> 是安全上下文 crypto.subtle 可用。npm install 间歇性失败 → jsdelivr 直接下载库文件本地 require。

* 临时产物统一放 tools/\_tmp/（git 不入库）。

* PowerShell：写含中文 .ps1 必须 UTF-8 BOM（Edit 工具会丢 BOM 需整文件重写）；RunCommand 含★等特殊字符的替换反引号转义会引入 \` 字符需复查；脚本参数经 -File 传递会丢，重要参数硬编码。

* 用户手动重命名文件易带尾部空格导致 404——验收图片类交付必须逐文件核对文件名。

* 云桌面 E2E 在 git push 触发 Cloudflare Pages 部署窗口期可能 transient 423，等部署完成后重跑即过，勿盲目改代码。

* 图片二维码验证：jsQR + PowerShell System.Drawing LockBits 提取 RGBA（GDI+ 是 BGRA 需转序）。

* ★ 2026-09-10 云端APP"线上更新不生效"（用户连续三轮反馈布局未变化）双重根因：**① 根因一（最致命）：云端APP通过 Capacitor server.url 加载线上 URL（tcm-prescription-system.pages.dev），不是本地 assets——只改本地 assets 副本/只打包 APK 完全无效，必须推送 GitHub 触发 CF Pages 部署线上 HTML 才生效**。验证线上是否已部署：`curl -s https://tcm-prescription-system.pages.dev/ | grep 新标记`。**② 根因二（缓存竞争窗口）：Capacitor 初始加载发生在 configureWebView（postDelayed 延迟执行）之前/并行，clearCache(true) 是异步磁盘操作，WebView 可能已命中旧 HTTP 缓存完成首帧——clearCache + no-cache 头仍不够**。根治（V283）：configureWebView 清缓存后主动 `webView.loadUrl(CLOUD_URL + "?_v=" + System.currentTimeMillis())`，URL 不同=缓存键不同=必然拉最新；onPageStarted 兜底重定向同步带时间戳。isCloudUrl 按 host 判断（L1074），带参 URL 不被反钓鱼拦截。铁律：**云端APP排查"更新不生效"必查三件事：线上 HTML 是否真已部署（curl 新标记）、APK 是否 V283+（含时间戳绕缓存）、用户是否安装了新 APK（看 APP 内版本号 V1.0.0.283）**。

* ★ 2026-09-14 排查"疑似云端拉黑/封锁"类问题两步法：**第一步先拿云端实锤再定位**——wrangler 直查 KV 前缀（device_block:/integrity_flag:，--remote），勿从客户端本地日志反推云端状态（本地 INTEGRITY_FAIL=3 ≠ 已上报）；**第二步判别截图/提示性质**——先分清是错误弹窗还是正常出厂页（注册开通页 = 卸载三清后的设计内行为，非故障），对照云端文案清单（validate.js 各 error 字段逐字透传直显）即可锁定链路。

* ★ 2026-09-19 **后台设备配额弹窗「已绑定 1/5 台但列表显示暂无设备」**（惠康康中医诊所案例）：`admin-get-device-quota` 两分支返回形状不一致——机构/离线版分支 `devices` 为**裸数组**（license.devices 映射），普通账号分支为 `{devices:[...]}` 对象；前端只按 `data.devices.devices` 解包 → 机构版计数对、列表永远空。修复：双副本（public/admin/index.html + site-admin/admin/index.html）兼容解包 `Array.isArray(data.devices) ? data.devices : (data.devices.devices||[])`。**铁律：同一接口多分支返回形状必须统一；前端消费多形状时必须兼容解包。** 另：桌面端激活申请（admin-submit）报「该手机号已在其他设备完成激活」= 2026-09-05 安全铁律设计内拒绝（匿名接口手机号非秘密，设备不匹配一律 409 防接管，勿放开）；已开通云端账号的多端使用正解=桌面端登录框直接账号密码登录（走设备配额），激活申请入口仅用于新诊所首次开通。生效：服务端+后台页面 push 即部署，五端零重打包。

* ★ 2026-09-19 **换机激活「填原绑定手机号自动恢复」从未生效**（惠康康案例，commit 09d40e65）：validate.js recordPhone 仅从 user 字符串提取手机号（"张三/138…" 老形态），而 admin-approve 生成的记录 user="惠康康"（纯姓名）、手机号存独立 record.phone 字段 → phoneVerified 恒 false → 客户端界面承诺的手机号换机恢复走不通，被迫依赖诊所名匹配（又被 Tab2 隐藏诊所名框跨 Tab 预填旧值卡成死循环，配套修复：诊所名不一致 403 补 needClinicName 展开标记，commit ff40a0fb）。**铁律：身份核验读记录字段必须覆盖全部存储形态（user 内嵌 / record.phone 独立字段），新增存储形态时同步审计所有读取点。**

* ★ 2026-09-20 **KV 运维事故规程（生产 license 记录险些被毁，靠事前备份恢复）**：① 本版 wrangler `kv key get` **不支持 --path**（仅 put 支持），get 只能 --text；② **严禁 get→改→put 链式一条命令**——PowerShell 语句级错误不中断脚本，get 失败后 $null 继续流转，ConvertTo-Json 产出 "null" 字符串被 put 写进 KV **静默毁掉生产记录**；③ 规程：任何 KV put 前**先把当前值备份到文件**；构建修改文件必须 `$ErrorActionPreference='Stop'` + try/catch + sanity check（关键字段比对），**文件构建与 put 分两步执行**，put 后必读回验证；④ 中文字段经 --text 管道往返安全（控制台 UTF-8），但写回文件必须 [IO.File]::WriteAllText + UTF8Encoding($false)（无 BOM——BOM 会让服务端 JSON.parse 失败）。

## 11. D1 数据库迁移与激活审核有效期（2026-09-10）

### 用户表 D1 切读（登录+用户列表）→ ★ 2026-09-19 改判「KV 权威 + D1 自愈副本」

* **目标**：用户认证与列表查询迁移 D1 加速；**2026-09-19 实锤教训：D1 只能做副本/索引，不能做用户数据权威源**。
* **2026-09-19 P0 修复「平台后台用户管理找不到诊所」（实锤案例：惠康康中医诊所 13398628212，诊所管理可见、用户管理永远搜不到）**：原 `getAllClinicUsers` D1 优先且 `clinic_users` 表内任意行存在即提前返回、永不回源 KV；而所有开通/修改路径（`clinic=create` 平台创建 / `register-clinic` 自助注册 / `provisionCloudAccount` 激活开通 / 后台改管理员手机号密码）**全部只写 KV**，全库唯一回填点是「该用户登录时」→ 从未登录过的账号在 D1 永远无行，用户管理永远不可见。三条修复（`functions/api/users.js`）：
  - `getAllClinicUsers`：改 **KV 权威遍历**（与诊所管理同源直读 `system:clinics` + `clinic:{id}:users`）+ D1 缺行自动 UPSERT 回填（自愈：一次列表加载即修复存量漂移，无需人工数据迁移）。
  - `findUserForLogin`：D1 命中后**必回读该诊所 KV 用户交叉校验**——KV 有 → 以 KV 为准并顺手回填 D1（根治「后台改了新密码、登录仍 401」的历史案例 13398628212，即 D1 旧密码哈希作祟）；KV 无（账号已删除/已迁移）→ 不信任 D1 行，落回 KV 链路重新定位。
  - clinic_admin 本诊所用户列表：**KV 优先**，KV 空/读失败才回退 D1。
* **铁律：①任何新增用户写路径只写 KV 即可，D1 由读路径自动回填收敛；②禁止把 D1 当用户数据权威源读取，除非先给该写路径补上 `syncUserToD1`；③后台两页数据源口径——诊所管理直读 KV，用户管理经 getAllClinicUsers（现同为 KV 权威），两页永不再分叉。**
* **辅助函数**：`d1RowToUser`（D1 行→用户对象）、`findClinicUserD1`、`syncUserToD1`（UPSERT）、`deleteUserFromD1`。
* **生效方式**：服务端 Functions push 即部署，**五端零重打包**。

* ★ 2026-09-12 **P0 铁律：D1 TEXT 列读回必须恢复客户端期望的 JS 类型**（处方历史「删除/加载按钮静默失效」根因）：`schema.sql` prescriptions.id 为 TEXT（upsert 绑 `String(p.id)` 入库），`d1RowToPrescription` 原样透传 `{...row}` → 客户端拿到字符串 id；而客户端全链路（`deleteHistory`/`loadHistory`/`deleteCase` 的 `find(p => p.id === id)`、按钮 onclick `Number(p.id)||0` 传参）按 KV 时代数字 id 做 `===` 严格匹配 → 字符串≠数字 → find 落空 → 静默 return，点击无任何反应。**修复：转换函数内 `纯数字串 → Number()`（`/^\d+$/.test(row.id)`），与 KV 回退路径类型对齐**。铁律：①新增 D1 表时行转换函数必须显式声明每个 id/数值列的目标类型，禁止裸 `{...row}`；②客户端 id 比较一律 `String(a) === String(b)` 归一化（新代码）；③症状特征——「按钮点了没反应且无 console 报错」优先查严格相等类型失配。生效：服务端 push 即部署（Cloudflare Pages），五端零重打包，本地 IndexedDB 缓存随下次云端拉取自动清空重写自愈。
* ★ 2026-09-12 **配套二层防御（服务端修复后云端APP 仍失效的教训——多根因叠加）**：服务端 id 数字化只治新拉取数据；**本地 IndexedDB 残留的字符串 id 旧记录**（D1 迁移期写入）在会话未刷新/云端拉取回落本地的场景下仍使 `===` 失配。已落地：①**6 份 index.html 全部 id 比较归一化** `String(a)===String(b)`（deleteHistory/loadHistory/deleteCase/回收站恢复/彻底删除/同日覆盖/保存去重/媒体元数据 11 处）；②**deletePrescriptionFromDB 双键删除**（IndexedDB 键类型敏感：数字 123 ≠ 字符串 "123"，`store.delete(Number(id))` + `store.delete(String(id))` 一次删净）。**同步盲区警示：`sync-html.ps1` 只分发 cloud_desktop 一份；db-offline/desktop、db-offline APP assets、cloud APP assets、根目录 index.html 共 4 份主页面为手工维护副本**——改 public/index.html 处方逻辑时必须同步核查这 4 份（grep 关键表达式核对），鸿蒙 rawfile 由 copy-assets.cjs 从安卓 assets 拷贝自动跟进。

### 激活审核 days 必须写入 record（诊所 expiresAt 回退 365 天根因）

* **根因**：`admin-approve.js` 审核通过调用 `provisionCloudAccount` 前，只写了 `record.expiresAt`，**漏写 `record.days = days`**。`admin-account.js` 新建诊所时 `(Number(record.days) || 365)` → record.days=undefined→NaN→回退 365 天。
* **修复**：`admin-approve.js` L341 补 `record.days = days || null;`，与 `record.expiresAt` 同步写入。
* **铁律**：调用 `provisionCloudAccount` 前，`record.days` 与 `record.expiresAt` 必须同时按管理员审核参数赋值，缺一不可。

### clinic=update 支持直接设置 expiresAt（平台管理员修正异常有效期）

* **背景**：历史异常数据（如 days 回退 365 的诊所）无法通过 renewDays 顺延修正（只会更长）。
* **改造**：`POST /api/users?clinic=update` 新增 `expiresAt` 参数（支持 `yyyy-mm-dd` 或 ISO 字符串），平台管理员可直接覆盖诊所到期日，优先级高于 renewDays。
* **生效方式**：服务端 Functions push 即部署，后台诊所管理强刷生效，五端零重打包。

### ★ 2026-09-11 P0 离线APP「假激活 + 双源有效期分裂」重大漏洞（授权过期仍可激活/官网可登录）

* **现象全貌**（用户"激活1"实测，手机号 13800000000 / licenseCode BNZC-CYQG-HDDT-AD74-DL7S）：①离线APP提示"授权已过期"打不开，但官网用户名密码可登录，操作界面显示"已激活，剩余1天"；②APP内"前往激活"→显示"激活成功"，退出重开依旧弹"授权到期"无法登录；③审核界面默认自动选"机构版-一年"，激活天数手动改1天。
* **根因（三条叠加）**：
  - **双源有效期分裂**：license 按"激活时刻+days"精确时间戳过期（06:21:58），云端诊所账户按自然日 23:59:59 过期（admin-approve 两条路径各写各的）→ 同一天内存在"APP已过期、网页仍有效"的窗口，用户感知为漏洞。
  - **假激活**：admin-status.js 的 activated 分支只看记录 status，不解码 license 文件校验 expiresAt → 过期 license 照样下发 → 客户端"前往激活"成功装回过期 license，重启即弹"授权到期"（激活成功的假象）。
  - **validate.js 无过期拦截**：激活码重激活不检查 license 过期，且旧逻辑可刷新 activatedAt（锚定漂移=重激活续命）。
* **修复（服务端三层 + 客户端三层纵深防御）**：
  1. `validate.js`：重激活前解码 license 检查过期，过期返回 403 `LICENSE_EXPIRED`（"该授权已于 xx 到期，重新激活无法恢复使用，请联系客服续费"）+ 写 license_log `reactivate-denied-expired`；重激活**不刷 activatedAt**（改写 lastReactivatedAt 审计），firstActivatedAt 缺失时锚定旧 activatedAt 防漂移。
  2. `admin-status.js`：activated 分支解码 licenseBase64 检查 expiresAt，过期返回新状态 `license_expired`（不下发 license），message 携带到期日与续费指引。
  3. `admin-approve.js`：licenseRecord 显式写 `firstActivatedAt`（审核时刻），锚点来源统一。
  4. `users.js` + `site-admin/admin/index.html`：离线版诊所（edition 以 offline_ 开头）改 expiresAt 时返回/展示 warning——"诊所到期日仅影响云端账户/官网登录，离线端 license 不自动延期，续期需重签 license"。
  5. `MainActivity.java`（离线APP）：激活码激活后调 `LicenseInstallValidator.applySelfVerify`，验证失败硬拦截（success=false + verifyType/verifyDetail）。
  6. `activation-observer.js` + `auth-core/offline.js`：observer 识别 `license_expired` 触发 terminal 停轮询；offline.js 新增 `renderAdminRejected(reason, isExpired)`——拒绝面板复用渲染，expired 时标题改"授权已过期"、隐藏"修改后重新提交"按钮；三处消费点（submit 成功/startPolling observer/旧 setInterval 兜底）全接。
* **铁律**：
  - **license 的 expiresAt 与诊所 clinic.expiresAt 是两个独立时间源，任何"有效期"操作（审核/续费/修改到期日）都必须同时回答两个问题：云端账户到几时？license 到几时？两者不一致时必须显式警示，禁止静默只改一边。**
  - **下发 license 的每个出口（admin-status/validate/任何新接口）必须解码文件本体校验 expiresAt 后再下发——只信记录 status 字段=假激活；重激活类接口必须拒绝过期 license（防续命）且不得刷新首次激活锚点。**
  - **客户端收到"激活成功"结果后必须本地自验 license 再展示成功（服务端修复与客户端自验互为纵深，任一失效仍有拦截）。**
* **生效方式**：服务端三层（validate/admin-status/admin-approve/users）push 即部署生效（含旧版 APK 亦被保护）；客户端三层（MainActivity 自验 + observer/offline.js license_expired UI）需重打**离线APP APK**（云端两端无此路径不需要重打；离线桌面走 auth-core 副本，下次打包生效）。

### ★ 2026-09-12 P0 到期重激活「本地写入失败：未知错误」根治（09-11 服务端修复的客户端配套三层）

* **现象**：到期客户续费（管理员重审/重签 license）后重新激活，弹「激活已通过，但本地写入失败：未知错误」，新码永远装不进只能找客服人工；且过期提示原样显示 ISO UTC（`2026-09-10T22:21:58.727Z`）客户完全看不懂。
* **根因（两条叠加）**：①Android 桥 `installLicenseFromServer` 快路径 `readLicense(mid)!=null`（仅判 license.dat 文件存在）即返回 already_licensed——过期码照样"已授权"拒装新码 → JS 自验发现旧码过期 → inst 不成功 → 兜底文案一律"未知错误"；②失败文案不区分"校验未通过（过期）"与"真未知异常"，时间展示不做时区格式化。
* **修复（A+B+C，与 09-11 服务端修复互为纵深）**：
  1. `LicenseManager.java`（离线APP）：①already_licensed 快路径先 `validateLicense`，valid 且 type=licensed 才短路；过期/失效放行走服务端重装覆盖。**保留 readLicense 判空守卫**（license.dat 缺失时不得进 validateLicense——其试用分支会创建 trial 记录+联网，属装码桥不应有副作用）。②admin-status 新态 `license_expired` 单独透传（旧逻辑当 pending 显示"订单审核中"误导，JS renderAdminRejected 已有消费渲染）。③`formatBeijingTime` 到期消息北京时间+已过期天数，valid/提示消息同样格式化（失败回退原始 ISO 串，宁丑勿空）。
  2. `auth-core/offline.js` **三处装码点**（主装码 onAdminActivated/断点续传/存量自愈）：already_licensed 不直接置成功——挂标记，响应带 license 先走 `installAdminLicense` 直装覆盖（到期重签场景靠这里落新码），再 JS 侧自验（validate/getStatus），自验通过才补成功；存量自愈 already_licensed 自验失效转 `__healQueryAndInstall` 服务端补装。失败文案区分「本机授权校验未通过（可能已过期）」+「返回上一步重新提交；多次失败将机器ID发客服」指引。
  3. `shared/license/license-manager.js`：`formatExpireBeijing` 北京时间+已过期天数（与 validate.js `__expBJ` 同语义），valid 消息同样显示格式化到期。
* **铁律**：
  - **「already_licensed/已存在」类短路返回必须先验有效性（文件存在≠有效）——否则续费重签的新码永远装不进，客户被迫人工。**
  - **装码成功 = 桥 installed ∨（already_licensed ∧ 本地自验通过）∨ 直装成功 ∧ 自验通过；三处装码点（主流程/断点续传/自愈）防御必须同步改，漏一处=该路径"假激活/假失败"复活。**
  - **面向客户的失败文案必须区分「校验未通过（过期/失效）」与「未知异常」并给下一步指引；时间戳展示一律北京时间格式化，禁止裸 ISO UTC。**
* **验证**：Java 全量编译 exit 0；probe-param-matrix 19/19；copy-consistency 50/50；smoke-runtime 26/26；check-interface 6 OK；auth-core 11 副本 + shared 全组同步绿灯。
* **生效方式**：离线APP 需重打 **APK**（Java 桥+assets 双改）；离线桌面需重打 **exe**（auth-core+license-manager 副本）；云桌面需重打 **exe**（license-manager 副本，到期消息格式化）；云端网页/云端APP 无需重打（cloud.js 未改，云端 license 由服务端裁决）；服务端本轮无改动（09-11 已修，push 即生效）。

### ★ 2026-09-12 双源有效期到期恢复闭环（纯运维路径，实测验证）

* **场景**：离线客户续费只延了诊所表（clinic=update 收费动作），license 时间源未动 → APP 弹「授权已过期」进不去，但后台显示有效期正常（用户困惑点）。
* **恢复三步（零代码）**：①后台「激活码 → 批量延期」，`newExpiresAt` 填诊所表同到期日；②APP（≥V278，含 A+B+C 修复）重新输入激活码——validate 重激活走 `buildLicenseData`：`record.expiresAt`（续费值）晚于「首次激活+days」锚定值时**取较晚者**，新 license 与诊所表对齐；③完全退出重启 APP 验证。
* **实测**：激活1中医诊所（测试码 days=1 于 09-11 过期，重激活被防续命正确拦截）09-12 按此路径恢复成功，license 至 2027-09-12。
* **已根治（同日）**：「一处续费、两端同步」已实现——clinic=update 收费动作对 offline_* 诊所按 clinicName 反查关联激活码（复用座席反查）自动同步延期，无需再走本节手工三步：
  - **users.js**：expiresAt 三路径（转正自动 365 天 / renewDays 顺延 / 直填）任一变更 + `edition=offline_*` → `listLicenses` 按 `oldClinic.name` 反查（**反查用旧名**：license.clinicName 是激活时绑定的名字，改名不追溯），匹配码（排除 disabled/unused）同步 `record.expiresAt=诊所新到期日`，过期码复活为 used（extend.js 同规则）；写 license_log `action=extend` + 审计 changes 带 `license 同步延期` 条目；同步失败不阻断诊所更新（warning 兜底提示手动批量延期）。响应带 `licenseSync:{synced,codes,expiresAt}`。
  - **admin-status.js + license-write-service.js `ensureLicenseRenewed`**：下发出口升级为「续费感知」——admin_req.licenseBase64 是审核那一刻固化文件，过期分支发现权威 `license:{code}` 已续费时**确定性重签**新文件按 activated 下发（与 ensureLicenseV7 同参数：admin_req 的 clinicName/machineId 三因子绑定；重签确定性=锚点重算取 max(锚定+days, record.expiresAt)，无续命窗口）。**客户端联网零操作自愈**（轮询/存量自愈/installLicenseFromServer 全走此出口），旧版客户端判 `status==='activated'` 同样落盘新文件，双版本兼容。
  - **验证**：node 三文件语法 OK；check-interface 6 OK；probe-param-matrix 19/19；功能数学验证——续费后重签 expiresAt=2027-09-12（取同步值），未续费重签仍锚定过期日（防续命语义保持）。
  - **生效方式**：纯服务端 4 文件改动，push 即部署（Cloudflare Pages 自动），五端零重打包；后台消息展示同步结果（site-admin JS 逻辑改动，强刷生效）。

### 历史经验归档索引（2026-09-12 二轮梳理）

* 下载提速 v1→v4 全程（含原 §10 尾部 v1/v2 两条）、发布链路假成功×2、CI 红灯复盘、E2E TDZ 竞态、铁闸冒烟连环雷、开放前安全审查、后台 edition 误判、APK 版本号 SSOT 原始过程 → **`.trae/archive/2026-08-31-09-03-misc-experiences.md`**（现行规则已收口至 §2/§5/§9/§10/§18 对应条目）
* 付款按钮三层递进 openPayUrlRobust、Mate 70 付款系列（二~六补）、激活审核 edition 错标 → **`.trae/archive/2026-08-30-09-04-pay-activation-cases.md`**（文末「二轮梳理追加」段）

## 12. 已废弃规则（防误用，勿再执行）

* 媒体存储 v0（安装目录 downloads，NSIS 重装清空）和 v1（%APPDATA%）已被 v2/v3「惠康中医媒体」布局取代，仅作历史位置兼容读取。

* 媒体文件曾「不纳入一键备份」（历史版本 exportData 提示"照片和视频不包含在内"），2026-08-30 已实现照片视频纳入备份，该行为作废。

## 13. APP 照片视频备份（2026-08-30 已实现）

**动机**：APP 媒体存应用专属目录 getExternalFilesDir（卸载即清空），用户选择照片视频纳入一键备份防止丢失。
**存储位置**：媒体备份到公共 `Downloads/中医处方系统/media/YYYY-MM/`（与 JSON 文本备份同在「中医处方系统」文件夹，整个文件夹一起拷走即可换机）。文字 JSON 备份仍在 `Downloads/中医处方系统/` 根。
**原生桥（离线 com.benneng.pres + 云端 com.tcm.prescription MainActivity 双份一致）**：

* `backupMedia()`：遍历 getAllMediaDirs()（图片+视频目录，含新旧命名兼容），按 YYYY-MM 子目录复制；Android 10+ 走 MediaStore.Downloads（RELATIVE\_PATH），Android 9- 直接文件复制；同名同大小去重（mediaFileExistsInDownloads）。返回 {success,copied,skipped,totalBytes}。

* `restoreMedia()`：读公共 `media/`，按扩展名路由恢复——`.webm/.mp4` → getVideoDir()，其余 → getImageDir()，保留 YYYY-MM 子目录；同名同大小跳过。返回 {success,restored,skipped,message}。

* 复制用 32768 字节缓冲二进制流，**禁止 JSON base64**（大文件内存溢出）。
  **JS 接入（public/index.html 权威源 + 6 份副本）**：exportData 调 `window.electronAPI.backupMedia()`（弹窗显示复制 MB/已最新/跳过）；importDataFromJson 调 `window.electronAPI.restoreMedia()`（弹窗显示恢复数）。防御式判断 `window.electronAPI && typeof window.electronAPI.backupMedia === 'function'`。
  **验证**：重打离线/云端 APK 后解包 grep `assets/public/index.html` 含 backupMedia/restoreMedia/照片视频备份 标记 + classes.dex 存在。

* 登录框「默认蓝+JS按版本切紫」机制已废弃，全端统一紫。

* 「按版本区分底部导航取消按钮」规则已废弃，现为**按角色动态显示**；「本地版」产品线已取消不再提供。

* 录像功能命令行开关（use-fake-ui-for-media-stream/enable-media-stream/allow-file-access-from-files）已废弃，权限在 main.js 用原生 Electron API 授予。

* 登录框记住密码功能不存在：永远需要输入用户名和密码登录。注册时真实手机号/医师姓名不记忆，仅记忆通用用户名。

## 14. 鸿蒙 NEXT 适配（⏸️ 2026-09-12 搁置：近期不开发不上架；产物与签名材料已齐，可随时重启）

**⏸️ 搁置决策（2026-09-12）**：鸿蒙适配暂时搁置，近期不在开发上架。搁置时状态：Week1-3 已闭环编译、模拟器首跑成功、企业发布签名 HAP 已产出（`惠康中医-鸿蒙云端-发布签名.hap`，1.45MB，项目根目录）——工程/桥/签名全部就绪，**重启即从真机功能验证开始，无需返工**。全部过程细节（Week1/2 两轮审查修复、RSA→ECC 签名演进、模拟器 Win11 虚拟化踩坑、AGC 认证路径、B 方案选型论证）→ 归档索引见本节末尾。

**重启时必读铁律（浓缩 8 条）**：

1. **发布签名强制 ECC P-256 + SHA256withECDSA**（hvigor schema signAlg 只认这个，RSA2048 报错）；build-profile signingConfigs 密码须 ≥32 字符 DevEco 加密格式 → 绕过：signingConfigs 置空出 unsigned，`hap-sign-tool sign-app -mode localSign` 明文密码签名（完整命令模板见归档）。
2. 签名材料在 `app_project_harmony/huikang-cloud/sign-materials/`（p12 + cer[2029-09-06 到期] + p7b，已 gitignore）；口令在本地 `口令备忘.txt`，**绝不入库、KNOWLEDGE 不记录**。
3. 工程零改动铁律：鸿蒙全部代码独立 `app_project_harmony/`，**安卓工程只读**，`copy-assets.cjs` 字节级拷贝；双包 = huikang-cloud（bundleName com.tcm.prescription，加载 pages.dev，22 桥全实现）+ huikang-offline（待建，rawfile 本地页 + 5 个离线独有桥）。
4. 主体一致性铁律：软著著作权人、APP 备案主体、AGC 开发者三者必须同为「高碑店惠康堂中医诊所有限公司」（企业认证已过，账号即此主体）。
5. 命令行编译：`$env:DEVECO_SDK_HOME="D:\Program Files\Huawei\DevEco Studio\sdk"` → `node "...hvigor\bin\hvigorw.js" --mode module -p product=default assembleHap --no-daemon`；**本地模拟器接受未签名 HAP**（`hdc app install` 直接装，无需证书）。
6. **onLoadIntercept 对所有请求回调**（含 img/script/xhr），必须 `event.data.isMainFrame()` 判断，非主框架放行；URL 白名单**禁止 startsWith** 前缀匹配（`pages.dev.evil.com` 可绕过），用正则取 host 严格相等。
7. **fs.readSync 到文件尾返回 0 不是 -1**，readNextChunk 须 `read <= 0` 判 EOF；敏感操作（readFileAsBase64/deleteFile）必须 isCallerAllowed host 校验 + 路径白名单 normalizePath 消 `../`。
8. ArkTS API 坑速查：事件名 `onAlert/onConfirm/onPrompt/onShowFileSelector`（prompt 输入值是 handlePromptConfirm(v)）；执行 JS 是 `runJavaScript`；picker 是 `maxSelectNumber`；LoadingProgress 用 `.width(48).height(48)`；严禁 any/unknown，JSON 参数用 `Record<string, Object>` + optStr。

**重启优先级路线（搁置时剩余缺口）**：

| 优先级 | 任务 | 工期 | 依赖 |
|--------|------|------|------|
| P1 | 真机功能验证（媒体拍照录像/分片/备份导出/打印降级/P1-6 安全链路） | 3-5 真机测试日 | 已签名 HAP ✅ |
| P2 | 离线版 huikang-offline 新建（EntryAbility + 5 离线桥 + 试用激活链路） | 1 周 | 云端版先跑通 |
| P3 | 上架发布（软著下证 + 诊所执照备案 + HEM 企业主认证 + 定向发布名单） | 2-3 周并行 | P1 验证过 |
| P4 | 长期迭代：PrintDocumentAdapter+PDF、SaveButton 媒体持久化、ArkTS 混淆、API27+ | 持续 | 上架后 |

**鸿蒙真机必验清单（模拟器不覆盖，重启第一批测试项）**：

* 🔴 256KB 分片在鸿蒙调用栈表现（录像分片上传 10+ 片不溢出）
* 🟡 相机权限模型（savePrescriptionImage 调相机 → base64 → 沙箱落盘）
* 🟡 sendData/viewData 沙箱 URI 分享兼容性（备份导出）+ viewData(text/html) @page A5 打印效果
* 🟢 isCallerAllowed 桥代理线程调 getUrl() 安全性；ArkWeb onLoadIntercept 子资源是否真的全放行（isMainFrame 守卫已加）

**与现有项目联动（搁置期间仍生效）**：prescription-core/auth-core 等 shared JS 走 `sync-all.ps1` 分发，鸿蒙 rawfile 副本随分发自动更新（副本在仓库**不删**，同步规则不受搁置影响）；CSP 含 pages.dev 通配要求同云端系 3 份。

### 历史过程归档索引（2026-09-12 三轮梳理）

* Week1-3 全过程（环境搭建/命令行编译/22 桥实现/两轮 Seed-2.1-Pro 审查修复/沙箱布局/P1-6 实现/RSA→ECC 签名演进/hvigor 密码门/AGC 路径/Win11 家庭版虚拟化坑/hdc 工具链/模拟器首跑/B 方案选型论证与工程结构图）→ **`.trae/archive/2026-09-01-06-harmony-week123-arch-log.md`**（原 §14 全文一字未改迁入）
## 15. 处方签煎煮方法（2026-09-01 已实现）

**需求**：按最新中药煎煮规范，处方签药物显示煎煮方法（先煎/后下/包煎/烊化等）。

**实现方案（方案A·药库预设）**：

* 药品对象新增 `jianfa` 字段（`shared/prescription-core.js` 权威源 `createEmptyMedicine`/`buildPrescriptionRecord`）。

* 煎煮方法清单常量 `JIANFA_OPTIONS`：`['普通煎','先煎','后下','包煎','烊化','另煎','冲服','煎汤代水','兑服']`，默认「普通煎（默认）」。

* 全链路数据传递：药库编辑弹窗新增煎煮下拉框（`medEditJianfa`）→ 保存进药库 → 开方选中 `selectMedicine` 自动带入 → 处方笺渲染 `updatePrescriptionPaper` 若非普通煎则标 `（先煎）` → 打印 `prescriptionPaper.innerHTML` 自动带上 → 历史/验方回填保留。

**同步范围（改动必查）**：

* 6 份 `index.html`：权威源 `public/index.html`，其余 5 份（云桌面/云端APP/离线APP/离线桌面/index-app打包源）手动同步 R3 编辑弹窗下拉框。

* prescription-core.js 走 `tools/sync-all.ps1` 分发（含 site-admin/electron/鸿蒙 rawfile 等散落副本）。

* `tools/html-sync-check.ps1`（authority → cloud copy）与 `tools/check-interface.ps1` 校验必须通过。

**经验**：改 index.html 时若权威源比副本多注释行会触发 html-sync-check 报 DRIFT（行错位），需把注释/赋值行同步到各副本；`medEditJianfa` 每份应出现 3 次（R3 下拉框 + 编辑填充 + 保存获取）。

**★ 2026-09-01 二期：药典规则自动匹配（免手动选择）**：

* 规则表 `JIANFA_RULES` + 匹配函数 `getAutoJianfa(name)` 沉淀在 `shared/prescription-core.js`（依据 2020版《中国药典》/《中药学》教材，约 60 味：矿物贝壳先煎 / 芳香挥发后下 / 种子花粉包煎 / 胶类烊化 / 贵细另煎 / 粉末冲服 / 灶心土煎汤代水 / 姜汁兑服）。

* 生效优先级（各端 `getEffectiveJianfa(med, name)` helper）：**药库手动设置(非普通煎) > 规则表自动匹配 > 普通煎**；支持「煅龙骨/生石膏/炒车前子」炮制前缀（长关键词包含匹配，精确命中优先）。

* 误匹配防护：`JIANFA_EXCLUDE = ['香附','肉豆蔻']`（防"香附子"命中"附子"先煎、"肉豆蔻"命中"豆蔻"后下）；精确表已防"珍珠母→珍珠冲服"、"龟甲胶→龟甲先煎"（长键优先）。

* 调用点 7 处/份：selectMedicine 带入、历史回填、验方回填、药库列表显示、编辑弹窗初值、medEditName oninput 自动建议（用户已手动改过不覆盖）+ helper 本身；harmony rawfile 旧版仅 4 处。

* 坑：cloud\_app assets 的 prescription-core.js **不在 sync-all.ps1 分发清单内**（上一轮 commit 漏同步导致云端APP无煎法），连同 harmony rawfile、site-admin 三份脱管副本需手动 `Copy-Item shared\prescription-core.js` 覆盖；批量改副本用临时 Node 脚本（精确替换+命中次数校验+CRLF 适配），跑完即删。

## 16. 诊断快速输入（2026-09-01 已实现 · 中医诊断学+GB/T15657）

**需求**：诊断输入框根据《中医诊断学》《中医病证分类与代码》(GB/T15657) 实现快速录入，减少逐字手打，适配 APP / 云端网页 / 桌面三端。

**权威实现源**：`shared/symptom-dict.js`（诊断模块与症状词典 IIFE 并排，末尾 IIFE 内：DISEASE 病名约 177 项 / SYNDROMES 证型约 144 项 / COMBOS 高频组合约 286 项 + 面板/下拉/快捷键逻辑，全部运行时注入，HTML DOM 零改动。权威源经 `sync-all.ps1` 分发 6 份副本：`public/`、`public/electron/`、`app_project/db-yunduan/cloud_desktop/`、`.../cloud_desktop/electron/`、`app_project/db-offline/desktop/`、`db-offline/app/.../public/`）。

**功能清单**：

* **诊断框下拉建议（最多 12 条）**：

  * 索引 = 拼音简码前缀匹配 + 中文包含匹配；示例：输入 `gm` → 感冒 / 感冒（风热犯表）…；输入 `风` → 风寒束表 / 风热犯肺 …

  * ↑↓ 切换 / Enter 填入 / Esc 关闭；失焦自动隐藏；最近 12 条使用记录 localStorage 缓存（key=`diag_mru_v1`，容量 12；排序公式= `count*3 + ageDecay(ts)`，高频优先 + 最近使用（MRU）双重排序）。

* **诊断面板（Alt+D 唤起，也可点击诊断框右方运行时注入的胶囊「诊断」按钮）**：

  * 三组 Tab：📋 高频组合（点一下直接填入）/ 🏥 病名分类（多选）/ 🧭 证型分类（多选）；组合模式三种：「病名+证型（默认，自动加中文括号）」/「仅病名」/「仅证型」；一键确认回填 `#diagnosis`。

  * 分类体系：病名 11 类（肺系/心系/脾胃/肝胆/肾系膀胱/气血津液/经络肢体/外科/妇科/儿科/五官科）；证型 6 类（八纲/脏腑/六经/卫气营血/三焦/气血津液·六淫）。

* **舌脉体征（Alt+S 既有）与诊断独立区分**：Alt+S 症状面板独立，Alt+D 诊断面板独立注入到「诊断」标签右方，互不污染。

* **界面零改动纪律**：所有按钮、下拉层、面板、布局样式均 DOMContentLoaded 后 JS createElement 注入，不修改 index.html `<body>` 内结构；`check-interface.ps1` 基线必须全绿。

**同步&校验（改动必查）**：

* 权威源 `public/index.html` 注释里**禁止出现字面量** **`<script>`**（否则自定义 script-extractor 会误识别为内联 JS，假阴性失败；写法= `[script]`）。

* symptom-dict.js 走 `tools/sync-all.ps1` 分发（Business JS 9 份组）；`sync-all -VerifyOnly` 必须全部 In sync。

* 若改 `#diagnosis` 输入框属性，`html-sync-check.ps1` + `check-index-consistency.ps1` 必须双绿；Alt+D、下拉、布局样式均在 symptom-dict 内注入，不用改 DOM。

**数据扩展方法**：

* 在 symptom-dict.js 的 `DISEASE / SYNDROMES / COMBOS` 数组 push `{t:'诊断文本', c:'拼音简码小写无空格'}`（例：`{t:'风热犯肺', c:'frfanfei'}`）。

* 高频组合格式=「病名（证型）」整句，优先出现在下拉首条，用户点选后无需再开面板。

* 最近使用：localStorage key `diag_mru_v1`（`[{t, ts, count}]`，容量 12）。

## 16.1 诊断行布局（2026-09-01 补充：框扩大 + 剂数缩短 1/2）

**需求**：完美显示诊断框（让长串「不寐（心肾不交），心悸（心虚胆怯）…」完整显示）；剂数输入框原宽 42px 太长，仅显示 1\~2 位数字，需缩短至原长度约 1/2。

**实现（HTML 零改动 · 运行时注入 #diagQuickLayout** **<style>）**：

* 入口：`shared/symptom-dict.js` 诊断模块 `ensureDD()` 首步执行 `_injectLayout()`（只注入一次，通过 `_layoutInjected` 守卫）。

* 关键样式覆盖（带 `!important` 压过 index.html 内联基线）：

  * `input#diagnosis`：`flex-basis: 183px → 380px`；响应式 `≤1280px=260px / ≤1024px=200px`；`min-width: 30 → 120px`；`max-width:none` 允许充分撑开。

  * `input#doseCountInput3`：`width 42px → 22px`（=约 42 的 1/2）；`text-align:center` + padding 缩紧，放数字 7\~99 不挤。

  * 诊断行 `.patient-row`：`gap=2`；`.patient-label` `45 → 40px`；`#diagQuickBtn`（胶囊）右方补 `12px margin`，让按钮不贴剂数框。

**三端生效方式（与 §16 诊断词典一致）**：

| 端          | 来源                                        | 是否重打包           | 说明                                |
| ---------- | ----------------------------------------- | --------------- | --------------------------------- |
| 云端网页       | `public/` + Pages 部署                      | ❌ git push 自动生效 | 清浏览器缓存即可                          |
| 云端 APP     | 线上 WebView                                | ❌               | 同上                                |
| 云桌面 / 离线桌面 | `app_project/db-*/desktop/`（sync-all 已同步） | 若旧 exe → 重打     | 下次 `build-app.bat` 自动纳入；源码本地打开即生效 |
| 离线 APP     | APK 打包源                                   | 若旧 APK → 重打     | 不重打=下次打包自动纳入                      |

## 16.2 处方签「病史症状」栏显示/隐藏开关（2026-09-01）

**需求**：处方签（预览+打印）的「病史症状」栏可勾选显示/隐藏；**默认隐藏**，打印处方时不出该栏。

**权威实现源**：`shared/prescription-core.js` 末尾追加的独立 IIFE（`__paperHistoryToggleLoaded` 防重复），HTML 零改动、运行时注入。

**实现要点**：

* 处方签行定位：`#paperMedicalHistory` 向上 `closest('div')`（该行 div 内含文本 span+下划分隔线，整行隐藏=栏目隐藏）。

* 显示/隐藏 = 对行 div 写 `style.display=''/'none'`——**打印取** **`#prescriptionPaper.innerHTML`**（printPrescription），内联 display:none 随 innerHTML 携带进打印窗口 → 屏幕/打印所见即所得，无需改打印 HTML 模板。

* 勾选框注入位置：左栏 `.symptom-section .history-tabs` 行右端（`margin-left:auto`），**不在 #prescriptionPaper 内，永不进打印**；`.history-tab` 无 JS 点击绑定，追加 label 无冲突。

* 持久化：localStorage key `local_paperShowHistory`（'1'=显示，默认/其他=隐藏）。

* 打印兜底：后台重试包裹 `window.printPrescription`（内联脚本后定义，本模块先加载；`__histWrapped` 防重复包裹），进打印前再 apply 一次防复位。

* 导出 API：`window.PaperHistoryToggle = { isShown, setShown, apply }`。

**同步注意**：prescription-core.js 在 sync-all 之外的脱管副本（cloud\_app assets、harmony rawfile、site-admin + site-admin/electron）改完必须手动覆盖（`Copy-Item shared\prescription-core.js`）；build/intermediates 与 .build-cache 为构建产物不用管。

**坑（第 3 次复现，已根治）**：会话恢复快照会静默回退工作区 `.trae/KNOWLEDGE.md`（§16 系列共被吞 3 次，HEAD 始终仍在）。**2026-09-01 根治**：`tools/source-settled.ps1` 门禁内置「快照回退自动愈合」——`$SnapshotRevertAutoRestore` 清单内文档（KNOWLEDGE/decisions/history\_bug\_summary/project\_rules×2/skill-optimize）命中「纯删除 diff」签名（`git diff HEAD --numstat` 增=0 且删>0）时，自动 `git checkout HEAD --` 恢复并放行打包；清单外源码文件纯删除仍拦截但在 blocker 里附恢复命令提示（防误吞有意删除的半成品）。三个打包入口（ensure-build-env/release-menu/one-click-pack）+ publish-release.js 的 -Assert 出口全部自动受益。手工规则仍保留兜底：开工 `git status` 发现 KNOWLEDGE.md 显示 M 且比 HEAD 短 → `git checkout -- .trae/KNOWLEDGE.md`。

**坑（BOM 丢失，2026-09-01 新发现）**：AI 编辑工具重写含中文注释的 `.ps1` 会丢失 UTF-8 BOM → Windows PowerShell 5.1 按 ANSI 误读，中文乱码字节可吞掉紧邻的换行/括号导致「Unexpected token」假解析错误（报错行号与实际内容对不上）。修复：`[System.IO.File]::WriteAllText($p, $c, (New-Object System.Text.UTF8Encoding $true))` 补回 BOM。改完 .ps1 必须实跑一次验证可解析，不能只看内容。

**坑（dot-source param 覆盖 + EAP=Stop stderr 地雷，2026-09-01 双连雷，已修复）**：① 被 dot-source 的 `.ps1` 若顶部有 `param([string]$RepoRoot = '')`，默认值 `''` 会**写进调用方作用域覆盖同名变量**（ensure-build-env.ps1 的 $RepoRoot 被清空 → Join-Path 空串崩溃）——dot-source 类库脚本 param 必须带前缀防碰撞（已改 `$SettledRepoRoot`），这是 2026-08-31 收敛单源时埋的雷，因外层门禁一直先拦从未触发，本次外层放行后首炸。② 调用方 `$ErrorActionPreference='Stop'` 时，native 命令（git）stderr 经 `2>$null` 重定向会把首行 stderr（CRLF warning 即可）升级为终止性 NativeCommandError——source-settled.ps1 所有 git 调用统一走 `Invoke-GitQuiet`（临时降 EAP=Continue + 静默 stderr）。**教训：PS 门禁脚本改动必须以「子进程完整实跑 ensure-build-env.ps1」验收**，函数级单测测不出作用域/EAP 交互问题（dot-source 后函数错误还误报为 ensure-build-env.ps1 自身参数错误，需看 InvocationInfo 内层 ScriptName 才能定位真凶）。



* ★ 2026-09-05 卸载器报「安装损毁: 无效的操作代码」根因根治（1.0.176~1.0.185 全中，Commit 4996430f 删除宏 + 1.0.186 重打包验证）：db-offline/desktop/installer.nsh 的 customUnInit 宏（51cbe32d 引入的"卸载时弹框清理 userData"）内 Goto +8 / Goto +6 **相对跳转越出宏边界**（宏仅 9 条指令，目标为第 12 条），跳过 FunctionEnd 落入下一个函数 un.atomicRMDir 体中段（Exch/Push/Pop 栈帧错位），隐式 Return 弹出垃圾值当返回地址 → NSIS VM 报 Invalid opcode（**点「否」保留数据或 userData 目录不存在时触发**；点「是」删除走 IDYES 正常路径不崩——所以间歇出现、难复现）。修复=整体删除该宏（清登录框遗留用户名的正确姿势=关闭软件后删除/改名 %APPDATA%\tcm-prescription，无需卸载器挂钩；且此清理目标可由应用层启动时实现）。铁律：①**自定义 NSIS 宏内跳转必须用宏内标签**（标签编译期消除，与 customInit 的 tryE/done 同模式），**禁止相对跳转 +N**——宏展开处后续指令随 electron-builder 模板版本变化，越界跳进别的函数体且编译期无法发现，运行时直接"安装损毁"；②NSIS 宏名**不区分大小写**（customUninit=customUnInit，makensis 3.0.4.1 实测），勿靠大小写区分功能，写宏名应与模板引用完全一致；③E2E 只测应用运行时不测卸载器——"卸载体验类"改动现有门禁全部覆盖不到，发布前必须人工实测一次完整卸载（重点测非默认路径：点「否」/目录不存在）；④存量用户机器上旧版卸载崩溃自救 SOP=重跑新版 Setup 覆盖安装（重写卸载器+注册表）后再卸载，或直接手动删除安装目录；⑤「安装损毁: 无效的操作代码」与中途红黄字不同，属于**真故障**（不在 145 行无害清单内），用户报此错=卸载器指令流已损坏，必须查自定义宏。

## 16.3 药品库存管理（2026-09-11 P1+P2 上线；09-12 预警集中设置）

**架构（shared/stock-core.js，IIFE 注入式，8 副本同构）**：处方扣减引擎（用量×剂数，`__stockApplied` 幂等标记差值冲正）+ 出入库流水（stock\_ledger\_v1 cap 3000）+ 库存预警（`medicines[].stockThreshold`，0=不预警）+ 基础设置开关（local\_stockMgmtEnabled，默认关）。活数组直改 + localStorage 镜像 + electron saveMedicinesToDisk 三层同源；`getMedArrayLive` 按标识符直读（CSP 禁 unsafe-eval，禁 new Function/eval）。

**★ 2026-09-12 预警阈值集中设置（commit 74aaa8af）**：原入口藏在每药编辑弹窗（逐个点开不可操作）→ 药品管理库存分组新增紫钮「🔔 预警设置」（`openThresholdDialog`，640px 宽表）：①全部药品表格化一览（药名/当前库存/阈值输入/状态列）+ 搜索过滤；②批量：统一阈值「应用到全部/仅未设置项/全部清空」（`applyThresholdBatch` all/empty/clear）；③行内输入实时变色 + 顶部统计（已设阈值 N 个·低于预警 M 个，按输入框值实时汇总）；④保存 `confirmThresholdSave` 批量写 stockThreshold → persistList → renderMedicineList（列表红字）+ updateStockBadges（tab 红点）→ toast 汇总。`openInjectedModal` 加第 5 参 maxWidth（默认 460px 不变，向后兼容）。药品多时表格区滚动（modal-body overflow:auto）。**生效**：云端网页部署刷新即得；云桌面线上刷新即得（重打包后离线副本永久生效）；云端APP/离线APP/离线桌面需重打包。

**同步**：stock-core.js 走 sync-all.ps1 Business JS 组（6 副本）+ 手工 2 副本（cloud\_app assets、harmony rawfile）= copy-consistency.cjs 专用组全量校验 8 副本，漂移在 pre-push 第⑦道门拦截。

## 17. 下载转化统计（2026-09-09 已实现，commit 40e54baf）

**架构（四层漏斗）**：官网下载量（GitHub Release 资产 download\_count，服务端 KV 缓存 1h 防 API 限流）→ 安装启动设备（四端匿名心跳）→ 提交激活申请（admin\_req\_index 状态计数）→ 已激活设备（admin\_req activated ∪ license devices 的 machineId 并集）+ 三级转化率。

**心跳链路**：四端客户端复用既有「启动检查更新」时机上报 POST /api/telemetry/heartbeat {ed, v, mid}。双桌面 main.js sendStartupHeartbeat（机器码 sha256）；双 APP MainActivity（ANDROID\_ID sha256，零新增权限）。服务端 KV `tl_dev:{ed}:{服务端二次哈希}` = {first, last, days(修剪30天), v}，限流 240/h/IP，CORS 对齐 admin-status（file:// null + capacitor 放行）。

**隐私铁律**：机器码客户端先 sha256（服务端永不见原文）+ 服务端再哈希做 KV key（长度恒定 64hex 防注入）；不存 IP/手机号/任何个人信息。

**读取**：GET /api/stats/funnel（platform_admin，鉴权对齐 admin-list：`await parseAuthHeader(request, env)` + `isPlatformAdmin(user)`）。管理后台首页「诊所运营统计」之后「下载转化统计」区块（6 卡 + 转化率行 + 分端明细），loadFunnelStats 静默容错。

**数据口径注意**：①安装设备数从四端新版发布后才开始积累（老版本无心跳），下载量/激活申请为历史全量；②线上联调测试写入过 1 条假设备（local-desktop, v=0.0.0-test），统计里多 1 台属预期；③KV list 分页聚合在设备量大时（>数千）需关注耗时。

**生效方式**：服务端 + 管理后台 push 即部署生效；四端客户端需重新打包发布后才开始积累心跳数据。

## 18. 下载速度优化（2026-09-09 实测基线与统筹路线）

**三层模型（排障先分层归因，勿在机制层空转）**：①**源**——文件托管在哪（GitHub Release / CF Pages / R2 / 国内 OSS）；②**管道**——用户到源的网络路径（大陆访问海外源的跨境链路是硬瓶颈）；③**机制**——客户端下载方式（`<a>` 直下 / robustDownload 流式断点续传 / APP DownloadManager）。**机制层已到顶**（官网 robustDownload 六连接并行+看门狗+30 次重试、APP DownloadManager 进度+自动安装均已上线），后续瓶颈全在源与管道层。

**2026-09-09 实测基线（用户网络，同一时刻）**：GitHub Release 直连 = **0 B/s**（TLS 握手被重置，典型跨境干扰，历史"一直很快"属路由波动好运非稳定态）；CF Pages 静态 APK = **0.4-0.8 MB/s**（12MB 云端 APK 约 25-40 秒，此为 CF 免费版大陆访问常态天花板）；`/api/dl` CF Worker 代理（用户→CF→GitHub）= **0.5 MB/s**（206 Range 透传正常，比 GitHub 直连可靠）。**结论：三条海外路径全部 ≤1MB/s，桌面 78MB exe 至少 2-3 分钟且中断反复，APP 12MB 约 30 秒——用户感知"没变快"的根因是跨境管道，与 APP 端 DownloadManager 优化无关（其优化的是进度显示/自动安装体验）**。

**下载链路现状盘点**：①官网桌面 exe 卡 = latest.json → GitHub URL → safeDownload 自动套 `/api/dl` 同域代理 + robustDownload（失败回退 GitHub 直连）；②官网 APK 卡 = hash-manifest `url` 字段 → CF Pages 同源 `/downloads/*.apk`（09-02 已根治跨域跳转问题）+ robustDownload 并行；③APP 更新 = MainActivity 从 hash-manifest 提取 `url`（白名单校验 `/downloads/` 前缀）→ DownloadManager 应用内下载；④桌面客户端更新横幅 = ~~直跳 exe 直链（GitHub，未走 /api/dl 代理——GitHub 抽风时此路径最先死）~~ **2026-09-12 已修复（7776a65f）**：双桌面 main.js 横幅 exeUrl 白名单校验后包一层 `/api/dl?f=<直链>` 代理（与官网 safeDownload 同通道），预言成真——09-12 用户实测报「更新提示链接无法打开/自动关闭」，本机复现：直链下载停滞 1MB 长达 20 分钟（HEAD 200 可达但 GET 数据流卡死，Edge 失败导航不写 History 故痕迹全无，用户从错误页地址栏复制 URL）；代理同刻 Range 1MB 秒收完整。exe 无法上 CF Pages（25MiB 单文件硬限制，78-82MB 超限）。

**★ 2026-09-12 排查方法论沉淀（客户端外链下载类问题）**：①**HEAD 200 ≠ 链路可用**——跨境干扰只断数据流不断元信息，必须 Range GET 实测数据流（`curl -r 0-1048575` 或 HttpWebRequest AddRange）；②**Edge/Chrome History 数据库（urls+downloads 表）无痕迹 = 导航失败/下载从未开始**（失败导航不写库），有痕迹才有页面访问/下载记录——排查浏览器侧问题先复制 `User Data\Default\History`（含 -wal）二进制 Select-String 搜 URL 关键词；③**复现 shell.openExternal 用 Start-Process**（同底层 ShellExecuteW），无需动浏览器自动化；④**新入口接入已有资源时必须检查既有保护链**——8fa5769c 横幅直跳提速绕过了官网 safeDownload 代理保护=回退型事故，官网已有 /api/dl 方案时任何新的下载入口（横幅/APP/管理端）一律同通道；⑤**已发布旧版无法追补**——存量客户端横幅仍直链，受影响客户的出路=官网下载页手动下载（safeDownload 代理可靠），新版打包后才根治。

**统筹路线（按性价比）**：**P2 国内 OSS 才是唯一真提速路径**——腾讯云 COS / 阿里云 OSS **默认域名（\*.cos.\*.myqcloud.com）无需 ICP 备案**（备案仅自定义 CDN 域名需要），大陆直连 10MB/s+，78MB exe 约 10 秒；成本约 0.5 元/GB 下行（1000 次下载×80GB≈40 元/月，对收费产品可忽略）。**P1 R2（免费）只解决可靠性不解决速度**——R2 出口流量免费 + 无 25MiB 限制，可让 exe 摆脱 GitHub 依赖（CF↔GitHub 子请求环节消除），但用户↔CF 段速度仍 ≈0.5MB/s，且 r2.dev 域大陆同样不稳（需绑自定义域走 CF 边缘）。**P3 桌面差量更新**（electron-updater blockmap）——后续版本升级只下变化块（省 60-90% 流量），首次安装仍全量。**用户决策（2026-09-12）：OSS 暂不开通**——先用应用内并行下载（提速 40%+ 进度+自动安装），触发再议条件：下载量上来 / 用户再报下载慢；届时按本条 P2 方案直接实施。

**诊断技巧**：手机切蜂窝网络（4G/5G）对比 WiFi 下载速度——运营商国际出口常优于家宽，若蜂窝明显更快即证实瓶颈在跨境链路而非服务器。测速用 `curl -r 0-5242879 <url> -o NUL -w "%{speed_download}"`（5MB Range 采样，注意 CF Pages 静态文件对 Range 返回 200 全量不返回 206，测速仍有效但断点续传语义需以 /api/dl 代理为准）。

**★ 下载链路编码铁律（v1→v4 演进史已归档 `.trae/archive/2026-08-31-09-03-misc-experiences.md`）**：① 触发下载禁止 `window.location.href`（页面导航被 attachment 中断误报"网络错误"），必须隐藏 `<a>` 程序化 click；② 下载代理必须透传 Range 头（206+Content-Range+Expose-Headers），否则断点续传失效；③ 前端流式读取必须配看门狗（数据到达重置 15s 定时器、超时 AbortController.abort()——fetch 读流挂起不报错，没有看门狗永远卡死）；④ 跨境大文件 = 多连接并行分片+断点续传+看门狗三件套（v4 实测 0.7MB/s，较单流提升约 14 倍，75MB 约 2 分钟）；⑤ 优化前先实测 Range 支持度（`curl -r 0-99` 看 206 还是 200，"CF 静态资源支持分段"是危险假设）；⑥ 微信内置浏览器协议层拦截 APK MIME（技术绕不过），UA 检测 MicroMessenger → toast 引导「右上角···→在浏览器打开」；⑦ 未签名 exe 触发 SmartScreen 信誉警告属预期（根治唯一方案=购买代码签名证书：OV 需积累信誉，EV 立即消除警告），下载确认框预告知"点保留即可"。

**★ 2026-09-12 桌面应用内更新器（云+离线双桌面 main.js 同构落地）**：横幅「立即下载」旧链路 `window.open` → 系统浏览器单流（0.5MB/s 无进度、下完手动找文件）→ 新链路**主进程 4 连接并行分片下载**（v4 robustDownload 的 Node 版：net.fetch + Range 分片 + 每分片独立看门狗 25s + 指数退避重试 ≤6 + 数据到达即 `fsSync.writeSync(fd, buf, 0, len, offset)` 落盘）→ 横幅实时进度/速度（400ms 节流 executeJavaScript）→ 完成大小对账 → `shell.openPath` 自动开 NSIS 安装向导。**桥接技巧：横幅点击 `window.open(UPDATE_SCHEME)`（`kyt-desktop-update://start`），由登录窗口已有 `setWindowOpenHandler` 拦截该 scheme 启动下载——零 IPC/preload 改动**（scheme 不匹配注册协议直达 handler，deny 不开新窗）。失败回退官网下载页（safeDownload v4 兜底）+ 横幅「重试下载」。注意：**改动只对新版本生效**（存量旧版横幅仍是旧链路，已发布无法追补）。

**★ 2026-09-12 官网下载中心 APP 卡「更新说明」缺失根治**：根因=双缺陷叠加——①下载页 APP 卡（cloud-app/local）被 `isAppCard` 跳过 `updateCard` 的 notes 渲染，hash-manifest 回调又只写版本/日期/时间/大小、从不写更新说明；②hash-manifest.json 各节点本就无 `releaseNotes` 字段，发布脚本也未写入 → APP 卡更新说明永远停在 `-`，而桌面卡从 latest.json.releaseNotes 正常显示。修复=[publish-release.js](tools/publish-release.js) 生成一次 `releaseNotes` 同时写入 hash-manifest 各节点与 latest.json（来源统一，避免重复 git log）；下载页 APP 卡从 hash-manifest apk 节点 `renderNotesWithToggle` 渲染更新说明（与版本/日期同源，消除 latest.json 异步竞态）。**教训：public/download.html 2026-09-10 已写过读取逻辑但 site-official 未同步（双源漂移）+ 缺数据源两因叠加导致长期未生效**——官网 download.html 双源（public/site-official）的下载卡渲染逻辑与 hash-manifest 元数据必须同步修改。生效方式=云端网页部署后刷新即显；云桌面/云APP/离线桌面/离线APP 无需重打包。

**★ 2026-09-13 P0 更新模块架构收口三件套（同日完成，全部验证通过）**：

- **P0-1 桌面更新器抽模块**（详见 §2 update-manager.cjs 铁律条）：双 main.js 各 -250 行，shared/update-manager.cjs 成为唯一权威源（Group 12 + copy-consistency 哈希门）。
- **P0-3 元数据 SSOT 双收口**：①publish-release.js 的 latest.json 从「读旧文件→改字段→写回」改为 **hash-manifest 节点纯投影**（version/releaseNotes/url 全部派生自同一次生成，latest.json 沦为只读派生品，双写方格式漂移从机制上消除）；②官网 download.html 双副本**四张下载卡（cloud/cloud-app/local-desktop/local）全部改读 hash-manifest 节点**（版本/发布日期/更新说明/下载链接，桌面卡含便携版），删除 latest.json fetch 整条链路——历史漂移实锤：桌面卡 notes 走 latest.json、APP 卡走 manifest 双源并存，加上 site-official 版本号双 v 前缀 + APK 未优先 releaseUrl 两处独立漂移，同轮全部修复。**铁律：①latest.json 只能由 publish-release.js 投影生成，任何工具/页面禁止再写它或把它当数据源 fetch（读更新元数据一律走 hash-manifest.json）；②hash-manifest 是更新元数据唯一 SSOT，新增展示位（版本/日期/说明/大小/链接）必须从其节点取值**。
- **P0-5 根目录 index.html 孤儿删除**：根 index.html 不在任何同步清单（sync-shared-blocks/verify-no-hardcoded-clinic 反把它误扫入列），与权威源漂移多年，构建链零消费——直接删除并清理两处工具引用（verify-no-hardcoded-clinic.ps1 / sync-shared-blocks.cjs）。**铁律：根目录不是网页权威源位置（权威源=public/index.html），发现游离副本必须「登记进同步链 or 删除」二选一，禁止放任第三态**。
- **验证**：Playwright 双副本四卡渲染 ALL PASS（console 零报错、四卡版本/日期/notes/链接全渲染、latest.json 残留引用归零）+ 全量合规门禁 13/13 通过 + copy-consistency 42+2 副本全绿。
- **生效方式**：云端网页（public+site-official download.html）push 后部署即生效；**publish-release.js 改动下一次发布时生效**（latest.json 投影 + releaseNotes 写入）；云桌面/离线桌面更新器收口需各自重打包后生效（新装/更新用户才用新更新器）；云端APP/离线APP 无改动无需重打包。

* ★ 2026-09-13 **下载速度排查终局（用户拍板：R2 暂不开通；桌面更新器参数对齐官网 robustDownload v4）**：用户再报更新横幅下载极慢并否决 R2 开通（「官网下载页原来很快」）。同刻三通道实测（本机=用户网络）：`/api/dl` 代理单连接 **0.9MB/s（206 Range 健康）**、GitHub 直连 **0 B/s（schannel CRYPT\_E\_NO\_REVOCATION\_CHECK——TLS 证书吊销检查被跨境拦截，curl 报 (35)）**、CF 静态 APK 1.1MB/s。**「官网页快」的真相 = robustDownload v4 6 连接并行**（6×0.9MB/s≈5MB/s，78MB 约 15 秒）；**慢的根因大概率是旧版客户端（09-12 7776a65f 之前打包）横幅仍直连 GitHub = 0 B/s 死路**（存量无法追补，出路=官网页手动下载，正是用户记忆中快的那条路）。**本轮两项改动**：① `shared/update-manager.cjs` 参数对齐 robustDownload v4：UPDATE\_DL\_PARALLEL **4→6** / MAX\_RETRY **6→15** / WATCHDOG **25s→15s** / 退避 **800ms×n→min(1000ms×n, 5s)**（原 6 次×800ms 熬不过 GitHub 抽风窗口），Group 12 双端同步 + node --check ×3 + copy-consistency 62 副本全绿；② `functions/api/dl.js` v3 R2 缓存层**休眠落地**（env.DOWNLOADS 绑定缺失时逐分支回退 v2 GitHub 链路，行为零变化，可安全先行部署）——后续开通 R2 只需：Dashboard 启用 R2（免费 10GB）→ `wrangler r2 bucket create tcm-prescription-downloads` → wrangler.toml 加 `[[r2_buckets]] binding="DOWNLOADS"` 即激活（代码已备：R2 命中直回 CF 内网消除 CF↔GitHub 卡死段 / miss 走 GitHub 链路同时 waitUntil 异步全量预热写 R2 / 首请求触发此后恒命中 / ASSET\_RE 白名单防 SSRF 不变、R2 key=捕获组派生 releases/\<tag\>/\<file\> 无注入面 / X-Proxy-Source 头区分 r2-cache|github-release 供验证）。**生效方式**：dl.js v3 随下次部署休眠生效（零行为变化，Git 构建配额恢复或 wrangler 直传均可）；更新器 6 连接随**下次打包 exe** 生效（云桌面/离线桌面）；已发布的 1.2.242 客户端横幅=代理+4 连接（代理健康时约 22 秒/78MB）；旧版客户端横幅=直连死路只能官网页兜底。**后续真提速仍按 §18 统筹路线 P2 国内 OSS（触发条件：下载量起来/用户再报慢）**。✅ **用户实测终验（同日）：「完美解决！速度明显加快！」——问题关闭**（归因链自洽：慢源=旧客户端横幅 GitHub 直连 0 B/s，快源=官网页 6 连接×健康代理；排查当日直接给出路的=官网页，与用户印象一致）。**同日下午二次复报（更新横幅卡 4% 0.0MB/s）+ 实测抓现行：CF↔GitHub 跨境段日内波动实锤**（上午 /api/dl 0.9MB/s 健康 → 下午 55KB/s + 尾段 502 上游错误），链路一天内多次随机劣化，客户端参数只能熬短抖动熬不过整段断流，二次触发「再报慢」条件。**用户最终拍板（同日）：暂不设置任何付费项目——R2 因 Cloudflare 强制绑国际卡/PayPal 否决（即便免费额度内零扣费），国内 OSS 同理搁置**。终态：接受 CF Worker 代理日内波动的现状（健康时段 78MB 约 15-22 秒，抽风时段断点续传等待自愈/稍后重试），R2 代码休眠就绪永久保留（用户日后绑卡即可一键激活，步骤见本条），OSS 路线保持「下载量起来/付费意愿出现」再议。**禁止后续会话向用户重复推销 R2/OSS（已两次否决，除非用户主动提起）**。

## 19. 后续路线图（2026-08-31 定，试用观察期三步走）

* **第一步（当前）**：进入 1-2 周正常看诊观察期，不刻意测试——真实使用是最好的验收。

* **第二步（观察期内被动守护）**：CI 四重门（`.github/workflows/verify-unified.yml`：check-interface → sync-all -VerifyOnly → html-sync-check → check-injection-idempotency）每次推送自动校验，有漂移 GitHub 红灯提醒，按第 2 章红灯修复流程处理（界面改动→重建基线一并提交；shared 改动→本地 sync-all 后提交；HTML 副本→以权威源回改；注入幂等→改整段重写/补守卫）。观察期内**只修实报 bug，不做主动优化**，避免引入新变量。

* **第三步「权威源生成模式」（★ 2026-09-13 P1 已落地）**：实测 6 份 index.html 差异结构证明「单一权威源」不可行（云端↔离线是两个产品形态 3132 行深度分叉），落地形态为 **「2 权威源 + 全自动传播链」**——`public/index.html`（云端，sync-html Group 11）+ `db-offline/desktop/index.html`（离线，sync-index-app Group 13 变换表生成），云APP assets 收编回链、escapeJs 吞参欠债流灌、`diff-cross-version.cjs` 三层基线守卫挂 CI 第 7 道兜底跨版本单边漏改。第 2 章清单同步改写为新流程；后续跨版本功能移植靠人工 + 守卫红灯兜底，观察 1-2 周误报率后升 pre-push ⑩。

## 20. Cloudflare Pages 三站分离部署拓扑（★ 2026-09-13 重整恢复，root_dir 方案）

> 详细操作手册：`DEPLOY-站点分离部署说明.md`（顶部横幅为权威结论）。此处只沉淀铁律级结论。

* **铁律 20-1（wrangler.toml 覆盖机制）**：根 `wrangler.toml` 的 `pages_build_output_dir = "public"` 会覆盖**所有** Pages 项目的 Dashboard/API destination_dir。Git 构建从 root_dir（默认仓库根）读 wrangler.toml，命中即用、Dashboard 配置全部失效。「三站互为 public 镜像」的根因不是 destination_dir 漂移，而是这个覆盖机制 + root_dir 曾被清空。改 destination_dir 无效时先查根 wrangler.toml。

* **铁律 20-2（分离拓扑 = root_dir 配置）**：huikang-admin `root_dir="site-admin"`（其 wrangler.toml `pages_build_output_dir="."` 接管）；huikang-official `root_dir="site-official"` + `destination_dir="."`；主站 root_dir 空（根 wrangler.toml 主导 public）+ 根 functions。root_dir 生效后子站 /api 退场（functions 从 root_dir 下找，子站无）——已验证两个子站页面全部跨域调主域 API（`CLOUD_API_BASE`），零相对路径 /api 依赖，无功能回归。

* **铁律 20-3（API PATCH 后必须真实 push 才重建）**：`PATCH /pages/projects/{name}` 改 build_config 后回读即生效，但 `POST .../deployments {ref:"main"}` 触发的部署可能重放旧构建快照、不应用新配置；必须真实 git push 触发 webhook 才走完整构建管线读新配置。

* **铁律 20-4（免费计划 500 Git 构建/月配额）**：每 push 消耗 3 个构建（三项目同库 webhook）。耗尽症状：initialize 阶段 "unable to submit build job" 连续失败 + 其他项目部署卡 queued 15 分钟以上。兜底：`wrangler pages deploy <目录> --project-name=<项目> --branch=main` 直接上传（不占配额，仓库根运行自动带根 functions）。**直传前必须 `git archive --format=zip` 抽入库内容**（本地未入库 exe/apk >25MiB 会被拒收；PowerShell 管道会破坏 tar 二进制流，必须用 zip 格式落盘再解压）。

* **铁律 20-5（部署验证必须看内容指纹不看状态灯）**：deploy:success ≠ 内容正确（快照重放可假绿）。最终判据：title+长度指纹（public 568270「云端标准版」/ site-admin 568691「云端」/ site-official 5634「官方网站」）+ 物理文件探针（official /auth-core.js 必须非 JS 内容——SPA fallback 返回 index.html 属正常，规则9 只要求物理不存在）。

* **2026-09-13 生效记录**：commit 642ec107（删 public/wrangler.toml 死文件，防 KV/D1 id 公网暴露）+ root_dir 配置 + 三站 wrangler 直传。adminconsole 控制台双副本（licenseSync 双特性）字节级一致上线；主域 wrangler.toml 已物理移除。五端零重打包（纯站点部署变更）；主站 642ec107 的 Git 部署因配额失败但线上由直传接管对齐，下月配额恢复后 push 自动回归 Git 构建链。

## 21. 智能语音版版本线（2026-09-17 一期上线）

> 一期范围：`voice` 版本类型全链路 + 云端网页四框口述（姓名/性别年龄/病史症状/诊断）+ 语音加药候选弹窗 + admin 后台枚举 + 官网说明。识别用 Web Speech API（Chrome/Edge 网页端），Electron/WebView 无此 API 自动降级隐藏入口。实施方案：`.trae/documents/语音版第一期实施计划.md`。

### 21.1 voice 枚举链坐标（改动全链，后续二期三期在此扩展）
* **服务端**：`functions/api/license/_lib/license-core.js` LICENSE_TYPE_CONFIG 新增 `voice`（`maxPrescriptions:0, features:['backup','voice']`，1年/1设备）+ versionOf + DEVICE_VERSION_LABEL『语音版』；`entitlement.js` 透传 features；`users.js` normalizeClinicEdition 精确匹配 `cloud_voice` + 「语音版」中文兜底；`admin-approve.js` / `activate-from-ticket.js` maxDevices 兜底 `(type==='pro')?5:(type==='voice'?1:2)`。
* **客户端**：`shared/license/license-manager.js`、`shared/edition-lock.js`、`shared/permission.js`（+`isVoiceEdition()`）三镜像同步；`shared/auth-core/cloud.js` 登录钩子写 `CONFIG.edition = 'cloud_voice'` + localStorage 缓存恢复。edition 规范 key：**cloud_voice**（与 cloud_clinic/cloud_personal/offline_* 平行）。**版本文案 5 处**（public/index.html，dce400f9）：首帧 `_lbl` fallback / `getCloudEditionTag` / `getEditionTag`（守卫+fallback）/ `refreshVersionTags` / `applyLoginTheme`——voice 判定（cloud_voice/voice 纯字符串）一律优先于标准/机构二分，显示「云端语音版」。
* **admin 后台**：`public/admin/index.html` ↔ `site-admin/admin/index.html` 双副本（4 处下拉框 option + tag-voice 紫色样式 + typeLabel/typeNames/typeMap 映射 + voice1y 批量发码模板），开码即支持 voice 类型。
* **官网**：`public/download.html` ↔ `site-official/download.html` 双副本（快速选择指南第 5 条 + 对比表「智能语音开方」行 + 语音版专属卡片；**价格不写死**，引导详询客服——用户偏好「暂不设置付费项目」）。

### 21.2 语音模块三处登记铁律（新增 shared 模块必查，同第 2 章铁律）
`shared/voice/voice-input.js` 权威源（IIFE 暴露 `window.VoiceInput`：isAvailable/listen/highlight/cleanText/extractGender/extractAge/ensurePinyin/toPinyin），分发 3 云端副本（public/、cloud_desktop/、cloud_app assets/public/，Sync-File 按文件名展平落位目标根级）：
1. `tools/sync-all.ps1` Group 19（$VoiceInputTargets 3 云端目录）
2. `tools/copy-consistency.cjs` GROUPS 尾组（3 副本硬哈希门）
3. `app_project/db-yunduan/cloud_desktop/package.json` build.files 白名单
**离线端/鸿蒙不分发**（一期无入口）。obfuscate.js MODULE_FILES 不收 voice-input.js（无核心安全资产，gate 委托 Permission，与 login.js 明文先例同理）。

### 21.3 注入器设计（public/index.html L740-742 script + 内嵌 IIFE）
* **2s 轮询自适应注入**：云端登录是内嵌 overlay 不整页刷新，不能只靠登录钩子——voiceTick 轮询 `VoiceInput.isAvailable()`（三重 gate：SpeechRecognition 构造器存在 + isSecureContext + Permission.isVoiceEdition()）→ 注入/移除按钮，登出/切标准版自动撤除。
* **四框填充语义**：姓名=替换（slice 30）；性别年龄=extractGender+extractAge 双填（性别走 markGenderManual）；病史症状=『；』追加；诊断=『，』追加。填充后 highlight 浅紫高亮 2.5s + updatePrescriptionPaper()。
* **P0 铁律（v2 连报版语义，2026-09-17 同日升级，db8a49d9）**：唯一命中→自动填入+浅紫高亮待核对（复用 selectMedicine 行写入链）；多命中→只弹候选点选（voiceShowMultiChoice 用**独立容器 #voiceMultiDropdown**——见 21.4 容器复用教训，window.__voicePick 内联 onclick）**绝不自动选**；未命中→toast 汇总「未识别清单」**绝不静默**。一期「强制全部弹候选」语义已被连报模式取代（整方口述每味都点选不可用）。
* **连报分段解析三道保险（v2）**：①ASR 多候选——`maxAlternatives=5`，onResult 新签名 `(text, alts)` 向后兼容，miss 时用候选文本重解析；②拼音归一——白勺/白芍→同为 baishao（双方长度≥3 防误命中），ensurePinyin 按需加载 `vendor/pinyin-pro.min.js`（UMD 全局 `window.pinyinPro`，API `pinyin(text,{toneType:'none',type:'string'})`），加载失败 resolve(null) 静默降级仅精确匹配；③分段——按标点/连接词（然后|再来|接着|下一味）/「克后紧跟汉字」边界切段，每段 `voiceSplitDose` 剥尾部剂量（数字+克/g）自动填入剂数。6 个新函数全带 voice 前缀（voiceParseSegments/voiceSplitDose/voiceMatchMed/voiceAutoAdd/voiceShowMultiChoice/voiceFillMedicineInner），同 21.4 撞名教训。
* **extractAge 含「百/千/万/零」复合表达（如“一百二十岁”）直接放弃**：截断误填（一百二→1）比不填更危险，宁缺勿错。
* **★ 二期全局智能分发（2026-09-18，388ebd5a）**：总入口 🎤 挂 `.symptom-section .history-tabs` 右缘（深紫底白字区别单框浅紫 mic），连报模式整方口述自动分发。**NLU 分类链（每细段按确定性排序）**：①剥离性别/年龄/剂数短语（严格版要求「岁/剂」字面——`VoiceInput.extractAge` 宽松正则 `(\d)\s*岁?` 会误吃「黄芪15克」的 15，全局路由绝不能直接用；「每日一剂」用法表述靠「每」字头防护不剥剂数）；②症状词典纯词条全等→病史（**先于药物链**：症状词具体、药库用户可扩展防子串误中）；③拆词（`voiceSymMatch` 段⊃词条贪心拆词+残段保留，天然处理「失眠多梦黄芪15」混合段→词条进病史、残段走药物链）；④药物五层链（复用 `voiceDispatchMeds` 内核——从 voiceFillMedicineInner 拆出，多候选连弹/口音学习/alts 兜底/重复跳过全保留）；⑤全 miss→未识别 toast 绝不静默。6 新函数 voice 前缀：voiceCnNum/voiceStripInfo/voiceSmartRoute(Inner)/injectSmartVoiceMic + voiceDispatchMeds。单测法：提取注入器 IIFE vm 沙箱执行（`document.readyState='loading'` 防 voiceTick 副作用），IIFE 内尾注 `window.__voiceTest` 导出内部函数（仅测试副本），27 用例含用户示例场景/无标点连报/混合残段/同音字/中文数字/重复跳过/每日一剂防护。
* **★ 姓名/诊断路由补全（2026-09-18 c77fe127，云端APP实测反馈）**：二期「姓名/诊断不路由」口径在免费层整方场景被实测推翻（用户整段口述含姓名/诊断→未填入）。**新口径**：姓名双通道——①前缀式（`^(?:姓名|患者|名叫|叫做|叫)[:是为]?[\u4e00-\u9fa5]{2,4}`，**锚定段首**防「夜尿叫醒」中间「叫」误剥；**置于性别剥离之后**防「姓名王明男」性别尾字污染捕获）②首段裸名（第一个内容段 + 纯 2-4 汉字 + 症状词典/药库均 miss + 无剂量残留 → 姓名；「男35岁」打头时首段已被剥离吃空不误入，带数字「王明15」不判防药名残段误吞）→ patientName 填入+高亮+searchPatientsQuick 历史联动（`{target:{value}}` 模拟事件模式，与单框姓名 mic 同入口）。诊断仅前缀式（`^(?:诊断|诊为)[:是为]?(.+)$` 整段捕获→diagnosis「，」追加），描述性内容**不做裸判定**（宁缺勿错）。判定次序：症状/药物链 miss 之后才裸名（词典药库认识的词优先走原链）。
* 新 script 标签加在现有 script 区内（L736 首个 script 之后），不触 check-interface 基线（body→首个 script 区间）。

### 21.4 本轮新教训（必须传承）
* **★ 服务端散落硬编码 type 白名单是 voice 上线首障（2026-09-17 实测抓到）**：LICENSE_TYPE_CONFIG 加了 voice 后，generate.js L96 硬编码 `['trial','personal','pro']` 拒收 voice → admin 开码 400 无弹窗。全仓排查共 5 处（generate/batch/admin-approve/activate-from-ticket 已根治 + order-submit 一期不动）。**根治**：license-core.js 导出 `LICENSE_TYPES`（全量）/`PAID_LICENSE_TYPES`（排除试用）权威集合，4 处 API 校验统一引用，`mapEditionToType` 补 voice/cloud_voice/语音分支。**铁律：新增版本类型只改 LICENSE_TYPE_CONFIG，改完必 grep `['trial'` / `'personal', 'pro'` 式散落硬编码**；order-submit.js L193 待语音版定价后再开 voice。commit f21f8a7c。
* **★ 客户端版本文案同款坑（第三个，dce400f9）**：refreshVersionTags `_isStdEd` 白名单 + getCloudEditionTag/getEditionTag/applyLoginTheme/首帧 fallback 共 5 处「标准/机构」二分全部漏 voice → cloud_voice 登录后 title/顶栏误显「云端机构版」。**铁律：新增版本线时必 grep `云端标准版|云端机构版` 全部二分点，新版本判定一律放在二分之前**；语音版主题沿用机构版紫色（不动 CSS 基线），仅文案独立。
* **★ import 漏常量 = 运行时 ReferenceError，node --check 查不出（P0，f147bdcb）**：admin-submit.js 3 处使用 KV_ADMIN_REQ_INDEX 但未 import → 全新手机号（无索引）走兜底扫描必 500，管理员激活通道对新客户静默损坏数月（历史成功记录走官网订单路径未踩中）。**方法论：①本地复现拿真实堆栈 = mock KV + 构造 context 直调 onRequest；②系统性兜底已正式化为常设门禁 = `tools/scan-undefined-consts.cjs`（剥字符串/注释后核对每个 KV_* 使用点有定义/命名导入；pre-push ⑫ + CI verify-unified 9/9 双接线，2026-09-17）**。
* **★ 版本线 vs 加购权益语义混淆 = 机构属性静默丢失（P0，2026-09-21 d150252d）**：机构诊所（cloud_clinic）用 voice 升级码激活 → provisionCloudAccount「edition 不一致即强制覆盖」条款把 edition 覆盖成 cloud_voice → 机构属性（用户管理/处方查阅）全丢，机构管理员只剩【修改密码】（button-manager 权限矩阵两表均无 cloud_voice，isInst=false 落判定空洞，Arch 2.26 断言不保护）。**根修语义：语音=加购权益不替换版本线**——机构诊所 voice 升级 edition 保持 cloud_clinic + 叠加 `clinic.voiceEnabled=true`；登录响应 user.voiceEnabled 透传（findUserForLogin 4 返回点带 clinicVoiceEnabled，sanitizeUser 30+ 调用点零改动）；auth-core 登录 voice-sync + 刷新恢复双写 CONFIG.voiceEnabled；isVoiceEdition gate = cloud_voice 版本线 OR voiceEnabled 叠加标记。**铁律：新增「加购类」功能（权益叠加）绝不动 edition 单字段，一律加独立布尔标记随登录响应透出；新增版本线必查 button-manager 两张 edition 表有归位（否则落判定空洞）**。已污染诊所恢复：后台把 edition 改回 cloud_clinic 后重输语音码（新逻辑补 voiceEnabled）即闭环。
* **云端账号开通模型（开码≠开账号）**：激活码 claim（validate.js）只绑设备不建账号；admin 直接 generate 的码对云端网页登录无用。云端账号必须走 `provisionCloudAccount`（admin-approve 审核通过 / activate-from-ticket 工单通道），语音版审核 type=voice → mapActivationTypeToEdition → cloud_voice。
* **付款前置拦截与白名单**：新手机号提交激活申请被 `PAYMENT_REQUIRED` 409 拦截（admin-submit 支付前置校验）；测试/免费开通用 admin 后台「➕ 加入白名单」写 `free_pass:{phone}` KV 跳过拦截。
* **浏览器 agent 两坑**：①点击时机——auth-core.js 异步加载完成前，内联 onclick 的 `if(window.openAdminActivate)` 守卫静默无反应，用 browser_evaluate 直接调用 `window.openAdminActivate()` 绕过；②E2E 验证时序——Pages 部署需 2-5 分钟 + 浏览器缓存，push 后立即验证必见旧代码，须先 curl 线上 HTML 确认含新代码（查新标记字符串）再上浏览器，且导航带 `?nocache=` 参数。
* **注入器内函数名必须加 voice 前缀**：新 script 内函数若与其他端旧函数撞名（如离线端已有 `function inject()`），diff-cross-version Tier B 会误报「同体函数单边改动」。12 个函数统一前缀（vLog/makeVoiceBtn/setVoiceListening/positionVoiceBtn/bindVoiceMic/voiceAfterFill/injectVoiceUI/voiceFillMedicine/injectMedicineVoiceMic/removeVoiceUI/voiceTick/voiceNotify）。
* **.ps1 必须 UTF-8 带 BOM**：无 BOM 时 PS 5.1 `-File` 按 GBK 解析中文注释吞引号报 `Unexpected token ')'`（sync-all.ps1 曾中招）。含中文注释的 .ps1 检查前三字节须为 239,187,191。
* **PowerShell 内联 `node -e` 引号转义易失败** → 写临时 .js 到 `tools/_tmp/` 执行（根目录受 package.json type:module 影响）。临时脚本用完即删；_tmp 下还有大量历史文件，只删本轮自己创建的。
* **浏览器 agent 不支持 file:// 协议**：验证本地 HTML 渲染需起 HTTP 静态服务（`npx http-server` 或自写 serve 脚本带 `<目录> <端口>` 参数）。
* **★ ASR 药名同音字 = 语音开方「未匹配到药品」头号根因（2026-09-17 连报修复，db8a49d9）**：Web Speech API 把「白芍」识别成「白勺」，精确匹配必失败；且用户实际口述是带剂量整句（白芍15克，当归10克…），一期单药名匹配口径全不命中。**根治三道保险见 21.3**。方法论：agent 环境无麦克风，识别链路（click→isListening→按钮回落）用浏览器 agent 一锤定音，识别后环节（解析/匹配/填入）只能代码审查 + 用户实测；**先问清用户口述方式再定位根因，避免盲改**。
* **★ 新 script 标签带 cv 参数必须三处同步登记（cv 逃逸教训）**：voice-input.js 曾用手写日期式 `cv=20260917` 不在 check-cv-hashes TARGETS 清单——内容变更后 cv 不刷 = 已访问用户 immutable 缓存**永不生效**，且 _headers 也漏 /voice-input.js 规则（12 业务 JS 有 immutable、它没有）。**铁律：index.html 新增带 ?cv= 的 script 引用时，必须同步①check-cv-hashes.cjs TARGETS ②public/_headers immutable 规则 ③（若是 shared 模块）sync-all 分发组**。现在 TARGETS=14。
* **★ vendor 第三方库收 shared 权威源再分发**：pinyin-pro.min.js 初版只放 public/vendor/，云桌面/云APP assets 缺位 = 拼音容错静默降级（相对路径 `vendor/` 随表面走）。根治：收进 `shared/vendor/pinyin-pro.min.js` + sync-all **Group 7b**（$PinyinVendorTargets 3 云端 vendor 目录）+ _headers 长缓存规则。与 xlsx（Group 7 离线双端）目标集不同故独立分组。
* **★ 跨版本基线重冻结流程（第⑩道门 voice 函数合理分叉）**：新增云端语音版专属函数（voice 前缀）必触发 diff-cross-version RED（desk+siteadmin 两侧缺）。处置：确认分叉合理（离线端无 Web Speech API、site-admin 无开方界面）后 `node tools/diff-cross-version.cjs --update-baseline --pair desk` + `--pair siteadmin` 各跑一次重冻结，基线文件随功能 commit 一起推（同 injectMedicineVoiceMic 一期先例）。
* **★ 复用既有 UI 容器 = 静默继承其事件管道（v2.1，3d0e084a）**：voiceShowMultiChoice 初版复用 #medicineSearchDropdown 省事，但该容器归键盘搜索管道管理（输入框 onblur→tryHideSearch 200ms 延迟关闭），语音候选 display:block 后被误关、医生无法点选（甘草实测：toast 提示「多个匹配请点选」但弹窗消失）。**铁律：新交互通道（语音/快捷键等）的弹层一律独立容器**（复用 CSS 类没问题，复用 DOM 容器/ID 必出管道耦合）；外部点击关闭用延迟 300ms 绑定+触发一次自移除，避开显示事件链。
* **★ ASR 识别率决策：不接外部 ASR，医生用系统输入法语音（2026-09-17 用户拍板）**：Web Speech 对药名/中医术语识别率实测偏低（拼音容错+多候选只能缓解），讯飞星火 ASR（热词可注 467 味药名，23 元/万次 ≈ 17 元/月）与火山引擎均为可行根治方案，但用户选择**只用输入法、应用内不换**——手机/电脑装豆包/讯飞输入法，对任意输入框按语音键说话直接上字（单框输入，不走应用内连报解析）。二期原「ASR 引擎升级」搁置；应用内 🎤（Web Speech+拼音容错）保留为免费通道；四期离线端 sherpa-onnx 本地模型规划不变（离线端无输入法方案）。
* **★ 药名匹配链五层演进 + 症状匹配链（2026-09-17/18，528eeb30/28cbf3ef/e05f24a7）**：voiceMatchMed 最终链序——简码 → ⓪⁻⁻个人口音映射 → ⓪⁻ALIAS 别名（只收三层链救不了的行话：双花/元胡/云苓/山萸肉/仙灵脾/故子等 14 条；生地/熟地/丹皮子串可直达不收，表越短越好）→ ⓪全等（说黄连直达黄连，不因子串误扩到胡黄连）→ ①子串 → ②拼音（pyEq 全等优先→pySub 兜底，制甘草→炙甘草不混入甘草）。voiceSymMatch 症状链（病史症状框）：全等 → 组合模板去标点全等（舌红苔黄腻脉滑数→标准整句）→ 词条⊃段取最长 → 段⊃词条贪心拆词（长词优先+口述位置排序+残段原文保留+单字残段并前词）→ 拼音全等。症状是描述性文本不弹候选（与药名 P0 口径的备案差异）。姓名语音联动：精确同名 === 取最新记录带出档案（不用键盘链 selectPatientName——其 includes 会把王明扩到王明华）。
* **★ 药库增量补丁机制（2026-09-18，d515db6b）**：localStorage 药库恢复路径永不重建 defaultMedicines 字典 → 权威源加默认药，老用户永远看不到（牛膝/川牛膝实例：说牛膝弹三选但库里根本没有川牛膝）。根治：loadData 内「medicines = defaultMedicines」后加 `MEDICINE_PATCH_VERSION` 守卫 + `MEDICINE_PATCH_ADDS` 清单——按 name 增量补插、版本号只升一次、用户此后删药不复活。**铁律：加默认药 = 清单追加 + 版本号+1 + 六份 index.html 同步**（云端 public/cloud_desktop/cloud_app + 离线 desktop/index-app/APP assets 镜像）。
* **★ 口音自学习 = 学习纠正信号而非引擎自适应（2026-09-18，e12db68d）**：Web Speech 黑盒无法喂个人语料，改为学医生的纠正——①拼音层多候选点选（识别串≠药名的同音/行话纠正）②语音自动填入后 60 秒内同行改选（hook `window.selectMedicine`：DOMContentLoaded+setTimeout 包装主代码函数声明，换行/过期/同药名均不学）。应用层 ⓪⁻⁻ 放 voiceMatchMed 最前。**顺序铁律：个人映射必须在 ALIAS 之前查**（vm 实证抓出：ALIAS 先把「半夏」归一成「姜半夏」，PM['半夏'] 落空，个人纠正永远覆盖不了默认别名）。防误学四件套：仅拼音层学点选（子串层牛膝三选是规格选择不学）/60 秒窗口/同串新纠正覆盖旧值自愈/FIFO 200 条；学习与应用双 toast 感知 + 行高亮 P0 待核对。存储键 `local_web_user_<username>_voice_map`（用户隔离，参照 getUserItem 模式）；映射目标药被用户删除则自然落回下层链安全降级。
* **★ 弹窗误关 v2.1 后复发：capture closer 与连报工作流冲突（v2.2，15d57d67）**：v2.1 修的是容器复用（onblur 管道耦合），本次是**另一个误关源**——地黄实测复发（弹窗出现后消失）。三点根因：①closer 挂 document **capture 阶段**，bindVoiceMic 里 `ev.stopPropagation()` 根本挡不住（capture 先于 target 执行，麦克风按钮自己的拦截对 capture 监听器无效）；②toast 居中显示遮挡候选区，点到 toast 即点到 dropdown 外=误关；③连报习惯：弹窗出现后医生继续点 🎤 说下一味，🎤 在 dropdown 外=误关。**三重防误关**：显示后 1 秒保护期一律忽略（语音链尾事件）+ 点 `.voice-mic-btn` 不关（连报保留弹窗回头点选）+ 真正关闭时清空待弹队列。**队列连弹**：连报多味多候选（地黄+牛膝…）整批入队 `voiceMultiQueue` 逐组弹出，点选/跳过重复药自动弹下一组（`voiceAdvanceMultiQueue`），队列耗尽自动收起——不再「其余组再说」。**铁律两条**：stopPropagation 挡不住 capture 阶段监听器——防误关必须在 closer 自身做保护期/白名单，不能指望事件源头拦截；固定提示 toast 一律右上角 + `pointer-events:none` 穿透（居中 toast 会遮挡交互区成为误关源）。vm 实证 13/13（队列接管/保护期/🎤不关/空白关/连弹/耗尽/重复跳过/toast 穿透/单例替换）；全等层唯一命中自动加入是 v2.0 设计行为，测试 stub 药库别放精确名（牛膝精确名让第二组进不了队列——stub 失真教训）。
* **★ 弹窗定位真凶：fixed 弹窗锚大区块底缘=定位到视口外（v2.2.1，5f01ebf2）**：v2.2 上线后地黄二次实测「只有 toast、无弹窗」——voiceShowMultiChoice 锚 `.medicine-section`（flex:1 占满主区，底缘≈屏幕底缘），`top=r.bottom` 把 fixed 弹窗定到视口外，**弹窗一直在渲染只是永远在屏幕外**；「提示后消失」实为 toast 自动淡出，弹窗从未显示过。修复：锚医生刚点过的 `.medicine-section .voice-mic-btn`（同键盘搜索锚输入框 showSearchDropdown 的口径——**弹层必须锚定用户视线/交互焦点，不能锚大区块**）+ top 夹取 [10, vh-200]、left 夹取 ≤ vw-240。**方法论教训：症状「出现后消失」与「从未出现」必须区分——用户口述易把 toast 淡出误报成弹窗消失，两轮问答都问不出的信息，一个 getBoundingClientRect 对比键盘链路锚点就定位了；fixed 定位必配视口夹取**。vm 编译校验 + 十二道门全过。
* **★ 语音提速：延迟感来自零反馈而非引擎慢（v2.3，76822b6c）**：医生反馈"响应慢"，实测根因是 interimResults=false 说话期间零反馈（final 要等引擎静音判定 ~1s）+ continuous=false 单句即停（连报多味药反复点🎤）——引擎侧静音判定不可配，提速只能从**反馈节奏**下手。三件套：①interim 实时字幕（listen 第 4 参 opts.onInterim，中间结果只展示**绝不填充**，final 才走业务链，零误填风险；字幕锚 🎤 按钮 rect + 视口夹取 + pointer-events:none）；②药物 mic 连报（opts.continuous，每句 final 逐句填入，多候选队列连弹不变）；③VoiceInput.stop() 再点立即停。**连报两个必守坑**：Chrome continuous 模式静音数秒会**静默 onend**（引擎行为）——onend 内 6s 活动窗守护重启（200ms 延迟 start 防竞态抛异常）+ 8s 无语音 watchdog 自动收尾（防忘关麦克风收诊室环境音，连报模式 no-speech/空 final 也静默不弹提示）；**旧会话异步回调竞态**——停止后秒重点场景旧 onend 迟到会错误重启/收尾新会话，module 级 sessionSeq 会话序号，旧序号回调全丢弃（finish/restart 双处校验）。患者信息各框保持单句模式（连报只开药物 mic，验证面小风险可控）。测试要点：模拟 SpeechRecognition 时 abort 必须异步触发 onend（真实引擎行为）、final 行是带 isFinal 的类数组对象（普通数组 isFinal=undefined 会误走 interim 分支）。
* **★ 老用户升级语音版三件套（2026-09-18，5fed6e51）**：已激活标准版/机构版老用户购语音码后无门可入——登录页「📋 管理员激活」仅未激活新客户可见（首帧优化脚本注入），且 checkDeviceVersion 无 →voice 路径、validate 激活后不更新 clinic.edition（双服务端缺口）。三件套：①license-core checkDeviceVersion 开 standard/institution→voice 放行（语音版切回其他版本仍拒，防降级绕费）；②validate.js voice 码激活成功后 provisionCloudAccount 同步诊所 edition=cloud_voice——**身份锚点铁律：仅 phoneVerified（码绑定手机号=提交手机号）或 clinicNameMatched（needClinicName 强校验）才调 provision，裸码不调**（防匿名加用户/盗码挂别家诊所）；失败仅 warn 不阻断激活；授权期沿用原到期日（加购不改期）；③auth-core cloud.js 基础设置授权区「🎙️ 升级语音版」按钮（isCloudVoiceEditionNow/未登录自动隐藏）+ openAdminActivate(voiceMode) 直达输码 Tab 预填登录手机号 + 成功文案提示重登。**易踩坑：validate.js 的 clinicNameMatched 是 if 块级作用域，后方升级块不可见须重算 `__clinicNameMatched`**；工单通道（activate-from-ticket）同受 checkDeviceVersion 约束自动受益。**★ 授权区新状态函数必须「挂 window + showModal 刷新」两件套（eb1f5671，updateLicenseStatusText 2026-08-25 同款坑复发）**：injectLicenseStatusIntoSettings 仅在启动后 2 秒（登录前）执行一次，新增的 updateVoiceUpgradeBtnVisibility 未挂 global 且 showModal('settingsModal') 无刷新调用 → 已登录老用户永远看不到升级按钮（云端APP 303 实测抓出）。**铁律：授权状态区（licenseStatusSection）内任何随登录态/版本态变化的动态 UI，新函数必须同步①`global.xxx = xxx` 挂载 ②index.html showModal settingsModal 分支加 `try{window.xxx()}catch(_){}`——缺一即「启动时渲染一次后失效」**。
* **★ 整方快速录入免费层：识别外包给输入法 + 理解复用解析链（2026-09-18，e94e9004）**：「离线版=数据本地存而非断网」（用户纠偏）+「只用系统输入法不接外部 ASR」（21.4 既有拍板）两条决策的产品化落地。**分层设计**：付费语音版=界面内 🎤 一键开说（Web Speech，cloud_voice 专属）；免费层=📋 整方录入入口（「填资料」后白底紫字描边）——点文本域→输入法麦克风说话/打字/粘贴→「解析录入」直调 `voiceSmartRoute(text)`（**纯字符串入口、与识别引擎天然解耦是零成本复用的前提**），五层匹配/多候选/口音学习/智能分发全链零改动。**实现要点**：①入口注入**不受 isAvailable gate 控制**——voiceTick 加无条件分支（幂等 injectSmartTextEntry），removeVoiceUI 不移除（免费层常驻）；②解析函数全在语音 IIFE 闭包内不挂 window——新功能必须进同一 IIFE（外部 script 无法调闭包函数）；③弹窗 z-index=1050（低于多候选 1100 便于点选、高于键盘下拉 1000）；④**搜索框剂量直录防误伤双闸**：`ev.isComposing` 组词中不触发 + 必须显式克/g/公克后缀（「三七」正常搜索不误伤），capture 事件委托先于行内 oninput 清空（showSearchDropdown 收空 query 自动收起）；⑤跨版本基线 +4 函数（desk/siteadmin 单侧）人工确认分叉后重冻结。**阶段二预留**：解析链下沉 `shared/voice/voice-text-core.js`（单一权威源）+ vendor/pinyin-pro Group 7b 扩离线双端 + build.files 登记 + 离线两权威源接 script。
* **★ 阶段二语音块下沉离线端：块同步方案 Z 落地（2026-09-18，ca0e3828）**：放弃抽 `voice-text-core.js` 重构（IIFE 闭包依赖 medicines/全局函数十余处，工程大风险高），改为**云端语音块整体幂等下沉**——`tools/sync-voice-block.cjs`：起标记 `<!-- ★ 2026-09-17 语音版一期：voice-input.js` → 其后第一个 `\n})();\n</script>\n`（块内无其他行首 `})();` 且 script 内不可能含 `</script>` 字面量，天然无歧义），唯一变换 = 剥离 `?cv=` 缓存参数（离线本地文件系统无 HTTP 缓存），插入锚 = `electron/video-recorder.js` 引用行后（与云端顺序一致）；APP 端经既有 sync-index-app 33 条变换自动接力（语音块内容零触碰）。**下沉可行性三前提（已静态核验）**：块内全部外部依赖 typeof 防御式调用（showToast/prescriptionHistory/medicineCodeIndex/DOM_CACHE 等）；离线端全局同名函数 8 个 + `let medicines/prescriptionItems` + SYMPTOM_DICT 全存在；付费层（Web Speech 四框 mic）离线端无构造器被 isAvailable 三重 gate 自动隐藏——**免费层照常注入**。**四处清单登记**：①desktop/package.json build.files +`voice-input.js`（vendor/**/* 通配已含 pinyin）②generate-desktop-hotupdate.cjs CHANNELS.local/cloud files ③generate-app-hotupdate.cjs FILES ④sync-all Group19（voice-input 3→5 端）+Group7b（pinyin 3→5 端）+ copy-consistency voice 组 3→5 副本。**验证**：vm 冒烟（Node vm + 最小 DOM stub 跑 IIFE，8/8：执行不炸/防重复标记/__voicePick 挂载/免费层按钮注入/横打按钮隐藏/付费层零注入/加载顺序）——**stub 三坑：setTimeout 必须**同步执行**回调（voiceTick 走 1.5s 延迟分支）、getAttribute('onclick') 必须返回横打锚点（注入器按 onclick 属性匹配按钮）、createElement 的 id 赋值要登记 getElementById 映射**；tools/_tmp/voice-block-smoke.cjs（临时，可复用）。
* **★ cloud 热包清单漏登 voice-input.js（09-17 一期遗漏，ca0e3828 修复）**：云端 index.html 引用 `voice-input.js?cv=`，但 CHANNELS.cloud.files 没有该文件——**老云桌面装机（asar 里也没有）热目录 404 → `VoiceInput.highlight` 直接调用抛 TypeError（非 typeof 防御）→ voiceSmartRouteInner 姓名填入后整链中断**，后续诊断/性别/年龄/剂数/病史/药物全不填。云网页/云APP（实载线上 public/）有文件不受影响，只有走热包的装机受影响。**铁律：index.html 新增 script 引用 = 该文件必须进对应热包生成器 FILES 清单（cloud/local/app-local 三处独立清单，逐个核对）**——pre-push/CI 都不校验「引用 ⊆ 清单」，纯人肉；cloud 2026.09.18-6 补送。
* **★ Edit 工具写回 .ps1 丢 UTF-8 BOM（2026-09-18 二次实锤）**：sync-all.ps1 经 Edit 修改后 BOM 消失（efbbbf→23203d）→ PS 5.1 按 GBK 解析中文注释 → `Unexpected token ')'` 一串报错 + pre-push 挡推。**铁律：凡用 Edit 改 .ps1（或其他 BOM 敏感文件），改完必跑 `node -e` 补 BOM**（读首字节非 ef 则前置 `\xEF\xBB\xBF` 重写）；21.4 既有「.ps1 必须 UTF-8 带 BOM」条目的根因从「保存时丢」精确到「Edit 写回副作用」。另：**沙箱 PowerShell 的 [System.IO.File]::ReadAllBytes 会返回垃圾字节（首 8 字节 "52aaaaaa" 假象），验证文件真实字节一律用 Node fs.readFileSync**；git hash-object 对比 HEAD 是最可靠的「工作区==提交」判据。

### 21.5 生效方式（一期 + 连报 v2 + 口音自学习 + 弹窗防误关 v2.2 + 智能分发二期 + 老用户自助升级）
云端网页 push 即生效（一期主战场；连报 v2 同样 push 即生效，**已访问用户因 voice-input.js cv 刷为 793ee305 自动拉新**）；云端APP WebView 实载线上同步生效（系统无 Web Speech API 则按钮自动隐藏，键盘开方不受影响）；云桌面随下次打包生效（期内无语音入口，vendor/pinyin-pro 已随 Group 7b 分发到位）；离线端零改动；服务端（Cloudflare Pages Functions）push 即生效，admin 开码即支持 voice。验证基线：voice-input.js 沙箱 5/5、smoke-runtime 157/157、check-interface 6/6、copy-consistency 75 副本、diff-cross-version 四对全绿、浏览器冒烟（标准版 0 按钮→语音版 5 按钮→登出回 0）；v2 增验：smoke-runtime 26/26（S7 含 ensurePinyin 无 DOM 守卫）、cv-hash 14 目标、连报实测「白芍15克，当归10克，川芎8克」自动填入+高亮。**口音自学习（e12db68d）**：云端网页/云APP push 即生效；口音映射存浏览器 localStorage（local_web_user_<username>_voice_map），**换设备/换浏览器不跟随**（同一浏览器内按登录用户名隔离）；云桌面随下次打包生效；离线端无语音功能零影响；vm 实证 17 项全 PASS（学习闭环/覆盖ALIAS/自愈/FIFO/用户隔离/60秒hook各分支/参数透传）。**弹窗防误关 v2.2（15d57d67）**：云端网页/云APP push 即生效（注入器内嵌于 index.html，无 cv 缓存问题）；云桌面随下次打包生效；离线端/site-admin 无此代码零影响；行为变化——连报多味多候选逐组连弹（说「地黄，牛膝」两组依次弹出），弹窗 1 秒保护期内点击不关、点 🎤 继续说不关、toast 移右上角不再遮挡；vm 实证 13/13。**定位修复 v2.2.1（5f01ebf2）**：同上各端生效口径；弹窗改锚 🎤 按钮下方 + 视口夹取，此前「屏幕外不可见」问题根治。**识别提速 v2.3（76822b6c）**：云端网页/云APP push 即生效（**voice-input.js cv 已刷 36f62783 自动拉新**）；云桌面随下次打包生效；离线端/site-admin 无语音零影响；行为变化——所有 🎤 说话期间按钮下方出现实时字幕（字随话出），药物 🎤 点一次连报多味药（每句停顿即录入，8 秒静音自动停，再点立即停），患者信息各框仍单句但再点可立即中断；vm 实证 15/15（interim/final 分流、守护重启、超窗收尾、watchdog、stop、会话防竞态、no-speech 分模式）。**智能分发二期（388ebd5a）**：云端网页/云APP push 即生效（注入器内嵌 index.html 无缓存问题）；云桌面随下次打包生效；离线端/site-admin 零影响；行为变化——病史症状标题行右缘新增深紫 🎤 总入口，连说整方「男 35岁 失眠多梦 黄芪15克 当归10克 七剂」自动分发到性别/年龄/剂数/病史/药物表格（多候选弹窗连弹、口音学习照常），未识别段 toast 列出请手动处理；vm 单测 27/27。**老用户自助升级（5fed6e51）**：云端网页/云APP push 即生效（**auth-core.js cv 已刷 3d3596c9 自动拉新**）；云桌面**热包 2026.09.18-1 已发**（已装机用户自动热更，无需重装/重打包——语音版功能链路上桌面的首次热包送达）；服务端 push 即生效；离线端不涉及；行为变化——标准版/机构版已登录用户在「基础设置」授权状态区看到紫色「🎙️ 升级语音版」按钮，点击直达输码页（手机号自动填入），输语音版激活码成功后按提示重登即可用语音功能；site-admin/electron 镜像同步但无此场景（管理端不消费）。线上验证：auth-core.js?nocache 含 voiceUpgradeSettingsBtn ✅、hot-update/desktop/cloud/version.json=2026.09.18-1 ✅。**整方快速录入免费层（e94e9004）**：云端网页/云APP push 即生效（注入器内嵌 index.html 无缓存问题）；云桌面**热包 2026.09.18-3 已发**（自动热更）；离线端零影响（阶段二下沉后另行送达）；site-admin 双轨副本无此功能（基线已重冻结）；行为变化——「填资料」后新增「📋 整方录入」按钮（全用户免费，无需语音版权限），弹窗内用输入法语音/打字/粘贴整段文本点「解析录入」自动分发（与付费 🎤 同一解析链），药物搜索框输入「黄芪15克」整句自动入表。**姓名/诊断路由补全（c77fe127）**：同上各端口径（云桌面热包 2026.09.18-4）；行为变化——整方口述姓名双通道识别（前缀「姓名王明/患者王明/叫王明」+ 首段裸名 2-4 汉字 miss 判定），诊断前缀「诊为/诊断为」整段捕获，填入+高亮+姓名历史患者联动。**中整合显眼入口（4d029641，云桌面热包 2026.09.18-5）**：用户指示工具栏排满——「横向打印」按钮 **JS 动态隐藏**（display:none 零结构改动，printPrescription 函数保留、纵向打印不受影响），原位顶替深紫渐变「🎙️ 语音录入」按钮（聚合整方解析弹窗，原「📋 整方录入」小按钮取消单一入口），弹窗标题统一「🎙️ 语音录入（整方解析）」；铁律——**移除既有按钮一律 display:none 动态隐藏而非删 HTML（基线/守卫零扰动），锚点用 onclick 属性匹配**（`printPrescription('landscape')`）比 textContent 稳（文案可变、onclick 唯一）。**阶段二下沉离线端（ca0e3828）**：离线桌面已装机用户**热包 local 2026.09.18-1 自动送达**（16 文件含 voice-input.js/pinyin-pro，下次启动生效）；离线APP 已装机用户**热包 app-local 2026.09.18-1 自动送达**（14 文件，minAppCode 288 继承钉住，288+ 装机下次启动生效）；老云桌面装机**热包 cloud 2026.09.18-6 补送 voice-input.js/pinyin-pro**（修复一期清单漏登导致的 404 解析链中断）；新装机/重打包：离线桌面 package.json build.files 已登记（下次 electron-builder 出包即含），离线APP assets/public 已就位（下次 APK 出包即含）；行为变化——离线两端顶部工具栏「横向打印」位变为「🎙️ 语音录入」（点击弹整方解析框，用输入法语音/打字/粘贴），四框 mic 付费层不出现（无 Web Speech API 自动隐藏）；云端网页/云APP 无变化（本阶段零改动）。

