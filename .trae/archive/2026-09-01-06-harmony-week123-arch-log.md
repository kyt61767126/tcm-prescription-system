# 归档：鸿蒙 NEXT 适配 Week1-3 全过程（2026-09-01 ~ 2026-09-06 · 编译+模拟器+签名均闭环，2026-09-12 搁置）

> 本文件由 KNOWLEDGE.md §14 于 2026-09-12 三轮梳理时迁入，内容一字未改（原 §14 全文 L600-812）。
> 搁置决策、重启铁律、剩余路线以 KNOWLEDGE.md §14 现行版为准；本文件仅存过程细节。


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

**P0 签名闭环里程碑（2026-09-06，企业发布签名 HAP 已出）**：

* 【关键发现·算法铁律】**HarmonyOS NEXT 发布签名强制 ECC P-256 + SHA256withECDSA**，RSA2048 + SHA256withRSA 用不了（hvigor schema `signAlg` 只允许 `SHA256withECDSA`）。之前 2026-09-01 生成的 RSA p12/csr 全部废弃重生成。**先用 hap-sign-tool generate-keypair -keyAlg ECC -keySize NIST-P-256 生成密钥库 → generate-csr -signAlg SHA256withECDSA 生成 CSR → 上传 AGC 换 .cer**。

* 【hvigor 密码加密门】**build-profile.json5 signingConfigs 的 storePassword/keyPassword 必须 ≥ 32 字符**（DevEco 加密格式，形如 `0000001B...` 60+ 字符），明文密码 `HkCloud2026!Sign#`（16 字符）直接报错 00303116。**绕过方案**：signingConfigs 置空 → hvigor 出 `*-unsigned.hap`（`WARN: No signingConfig found for product default` 正常）→ 手动 `hap-sign-tool sign-app -mode localSign` 签名，明文密码即可。命令模板：
  ```
  java -jar hap-sign-tool.jar sign-app -mode localSign `
    -keyAlias "huikang-cloud" -keyPwd "HkCloud2026!Sign#" `
    -appCertFile "sign-materials/huikang-cloud.cer" `
    -profileFile "sign-materials/huikang-cloud.p7b" -profileSigned 1 `
    -inFile "entry-default-unsigned.hap" `
    -signAlg SHA256withECDSA `
    -keystoreFile "sign-materials/huikang-cloud.p12" -keystorePwd "HkCloud2026!Sign#" `
    -outFile "huikang-cloud-release-signed.hap" `
    -compatibleVersion 26 -signCode 1 -permSign 1
  ```

* 【AGC 路径速查】AppGallery Connect → 「证书、APP ID 和 Profile」（不是 API 服务→凭证）→ 证书页点 **新增发布证书**（不是调试/测试证书）→ 上传 `.csr` → 下 `.cer`；Profile 页点 **添加** → 选应用（包名必须 `com.tcm.prescription`）→ 类型选 **发布** → 选刚下的 .cer → 下载 `.p7b`。三处命名必须对齐：证书名/Profile 名随意，但**包名**必须和 bundleName 完全一致。

* 【完整产物链】`sign-materials/huikang-cloud.p12`（ECC P-256 密钥，keyAlias=huikang-cloud）+ `huikang-cloud.cer`（AGC 企业证书，2029-09-06 到期）+ `huikang-cloud.p7b`（发布 Profile，PKCS#7）→ `hvigorw assembleHap` 出 unsigned → `sign-app` 手动签 → **`惠康中医-鸿蒙云端-发布签名.hap`**（1.45MB，项目根目录已归档）。sign-app 日志 `certificate in profile: 高碑店惠康堂中医诊所有限公司, Release` + `Sign Hap success!` 确认主体+签名完整性。

* 【备份文件】旧 RSA 密钥已保留 `huikang-cloud-rsa.bak` / `huikang-cloud-csr-rsa.bak`；devco-auto.* 是 DevEco 自动调试签名，留着不动；口令备忘.txt 本地留存，**绝不入库**。

### B 方案工程推荐梳理（2026-09-06 定稿）

**方案选型**：B 方案 = ArkWeb 远程 Web 壳 + 原生桥逐字对齐。对比其他路线（A 方案纯原生 ArkTS 重写 300+ 页、C 方案 Flutter/Tauri 跨端框架），B 方案胜出三理由：① **95% 代码复用**（前端 JS 原样跑，改前端即全端生效）；② **周期 5 周 + 预算 57.8 单位**（GLM-5.3 补贴后显省 15%，含返工率降低隐性收益省 30-40%）；③ **安卓 APP 已走同路线**，经验直接迁移，无新框架学习成本。

**双包结构**：`huikang-cloud`（bundle com.tcm.prescription，加载 pages.dev）+ `huikang-offline`（待建，加载 rawfile 本地页，离线试用激活链路 + 5 个离线独有桥方法 showToast/getMachineId/getAppVersion/checkAppVersion/updateApp）。

**工程结构总览**：
```
app_project_harmony/                      ← 鸿蒙全部代码独立，安卓只读
├── shared-inject/ (4 脚本)               ← 从安卓 MainActivity 逐字提取
│   ├── cloud-autocomplete-off.js
│   ├── cloud-electron-api-shim.js
│   ├── cloud-layout-fix.js
│   └── cloud-app-buttons.js
├── tools/copy-assets.cjs                 ← 字节级拷贝，零改动保障
├── huikang-cloud/                        ✅ Week1-3 闭环
│   ├── AppScope/app.json5                ← 包名/版本
│   ├── sign-materials/ 🔒                ← 私钥+CSR（等认证签 .cer/.p7b）
│   └── entry/
│       ├── build-profile.json5           ← Stage 模型 + 混淆关闭
│       └── src/main/
│           ├── module.json5              ← 仅 INTERNET 权限
│           ├── ets/
│           │   ├── entryability/EntryAbility.ets     ✅ 40 行
│           │   ├── pages/Index.ets                    ✅ 373 行
│           │   └── bridge/
│           │       ├── NativeBridge.ets               ✅ 1329 行（22 case 全实现）
│           │       └── PageInject.ets                ✅ 155 行（7 步注入序列）
│           └── resources/rawfile/       ✅ 安卓 assets 拷贝
└── huikang-offline/                      ❌ 待建
```

**已完成里程碑**（2026-09-01 → 2026-09-03）：
- ✅ Week1：编译闭环，ArkWeb + javaScriptProxy AndroidNative + 反钓鱼拦截 + 原生对话框 + 文件选择器 + 网络重试 + SSL 取消 + 返回键
- ✅ Week2：22 invoke 方法全实现（媒体保存/分片上传/备份恢复/媒体查找/文件操作 P1-6/分片读取/打印降级），沙箱「惠康中医媒体/backups/媒体备份/」三目录
- ✅ Week3：模拟器首跑成功（HarmonyOS 7.0/API26，未签名 HAP 直接装），云端页面完整加载 + 版本号注入 + 22 桥无崩溃，企业实名认证已提交

**剩余缺口（优先级排序）**：

| 优先级 | 任务 | 工期 | 依赖 |
|--------|------|------|------|
| **P0** | AGC 认证审核 + 签名闭环 | 1-2 工作日 | 实名认证（已提交等审核） |
| **P1** | 真机功能验证（媒体拍照录像/分片/备份导出/打印降级/P1-6 安全链路） | 3-5 真机测试日 | 已签名 HAP |
| **P2** | 离线版 huikang-offline 新建（DevEco 新建工程 + EntryAbility + 5 个离线独有桥 + 试用激活链路） | 1 周 | 云端版先上架跑通 |
| **P3** | 上架发布（软著下证 + 诊所执照备案 + HEM 企业主认证 + 定向发布名单） | 2-3 周并行 | P1 真机验证过 + P0 签名完成 |
| **P4** | 长期迭代：PrintDocumentAdapter+PDF 打印、SaveButton 媒体持久化、ArkTS 混淆开启、API27+ 适配 | 持续 | 上架后 |

**鸿蒙与现有项目联动铁律**：
- 前端资源同步：`copy-assets.cjs cloud` 从安卓 assets/public 字节级拷贝 → rawfile/；注入脚本从 shared-inject/ → rawfile/inject/；图标从安卓 mipmap → AppScope + entry media/
- 权威源走 `sync-all.ps1` 分发的 shared JS（prescription-core/auth-core/cloud-api），鸿蒙 rawfile 随分发自动更新
- 版本号 bundleManager.getBundleInfoForSelfSync 动态注入，**禁止硬编码漂移**
- CSP 含 pages.dev 通配（鸿蒙 rawfile/index.html 同云端系 3 份 CSP 要求）
- **鸿蒙工程零改动铁律**：app_project_harmony/ 代码不改安卓工程，拷贝脚本物理隔离

**长期风险·鸿蒙真机必验清单**（模拟器不覆盖）：
- 🟡 鸿蒙相机权限模型（savePrescriptionImage 调相机 → base64 → 沙箱落盘）
- 🔴 256KB 分片在鸿蒙调用栈表现（录像分片上传 10+ 片不溢出）
- 🟡 sendData + viewData 沙箱 URI 分享系统兼容性（备份导出）
- 🟡 viewData(text/html) + @page A5 方向打印效果
- 🟢 isCallerAllowed 在桥代理线程调 controller.getUrl() 安全性
- 🟢 ArkWeb onLoadIntercept 子资源是否真的全放行（isMainFrame 守卫已加）
