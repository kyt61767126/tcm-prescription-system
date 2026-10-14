---
name: project-handoff
description: 惠康中医项目跨 Trae 用户/账号/机器的任务接力。当用户要求"交接、接力、收工、整理遗留任务、换个账号继续、下个会话做什么"时使用，负责接工核对、收工更新 .trae/HANDOFF.md 台账、沉淀 KNOWLEDGE 并随代码推送。不用于会话内子代理交接（用 gp-agent-handoff）。
---

# 跨用户任务接力（kyt-zy）

目标：任何账号 clone 仓库开工即能从 `.trae/HANDOFF.md` 自主续作，不依赖口头/聊天记录。
权威顺序：`.trae/rules/project_rules.md`（自动加载）> 本 skill > `.trae/HANDOFF.md`；技术铁律一律以 `.trae/KNOWLEDGE.md` 为准。

## 1. 接工（用户说"继续/接力/看看遗留什么"）

1. `git pull`（rebase 策略遵仓库惯例）→ `git --no-pager status`，核对工作区未跟踪/未提交改动归属（用户的改动勿碰、勿 `git add -A`）。
2. Read `.trae/KNOWLEDGE.md`（至少读第 1 章开工铁律 + 任务相关章节）。
3. Read `.trae/HANDOFF.md`：
   - 取优先级最高的 OPEN 任务；IN-PROGRESS 超过 24h 无心跳视为可重接（接手前在台账注明）。
   - BLOCKED 任务只在阻塞物已解除时接，并注明解除证据。
4. 开工前向用户复述一句：**接哪个任务、范围边界、基线 commit**；任务卡信息过期（基线已含该改动）时先核实再动手。
5. 把任务改为 `IN-PROGRESS（账号@机器，日期）`，随首个代码提交 push 心跳。

## 2. 收工（用户说"交接/收工/明天接着做"）

1. 确认代码已按项目铁律验证（node --check / 相关 e2e/.tmp 回归 / check-interface / sync 副本 / cv hash，以 KNOWLEDGE 与 license-chain-release skill 为准）并已 push。
2. 更新 `.trae/HANDOFF.md`：
   - 完成项：从 OPEN 删除，结论合并进 KNOWLEDGE.md（结论+生效方式+commit），台账"当前基线"刷新 HEAD 与发布状态（Pages/热更版本）。
   - 未完成项：写清现状、下一步第一步动作、验证命令、阻塞物；不留"自行判断"式模糊任务。
3. HANDOFF 与代码/ KNOWLEDGE **同批 commit + push**（提交信息含 handoff 字样），确认远端可见。
4. 临时脚本（根目录 `_*.mjs`、一次性验证文件）测完即删，不交接垃圾。

## 3. 新增遗留任务的任务卡

复制 HANDOFF.md 中的模板：标题含优先级；背景必须带文件:行号/日志 action/脱敏数据；明确"范围/勿做"；验收写成可执行命令+人工核对点；基线 commit 必填。

## 4. 红线

- HANDOFF/KNOWLEDGE/规则/skill 全部随 Git 共享，**禁止写入密钥、token、密码、完整客户手机号/客户码**（写脱敏前缀）；凭据各机自备，路径见 HANDOFF 文末。
- 不虚构状态：没 push 不算完成，没跑过的测试不写"已验证"，线上状态以实际请求/wrangler 证据为准。
- 交接只传递状态与方法，不替用户决定产品取舍（如付费升级、放宽安全锚点须显式批准，结论记 KNOWLEDGE）。
- 不把任务做成 TODO 垃圾场：每条 OPEN 必须可独立执行；长期空想放 `.trae/documents/` 计划文档，HANDOFF 仅留指针。
