---
name: electron-startup-perf
description: 惠康中医桌面端（离线/云桌面 Electron）启动与登录链路的打点计时方法——dev Electron + Playwright 探针、双通道标记、429 限流间隔、夹具与限时杀进程。用于"启动慢/登录框弹出慢/点击进系统慢"的先量后改优化，不用于功能回归（用 desktop/e2e/run-e2e.cjs）或 APK/云Web 测速。
---

# electron-startup-perf

惠康中医桌面端启动/登录性能的标准化打点流程。目标：**不再每次重写一次性探针**，并避开本仓库已踩实的坑（KNOWLEDGE §52.4 起源，本会话搭建 6 次后固化）。

## 铁律（违反则数据无效或污染生产）

1. **fused 最终产物不可自动化**：`dist\win-unpacked\<exe>` 经 final-verify 盖章后关闭远程调试管道，Playwright `_electron.launch` 会**永久挂到 180s 超时**。性能测量只打 **dev Electron**：`app_project/db-offline/desktop/node_modules/electron/dist/electron.exe`，`args:['.']`，`cwd` = desktop 目录。
2. **E2E 旁路双条件**（main.js L138-156）：env `BNZC_E2E=1` **且** exe 同级目录存在 `e2e-enabled.marker`。dev 模式 marker 必须写到 `node_modules/electron/dist/e2e-enabled.marker`（= `path.dirname(process.execPath)`）。用完**必删**（try/finally + 进程退出钩子双保险）。
3. **userData 必须隔离**：env `BNZC_E2E_DATA=<每轮唯一临时目录>`（`os.tmpdir()/bnzc-perf-<pid>-<ts>`），否则污染真实诊所数据、撞单实例锁。不要复用固定目录（上一轮热更/缓存会让测量失真）。
4. **授权端点 HTTP 429**：每次冷启动的在线裁决（gate）都打生产授权服务器，连发触发限流后数据作废。**真实 gate 测量的启动间隔 ≥ 20s**（用探针 `--gap 20`）；gate 失败/走离线宽限的轮次作废重测。
5. **限时杀进程**：`app.close()` 可能被 before-quit/托盘拦截永不 resolve → 5s 超时 + `app.process().kill()` + 轮询 exitCode（≤3s）确认真退出，否则下一轮撞单实例锁。直接抄 `scripts/dev-startup-probe.cjs` 的 `killApp`。
6. **先量后改**：先跑基线拿到分段耗时再动手；优化后同夹具同条件复测，至少 3 轮取分布（首启受 Defender 实时扫描影响偏大，可弃首轮但要注明）。
7. **插桩是临时的**：PERF 标记只加在测量期间，测完**逐行还原** login.js/main.js，不提交、不进热包。渲染端与主进程是**两个时钟、两个通道**，必须分别抓（见下）。
8. 性能探针脚本放本 skill `scripts/` 或系统临时目录；**不要**放进 `desktop/e2e/`（那是 pre-fuse 6 条功能回归，build.bat 红线依赖它）。

## 环境事实

- 离线桌面根：`app_project/db-offline/desktop`（Electron 35，playwright ^1.62.1 已装在该目录 node_modules）。云桌面换根：`app_project/db-yunduan/cloud_desktop`（探针 `--desktop cloud`）。
- 旁路只跳过：远程调试开关、服务端试用登记（main.js L527，返回 offline 宽限）、未签名 exe 完整性自检上报（L942，防止把构建机 machineId 报封锁——**绝不要删掉这段保护去测签名包**）。**license gate 在线裁决不跳过**——测真实 gate 耗时必须用真实已授权夹具（见下）。
- 渲染端登录：`desktop/electron/login.html` + `login.js`（handleLogin 点击链）；主进程：`desktop/electron/main.js`（登录成功→预建/显示主窗→reveal）。

## 双通道标记协议

插桩统一打 `[PERF]` 前缀，探针自动按通道归集：

- **渲染通道**（login.js handleLogin）：`console.log('[PERF] r:<阶段> d=' + performance.now())`，建议 5 点：`click0`（点击瞬间）、`localCheckDone`（本地校验后）、`gateStart`、`gateDone`、`loginEmit`（IPC 发登录前）。
- **主进程通道**（main.js）：`console.log('[PERF] m:login-success wall=' + Date.now())`、`m:reveal`（遮罩消失/主窗 show 完成）。
- **跨通道时差以探针墙钟为准**：渲染 performance.now() 与主进程 Date.now() 不是同一时钟。探针对每条标记记录**自己进程的 Date.now() 到达时间**，点击瞬间探针也记一次墙钟；跨进程间隔（如 loginEmit→login-success）只用探针墙钟算。
- 用户感知终点=遮罩消失（reveal），不是主窗 DOM ready。

## 夹具

- **只测"启动→登录窗出现"**：出厂态即可，无需夹具。
- **测"点击→进系统"全程**：需要可登录用户。F2 之后手写裸 config.json 会被判 `config_tampered`（登录窗都不出现），夹具必须与 `desktop/e2e/run-e2e.cjs` 的 `prepareUserdata` **同构**：stub electron 模块后 require 仓库根 `shared/license/license-manager.js`，`lm.signConfig(config)` + `lm.backupUserAccounts(config,{proven:true})` 写进 BNZC_E2E_DATA。已激活机另需 license.dat 等授权文件（从真机 userData 复制，勿提交）。
- 登录 UI 两个时序坑（直接抄 run-e2e.cjs）：密码框初始 `readonly`，必须先 `focus('#loginPassword')` 等 readonly 移除再 fill，否则死等 30s；未注册机有注册引导 overlay，fill 前先按其 `dismissRegisterOverlay` 关闭。

## 标准流程

1. 明确假设与测量段（如"点击后 gate 在线裁决占比"），选好夹具与通道标记点。
2. 临时插桩 login.js/main.js 的 `[PERF]` 标记。
3. 跑基线：`node .trae/skills/electron-startup-perf/scripts/dev-startup-probe.cjs --desktop offline --gap 20 --wait-ms 12000`；需点登录加环境变量 `PROBE_USER=<名> PROBE_PWD=<码>`（须已配好签名夹具目录 `PROBE_USERDATA`）。
4. 至少 3 轮（真实 gate 每轮间隔 ≥20s），记录各段分布；429/离线宽限轮作废。
5. 实施优化 → 同条件复测对比 → 结论写进 `.trae/KNOWLEDGE.md`（结论 + 生效方式）。
6. **还原全部插桩**；临时探针不留仓库（本 skill 的模板除外）；marker 确认已删。

## 不要做

- 不要试图 attach fused 安装包（CDP 9333 那套 connectOverCDP 只对手动带 `--remote-debugging-port` 启动的包有效，且盖章包不开管道）。
- 不要为提速测量关闭完整性自检/签名校验等安全闸门；发现闸门本身耗时，改"后移/并行"也要过安全评审（参照 §52.4 批次 A、§52.5 批次 D 的评审模式）。
- 不要把含真实手机号/授权码/密码的夹具写进版本库；用临时目录 + 环境变量。
