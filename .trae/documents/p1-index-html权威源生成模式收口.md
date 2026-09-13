# P1：index.html 权威源生成模式收口（2 权威源 + 全自动传播链）

## Context（为什么做）

KNOWLEDGE §19 第三步的愿景是「6 份 index.html 收口为由单一权威源生成，改界面只改一处」。实测差异结构证明「单一」不可行也不该做：

| 副本对 | 差异量 | 性质 |
|---|---|---|
| public ↔ 云桌面 | 6 行 | 端配置块，**已由 sync-html.ps1 自动生成** |
| public ↔ 云APP assets | 33 行 | 死副本漂移（WebView 壳实载线上 public，MainActivity 明示不加载本地 assets）+ 一处 escapeJs 语法错误 |
| public ↔ 离线桌面 | 3132 行 | **深度版本分叉**（云端 D1 同步/多设备/遥测 vs 本地 IndexedDB/试用版/离线激活）——两个产品形态，不可参数化 |
| 离线桌面 ↔ index-app | 389 行 / 37 块 | 形态分叉（登录两行布局 CSS、剂数 DOM 移行、移动端媒体查询、Android 桥接） |
| index-app ↔ 离线APP assets | 0（字节一致） | **已由 build-app.bat 自动拷贝** |

**目标架构**：「改一处」从 6 处收敛为 **2 处**（public=云端权威源，db-offline/desktop/index.html=离线权威源），其余 4 份全部生成/拷贝；跨版本功能移植保持人工，但由漂移守卫红灯兜底。

**双向欠债（实施时必须处理）**：index-app 侧存在离线桌面缺失的更新修复（登录路由统一 09-03 / 密码自愈 09-06 / 激活码核验 09-11）——实施 B 前逐条审查，属共享修复的先反向移植进离线桌面（差异块随之消失），真正 APP 专属的才进变换表。index-app 的 escapeJs 语法错误由 B1→B2 流程顺带修复。

## 已定决策（用户拍板）

1. 云APP assets：**回归自动链**（重新加回 sync-html.ps1 / html-sync-check.ps1 $Targets）
2. 范围：**A+B+C+D 全量**

## Phase A：云APP收编（1 commit）

- [sync-html.ps1](d:/trae_projects/kyt-zy/tools/sync-html.ps1) `$Targets`（L47）追加 `app_project/db-yunduan/cloud_app/app/src/main/assets/public/index.html`；[html-sync-check.ps1](d:/trae_projects/kyt-zy/tools/html-sync-check.ps1) 同步扩容；两文件头注释更新。
- 云APP端配置块（EDITION='personal'/PRODUCT_NAME='惠康中医-本地'/APP_MODE='auto'）与 public 同值——生成器按机制自动保留，属有意设计，KNOWLEDGE 注明。
- 运行 `powershell -NoProfile -ExecutionPolicy Bypass -File tools\sync-html.ps1`；验证：html-sync-check exit 0、`git diff --stat` 仅该文件、Grep `prescriptionNo \|\| '` 归零（语法错误消灭）。
- pre-push/CI 零改动（①②门自动覆盖新 target）。APK 无需立即重打包（死副本治理，下次发版自然携带）。

## Phase B：离线APP生成器（2-3 commit）

**B0 反向移植审查**：对 3 处 index-app 独有修复逐条审查——共享修复反向移植进 [desktop/index.html](d:/trae_projects/kyt-zy/app_project/db-offline/desktop/index.html)（离线权威源），APP 专属的留作变换表条目。

**B1 变换表 + 生成器 + 字节级复刻**：
- 新建 `tools/index-app-transforms.cjs`：导出有序数组 `{id, desc, find, replace}`；find/replace 为字符串（join('\n') 整行块）或字符串（巨型单行内最小子串，如整个 `</head><body>` 是一行的情形）。**一律字面子串匹配**（内容含正则元字符/反引号，禁用正则）；逐条 `indexOf === lastIndexOf` 硬校验（mustReplaceOnce 模式，失配 exit 1 并输出条目 id/desc/find 前 80 字符/修复指引）。
- 新建 `tools/sync-index-app.cjs`：读离线桌面权威源 → 顺序应用变换（全量校验通过才落盘）→ 同一 buffer 双写 index-app.html 与 assets 副本 → 自校验 SHA256 相等；支持 `--verify-only`。
- 辅助脚本 `tools/_tmp/extract-transforms.cjs` 从 `tools/_tmp/p1-offline-desktop-vs-app.diff` 半自动提取 37 条（同行数差异做公共前后缀裁剪取最小子串，唯一性自动验证）。
- **验收门：首次生成与现存 index-app.html 字节级一致**（`node tools/sync-index-app.cjs` 后 `git status --porcelain` 为空）+ 重复运行幂等 + html-sync-check ③节绿。
- 接线 [sync-all.ps1](d:/trae_projects/kyt-zy/tools/sync-all.ps1) 新增 Group 13（照 Group 11 子进程模式）→ pre-push ②/CI 自动生效；build-app.bat 不动。

**B2 修复流灌**：删除变换表中「把 desktop 修复改回旧 bug」的 escapeJs 条目 → 重跑生成器 → index-app 获得修复；`new Function` 内联语法快检。

**防呆铁律**：变换表锚点禁止落入 `>>>USER-STORE/USER-ADMIN<<<` 标记块（实测无 hunk 覆盖）；工作流顺序 = 先 sync-shared-blocks 再跑生成器；禁止直接改 index-app/assets（只改权威源+变换表）。diff-index-app.cjs 降级为语义级冗余守卫（--quiet）。

## Phase C：跨版本漂移守卫（1 commit）

- 新建 `tools/diff-cross-version.cjs` + `tools/.cross-version-baseline.json`（public ↔ 离线桌面）。复用 [diff-index-app.cjs](d:/trae_projects/kyt-zy/tools/diff-index-app.cjs) 的函数提取算法。
- 三层基线：**Tier A** 函数名单差集冻结（~30 项）；**Tier B** 同体函数哈希清单（~184 项，「云端修了离线漏改」的主捕获器，任一单边改动红灯）；**Tier C** 已分叉函数白名单（~45 项仅记名）。`--update-baseline` 重冻结；Tier B→C 迁移须人工确认。
- 先挂 CI verify-unified.yml 第 7 道观察 1-2 周误报率，稳定后升 pre-push ⑩。

## Phase D：收尾（1 commit）

- KNOWLEDGE §2 六份手工清单改写为「2 权威源 + 生成链」新流程；§19 第三步标记落地；反向移植欠债清单入档。
- commit + push（每 Phase 独立提交，九道门逐次全绿）。

## 验证总览

1. Phase A 后：html-sync-check 全绿、云APP assets 语法错误归零
2. Phase B 后：生成器字节级复刻 + 幂等 + Group 13 接入 sync-all/pre-push
3. Phase C 后：CI 新守卫绿（基线冷启动冻结当前合法差异）
4. 全程：每 commit 跑 pre-push 九道门；界面结构基线（check-interface）不受影响（A/B 均不改 6 基线文件的界面结构）

## 风险与回滚

- 每 Phase 独立 commit，单 revert 粒度回滚
- A：运行时零风险（死副本治理）
- B：字节级验收门兜底最大风险（变换表不忠实立即暴露）；锚点失配 = 大声失败逼人更新表
- C：观察期挂 CI 不挂 pre-push，误报不阻塞推送
