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

## 跨用户接力协议（不同账号/机器续作同一项目）
- **交接唯一通道是 Git 内的 `.trae/` 文件**（本地记忆 user_profile/project_memory、全局规则均不跨用户，勿依赖）。
- **接工**：`git pull` → `git status` → Read `.trae/KNOWLEDGE.md` → Read `.trae/HANDOFF.md`，从 OPEN 任务取最高优先级续作；任务转 IN-PROGRESS 时写明账号@机器与日期。
- **收工**：把任务状态、commit hash、验证结果、下一步/阻塞更新进 `.trae/HANDOFF.md`，**与代码同批 commit + push**；完成的任务从 OPEN 删除并把结论沉淀进 KNOWLEDGE.md。
- 用户说「交接/接力/收工/遗留任务」时，加载 project-handoff skill 按清单执行。
- HANDOFF 内禁放密钥与客户隐私；凭据各机自备（见 HANDOFF 文末环境前置）。
