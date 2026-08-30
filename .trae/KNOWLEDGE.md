# 惠康中医项目 · 共享经验知识库（PROJECT KNOWLEDGE）

> 本项目**跨 work 账户共享的"统一大脑"**，随 Git 走，任何账户/电脑打开同一仓库即读到同一份经验。
> **以本文件为单一权威源**，各账户本地 `project_memory.md` 只是它的刷新副本（由 `学习经验.bat` 灌入）。
> 2026-08-30 归纳瘦身版：历史过程记录已压缩为主题化规范，所有规则以本版最新确定为准。
> 维护方式：每轮优化完成后**更新对应主题区块**（合并而非追加），保持精简。

## 0. 跨账户共享使用说明（新人必读）
- AI 本地记忆 `project_memory.md` 在 `C:\Users\<Windows用户>\.trae-cn\memory\projects\...`，**绑定账户**；换账户登录看不到旧经验。
- **新账户首次登录必做**：双击 `.trae\学习经验.bat` → 本文件同步到当前账户本地记忆（AI 每次打开项目自动加载）。定位记忆目录用精确哈希名，禁止 `*-kyt-zy*` 通配（会误匹配 offline-project 等其它子项目）。
- **读取**：每次会话开始先 Read 本文件（`.trae/rules/project_rules.md` 已配置自动提示）。
- **沉淀**：每次优化完成后把「结论+生效方式」合并进本文件对应章节 → git commit + push（或双击 `同步推送经验.bat`）。
- 约定：本地记忆永远由本文件派生，禁止反向把过期旧内容抄回仓库。

## 1. 会话安全与工作流（每次会话开始必查）
- TRAE SOLO CN 会话恢复会**静默覆盖工作区到旧快照**（无确认弹窗）→ 每次会话开始先 `git status` 验证，异常用 git checkout 恢复（工作区相对 HEAD 只有删无增=纯回退可安全恢复）。
- 修改完成自动 commit + push（Cloudflare Pages 部署依赖 GitHub 推送），无需用户要求；commit message 必须包含生效方式段落。
- 优化完成后必须提示各端生效方式：云端网页（自动部署）/ 云桌面（是否重打 exe）/ 云端APP（是否重打 APK）/ 离线桌面（是否重打 exe）/ 离线APP（是否重打 APK）。
- 基线（interface-lock）必须随代码一起 git 提交，杜绝"本机有、别人没有"。
- 模型调度：方案/链路/审查/风险评估强制 Seed-2.1-Pro（禁 Auto 自动切换）；简单实现用 Seed-Code；复杂后端/登录激活用 DeepSeek-V4-Flash；深层疑难/大重构用 DeepSeek-V4-Pro；Seed-2.1-Turbo 仅批量扫描；GLM/Kimi 仅特殊场景。每轮改完必须切回 Pro 独立审查。

## 2. 多端文件同步清单（漏同步 = 历史主因 bug，改动必查）
**6 份 index.html**（改共性 JS 必须全同步，漏 1 份=该端功能缺失/回退）：
1. `public/index.html`（云端权威源）2. 云桌面 electron/ 3. 云APP副本 4. 离线APP副本 5. `app_project/db-offline/index-app.html`（打包源，漏改=下次打包回退）6. 离线桌面 index.html（不属 html-sync-check 比较范围，**最易漏**）
- 官网购买页只需同步 2 份：`public/download.html` ↔ `site-official/download.html`（镜像关系，HTML 和 JS 都要同步；**禁止运行 _build_sites.cjs**，历史漂移未收编）。
- **auth-core.js 双权威源**：`shared/auth-core/offline.js`（试用版→3 副本）+ `cloud.js`（无试用→8 副本），改副本必须回写权威源后跑 `tools/sync-auth-core.ps1`，否则打包被旧版覆盖（历史"神秘回退"根因）。
- `cloud-api.js` 有 **8 处副本**需同步；APP 版 cloud-api.js 必须含 `typeof window._cloudReachable === 'undefined'` 防御性初始化。
- **index.html 功能双源纪律**：离线系 `desktop/index.html` 与 `index-app.html` 同源分叉维护——凡给 desktop/index.html 加功能，必须同步判断 index-app.html 是否需要移植。drift-guard 防呆：`tools/diff-index-app.cjs` 对比函数集+功能标记，build-app.bat 打包前自动调用（--quiet），差异打 WARN（基线 tools/.drift-baseline.json；桌面特有确认后 `--update-baseline` 更新）。
- shared JS（db-adapter/button-manager/edition-lock 等）：改 `shared/` 权威源后跑 `sync-all.ps1`；云端APP db-adapter.js 有防御性初始化本地差异，Group 1 排除需手工维护。
- 改 index.html JS 后必查三处：`html-sync-check.ps1`（副本漂移）、`sync-all.ps1 -VerifyOnly`（shared 组）、index-app.html 打包源与副本 diff。
- CI 三重校验闭环（`.github/workflows/verify-unified.yml`：check-interface → sync-all -VerifyOnly → html-sync-check），推送红灯即漏同步。红灯修复：界面改动→重建基线一并提交；shared 改动→本地 sync-all 后提交；HTML 副本→以权威源回改。
- 批量 replace_all 后必须 Grep 验证字面量归零（并行 Edit 会静默失败）。
- 全局变量一律 `window.xxx` 访问；跨脚本/跨 IIFE 调用一律 `typeof fn === 'function' && fn(...)` 防御式写法。
- **云端 APP 是 WebView 壳，内容取自线上 public/**：改云端 APP 界面必须在 `public/` 改并推 GitHub，改 APK 内 assets/public 无效。

## 3. 界面保护铁律
- 优化前必须运行 `check-interface.bat` 建立基线，优化后再运行验证；WARN 立即 git checkout 恢复或经用户确认后重建基线。
- 三端界面已适配，**禁止改动** index.html 的 body 内 DOM 结构、`<style>` 部分、mobileNav/mobileActionBar 按钮配置、login.html/login.js 的 UI 部分。只允许修改 main.js/MainActivity.java/auth-core.js/cloud-api.js/build.gradle/proguard/build.bat 等逻辑文件。必须改界面文件时先告知用户并获得明确同意。
- 基线只校验 body 到首个 script 的 DOM 结构——CSS/JS 修改不触发基线 WARN，但不代表可以改样式。
- 登录框已全端统一紫（#667eea/#764ba2/rgba(102,126,234)），**禁止再引入按版本变色机制**（JS 切 root class 保留但无视觉变化，首帧恒紫）。
- login 文件架构定性（勿盲统一）：login.js 功能双源（云桌面=云端账户登录/离线桌面=本地验证，377 行差异）按端维护；login.html 桌面双版仅 3 处合法差异（CSP 指令集/version-tag/离线特有 loginDoctorName 行）；public/electron/login.html 与桌面版平行演化，统一属界面改版需用户确认。
- 登录框下拉框和预填功能必须过滤真实医师姓名和手机号，仅显示通用用户名，读取时自动清理历史遗留实名数据。
- 手机端「清空」改「统计」入口（__replaceTopClearWithStats，<=768px 运行时 JS 注入）HTML DOM 零改动——同类需求沿用此模式。
- onclick 属性选择器是全局耦合：新增同 onclick 按钮会被旧的隐藏/查询规则误伤；APP 隐藏规则已限定 settingsModal 容器内。

## 4. 版本管理
- `window.APP_VERSION='V1.0.0'` 是单一数据源（getEditionTag() 旁，6 份 index.html 各有），JS 硬编码版本号全部引用该常量，升版本每端只改 1 行。
- 修改版本相关文本必须同步检查 **8 处版本标识**：①登录页 version-tag ②顶部 tab-hint ③JS IIFE textContent ④console.log ⑤showHelp alert ⑥exportInfo.version ⑦electron/login.html version-tag ⑧index.html `<title>`。版本号(V1.0.0)和版本类型文本(离线/云端+标准版/机构版)是两回事，分别核对。每次 Edit 后 Grep 验证生效。
- 离线APP改版本必须同步改 index-app.html 打包源；MainActivity Build 号注入匹配运行时 DOM 文本（V[0-9.]+ 正则），与源码运行时拼接兼容。
- 打包产品命名：惠康中医+版本（如惠康中医本地）；安装后登录界面显示「惠康中医诊所管理系统」。
- 打印/照片/视频文件命名包含门诊号（处方编号_患者姓名），排列顺序为处方签图片、面诊照片、诊疗视频。

## 5. 打包规范
- APK 输出路径统一到项目根目录（离线APP→db-offline 根，云端APP→db-yunduan 根）；一键打包默认严格模式（Java 混淆+签名哈希硬校验），无需回车确认。
- 桌面版打包前必须检查所有桌面版 package.json 的 build.files 是否包含新增脚本文件（cloud_desktop/cloud_desktop_geren/db-offline desktop/db-offline/desktop_geren），漏了=exe 缺脚本函数未定义。
- 桌面版问题排查先运行 build.bat 确认打包成功（pre-build-check.js 能发现 build.files 缺失），再查代码逻辑，勿盲目改 index.html/main.js 注入。
- 打包增量跳过（build-skip 指纹）可能误判「已是最新」→ 打包后必须解包 grep 验证关键修复标记；可疑时 `NO_BUILD_SKIP=1` 强制重打。
- 云端APP tools/obfuscate.js 会混淆 assets JS——解包 APK 后 grep 找不到 ≠ 没打进（index.html 未混淆可 grep 验证，其他 JS 需按混淆与否区分）。
- 安全优化后必须验证 4 端 APP 打包流程：预编译→非严格打包→严格模式打包→APK 签名哈希。
- 离线桌面打包固定两段式：`--dir`(rcedit 完成) → `pe-zone-sign embed+verify` 阻塞门禁 → `--prepackaged` 出 nsis/portable（electron-builder 顺序 afterPack→rcedit，afterPack 内嵌入的哈希必被 rcedit 作废）。
- PE 区段嵌入类修改（pe-guard）验证必须实际启动被嵌入的 exe，仅跑哈希校验不查布局会放过 "not a valid application" 级损坏；改 `shared/pe-guard.cjs` 后用 `git diff --no-index` 验证三处副本一致（shared + db-offline/desktop/electron + db-yunduan/cloud_desktop/electron）。
- pack-gate.ps1 打包验收门：历次打包事故固化为一道阻断门，打包流程走它验收。
- **打包产物（程序/APK）禁止自动上传官方下载网站**，必须人工检查合规后手动上传。
- 打包脚本 if 块内 echo 禁止未转义英文括号；Gradle daemon 模式必须一致（不混用 --no-daemon）；`.bat` 含中文必须 UTF-8 无 BOM + `chcp 65001` 且 CRLF 换行。

## 6. 数据存储布局（现行 v3，2026-08-29 定稿）
**桌面版（离线/云端同布局）**：
- 媒体（拍照录像）：`安装盘根目录\惠康中医媒体\downloads\YYYY-MM\`。重装软件/重装C盘均不丢；根目录无权限自动回退 %APPDATA%；便携版 exe 同级。
- 处方文字数据：`安装盘\惠康中医媒体\data\`（data/*.json）。备份/换机只拷「惠康中医媒体」一个文件夹。
- getUserData() 用候选数组兼容读旧位置；migrateLegacyDataToCentral() 启动自动迁移（不覆盖不删旧）。
- ★ getCentralDataDir 用模块级 let 缓存，只能在运行时（IPC/whenReady）调用，禁止模块顶层调用。
- 排查桌面媒体问题顺序：安装盘\惠康中医媒体\downloads → %APPDATA%\userData\downloads → 安装目录 downloads。
- 云端版处方主存在服务器，data 是本地缓存。

**APP 版（离线/云端）**：
- 媒体专属目录：getExternalFilesDir（卸载即清空，数据保留依赖一键备份）。
- 本地数据加密：db-adapter.js 字段级 XOR+Base64（ENC1: 前缀），敏感字段写密文读明文，密钥由 hostname+userAgent 派生（换设备不可解密），旧明文自动兼容升级。**改 db-adapter.js 的 IndexedDB/localStorage 读写时必须保持 _encRecord/_decRecord 配对，否则读到密文。**

**备份/恢复（已验证正常，2026-08-29 用户确认）**：
- APP：原生 saveBackupFile → `Downloads/中医处方系统/`；恢复优先「备份列表一键恢复」（listBackupFiles/readBackupFile），离线APP恢复含账号表 local_systemUsers+基础设置（重装后原账号直接登录），云端版不含（账号在服务器）。
- 桌面：IPC save-backup-file → `惠康中医媒体\downloads\中医处方系统\` 子目录；list-backup-files/read-backup-file IPC 一键恢复（兼容存量根目录备份）。
- **APP 端功能判断禁止依赖 IS_ELECTRON 常量**（shim 在 onPageFinished 注入，顶层常量已固化为 false），必须运行时判断 `window.electronAPI && window.electronAPI.xxx`。
- JS 桥三层防御：Java invoke() 必须 catch(Throwable)；shim 层拦截 null/'null'/''；前端 result null 安全。WebView 桥异常表现为「返回 null」而非 JS 异常。

## 7. 官网付费与激活闭环（2026-08-30 全链路现行）
**价格体系（年费订阅，双端独立授权）**：本地标准版 99 元/年（单用户）、本地机构版 299 元/年（3-5 用户）、云端标准版 199 元/年（单用户）、云端机构版 399 元/年（3-5 用户）。桌面/手机激活码独立授权，双端使用需分别购买。试用：免费 7 天，admin/admin 登入，限离线桌面/APP，云端无试用；**内置 admin/admin 仅试用期有效，激活后自动失效**。
**付费流程**：选版本 → 填信息下单（order-submit.js，pending_payment 不进待审列表）→ 扫收款码 → 付款确认（order-paid.js：支付方式+转账单号后6位，转 pending 入待审）→ 后台核对付款信息一键激活 → 客户 order-status.js 30 秒轮询自助领码。
**客户端导引闭环**：客户端激活等待界面/工单成功面板有「去官网付款」导引（桌面二维码/APP按钮 → 官网 `?mid=识别码` 自动预填只读锁定+自动切购买tab）；admin-status.js 支持 machineId 兜底——客户端轮询自己 requestId 未激活时，扫描最近 200 条找同 machineId 已激活的官网订单返回 activated+license（官网下单必须填客户端识别码，?mid= 已自动填）。
**收款码防替代**：运行时 SHA-256 校验（两份 download.html 内嵌 PAY_QR_PINS，不匹配隐藏收款码+警告拦截；网络失败静默跳过）+ CI 校验（tools/verify-payqr.cjs + verify-payqr.yml）。★更换收款码流程：jsQR 验新图域名（qr.alipay.com / payapp.wechatpay.cn）→ 算新哈希 → 同步更新 3 文件 4 位置（两份 HTML PAY_QR_PINS + cjs PINS）→ CI 绿灯。
**激活自愈四段一致**（重装/换机）：① /api/license/lookup 凭激活码+machineId 返回原激活信息；② validate.js 手机号核验（clientPhone===recordPhone → phoneVerified 放行）；③ showActivateModal 输码 change 自动联网识别填手机号；④ Java activateOnline 透传 phone。改激活链路必须保持四段一致。
**邀请码自愈四层一致**：onAdminActivated 存 StorageAdapter('license:code')；Java installAdminLicense 的 licenseCode 参数 JS桥→case→MainActivity→LicenseManager 四层透传；服务端 invite.js machineId 兜底；loadInviteInfo 联网找回。签名变更时四层参数必须同步。
**购买页必填项**：设备识别码必填+实时缺失提示（step2ReqHint 红条+可折叠获取教程）。

## 8. 桌面版技术规范
- **桌面版云端 HTTP 必须走主进程**（file:// 直连被 CORS 拦截，Origin: null 不在白名单，fetch 静默 TypeError）：IPC 代理或 activate.js 内 fetch。APP 端 http://localhost 在白名单可直连。新增桌面版云端接口沿用 postInviteQuery 分流模式。
- **CSP `connect-src 'self'` 拦截云端 API（高频坑）**：判定某 index.html 是否被拦看三件事——①是否 file:// 本地 WebView/Electron loadFile 加载（非 pages.dev 同源）②渲染进程是否 fetch pages.dev 云端 API ③connect-src 是否含 pages.dev，三者具备才是 bug。修复：head 的 `connect-src 'self';` 追加 `https://tcm-prescription-system.pages.dev https://*.pages.dev;`（只改 head 安全策略，不动 body/样式）。
- 桌面管理员激活走主进程流程（activate-window + submitAdminRequest/saveLicense IPC），不经过 auth-core onAdminActivated。
- 激活窗口 activate-window.html：QR 库从官网 CDN 加载（失败自动降级链接文本）；checkAdminStatus IPC 链（preload→main→activate.js）透传 machineId。

## 9. 安全防破解铁律
- 核心原则：**宁可漏检不可误报**。只有 APK 签名校验允许 toastAndExit 阻塞运行；Root/调试器/Frida/Xposed/模拟器检测只能 Log.w 记录日志。
- 安全检测关键词黑名单（gmain/busybox/ro.debuggable=1 等）禁止用作检测特征。
- 安全优化不得破坏正常打包流程，不得导致正常用户闪退。

## 10. 排查验证方法论
- **报错文案会误导定位**：防静默包装只报 e.message 不报行号，「Cannot read 'success'」可能来自链路上任何一个 await——必须通读整条调用链。
- **浏览器 E2E 是实锤根因最佳手段**：git HEAD 版+真实 shim+mock 桥复现逐字一致报错 → 改后同环境验证。E2E 三坑：页面 JS 字符串内含 `<head>`（打印模板），注入脚本必须 IndexOf 首处插入禁止全局 replace；CSP upgrade-insecure-requests 需在测试副本移除；alert 需在 head 注入捕获。
- 测试页面改动必须带缓存穿透参数（?v=xxx），浏览器缓存会测到旧版误判。
- async 按钮处理函数必须有外层 catch（含防静默包装），否则异常=点击无反应。
- npx http-server 本机可能卡死 → 用手写静态服务器 `tools/_tmp/qrcrop/static-server.cjs`；http://127.0.0.1 是安全上下文 crypto.subtle 可用。npm install 间歇性失败 → jsdelivr 直接下载库文件本地 require。
- 临时产物统一放 tools/_tmp/（git 不入库）。
- PowerShell：写含中文 .ps1 必须 UTF-8 BOM（Edit 工具会丢 BOM 需整文件重写）；RunCommand 含★等特殊字符的替换反引号转义会引入 ` 字符需复查；脚本参数经 -File 传递会丢，重要参数硬编码。
- 用户手动重命名文件易带尾部空格导致 404——验收图片类交付必须逐文件核对文件名。
- 云桌面 E2E 在 git push 触发 Cloudflare Pages 部署窗口期可能 transient 423，等部署完成后重跑即过，勿盲目改代码。
- 图片二维码验证：jsQR + PowerShell System.Drawing LockBits 提取 RGBA（GDI+ 是 BGRA 需转序）。

## 11. 已废弃规则（防误用，勿再执行）
- 媒体存储 v0（安装目录 downloads，NSIS 重装清空）和 v1（%APPDATA%）已被 v2/v3「惠康中医媒体」布局取代，仅作历史位置兼容读取。
- 媒体文件曾「不纳入一键备份」（历史版本 exportData 提示"照片和视频不包含在内"），2026-08-30 已实现照片视频纳入备份，该行为作废。

## 12. APP 照片视频备份（2026-08-30 已实现）
**动机**：APP 媒体存应用专属目录 getExternalFilesDir（卸载即清空），用户选择照片视频纳入一键备份防止丢失。
**存储位置**：媒体备份到公共 `Downloads/中医处方系统/media/YYYY-MM/`（与 JSON 文本备份同在「中医处方系统」文件夹，整个文件夹一起拷走即可换机）。文字 JSON 备份仍在 `Downloads/中医处方系统/` 根。
**原生桥（离线 com.benneng.pres + 云端 com.tcm.prescription MainActivity 双份一致）**：
- `backupMedia()`：遍历 getAllMediaDirs()（图片+视频目录，含新旧命名兼容），按 YYYY-MM 子目录复制；Android 10+ 走 MediaStore.Downloads（RELATIVE_PATH），Android 9- 直接文件复制；同名同大小去重（mediaFileExistsInDownloads）。返回 {success,copied,skipped,totalBytes}。
- `restoreMedia()`：读公共 `media/`，按扩展名路由恢复——`.webm/.mp4` → getVideoDir()，其余 → getImageDir()，保留 YYYY-MM 子目录；同名同大小跳过。返回 {success,restored,skipped,message}。
- 复制用 32768 字节缓冲二进制流，**禁止 JSON base64**（大文件内存溢出）。
**JS 接入（public/index.html 权威源 + 6 份副本）**：exportData 调 `window.electronAPI.backupMedia()`（弹窗显示复制 MB/已最新/跳过）；importDataFromJson 调 `window.electronAPI.restoreMedia()`（弹窗显示恢复数）。防御式判断 `window.electronAPI && typeof window.electronAPI.backupMedia === 'function'`。
**验证**：重打离线/云端 APK 后解包 grep `assets/public/index.html` 含 backupMedia/restoreMedia/照片视频备份 标记 + classes.dex 存在。
- 登录框「默认蓝+JS按版本切紫」机制已废弃，全端统一紫。
- 「按版本区分底部导航取消按钮」规则已废弃，现为**按角色动态显示**；「本地版」产品线已取消不再提供。
- 录像功能命令行开关（use-fake-ui-for-media-stream/enable-media-stream/allow-file-access-from-files）已废弃，权限在 main.js 用原生 Electron API 授予。
- 登录框记住密码功能不存在：永远需要输入用户名和密码登录。注册时真实手机号/医师姓名不记忆，仅记忆通用用户名。
