---
name: electron-domain-extract
description: 把云/离两份 Electron main.js 中同域的内联 IPC 块等体抽为 shared 工厂模块并登记分发链。当用户要求抽取/收口某域（如 license、打印、对话框、文件）主进程 IPC、消除 main.js 人肉双改时使用。不适用纯渲染层改动或新增 IPC 功能。
---

# Electron 域 IPC 抽取（双桌面 main.js → shared 工厂）

把云桌面（app_project/db-yunduan/cloud_desktop）与离线桌面（app_project/db-offline/desktop）两份 electron/main.js 中同一域的内联 IPC 块，**等体**抽为 `shared/<name>.cjs` 工厂模块，收口主进程人肉双改。这是结构搬迁，不是功能变更——除非用户明确要求，禁止夹带任何行为修改。

权威背景与铁律以 `.trae/KNOWLEDGE.md` 为准（开工先 Read）。若域属于授权链（license/激活/试用/闸门），**同时遵守 `license-chain-release` 技能**（多重独立审查等）。

## 1. 开工门禁

1. `git status` + `git log --oneline -1`，确认无意外未提交改动（`promo/` 是长期未跟踪目录，始终不纳入提交）。
2. 若涉及授权链：`git remote get-url origin` 必须是 `github.com/kyt61767126/tcm-prescription-system.git`。

## 2. 侦察：定位边界 + 依赖盘点

运行域侦察脚本（块结束按行首 `});` 切片，输出同构/差异/仅xx清单、整块行范围与改前哈希）：

```powershell
node .trae/skills/electron-domain-extract/scripts/analyze-domain-handlers.cjs --prefix <域前缀，如 license:>
node .trae/skills/electron-domain-extract/scripts/analyze-domain-handlers.cjs --all   # 全部 handler（勿传空串，PowerShell 会吞）
```

两端常常**不是字节同构**（典型 license 域：云 27 / 离 38）。对输出逐一判定：

- **同构块**：可直接共用一份。
- **差异块**：区分「注释差异」（取一端版本，在生成器注释中记录）与「行为差异」（必须在工厂内用 `if (productClass === 'cloud') {...} else {...}` 两版都保留）。
- **仅一端存在的块**：在工厂内用条件块包住（`productClass` 门控注册），不要让对端注册。

同时盘点依赖面（grep 两端 main.js）：

- 域对象来自文件顶部 `const xxxManager = require('./xxx')`；`mainWindow` 是外层 `let`。
- 函数声明（`function getWritableConfigPath`、`async function hashPassword` 等）会提升，可在原块1位点注入；`const`/`let` 绑定不提升，注意调用点 TDZ。
- handler 内联 `require('electron')`/`require('fs')` 保持原样，不提取到模块顶层。

## 3. 改前哈希审计（强制）

把改前各块的行范围 + SHA256 固定为基线（侦察脚本已输出整块哈希；多区域域按区域分别记录，如 license 域有主块+注册块两条）。基线写进新模块头注释与 KNOWLEDGE，供复审与未来取证。

## 4. 生成 shared 模块（脚本组装，禁止手抄）

用临时生成脚本（放 `tools/_tmp/`）从**改前 main.js 字节切片**组装 `shared/<name>.cjs`：

1. 结构：头注释（域说明、改前哈希、注入面、分发组号、重打 exe 提示）+ `'use strict';` + `function createXxxIpc(options) { const {...} = options; ... }` + `module.exports = { createXxxIpc };`。
2. **唯一允许的机械变换**：handler 内 `mainWindow` → `getMainWindow()`（惰性访问器，对齐 desktop-windows/desktop-dialog 的 B2-2 范式；**禁止把窗口提前 const 缓存**）。生成器打印每个通道的替换次数以便审计。
3. **handler 切片保持原缩进原样拼接**，禁重排/禁重缩进——后续复审靠归一化后逐字节哈希比对。
4. `node --check shared/<name>.cjs`，再写校验脚本：从生成的模块重新提取各 handler，与「改前切片+机械变换」逐一比对，必须全等（含反向检查：模块内无多余 handler）。
5. 安全类已移除的 IPC（如 `license:set-trial-days`）**故意不注册**，在模块内留注释说明。

注入面规则：通用依赖两端都传；仅某端门控块内引用的依赖（如 fse/safeStorage/path/getWritableConfigPath/hashPassword/isTrialDenied）对端可不传——但必须确认对应分支在对端进程中完全不执行；`typeof xxx === 'function'` 守卫的引用可不传。

## 5. 接线 main.js（替换为一行工厂调用）

1. 写锚点 splice 脚本按固定行号替换；先 `node -e` 核对锚点行内容无误。
2. **多区间替换时 ranges 必须原地排序**（`ranges.sort(...)`，不是 `[...ranges].sort()`）并从后向前 splice，否则行号漂移会误删后续代码——这是实战踩过的坑。
3. splice 脚本**不具幂等性，只能运行一次**。若误跑：`git checkout -- <file>` 恢复后重做；恢复哪个文件就只重接哪个文件（另一个可能已正确，重跑会再次误切）。
4. 接缝标准：块前后空行完整，相邻 IPC 与文件尾（`require('./desktop-print.cjs')`、`app.on('window-all-closed')`）无损；两端 `node --check`。
5. 若发现 preload 死桥（main 已不注册但 preload 仍暴露、渲染层 grep 零调用），一并删除对应行并 grep 确认无调用残留。

## 6. 分发链登记（三处逐一查）

1. `tools/sync-all.ps1`：新增 Group 定义（目标数组）+ 调用段。**组号必须先 grep `Group \d+` 确认最大编号再顺延**（如 Group 20 已被 video-recorder 20a/20b 占用）。
2. `tools/copy-consistency.cjs`：新增组（authority=`shared/<name>.cjs`，copies=2 electron 副本硬哈希门）。
3. `package.json`：确认 build.files 的 `electron/**/*` 通配已覆盖新文件（既有系列模块均无需改）。
4. **每次编辑 sync-all.ps1 后立即校验 BOM**（Edit 工具会剥离 EF BB BF 导致脚本无法解析）：

```powershell
node -e "const fs=require('fs');const b=fs.readFileSync('tools/sync-all.ps1');if(!(b[0]===0xEF&&b[1]===0xBB&&b[2]===0xBF)){fs.writeFileSync('tools/sync-all.ps1',Buffer.concat([Buffer.from([0xEF,0xBB,0xBF]),b]));console.log('BOM restored')}else console.log('BOM intact')"
```

5. 分发与终验：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/sync-all.ps1            # 分发
powershell -NoProfile -ExecutionPolicy Bypass -File tools/sync-all.ps1 -VerifyOnly # [OK] All files are in sync
node tools/copy-consistency.cjs                                                  # ALL PASS
```

注意：`check-ipc-consistency.js` 是文本并集扫描，**不识别 productClass 条件注册**——会把同文件内对端分支文本列成 INFO「冗余」（非失败）；真实注册面以 stub 冒烟精确断言为准。

## 7. 验证（静态门禁 + 真实直启）

1. 创建永久冒烟 `tools/<name>-smoke.cjs`（零依赖 stub electron + 域对象），至少覆盖：注册面精确集合（各端数量与通道名单）、分叉两版行为、fail-closed 异常返回、端专属回路。要求 `node tools/<name>-smoke.cjs` 全过。
2. 静态门禁：`node tools/check-ipc-consistency.js`、`node tools/biz-smoke.cjs`、`node tools/smoke-runtime.cjs --all`、`check-interface.bat`（无 HTML 改动也应 6 OK）。
3. **真实 Electron 直启回归**（主进程改动必做，免重打包）：dev electron 直启源码目录，`BNZC_E2E=1` + 在 `node_modules/electron/dist/` 放 `e2e-enabled.marker` + `BNZC_E2E_DATA` 指向临时 userData；启动后约 13s 检查进程存活与主窗口标题正常（云端到激活窗、离线到登录窗）；日志无 SyntaxError/Cannot find module。收尾 `taskkill /PID <pid> /T /F`，删 marker 与临时目录。

## 8. 独立审查（新上下文，禁止自审）

- 普通域：至少 1 个独立只读审查（等体性、注入面、接缝、登记）。
- 授权链/高风险域：按 `license-chain-release` 派多个互不通气的子代理（2 功能 + 1 安全并行），分歧取证据链更完整一方。
- 审查通过后再按建议订正注释类问题；订正后必须重新分发 + 全量复验。

## 9. 沉淀、提交、回报

1. 把结论合并进 `.trae/KNOWLEDGE.md`（产出、改前哈希、组号、冒烟结果、踩坑、生效方式）。
2. 删除 `tools/_tmp/` 本轮临时脚本。
3. 精确路径 `git add`（**禁止 `git add .`，排除 promo/**），提交；`git push origin main`（pre-push 十三道门，禁止 --no-verify）。
4. 回报五端生效方式：**主进程域热更不可达——云/离桌面需各自重打 exe**（多批抽取可攒齐后一次双桌面重打）；云端网页/双 APP/鸿蒙不受影响。
