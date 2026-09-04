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

* **auth-core.js 双权威源**：`shared/auth-core/offline.js`（试用版→3 副本）+ `cloud.js`（无试用→8 副本），改副本必须回写权威源后跑 `tools/sync-auth-core.ps1`，否则打包被旧版覆盖（历史"神秘回退"根因）。

* `cloud-api.js` 有 **8 处副本**需同步；APP 版 cloud-api.js 必须含 `typeof window._cloudReachable === 'undefined'` 防御性初始化。

* **index.html 功能双源纪律**：离线系 `desktop/index.html` 与 `index-app.html` 同源分叉维护——凡给 desktop/index.html 加功能，必须同步判断 index-app.html 是否需要移植。drift-guard 防呆：`tools/diff-index-app.cjs` 对比函数集+功能标记，build-app.bat 打包前自动调用（--quiet），差异打 WARN（基线 tools/.drift-baseline.json；桌面特有确认后 `--update-baseline` 更新）。

* shared JS（db-adapter/button-manager/edition-lock 等）：改 `shared/` 权威源后跑 `sync-all.ps1`；云端APP db-adapter.js 有防御性初始化本地差异，Group 1 排除需手工维护。

* 改 index.html JS 后必查三处：`html-sync-check.ps1`（副本漂移）、`sync-all.ps1 -VerifyOnly`（shared 组）、index-app.html 打包源与副本 diff。

* ★ 2026-09-02 **index.html 云端副本从手工复制升级为权威源生成模式**（`tools/sync-html.ps1`，观察期毕业）：改 `public/index.html`（权威源）→ 跑 `sync-html.ps1`（已并入 sync-all.ps1 Group 11）→ 副本自动重生成（端配置块 EDITION/PRODUCT\_NAME/APP\_MODE+身份注释原样保留，其余全部自动传播）。**禁止直接改云桌面/云APP副本**。历史事故链：手工复制时代权威源修复漏同步副本→CI 红灯；权威源累积 3 份重复 hideUserTypeSelect IIFE；注释位置漂移——且 html-sync-check 的 ±30 行窗口重对齐把前两类真实漂移掩盖成"IN SYNC"。安全设计：生成器对 EDITION/APP\_MODE 赋值行多于 1 次的结构异常直接报错拒写（宁可失败不可错写）。

* ★ 2026-09-02 **git pre-push 本地拦截门**（`.githooks/pre-push`，`git config core.hooksPath .githooks` 已启用，入库共享）：push 前自动跑 html-sync-check + sync-all -VerifyOnly + 注入幂等三道秒级校验，漂移推不到 GitHub（CI 红灯从"事后发现"变"事前拦截"）。紧急绕过 `git push --no-verify`（事后必须补跑）。克隆/换机后需重跑一次 `git config core.hooksPath .githooks` 激活。

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

* ★ 2026-09-03 打包中途红/黄字判读口诀（小白高频误报，看结尾不看中途）：一键打包**只要结尾出现绿色「[打包成功]」横幅=产物合格**，中途红/黄字多为无害过程输出——gradle WARNING（flatDir/overridePathCheck，历史恒在）、\[WARN\] keystore header abnormal（随后必有 \[OK\] keystore OK）、login.html 未检出版本 token（标注不阻断）、\[SIGN\]\[OK\] status=UnknownError（自签名未信任根=预期）、.gradle configuration-cache 残留 WARN。**真正要处理的红字只有 5 种**：结尾红色「打包失败」横幅、\[FATAL\] 验收门未通过、\[ERROR\] 源码未落定、\[ERROR\] 检测到另一个构建正在运行、\[SIGN\]\[ERROR\]。事后取证看 `.build-cache\logs\pack-*.log`（transcript 全程转录，控制台关闭不丢失）。

* ★ 2026-08-31 源码落定门（1.2.194 事故根因防呆，架构级补缺）：用户在 AI 修改源码进行中双击打包 → exe 静默装走"当时磁盘状态"（实测缺当日修复）；而现有全部铁闸只验「产物内部一致」（版本/标记/签名/asar/fuse/E2E），无一验「打包起点是否落定」——装走旧代码时门禁全绿。**布防已收敛为两层单一权威源**：`tools/source-settled.ps1`（Get-SourceSettledBlockers + **-Assert Node 出口**（发布链路 commit 前置，exit 1=未落定），三处 dot-source：①ensure-build-env Step 1.5（4 端 build 唯一咽喉）②release-menu Invoke-SinglePack 前置③one-click-pack AutoMode 前置）+ `tools/pack-side-effects.ps1`（**打包副作用清单权威源**，与 one-click-pack SideEffectCollect autoPatterns 共用一份：package.json/build-meta.json/hash-manifest.json 整文件放行 + build.gradle 纯 versionCode/versionName 行变化行级精判——整文件放行会开洞，签名混淆配置是真实源码）。保险丝 ALLOW\_DIRTY\_BUILD=1。**永久单测** **`tools/test-source-settled.ps1`** **入 CI 第五重防线**（verify-unified.yml：界面基线/shared 同步/HTML 副本/注入幂等/落定门单测）——纯函数断言（A 系）+ 差值集成断言（B 系，不依赖基线干净，CI 友好）+ Node 出口断言（C 系）。铁律：①**用户在 AI 修改过程中打包是真实高频场景，打包链路必须显式防御"源码未落定"，不能指望用户自觉**；②**门禁/清单逻辑禁止内联复制多份**——首版 3 副本次日 build.gradle versionCode 误拦，又发现 hash-manifest.json 漏列=下一次打包必再误拦（两份副作用清单各自演化的实证），全部收敛单源（同 artifact-locate.js 教训）；③**凡"打包自身改动"新增文件类型必须登记 pack-side-effects.ps1**，否则误拦用户或副作用散落；④**防呆机制本身必须有永久单测**（临时脚本用完即删=回归无守护，误报当天才补测）；⑤判断产物是否含某修复仍以 asar 搜功能级标记为准（见上条）。

* ★ 2026-08-31（晚）"工作区脏检测"全链收敛+发布 commit 半成品混入收口（build\_output 残留事故举一反三）：用户一键发布成功但末段 WARN"拒绝记录基线"——根因是 8/29 打包中断残留的 `build_output_日期_时间/` 目录未被 .gitignore 覆盖（只忽略固定名 `build_output/`），被 build-skip 基线检查当"未提交源码"。**系统性排查发现全仓共 5 处独立的 git status 脏检测**，收口为：①`.gitignore` 补 `build_output_*/`（时间戳变体）；②build-skip.ps1 加**产物形态黑名单** `$productShapePatterns`（build\_output\*/\_backup\_asar/win-unpacked/dist\* 的顶层目录正则——.gitignore 漏登记新变体时的双保险，`??` 且顶层命中即不算源码脏）；③publish-release.js / auto-update-downloads.js 的 git 段加**源码落定前置**（调 source-settled.ps1 -Assert）——此前 `git add 指定路径` 后用全局 status 判非空就 commit：`??` 使 status 恒非空 → staged 半成品会被 `git commit -m` 一并提交推送（1.2.194 在发布链路的镜像变体）；④单测扩到 22 项（A10-A13 产物形态/A14-A16 官网产物放行/B6-B7 Assert 出口）。铁律：**①凡"构建产物目录"命名出现新变体（时间戳/old/new/v 后缀），必须同时登记 .gitignore 与 build-skip productShapePatterns 两处（后者是漏网兜底）；②发布链路 commit 前必须跑与打包同源的落定检查，禁止"add 指定路径+全局 status 判空"模式（?? 恒非空，必混入）；③存量残留产物目录直接删除（win-unpacked 纯产物无源码），不 git add 入库**。

* ★ 2026-08-31（夜）首次真实发布实战：落定门又拦下发布工具自身产物（第 3 个白名单盲区，与 versionCode 同构）——publish-release.js `--confirm --push` 全流程（合规 8 项检查过 → Release v2026.08.31 创建+6 产物上传 → public/downloads 同步复制+latest.json 更新）最后 git 段被自家落定门拦：发布工具**刚写入**的官网产物（public/downloads/\*.apk、public/updates/\*/latest.json）被当"未提交源码修改"。修复：pack-side-effects.ps1 新增 `$PackSideEffectDirPrefixes` 路径前缀整目录放行（public/downloads/、public/updates/——该目录按设计入库供 Cloudflare 部署，人工不在其中改源码），单测 A14-A16 回归。铁律：**①副作用白名单的枚举维度有三层——basename（版本文件）+ 路径前缀（发布产物目录）+ 行级 diff（build.gradle 混合源码），新工具链落成后必须先走一次真实全流程才能暴露盲区（三个盲区全是实战炸出来的，纸面审计想不到）；②落定门防的是"AI/人改源码未提交"，凡是"工具自身在流程中写入的文件"都属副作用——给新流程接门禁时必须同步盘点该流程会写哪些路径**。

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

* **APP 端功能判断禁止依赖 IS\_ELECTRON 常量**（shim 在 onPageFinished 注入，顶层常量已固化为 false），必须运行时判断 `window.electronAPI && window.electronAPI.xxx`。

* JS 桥三层防御：Java invoke() 必须 catch(Throwable)；shim 层拦截 null/'null'/''；前端 result null 安全。WebView 桥异常表现为「返回 null」而非 JS 异常。

* ★ 2026-08-30 重装激活登录失败双坑（用户实测 13398628212/admin123 失败）：①备份导出 users 恒为 \[]——`JSON.parse(localStorage.getItem('local_systemUsers'))` 读的是 XORv1 加密串必抛异常，「备份含账号表」从未真正生效；修复=先 simpleDecrypt 再 parse（4 处离线系 index.html）。②重装自愈只自动填手机号不填密码，密码栏留空被静默写成 admin；修复=auth-core 激活提交前密码留空弹 confirm 明确告知。排查铁律：用户"激活后登录不上"先让 TA 试 admin。

* ★ 2026-08-30 登录兜底自愈+账号映射（双坑修复后仍登录失败，诊断版实锤两根因）：①启动自愈（startLicenseCheck 2 秒延迟）依赖桥注入时序，桥静默返回 null 时激活账号没进 localStorage——handleLogin 兜底：找不到账号时当场调 getActivationUsers 从 config 拉激活账号补入再匹配（标记 LoginSelfHeal）。②Tab2「激活码直输」submit(code,user) 只传 CONFIG.doctorName（可能是出厂默认"XXX"）→ Java 建账号 username=医师名、无 phone → 输手机号永远找不到——个人标准版登录输入未命中时映射到实际激活账号（有 phone 优先，否则非内置 admin）。登录失败排查利器：失败提示屏显「本地N个账号\[用户名(手机号掩码)]密码\[哈希/明文N字]」诊断行。铁律：**凡依赖启动时序+异步桥的自愈，必须在用户操作路径上再做同步兜底**。

* ★ 2026-08-30 底部快捷栏永久消失（用户实报）：switchMobileTab 统一设内联 `mobileActionBar.style.display='none'`，而 CSS 媒体查询 `display:block` 无 !important 压不过内联——点导航/按返回键切走再回门诊后快捷栏（录像/拍照/保存/清空/改密）消失。修复=case 'prescription' 清空内联样式交还 CSS。铁律：**JS 设过的内联 display:none 要恢复必须显式清空（style.display=''），别指望无 !important 的 CSS 规则接管**。

* ★ 2026-08-31 桌面版一键恢复双故障（用户实测云桌面：备份成功、目录 9 个 json，恢复却报"未找到"+选择器打不开）：①**fs.promises 没有 existsSync**——main.js 顶部 `const fs = require('fs').promises`，而 list-backup-files/read-backup-file 调 `fs.existsSync` 抛 TypeError → handler catch 返回 success:false → 前端 else 误报"未找到备份文件"；save-backup-file 恰用 fse.ensureDirSync 不触发 → "备份成功却找不到"隐蔽分裂。修复=`require('fs').existsSync`（云/离桌面 main.js 各 2 处）。铁律：**fs.promises 只覆盖 promise 化 API（readdir/stat/readFile/writeFile✓），existsSync/accessSync 等同步族不存在，混用静默炸 handler**；后端 handler 返回 {success:false,error} 时前端文案必须显示 error（否则异常被伪装成"无文件"）。②**alert 后 input.click() 打不开文件选择器**——alert 已替换为主进程原生同步 dialog（阻塞 renderer 主线程）→ 用户激活丢失 → Chromium 静默拒绝 FileChooser（需 user activation）。修复=新增 open-backup-picker IPC（主进程 dialog.showOpenDialog + 读文件返回 json，无激活限制），preload 暴露 openBackupPicker，6 份 index.html importDataByFilePicker Electron 环境优先走 IPC，浏览器/APP 路径不变。铁律：**渲染层弹过 alert/confirm（原生同步 dialog）后再触发 input.click() 一律不可靠，桌面版文件选择必须走主进程 dialog IPC**。云桌面命名前缀=「本地\_」（cloud\_desktop index.html exportData fileName 规则），别拿前缀区分是哪个端写的备份。

## 7. 官网付费与激活闭环（2026-08-30 全链路现行）

**价格体系（年费订阅，双端独立授权）**：本地标准版 99 元/年（单用户）、本地机构版 299 元/年（3-5 用户）、云端标准版 199 元/年（单用户）、云端机构版 399 元/年（3-5 用户）。桌面/手机激活码独立授权，双端使用需分别购买。试用：免费 7 天，admin/admin 登入，限离线桌面/APP，云端无试用；**内置 admin/admin 仅试用期有效，激活后自动失效**。
**★ 2026-08-30 机构版一码多机产品语义定稿（用户确认）**：机构版（离线/云端）桌面程序一个激活码授权 **3-5 台电脑**（默认 5），每台设备管理员通过用户管理添加 3-5 个普通用户（医师登入，唯一管理员锁死 role=user，**不加硬上限**——加第 6 个也不拦，避免老客户被卡）；离线机构版各台电脑处方数据各自独立（本地 data/），云端机构版账号在服务器、任意电脑可登数据同步。多设备授权框架早已齐备（license `devices` 数组 + `maxDevices` 1-10 + validate.js 多机校验/换机自动解绑最旧/同码重激活，同设备版本互斥 device\_version），本轮唯一修复=发码默认值下沉服务端：**admin-approve.js 与 activate-from-ticket.js 漏传 maxDevices 时按 type 兜底（pro=5 / personal=2）**——此前两入口一律默认 2，工单审批页只传 ticketNo 不传 maxDevices，机构版工单实际只发 2 台（新 gap 根因：UI 传参与 API 兜底分裂，管理后台一键激活 UI 早已传 5 但 API 直调/工单链路漏传）；工单页 confirm 文案同步（public/admin + site-admin 两份 ticket-approval.html）。铁律：**发码类默认策略必须放服务端按 type 兜底，不能依赖某个前端页面恰好传参——同仓库多入口（一键激活/工单/手动生成/批量）各自演化，漏传入口就是策略漏洞**。
**付费流程**：选版本 → 填信息下单（order-submit.js，pending\_payment 不进待审列表）→ 扫收款码 → 付款确认（order-paid.js：支付方式+转账单号后6位，转 pending 入待审）→ 后台核对付款信息一键激活 → 客户 order-status.js 30 秒轮询自助领码。
**客户端导引闭环**：客户端激活等待界面/工单成功面板有「去官网付款」导引（桌面二维码/APP按钮 → 官网 `?mid=识别码&ed=版本意图` 自动预填设备识别码+自动选中版本直进下单步骤显示价格，客户无需选版本填信息付款即可）；★ 2026-08-30 云端系（云端APP+云桌面）同款接入：`shared/auth-core/cloud.js` openOfficialPayUrl（ed 映射 institution→cloud-pro / personal→cloud-personal，8 副本同步）+ 云端 MainActivity 移植 openExternalUrl 桥（严格白名单 download.html 前缀；云端 WebView 未开多窗口且非官网域导航被 shouldOverrideUrlLoading 反钓鱼拦截弹回首页，桥是唯一可靠通路）；激活窗口原 `<a target=_blank>` 链接已升级为桥接按钮。admin-status.js 支持 machineId 兜底——客户端轮询自己 requestId 未激活时，扫描最近 200 条找同 machineId 已激活的官网订单返回 activated+license（官网下单必须填客户端识别码，?mid= 已自动填）。★ 2026-08-30 修复 APP 端按钮点击无反应：WebView 未开启多窗口，`window.open` 静默返回 null（不抛异常，catch fallback 永不触发）→ 付款导引点了没反应。修复=JS 优先走原生桥 `AndroidNative.invoke('openExternalUrl',{url})`（Java 严格白名单仅放行官网 download.html 前缀，ACTION\_VIEW 系统浏览器打开），桥不可用回退 window\.open（桌面 Electron 正常）。铁律：**WebView 内 window\.open/target=\_blank 一律不可靠，外部跳转必须走原生桥 + URL 白名单**。
★ 2026-08-30 注册激活付款全链统一审计+修复（两处不一致收口）：①云桌面登录框入口原为「📝 注册开通」→openCloudRegister（一页式即时建号，无付款导引，客户注册后不知去哪付款）→ 已统一为「📋 管理员激活」→openAdminActivate（版本选择+三Tab+付款导引全套），与云端APP/离线APP同款同文案（login.js injectAdminActivateEntry，openAdminActivate 优先+openCloudRegister 兜底）；②cloud.js openAdminActivate Tab1 管理员激活申请的 adminWaiting 等待面板原无付款导引（只有工单面板有）→ 已补「💳 去官网付款」按钮（openOfficialPayUrl(machineId, state.edition)，与 offline.js adminWaiting 同款对齐）。至此 5 端登录框入口全景：云端纯网页无入口（设计如此）/云端APP首帧注入/云桌面login.js注入/离线APP auth-core 2s注入/离线桌面login.html静态链接（仅未激活/试用到期显示→activate-window主进程流程，QR+复制链接齐全）。「📝 注册开通」/openCloudRegister 一页式注册已不再是任何端登录框入口（函数保留做兜底）。
★ 2026-08-30（晚）云桌面 Tab1 提交 CORS 真阻断修复（三处）：**根因实证**——users.js CORS 未知 Origin 回退 `'null'`（故桌面 file:// 登录可用），而 admin-submit/admin-status/lookup 回退默认域名（Origin: null 被 ACAO 拦 → fetch TypeError → 报"网络错误"）。修复三处：①auth-core cloud.js/offline.js Tab1 提交+轮询加 Electron IPC 分流（`electronAPI.activate.submitAdminRequest/checkAdminStatus` 优先，云端版主进程 fetch 无 CORS 且持久化 requestId；离线版 IPC 双参含 machineId 兜底；云端APP/网页走 fetch 分支）②服务端 admin-submit/admin-status/lookup CORS 回退对齐 users.js 改 `'null'`（放行离线APP file:///android\_asset；ticket/submit 白名单本就含 'null'）③云桌面 activate-window\.html 补付款导引（adminWaiting 等待面板+工单成功面板，对齐离线桌面：CDN qrcode.min.js 二维码+复制链接+「🌐 浏览器打开」按钮走 setWindowOpenHandler→shell.openExternal；activate-window 用 defaultSession 无 CSP 拦远程脚本）。**铁律补充：桌面版渲染进程新增云端 API 调用，必须分流 IPC（preload 已有 submitAdminRequest/checkAdminStatus/submitTicket 全套），并把 file:// 的 Origin:null 与服务端各接口 CORS 回退策略一并核对——users.js 回退 'null' ≠ admin-submit 回退默认域名，同仓库两种策略曾致登录可用而激活提交被拦的隐蔽分裂**。
★ 2026-09-02（晚）激活流程支付前置 + 删除审核索引残留根治（用户实测两连反馈）：**A. 删除审核后仍报"审核中"**——admin-delete.js 原来只删记录+请求索引，`admin_phone:{phone}` 索引残留（且 2026-08-20 重复提交检查上线前同手机号可能积累多条 pending，兜底扫描命中历史申请）→ findPhoneOccupancy 误判 occupied。修复=删除时同步清理：① `order:{orderNo}` 订单映射 ② 重建 admin\_phone 索引为该手机号剩余最新申请（扫描 newIndex 前 200，无则彻底删 key）。**铁律：KV 派生索引（admin\_phone/order 映射）必须随主记录同删同重建，删除类接口要列出该记录写入过的所有 key 逐项清理**。**B. 支付前置校验（激活必须先付款）**——admin-submit.js 新增判定：已付款待核对（paidAt+pending）→ 复用 requestId 返回 success 让客户端直接进等待轮询；未付款（含历史遗留 pending、全新无付款记录）→ 409 `code=PAYMENT_REQUIRED`「请完成支付」；已付款已激活且仅 machineId 命中 → 只复用 requestId 走轮询领码、**严禁账号补开/密码归一化**（machineId 不可信防接管，对齐 admin-status 2026-08-31 修复）；env=test 放行（E2E 不受影响）。order-submit.js 同步收口：重复下单拦截仅限"已付款 pending"（历史未付款申请不再阻止客户官网下单付款）。**C. 客户端配套（auth-core 双权威源+activate-window 双份+activate.js 三份）**：① cloud.js/offline.js 提交失败分支识别 `res.code==='PAYMENT_REQUIRED'` → 展示新增 adminPayRequired 面板（"请完成支付"+去官网付款按钮，cloud 用 openOfficialPayUrl / offline 用 openPayUrlRobust，返回按钮回 adminStepForm）；② 双端 activate-window\.html 加 showPayRequired()——复用 waiting 面板运行时改文案/显隐（不碰 HTML 结构），showWaiting 开头恢复原文案防污染；③ 三份 activate.js（root+离线桌面+云桌面）submitAdminRequest 失败分支补 `code: result.code || ''` 透传——**主进程 IPC 转发层会静默剥掉自定义字段，新增响应字段必须检查每一层转发是否透传**。生效方式：服务端+云端网页随 push 自动部署；云桌面/离线桌面/云端APP/离线APP 需重新打包。遗留处理：客户手机号仍被"审核中"卡住时，后台把该手机号**所有**待审核申请全部删除即解锁。**D. 免费开通白名单（同日补充）**——新 API `functions/api/license/free-pass.js`（POST action=list/add/remove，仅 platform\_admin）：KV `free_pass:{phone}` → `{phone,note,addedAt,addedBy}` + `free_pass_index`。admin-submit 判定顺序：白名单查询在 findPhoneOccupancy **之前**——白名单客户有未付款 pending → 复用进等待；`!isTestEnv && !freePass` 才走已付款订单检查；新记录带 `freePass: !!freePass` 标记。admin-list.js 的 maskRecord 是**字段白名单**，新增记录字段必须同步补进 maskRecord 否则前端拿不到（本次补 freePass）。后台 UI：admin/index.html 激活审核 tab 底部新增白名单管理区块（手机号+备注+加入/移除），switchTab('AdminActivate') 同时拉 loadFreePassList()；申请列表与审核弹窗对 freePass 显示 🎫免费 标记。客户端 auth-core **零改动**（白名单命中即正常提交成功）。注意：白名单长期有效不自动消耗，客户开通完成后建议后台移除。**E. 独立复核修复（同日，两处真 bug）**——①**并行编辑同文件竞争丢改**：对同一文件并行发起多个 Edit 调用时，各编辑基于同一原始快照，后写回的覆盖先写回的——admin-submit.js 的 `!isTestEnv && !freePass` 条件、offline.js 的 adminPayRequired 面板 HTML 与失败分支判断均被静默覆盖丢失（grep 磁盘才发现，工具返回的"成功"snippet 不可信）。**铁律：同一文件的多个 Edit 必须串行（等上一个返回再发下一个）；改完必须 grep/read 磁盘验证每处改动真实落盘，禁止只信工具返回。**②**白名单换机 machineId 错绑**：白名单复用未付款 pending 申请时不校验 machineId，换机客户复用旧机器申请 → 审核后 license 绑旧机器新设备无法激活。加固：复用条件改为 `freePass && occ.detail.machineId === finalMachineId`；occ 块内拦截与块外支付检查均为 `!isTestEnv && !freePass`——换机白名单客户落到创建新申请（新 machineId + freePass 标记，admin_phone 索引指向新记录），管理员审核新记录即可。
**收款码防替代**：运行时 SHA-256 校验（两份 download.html 内嵌 PAY\_QR\_PINS，不匹配隐藏收款码+警告拦截；网络失败静默跳过）+ CI 校验（tools/verify-payqr.cjs + verify-payqr.yml）。★更换收款码流程：jsQR 验新图域名（qr.alipay.com / payapp.wechatpay.cn）→ 算新哈希 → 同步更新 3 文件 4 位置（两份 HTML PAY\_QR\_PINS + cjs PINS）→ CI 绿灯。
**激活自愈四段一致**（重装/换机）：① /api/license/lookup 凭激活码+machineId 返回原激活信息；② validate.js 手机号核验（clientPhone===recordPhone → phoneVerified 放行）；③ showActivateModal 输码 change 自动联网识别填手机号；④ Java activateOnline 透传 phone。改激活链路必须保持四段一致。
**邀请码自愈四层一致**：onAdminActivated 存 StorageAdapter('license:code')；Java installAdminLicense 的 licenseCode 参数 JS桥→case→MainActivity→LicenseManager 四层透传；服务端 invite.js machineId 兜底；loadInviteInfo 联网找回。签名变更时四层参数必须同步。
**购买页必填项**：设备识别码必填+实时缺失提示（step2ReqHint 红条+可折叠获取教程）。
★ 2026-09-03 已付款客户"已激活但APP登录失败"标准化修复流程（北京源生堂案例）：现象=付款成功提示已激活，但离线APP登录报"用户名或密码错误"+后台用户管理载体显示错误（🖥️桌面·离线标准版，实际是手机APP）。根因：①旧版APK onAdminActivated 同步手机号账号到 local_systemUsers 时密码引用越界，未用用户自设密码；②旧激活记录无 appModeCarrier 字段，users.js 载体读取逻辑错从 user_devices 取值。修复（已随离线APP vV1.0.0.209 发布）：offline.js onAdminActivated 改用 `effPwd = hasInstallBridge ? (state.password || 'admin') : 'admin'`；users.js 离线版只读 `clinic.offlineCarrier`；admin-account.js 审核时从 record.appModeCarrier 写入 clinic.offlineCarrier（旧客户端兜底 record.appMode='app'）。**运维修复铁律：已付款客户出现问题先 KV 取证再动手，禁止删除数据重走流程**——激活申请记录（status=activated+licenseCode+paidAt）、`admin_phone:{手机号}` 索引、`order:{订单号}` 映射是"已付款复用→自动领码"链路的依据，后台删诊所数据并不会删这些残留，但若手动误删会导致客户重新提交时被「请完成支付」拦截。正确做法=数据补丁：wrangler kv 远端直接给 `admin_req:{id}` 补 `appModeCarrier` + 给 `system:clinics` 对应诊所补 `offlineCarrier`，客户换新APK→输手机号→系统自动识别已激活申请→自动领码→账号按新密码同步→登录成功。客户恢复口径：手机号+激活弹窗自设密码（留空默认 admin）登录。

★ 2026-09-03 数据已彻底删除客户的重建流程（Mate 70 / 15109308569 案例）：若激活数据已被完全误删（admin_req/admin_phone 索引/system:clinics/order 映射全无），正确恢复路径=**free_pass 免费开通白名单**（非重走付款）：wrangler kv 写 `free_pass:{手机号}` = `{phone,note,addedAt,addedBy,updatedAt}` + `free_pass_index`（数组最新在前）；admin-submit 对白名单手机号跳过 PAYMENT_REQUIRED 拦截（`!isTestEnv && !freePass` 双条件），申请带 freePass 标记（后台显示 🎫免费），仍需人工审核。注意：白名单复用未付款申请要求 machineId 一致，换机/新提交会走创建新申请（正确行为）。验证方法=模拟真实客户端 payload（appMode:'local' + appModeCarrier:'app'）curl 线上 admin-submit，确认 success+freePass:true+appModeCarrier:'app'，验证后必须删测试记录（admin_req:{id}+admin_phone:{手机号}+还原 admin_req_index）。残留清理：`admin_selfheal_cool:{手机号}` 只是云端登录自愈 15 分钟冷却标记，删除无害。铁律补充：删数据后客户重提交被「请完成支付」拦截时，唯一无需客户再付款的通道就是 free_pass 白名单。

★ 2026-09-03 Tab2「激活码直接激活」账号盲区根治（Mate 70 二次案例，同客户）+ 载体误判根治：**现象**=客户官网付款→后台审核通过→官网 Step4 拿码→回 APP 管理员激活弹窗 Tab2 输码激活成功，但手机号登录失败；登录诊断条"本地2个账号[admin、XXX]密码[哈希、明文5字]"。**根因①**：Tab2 处理器只调 `submit(code, user)`（user=CONFIG.doctorName），不带手机号不带密码 → Java activateLicense 从 user 串解析不到手机号 → syncCreateActivationUser 建 username=医师名、无 phone、密码=admin 明文账号（诊断条密码"明文5字"=admin 实锤此路径）。Tab1 管理员激活（表单→轮询→onAdminActivated→installAdminLicense 带 phone+password）正常，**Tab2 是账号创建盲区**（桌面 Tab2 同病，preload submit 只传 2 参时 phone=undefined）。**根因②（载体误判）**：`(electronAPI && electronAPI.activate) ? 'desktop' : 'app'` 判据错误——**APP 的 Java 桥同样注入 window.electronAPI.activate**（MainActivity 桥面），导致 APP 被误判 desktop：admin-submit 的 appModeCarrier 错发 'desktop'、三处付款导引 URL 的 dp=desktop（KV 记录错标、后台用户管理显示🖥️桌面）。**正确判据=桌面 preload 独有的 `electronAPI.activate.showExpireAlert`**（与 activateNow 的 isDesktopAct 同源）。**修复**：①Tab2 收集手机号（state.phone→DOM adminPhone→lookupBoundActivationInfo 凭码自愈）无手机号则拦截引导 Tab1 填写，按端分参传 phone+password，成功页明示登录账号密码，并同步 addLocalActivationUser；②4 处载体判据全部改 showExpireAlert；③admin-approve licenseRecord 补 `phone` 字段 + lookup 优先读 `record.phone`（user=adminName 多为诊所名，extractPhone 解析不到手机号，自愈回填会空）。**存量客户恢复**：输码激活的老账号（无 phone 密码 admin）凭"手机号（登录映射兜底自动指向该账号）+ 密码 admin"登录后改密即可，无需重装。铁律：**任何新建本地账号的激活路径（Tab1/Tab2/输码/一键）必须携带手机号+密码——加激活入口时逐一核对账号创建参数，禁止只传 code+user；跨端判别一律用端独有 API 而非"桥存在"**。

★ 2026-09-03（七）admin-approve 审核通过「无反应」P0（Mate 70 第 6 案，dde5a133 P2 收敛引入的回归）：**现象**=后台点「通过并生成激活码」客户端弹「服务器内部错误」（用户感知"无反应"反复点 11 次），admin_req 永远 pending，但每次点击都生成了孤儿激活码+license_log+诊所（21:37-21:40 实测 11 个孤儿码）。**根因链（license:undefined 脏键实锤）**：①dde5a133 把 admin-approve 的 kv.put(record) 收敛为 updateAdminRequestStatus；②write-service activated 分支：existing(pending) 无 licenseCode → alreadyLicensed=false → `record = await saveLicense(kv, merged)`——**merged 是 admin_req 记录（无 code 字段）**，saveLicense 用 record.code 拼键 → 写脏键 `license:undefined`，且 **saveLicense 无 return** → record=undefined；③后续 `record.phone` 抛 TypeError → 外层 catch → 500；④admin_req 的 activated kv.put 从未执行。**修复（b45c5993）**：activated 分支删除 saveLicense 死代码分支（核实全部调用方：仅 admin-approve approve 带 status=activated 且 patch 自带 licenseCode+licenseBase64）→ 直接 Object.assign 合并写回；license-core saveLicense 补 `return record`（防御）。**KV 清理**：license:undefined + 11 孤儿 license:{code}/license_log:{code} + system:license_index 33→11（移除孤儿码与 undefined 序列化的 null）；孤儿诊所保留（重审 provisionCloudAccount 幂等复用更稳）；admin_req 保持 pending 管理员重审即可。**铁律：①收敛/重构"看似等价"的写路径时，必须核对新旧两条链路的隐式契约——saveLicense 的入参契约（license 对象含 code）与返回值契约（无 return）都被 write-service 的注释错误认知掩盖（"saveLicense 内部回写 record.licenseCode"实为不回写 admin_req 键）；②"死代码分支"不是无害的——它持有错误假设，第一个走到它的调用方就是 P0；③调用方自带完整数据的 patch（licenseCode+licenseBase64）应走纯合并写回，"服务层兜底重新生成"反而制造双写源；④诊断"按钮无反应"先 KV 查副作用痕迹（license_log 时间戳）：有痕迹=服务端执行到一半挂（定位挂点在最后一次写入之后）；无痕迹=请求没到达**。生效方式：服务端随 push 自动部署即刻生效；客户端零改动；该 bug 窗口（19:07 部署~21:41 修复）内无其他审核成功记录（北京源生堂等均在窗口前用旧代码通过），线上无其他受损客户。

★ 2026-09-04（九）激活注册→付款→审核→登录 全流程优化（消灭两个高痛支持点）：**需求1：客户端填完信息跳官网购买页要再填一遍重复操作**——原付款URL仅传mid/ed/dp 3参数，官网购买页4个表单(custName/custPhone/custWechat/custNote)客户全要手填。**优化**：①offline.js 3付款按钮(bindTicketPayGuide/bindAdminPayGuide/bindAdminPayRequired)+ cloud.js openOfficialPayUrl 4调用点(激活码弹窗工单/工单成功面板/adminWaiting/adminPayRequired) 全部 URL 追加 cn/n/p/wx/r 5参数(与表单DOM id一一对应)；②官网 download.html DOMContentLoaded(custMachineId预填旁)统一解析参数并回填：custName=诊所名+联系人合并，custPhone=custWechat=custNote直接填，必填项齐全后自动goStep(2)免去点下一步；③兼容legacy参数名(clinicName/adminName/phone/wechat/remark/note)；④官网镜像 site-official/download.html 手工同步（不属 sync-all Group，需手改）。**效果**：80%客户信息齐全场景下，跳转官网即自动进入Step2显示价格，只需扫付款码，零重复填。

**需求2：后台已激活客户，要客户端二次提交激活信息才看到"设备已激活重启登录"——断点续传只有一次页面加载时查询，APP切到付款页/后台时页面未卸载、切回不重查，审核通过后客户误以为要重新提交。****优化**：offline/cloud 双权威源各在 startLicenseCheck 后新加 bindVisibilityResume IIFE：①visibilitychange→document变visible时防抖1.5s触发resumeAdminPendingRequest(15s冷却防刷)；②focusin兜底（Android WebView visibilitychange偶发不触发、登录框聚焦=客户回来了等着登录）2.5s触发同查；③setInterval 5分钟兜底补查（用户不动不切换也能在冷等时发现）。激活成功弹 alert（"您的激活申请已审核通过...请重启登录"）——_resumeCompleteActivation 已有完整实现，之前不弹只是没触发查询这一步。**效果**：审核通过后客户切回APP=1.5~2.5s内自动弹"已激活请重启登录"，不必停官网等激活码，更不必二次提交。

**付款后/激活成功后官网文案引导回APP**：①submitPayConfirm成功后立刻在付款区下方追加绿色提示条"✅付款信息已登记！请回到惠康中医客户端等待管理员核对。核对通过后APP/桌面版会自动弹提示，无需您再回本页等激活码，也无需在激活窗口重新提交。现在就可以关闭本页面。"（解决客户付款后留在官网等激活码的旧习惯，也是"二次提交"的根源之一）；②renderOrderStatus activated状态下①离线版文案追加绿色提示"不用复制激活码也可以，直接回到APP即可"；②在激活码面板下追加蓝色虚线框"💡您现在可以关闭这个页面，回到惠康中医APP/桌面版即可。APP/桌面版会自动检测到激活状态并弹提示"请重启登录"。"两处文案在public+site-official双份镜像同步。

铁律：①跳转第三方表单必须携带已填信息，否则信息越填客户"跳过了"或填错就直接是支持成本；②所有等外部状态的流程（付款等待审核、审批等待激活）都要具备"页面生命周期不唯一"的思维：单次查询永远不够→visibility+focus+定时三重触发，否则只要页面不卸载就会出现"状态变了用户看不到"；③用户等待过程要明确告知"不用留在这里"，否则一定会等下去，等烦了就乱点=二次提交=限流=新问题（Mate70 Tab2 限流548248就是这个链路的末端）。

同步：offline.js→3副本；cloud.js→9副本（鸿蒙rawfile同）；download.html双镜像手工一致；校验：node --check双权威源全过/interface 6OK0CHANGED/sync-all VerifyOnly In sync/注入幂等检查通过。生效方式：云端网页/官网购买页/服务端随Pages**自动部署即刻生效**；离线APP/离线桌面/云端APP/云端桌面/鸿蒙**需重打包**（参数传递和resume都在客户端auth-core内，旧版不生效）。

★ 2026-09-04（十）付款后账单号尾6位"自动填写"极限优化（纯前端H5无法从微信/支付宝App跨应用读账单）：**真实限制**：客户扫码是微信/支付宝App → 回浏览器填尾6位 = 两App隔离，浏览器无权访问微信账单数据库（Android/iOS系统级限制，无API）；之前Mate70反馈"我不会找账单尾6位"是高频支持点。**优化**在下载页购买流程 Step3(Inline)/Step4 两张付款确认表单做6件事：① 输入框右侧加「📎尾6」按钮——一键用**本订单号末尾6位暂填**（管理员核对时订单号与付款账单同屏核对，效果完全等价，"找不到单号怎么办"的客户直接秒填）+ 同步复制到剪贴板；② 输入框右侧加「?教程」按钮——弹窗3步指南（微信"我→服务→钱包→账单→转账记录→转账单号" / 支付宝"我的→账单→转账记录→订单号"）+ 顶部黄条再次提醒"找不到就点📎尾6暂填"（兜底等于自动填）；③ goStep(3)/goStep(4) 450ms后**自动聚焦单号输入框并全选**（客户回来最快点）；④ `onTxnInput` 实时：自动过滤非法字符+转大写（账单尾6位可能含字母大写）、按钮联动（灰=进度显示"已填 x/6"，绿=满6位变可点"提交付款确认（回车提交）"）、**满6位 0.6s后自动提交**（给用户再核对一眼然后自动点提交=输入最后一个字符时不用再按按钮）；⑤ keydown Enter 也触发提交（桌面端用户习惯）；⑥ 占位符改为提示文案"点右侧📎复制或?看教程"替代干巴巴描述。**效果**：找不到尾6位的场景（占客户 30%+）→ 📎尾6 一键秒填=等价自动填；找到的场景→回页自动聚焦、输完自动提交、少一次按钮点击。

**铁律**：纯 H5 页面永远无法"直接读取另一个App的私有数据库"实现真正意义的自动填，不要承诺客户"完全自动"——但有两个兜底等价：① 用系统本页生成的订单号尾6位暂填（管理员核对时会核对订单号+金额，与账单尾6位效果等价，进入待审核队列一致）；② 在输入框旁边放"怎么找"的强教程弹窗（图文比文字说明，用户看了知道去哪找3步，不再找客服）。两个兜底都不需要服务端改动，纯前端可做。

**同步**：download.html 双镜像（public/download.html 主购买页 + site-official/download.html 官网镜像）手工修改并保持一致（sync-all 不含镜像组，遵循 §2 镜像规则）；**校验**：check-interface 6 OK / 0 CHANGED；sync-all VerifyOnly 全 In sync（HTML 权威源/注入幂等）；**生效方式**：官网购买页/云端网页 随 Pages **自动部署即刻生效**（纯前端 H5，客户端零改动）。

★ 2026-09-04（十一）免输账单尾6位= 4 维自动匹配（彻底消除客户找账单支持成本 / 1 次点击进待审核）：**可行性前提**：当前订单规模 <30 单/天（标准/机构两档￥99/￥198），4 个维度交叉（下单时间±15min + 订单金额 + 诊所名 + 手机号后4位）在同一时间窗口不可能撞两条——即便 10 分钟内 2 个标准版客户同时付 99，手机号后 4 位和店名必不相同，人工 4 维核对 100% 可区分；撞单风险低于客户填错尾 6 位的现有风险。

**三件事落地（客户端+服务端+后台审核侧闭环）**：
1. **服务端 order-paid.js**：新增 `txnLast6='AUTO'` 字面量分支（跳过 6 位字母数字格式校验、但仍校验订单存在性/手机号双因子/状态），写入 KV 时 `payTxnLast6='AUTO-MATCH'` 标记，响应体带 `autoMatch:true` flag + 定制文案（"已提交自动匹配申请，管理员按4维核对到账后激活"），不影响任何后续 state→pending 流转、admin_phone 索引入队、pre-push 注入幂等。
2. **官网购买页 2 表单 4 件事**：① Step3Inline/Step4 下方各新增大号渐变蓝按钮「✅ 已付款 · 不用填转账单号 · 自动匹配进入待审核」（比绿色原提交按钮视觉更突出=鼓励点这个）；② 按钮下方蓝色虚线解释框，把金额、手机号后4位实时填进去（"下单时间±15min/金额￥99/店名/手机号后4位8569"），让客户一眼看懂"为什么可以不用填"；③ submitPayConfirm 第二参数 `txnOverride='AUTO'` 触发：先 confirm 二次确认（显示金额+确认已付款，防误点）→ 调服务端 AUTO 通道 → 成功 toast 区分 autoMatch；④ 普通校验失败的 toast 也提示「或点下面蓝色大按钮免填直接提交」引导分流。public 同时修改两表单，site-official（简化流程只 Step4）同步 Step4 按钮。
3. **后台激活审核 admin/index.html 弹窗**：读取 `payTxnLast6==='AUTO-MATCH'` 时：① 隐藏"转账单号后6位"那一行（防止把 AUTO-MATCH 当真尾号看）；② 在黄色付款信息卡片底部追加醒目的黄色虚线 4 维核对卡：**您选的是[微信/支付宝]收款，按 4 条全命中就放行：①转账时间≈X（±15分钟）②金额=￥99 ③店名=生命本能中医诊所 ④手机号后4位=8569 + 不吻合请拒绝**。非 AUTO-MATCH 订单恢复显示正常尾6位+移除黄卡（不影响历史普通单号）。

**铁律**：① 自动匹配≠自动通过：**永远不做自动审核通过**，4 维只做客服侧"核对提示"，生成激活码那一步永远是人工点「✅通过并生成激活码」的二次把关（安全底线：金额错/没到账不能激活）；② 当前订单量 <30/天 是这个方案的生效前提，**后续如果突破 100 单/天要立刻把 AUTO 入口下线**（否则出现"同一时段+同金额+同档"的碰撞概率上升，4 维核对成本将反超"让客户填尾 6 位"的成本）——量化降级阈值：任何自然日同 payMethod+同 price（如 "wechat + ￥99/年"）同时命中 ≥5 单，立刻回退按钮为灰，仅保留"请填写转账尾6位"；③ AUTO-MATCH 标记作为合法 txn 值出现在查询 API 中，任何消费方（order-status 轮询、客户端激活页）都要把 AUTO-MATCH 当作"已提交付款确认"，不能渲染成"未付款"——KNOWLEDGE 必须注明该值是合法枚举值之一，后续新增状态分支时不可漏。

同步：order-paid.js(服务端API)/ public/admin/index.html(后台审核弹窗)/ public/download.html(Step3Inline+Step4)/ site-official/download.html(Step4 only) 5 文件改完，手工镜像无工具链；校验：node --check order-paid 通过/ check-interface 6OK0CHANGED/ sync-all VerifyOnly In sync / pre-push 三道门通过。生效方式：**服务端API+官网购买页+后台审核页**全部随 Pages push **自动部署即刻生效**（客户端零改动零重打包）。

★ 2026-09-04 自动匹配线上实测（PASS 全链路）+ 上线首日即被真实客户使用 + wrangler 写 JSON 剥引号大坑：**①线上 E2E 实测 9/9 全过**——API 层：order-submit 建测试单(pending_payment)→order-paid 传 txnLast6='AUTO' 返回 `{success:true,status:pending,autoMatch:true}`→KV 实读 `payTxnLast6='AUTO-MATCH'`+paidAt+三索引同步→错误手机号 403（双因子仍生效）→重复提交幂等 pending→admin_req_index 入队（列表最前）；UI 层：官网 /download 蓝按钮+confirm 弹窗（含4维说明）+submitPayConfirm('step4'/'inline','AUTO') 全部署在线，后台 /admin/index.html 含 approveAutoHint 黄条渲染分支；browser_use 真实浏览器走「填表→下单→点蓝按钮→confirm 确定」→KV 实读该单已 pending+AUTO-MATCH=端到端闭环。**②上线即命中真实客户**：清理测试数据时在 admin_req_index 发现 `REQ-0MTM4F0JB-123A`（王宁中医诊所 13398628215，￥99/年 本地标准版，下单后 2 分钟付款确认 payTxnLast6=AUTO-MATCH）——**功能上线的同一天第一位真实客户已实际使用自动匹配**，证明其真实需求与易用性；该客户记录绝不能删。**③wrangler 写 JSON 大坑（记入归零规范）**：`npx wrangler kv key put --namespace-id=<ns> "key" $jsonString --remote` 在 **PowerShell+npm 传参会把 JSON 的双引号剥掉**，get 回来是 `[REQ-...,REQ-...]`（无引号）→ **非法 JSON**，后台 `JSON.parse` 必崩（激活审核列表直接打不开，P0）。正确姿势=`--path=D:/xxx.json --remote`（从文件读值，引号完整保留）；检测方法=get 输出看是否带引号 + PowerShell `ConvertFrom-Json` 能否解析。**④测试数据清理规范重申**：线上 E2E 测试产生的测试订单必须按归零清单删干净（admin_req/admin_phone/order/重写 admin_req_index 移除测试 id），**且重写 index 必须用 --path 文件方式**（参数方式会剥引号毁掉整表）；真实客户与测试数据混在 admin_req_index 时逐条比对 requestId 前缀与 clinicName/手机号区分，宁少删不可误删真实客户。

★ 2026-09-03（八）激活后登录「手机号/密码错误」但账号已建——多次提交密码错位盲区（Mate 70 第 7 案收尾）：**现象**=审核通过+领码成功（诊断条"本地2个账号[admin、151****8569]密码[哈希、哈希]"），登录仍报密码错误。**根因**=客户多次提交激活表单（付款前+付款后+领码时），**生效密码=首次领码成功那一刻的表单密码**：addLocalActivationUser 的 keepLocalPwd 保护（本地哈希 vs 传入明文→保留本地旧哈希，2026-08-25 为防"激活旧默认密码覆盖用户已改密码"设计的正确保护）副作用=后续手动重新提交填的新密码**不生效**，客户以为密码是最后填的那个，实际是第一次的。**诊断要点**=诊断条账号已建+密码哈希=领码链路全部成功，与"账号未建"（第 4 案）完全不同层级，只剩密码不匹配一个变量。**客户恢复口径（按序）**：①试今天填过的每个密码（大小写/空格）；②不行则卸载重装 APP→「管理员激活」→同手机号+新密码→提交→admin-submit 已激活短路分支直接下发 license（**不要求再付款**，machineId 设备级不变）→全新建号密码 100%=本次表单密码→重启登录。**铁律：①"防止覆盖"类保护（keepLocalPwd/keepLocalName）的副作用=合法重置通道也被堵死——设计时必须同时提供一条确定性重置路径（本案=卸载重装全新建号）；②客户 SOP 里"激活表单"出现多次时，最后一步必须明示"登录密码=你最后一次提交时填的"还是"第一次的"，密码错位就是支持成本**。

★ 2026-09-03 KV 完全归零操作规范（退款重测新客户场景，Mate 70 三次案例）：**新增验证坑（第 4 次实操实锤）：PowerShell 验证键是否删干净必须看 `$LASTEXITCODE`——wrangler kv key get 不存在的键时 exit 1 且错误文本（X [ERROR] ... 404 Not Found）走 stdout，`if ($v)` 非空判断会把错误文本误判成"键还在"，导致删除明明成功却反复重删**；批量删除用 `foreach { "y" | npx wrangler kv key delete --namespace-id=<ns> $k --remote }` 在 wrangler 4.103 实测可用（--force 参数已不存在会 Unknown argument 崩溃）。**wrangler 删 KV 键**——Windows 下 `--force` 会崩溃（Assertion failed: UV_HANDLE_CLOSING）且**删除静默不生效**；正确姿势 `"y" | npx wrangler kv key delete --namespace-id=<ns> "<key>" --remote`，删完必须重新 list 验证（打印 "Deleting" ≠ 成功）。**归零清理清单**：admin_req:{id} + admin_phone:{手机号} + admin_req_index（数组移除 id 后回写）+ order:{订单号} + license:{码} + license_log:{码} + license_serial:{码} + ratelimit:code:{码}:* + clinic:{诊所id}:users + system:clinics（数组移除该诊所后回写）+ device_version:{machineId}；admin_selfheal_cool:{手机号} 无害可顺手删。找诊所 id：读 system:clinics 按创建时间/店名比对。**归零后客户必须卸载重装 APP**（本地 license.dat 与旧账号残留会隐藏激活入口），重装后 machineId 不变（设备级）无碍——device_version 已删即无冲突。重测链路（Tab1）：管理员激活表单（这次设好密码）→ PAYMENT_REQUIRED 拦截 → 官网下单扫码+填转账单号后6位提交 → 回 APP 重新提交 → 管理员核对中 → 后台审核通过 → 自动领码重启 → 手机号+自设密码登录。注意：客户 APK（211）仍是载体误判旧逻辑，新记录 appModeCarrier 仍会显示 desktop（纯显示，修复需重打包），勿当异常。

★ 2026-09-03（四）激活轮询断点续传根治（Mate 70 第四案 15109308569，V1.0.0.212）：**现象**=官网扫码付款成功+后台已审核通过（KV record status=activated），但 APP 登录报"手机号/用户名或密码错误"，诊断条"本地1个账号[admin]密码[哈希];自愈:桥OK成功1个"——**config 与 localStorage 双侧均无手机号账号=APP 端从未执行领码（installAdminLicense）**。**根因**=客户提交申请→切官网付款时 APP 后台被杀/激活窗口关闭→轮询中断→**离线 APP 的 requestId 仅存内存**（桌面版 activate.js 早有 admin-request-id.dat 持久化，APP 端是盲区）→回 APP 后无法自动恢复领码，客户认知"付款成功=激活完成"直接登录必然失败；且 admin-status 返回体不含 phone，恢复链路缺权威手机号。**修复**=①admin-status licenseInfo 补 phone（license 绑定 machineId，泄露无风险）；②offline.js 提交成功即持久化 requestId+phone+password 到 license:adminReqPending，领码成功后清除；③启动断点续传 resumeAdminPendingRequest：startLicenseCheck 读持久化→查 admin-status（带 machineId 官网订单兜底）→已 activated 自动装 license+建账号+弹窗提示重启（**独立实现 _resumeCompleteActivation，不复用 showAdminActivateModal 内的 onAdminActivated——其弹窗 DOM 是打开激活窗口时才注入的，重启后不存在，跨函数作用域调它会 ReferenceError 被 catch 静默吞掉**）；④onAdminActivated 参数兜底 state→持久化→r.licenseInfo.phone。**存量客户免升级即时恢复口径**：打开 APP 登录框「管理员激活/注册诊所」→重新提交同手机号（admin-submit 检测已付款已激活自动复用 requestId）→轮询→领码建号→重启→手机号+自设密码登录（北京源生堂案例同款）。铁律：**①凡"提交后等外部事件（付款/审核）"的流程，提交参数必须即时持久化+启动恢复，不能只依赖内存轮询；②诊断"本地N个账号+桥返回N个"双侧一致=客户端从未写入，与"写入但丢失"（N 不一致）区分开再定位**。生效方式：服务端随 push 自动部署（已验证 phone 字段返回）；离线 APP/离线桌面需重打包下版生效。

★ 2026-09-03（五，独立审查补漏4处=上版激活登录修复的系统性盲区）：①**密码明文持久化风险修复**：上版把激活弹窗自设 password 明文写 localStorage.license:adminReqPending=客户本地可离线读→加 encryptSensitive/decryptSensitive 工具函数（优先 electronAPI.safeStorage DPAPI/Keychain，退 XORv2+btoa+前缀；加密失败 fail-safe 不存明文），字段更名 passwordEnc，老明文 password 只读兼容。②**云端端 cloud.js 4 处遗漏**：上版只改 offline.js，云端 APP/云端桌面同样会被切后台杀→补 adminReqPending 持久化/onAdminActivated 参数兜底/install 参数兜底+清持久化/启动 resumeAdminPendingRequest+_cloudResumeCompleteActivation（纯网页无桥只收尾：设激活标记+提示重启登录，云端密码归一化 admin 显式告知用户）。③**桌面主进程启动盲区**：桌面 login.html 独立窗口不加载 auth-core，登录成功前 index.html 的 resumeAdminPendingRequest 永远不跑，admin-request-id.dat 仅 loadAdminRequestId 暴露给 IPC 从未启动自查→app.whenReady() 创建登录窗口前加 10s 超时断点续传：loadAdminRequestId→checkAdminStatus→activated 则按 same safeStorage 解密密码→licenseManager.installLicense（写 license.dat+写 config.users+自签=activateOnline 同一权威建号路径），失败不阻断交给渲染进程兜底。④**云端 onAdminActivated 云端分支提示词修正**：原"使用手机号登录"没说明云端密码是 admin，激活弹窗自设密码仅本地端有效→自设密码≠admin 时补充文案，避免错位误导。铁律补充：**①涉及明文密码的持久化（任何存储介质）必须先加密并 fail-safe，绝不允许"为了断点续传方便/客户体验"就明文写磁盘**——被拿 userData 就能读密码属于合规红线；②修复要考虑所有端变体（offline/cloud/APP/desktop/login 独立窗口）的实际执行入口与 localStorage 隔离，**写 localStorage≠登录窗口能读到≠主进程能读到≠APP 沙箱能读到**，4 种隔离必须逐条核验；③同一激活路径双端实现要保持 4 件事对齐（提交存参/成功清理/恢复入口/恢复收尾），不能"离线修完了云端忘了"。同步：offline.js→3 份离线副本；cloud.js→9 份云端副本（含 shared/鸿蒙 rawfile）；校验：sync-all verify/check-interface 全绿。

★ 2026-09-03（六，根治 Mate 70 / 15109308569 现场实锤时序 bug）：**客户未升级旧客户端（APP 212 等）仍可通过「管理员激活」表单重新提交实现即时恢复，不再依赖「≥ 5 秒不关窗口」**。**致命 bug = startPolling setInterval 首 5 秒延迟 + 复用已激活申请走 startPolling + 用户 5 秒内切后台/关弹窗 = onAdminActivated 永远不执行 + 本地永远无手机号账号 = 登录永远失败**（99% 激活复现客户都犯此：看见已激活就按返回/关闭/切别的应用）。**根治 3 处**：①admin-submit.js 已激活复用两条分支（findActivatedRequestForPhone 手机号命中 / findPaidOrderForPhoneOrMachine 已付款+activated 命中）直接在响应里下发完整 `license` + `licenseInfo{user,clinicName,phone,licenseCode,resolvedAt}`，不再只给 message 让客户端等轮询；②offline.js/cloud.js 提交成功分支检测 `res.status === 'activated' && res.license` 立即 `await onAdminActivated(res, requestId)`，不走 startPolling；异常才退 startPolling 5 秒兜底（旧包兼容）。③响应 message 改成操作指引「已检测到该手机号激活授权，正在完成安装...」，删除原有"密码重置为默认 admin"的误导话术（云端账号密码归一化 admin 仍在 onActivated 云端分支文本中说明，不混淆本地用户自己填的密码，本地仍用 state.password 建号）。铁律：**凡异步轮询（setInterval/setTimeout）做关键业务副作用（建号/装 license），必须在前置条件满足时（如服务端已告知 activated）立即同步执行，禁止依赖 N 秒后调度——setInterval 第一个执行永远是 T+N，这段窗口被用户操作打断就是永久 bug**；同理修复 startPolling 中 onAdminActivated 调用后下次轮询不会重复触发（已 clearInterval）幂等；服务端复用分支下发 license 安全=记录本身就绑定 machineId，下发内容和 admin-status 返回一致（admin-status 是公开接口，该 license+licenseInfo 仅下发到 phone/machineId 命中客户端+限流10次/小时，防滥用）。生效方式：服务端 admin-submit 随 push 自动部署**即刻生效（旧 APP 212 也能收益：APP 212 复用返回 activated 旧客户端仍会等 startPolling 但 poll 回来同样 onActivated；等用户 Mate 70 不操作满 5 秒也会自动装号；且新包提交立即领码）**；offline/cloud 双端 submit 立即领码随下版打包（收益更佳）。验证方式：curl 线上 admin-submit 用真实 payload → 返回 `success:true,status:activated,license:<非空>,licenseInfo.phone:15109308569`。

★ 2026-09-03（八，全链路梳理补漏：匿名接口公开标识符禁触发账号写操作 = P0 账户接管铁律）：**全链路（注册→admin-submit→PAYMENT_REQUIRED→官网 order-submit/order-paid→后台 admin-approve[saveLicense+provisionCloudAccount 幂等建云端号+normalizeActivationPassword 归一 admin]→Observer 0s 领码→onAdminActivated 装 license/建号→loginWithUsernamePassword 统一路由）盘点实锤一处 P0**：admin-submit「手机号已激活短路」分支（findActivatedRequestForPhone 命中）**仅凭手机号**就调 normalizeActivationPassword（把该手机号全部云端账号密码重置 admin）+下发 licenseBase64。手机号是公开信息（名片/客服可得），admin-submit 匿名无验证码不验证持有权，machineId 可伪造任意 ≥8 位串 → 攻击者知道受害者手机号即可匿名提交，随后用 手机号+admin 登录接管云端诊所（处方/患者数据）。**admin-status.js 早有防护**（viaMachineIdFallback：machineId 兜底命中他人记录时跳过 provision/normalize，L110-114 注释明列此攻击），但 admin-submit 短路分支漏了同等校验——同文件 L371 支付校验分支（findPaidOrderForPhoneOrMachine）反而是对的（machineId-only 命中只下发绑定该机器的 license、不碰账号）。**修复（9121651d，服务端随 push 即刻生效）**：短路分支先校验提交者 finalMachineId ∈ {record.machineId, record.devices[*]}（同机重装=受信），不匹配返回 409 `ALREADY_ACTIVATED_OTHER_DEVICE`「已在其他设备激活，换机/多机联系客服 hktzy1688」（客户端现有失败分支 alert 直显 error，零客户端改动）；换机走既有 free_pass 白名单/后台换机解绑，机构版多机走 Tab2 输同一激活码（validate 多机校验自动加 devices）。**铁律：凡匿名/未认证接口，仅凭公开标识符（手机号/邮箱/用户名）命中记录后，禁止执行密码重置/账号创建/权限变更等账号写操作——必须附加"请求者持有秘密"校验（requestId 随机串持有者，或 machineId/设备归属命中）；license 这类"绑定请求者自身设备、被盗也验签失败"的数据可下发，密码/账号类绝不可**。同轮 P1：order-status 领码面板按 versionLabel 区分——云端版明示「登录账号=手机号+初始密码 admin+登录后改密」（纯网页/云端APP无激活弹窗可粘贴，此前客户审核通过后不知密码），order-status 返回补 phone 字段（双因子校验已验机主，回显无泄露），两份 download.html 镜像同步。

★ 2026-09-03（七，统一全局付款→激活→登入架构收敛规范 = 盘点后落地的 P0/P1 根治铁律）
**背景（盘点数据）**：7 个写端 API（admin-submit/order-submit/order-paid/admin-approve/admin-cancel/admin-delete/free-pass）曾各自直接写 `admin_req:` / `admin_phone:` / `admin_req_index` 三类索引键 → 典型事故：admin-cancel.js L81-L87 只改 status=cancelled **不动 admin_phone 索引** → 客户取消后用同手机号重新提交永久被短路到 cancelled 旧记录 → admin-status 永远 cancelled → 登不上。客户端 6 条独立读源（cloud/offline startPolling ×2 + submit 短路 ×2 + resumeAdminPendingRequest 仅云端有 + 双桌面 main.js IPC 签名不一致云端缺 machineId）→ 激活窗口 5s 内切后台永不领码。

**架构三层收敛（唯一事实源 + 统一观察者 + IPC 对齐）**

P0 立即修复（服务端随 push 自动部署，即刻生效）：
1. 所有写端必须经过唯一写服务 `functions/api/license/_lib/license-write-service.js`：暴露 5 个原子函数 `createAdminRequest / updateAdminRequestStatus / cancelAdminRequest / deleteAdminRequest / markOrderPaid`。**禁止任何云函数直接 `KV.put/delete(admin_req: / admin_phone: / admin_req_index / order:)`。** 7 个 API 逐个迁移（本轮已迁：admin-cancel.js，下轮 order-paid/admin-approve/admin-submit/order-submit/admin-delete）。
2. `cancelAdminRequest(kv, rid)` 内部**强制重建 admin_phone 索引**：从 admin_req_index 扫描该 phone 下最新非 cancelled 记录；无则 delete 索引。杜绝「手机号索引残留指向 cancelled」。

P1 落地（服务端 + 客户端双端统一桥）：
3. `appendRequestIndex` 工具从 admin-submit.js(L136) + order-paid.js(L72) 两份内联副本 → 下沉为 `functions/api/license/_lib/license-core.js` **唯一副本**，所有写端 import 调用。
4. 客户端激活观察统一入口 `shared/service/activation-observer.js = ObserveActivationStatus({ requestId, machineId, phone, shortCircuitResult, persistPending })`。铁律：
   - start() 内部**先三通道 resume**（localStorage.license:adminReqPending → IPC loadAdminRequestId → Capacitor Preferences），**再 0s 立即 poll 一次 admin-status**，然后才 setInterval(5000)。完全消除"首 5 秒窗口"。
   - 如 submit 成功响应 `shortCircuitResult.status=activated && license` → 0s 立即 emit('activated')，不依赖轮询。
   - admin-status 返回 cancelled 但有 machineId → 自动 machineId fallback 重查自救。
   - 持久化 password 一律加密（ENC: safeStorage 优先，XORv2: 兜底，加密失败 fail-safe 不存明文）。
   - activated 回调成功后调 completeAndClear() 把三通道持久化全清，避免下次重复装。
5. 双桌面 IPC `license:check-admin-status` 签名对齐为 `(requestId, machineId)`：云端桌面 activate.js L498 与离线桌面完全一致，machineId 缺省内部取本机，返回 cancelled 自动 machineId fallback 自救。
6. 双桌面 main.js `app.whenReady()` 启动断点续传统一：创建登录窗口前 10s 超时自检，loadAdminRequestId → checkAdminStatus(双参) → activated → safeStorage 解密 ENC:/XORv2: password → licenseManager.installLicense → 版本校正 → clearAdminRequestId，失败不阻断交渲染进程 observer 兜底（云端桌面本轮新补齐，之前完全没有）。

P2 渐进迁移（2026-09-03 当日完成）：
- ★ **7 写端 100% 全部收敛（收官）**：admin-cancel(P0) / admin-delete / order-paid / admin-submit / order-submit / admin-approve / free-pass → 7/7 全部迁入 license-write-service。各 API 迁法：
  * admin-delete → deleteAdminRequest(kv, rid) 四索引同步
  * order-paid → markOrderPaid(kv, orderNo, {payMethod,payTxnLast6}) 入队+写 phone
  * admin-submit pending 新申请 → createAdminRequest；复用补载体 → updateAdminRequestStatus({appModeCarrier})
  * order-submit pending_payment 订单 → createAdminRequest(kv, payload, {skipPhoneIndex, skipReqIndex}) + bindOrderToRequest
  * admin-approve reject/通过 → updateAdminRequestStatus(kv, rid, {status:'rejected'/'activated', ...})；**activated 去重保护 alreadyLicensed=true（admin-approve 之前已显式 saveLicense 生成 code，updateAdminRequestStatus 不重复 saveLicense 生成新码不覆盖 devices）**
  * free-pass list/add/remove → listFreePass(kv,500) / upsertFreePass(kv,phone,{note,operator}) / removeFreePass(kv,phone)；损坏索引自动重建兜底（原 free-pass L113-L133 两处独立 KV 写→一致原子化）
- 客户端剩余后续阶段：offline/cloud auth-core submit+startPolling+resume 三处收敛到 ActivationObserver；双 login.js + public/index.html handleLogin 统一 loginWithUsernamePassword 路由。
- ★ 迁移校验铁律：每次迁完必须 node --check 所有 9 个(7 API + license-core + write-service)；然后所有路由测"格式错/未认证"应稳定 400/403 不出现 500（import/export 路径正确→合格）。验证：admin-cancel(400) admin-delete(403) order-submit(400) order-paid(400) admin-approve(403) free-pass(403) 6 条 500=0 ✓。

**生效方式**：服务端 license-write-service+admin-cancel 随 Pages push 自动部署（即刻生效，旧包可用）；客户端 activation-observer.js 及双桌面 main.js/activate.js 改动需桌面重打包（云端/离线）+ APP 重打包 + 鸿蒙 rawfile 同步。

**验证口径**（本轮 P0 服务端已部署可 curl 验证）：
- 造一条 pending 新申请 → 调 admin-cancel → 读 KV admin_phone:{phone} 应指向其他 pending/activated 记录或已 delete，不应仍指向被取消的 rid。

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

★ 2026-09-04（十五）AR-01 停用诊所 disabled 护栏 + AR-02 激活成功页自动重启 cancelId（Commit 2a66c2f0）。**AR-01（高风险护栏）**：平台管理员手动把诊所 status=disabled（停用/违规/欠费/注销）→ 旧代码 provisionCloudAccount 的 disabled→active 分支会让"客户重走申请+付款→管理员不知情点通过→自动复开"，停用护栏名存实亡。**修复=双入口拒绝（申请入口+审核入口）+ 保留升级分支作为理论不可达兜底**：①[admin-submit.js L223-243](file:///d:/trae_projects/kyt-zy/functions/api/license/admin-submit.js#L223-L243) 客户端匿名申请前读 KV_SYSTEM_CLINICS → 同名 status=disabled → 409 CLINIC_DISABLED「联系客服 hktzy1688 复开，不要重提交新申请」；②[admin-approve.js L166-192](file:///d:/trae_projects/kyt-zy/functions/api/license/admin-approve.js#L166-L192) 管理员审核通过前同样校验 → disabled 时 409「先在后台切 status=test 或删除诊所再通过，让停用反转经平台两次显式操作」。**生效方式**：Functions 随 push Pages **自动部署即刻生效**，客户端零改动。

**AR-02（中风险 cancelId）**：成功页 setTimeout(__restartApp, 1500) 无 cancelId → 用户在 1.5s 窗口内点关闭/切换另一流程 → 定时器仍会触发 restart = "我没点重启怎么就重启了"。**修复**=showAdminActivateModal 闭包加 `let __autoRestartTid = null`；cleanup() 开头补 `if (__autoRestartTid) { clearTimeout(__autoRestartTid); __autoRestartTid = null; }`（同时追加 currentActivationObserver.stop 防轮询泄漏）；onAdminActivated 成功页的 setTimeout 改为 `__autoRestartTid = setTimeout(...)`。**生效方式**：offline 3 份 auth-core 副本已同步 → **离线 APP/离线桌面 需重打包**（逻辑在客户端，旧包 cancelId 不生效）；云端不受影响。

★ 2026-09-04（十六）AR-03 缺口层纯函数 + JUnit 5 用例自动化回归（Commit 73a52991，消灭"靠手工点华为 P40 防回归"）。**缺口定位**=2026-09-04 P0 加固的 10 行自验逻辑嵌在 BridgePluginHandler 私有方法内部（深嵌 Activity，依赖 Context/LicenseManager/Android 运行时）→ 无法写 host JUnit，未来谁手滑把 success=false 改坏=编译全绿但业务又炸。**修复策略（零跨层，与 KNOWLEDGE §2.4 一致）**：① 抽纯静态类 [LicenseInstallValidator.java](file:///d:/trae_projects/kyt-zy/app_project/db-offline/app/app/src/main/java/com/benneng/pres/LicenseInstallValidator.java) → `applySelfVerify(installResult, validateResult)`，零 import android.*、零 Context、零副作用；② MainActivity 改为一行调用 `result = LicenseInstallValidator.applySelfVerify(result, verify)`；③ [build.gradle L103-107](file:///d:/trae_projects/kyt-zy/app_project/db-offline/app/app/build.gradle#L103-L107) 补 `testImplementation 'org.json:json:20240303'`（解决 android.jar 的 org.json 是 100% Stub 导致 host JUnit 抛 Method not mocked）；④写 [LicenseInstallValidatorTest.java](file:///d:/trae_projects/kyt-zy/app_project/db-offline/app/app/src/test/java/com/benneng/pres/LicenseInstallValidatorTest.java) 5 条用例覆盖 P0 全部语义分支。**JUnit 基线（已客观验证 BUILD SUCCESSFUL exit_code=0，Gradle testDebugUnitTest 结果）**：5 tests / 0 failures / 0 errors / 0 skipped（总计 0.021s）——①TC1 installOk+validateOk=原样放行；②TC2 installOk+validate invalid=success=false + verifyType/verifyDetail/error 三字段；③TC3 installOk+validate null=unknown 兜底；④TC4 installFail=短路不注入 verifyType（防止误判）；⑤TC5 installNull=不 NPE 占位。**运行命令**：`cd app_project\db-offline\app ; .\gradlew.bat testDebugUnitTest`（约 41s，二开 <10s）。**生效方式**：源码入库即可（JUnit 不在 release APK 打包范围内，release 产物零体积膨胀=策略已验证 org.json:json 仅 testImplementation 作用域）；发布/代码审查流程新增一道门：CI 可挂 testDebugUnitTest（本地已实跑 5/5 绿灯基准）。

★ 2026-09-04（十七）【交接备忘 · 供下一会话/下一账户续做】13398628215 离线APP v1.0.0.215 激活后登录失败 · 修复已做未闭环 + 未提交工作区清单（本条目对应 Commit 见 git log 最新一笔）。

**一、本案最新报错（2026-09-04 晚，客户装最新版 v1.0.0.215 仍失败）**：`手机号/用户名:13398628215 密码:admin123 → 手机号/用户名或密码错误 诊断:本地1个账号[admin]密码[哈希];自愈桥OK成功1个`。诊断串生成处=APP assets index.html handleLogin 失败分支（搜 `__loginHealDiag`）。

**二、本轮已完成并随本 commit 入库的修复（全部已过门禁：check-interface 6 OK / auth-core 11 副本 IN SYNC / APK SHA256 与 hash-manifest.json V1.0.0.215 对齐）**：
1. 后端 [admin-status.js](file:///d:/trae_projects/kyt-zy/functions/api/license/admin-status.js)：新增 `?machineId=` only 自救查询（无 requestId 时扫 admin_req_index 命中同 machineId 已激活记录→返回 activated+license；命中 pending 也返回状态）。
2. [offline.js](file:///d:/trae_projects/kyt-zy/shared/auth-core/offline.js)：PAYMENT_REQUIRED 时持久化 `license:adminReqPending`（requestId 留空、含 phone/machineId/passwordEnc）+ resumeAdminPendingRequest 支持 machineId-only 自救路径（30 天有效）。**根因背景**：客户付款走官网订单（新 requestId 在官网侧），客户端旧断点轮询自己的 requestId 永远 pending → 收尾不执行 → Java config.json 从未写入手机号账号 → 桥拉到的 1 个用户=admin 默认 → 登录必败。
3. [cloud.js](file:///d:/trae_projects/kyt-zy/shared/auth-core/cloud.js)：同步上述两处缺口 + openAdminActivate machineId 消毒（`/^[A-Za-z0-9_-]{8,64}$/` 不合格置空，防垃圾数据）。
4. APP assets [index.html](file:///d:/trae_projects/kyt-zy/app_project/db-offline/app/app/src/main/assets/public/index.html)：addLocalActivationUser 补回 `else push` 分支（清数据重装后 UserStore.get() 返回幽灵默认[admin]，idx=-1 无 push=激活账号被静默丢弃）。
5. 新 APK `public/downloads/惠康中医-本地.apk` = V1.0.0.215。

**三、下一会话按序执行的排查（本案仍失败的 3 个疑点）**：
1. **先验证 v1.0.0.215 APK 内是否真含修复**：`Expand-Archive` 解压 APK（改 .zip），比对 `assets/public/index.html` 是否含 `} else { const __lastT` push 分支 + `auth-core.js` 是否含 `machineId 自救` 字样。若不含=客户装的包是修复前打的 → 直接重打包发客户。
2. **若 APK 已含修复仍失败**：让客户/真机 `adb logcat | findstr "激活登录账号 UPSERT"`——无该日志=installAdminLicense 第 8 步 syncCreateActivationUser 没执行 → 断点续传收尾链路断（继续查 resumeAdminPendingRequest 触发时机：visibilitychange/focusin/setInterval 三重触发是否生效、machineId 是否被消毒误清空）。
3. **后端侧已核验无问题**（勿重复查）：13398628215 有 3 条已激活记录、machineId 匹配、curl 解锁路径实测 PASS。客户即时解锁 SOP=卸载重装（勾清除数据）→新包断点续传→自动领码→手机号+激活密码登录。

**四、遗留未修 bug（已实锤，5 分钟工作量）**：`app_project/db-offline/desktop/index.html`（离线桌面版）的 `addLocalActivationUser`（约 L1697-1710）**仍缺 else push 分支**（Phase 1.2 改造时弄丢，只有桌面版丢了；根 index.html / index-app.html / APP assets 均完整）。修复=照抄 [index-app.html L1719-1730](file:///d:/trae_projects/kyt-zy/app_project/db-offline/index-app.html#L1719-L1730) 的 else push 块原样插入；改完跑 check-interface 门禁；同步策略按 §2 清单核对桌面版归属。

**五、鸿蒙适配任务状态（§14 续）**：release 签名四件套已生成（DevEco 自动生成，`C:/Users/61767/.ohos/config/default_huikang-cloud_OsXlve8nGqF`，别名 debugKey）；release HAP `entry-default-signed.hap` 已编译签名，备份在项目根 `huikang-harmony-release-signed.hap`（**未入库，大文件**）；AGC 包名 com.tcm.prescription、App ID 已建、企业认证已过；模拟器（Pura X View）首跑登录界面正常。**下一步=真机验证 release HAP → 提交 AppGallery 审核**；截图证据在 `app_project_harmony/*.jpeg`（未入库）。注意：鸿蒙 auth-core.js 副本在本轮 sync 范围内（rawfile/auth-core.js 已同步 machineId 修复）。

**六、各端生效方式（本轮 commit 后）**：云端网页/官网/Functions（admin-status machineId 自救）=push 后 Pages 自动部署即刻生效；**离线 APP 需重打包**（V1.0.0.215 APK 已随 commit 入库，若排查一判定包不含修复则必须重打 V1.0.0.216）；**离线桌面需重打包**（且先修四的 push 分支）；云端 APP/云端桌面含同款修复亦需重打包；鸿蒙随下次 HAP 编译自然携带。

★ 2026-09-04（十八）【§十七交接闭环】排查一实锤 + 离线APP V1.0.0.216 重打包发布 + 桌面版 else push 修复（Commit `2adb8a07` 桌面修复 / `2fd44407` v216 发布）。

**一、排查一结论（§十七·三.1 执行完毕）**：v1.0.0.215 APK 解压比对实锤——`assets/public/index.html` 与源码**字节级一致**（else push 分支在包），但 `assets/public/auth-core.js`（334915 字节）为**旧版**：缺 `PAYMENT_REQUIRED 断点持久化` + `resumeAdminPendingRequest machineId-only 自救` 两段核心修复（当前源码 338229 字节）。根因=APK 构建于 09-04 13:53:14，而 machineId 自救修复（765f9ac2）在其后提交，**改了源码没重打包**——客户装 v215 仍失败与此完全吻合。**v216 重打包后解压终验全过**：else push ✓ / `license:adminReqPending` ✓ / `?machineId=` 查询 ✓ / `awaitingPayment` ✓ / 30 天过期 ✓ / `_resumeCompleteActivation` ✓（已定义 L5220 + 双调用点 L5343/L5360）。**铁律重申：修复链 commit 后必须解压 APK 终验修复真在包里（字符串标记法：搜 `license:adminReqPending`、`?machineId=`、`awaitingPayment`），不能只看"commit 说包含"；检测模式注意源码是分行写法（`} else {\n const __lastT`），单行拼接串搜不到会误判**。客户 13398628215 解锁 SOP 不变：卸载重装（勾清除数据）→ 官网下载 v1.0.0.216 新包 → Tab1 重提交表单触发 PAYMENT_REQUIRED 持久化 → 切后台再切回（三重触发）→ machineId 自救自动领码 → 手机号+激活密码登录。

**二、桌面版 else push 修复（§十七·四闭环）**：`app_project/db-offline/desktop/index.html` L1706 照抄 index-app.html L1719-1730 补回 else push 块（含 `__lastT` 时间戳）；门禁全绿：check-interface 6 OK / auth-core 11 副本 IN SYNC / drift-guard 无新增漂移。**根 index.html 是 2026-08-25 旧形态（有 else push 无时间戳），非缺分支——判定"缺不缺"用 `\} else \{[\s\S]{0,250}list\.push` 正则而不是裸字符串**。

**三、本轮新坑（工具链）**：① **落定门拦截未提交源码**=改完源码必须先 commit 再打包（`ALLOW_DIRTY_BUILD=1` 仅应急），流程=commit 源码→build-app.bat→auto-update-downloads --confirm→镜像 site-official→commit+push 产物；② **build-app.bat 在 ensure-build-env 阶段 `exit /b 1` 不释放构建锁**（:build_fail 才释放）——被拦后重打前必须查 `.build.lock` 属主 PID 已死再删；③ **auto-update-downloads.js 的 aapt 读中文文件名 APK 报 Illegal byte sequence → 版本回退 build.gradle 只读出 "1.0.0" 无 versionCode**（违反 V1.0.0.N SSOT）——发布后必须人工核对 manifest `apk.version` 含 versionCode，缺了手动补 `V1.0.0.N` + `versionCode: N`（本次已补 V1.0.0.216）；④ 该工具只写 public/hash-manifest.json **不镜像 site-official**——发布后手动整份 Copy-Item 镜像并哈希比对 IN SYNC；⑤ 工具重写 apk 节点会**丢 releaseUrl/releaseFileName/releaseTag**——旧 releaseUrl 指向旧版 GitHub Release 必须清（防错版分流），新 Release 建立后由发布流回填。

**四、各端生效方式**：离线 APP=官网下载页已上 V1.0.0.216（Pages 自动部署，manifest 双权威源 IN SYNC，sha256 `10341e76…`，旧 releaseUrl 移除后手机端回落 CF 静态源+robustDownload 增强单流）；离线桌面=**EXE 1.0.171 已重打包+发布完毕**（Release `v2026.09.04-1718`，全加固链通过 E2E 3/3+ASAR 完整性+fuses+.bnzc ver2 match+Authenticode 签名+冒烟 176/176，自动更新检查 `updates/local/latest.json` 已指向新 Release，桌面端启动即提示升级）；云端网页/官网/Functions=随 push 即刻生效；云端 APP/云端桌面=含同款修复待各自重打包；鸿蒙=随下次 HAP 编译携带。

**五、发布闭环补坑（publish-release.js v2026.09.04-1718 实战）**：① **publish-release.js 也不镜像 site-official**——发布后 `site-official/hash-manifest.json`（桌面节点仍指旧 1.0.170 Release）与 `site-official/updates/local/latest.json` 全部落后，必须手动整份 Copy-Item 镜像（本条与三④同源：发布链两工具均只写 public，**双权威源镜像永远是发布后手动收尾动作**）；② **legacy `updates/dingzhi/latest.json` 是 2026-08-23 改名（9762ac9a dingzhi→local）前旧桌面客户端的更新源**，长期停在 1.0.142 且 portableUrl 指向已下线的 pages.dev 自托管 exe——每次桌面发布应同步更新（version/url/portableUrl 三字段指新 Release），否则旧客户端永远收不到升级提示；③ publish-release.js 用 `--target=dingzhi` 时产物定位经 artifact-locate.js 解析到 local 节点（命名收口后 key 已统一），发布日志显示 `dingzhi/latest.json` 字样实为 local 键，核对时不要被日志字样误导。

★ 2026-09-04（十九）【方案B · 注册前置架构】离线 APP/桌面「先注册 → 后激活」彻底重构（撤销方案A"Tab1 提交即建号"，账号创建与激活彻底解耦）。**架构总纲：注册 = 本地建号（唯一密码写点）→ 试用/登录 → 激活 = 纯 license 安装（永不碰密码）**。出厂默认 admin 账号从"登录入口"降级为"待清理的幽灵数据"。

**一、密码写点唯一化（取代条目十九·铁律2"激活 UPSERT 强制覆盖密码"条款——该铁律的适用前提"账号由激活流程创建"已不存在）**：
- 密码全链路仅 **3 个合法写点**：① `registerLocalUser`（注册）② 修改密码正式接口 ③ 账号不存在时激活收尾的兜底建号（[LicenseManager.java L3754](file:///d:/trae_projects/kyt-zy/app_project/db-offline/app/app/src/main/java/com/benneng/pres/LicenseManager.java#L3754) 注释即此三写点清单）。
- `syncCreateActivationUser` exists 分支改为**密码保留**：`if (u.optString("password","").isEmpty()) u.put("password", effPwd)`——只在空时补，绝不覆盖；且不再刷新 `lastPwdUpdatedAt`（密码没动时间戳不动）。激活收尾把注册密码重置回 admin 的"Mate 70 第7案密码错位"从架构上绝根。
- 验收：激活链路任何位置出现"无条件写 password"=违规。

**二、注册入口（auth-core 运行时注入，0 HTML 改动）**：[offline.js](file:///d:/trae_projects/kyt-zy/shared/auth-core/offline.js) `showLocalRegisterModal()`（L3437）收集诊所名/医师名/11位手机号/密码（≥8位且含字母+数字，禁用 admin）；注册信息加密存 `localStorage:license:registrationInfo`（`getLocalRegistrationInfo` L3368）；双端桥=APP Java `registerLocalUser`（LicenseManager L3643，写 config.json users[]）+ 桌面 IPC `license:register-local-user`（electron/main.js L2712，preload L167）。注册同步写入 clinicName/doctorName 到 config。**登录框入口动态切换**（`injectLoginEntry`）：本地桥 + 未激活 + 未注册 → 显示"📝 注册开通"；否则显示"管理员激活"。

**三、幽灵 admin 双保险**：① **登录封锁**——两个 local adapter 的 `authenticate` 均拦截 `admin/admin`（L1118/L1176）：未注册→"请先完成注册"；已注册→"内置默认账户已停用，请使用注册的手机号登录"（改过密码的真实 admin 不受影响，密码非 'admin' 不命中）。② **注册后物理移除**——Java 端与桌面 IPC 均做保守判定（宁可漏删不可误删）：username='admin' 且 password 为明文 'admin' 或出厂哈希 `2f1e152d…`（sha256('bnzc_prescription_salt_v1'+'admin')，与 assets/public/config.json 出厂值一致）才删除。

**四、激活流程适配（已注册用户零重复输入）**：激活 Tab1 表单用 `license:registrationInfo` 预填诊所名/医师名/手机号；手机号与注册一致时**跳过密码步骤**——自动填 `adminPassword`/`adminPassword2` 两个密码框后自动点 `adminSubmitBtn`（防"跳步后提交失败密码框为空"回归）。注册状态判定 `isLocalRegisteredAsync`（L3390+）双源：localStorage 注册信息 ∪ 桥 config.json 已有手机号账号（升级设备场景）。

**五、门禁与生效**：本轮 8 文件改动（offline.js 权威源 + 3 份离线 auth-core 副本 + LicenseManager/MainActivity + 桌面 main.js/preload.js），门禁全绿：sync-auth-core 11 副本 IN SYNC / check-interface 6 OK / sync-all VerifyOnly 全一致 / html-sync-check IN SYNC / Gradle 编译过（仅 deprecation 提示）。**各端生效：离线 APP + 离线桌面必须重打包**（客户端逻辑）；云端网页/Functions 不受影响（cloud.js 未改）；鸿蒙 rawfile 副本随下次 HAP 编译携带。**新装机 SOP：首次启动 → 点"注册开通" → 填诊所/医师/手机号/密码 → 登录试用 → 需正式使用时走管理员激活（表单已预填，密码步骤自动跳过）**。

## 8. 桌面版技术规范

* **桌面版云端 HTTP 必须走主进程**（file:// 直连被 CORS 拦截，Origin: null 不在白名单，fetch 静默 TypeError）：IPC 代理或 activate.js 内 fetch。APP 端 <http://localhost> 在白名单可直连。新增桌面版云端接口沿用 postInviteQuery 分流模式。

* **CSP** **`connect-src 'self'`** **拦截云端 API（高频坑）**：判定某 index.html 是否被拦看三件事——①是否 file:// 本地 WebView/Electron loadFile 加载（非 pages.dev 同源）②渲染进程是否 fetch pages.dev 云端 API ③connect-src 是否含 pages.dev，三者具备才是 bug。修复：head 的 `connect-src 'self';` 追加 `https://tcm-prescription-system.pages.dev https://*.pages.dev;`（只改 head 安全策略，不动 body/样式）。

* 桌面管理员激活走主进程流程（activate-window + submitAdminRequest/saveLicense IPC），不经过 auth-core onAdminActivated。

* 激活窗口 activate-window\.html：QR 库从官网 CDN 加载（失败自动降级链接文本）；checkAdminStatus IPC 链（preload→main→activate.js）透传 machineId。

## 9. 安全防破解铁律

* 核心原则：**宁可漏检不可误报**。只有 APK 签名校验允许 toastAndExit 阻塞运行；Root/调试器/Frida/Xposed/模拟器检测只能 Log.w 记录日志。

* 安全检测关键词黑名单（gmain/busybox/ro.debuggable=1 等）禁止用作检测特征。

* 安全优化不得破坏正常打包流程，不得导致正常用户闪退。

## 10. 排查验证方法论

* **报错文案会误导定位**：防静默包装只报 e.message 不报行号，「Cannot read 'success'」可能来自链路上任何一个 await——必须通读整条调用链。

* **浏览器 E2E 是实锤根因最佳手段**：git HEAD 版+真实 shim+mock 桥复现逐字一致报错 → 改后同环境验证。E2E 三坑：页面 JS 字符串内含 `<head>`（打印模板），注入脚本必须 IndexOf 首处插入禁止全局 replace；CSP upgrade-insecure-requests 需在测试副本移除；alert 需在 head 注入捕获。

* 测试页面改动必须带缓存穿透参数（?v=xxx），浏览器缓存会测到旧版误判。

* async 按钮处理函数必须有外层 catch（含防静默包装），否则异常=点击无反应。

* npx http-server 本机可能卡死 → 用手写静态服务器 `tools/_tmp/qrcrop/static-server.cjs`；<http://127.0.0.1> 是安全上下文 crypto.subtle 可用。npm install 间歇性失败 → jsdelivr 直接下载库文件本地 require。

* 临时产物统一放 tools/\_tmp/（git 不入库）。

* PowerShell：写含中文 .ps1 必须 UTF-8 BOM（Edit 工具会丢 BOM 需整文件重写）；RunCommand 含★等特殊字符的替换反引号转义会引入 \` 字符需复查；脚本参数经 -File 传递会丢，重要参数硬编码。

* 用户手动重命名文件易带尾部空格导致 404——验收图片类交付必须逐文件核对文件名。

* 云桌面 E2E 在 git push 触发 Cloudflare Pages 部署窗口期可能 transient 423，等部署完成后重跑即过，勿盲目改代码。

* 图片二维码验证：jsQR + PowerShell System.Drawing LockBits 提取 RGBA（GDI+ 是 BGRA 需转序）。

* ★ 2026-08-31 下载页"网络中断"误报根因：window\.location.href = url 导航当前页面到下载 URL，浏览器页面加载被 Content-Disposition: attachment 中断后误报"网络错误"。修复：创建隐藏 <a> 元素（document.createElement('a')）并程序化 .click() 触发下载，不导航当前页面。铁律：**触发下载禁止用 window\.location.href，必须用隐藏** **<a>** **元素触发，避免浏览器页面导航中断误报**。

* ★ 2026-08-31 v2 下载"网络中断"真正根因：`/api/dl` 代理**丢弃客户端 Range 头**（请求 1MB 切片却返回 200 + 完整 78MB），浏览器下载 75MB 中断后**无法断点续传**，链路抖动（用户↔CF↔GitHub 任一环）直接报"网络中断无法连接"。修复双层：① 服务端 dl.js 透传 Range 头到上游，206 + Content-Range 原样透传 + `Access-Control-Expose-Headers`；② 前端 robustDownload 下载器（fetch 流式 + Range 断点恢复，中断自动重试 8 次指数退避，完成后 Blob 保存，按钮显示进度）。铁律：**大文件下载代理必须透传 Range 支持断点续传；前端大文件下载必须用流式下载器自动续传，禁止裸** **`<a>`/location.href 一次成型**。

* ★ 2026-08-31 v3 下载"进度卡死 0%"根因：fetch ReadableStream **读流无内置超时**，弱网下连接静默挂起（无数据也无报错）时 `reader.read()` 永久等待，v2 下载器进度永久停在 0.4MB 且不触发重试（用户实测截图证实）。修复：**读流看门狗**——每段数据到达重置 15s 定时器，超时未喂则 `AbortController.abort()` 强制断开自动断点续传；重试上限提至 30 次、退避封顶 5s。铁律：**前端流式读取必须配看门狗（数据到达重置定时器 + 超时 abort），fetch 读流挂起不报错，没有看门狗就永远卡死**。

* ★ 2026-09-01 E2E E1 偶发超时第三轮（真根因=TDZ 时序竞态）：index.html 解析期(:778)即调用 `Permission.init()`，而 `const CONFIG` 到(:810)才声明——**IPC 回调若落在两者之间，CONFIG 处于暂时性死区（TDZ），`typeof CONFIG`** **亦抛 ReferenceError 被 catch 静默吞掉**，`__authoritativeEdition` 写入被跳过 → asar 出厂默认(cloud\_personal)经(:834)同步 XHR 反向覆盖 → 机构版用户管理按钮消失（E1 FAIL / E3 时序有利又 PASS 的"偶发"假象）。修复双端兜底：① permission.js init() **无条件先暂存权威 edition 到 Permission 实例**（`this._authoritativeEdition`，permission.js 先于内嵌脚本加载，实例必然已存在），CONFIG 可用时再写插槽；② edition-lock.js getter 优先级2读取 `Permission._authoritativeEdition` 兜底。铁律：**async init 的 IPC 回调与页面内嵌顶层 const/let 声明存在竞态——跨脚本共享的权威值必须暂存到必然先存在的载体（自身模块实例），禁止只依赖可能处于 TDZ 的全局对象；`typeof`** **对 TDZ 变量照样抛错，不是安全探测**。验证方式：E2E 竞态类问题单次通过不算数，须 dev electron + real\_app.asar（run-e2e 兜底模式 B）连跑 5 次以上；fused exe 按设计阻断 CDP，不能直接跑 Playwright E2E（超时≠业务失败）。

* ★ 2026-09-01 铁闸8c 冒烟连环雷：诊断快速输入 IIFE 的 `window.addEventListener('resize')` 在 smoke-runtime 沙箱抛错——沙箱 document 桩有 addEventListener 而 **window 桩（=sb2 自身）没有**，S1-S7 连锁全挂。铁律：*shared 组件新增 IIFE 必须过* *`node tools\smoke-runtime.cjs --all`（176/176），凡 window.* API 一律 try-catch 包裹（S7 红线=无 DOM 环境加载不得抛错）；此前构建一直卡在 E2E 前置闸，冒烟闸从未被跑到——修好一道闸会暴露下一道，历史欠账在第一次全绿构建时会集中清算\*。

* ★ 2026-09-01 一键发布链路假成功缺陷（P0）：publish-release.js 两处失败路径退出码均为 0——①源码未落定检查失败只 `return`（main 正常结束）；②git 推送失败 catch 后继续打印"发布成功！"。上游 auto-publish.js/release-menu.ps1 据退出码误报成功，实际下载页未部署（用户下载到旧版）。铁律：**发布/部署类脚本任何失败路径必须 process.exit(1)，且失败提示要写清"当前已到哪一步+精确补救命令"（产物已传 Release 但未 push ≠ 全部白做，给 3 条 git 命令即可续上）**。另修复：①auto-publish.js `checkOnly || x > 0 ? 2 : 0` 运算符优先级 bug（check 模式恒退 2）；②菜单\[3]\[4]无统一成败汇总——release-menu.ps1 新增 Show-PublishResult 统一中文大字块（成败+URL+Cloudflare 生效提示），auto-publish.js 成功块列明本次上传产物明细（名称+大小）、无变更时明确"官网已是最新"。

* ★ 2026-08-31 v4 下载提速实测结论：瓶颈在**中国→CF 海外边缘跨境带宽**（per-IP 整体受限，非单连接）。实测同机：GitHub 直连并行 0.06MB/s ≪ CF 代理单流 0.85MB/s < CF 代理 8 路并行 1.08MB/s。CF 代理是最快路线（比直连快 15 倍），多连接在丢包链路下提升明显（健康链路仅 +27%）。v4 方案：6 路并行分片（每段独立 Range/重试/看门狗）+ 按钮实时速度显示 + UI 节流 5 次/秒 + 分片 Range 不支持自动回退单流。**用户实机验证：v4 上线后 0.7MB/s（此前约 50KB/s，提升约 14 倍），75MB 包约 2 分钟完成**。铁律：**跨境大文件下载用多连接并行分片 + 断点续传 + 看门狗三件套；想再快只能上国内 CDN（需 ICP 备案付费），代码层面已到物理上限**。

* ★ 2026-08-31 浏览器"通常不会下载 xxx.exe"提示：Chrome/Edge 对**未代码签名 exe** 的信誉拦截（新文件+下载量少必触发），非文件损坏（SHA-256 已验证一致）。缓解措施：① 保存文件名用友好中文名（惠康中医-云端 安装版 x.x.x.exe，经 `a.download` 指定）；② 下载确认框预告知用户此提示属常规安全提醒、点"保留"即可。**根治唯一方案：购买代码签名证书（OV 几百元/年需积累信誉；EV 需公司约 2000+/年可立即消除 SmartScreen 警告）**。另注意：KNOWLEDGE.md 工作区副本多次被外部进程静默回退，编辑前先 `git checkout -- .trae/KNOWLEDGE.md` 恢复最新版本。

* ★ 2026-08-31 开放前官网安全审查（40+ Pages Functions 全面审计）结论：**唯一高危已修**——admin-status.js（无需登录）的 machineId 兜底扫描命中他人已激活记录时会执行 normalizeActivationPassword（受害者手机号下所有云端账号密码重置为 admin → 接管账号）；修复=兜底命中的记录只返回 license（license 绑定真实 machineId，攻击者本机验签必失败无泄露），provisionCloudAccount/normalizeActivationPassword 仅自己 requestId 的受信链路执行。**其余全部确认安全**：users.js 登录渐进锁定（5次起阶梯锁/封顶1h）+ IP 限流 10/min + 防枚举哑哈希、dl.js 严格域名白名单（无 SSRF/开放代理）、lookup.js machineId 绑定校验+码级/IP 级双限流、admin-\* 管理接口 platform\_admin 强制鉴权、ticket/trial IP 限流、处方 API 按创建者过滤水平越权、静态文件（config.json/wrangler.toml/文档）无敏感泄露、\_headers 安全头齐全。铁律：**①凡"客户端提交的标识参数"（machineId/phone/requestId）用于跨记录匹配时，命中的他人记录只能做"无副作用读取"，凡有写副作用（重置密码/开通账号）的调用必须限定"参数持有者本人记录"路径；②KV 里 login\_fail:{username} 键的 TTL 与锁定时长是两回事（TTL 24h 保计数、锁定看次数阶梯）**。

* ★ 2026-09-02 付款按钮"点击无反应"根治（openPayUrlRobust 三层递进+用户可见兜底）：故障树=桥失败 → `window.open` 在 WebView 未开多窗口时**静默返回 null 且不抛异常**（2026-08-30 修复的错误假设：以为 open 失败会抛异常走 location.href）→ location.href 又被 WebView 拦截器 shouldOverrideUrlLoading `return true` 静默吞掉 → 全链路零用户可见反馈。修复：①检查 open **返回值**而非依赖异常；②无桥+null=Electron deny 场景（setWindowOpenHandler 已 shell.openExternal 开系统浏览器，deny 返回 null 是正常路径）视为成功；③仅 APP 桥失败场景走 location.href+**看门狗**（1.2s 后页面未离开=导航被拦，自动复制购买链接+按钮文字提示 4s 后恢复）。铁律：**①fallback 链禁止依赖"会抛异常"的假设——WebView/Electron 的 window\.open 失败是静默 null；②面向客户的动作链最终一级必须是"用户可见反馈"（复制链接+提示），宁降级不静默；③Electron deny 的 window\.open 返回 null ≠ 失败（handler 可能已 openExternal），需用"是否有安卓桥"区分环境**。位置：offline.js openPayUrlRobust（adminPayGuide/ticketPayGuide 两按钮）+ cloud.js openOfficialPayUrl（3 按钮共用，加 btnEl 参数）；沙箱四场景验证（桥成功/桥失败静默null/桌面deny/浏览器）4/4。**2026-09-02 复核完善（5/5）**：①open 返回 null 需按 UA 三分——Electron（navigator.userAgent 含 'Electron'）deny 视为成功且**绝不可走 location.href**（will-navigate 拦截外链）；纯浏览器弹窗拦截（无桥非 Electron）走 location.href 当前页跳转兜底（购买页本就是目的地）；APP 桥失败才走看门狗；②**鸿蒙 rawfile 是 sync-auth-core 手工同步盲区**——已把 `app_project_harmony/huikang-cloud/entry/src/main/resources/rawfile` 纳入 CloudTargets（cloud 目标 8→9，副本共 12 份），新增分发目录必须同时进 sync-auth-core 清单；③Node 21+ 全局 navigator 只读，测试桩需 Object.defineProperty 覆盖。

* ★ 2026-09-02 管理后台用户列表"离线版全部显示为云端版"：functions/api/users.js `normalizeClinicEdition` 的模糊兜底规则（`indexOf('personal')→cloud_personal`、`indexOf('clinic')→cloud_clinic`）会吞掉**规范 key 自身**——'offline\_personal' 含 'personal'、'offline\_clinic' 含 'clinic'，中文别名规则（'离线标准'等）对英文 key 全部失效后落进兜底误判。修复=在模糊规则**之前**加四个规范 key（cloud\_clinic/cloud\_personal/offline\_clinic/offline\_personal）精确匹配。铁律：**归一化函数的"精确匹配规范 key"必须放在任何子串/模糊匹配之前——子串规则与规范 key 命名空间天然重叠（离线版 key 是云端版 key 的超集字符串），顺序错了就是把合法值当别名洗掉**。前端各归一化（edition-lock/permission/normalize-config）兜底是 `return s` 原样返回，无此问题；仅后端 users.js 独有此缺陷（全仓 grep `indexOf('personal') >= 0) return 'cloud_personal'` 仅 1 处）。沙箱 14 用例（4 规范 key+8 历史别名+空值默认）全过。

* ★ 2026-09-02 版本号 SSOT（下载页APP版本号 ≡ APP内显示 ≡ 系统设置应用管理）：症状="官网 download.html APP 卡显示桌面版号，手机 APP 内却显示 1.0.0，客户无法查对是不是最新版本"。根因链=5处版本号来源独立：①build.gradle versionName=1.0.0（软著固定不可改）②MainActivity.EXPECTED\_APP\_VERSION='2026-08-19-v1'（内部缓存常量）③index.html window\.APP\_VERSION='V1.0.0'（硬编码）④publish-release.js apk.version 旧版要么只读 versionName（软著=1.0.0 无区分），**更糟时曾经抄过桌面 latest.json 的 1.2.200**（造成 APP 卡显示桌面版号）⑤MainActivity.startApkUpdateCheck 用 versionCode 做比对（正确，与显示分离）。**根治 SSOT**：**Gradle=唯一权威源**。APK 版本号统一格式 **V{versionName}.{versionCode}**（如 V1.0.0.258 / V1.0.0.207）。1) 双端 MainActivity 新增 `injectAppVersionSSOT()`，onPageFinished 第一时间通过 PackageInfo 读取 versionName+versionCode，拼 V1.0.0.N 注入 `window.APP\_VERSION`，**覆盖** index.html 硬编码（不碰 HTML 结构）。2) 发布脚本 `publish-release.js` 新增 `readAppDisplayVersion()`（取代旧的 readVersionName 给 APK 用），APK 节点 manifest.apk.version = `V{versionName}.{versionCode}`，同时带 versionCode 字段。3) download.html APP 卡显示规范化 V 前缀大小写 + 兼容旧 manifest。4) 下载页与 APP 内版本号现在**同源同格式**，客户把"下载页 APP 卡显示的 v1.0.0.258"与"APP内关于弹窗显示的 V1.0.0.258"肉眼一对比即可确认是否最新。铁律：**①版本号必须绑定真实构建元信息（PackageInfo/PackageManager/gradle），禁止多处硬编码；②APK 版本号永远**不能**抄桌面 exe 的 latest.json——桌面和 APP 是两条不同的 versionCode 递增曲线，历史错判两次；③软著限制 versionName 固定时，必须在显示版本号里拼接 versionCode，否则所有版本号"都写成 1.0.0"等于没写；④版本展示不要通过改 HTML 字符串硬编码——改了也不会出现在客户安装包里，等于自娱自乐（Experience 1500076/1508846 两次强提醒：用打包产物解包证据 + 真实构建元信息，而不是手工敲字符串）**。沙箱验证：readAppDisplayVersion V1.0.0.258/207 正确；javac 双 MainActivity 语法通过；界面基线 6 OK/HTML IN SYNC/verify Key1+5 PASSED/五道门绿灯。**复查发现并根治的叠加冲突（2026-09-02 二轮）**：双端 injectLayoutFixScript 内已有 2026-08-28 的 `__APP_BUILD__='Build N'+applyEditionTags()+正则追加` 旧机制——SSOT 注入与其叠加会把页脚渲染成「版本: V1.0.0.258 Build 258」（versionCode 双显）。收口=删除旧 js2 块，injectAppVersionSSOT 吸收其三能力：①applyEditionTags() 原生重渲染（页面侧 L2283 本就读 window\.APP\_VERSION 重写 .login-footer，天然幂等，不再正则事后追加）；②title 在 applyEditionTags 重置后追加版本号（indexOf 守卫幂等）；③0/600/1500ms 三次幂等重试。铁律：**新增显示注入前必须 grep 宿主函数内既有注入机制——同一 DOM 挂载点的两个写入者必然叠加**；index.html 的 \_\_APP\_BUILD\_\_ 消费点均有三元守卫（undefined→空串），旧变量停设不炸页面。JS 沙箱 8/8（三连注入幂等/无Build双显/无applyEditionTags兜底/旧残留清洗）。

* ★ 2026-09-02 APK 官网手机端下载慢根治（三层下载链路重构）：症状=手机浏览器下载 APK 极慢（跨境单流 100-300KB/s，11.5MB 云端 APK 需 1-10 分钟且常中断）。**关键实测推翻假设**：CF Pages 静态源 `/downloads/*.apk` 对 Range 请求返回 **200 全量而非 206**（无 Accept-Ranges 头）——"CF 静态资源支持分段"的假设不成立，纯静态并行方案不可行。**正确方案=复用桌面 exe 既有加速基建**：①下载页 APK 卡 href 优先 manifest.apk.**releaseUrl**（GitHub Release），safeDownload 的 GitHub 分支自动套 `/api/dl` 同域代理（dl.js v2 已透传 Range 头）+ robustDownload（6 连接分段并行+断点续传+看门狗+进度显示）——端到端实测代理对双 APK 均返回 206 正确切片，4/4 通过；②无 releaseUrl 时回落 CF 静态源走 robustDownload 增强单流（断点续传+进度）；③robustDownload 彻底失败回退 legacyDirectDownload（HEAD 验证+<a> 直下）。**附带修复微信痛点**：微信内置浏览器协议层拦截 APK MIME 下载（任何技术绕不过），safeDownload 加 MicroMessenger UA 检测→toast 引导「右上角···→在浏览器打开」。铁律：**①优化下载速度前先实测 Range 支持度（curl/fetch 发 bytes=0-99 看 206 还是 200），"CDN 应该支持"是危险假设；②同域 Function 代理（/api/dl）+上游支持 Range = 可控的并行下载通道，比依赖静态源行为可靠；③下载类优化的兜底链每一级都要用户可见（进度百分比/速度/降级 toast），静默降级=用户感知'卡死'**。改动仅 public/download.html（safeDownload 分支重构 + legacyDirectDownload 抽取 + APK 卡 href 选择逻辑），零 HTML 结构改动。

* ★ 2026-09-02 CI「Verify Unified Modules」连续红灯根治复盘（三层叠加 → 三层防线，已连续绿灯）：**事故全貌**=①表象：副本注释 `<script>` vs 权威源 `[script]` 漂移（8-31 修复未同步副本）；②深层：权威源累积 3 份重复 hideUserTypeSelect IIFE + 注释移位，被 html-sync-check 的 ±30 行窗口重对齐**掩盖成 IN SYNC**（检查器本身有盲区）；③真根因：test-source-settled.ps1 子进程硬编码 `powershell`，ubuntu runner 只有 `pwsh` 第 5 道门必炸——本地全绿纯因 Windows 永远有 powershell。**三层防线**=①源头：sync-html.ps1 权威源生成模式（漏同步这个操作从流程中消失）；②本地：.githooks/pre-push 三道秒级校验（漂移推不到 GitHub）；③CI：pwsh 跨平台修复（5 道门恢复）。**复核 8 项全过**：端配置块身份三端各自正确、LF/无 BOM 物理特征不变、重复 IIFE 清零、五道门 RC=0、生成器幂等（连跑零改动）、CI 连续 success。方法论铁律：**①检查工具的"容错"（窗口重对齐/规范化）会把真实漂移洗成"一致"——修漂移前先审计检查器本身有没有盲区；②同症状多轮复现=多个独立根因叠加，修掉一层后必须看远端日志确认下一层（gh run view --log-failed），不能本地绿就收工**。

* ★ 2026-09-02（夜）发布"重跑假成功不补部署"修复（v2026.09.02-2127 实测）：**事故链**=①首次发布：6 产物上传 GitHub Release 全部成功 → 步骤 6 已更新本地 manifest/downloads/latest.json → 步骤 7 源码落定门检测到工作区有未提交变更（打包副作用 build-meta.json + .trae 临时脚本）按设计中止 exit(1)——**行为正确**；②用户按提示重跑：`--changed-only` 比对的是**本地已被首次运行更新的 manifest**→6 产物全部"hash 未变化"→第 582 行 `process.exit(0)` 提前退出，**静默跳过步骤 4-7**→退出码 0 假成功，下载页永不部署（错误提示里"重跑会自动补部署"的承诺与代码行为不符）。**修复**=changed-only 全部未变化 + 带 --push 时，先 `git status --porcelain -- public/hash-manifest.json public/downloads/ public/updates/` 检测发布产物是否有未提交变更：有→走与步骤 7 同基线的补部署（源码落定门→add/commit/pull --autostash/push，失败 exit(1) 给手动命令）；无→"[OK] 发布产物均已推送" 正常完成。**铁律：①"断点续传"类工具的比对基准必须区分"远端已发布状态"vs"本地已更新未推送状态"——比对本地缓存会把中断态误判为完成态；②任何 exit(0) 提前返回路径都要问一句：流程承诺的后续步骤（部署/清理/通知）是否被跳过；③发布类脚本的三段式（上传→清单→推送）每段都要可独立重入，重跑=补齐缺失段而非只补上传段**。

* ★ 2026-09-03 离线端「去官网付款」点击无反应（华为 Mate 70 实测，第 2 次"点击无反应"不同根因）：**根因=变量越界引用**——offline.js 的 showAdminActivateModal 内两个付款按钮绑定（bindAdminPayGuide/bindAdminPayRequired）复制自 showTicketFormModal，误带其局部变量 `editionIntent`；本函数作用域不存在该变量 → **点击时 ReferenceError 在 handler 第一行抛出**，openPayUrlRobust 永不执行，且异常被浏览器吞掉无任何可见反馈。修复=改用本函数的 `state.edition`。**为何三道防线全漏**：①E2E 用 test env，PAYMENT_REQUIRED 面板从不出现，按钮零覆盖；②node --check 只验语法不验作用域（未声明变量是运行时错误）；③云端版 cloud.js 用的是 `openOfficialPayUrl(machineId, state.edition, btn)` 参数传值（正确），同一功能双端实现不同导致只在离线端炸。**铁律：①复制兄弟函数的绑定代码块时，逐个核对自由变量在新作用域是否存在（尤其 state.xxx/局部缓存变量）；②双端同功能应共用同一 helper（cloud.js 的 openOfficialPayUrl 模式优于 offline.js 的内联拼接）；③"点击无反应"类症状先看 console 有无 ReferenceError——handler 第一行抛错=全程静默，与"函数逻辑错"表现完全相同但根因天差地别**。生效方式：需重打离线APP+离线桌面（云端两端无此 bug 不需要重打）。

* ★ 2026-09-03（四）Mate 70 客户"扫码完成支付后后台无待办"：**代码链路 review+E2E 证明 order-paid.js 状态流转无误**（pending_payment→pending 转态、入 admin_req_index、admin_phone 索引、付款信息齐全——wrangler 直读线上 KV 实测 19/19 PASS，代码本身没 bug）。**根因=客户端/系统端认知差**：客户端以为"扫码转账=付完"，系统定义"填「付款确认（转账单号后6位）」+ order-paid 成功=付完"。没点 order-paid 时记录永远 pending_payment：默认 pending 视图无、待激活申请待办卡无、Tab 角标无→三处完全不可见，老板与客户以为对方没收到，两边对不上。**修复=把 pending_payment 纳入「待激活申请」计数**：loadTodoCenter（统计页）和 refreshTodoBadges（30 秒轮询角标）两处，待激活申请数从只数 pending → 改为 pending+pending_payment；点进 Tab 后按筛选下拉区分"已付款待核对"（默认 pending）和"待付款（官网下单未付款）"。后台首页始终有数字预警，不会因客户没点付款确认就被静默漏掉。**铁律：①"状态多段漏斗"的中间态（未付款→已付款未确认→待审核→已激活）必须确保每段在运营侧都有感知入口——至少一段不可感知就会造成双方认知错位；②同一个 fetch Response.json() 只能读一次，多处分用必须提前把结果存变量（E2E 脚本和 admin 角标合并逻辑都踩过此坑）；③诊断"客户说付了但后台没看到"的标准步骤：先查 order-paid.js 链路（pending_payment→pending 是否成功），再看客户是否点过"付款确认"按钮，不要先怀疑索引逻辑**。* ★ 2026-09-03（五）客户扫码付款后 Step3 无输入框导致漏填「付款确认」：**Mate 70 用户点「去官网付款」→ 购买页 Step3 只有收款码+下一步按钮，用户扫完码以为"付完了"就关了，实际需要点「下一步」到 Step4 才出现转账单号后 6 位输入框**。没填 order-paid 时订单状态 pending_payment，默认后台待审列表不可见（之前已加"待激活申请角标合并计数"兜底，但这是事后补救）。**根治=把付款确认表单嵌入 Step3 同屏**：收款码下方直接内嵌绿色高亮付款确认卡（支付方式选择+单号6位输入+「✅提交付款确认」大按钮，带说明"填完才能进入管理员核对中队列，否则后台看不到"），同时保留 Step4 表单作为"点下一步"的第二入口；submitPayConfirm 改成 from 参数双入口，两个表单值互相同步，提交成功后统一 goStep(4) 进入状态轮询区。**铁律：① UI 流程"同一动作两个页面分步完成"时（扫码填单），只要用户心理预期（扫完=本步完成）与系统定义（跳到下一页才出填单）不同步，就一定要在动作页直接合并填单控件；② 新 UI 元素加说明文案点出后果（"否则后台看不到"）——正向引导加后果提示比空一句"请填写"效果好得多**。生效方式：购买页随 push 自动部署，APP/桌面无需重打包。生效方式：后台自动部署即生效，APP/桌面无需重打包。

* ★ 2026-09-03（六补）「客户已付款但后台显示未付款待激活」正常时间窗诊断口径（Mate 70 第 5 次排查实录，数据无异常）：**现象**=老板看到「待付款订单」卡片显示该客户 💳 未付款，但客户坚称已扫码付款。**KV 直查实锤（15109308569）**：16:38:16 官网下单(pending_payment) → 16:39:10 记录落库（后台"未付款"卡片开始显示）→ 客户扫码转账完成 → **16:40:03 才填付款确认 675331**（转 pending）→ 16:40:26 审核通过 activated。**根因=无支付回调的固有设计时间窗**：收款码是个人微信/支付宝码，系统无法感知"扫码转账已完成"，必须客户填转账单号后 6 位（order-paid）才转态。扫码完成→填单确认之间 1-3 分钟（找微信账单、复制单号），**窗口内后台显示"未付款"是正确状态，不是 bug**。**诊断口径：①先 wrangler 直查 `admin_phone:{手机号}` + `admin_req:{id}` 看 paidAt——有 paidAt=客户已补填（刷新后台即消失）；无 paidAt 且 <5 分钟=正常窗口等客户补填；无 paidAt 且 >10 分钟=电话指导（保存收款码→微信扫一扫→相册选图→转账→回页面填单号后 6 位，Step3 同屏付款确认卡已内置）；②勿把窗口内"未付款"误判为漏单/索引 bug 重复排查——（四）（五）的链路修复已 E2E 验证，本次 53 秒补填也证明 Step3 同屏卡生效（客户从"以为付完就关页面"进步为当屏补填）**。铁律：**人工支付渠道（无回调）系统里"客户说付了"和"系统知道付了"天然存在分钟级鸿沟，运营侧看到中间态先核对时间戳再下结论**。

* ★ 2026-09-03（三）离线版激活审核后诊所 edition 被错标云端版（99 元本地标准版客户显示"网页云端标准版"）：**根因=枚举映射函数忽略第二维度**——`mapActivationTypeToEdition(type)` 只看 pro/personal（版本档位），完全忽略产品模式（离线/云端）；离线标准版审核通过后 provisionCloudAccount 把诊所 edition 强制写为 cloud_personal。**次因=客户端提交字段语义错位**：离线端和云端端提交激活申请都传 `appMode:'app'`（载体信息），服务端无从区分产品模式；而官网订单 order-submit 传的是 `appMode:'local'/'cloud'`（产品模式）——同名字段两种语义，新老数据混用。**修复=①映射函数升级为 `(type, record)` 产品模式感知：appMode local/offline 或 versionLabel 含本地/离线 → offline_*，cloud → cloud_*，未知兜底 cloud（不改变存量未知记录）；②客户端离线端传 'local'、云端端传 'cloud' + versionLabel 补产品名；③wrangler 直写 KV 修复存量错误数据（北京源生堂/示范本能医道，回读验证 PASS）；④admin renderVersionInfo 兼容 'local' 值**。**铁律：①枚举映射函数收到"档位"参数却要产出"档位×模式"二维结果时，必须显式接收并检查第二维度——漏一个维度就会静默写脏数据且被"强制更新"逻辑放大（provision 的 force-update 把错值反复刷回去）；②同名字段跨链路必须语义一致（appMode 在 order-submit=产品模式、在客户端提交=载体），发现语义错位立即统一并做兼容层；③诊断此类"显示与事实不符"问题最快路径=wrangler kv 直读线上数据比对（system:clinics + admin_req:{id} 交叉验证），比读代码猜快**。生效方式：后台/API/云端网页自动部署即生效；客户端 appMode 修正需重打四端（仅影响新提交的激活申请，存量数据已 KV 修复）。

* ★ 2026-09-03（二）手机端扫码付款警告页 + 后台看不到卡单客户（华为 Mate 70 实测，双症状同根）：**症状①**=微信扫官网收款码弹安全警告页进不了付款界面。**根因**=客户从APP跳到购买页后在**同一部手机**上操作——无法用相机扫自己屏幕，只能长按识别收款码；**微信防诈骗机制禁止长按识别付款码**（收款码链接本身有效：payapp.wechatpay.cn/sjt 200 / qr.alipay.com 302，用 jsqr 解码图片可验证）。**修复**=购买页第3步加手机付款指引框（手机 UA 或 ?mid= 跳转时显示）：保存收款码→微信"扫一扫"→"相册"选图；+"付款遇到问题"加客服转账兜底（hktzy1688 备注订单号后6位）。**症状②**=后台完全看不到该客户。**根因**=官网下单 pending_payment 状态记录刻意不进 admin_req_index（order-submit.js 设计如此），客户卡在付款环节→激活申请又被支付前置拦截→后台三处（待审列表/待办中心/角标）全部不可见。**修复**=admin-list 新增 status=pending_payment 分支：**KV list({prefix:'order:'}) 枚举订单映射→加载记录→过滤**（无需新索引，历史卡单立即可见，分页上限 2000）；后台加筛选下拉+待办卡+角标。**铁律：①"设计上不可见的中间状态"（待付款订单）要问一句：客户卡在这个状态时运营侧是否有感知？无感知=跟进黑洞，需给管理员可见性；②KV 无需为"只读可见性"建索引——list({prefix}) 前缀枚举即可，还自动覆盖历史数据；③移动端购买页的收款码天然不可自扫，必须提供「保存图片→扫一扫→相册」指引或客服转账兜底**。生效方式：云端网页+后台+API 自动部署即生效（购买页是云端网页，APP/桌面无需重打包）。

## 11. 后续路线图（2026-08-31 定，试用观察期三步走）

* **第一步（当前）**：进入 1-2 周正常看诊观察期，不刻意测试——真实使用是最好的验收。

* **第二步（观察期内被动守护）**：CI 四重门（`.github/workflows/verify-unified.yml`：check-interface → sync-all -VerifyOnly → html-sync-check → check-injection-idempotency）每次推送自动校验，有漂移 GitHub 红灯提醒，按第 2 章红灯修复流程处理（界面改动→重建基线一并提交；shared 改动→本地 sync-all 后提交；HTML 副本→以权威源回改；注入幂等→改整段重写/补守卫）。观察期内**只修实报 bug，不做主动优化**，避免引入新变量。

* **第三步（观察期稳定后）**：最后一步「权威源生成模式」——6 份 index.html 收口为由单一权威源生成，届时改界面真正只改一处，替代第 2 章手工 6 份同步清单（sync 脚本/CI 门届时随架构收口一并重构）。**该模式落地前，多端同步仍严格按第 2 章清单手工执行，不得提前松懈。**

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

## 14. 鸿蒙 NEXT 适配（2026-09-01 Week1 已闭环编译）

**环境（已装好，勿重复安装）**：DevEco Studio 26.0 安装于 `D:\Program Files\Huawei\DevEco Studio`（内置 SDK HarmonyOS 26.0.0/API 26 + hvigor 6.26.4 + ohpm + node v24）；IDE 配置目录在 `%LOCALAPPDATA%\Huawei\DevEcoStudio26.0`。

**工程铁律（零改动保障）**：鸿蒙全部代码独立在 `app_project_harmony/`，安卓工程只读（`tools/copy-assets.cjs` 字节级拷贝 assets/public + video-recorder-inject.js → rawfile，图标 → AppScope/entry media；`shared-inject/` 存放从安卓 Java 逐字提取的 4 个注入脚本 → rawfile/inject/）。**禁止改安卓工程任何文件**。

**双包结构**：`huikang-cloud`（bundleName com.tcm.prescription，加载 <https://tcm-prescription-system.pages.dev）+> `huikang-offline`（待建，加载 rawfile 本地页）。云端版桥 22 个 invoke 方法 + printHtml + exit，全部从安卓 MainActivity switch 分支逐一对齐。

**命令行编译（免开 IDE，已验证成功）**：

```powershell
$env:DEVECO_SDK_HOME = "D:\Program Files\Huawei\DevEco Studio\sdk"
$env:NODE_HOME = "D:\Program Files\Huawei\DevEco Studio\tools\node"; $env:PATH = "$env:NODE_HOME;$env:PATH"
cd app_project_harmony\huikang-cloud
node "D:\Program Files\Huawei\DevEco Studio\tools\hvigor\bin\hvigorw.js" --mode module -p product=default assembleHap --no-daemon
```

产物：`entry/build/default/outputs/default/entry-default-unsigned.hap`（签名待 Week3 AGC 证书）。

**ArkTS API 与安卓/直觉的坑（编译踩过的，直接照抄）**：

* Web 事件名是 `onAlert/onConfirm/onPrompt`（不是 onJsAlert/onJsConfirm/onJsPrompt）、`onShowFileSelector`（不是 onShowFileChooser）、`onConsole`（回调必须 return boolean）。

* `JsResult`：确认 `handleConfirm()` / 取消 `handleCancel()` / **prompt 输入值** **`handlePromptConfirm(v)`**（handleConfirm 不收参数）；OnPromptEvent 默认值字段是 `event.value`（不是 defaultValue）。

* WebviewController 执行 JS 是 `runJavaScript`（不是安卓 evaluateJavascript 的 runScript）。

* picker.DocumentViewPicker 选项是 `maxSelectNumber`（不是 maxNumber）；`getHostContext()` 返回可空需守卫。

* `LoadingProgress().size(48)` 非法，须 `.width(48).height(48)`；arkts-no-any-unknown 严禁 any/unknown，JSON 参数用 `Record<string, Object>` + optStr 辅助取值。

* getContext(this) 已弃用但可用（仅 WARN）；桥的 UI 操作（startAbility/terminateSelf）须 setTimeout 包裹回主线程。

**Week1 桥实现状态**：✅ openExternalUrl（白名单同安卓）/ getVideoDirectory（返回前 mkdirSync 递归建目录）/ \_\_exitApp；⏳ 其余 19 方法骨架返回"鸿蒙版开发中"提示（真机可 alert 验证桥已通）。Week2 待办：媒体保存（沙箱+Picker）、备份恢复、打印（Print Kit）、分片读取、版本号改 bundleManager 动态读取、__STATUS\_BAR\_HEIGHT__ 真机校准。

**Week1 Seed-2.1-Pro 独立审查修复（2026-09-01，编译复通过）**：

* 【安全】URL 白名单**禁止 startsWith 前缀匹配**——`tcm-prescription-system.pages.dev.evil.com` 可绕过；用正则 `^https://([^/?#:]+)` 取 host 与 CLOUD\_HOST 严格相等（对齐安卓 Uri.parse().getHost()）。

* 【功能】鸿蒙 onLoadIntercept 对**所有请求**（img/script/css/xhr）回调，与安卓 shouldOverrideUrlLoading（仅框架导航）不同；必须 `event.data.isMainFrame()` 判断，非主框架一律放行，否则误杀第三方子资源导致页面残缺。

* 【安全】SSL 错误必须显式 `onSslErrorEventReceive → event.handler.handleCancel()`（对齐安卓 onReceivedSslError 一律 cancel，防 MITM）；HTTP 5xx 用 onHttpErrorReceive（主框架 >=500 弹重试）。

* 【对齐】anti-autofill 脚本安卓 onPageStarted + onPageFinished **各注入一次**，勿漏 onPageEnd。

* 【竞态】rawfile 脚本预加载是异步的，注入点必须 `readScript(name).then(js => runJavaScript(js))`，不能同步读缓存（页面加载快于读盘时注入丢失）。

* 【UI】自定义弹窗子卡片必须加 `.onClick(()=>{})` 消费事件，否则点卡片空白冒泡到遮罩误关闭；onBackPress 退出复用 bridge.\_\_exitApp()（桥构造时已持 context，避免 getHostContext() 空指针）。

* 【桥清单核对结论】云端版 invoke 共 **22 个 case**（savePrescriptionImage/saveVideoFile/startMediaSession/appendMediaChunk/commitMediaSession/getVideoDirectory/saveBackupFile/listBackupFiles/readBackupFile/backupMedia/restoreMedia/getMediaStats/findMediaFiles/openFile/readFileAsBase64/startReadSession/readNextChunk/closeReadSession/renameMediaFiles/deleteFile/printPrescription/openExternalUrl）；showToast/getMachineId/getAppVersion/checkAppVersion/updateApp 是**离线版**方法，云端版不要加。

* 【P1-6 待办】Week2 实现 readFileAsBase64/deleteFile 时必须加调用来源校验（controller.getUrl() host 严格比对云端，非云端返回 permission denied），防 XSS 读写沙箱。

### Week2（2026-09-01 已闭环编译）：22 方法全实现

**沙箱目录布局**（「沙箱+Picker」铁律）：

* 媒体：`{filesDir}/惠康中医媒体/YYYY-MM/`（图片视频同目录）

* 备份 JSON：`{filesDir}/backups/`（一键恢复链路完整：listBackupFiles 时间倒序取 20 个 → readBackupFile）

* 媒体备份副本：`{filesDir}/媒体备份/YYYY-MM/`（backupMedia 目标；重装后失效，跨安装迁移 Week3 评估文件选择器导入）

* saveBackupFile 成功后异步唤起系统分享（sendData + uri 授权 flag），用户可选「保存到文件」导出公共目录

**鸿蒙 API 落地经验**：

* fs 全同步 API 可用：`listFileSync/mkdirSync(path,true)/openSync(path,fs.OpenMode.x).fd/readSync(fd,buf)/writeSync(fd,bytes)/statSync/moveFileSync/renameSync/unlinkSync/copyFileSync/accessSync`

* `new util.Base64Helper().encodeToStringSync(u8)/decodeSync(str)`（注意 new，不是 util.createSync）

* `fileUri.getUriFromPath(path)` → `file://` URI；跨应用打开用 want `action:'ohos.want.action.viewData', uri, type: mime, flags:0x1`（FLAG\_AUTH\_READ\_URI\_PERMISSION 临时授权读，系统应用才能读沙箱文件）

* 打印：**print.print(files, context) 不支持 .html**（仅 pdf/图片/office/txt/xml，且需 ohos.permission.PRINT 权限）→ Week2 降级方案：HTML 写 cacheDir/print 临时文件 + viewData(text/html) 调系统应用打开；Week3 真机验证后评估 PrintDocumentAdapter+PDF

* readSync 返回实际读取字节数，须 `new Uint8Array(buf).slice(0, read)` 精确切片再 base64

* ArkTS：`Array<Record<string,Object>>` 赋给 `Record<string,Object>` 字段用 `arr as Object` 编译可过；fs 同步函数会触发 "Function may throw exceptions" WARN（可接受）

* 版本号：`bundleManager.getBundleInfoForSelfSync(BundleFlag.GET_BUNDLE_INFO_DEFAULT).versionName/versionCode` 动态注入，防硬编码漂移

* 桥需持有 webview\.WebviewController 做 P1-6 来源校验（`controller.getUrl()` host 严格比对）+ 路径白名单 normalizePath 消 `../`

**P1-6 已实现**：readFileAsBase64/deleteFile 入口校验 isCallerAllowed（云端 host）+ isMediaPathAllowed（媒体/媒体备份目录前缀）；openFile/startReadSession 仅路径白名单。

**Week2 Seed-2.1-Pro 独立审查修复（2026-09-01，22 桥全实现 + 编译复通过 BUILD SUCCESSFUL）**：

* 【安全核对结论·照抄】安卓 isSensitiveOperation 仅含 `readFileAsBase64`/`deleteFile` 两个 → 鸿蒙 invoke 入口仅这两 case 加 isCallerAllowed（host 正则严格相等，fail-closed）；startReadSession/openFile 不加来源校验、改路径白名单（对齐安卓注释：避免 WebView URL 短暂变化误拦截）；路径白名单 = 沙箱媒体目录 + 媒体备份目录，normalizePath 后必须 `startsWith(root + '/')`，防 `../` 逃逸。

* 【对齐】敏感操作参数/返回字段逐字核对安卓：saveVideoFile 返回 success/filePath/directory/fileName；getMediaStats 返回 success/count/totalBytes/backCount；renameMediaFiles 参数 oldPatientName/newPatientName（均 fallback patientName）/oldNo/newNo；分片 256KB/片。

* 【功能修复】printPrescription 的 **orientation 参数曾被丢弃**（安卓 portrait/landscape 对应 A5 纵/横向）→ 补回参数并向 HTML 注入 `@page{size:A5 landscape|portrait;margin:0}`，降级 viewData 打开浏览器/WPS 打印时纸张方向生效（对齐安卓 PrintAttributes ISO\_A5/NO\_MARGINS）。

* 【返回值修复】saveBackupFile 的 filePath 禁止塞中文提示尾巴（前端可能展示）→ 返回干净沙箱路径；导出引导走分享面板本身。

* 【IO 坑】**鸿蒙 fs.readSync 到文件尾返回 0（安卓 FileInputStream.read 返回 -1）**，readNextChunk 必须 `read <= 0` 判 EOF，只判 `<0` 会死循环发空片。

* 【资源泄漏】readSessions/mediaSessions 两个 Map 加上限 32：超限关闭最旧会话（read 关 fd、media 删 cacheDir 临时文件），防前端异常未 close 导致 fd/临时文件泄漏；readTextFile 的 closeSync 必须放 finally。

* 【容错】所有递归扫描/重命名/统计函数（scanDirByNameOnly/scanDirWithPrefixes/scanDirByNameAndTime/countFilesRecursive/renameFilesInDir）循环体内 statSync 单文件 try/catch 跳过——对齐安卓 listFiles 容错，单个坏文件不得拖垮整批扫描。ArkTS 对 fs 同步 API 报 "Function may throw exceptions" 是保守 WARN，try/catch 包住后仍报，不阻断构建，可忽略。

* 【教训·防复发】会话压缩恢复后旧快照曾静默覆盖 KNOWLEDGE.md，导致 Week2 章节丢失并误提交（commit 28bcb9c0）；**铁律：每次会话恢复后先 git status + git diff 核对关键文档行数，发现 KNOWLEDGE.md 被旧快照覆盖立即** **`git checkout <上一个含新内容的commit> -- .trae/KNOWLEDGE.md`** **字节级恢复**。

* 【Week3 真机验证项】① backupMedia/restoreMedia 沙箱内复制，卸载即丢（安卓双写公共 Download/中医处方系统/media/），媒体持久化需评估 SaveButton/批量分享导出，saveBackupFile 已用 sendData 分享导出 JSON（uri 沙箱 fileUri + flags 0x1 授读，失败静默不影响主保存）；② printHtml 降级 viewData，PDF/无边距真机效果待验；③ isCallerAllowed 在桥代理线程调 getUrl() 的运行时表现待验（catch fail-closed 已兜底）；④ 'ohos.want.action.sendData'/'viewData' 为系统隐式 action 字符串常量，编译不校验，真机接收方兼容性待验。

**发布签名材料（2026-09-01 本地已生成，等实名认证审核通过）**：

* 材料目录 `app_project_harmony/huikang-cloud/sign-materials/`（已 gitignore，**私钥/口令严禁入库**；口令在本地 `口令备忘.txt`，KNOWLEDGE 不记录）：`huikang-cloud.p12`（RSA2048 密钥库，alias=huikang-cloud）+ `huikang-cloud.csr`（968B，上传 AGC 用）。

* 生成命令（工具 `sdk/default/openharmony/toolchains/lib/hap-sign-tool.jar`，用 DevEco 自带 jbr java 25 运行）：
  `generate-keypair -keyAlias huikang-cloud -keyPwd <口令> -keyAlg RSA -keySize 2048 -keystoreFile <p12路径> -keystorePwd <口令>`
  `generate-csr -keyAlias huikang-cloud -keyPwd <口令> -subject "CN=huikang-tcm, OU=huikang, O=huikang, C=CN" -signAlg SHA256withRSA -keystoreFile <p12> -keystorePwd <口令> -outFile <csr路径>`

* **前置卡点**：AGC 一切签名操作（发布证书/Profile/DevEco 自动签名）都要求开发者实名认证。实名认证入口 URL：`https://developer.huawei.com/consumer/cn/verified/authentication-review?type=1`（AGC 头像菜单"去认证"链接在下拉里、自动化点击坐标常被拦截，直接给这个 URL 最稳）；个人认证=姓名+身份证+手机人脸识别，审核 1-2 个工作日，邮件通知。2026-09-01 已提交，审核中。

* **认证通过后续做（一次性）**：① AGC「用户与权限 > 证书管理」新增**发布证书**，上传 huikang-cloud.csr → 下载 .cer 放 sign-materials/；② AGC「我的项目」创建项目+添加 **HarmonyOS 应用**（包名必须 com.tcm.prescription）；③ 「Profile 管理」新建**发布 Profile**（选应用+证书）→ 下载 .p7b 放 sign-materials/；④ 填 build-profile.json5 的 app.signingConfigs（material: certpath=.cer / profile=.p7b / storeFile=.p12 + storePassword/keyPassword/keyAlias/signAlg=SHA256withRSA/storeType=PKCS12），products.default 引用该 signingConfig；⑤ hvigorw assembleHap 出**已签名** HAP（产物从 entry-default-unsigned.hap 变为 signed）。

* 经验：hap-sign-tool 的 generate-keypair **没有** -validity 参数（老教程有，现版本报错），照 -h 实际 usage 走；密码一旦生成不可回溯，必须落本地备忘；签名报错优先用 hap-sign-tool sign-app 直接暴露材料格式问题，不要先怀疑设备。

**Week3 里程碑：鸿蒙模拟器首跑成功（2026-09-03，惠康中医 HAP 在 HarmonyOS 7.0/API26 本地模拟器运行，登录页完整加载）**：

* 【最大结论·省掉签名等待】**本地模拟器（Emulator）接受未签名 HAP**：`hdc app install entry-default-unsigned.hap` 直接 `install bundle successfully`，无需任何证书/Profile/设备注册！签名配置窗口红字也写明"模拟器上安装 HAP 可跳过签名"。**真机/云真机才必须签名**。Week3 功能验证全部可在模拟器进行，不等企业认证/发布证书。
* 【Win11 家庭版虚拟化坑】家庭版**没有** Hyper-V 组件（dism 启用 Microsoft-Hyper-V-All 报 0x800f080c 属正常），但 DevEco 模拟器只依赖虚拟化核心——管理员 dism 启用 **VirtualMachinePlatform**（虚拟机平台）+ **HypervisorPlatform**（Windows 虚拟机监控程序平台）两个功能，**重启后**即可（BIOS VT-x 需已开，任务管理器→性能→CPU 可查）。报错码 00801001「未开启 Hyper-V」即此问题。
* 【模拟器冷启动无反应=镜像未下载】设备管理器（工具→设备管理器→本地模拟器）列表里 Pura 90 Pro/Mate X7 等只是**设备配置模板**；操作列 ⬇ 下载图标在=系统镜像未下载（镜像在 `sdk/default/openharmony/system-image/`，约 3~6GB），下载完图标变 ▶ 才能冷启动。点「冷启动」无反应不报错就是镜像缺失。
* 【命令行工具链】hdc 路径 `D:\Program Files\Huawei\DevEco Studio\sdk\default\openharmony\toolchains\hdc.exe`；编译需先设 `$env:DEVECO_SDK_HOME="D:\Program Files\Huawei\DevEco Studio\sdk"`（已持久化到用户环境变量，否则 hvigor 报 00303217）；编译 `hvigorw.bat assembleHap --mode module -p product=default --no-daemon`；装应用 `hdc app install <hap>`；启动 `hdc shell aa start -a EntryAbility -b com.tcm.prescription`；查设备 `hdc list targets`（模拟器为 127.0.0.1:5555，开机完成 param bootevent.boot.completed=true 才出现）；截屏 `hdc shell snapshot_display -f /data/local/tmp/x.jpeg` + `hdc file recv` 拉回。
* 【首跑验证结果】Web 组件正常加载云端页面（pages.dev）、版本号注入生效（V1.0.0 Build 1000000，1000000 是 DevEco 默认 versionCode）、22 桥初始化无崩溃。模拟器限制：无摄像头（拍摄类桥方法测不了）、无 SIM（显示"无服务"但网络走宿主机正常）、分享面板无第三方 App 接收。
* 【主体已确认·2026-09-03】开发者账号 = **高碑店惠康堂中医诊所有限公司**，系用户 2026-09 用诊所营业执照新做的企业实名认证（DevEco 团队栏即显示此主体，自动签名/证书均以此主体签发）。B 方案「开发者企业资质」门槛已过。**主体一致性铁律：软著著作权人、APP 备案主体、AGC 开发者三者必须同为「高碑店惠康堂中医诊所有限公司」**。【2026-09-03 已核对】① 软著申请人 = **高碑店惠康堂中医诊所有限公司**（企业名义提交，与 AGC 开发者主体一致 ✅，等下证即可，无需转让/授权书）；② 备案必须以诊所执照备案（不能用个人）；③ 诊所同时是定向发布的"企业客户"，仍需在 HEM 管理台（developer.huawei.com/business/console）用同一执照认证"企业主"角色拿 HEM ID 填回 AGC 分发名单。

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
