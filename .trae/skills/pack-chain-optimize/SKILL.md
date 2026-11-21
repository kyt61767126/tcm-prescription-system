---
name: pack-chain-optimize
description: 深度优化打包/热更/版本号/发布链路，定位并消除不必要重打与版本噪音。Use when 用户要求 减少不必要重新打包、版本号深度优化、热更新优化、不要求版本号统一。Do not use for 打印布局或界面功能改动.
---

# Pack Chain Optimize

定位并消除惠康中医项目「打包 / 热更 / 版本号 / 发布」链路中的**不必要重打**与**版本噪音**。所有判定以可观测退出码为准，不靠感觉。

## 最快路径（30 秒定位）

1. 跑体检三连：`build-skip` 四端 + `hotupdate-stage -Mode Check` + `verify-version-display`
2. 哪一步暴露噪音 → 按下方排查清单 A–E 定位根因
3. 改完 → 编码铁律校验 → 回归验证集全过 → 沉淀 `KNOWLEDGE.md` → 同批 commit+push

## 排查清单（按优先级）

### A. 热更覆盖判定 — 能热更的不整包重打

- 命令：`powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-skip.ps1 -Check -Unit <unit>`
  - `<unit>` ∈ `cloud-desktop` / `cloud-app` / `local-desktop` / `local-app`
- 判定：exit `0` 可跳过（输出 `[SKIP]` 或 `[HOT-ONLY]`）；exit `1` 需打包
- 噪音源与已修点：
  - 可热更改动却判 `[BUILD]` → 查 `tools/build-skip.ps1` 的热更覆盖映射是否漏了该文件（`$hotChannelDefs` / `mapRoots` / 通道 `version.json` 的 `files` 清单）
  - `[HOT-ONLY]` 漏掉未提交脏文件 → 已修（HOT-ONLY 前先跑 `Get-DirtySources`，有脏改动降级 `[BUILD]`）
  - 改桌面 `build.bat` 误触发 APK 重打 → 已修（APP 单元 excludes 桌面端 `*.bat`/`*.ps1`）

### B. 热更签发幂等 — 序号只在真正签发时递增

- 命令：`powershell -NoProfile -ExecutionPolicy Bypass -File tools\hotupdate-stage.ps1 -Mode Check`
- 判定：exit `0` 三通道全最新（含仅元数据落后）；exit `2` 有通道内容落后需签发；exit `1` 失败
- 单通道检查：`node tools\generate-desktop-hotupdate.cjs -c <cloud|local> --check`
  - exit `0` 最新 / `2` 内容落后需重签 / `3` 内容一致仅 appVersion 落后（放行，不阻断）/ `1` 失败
  - `node tools\generate-app-hotupdate.cjs --check` 只有 `0/2/1`（设计上不比较 appVersion，不阻断）
- 噪音源与已修点：
  - 内容一致仅元数据落后却被重签 → 已修（rc=3 放行；`-IncludeMetaOnly` 才强制签）
  - 发布时需手动 `hot --yes` → 已修（打包后 `Invoke-PostPackHotCheck` + 发布前 `Invoke-PrePublishHotSign` 自动重签，幂等）

### C. 版本号噪音 — bump 只发生在真实重打内部

- 命令：
  - `powershell -File tools\verify-version-baseline.ps1`（HEAD 版本号不落后于现存产物）
  - `powershell -File tools\verify-version-display.ps1`（组内一致，跨组不要求统一）
- 判定：均 exit `0` 通过
- 噪音源与已修点：
  - skip 路径仍递增 versionCode/package.json → 确认 bump 在 `build.bat` 内部（真实重打才执行），不在 `one-click-pack` 外层；APP versionCode 失败自动回滚（`.build_vcode_prev`）
  - 离线桌面版本被 APP versionCode 绑死 → 已修（删除 `tools/sync-offline-desktop-version.ps1`，改用 `bump-version.ps1` 独立自增）；否则「只重打桌面时版本原地不动 → latest.json 不变 → 已装客户端收不到修复」
  - 跨端版本号强制相等 → 无残留（`verify-app-version-consistency` 只查组内；`check-manifest-version` 的 local/dingzhi 是**同一 APK 双 manifest key**，非跨端耦合）

### D. 打包精准到端 — 不误重打另一端

- 检查：`tools/one-click-pack.ps1` 的 `Invoke-SmartPack` 与 `Invoke-SinglePack` 的 AutoMode 映射
- 噪音源与已修点：
  - 只改 APP 却进桌面分支 → 已修（按 `$toBuild` 命中单元推导 `-Target desktop/app/all`）
  - 改构建脚本跨端误伤 → 见 A

### E. 发布体检门作用域 — 不被无关通道的阻断拖住

- 命令：`node tools\check-release-readiness.cjs --strict --scope=<cloud|dingzhi|all>`（默认 `all`，原全量行为）
- 判定：exit `0` 通过；非 `0` 有 BLOCK（HOT-STALE / REGRESS / HOT-MINAPP 等）
- 作用域映射：`cloud` → 仅 cloud 端 + desktop/cloud 通道；`dingzhi` → 仅 local 端 + desktop/local + app-local 通道
- 噪音源与已修点：
  - 发布云端被本地 HOT-STALE/REGRESS 硬阻断 → 已修（`--scope` 收窄；`Invoke-FullFlow` 传 `-Scope $Version`，`Invoke-PublishSelection` 传 `-Scope $Target`）
  - `HOT-MINAPP` 仅在 scope 含 local 时评估

## 编码铁律（改完必校验，否则解析崩/白屏）

- `.ps1` 必须 UTF-8 BOM：`$b=[IO.File]::ReadAllBytes($f); ($b[0] -eq 239 -and $b[1] -eq 187 -and $b[2] -eq 191)` 应为 `True`
- `.ps1` 语法：`$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $f).Path,[ref]$null,[ref]$e); $e.Count` 应为 `0`
- `.bat` 必须 CRLF（lone LF 计数 = 0）且 ASCII-only 或 UTF-8 + `chcp 65001`
- `index.html` 不得有 BOM（会白屏）
- 总校验：`powershell -NoProfile -ExecutionPolicy Bypass -File tools\compliance-check.ps1` 应 13 项全过

## 改动后回归验证集（全部跑一遍）

```powershell
# 版本展示与基线
powershell -NoProfile -ExecutionPolicy Bypass -File tools\verify-version-display.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools\verify-version-baseline.ps1

# 四端打包跳过判定
foreach ($u in 'cloud-desktop','cloud-app','local-desktop','local-app') {
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-skip.ps1 -Check -Unit $u
    "$u RC=$LASTEXITCODE"
}

# 热更三通道
powershell -NoProfile -ExecutionPolicy Bypass -File tools\hotupdate-stage.ps1 -Mode Check

# 发布体检（三作用域，确认收窄无误报）
node tools\check-release-readiness.cjs --strict --scope=cloud
node tools\check-release-readiness.cjs --strict --scope=dingzhi
node tools\check-release-readiness.cjs --strict

# 合规总检
powershell -NoProfile -ExecutionPolicy Bypass -File tools\compliance-check.ps1
```

## 沉淀规范（每轮优化后必做）

- 结论合并进 `.trae/KNOWLEDGE.md` 对应章节（第 5 章打包规范 / 第 89 章版本热更发布链路），**合并而非追加**
- commit message 必须含「生效方式」段落，写清云端网页 / 云桌面 / 云APP / 离线桌面 / 离线APP 五端各自是否需重打
- 与代码同批 commit + push（Cloudflare Pages 部署依赖 GitHub 推送），无需等用户要求
- 改 HTML 前后跑 `check-interface.bat`；多端同步清单见 KNOWLEDGE 第 2 章（2 权威源 + 全自动传播链）

## 退出码速查

| 脚本 | 退出码 | 含义 |
|---|---|---|
| `build-skip.ps1 -Check` | 0 / 1 | 可跳过 / 需打包 |
| `hotupdate-stage.ps1 -Mode Check` | 0 / 2 / 1 | 全最新 / 有通道落后 / 失败 |
| `generate-desktop-hotupdate.cjs -c X --check` | 0 / 2 / 3 / 1 | 最新 / 内容落后 / 仅元数据落后(放行) / 失败 |
| `generate-app-hotupdate.cjs --check` | 0 / 2 / 1 | 最新 / 内容落后 / 失败 |
| `check-release-readiness.cjs --strict` | 0 / 非0 | 通过 / 有 BLOCK |
| `verify-version-display.ps1` | 0 / 1 | 组内一致 / 组内 FATAL |
| `verify-version-baseline.ps1` | 0 / 1 | 通过 / 失败 |

## 不要做（anti-pattern）

- 不要为「看起来统一」而强制跨端版本号相等 —— 用户明确不要求
- 不要在 skip 判定之前 bump 版本号（bump 必须在真实重打内部）
- 不要移除**组内**版本一致性校验（端内仍校验，跨组才放行）
- 不要放松 in-scope 的 BLOCK 拦截 —— `--scope` 收窄只隔离**无关**阻断
- 不要改 HTML 结构/CSS 来凑优化 —— 界面改动走 `check-interface.bat` 流程，禁止改 HTML 结构/CSS
