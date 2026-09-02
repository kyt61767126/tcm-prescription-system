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
**收款码防替代**：运行时 SHA-256 校验（两份 download.html 内嵌 PAY\_QR\_PINS，不匹配隐藏收款码+警告拦截；网络失败静默跳过）+ CI 校验（tools/verify-payqr.cjs + verify-payqr.yml）。★更换收款码流程：jsQR 验新图域名（qr.alipay.com / payapp.wechatpay.cn）→ 算新哈希 → 同步更新 3 文件 4 位置（两份 HTML PAY\_QR\_PINS + cjs PINS）→ CI 绿灯。
**激活自愈四段一致**（重装/换机）：① /api/license/lookup 凭激活码+machineId 返回原激活信息；② validate.js 手机号核验（clientPhone===recordPhone → phoneVerified 放行）；③ showActivateModal 输码 change 自动联网识别填手机号；④ Java activateOnline 透传 phone。改激活链路必须保持四段一致。
**邀请码自愈四层一致**：onAdminActivated 存 StorageAdapter('license:code')；Java installAdminLicense 的 licenseCode 参数 JS桥→case→MainActivity→LicenseManager 四层透传；服务端 invite.js machineId 兜底；loadInviteInfo 联网找回。签名变更时四层参数必须同步。
**购买页必填项**：设备识别码必填+实时缺失提示（step2ReqHint 红条+可折叠获取教程）。

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

* ★ 2026-09-02 付款按钮"点击无反应"根治（openPayUrlRobust 三层递进+用户可见兜底）：故障树=桥失败 → `window.open` 在 WebView 未开多窗口时**静默返回 null 且不抛异常**（2026-08-30 修复的错误假设：以为 open 失败会抛异常走 location.href）→ location.href 又被 WebView 拦截器 shouldOverrideUrlLoading `return true` 静默吞掉 → 全链路零用户可见反馈。修复：①检查 open **返回值**而非依赖异常；②无桥+null=Electron deny 场景（setWindowOpenHandler 已 shell.openExternal 开系统浏览器，deny 返回 null 是正常路径）视为成功；③仅 APP 桥失败场景走 location.href+**看门狗**（1.2s 后页面未离开=导航被拦，自动复制购买链接+按钮文字提示 4s 后恢复）。铁律：**①fallback 链禁止依赖"会抛异常"的假设——WebView/Electron 的 window\.open 失败是静默 null；②面向客户的动作链最终一级必须是"用户可见反馈"（复制链接+提示），宁降级不静默；③Electron deny 的 window\.open 返回 null ≠ 失败（handler 可能已 openExternal），需用"是否有安卓桥"区分环境**。位置：offline.js openPayUrlRobust（adminPayGuide/ticketPayGuide 两按钮）+ cloud.js openOfficialPayUrl（3 按钮共用，加 btnEl 参数）；沙箱四场景验证（桥成功/桥失败静默null/桌面deny/浏览器）4/4。

* ★ 2026-09-02 CI「Verify Unified Modules」连续红灯根治复盘（三层叠加 → 三层防线，已连续绿灯）：**事故全貌**=①表象：副本注释 `<script>` vs 权威源 `[script]` 漂移（8-31 修复未同步副本）；②深层：权威源累积 3 份重复 hideUserTypeSelect IIFE + 注释移位，被 html-sync-check 的 ±30 行窗口重对齐**掩盖成 IN SYNC**（检查器本身有盲区）；③真根因：test-source-settled.ps1 子进程硬编码 `powershell`，ubuntu runner 只有 `pwsh` 第 5 道门必炸——本地全绿纯因 Windows 永远有 powershell。**三层防线**=①源头：sync-html.ps1 权威源生成模式（漏同步这个操作从流程中消失）；②本地：.githooks/pre-push 三道秒级校验（漂移推不到 GitHub）；③CI：pwsh 跨平台修复（5 道门恢复）。**复核 8 项全过**：端配置块身份三端各自正确、LF/无 BOM 物理特征不变、重复 IIFE 清零、五道门 RC=0、生成器幂等（连跑零改动）、CI 连续 success。方法论铁律：**①检查工具的"容错"（窗口重对齐/规范化）会把真实漂移洗成"一致"——修漂移前先审计检查器本身有没有盲区；②同症状多轮复现=多个独立根因叠加，修掉一层后必须看远端日志确认下一层（gh run view --log-failed），不能本地绿就收工**。

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
