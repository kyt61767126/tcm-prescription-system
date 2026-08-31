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

* 模型调度：方案/链路/审查/风险评估强制 Seed-2.1-Pro（禁 Auto 自动切换）；简单实现用 Seed-Code；复杂后端/登录激活用 DeepSeek-V4-Flash；深层疑难/大重构用 DeepSeek-V4-Pro；Seed-2.1-Turbo 仅批量扫描；GLM/Kimi 仅特殊场景。每轮改完必须切回 Pro 独立审查。

## 2. 多端文件同步清单（漏同步 = 历史主因 bug，改动必查）

**6 份 index.html**（改共性 JS 必须全同步，漏 1 份=该端功能缺失/回退）：

1. `public/index.html`（云端权威源）2. 云桌面 electron/ 3. 云APP副本 4. 离线APP副本 5. `app_project/db-offline/index-app.html`（打包源，漏改=下次打包回退）6. 离线桌面 index.html（不属 html-sync-check 比较范围，**最易漏**）

* 官网购买页只需同步 2 份：`public/download.html` ↔ `site-official/download.html`（镜像关系，HTML 和 JS 都要同步；**禁止运行 \_build\_sites.cjs**，历史漂移未收编）。

* **auth-core.js 双权威源**：`shared/auth-core/offline.js`（试用版→3 副本）+ `cloud.js`（无试用→8 副本），改副本必须回写权威源后跑 `tools/sync-auth-core.ps1`，否则打包被旧版覆盖（历史"神秘回退"根因）。

* `cloud-api.js` 有 **8 处副本**需同步；APP 版 cloud-api.js 必须含 `typeof window._cloudReachable === 'undefined'` 防御性初始化。

* **index.html 功能双源纪律**：离线系 `desktop/index.html` 与 `index-app.html` 同源分叉维护——凡给 desktop/index.html 加功能，必须同步判断 index-app.html 是否需要移植。drift-guard 防呆：`tools/diff-index-app.cjs` 对比函数集+功能标记，build-app.bat 打包前自动调用（--quiet），差异打 WARN（基线 tools/.drift-baseline.json；桌面特有确认后 `--update-baseline` 更新）。

* shared JS（db-adapter/button-manager/edition-lock 等）：改 `shared/` 权威源后跑 `sync-all.ps1`；云端APP db-adapter.js 有防御性初始化本地差异，Group 1 排除需手工维护。

* 改 index.html JS 后必查三处：`html-sync-check.ps1`（副本漂移）、`sync-all.ps1 -VerifyOnly`（shared 组）、index-app.html 打包源与副本 diff。

- CI 三重校验闭环（`.github/workflows/verify-unified.yml`：check-interface → sync-all -VerifyOnly → html-sync-check），推送红灯即漏同步。红灯修复：界面改动→重建基线一并提交；shared 改动→本地 sync-all 后提交；HTML 副本→以权威源回改。

- ★ 2026-08-30 发布链路收口 `tools/artifact-locate.js`（单一权威模块）：产物路径配置/APK 定位（项目根产物优先→gradle 输出回退→public/downloads 旧包）/fromBuild 标记/同步 downloads（带 sha 校验）只有这一份；auto-publish.js、publish-release.js、auto-update-downloads.js 三工具全部 require 引用，**禁止再自维护产物路径配置**（历史三工具三份路径各自演化=发布事故架构根因）。自检命令 `node tools/artifact-locate.js --check`（源不一致/半成品嫌疑 WARN+exit 1）。

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

* onclick 属性选择器是全局耦合：新增同 onclick 按钮会被旧的隐藏/查询规则误伤；APP 隐藏规则已限定 settingsModal 容器内。

## 4. 版本管理

* `window.APP_VERSION='V1.0.0'` 是单一数据源（getEditionTag() 旁，6 份 index.html 各有），JS 硬编码版本号全部引用该常量，升版本每端只改 1 行。

- 修改版本相关文本必须同步检查 **8 处版本标识**：①登录页 version-tag ②顶部 tab-hint ③JS IIFE textContent ④console.log ⑤showHelp alert ⑥exportInfo.version ⑦electron/login.html version-tag ⑧index.html `<title>`。版本号(V1.0.0)和版本类型文本(离线/云端+标准版/机构版)是两回事，分别核对。每次 Edit 后 Grep 验证生效。

- ★ 2026-08-30 APP 首开/二开版本号不一致（Build 号竞态）：MainActivity 注入 Build 号的 js2 带提前 return 守卫（`__appBuildSuffix__`）——首次 0ms 注入时守卫已置位但 DOM 未就绪，600/1500ms 重试全被守卫短路 → 首开无 Build 号；且页面侧 applyEditionTags 重写 .version-tag/document.title 会抹掉事后注入的 Build。修复三层：①js2 去守卫（各挂载点 indexOf 检查天然幂等）；②js2 注入 `window.__APP_BUILD__` 并主动调 applyEditionTags()；③applyEditionTags 拼接 __APP\_BUILD__（index-app.html+assets 副本）。铁律：**带重试的注入脚本禁用一次性守卫短路重试；页面动态重写的元素，注入数据要走页面自己的渲染函数（注入变量+触发重渲染），别用事后 DOM 正则**。

* 离线APP改版本必须同步改 index-app.html 打包源；MainActivity Build 号注入匹配运行时 DOM 文本（V\[0-9.]+ 正则），与源码运行时拼接兼容。

* 打包产品命名：惠康中医+版本（如惠康中医本地）；安装后登录界面显示「惠康中医诊所管理系统」。

* 打印/照片/视频文件命名包含门诊号（处方编号\_患者姓名），排列顺序为处方签图片、面诊照片、诊疗视频。

## 5. 打包规范

* APK 输出路径统一到项目根目录（离线APP→db-offline 根，云端APP→db-yunduan 根）；一键打包默认严格模式（Java 混淆+签名哈希硬校验），无需回车确认。

* 桌面版打包前必须检查所有桌面版 package.json 的 build.files 是否包含新增脚本文件（cloud\_desktop/cloud\_desktop\_geren/db-offline desktop/db-offline/desktop\_geren），漏了=exe 缺脚本函数未定义。

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

* ★ 2026-08-31 APP 卸载丢媒体备份提醒（用户需求"卸载时弹提醒"）：**Android 硬限制——应用被卸载瞬间收不到任何系统回调，所有 APP 均无法在卸载时弹窗**，别再尝试。等效方案已上线：启动 5 秒后 checkMediaBackupRisk() 检测专属目录媒体数 vs localStorage `lastMediaBackupCount` 基准（exportData 媒体备份成功后刷新），有新增弹 confirm 警告一键备份，`lastMediaWarnDate` 每天最多提醒一次。Java getMediaStats 桥（离线/云端 MainActivity，遍历 getAllMediaDirs 计数）；JS AndroidNative 直连 + null/空串防御；6 份 index.html 同步；桌面/网页无桥静默跳过。铁律：**"卸载前保护"类需求一律做成启动时风险检测，比对基准放 localStorage、备份成功即刷新基准防重复打扰**。

* ★ 2026-08-31 APP 媒体一劳永逸定稿（用户选方案 A 即时双写）：**保存即备份**——savePrescriptionImage / saveVideoFile / commitMediaSession 三个 Java 保存出口各追加 syncToPublicBackup(file)（复用 copyMediaFileToBackup 的 MediaStore 双写+同名同大小去重，失败仅 Log.w 不打断保存）；getMediaStats 增 backCount（公共 Download/中医处方系统/media/ 计数，10+ MediaStore RELATIVE\_PATH LIKE 查询 / 9- countFilesRecursive 递归）；JS checkMediaBackupRisk 改 count vs backCount **自洽比对**（旧 APK 无 backCount 字段兜底回落 lastMediaBackupCount，向后兼容）。代价=存储×2（用户知悉）。铁律：**"保存即备份"双写必须挂在 Java 保存出口（渲染层入口多且演化快），失败静默（宁可漏备份不可打断开方）**；防打扰基准优先文件系统实测（backCount）而非 localStorage（重装即丢、易漂移）。

* ★ 2026-08-31 打包脚本 git renormalize 会回退未提交的 KNOWLEDGE.md 工作区改动（本轮实锤：条目已 commit 后又被 09:29 离线 build 的步骤1回退，git 仓库完好、工作区丢失）。铁律：**KNOWLEDGE.md 改完立即 commit；build-app.bat 运行前确认工作区 KNOWLEDGE 无未提交改动，或打包后 git status 发现 M 时先 git checkout 恢复再核对是否丢条目**。

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

## 11. 已废弃规则（防误用，勿再执行）

* 媒体存储 v0（安装目录 downloads，NSIS 重装清空）和 v1（%APPDATA%）已被 v2/v3「惠康中医媒体」布局取代，仅作历史位置兼容读取。

* 媒体文件曾「不纳入一键备份」（历史版本 exportData 提示"照片和视频不包含在内"），2026-08-30 已实现照片视频纳入备份，该行为作废。

## 12. APP 照片视频备份（2026-08-30 已实现）

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

