# P3-A 桌面主进程操作层集中收口方案（对话框域 + 死代码清理 + 崩溃韧性）

## Context（为什么做）

延续项目"集中统一"收口系列（已验证三轮：P0-1 更新域 / B2-1 文件域 / B2-2 窗口域，均随今日 245/247 整包发布）。本轮目标"稳定高效安全"三维度落地：

| 维度 | 现状（已勘察核实） | 本轮动作 |
|---|---|---|
| 集中统一 | 对话框域双端同体重复 ~230 行（dialog:alert-sync / confirm-sync / prompt + prompt-preload.js 双端各一份），人工双刷有漂移风险 | 抽取 `shared/desktop-dialog.cjs` 单一权威源 |
| 稳定 | 双端 main.js 仅有 uncaughtException 兜底，**无 render-process-gone / child-process-gone**——渲染进程崩溃 = 白屏无恢复 | 新增崩溃自愈：自动重建 + 连续崩溃熔断 |
| 精简 | packaging-read-config / write-config / done 三个 handler 渲染层与 preload **零引用**（全仓 grep 验证）= 死代码 | 删除（双端 6 处 + 2 声明 + 孤儿 HTML） |

**不动清单**（风险控制）：渲染层 6 index.html 巨石（界面保护铁律）、Java 层（刚 E2E 稳定）、site-admin（刚收口）、license 域（双端许可模型不同，保持独立）、login.js（P3-C 单独评估）。

## 改动内容

### 1. 对话框域收口（sync-all 新 Group 16）

**权威源**：`shared/desktop-dialog.cjs`（新建，工厂模式对齐 [desktop-fs-ipc.cjs](file:///d:/trae_projects/kyt-zy/shared/desktop-fs-ipc.cjs) 依赖注入风格）：

```js
function createDesktopDialogIpc({ ipcMain, dialog, BrowserWindow, getMainWindow, promptTitle }) {
    // dialog:alert-sync（on+sendSync，event.returnValue=true 契约原样保留）
    // dialog:confirm-sync（on+sendSync，returnValue 0/1 契约原样保留）
    // dialog:prompt（handle：prompt 小窗创建 + prompt:submit/cancel 临时注册与
    //   removeListener 清理，防泄漏逻辑原样；窗口 title 取注入的 promptTitle）
    // PROMPT_HTML_PATH / PROMPT_PRELOAD_PATH = path.join(__dirname, ...) 同目录解析
}
```

- 迁移源：离线 main.js:1439-1552、云端 main.js:1175-1288（字节级同体，仅 prompt 窗 title 差异 → 参数化）
- 双端接线点 = 原对话框域位置整块替换：离线注入 `promptTitle:'惠康中医诊所管理系统 V1.0.0'`，云端注入 `'请输入'`
- `prompt-modal.html` 收为 shared 权威源（双端仅 `<title>` 一行差异 → 统一为"请输入"，小输入窗标题无功能影响）；`prompt-preload.js` 同收 shared 权威源
- **删除** `tools/prompt-preload.js`（全仓零引用的第三份重复）
- 登记到 [sync-all.ps1](file:///d:/trae_projects/kyt-zy/tools/sync-all.ps1) Group 16（3 文件 → 2 个 electron 目录）+ [copy-consistency.cjs](file:///d:/trae_projects/kyt-zy/tools/copy-consistency.cjs) 新组（硬哈希门）

### 2. 死代码清理

- 离线 main.js:1827/2282/2294、云端 main.js:1399/1646/1658：packaging×3 handler 删除
- 双端 main.js:40 `let packagingWindow = null;` 成对删除
- `shared/packaging-config.html` 孤儿文件删除（无窗口加载、无分发组、不在 build.files）
- `getWritableConfigPath` 保留（config:update 等活跃 handler 在用）

### 3. 崩溃韧性（sync-all 新 Group 17）

**权威源**：`shared/desktop-crash-guard.cjs`（新建）：

```js
function createDesktopCrashGuard({ app, dialog, logger,
    createMainWindow, createLoginWindow,
    getMainWindow, setMainWindow, getLoginWindow, setLoginWindow }) {
    // app.on('render-process-gone')：
    //   - clean-exit 过滤（正常关窗不误报）
    //   - logger.crash('render-process-gone', ...) 落 userData/logs/app.log
    //   - 60s 滑窗内 >=3 次 → 熔断：showMessageBoxSync 提示 + destroy 旧壳 →
    //     依赖 window-all-closed 自然退出（不抢跑 quit，保住日志写入）
    //   - 未达阈值 → destroy 旧壳 + 重建（登录态由渲染层 localStorage 自恢复）
    //   - prompt 小窗等非主壳崩溃：仅记日志不重建
    // app.on('child-process-gone')：GPU/Utility 自愈型，仅审计日志
}
```

- 接线位置：双端 main.js 的 B2-2 `createDesktopWindows` 解构之后（依赖就绪处）
- 窗口经访问器注入，不改 desktop-windows.cjs（避免模块成环）

## 验证

1. `node --check`：双端 main.js + shared 新模块 + 双端 electron 副本
2. 门禁：`sync-all.ps1`（Group 16/17 全绿）→ `copy-consistency.cjs` 0 失败 → `check-interface.bat` 6 OK（渲染层零改动应零漂移）
3. 双端开发模式 `electron .` 手测：alert（退出确认）、confirm（删除确认）、prompt（用户管理编辑：title 文案正确 + 提交/取消/X 三路径）
4. 崩溃韧性（不需真崩溃）：E2E 旁路（BNZC_E2E=1）下 `executeJavaScript('process.crash()')` 注入 → 验证自动重建、app.log 落 CRASH 记录、3 次触发熔断弹窗；正常关窗日志无 CRASH 误报
5. 双端"一键打包.bat"严格模式全绿 + 装包冒烟
6. 收尾：KNOWLEDGE.md 沉淀条目二十一 + commit/push（十道门）

## 生效方式

纯主进程改动（不在热更白名单）→ **云桌面/离线桌面需重打包发新整包生效**（随下轮发版）；云端网页/APP/服务端零影响。

## 后续路线图（不在本轮，逐轮验证后推进）

- **P3-B**：用户域（user:change-password/rename/add/login-success/get-current-user）+ 生命周期杂项域（set-auto-start/quit-app/logout/show-message-box/print-prescription/config/auth 加解密）收口——双端合计约 700 行同体重复
- **P3-C**：登录域 login.js 双端统一（1249/1462 行，先做差异审计再定方案）
