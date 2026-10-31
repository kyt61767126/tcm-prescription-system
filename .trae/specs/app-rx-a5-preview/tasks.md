# Tasks：App 处方笺屏幕预览对齐 A5 版式

依据 `spec.md`（`.trae/specs/app-rx-a5-preview/spec.md`）。逐项完成后勾选。

## T1 改离线权威源 CSS（`app_project/db-offline/desktop/index.html`）
- [x] ≤768：`/* 处方纸缩放 */` 段替换为 A5 固定尺寸 + `zoom: var(--rx-zoom, 1)`，删除 12 条 px 覆盖
- [x] ≤480：删除 `padding:12px` 及 16px/11px/9.5px/17px/10px 覆盖段
- [x] 二次覆盖块：删除 `.prescription-line 9px`、`.prescription-jianfa`、`.prescription-info 12px`

## T2 改离线权威源 JS
- [x] 在 `function updatePrescriptionPaper() {` 前插入 `_fitPrescriptionPaper` IIFE
- [x] `switchTab` 的 `case 'preview':` 追加 `_fitPrescriptionPaper()` 调用

## T3 同构同步云端权威源（`public/index.html`）+ site-admin 双轨副本
- [x] CSS 三处同改（`/* 处方纸缩放 */`、≤480、二次覆盖）
- [x] JS IIFE 同文插入 + 预览分支调用
- [x] `site-admin/index.html` 同构移植（否则 `diff-cross-version` siteadmin Tier A 红灯）；`sync-siteadmin.cjs` 同步 `switchMobileTab`

## T4 生成与传播
- [x] `node tools/sync-index-app.cjs`（32 条变换唯一命中，双写一致）
- [x] `powershell ... tools/sync-html.ps1`（云端 3 副本）
- [x] `node tools/check-cv-hashes.cjs --update`（幂等零改）后再传播一次

## T5 界面基线
- [x] `powershell ... tools/generate-interface-lock.ps1`（重建）
- [x] `check-interface.bat` → 6 OK

## T6 热包重签（三通道）
- [x] `node tools/generate-desktop-hotupdate.cjs -c cloud` → 2026.10.31-2
- [x] `node tools/generate-desktop-hotupdate.cjs -c local` → 2026.10.31-2
- [x] `node tools/generate-app-hotupdate.cjs` → 2026.10.31-2（minAppCode 288）

## T7 验证
- [x] `sync-index-app.cjs --verify-only` / `check-cv-hashes.cjs --verify`（15 项一致）/ `sync-all.ps1 -VerifyOnly`（全 OK）
- [x] `diff-cross-version.cjs` 6 对全绿 + `pack-gate.ps1 -Mode preflight`（5/5 通过）
- [x] Playwright 375/412/768/1280：375 zoom 0.6525→364.98×517.88（比例 210/148、无横滚）；768 zoom 1；1280 桌面 zoom 1
- [x] 打印断言：三份 index.html 各 4 处 `padding: 22.5mm 13mm 15mm`，`@media print` 块内无 `zoom`

## T8 提交与沉淀
- [x] 逐个路径 `git add`，commit + push（message 含生效方式）
- [x] 线上核对热更 `version.json`（-2）+ 本机 `git log origin/main -1`
- [x] `.trae/KNOWLEDGE.md` 处方笺铁律补注（移动端只允许整页缩放；`--rx-zoom` + `zoom`；打印不动）
- [x] `.trae/HANDOFF.md` 记录 commit / 验证结果 / 是否重打整包待定
