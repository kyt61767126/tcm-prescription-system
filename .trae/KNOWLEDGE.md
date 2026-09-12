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

**6 份 index.html**（改共性 JS 必须全同步，漏 1 份=该端功能缺失/回退）：

1. `public/index.html`（云端权威源）2. 云桌面 electron/ 3. 云APP副本 4. 离线APP副本 5. `app_project/db-offline/index-app.html`（打包源，漏改=下次打包回退）6. 离线桌面 index.html（不属 html-sync-check 比较范围，**最易漏**）

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

* **index.html 功能双源纪律**：离线系 `desktop/index.html` 与 `index-app.html` 同源分叉维护——凡给 desktop/index.html 加功能，必须同步判断 index-app.html 是否需要移植。drift-guard 防呆：`tools/diff-index-app.cjs` 对比函数集+功能标记，build-app.bat 打包前自动调用（--quiet），差异打 WARN（基线 tools/.drift-baseline.json；桌面特有确认后 `--update-baseline` 更新）。

* shared JS（db-adapter/button-manager/edition-lock 等）：改 `shared/` 权威源后跑 `sync-all.ps1`；云端APP db-adapter.js 有防御性初始化本地差异，Group 1 排除需手工维护。

* shared 组件新增 IIFE 必须过 `node tools\smoke-runtime.cjs --all`（无 DOM 沙箱全量加载，凡 window.* API 一律 try-catch 包裹——S7 红线：无 DOM 环境加载不得抛错）。

* ★ 2026-09-10 **symptom-dict.js 云端APP副本同步盲区**（医师框 60px 修复两轮未生效实锤）：`cloud_app/app/src/main/assets/public/symptom-dict.js` **不在 sync-all.ps1 清单、不在 build-app.bat 打包前拷贝链**（云端打包只拷 auth-core.js/permission.js/config.json），且该副本被 8-21 遗留混淆版占据（历史 obfuscate 还原漏此文件）。事故链：改 shared 权威源 → sync-all 全绿（该副本不在清单=校验不到）→ 云端APP 打包继续用旧版 → 修复静默丢失。**铁律：改 shared/symptom-dict.js 后必须手工 Copy-Item 到 `cloud_app/app/src/main/assets/public/`，并解包 APK 验证 `doctorName{flex:0 0 90px` 等特征串存在**（离线APP assets 副本在 sync-all 清单内无此问题）。同轮次发现：云端打包脚本末尾 `set /p` 交互提示在无人值守/后台调用时挂起——后台跑 pack-app.bat 必须先 `set NO_PAUSE=1`（离线/云端 build-app.bat 均已支持该开关）。

* ★ 2026-09-09 **user-store.js 双路径同步铁律**（2069f13d→打包被拦实锤）：`shared/user-store.js` 有**两条独立分发路径，漏一条=打包中断**：
  1. **7 份 index.html 内联标记块**（USER-STORE block）→ `node tools/sync-shared-blocks.cjs`
  2. **2 份独立 js 副本**（`db-offline/desktop/electron/user-store.js` + `db-yunduan/cloud_desktop/electron/user-store.js`，login.html 独立加载）→ `node tools/copy-consistency.cjs --fix`
  事故链：phone 修复只跑了路径1 → push 六道门全绿（当时门不含 copy-consistency）→ 云桌面打包时 copy-consistency FAIL+Auto-FIX 覆盖独立副本 → 产生未提交"源码修改"（user-store.js 是真实源码不能进副作用白名单）→ 云端APP 被源码落定门拦截。
  **铁律：改 shared/user-store.js（及 user-admin.js）后必须双跑两条同步 + `copy-consistency.cjs` 纯检查确认 5 组 42 副本全绿再 commit。** 已同步收口：pre-push 升七道门（⑦=copy-consistency）、CI verify-unified 升六重防线（⑥=copy-consistency），独立副本漂移从此 push 时拦截。

* ★ 2026-09-09 **离线APP「打包源覆写回滚」铁律**（金额修复 29f9a06d 被打回旧版实锤）：`db-offline/index-app.html` 是离线APP 的**打包源**，`build-app.bat` 每次 APK 打包执行 `copy /Y index-app.html → assets/public/index.html`——assets 只是构建产物副本。事故链：金额显示修复（formatPrice）只改了 assets 副本、漏了打包源 → push 全绿（无门监控这对文件）→ 当晚打包源覆写副本 → **已提交修复在新 APK 中静默回滚**（¥356.0025 浮点 bug 复活，versionCode 261 报废重打 262）。**铁律：改离线APP 的 index.html 一律改打包源 `db-offline/index-app.html`，再 Copy-Item 到 assets；直接改 assets 必被下次打包覆写。** 已收口：html-sync-check.ps1 新增第③节「离线APP source/assets 字节级一致性」（SHA256 比对，随 pre-push ①运行），改源漏副本/改副本漏源均在 push 时拦截。同类隐患备忘：build-app.bat 还从 desktop\ 复制 config.json/vendor/共享 js 模块到 assets——共享 js 三点（shared→desktop→assets）已被 copy-consistency 链覆盖，vendor 库基本不手改，风险敞口就是 HTML 这对，已堵。

* ★ 2026-09-10 **手机端布局改造 + 云端APP隔离铁律**（桌面/手机布局差异 → 隔离）：操作界面把「剂数+输入框（doseCountInput3）」从诊断行移到价格行（剂数/每剂/药费/诊疗/总计一行）、「医师（doctorName）与诊断同排」——**仅手机端生效**（离线APP：`db-offline/index-app.html` 打包源 + assets；云端APP：`cloud_app/app/src/main/assets/public/index.html`；鸿蒙：`rawfile/index.html`），**桌面端保持原样（剂数仍在诊断行）**。**架构矛盾**：`public/index.html`（权威源）同时驱动云桌面+云APP，桌面/手机布局冲突无法同一源供给 → 把云APP 从 `tools/sync-html.ps1` 与 `tools/html-sync-check.ps1` 的 `$Targets` 移除，**隔离独立维护**（同离线端 index-app.html 模式）；云桌面继续跟随权威源（桌面布局）。改该类布局时：桌面/网页=只改权威源 `public/index.html` 后跑 sync-html.ps1 同步云桌面；手机=按上面三处独立改，勿改权威源（否则污染云桌面/云端网页）。

* 改 index.html JS 后必查三处：`html-sync-check.ps1`（副本漂移）、`sync-all.ps1 -VerifyOnly`（shared 组）、index-app.html 打包源与副本 diff。

* ★ 2026-09-02 **index.html 云端副本从手工复制升级为权威源生成模式**（`tools/sync-html.ps1`，观察期毕业）：改 `public/index.html`（权威源）→ 跑 `sync-html.ps1`（已并入 sync-all.ps1 Group 11）→ 副本自动重生成（端配置块 EDITION/PRODUCT\_NAME/APP\_MODE+身份注释原样保留，其余全部自动传播）。**禁止直接改云桌面/云APP副本**。历史事故链：手工复制时代权威源修复漏同步副本→CI 红灯；权威源累积 3 份重复 hideUserTypeSelect IIFE；注释位置漂移——且 html-sync-check 的 ±30 行窗口重对齐把前两类真实漂移掩盖成"IN SYNC"。安全设计：生成器对 EDITION/APP\_MODE 赋值行多于 1 次的结构异常直接报错拒写（宁可失败不可错写）。

* ★ 2026-09-02 **git pre-push 本地拦截门**（`.githooks/pre-push`，`git config core.hooksPath .githooks` 已启用，入库共享；2026-09-07 升六道、2026-09-09 升**七道**）：push 前自动跑 ①html-sync-check ②sync-all -VerifyOnly ③注入幂等 ④check-interface ⑤auth-core 11 副本 ⑥激活/登录参数探针 ⑦copy-consistency（42 独立副本哈希）七道秒级校验，漂移推不到 GitHub（CI 红灯从"事后发现"变"事前拦截"）。紧急绕过 `git push --no-verify`（事后必须补跑）。克隆/换机后需重跑一次 `git config core.hooksPath .githooks` 激活。

* ★ 2026-09-02 **CI 红灯第二根因（pwsh/powershell 跨平台坑）**：`test-source-settled.ps1` 子进程硬编码 `powershell`——GitHub ubuntu runner 只有 `pwsh`，第 5 道门必炸。修复：子进程 shell 跟随宿主 `$PSVersionTable.PSEdition -eq 'Core' ? 'pwsh' : 'powershell'`。**铁律：CI 会跑的 ps1 里调用子进程 shell 一律按此判定，禁止硬编码 powershell**（Windows 专用打包链路 one-click-pack/release-menu 等不受影响）。教训：本地门禁全绿 ≠ CI 绿——本地 Windows 永远有 powershell，此类问题只在 ubuntu 暴露；红灯时先看 `gh run view --log-failed` 远端日志而非只跑本地。

- CI 三重校验闭环（2026-08-31 升级四重：`.github/workflows/verify-unified.yml`：check-interface → sync-all -VerifyOnly → html-sync-check → check-injection-idempotency 注入幂等性门），推送红灯即漏同步/漏防呆。红灯修复：界面改动→重建基线一并提交；shared 改动→本地 sync-all 后提交；HTML 副本→以权威源回改；注入幂等→改整段重写/补守卫，确属守卫兜底审查后 `--update-baseline` 收录。

- ★ 2026-08-30 发布链路收口 `tools/artifact-locate.js`（单一权威模块）：产物路径配置/APK 定位（项目根产物优先→gradle 输出回退→public/downloads 旧包）/fromBuild 标记/同步 downloads（带 sha 校验）只有这一份；auto-publish.js、publish-release.js、auto-update-downloads.js 三工具全部 require 引用，**禁止再自维护产物路径配置**（历史三工具三份路径各自演化=发布事故架构根因）。自检命令 `node tools/artifact-locate.js --check`（源不一致/半成品嫌疑 WARN+exit 1）。

- ★ 2026-08-31 发布产物命名规范（用户明确要求）：本地版 GitHub Release 上传名统一英文 **huikang-local\[-setup]-x.x.x.exe / huikang-local.apk**（与云端 huikang-cloud 对仗），**禁止拼音 dingzhi 对外展示**。实现：publish-release.js prepareUploadFile 内 UPLOAD\_NAME\_KEY={dingzhi:'local'} 映射——内部 APP\_CONFIG key 'dingzhi' 不动（manifest dingzhi→local 双 key 镜像依赖），只映射上传文件名。GitHub 资产改名用 `gh api -X PATCH repos/{o}/{r}/releases/assets/{id} -f name=新名`（v2026.08.31 已改 3 个：setup/便携/apk；旧 1.0.158 两个保留原名防断链）；hash-manifest.json + updates/local/latest.json 的 URL 同步替换；桌面 electron-updater 读 latest.json url 自动跟随。官网 download.html（两份镜像）同轮新增：①safeDownload 下载确认机制——下载前 confirm 弹窗显示程序友好名（downloadFileDisplayName 把 huikang-local-setup-1.0.159.exe → 惠康中医-本地 安装版 1.0.159，兼容旧 dingzhi 名），确认后才开始下载+toast 显示"正在下载：程序名"；②APP 安装风险提示块——向客户说明无风险+提示原因（非商店渠道分发的 APP 系统一律提示，不代表检测到病毒）+处理方式（仍然安装）；③桌面步骤补"浏览器下载完成弹保留/放弃时选保留"。

* 批量 replace\_all 后必须 Grep 验证字面量归零（并行 Edit 会静默失败）。

* 全局变量一律 `window.xxx` 访问；跨脚本/跨 IIFE 调用一律 `typeof fn === 'function' && fn(...)` 防御式写法。

* **云端 APP 是 WebView 壳，内容取自线上 public/**：改云端 APP 界面必须在 `public/` 改并推 GitHub，改 APK 内 assets/public 无效。

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

* ★ 2026-09-02 **APK 版本号 SSOT（Gradle=唯一权威源，详案已归档）**：显示版本号统一 **V{versionName}.{versionCode}**——MainActivity `injectAppVersionSSOT()`（onPageFinished 读 PackageInfo 注入覆盖 `window.APP_VERSION`，0/600/1500ms 三次幂等重试）+ 发布脚本 `readAppDisplayVersion()` 双侧从真实构建元信息取值。禁止：①多处硬编码版本串；②APK 抄桌面 latest.json（两条 versionCode 曲线，历史错判两次）；③改 HTML 字符串硬编码版本（不进客户安装包，等于自娱自乐）。**新增显示注入前必须 grep 宿主函数内既有注入机制——同一 DOM 挂载点的两个写入者必然叠加（Build N 双显事故）**。全过程 → `.trae/archive/2026-08-31-09-03-misc-experiences.md`。

* ★ 2026-09-11 **一键打包新增 [4] 智能打包（傻瓜式自动选择端）**：背景=用户"昨天已打包、今天只改部分端"时靠人工判断选 [1][2][3] 范围，易选大（无谓重打+versionCode 无谓递增）或选漏。实现（one-click-pack.ps1）：`Invoke-SmartPack` 先对四端跑 build-skip.ps1 -Check 增量检测（基线后该端源路径提交比对+工作区+产物指纹三要素），**先打印「[重打]/[跳过] + 触发文件清单」计划再执行**，只对有改动的版本组调 Build-Cloud/Build-Offline（整组无改动连配置同步都跳过）。入口：交互菜单 `[4] 智能打包 ★推荐` / 自动模式 `一键打包.bat 4` / 纯预览 `one-click-pack.ps1 -SmartPlanOnly`（只出报告不打包）。注意：**shared/ 通用模块（auth-core/observer）改动会波及四端全部标记重打——这是诚实检测不是误报**（auth-core.js 副本真实变了），急赶时间可人工选 [2]/[6] 缩小范围。铁律：**增量检测的判定粒度是"该端消费的源路径"，新增打包单元时必须在 build-skip.ps1 $unitDefs 登记其 sources/excludes（desktop/electron 只影响桌面不进 APP 的 excludes 先例）**。

* ★ 2026-09-11 **E2E 打包门"假失败"加固（Defender 首扫超时，2026-09-11 08:22 事故）**：用户 08:08 手动跑 [2] 本地版，桌面打包在 [7.8/9] pre-fuse E2E 的 E1（本地账号登录→等主窗口）30s 超时失败中止——**事后单跑同一 win-unpacked 产物 E1 5 秒通过、全 6 条 25 秒通过**，根因=打包流水线内 electron-builder/asarmor 刚写完 exe，首启被 Defender 实时扫描+高负载拖慢，45s 等待不够（假失败，产物本身合格）。修复（db-offline/desktop + db-yunduan/cloud_desktop 两个 e2e/run-e2e.cjs 同步）：①主窗口等待 45s→90s；②findWindow 超时消息改按实际 timeoutMs 显示（原硬编码"30s"误导）；③**失败用例立即重试一次**（全新 userData 重走完整断言，要过就得完整过，不产生假绿灯；重试通过在汇总标注"第2次重试通过，首启抖动"）。铁律：**E2E 门禁的等待超时必须按"流水线内首启最坏情况"（杀软扫描）设定而非"平时单跑速度"；带门禁的自动化流程对环境抖动类失败必须重试兜底——假失败代价=用户白等 20 分钟全流程重跑，而重试成本仅几十秒**。

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

* 本地数据加密：db-adapter.js 字段级 XOR+Base64（ENC1: 前缀），敏感字段写密文读明文，密钥由 hostname+userAgent 派生（换设备不可解密），旧明文自动兼容升级。**改 db-adapter.js 的 IndexedDB/localStorage 读写时必须保持 \_encRecord/\_decRecord 配对，否则读到密文。**

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

## 11. D1 数据库迁移与激活审核有效期（2026-09-10）

### 用户表 D1 切读（登录+用户列表）

* **目标**：用户认证与列表查询从 KV 迁移到 D1，KV 保留回退兜底。
* **改造点**（`functions/api/users.js`）：
  - `findUserForLogin(kv, username, env)`：D1 `SELECT * FROM clinic_users WHERE clinic_id=? AND username=?` 优先，KV 回退命中时 `syncUserToD1` 补齐。
  - `getAllClinicUsers(kv, env)`：D1 `SELECT * FROM clinic_users` 一次查全，KV 回退。
  - clinic_admin 本诊所用户列表：D1 `WHERE clinic_id=?`，KV 回退。
* **辅助函数**：`d1RowToUser`（D1 行→用户对象）、`findClinicUserD1`、`syncUserToD1`（UPSERT）、`deleteUserFromD1`。
* **回退补齐**：KV 命中用户时自动写 D1，存量数据逐步迁移，无需一次性批量导入。
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

## 19. 后续路线图（2026-08-31 定，试用观察期三步走）

* **第一步（当前）**：进入 1-2 周正常看诊观察期，不刻意测试——真实使用是最好的验收。

* **第二步（观察期内被动守护）**：CI 四重门（`.github/workflows/verify-unified.yml`：check-interface → sync-all -VerifyOnly → html-sync-check → check-injection-idempotency）每次推送自动校验，有漂移 GitHub 红灯提醒，按第 2 章红灯修复流程处理（界面改动→重建基线一并提交；shared 改动→本地 sync-all 后提交；HTML 副本→以权威源回改；注入幂等→改整段重写/补守卫）。观察期内**只修实报 bug，不做主动优化**，避免引入新变量。

* **第三步（观察期稳定后）**：最后一步「权威源生成模式」——6 份 index.html 收口为由单一权威源生成，届时改界面真正只改一处，替代第 2 章手工 6 份同步清单（sync 脚本/CI 门届时随架构收口一并重构）。**该模式落地前，多端同步仍严格按第 2 章清单手工执行，不得提前松懈。**
