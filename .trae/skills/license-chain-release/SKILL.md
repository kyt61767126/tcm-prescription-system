---
name: license-chain-release
description: 惠康中医项目授权链/付费墙/激活/热更新/多端同步相关改动的审查-构建-发布全流程。当用户要求修改 LicenseManager、claim-free、feature-guard、auth-core、license-manager、activate、热更白名单文件，或发版/重签热包/提交推送授权链代码时使用。不适用于与授权无关的普通业务改动。
---

# 授权链改动发布流程（惠康中医 kyt-zy）

本 skill 是高风险授权链变更的强制流水线。权威背景见 `.trae/KNOWLEDGE.md`（开工第一步必须 Read，冲突以它为准）。

## 1. 适用判定

- 适用：free/personal/pro 授权档、付费墙、激活/领取/补绑、license 验签、config 签名、打印水印、热更新白名单文件、`shared/` 同步相关。
- 不适用：纯业务 UI、药材/处方逻辑且不触授权判断的改动——走普通提交流程，不套本流程。

## 2. 开工门禁

1. `git status`（防会话恢复快照静默覆盖）+ `git remote get-url origin`（必须是 `github.com/kyt61767126/tcm-prescription-system.git`）。
2. Read `.trae/KNOWLEDGE.md` 相关章节（授权链、界面保护、多端同步、打包规范）。

## 3. 改代码前：先定位权威源（最高频事故点）

目标文件若在 `app_project/**/electron/`、`assets/public/`、各端 `license/` 下，**先在 `tools/sync-all.ps1` 组定义中查它是不是同步目标**，再决定改哪里：

- 是同步目标 → 只改 `shared/` 权威源（如 `shared/license/license-manager.js`、`shared/desktop-fs-ipc.cjs`、`shared/auth-core/offline.js`），然后 sync 分发。手改副本会被 sync-all **静默还原且 git 变 clean**。
- 注意展平陷阱：`Sync-Group` 用 `Split-Path $file -Leaf` 把 `license/license-manager.js` 拼进 `electron/` 目标目录，看到同名文件不代表它是权威源。
- `sync-all.ps1` 中没有 shared 源的才是真权威（如 `desktop/electron/activate.js`、`activate-window.html`）。
- auth-core 权威源单独由 `tools/sync-auth-core.ps1` 管理（离线 3 目标 + 云端 8 目标）。
- 权威源/目标完整对照见 `references/sync-authority-map.md`。

## 4. 双重独立审查（提交前强制）

1. 功能审查：走 TRAE-code-review 流程，范围=相对 HEAD 的未提交 diff。**派 2 个互不通气的子代理各自读码取证交叉验证**，分歧项取证据链更完整一方。
2. 安全二查：走 TRAE-security-review，聚焦授权绕过/降级攻击、账号密码链、文件写入、fail-open/fail-closed、热更遮蔽；只报可证实可利用且由本次 diff 引入的问题。
3. 用户选择修复范围后，所有修复必须落回第 3 步确定的权威源。

## 5. 校验链（全绿才允许构建/提交）

```powershell
node --check <改动的每个.js/.cjs>                      # 含 shared 源与副本
powershell -NoProfile -ExecutionPolicy Bypass -File tools/sync-auth-core.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools/sync-all.ps1   # Sync 模式分发
powershell -NoProfile -ExecutionPolicy Bypass -File tools/sync-all.ps1 -VerifyOnly  # 必须 exit 0
& .\check-interface.bat                                # 必须 Summary: 6 OK
```

## 6. Android 构建与验包

- 版本号：`app_project/db-offline/app/app/build.gradle` 的 versionCode 递增。
- 构建：cwd=`app_project/db-offline/app`，`.\gradlew.bat :app:assembleRelease -x lint --console=plain`。
- 验包铁律：release dex 中方法名被 R8 混淆，**不能用方法名验包**；改用未混淆的中文字符串/常量（如 `ALREADY_PAID`、错误提示中文）。assets 内 JS 可直接用 zip 读取搜函数名。
- 分发（文件名固定）：复制到 `app_project/db-offline/惠康中医-v<N>免费版测试包.apk` 和 `app_project/db-offline/惠康中医-本地.apk`；旧包归档到 `%TEMP%`。

## 7. 热更新铁律

- **热更优先级高于整包，发版=源码+热包+整包三位一体**：热目录不绑 appVersion、全量升级不清除，旧热包会整体中和新 APK/exe 中的闸门类修复（2026-09-23 1.0.254 实战：修复 commit 之前签发的同日 -1 热包是旧码，新 APK 二次启动拉旧热包=墓碑拦截全失效）。凡修了热更白名单文件，**发整包前必须先重签推热包**（同日序号 `-n` 递增，如 2026.09.23-1→-2），push 后等部署并线上拉 version.json 核验，再打 exe/APK。
- Android 启动复验只验签+文件哈希，**不比对 versionCode**；旧 `filesDir/hot-update/current` 会持续遮蔽 APK assets 中白名单文件。
- 凡改动触达热更白名单（14 个渲染层文件，见 references 清单），发 APK 时**必须同步**：
  `node tools/generate-app-hotupdate.cjs -n <递增序号>`（在仓库根执行；`minAppCode` 默认继承上一包，勿乱抬）。
- 白名单**不含** `license/license-manager.js`（只随 APK/桌面整包分发）。
- 推送热包后等 Cloudflare Pages 部署，拉取 `https://tcm-prescription-system.pages.dev/hot-update/app-local/version.json` 确认 hotVersion 已更新。
- 告知用户：JS 修复需联网打开一次 App、彻底划掉重进；Java 修复必须安装新 APK。

## 8. 提交与推送（白名单精确暂存）

- **禁止 `git add .` / `git add -A`**。逐个路径 `git add` 源码文件；APK、`.gradle/`、`node_modules/`、构建产物一律不带。
- 提交前确认：`git status --short` 剩余项均为预期外文件；staged 计数与改动清单一致。
- commit message 用多个 `-m`（PowerShell 不支持 bash heredoc）。
- `git push`：pre-push 十二道校验必须全过；失败时读钩子输出修对应漂移（如 sync-all、跨版本 baseline `node tools/diff-cross-version.cjs --update-baseline --pair desk`），**禁止 --no-verify/--force**。
- 推送后核对 `git log origin/main -1` 与本地 HEAD 一致、工作区干净。

## 9. 收尾：经验沉淀

把本轮「结论 + 生效方式」合并进 `.trae/KNOWLEDGE.md` 对应章节并 commit + push（或提示用户双击 `同步推送经验.bat`）。只记可复用铁律，不记临时过程。
