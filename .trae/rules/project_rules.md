# 项目规则（自动加载）

## 跨账户经验继承（最高优先级）
- 本项目所有历史经验、铁律、规范统一沉淀在 **`.trae/KNOWLEDGE.md`**（随 Git 共享的单一权威源）。
- **每次会话开始第一步：Read `.trae/KNOWLEDGE.md`** 并严格遵守其中全部铁律（开工铁律、界面保护、多端同步、打包规范等 11 章）。
- 若本会话尚未读取该文件，任何代码修改前必须先读。
- 本地记忆（project_memory.md）只是它的刷新副本；若两者冲突，以仓库 `.trae/KNOWLEDGE.md` 为准，或运行 `.trae/学习经验.bat` 刷新本地记忆。
- 每轮优化完成后，把「结论 + 生效方式」合并进 `.trae/KNOWLEDGE.md` 对应章节并 commit + push（或提示用户双击 `同步推送经验.bat`）。

## 开工前必查（详见 KNOWLEDGE.md 第 1 章）
- 会话开始先 `git status`（防会话恢复快照静默覆盖）。
- 改界面相关内容前后运行 `check-interface.bat`；禁止改 HTML 结构/CSS。
- 多端同步清单（6 份 index.html / auth-core 双权威源 / cloud-api 8 副本）改动必查。
