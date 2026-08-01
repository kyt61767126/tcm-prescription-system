# 打包问题经验库

> 本库记录打包分发过程中遇到的问题、根因和解决方案，用于举一反三、快速定位。
> 分类：`SECURITY_*` = 安全加固问题；`BUILD_*` = 正常打包故障。
> 维护规则：每次打包遇到新问题，必须追加到本库对应分类下。

---

## 一、错误分类速查表

| 分类 | 典型特征 | 排查方向 |
|---|---|---|
| `SECURITY_OBFUSCATE` | charAt / stringArray / RC4 / obfuscator | 代码混淆配置问题 |
| `SECURITY_ASARMOR` | asarmor / asar / 100GB / 虚拟文件 | ASAR 防解包问题 |
| `SECURITY_SIGN` | signtool / certificate / pfx / 签名 | 证书/签名问题 |
| `SECURITY_INTEGRITY` | integrity / baseline / 基线 / 篡改 | 完整性校验问题 |
| `BUILD_DEPS` | npm install / ENOTFOUND / 404 / require / ESM | 依赖安装/模块兼容问题 |
| `BUILD_PATH` | 找不到 / Cannot find / 路径 / sync-all | 路径/合并残留问题 |
| `BUILD_VERSION` | versionCode / versionName / 冲突 | 版本配置问题 |
| `BUILD_RESOURCE` | resource / drawable / 资源缺失 | 资源文件问题 |
| `BUILD_GRADLE` | gradle / AAPT2 / compile / daemon | Android 编译问题 |
| `BUILD_ELECTRON` | electron-builder / asar unpack / NSIS | Electron 打包问题 |
| `BUILD_ENCODING` | BOM / CRLF / LF / 乱码 / GBK | 编码/行尾问题 |
| `BUILD_CACHE` | 增量缓存 / stale / 旧代码 / clean | 缓存问题 |
| `BUILD_VERIFY` | hash 不匹配 / APK 内容 / 验证失败 | 产物校验问题 |
| `UNKNOWN` | 未匹配 | 需人工分析 |

---

## 二、SECURITY_OBFUSCATE（代码混淆）

### [SECURITY_OBFUSCATE-001] charAt 错误
- **现象**: `Cannot read properties of undefined (reading 'charAt')`
- **根因**: javascript-obfuscator 的 stringArray base64 解码函数内部使用 charAt，在 Electron 桌面端运行时不稳定
- **影响**: auth-core.js 加载失败 → AuthCore 未定义 → 登录异常、用户管理不可用
- **解决**: 从 `tools/obfuscate.js` 的 MODULE_FILES 中移除 auth-core.js
- **日期**: 2026-07-31
- **历史**: commit 5bcb0ad 记录过 RC4 解码类似问题，当时改 base64 + 移除 login.js 混淆，但 auth-core.js 仍在列表

### [SECURITY_OBFUSCATE-002] RC4 解码失败
- **现象**: 启用 stringArray + RC4 编码后桌面版登入失败
- **根因**: RC4 运行时解码在 Electron 环境下失败
- **解决**: RC4 改为 base64 编码，移除 login.js 混淆
- **日期**: 2026-07-19（commit 5bcb0ad）

### [SECURITY_OBFUSCATE-003] stringArray 整体不稳定
- **现象**: 连续影响 login.js(RC4)、auth-core.js(base64)、permission.js(同因)，用户管理按钮不显示
- **根因**: javascript-obfuscator 的 stringArray 解码在 Electron 环境下不稳定（多版本编码均失败）
- **解决**: 清空 `tools/obfuscate.js` 中的 MODULE_FILES 数组，所有 JS 文件不再被混淆
- **理由**: ①历史证明 stringArray 在 Electron 不可靠；②即使只移除部分文件，其他文件仍有风险；③密码哈希用 SHA-256（公开算法），不强依赖混淆
- **日期**: 2026-07-31

---

## 三、SECURITY_SIGN（签名）

### [SECURITY_SIGN-001] 代码签名证书已删除
- **现象**: pack.ps1 走"未配置签名"分支
- **根因**: pfx 证书已永久删除，所有 package.json 均未配置 certificateFile
- **解决**: 如未来需启用签名，需重新生成 pfx 并在 package.json 的 build.win 添加 certificateFile
- **日期**: 2026-07-30

---

## 四、BUILD_GRADLE（Android 编译）

### [BUILD_GRADLE-001] AAPT2 daemon 启动失败
- **现象**: AAPT2 daemon 启动失败
- **根因**: 强制 `Stop-Process -Name java` 导致注册表残留
- **解决**: 清理 `~/.gradle/daemon/*/daemon*.bin`，预防用 `gradlew.bat --stop` 优雅停止
- **日期**: 2026-07-30

### [BUILD_GRADLE-002] Gradle 增量缓存导致旧代码打包
- **现象**: Java/HTML 变更后打包，APK 仍是旧代码
- **根因**: TCM_GRADLE_SKIP_CLEAN=1 跳过 clean，Gradle 增量缓存使用 stale cache
- **解决**: ①废弃 TCM_GRADLE_SKIP_CLEAN 选项，强制 gradlew clean；②build-app.bat 缓存清理逻辑提取为公共代码块，skip-clean 和 normal 模式都先执行
- **日期**: 2026-07-27

---

## 五、BUILD_PATH（路径问题）

### [BUILD_PATH-001] prepare-win-unpacked 找不到 package.json
- **现象**: pack.ps1 调用 prepare-win-unpacked.js 报错
- **根因**: 合并 db-offline 后 `$script:VersionDir` 语义变化（从"含 package.json 的版本目录"变为"版本根目录"），传入 prepare-win-unpacked.js 找不到 package.json
- **解决**: 传入 `$script:DesktopDir`（desktop 或 desktop_geren 子目录）而非 `$script:VersionDir`
- **日期**: 2026-08-01

### [BUILD_PATH-002] sync-all.ps1 源文件回退
- **现象**: 4个 permission.js 文件被错误回退到旧版本（只读限制）
- **根因**: shared/permission.js 源文件本身是旧版本，sync-all 把旧源同步到目标
- **解决**: ①用目标文件（新版本）覆盖 shared/ 源文件；②运行 sync-all.ps1 同步；③每次规范优化后运行 `sync-all.ps1 -VerifyOnly` 确认源与目标一致
- **教训**: sync-all.ps1 的源文件 shared/ 必须始终是最新规范版本
- **日期**: 2026-08-01

### [BUILD_PATH-003] 云端APP vs 离线APP 路径差异
- **现象**: 脚本报"无新文件"误报
- **根因**: 云端APP是 Capacitor 项目（APK 输出在 `cloud_app/app/build/outputs/apk/release/`，无 android 子目录），离线APP是原生 Android 项目（APK 输出在 `db-xxx/android/app/build/outputs/apk/release/`，有 android 子目录）
- **解决**: 在 APP_CONFIG 中显式配置 apkDir 和 gradlePath，避免路径拼接
- **日期**: 2026-07-30

### [BUILD_PATH-004] 文件夹合并后路径残留
- **现象**: 合并 db-dingzhi/db-geren → db-offline 后，打包脚本路径错误
- **根因**: tools/ 下脚本的 APP_CONFIG/CHANNEL_CONFIG 路径映射未更新
- **解决**: 更新所有 tools/ 脚本的路径引用（publish-release.js/auto-publish.js/update-manifest.js/prepare-win-unpacked.js/get-apk-sign-hash.js）
- **教训**: 合并文件夹后，必须检查所有 tools/ 下脚本的路径映射，不仅限于同目录脚本
- **日期**: 2026-08-01

---

## 六、BUILD_ENCODING（编码/行尾）

### [BUILD_ENCODING-001] .ps1 文件 BOM 丢失
- **现象**: 中文乱码、语法错误
- **根因**: .ps1 文件含中文但无 UTF-8 BOM
- **解决**: ①所有打包入口脚本开头添加 `powershell -File fix-ps1-bom.ps1` 调用；②fix-ps1-bom.ps1 扫描范围扩大到 cloud_project 和根目录；③自修复闭环（BOM 正常时不修改，丢失时自动修复）
- **日期**: 2026-07-30

### [BUILD_ENCODING-002] .bat 文件 LF 行尾
- **现象**: cmd.exe 解析错误、闪退
- **根因**: .bat 文件使用 LF 行尾（应为 CRLF）
- **解决**: 修复为 CRLF；中文注释改英文避免 GBK 解码问题
- **日期**: 2026-07-30

---

## 七、BUILD_VERSION（版本配置）

### [BUILD_VERSION-001] versionCode 自增与回滚
- **现象**: 打包失败后 versionCode 未回滚，导致下次打包 versionCode 跳号
- **解决**: ①versionCode 自增后记录旧值；②打包失败自动回滚 versionCode；③APK 哈希验证失败也回滚
- **日期**: 2026-07-29

---

## 八、BUILD_CACHE（缓存问题）

### [BUILD_CACHE-001] javac/assets/merged_assets 缓存
- **现象**: Java/HTML 变更后打包，APK 仍是旧代码（即使 gradlew clean）
- **根因**: javac/assets/merged_assets 缓存未清理
- **解决**: build-app.bat 缓存清理逻辑提取为公共代码块，skip-clean 和 normal 模式都先执行 javac/assets/merged_assets 清理，再根据 TCM_GRADLE_SKIP_CLEAN 决定是否 gradlew clean
- **日期**: 2026-07-27

---

## 九、BUILD_VERIFY（产物校验）

### [BUILD_VERIFY-001] 三层防护机制
- **现象**: 打包用旧版本代码（根目录修改了但 android 目录未同步/Gradle 增量缓存/APK 内容错误）
- **解决**: 三层防护
  - 防护1：同步后 hash 校验（根目录 vs android 目录 index.html SHA256）
  - 防护2：强制 gradlew clean（废弃 TCM_GRADLE_SKIP_CLEAN）
  - 防护3：APK 内容验证（从 APK 提取 index.html 计算 SHA256，与混淆后保存的 hash 比较）
- **教训**: ①仅靠 copy 同步不够，必须校验；②APK 内容验证是最终保险
- **日期**: 2026-07-27

### [BUILD_VERIFY-002] 注释与实现不符
- **现象**: build-app.bat 注释宣称包含"Verify APK contains latest index.html"，但实际代码未实现
- **解决**: 补充实现 APK 内容验证
- **教训**: 检查注释与实现一致性
- **日期**: 2026-07-28

---

## 十、BUILD_DEPS（依赖/模块兼容）

### [BUILD_DEPS-001] ESM 兼容 require/__dirname
- **现象**: shared/minify-js.js 和 shared/calculate-hash.js 报 require/__dirname 未定义
- **根因**: 项目 package.json 设置 `"type":"module"`，导致 CommonJS API 不可用
- **解决**: 添加 `import { createRequire } from 'module'; const require = createRequire(import.meta.url);` 和 `import { fileURLToPath } from 'url'; const __dirname = path.dirname(fileURLToPath(import.meta.url));`
- **日期**: 2026-08-01

---

## 十一、BUILD_ELECTRON（Electron 打包）

### [BUILD_ELECTRON-001] 桌面版版本号固定导致完整性误报
- **现象**: 桌面版重新打包后完整性校验失败
- **根因**: package.json version 固定 "1.0.0"，重新打包 version 不变，基线文件不更新，哈希不匹配
- **解决**: 桌面版哈希不匹配保持自动重建基线（避免误报），只改异常 catch 块为阻止启动
- **对比**: APK versionName 是动态的 `1.0.${BUILD_TIME}`，每次打包变化，基线自动重建
- **日期**: 2026-08-02

### [BUILD_ELECTRON-002] extract-zip 解压不完整（install.js 返回 exit 0 但无 electron.exe）
- **现象**: `node node_modules/electron/install.js` 执行成功（exit 0），但 `node_modules/electron/dist/electron.exe` 不存在，只有 locales 等部分文件
- **根因**: electron 的 install.js 依赖 `extract-zip` 模块解压下载的 zip，该模块在 Windows 环境下可能静默部分解压（仅 locales，无 electron.exe）却返回成功
- **解决**: pack.ps1 已有 .NET 回退解压逻辑（`[System.IO.Compression.ZipFile]::ExtractToDirectory`），从 `%LOCALAPPDATA%\electron\Cache` 找到已下载的 zip 直接解压，并写入 path.txt
- **缓存路径**: `C:\Users\<user>\AppData\Local\electron\Cache\electron-v<版本>-win32-x64.zip`
- **日期**: 2026-08-02（commit 27e4f8dc）

### [BUILD_ELECTRON-003] @electron/get 包损坏导致 install.js 抛 MODULE_NOT_FOUND
- **现象**: `node node_modules/electron/install.js` 直接抛错 `Cannot find module '@electron/get'`，exit 1，连下载都没开始
- **根因**: `npm ci --ignore-scripts` 后 `@electron/get` 包损坏——目录下仅有 LICENSE 文件，无 package.json 和 dist/ 代码。install.js 第3行 `require('@electron/get')` 立即抛 MODULE_NOT_FOUND。原 pack.ps1 中 Invoke-External 在 exit 1 时 throw，导致下方 .NET 回退逻辑无法执行
- **解决**: pack.ps1 修复为：①调用 install.js 前检查 `@electron/get` 完整性（package.json + dist 同时存在）；②不完整则跳过 install.js；③install.js 失败改为软失败（try/catch 不 throw），让流程继续走 .NET 回退解压。只要 `%LOCALAPPDATA%\electron\Cache` 有对应版本 zip 即可成功
- **诊断**: 检查 `node_modules/@electron/get/` 目录是否只有 LICENSE；检查缓存目录是否有 `electron-v<版本>-win32-x64.zip`
- **日期**: 2026-08-02

---

## 十二、举一反三清单

| 规则 | 来源 | 适用场景 |
|---|---|---|
| 涉及登录认证的 JS 文件不应被混淆 | SECURITY_OBFUSCATE-001/002/003 | 所有混淆配置变更 |
| 合并文件夹后必须检查所有 tools/ 脚本路径 | BUILD_PATH-001/004 | 文件夹结构调整 |
| sync-all.ps1 源文件必须是最新的 | BUILD_PATH-002 | 规范优化后 |
| .ps1 文件含中文必须有 BOM | BUILD_ENCODING-001 | 编辑 .ps1 后 |
| .bat 文件必须用 CRLF | BUILD_ENCODING-002 | 编辑 .bat 后 |
| 打包失败必须回滚 versionCode | BUILD_VERSION-001 | APP 打包失败 |
| 必须三层防护防旧代码 | BUILD_VERIFY-001 | 所有 APP 打包 |
| ESM 项目中 require 需 createRequire | BUILD_DEPS-001 | shared/ 脚本 |
| 版本号固定时完整性校验需自动重建基线 | BUILD_ELECTRON-001 | 桌面版打包 |
| electron install.js 失败应软失败走 .NET 回退解压 | BUILD_ELECTRON-002/003 | 桌面版打包 |
| npm ci --ignore-scripts 后需检查 @electron/get 完整性 | BUILD_ELECTRON-003 | 桌面版打包 |

---

## 维护说明
- 新问题追加到对应分类末尾
- 编号格式：`{分类}-{三位序号}`（如 SECURITY_OBFUSCATE-004）
- 必填字段：现象、根因、解决、日期
- 选填字段：影响、历史、教训、对比
