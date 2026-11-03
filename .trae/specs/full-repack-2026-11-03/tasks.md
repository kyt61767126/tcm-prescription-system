# Tasks · 整包重打 + 真机冒烟（2026-11-03）

## 已完成
- [x] T1 五端入口与环境确认（Node / Java 17 / Android SDK 34-36 / keystore / DevEco SDK 均可用）
- [x] T2 前置门禁：pre-build-check ×2、sync-all -VerifyOnly、check-interface、copy-consistency、check-cv-hashes 全绿
- [x] T3 云端桌面 exe 重打（1.2.287）
- [x] T4 离线桌面 exe 重打（1.0.310）
- [x] T5 云端 APK 重打（versionCode 350）
- [x] T6 离线 APK 重打（versionCode 344）
- [x] T7 鸿蒙 HAP 构建 + 发布签名
- [x] T8 五端解包抽查（index.html + quiz 四件套，哈希与源一致）

## 待执行（需用户批准）
- [ ] T9 运行 `tools/_tmp/verify-mobile-quiz-entry.cjs`（12 组合 / 164 断言基线）
- [ ] T10 Electron 实启 + 热包 2026.11.02-3（隔离 userData、预置 current、断言 URL 为 hot 入口）
- [ ] T11 新装包 file:// 内置题库冒烟（cloud/offline 解包目录，隔离无 hot-update）
- [ ] T12 回退验证（`tools/_tmp/smoke-hot-update.cjs` 或 hot-update-core 双目录夹具）
- [ ] T13 真机探测（`adb devices`、鸿蒙设备）；无设备则标注受阻
- [ ] T14 汇报（中文 Markdown，先结论后证据；不提交不推送）

## 约束
- 不提交、不推送、不改热更清单、不动无关配置。
- 失败项必须记录真实错误与根因，不得以模拟替代真机结论。
