# 历史踩坑汇总
> 记录项目开发过程中遇到的典型问题、根因分析和解决方案
> 按严重程度排序，★越多越严重
> 最后更新：2026-08-12

---

## P0 - 严重Bug（导致功能不可用）

### 1. `_cloudReachable is not defined` 登录失败 ★★★★★
**日期**：2026-08-12
**影响**：[云端] [网页/桌面] [标准版/机构版]
**现象**：点击登录按钮后控制台报错 `_cloudReachable is not defined`，登录流程中断

**根因**：
1. `site-admin/index.html` 内联 `<script>` 中定义了 `let _cloudReachable` 变量，但同一脚本中还定义了 `cloudFetch()` 函数引用该变量
2. JavaScript TDZ（Temporal Dead Zone）问题：`let` 变量存在声明前不可访问的特性
3. 多个 `cloud-api.js` 文件和内联脚本各有独立的 `_cloudReachable`，作用域隔离导致访问失败
4. `site-admin/index.html` 的内联 `cloudFetch` 覆盖了 `cloud-api.js` 中的同名函数

**修复**：
- 所有 `cloud-api.js` 文件：`_cloudReachable` → `window._cloudReachable`
- `site-admin/index.html` 内联脚本：`let _cloudReachable` → `window._cloudReachable` 全局属性
- 所有 `updateModeStatus()` → `window.updateModeStatus()`
- 顶部添加防御性检查：`if (typeof window._cloudReachable === 'undefined')`

**教训**：
> 跨脚本全局变量必须通过 `window` 对象访问；`let`/`const` 变量不会成为 `window` 属性；多脚本环境下要警惕作用域隔离

---

### 2. 授权绑定校验失败 ★★★★★
**日期**：2026-08-10
**影响**：[离线/云端] [桌面] [标准版/机构版] 全部4个桌面版本
**现象**：激活成功后，下次启动弹出"授权绑定校验失败: 诊所名不匹配"

**根因**：激活流程未同步更新 `config.json` 的 `clinicName` 字段，导致 `license.dat` 中绑定的诊所名与 `config.json` 默认诊所名不一致

**修复**：激活成功后自动同步 `clinicName` 到 `config.json`，涉及12个文件（4× `license-manager.js`、4× `activate.js`、4× `main.js`）

**教训**：
> 状态同步必须完整，激活→license→config.json 三者必须保持一致

---

### 3. 激活成功后注册向导不弹出 ★★★★★
**日期**：2026-08-10
**影响**：[云端] [桌面] [标准版/机构版] YJ/YB
**现象**：管理员审核通过→客户端重启→输入用户名密码提示错误→无注册入口

**根因**（3个bug叠加）：
1. `checkFirstRun()` 硬编码 `return;` 跳过所有检查
2. `performAutoActivation()` 错误设置 `firstRunWizardDone='1'`
3. `saveLicense()` 未同步 `adminName→doctorName`

**修复**：6个修复点，涉及 `login.js`（2个版本）和 `activate.js`（2个版本）

**教训**：
> 关键流程（激活→注册→登录）必须端到端测试；多个bug叠加时要逐一排查每个环节

---

### 4. 审核通过后客户端无法获取license ★★★★★
**日期**：2026-08-10
**影响**：[云端] [桌面] [标准版/机构版] YJ/YB
**现象**：客户提交激活请求后，轮询超时或关闭窗口，管理员审核通过时客户端无法获取license

**根因**：`requestId` 仅存在内存中，窗口关闭或重启后丢失

**修复**：`requestId` 本地持久化 + 激活窗口自动恢复（8个文件）

**教训**：
> 异步流程的中间状态必须持久化，不能仅存在内存中

---

## P1 - 重要Bug（导致功能异常但可绕过）

### 5. toISOString() 返回UTC时间导致日期显示昨天 ★★★★
**日期**：2026-08-09
**影响**：[离线/云端] [桌面/APP/网页] [标准版/机构版] 全部7个 index.html
**现象**：程序显示昨天的日期，处方日期、处方编号、历史统计均受影响

**根因**：`new Date().toISOString()` 返回UTC时间，UTC+8时区00:00-07:59之间返回前一天

**修复**：全部替换为 `toLocaleDateString('sv-SE')`，涉及7个文件每文件8处

**教训**：
> 前端日期获取必须使用本地时区方法，`toISOString` 仅用于序列化

---

### 6. 版本标识8处遗漏 ★★★★
**日期**：2026-08-09
**影响**：[离线/云端] [桌面] [标准版/机构版]
**现象**：修改版本后打包，桌面版登录框仍显示错误版本

**根因**：桌面版启动时显示 `electron/login.html` 而非 `index.html`；`<title>` 标签决定窗口标题栏

**修复**：建立8处检查清单，每次修改后全量验证

**教训**：
> 桌面版有两套登录界面（login.html + index.html），必须同步修改；窗口标题由 `<title>` 决定

---

### 7. license-manager.js config.json 路径分叉 ★★★★
**日期**：2026-08-09
**影响**：[离线/云端] [桌面] [标准版/机构版] NSIS安装版
**现象**：NSIS安装版下license校验失败

**根因**：`getLocalClinicName`/`getLocalDoctorName`/`verifyConfigIntegrity` 使用 `getExeDirectory()` 而非 `getWritableDir()`，读不到 `main.js` 写入的 `config.json`

**修复**：4个文件×3处路径修正

**教训**：
> Electron 打包后 `getExeDirectory()` 和 `getWritableDir()` 可能不同步，状态文件应写入可写目录

---

## P2 - 一般Bug（影响体验）

### 8. win-unpacked exe 时间戳不一致 ★★★
**日期**：2026-08-09
**现象**：`win-unpacked` 内的 exe 修改时间显示 electron 原始编译时间

**根因**：`fs.renameSync` 保留原文件时间戳

**修复**：`renameSync` 后用 `fs.utimesSync` 更新时间戳

---

### 9. 版本显示不一致 ★★★
**日期**：2026-08-09
**现象**：LB/YJ/YB 显示版本与实际不符

**根因**：多版本从同一模板复制，版本标识分散多处，复制后只改部分位置

**教训**：
> 多版本复制是问题根源，必须建立检查清单，不能依赖记忆

---

## P3 - 教训与模式总结

### 10. Edit 操作静默失败 ★★
**问题**：并行 Edit 同一文件时部分操作静默失败

**对策**：Edit 后立即用 Grep 验证修改生效

### 11. 多文件联动修改易遗漏 ★★
**问题**：修改 `cloud-api.js` 需同步 10 个文件

**对策**：建立同步清单，修改前列出所有需要同步的文件

### 12. 功能验证不完整 ★★
**问题**：修复只验证了一条路径，未覆盖所有环境

**对策**：每次修改后按版本矩阵（4版本×3平台）验证

---

## 防踩坑速查表

| # | 检查项 | 命令/方法 |
|---|--------|----------|
| 1 | 全局变量 window. 前缀 | `Grep '_cloudReachable\|updateModeStatus'` 检查裸引用 |
| 2 | 日期 toISOString 残留 | `Grep 'toISOString().split\|toISOString().slice'` |
| 3 | 版本8处标识 | `Grep '标准版\|机构版'` 全量检查 |
| 4 | config.json 路径一致性 | `Grep 'getExeDirectory.*config'` |
| 5 | cloud-api.js 同步 | 对比所有副本文件大小和内容 |
| 6 | Edit 后验证 | Edit 操作后立即 Grep 验证 |
| 7 | Git 推送冲突 | `git pull --rebase` 而非 `git pull` |
