# Spec：App 处方笺屏幕预览对齐 A5 版式

> 用户指令：「同步优化App 处方笺」；澄清确认选项：「屏幕预览对齐 A5 版式（推荐）」。
> 目标：手机端处方笺预览不再压缩成流式窄版，而是按 A5（148×210mm）整页等比缩放；页边距 22.5/13/15mm、22pt 标题、10.5pt 正文、9pt 煎服法、3 味一行与斜线勾选全部保留。**打印 CSS 一律不动**。

## 1. 现状（已核实）

两处权威源结构同构：

| 端 | 权威源 | ≤768 处方纸规则 | ≤480 处方纸规则 | 二次覆盖 |
|---|---|---|---|---|
| 离线 | `app_project/db-offline/desktop/index.html` | L284-305（`/* 处方纸缩放 */`：`width:100%;height:auto;padding:16px` + `clinic-name 18px`…`signature-row 12px`） | L506-522（`padding:12px` + `16px/11px/9.5px`… 覆盖） | L582-584（`.prescription-line 9px` 等） |
| 云端 | `public/index.html` | L347-369（同构） | L578-594（同构） | L654-656（同构） |

- 打印侧三处均为 `padding: 22.5mm 13mm 15mm`（离线 L34/L93/L9059，云端 L60/L119/L9299）——**本次不改**。
- 打印走独立 `printWin`（`printPrescription()` 复制 `prescriptionPaper.innerHTML`），不会带上主窗口元素的内联样式，故缩放变量不污染打印。
- 已存在 App 预览双指捏合模块（离线 L3162，云端 L3221）用 `paper.style.transform` 实现缩放，与本方案的 `zoom` 不冲突；`resetZoom` 只清 transform，正好回落到 A5 适配比例。

## 2. 方案（决策已定：CSS zoom + 少量 JS 计算比例）

纯 CSS 无法做「长度相除」，故：

1. **纸尺寸回归 A5**：≤768/≤480 的 `width:100%/height:auto/padding:16px|12px` 全部删除，恢复 `width:148mm; height:210mm; padding:22.5mm 13mm 15mm`；字号/行高/网格的 px 覆盖整段删除（让 base 的 pt 规范生效）。
2. **整页缩放**：在 ≤768 的 `.prescription-paper` 上加 `zoom: var(--rx-zoom, 1)`。Chromium（Electron / Android WebView / 桌面浏览器）原生支持 `zoom`，且**缩放参与布局**（父容器滚动高度正确，无需补偿占位）。
3. **比例来源**：新增 IIFE `_fitPrescriptionPaper()`，按容器可用宽度计算 `scale = min(1, avail / 559.37px)`（CSS 规范 1mm = 96px/25.4，148mm ≈ 559.37px），写入元素内联自定义属性 `--rx-zoom`；`resize` / `orientationchange` / 进入预览 tab 时重算。桌面 >768px 不声明 `zoom`，比例即使写入也无效，零影响。
4. **不再做整页缩放的情形**：放大后的双指手势仍走既有 transform 模块（叠加在 zoom 之上），双击复位回 A5 适配。

## 3. 精确改动

### 3.1 离线权威源 `app_project/db-offline/desktop/index.html`

**A. `@media screen and (max-width: 768px)` 内 L284-305 整段替换为：**

```css
            /* ★ 2026-10-31 移动端处方纸 A5 版式：纸固定 148×210mm，整页按容器宽度等比缩放
               （不再压 padding/字号成流式窄版），比例由 _fitPrescriptionPaper() 写入 --rx-zoom；
               打印不受影响（@media print 已用 !important 锁定 148mm×210mm）。 */
            .prescription-paper {
                width: 148mm;
                height: 210mm;
                min-height: 210mm;
                padding: 22.5mm 13mm 15mm;
                transform: none;
                box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                zoom: var(--rx-zoom, 1);
            }
```

（原 L294-305 的 `.clinic-name 18px`、`.prescription-title 18px`、`.prescription-info 12px`、`.prescription-grid`、`.prescription-grid-inner`、`.prescription-line 11.5px`、`.prescription-jianfa`、`.rp-mark 20px`、`.dose-count 13px`、`.prescription-footer`、`.usage-text 12px`、`.signature-row 12px` 全部删除。）

**B. `@media screen and (max-width: 480px)` 内 L506-522 整段删除**（`padding:12px` 与 16px/11px/9.5px/17px/11px/10px 覆盖全删），保留紧随其后的 mobile-nav / patient-input / medicine-table 等非处方笺规则。

**C. L582-584 删除三行**（`.prescription-line 9px`、`.prescription-jianfa`、`.prescription-info 12px`）。

**D. JS：在 `function updatePrescriptionPaper() {` 之前插入：**

```js
        // ★ 2026-10-31 移动端处方纸 A5 等比缩放：预览保持 A5（148×210mm）版式——
        //   纸按 CSS mm 固定，整页 zoom 到容器宽度；仅 ≤768px 的 @media 声明 zoom，
        //   桌面 (>768px) 不读该变量零影响；打印走独立 printWin（复制 innerHTML），版式不变。
        (function () {
            var MM_TO_PX = 96 / 25.4;             // CSS 规范：1mm = 96px/25.4
            var PAPER_W_PX = 148 * MM_TO_PX;      // A5 纸宽 ≈559.37px
            function fitPrescriptionPaper() {
                var panel = document.querySelector('.center-panel');
                var paper = document.getElementById('prescriptionPaper');
                if (!panel || !paper) return;
                if (panel.clientWidth <= 0) return; // 预览 tab 未激活（display:none）
                var cs = window.getComputedStyle(panel);
                var avail = panel.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
                if (avail <= 0) return;
                var scale = Math.min(1, avail / PAPER_W_PX);
                if (Math.floor(PAPER_W_PX * scale) > Math.floor(avail)) scale = Math.max(0.1, (avail - 2) / PAPER_W_PX);
                paper.style.setProperty('--rx-zoom', scale.toFixed(4));
            }
            window._fitPrescriptionPaper = fitPrescriptionPaper;
            var rafId = 0;
            function schedule() {
                if (rafId) return;
                rafId = window.requestAnimationFrame(function () { rafId = 0; fitPrescriptionPaper(); });
            }
            if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule);
            else schedule();
            window.addEventListener('resize', schedule);
            window.addEventListener('orientationchange', schedule);
        })();
```

**E. `switchTab` 的 `case 'preview':` 内，在 `_previewZoomReset` 调用之后追加一行：**

```js
                    if (typeof window._fitPrescriptionPaper === 'function') window._fitPrescriptionPaper();
```

### 3.2 云端权威源 `public/index.html`

同构同改：`/* 处方纸缩放 */`（L347 起）整段、≤480（L578-594）、二次覆盖（L654-656），纸张规则与 JS 文本与 3.1 完全一致（仅注释行号无关）。JS 插入点同为 `function updatePrescriptionPaper() {` 之前；`switchTab` 预览分支同样追加调用。

### 3.3 不新增 transforms 条目

`tools/index-app-transforms.cjs` 无处方笺相关变换，离线改动原样流灌 App 副本，无需新增 T 编号（T22 仍然永不复用）。

## 4. 传播与手续（按序执行）

1. `node tools/sync-index-app.cjs`（生成 `db-offline/index-app.html` + 离线 APP assets 副本）
2. `powershell -NoProfile -ExecutionPolicy Bypass -File tools/sync-html.ps1`（或 `sync-all.ps1`，分发云端 3 副本含鸿蒙兜底）
3. `node tools/check-cv-hashes.cjs --update`（index.html 变更必须 bump cv）→ 再跑一次同步传播
4. `powershell -NoProfile -ExecutionPolicy Bypass -File tools/generate-interface-lock.ps1`（CSS 在首个 `<script>` 之前，界面基线需重建并随改动提交）
5. 重签三通道热包：`node tools/generate-desktop-hotupdate.cjs -c cloud`、`-c local`、`node tools/generate-app-hotupdate.cjs`；与源码同批 commit + push
6. 提交：逐个路径 `git add`（禁止 `git add .`），commit message 含生效方式

## 5. 验证（全绿才提交）

- `node tools/sync-index-app.cjs --verify-only`
- `node tools/check-cv-hashes.cjs --verify`
- `powershell ... tools/sync-all.ps1 -VerifyOnly`（exit 0）
- `check-interface.bat`（Summary: 6 OK，lock 已重建）
- `node tools/diff-cross-version.cjs`（双侧同改，禁止新增分叉）
- `powershell ... tools/pack-gate.ps1 -Mode preflight`
- Playwright（本地 http 服务）双档：375×812（手机）与 1280×800（桌面）——
  - 手机：`.prescription-paper` 宽高比 ≈ 148:210，宽 ≈ 容器宽 - 10px（不横向滚动），`zoom` 生效且 `getComputedStyle` 的 padding 仍为 22.5/13/15mm；
  - 桌面：`zoom` 不生效（计算值为 1/空），纸 559px 宽；
  - 打印：`printPrescription()` 生成的 HTML 含 `padding: 22.5mm 13mm 15mm` 且不含 `zoom`。
- 回归：预览 tab 双指缩放仍可用，双击复位回到 A5 适配比例。

## 6. 明确不做

- 不改 `@media print` 三处（离线 L34/L93/L9059，云端 L60/L119/L9299），不改 `printPrescription()`。
- 不改 HTML 结构、不改 DOM 节点。
- 不压行距处理 ≥56/60 味溢出（本次未选，另议）。
- 不发整包（是否重打 APK/exe 由用户在推送后决定；热包先行覆盖 JS/CSS 修复）。

## 7. 生效方式（写入 commit / 收尾说明）

- 云端网页：push 即部署。
- 云桌面 / 云 APP / 鸿蒙兜底：`sync-html.ps1` 已分发，重打整包或联网拉热更后生效。
- 离线桌面 / 离线 APP：`sync-index-app.cjs` 已分发，重打整包或联网拉 app-local 热更后生效。
