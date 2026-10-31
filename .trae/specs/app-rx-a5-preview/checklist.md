# Checklist：App 处方笺屏幕预览对齐 A5 版式

## 版式与缩放
- [x] 三份权威源（`public/index.html`、`db-offline/desktop/index.html`、`site-admin/index.html`）≤768 段 `.prescription-paper` 固定 `148mm×210mm + padding 22.5/13/15mm`，无 `width:100%` 流式窄版残留
- [x] ≤480 与二次覆盖块中的处方纸 px 覆盖（16px/11px/9.5px/17px/10px/9px/12px、`padding:12px`）已删除
- [x] `_fitPrescriptionPaper` IIFE 存在于三份权威源，按容器宽度计算并写入 `--rx-zoom`；resize / orientationchange / 进入预览 tab 均会重算
- [x] 桌面 (>768px) 不读 `--rx-zoom`，缩放比例为 1

## 打印隔离
- [x] `@media print` 块内无 `zoom`（三份权威源实测 false）
- [x] 每份文件保留 4 处 `padding: 22.5mm 13mm 15mm`（base / ≤768 / print / printPrescription 模板），`printPrescription()` 未改

## 多端同步
- [x] `sync-index-app.cjs --verify-only` PASS；离线 APP 打包源与 assets 字节一致（pre-push 校验通过）
- [x] `sync-html` 云端 3 副本（云桌面 / 云APP assets / 鸿蒙 rawfile）与 `public/index.html` 一致（pre-push HTML Sync Check IN SYNC）
- [x] `sync-siteadmin.cjs` 同步 `switchMobileTab`，`diff-cross-version.cjs` 6 对全绿，基线已重冻结
- [x] `.interface-lock.json` 已重建，`check-interface.bat` 6 OK

## 发版与线上
- [x] 三通道热包重签 `2026.10.31-2`（cloud 1.2.285 / local 1.0.308 / app-local minAppCode 288）
- [x] 已 push：`origin/main` = 本地 HEAD `4e1cc999`，pre-push 十八道主校验全部通过
- [x] 线上 `version.json` 三通道均读到 `hotVersion=2026.10.31-2`
- [x] 线上网页 `index.html` 含 `--rx-zoom`、`_fitPrescriptionPaper`、A5 页边距

## 验收与沉淀
- [x] Playwright 375/412/768/1280：375px zoom 0.6525 → 364.98×517.88（比例 210/148、无横滚）；412px 0.7187；768/1280 zoom=1
- [x] `pack-gate.ps1 -Mode preflight` 5/5、`sync-all.ps1 -VerifyOnly` ALL PASS
- [x] `.trae/KNOWLEDGE.md` 新增「移动端处方笺 A5 整页等比缩放」铁律并修正旧 px 条
- [x] `.trae/HANDOFF.md` 记录 P10 结论、验证结果与「未重打 APK/exe」说明
