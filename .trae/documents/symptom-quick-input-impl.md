# 症状快捷录入（舌脉体征面板）最终实施文档

> 版本：v1.0（定稿）
> 日期：2026-08-21
> 状态：**待用户批准开工**（本文档只做设计，未动任何代码）
> 审查：已经 Seed-2.1-Pro 独立审查，4🔴阻断项 + 6🟡重要项全部纳入修正

---

## 1. 背景与目标

### 1.1 现状

- 症状录入为单个纯文本框（`medicalHistory` textarea，桌面高 30px / 移动端 50px）
- 「病史症状 / 修改病史」两个标签为纯样式死 UI（无事件绑定）
- 无词典、无快捷输入、无联想；医生手打「舌淡红，苔薄白，脉弦细」平均 10+ 秒
- 项目已有两个成熟模式可复用：药品简码录入（简码列+下拉）、辨证选方弹窗（Alt+1 点选→填入）

### 1.2 目标

医生 3~5 秒完成「舌淡红，苔薄白，脉弦细」类规范录入；键鼠/触屏双友好；**数据结构零改动、打印格式零改动、完全向后兼容**。

### 1.3 已确认决策（用户 2026-08-21 拍板）

| 决策点 | 结论 |
|---|---|
| 入口方式 | 症状区「病史症状」标签旁加「舌脉」小按钮 |
| 首期范围 | **P1+P2 一起做**（词典+面板+模板+简码搜索+频次记忆） |
| 词条来源 | AI 按《中医诊断学》教材内置标准库，用户后续可增删（P3） |

---

## 2. 总体架构

```
[舌脉按钮] → openSymptomPanel()
                ├─ ① 缓存 textarea 光标（selectionStart/End）→ 闭包变量 _symCursor
                ├─ ② showModal('symptomModal')
                └─ ③ 面板：分类 chips + 词条按钮 + 简码搜索框 + 已选预览
[确认插入] → assembleText() 按标点规则拼接
          → insertAtCursor() 用缓存光标位置插入
          → updatePrescriptionPaper() 同步处方笺预览
          → closeModal + focus 回 textarea
```

新增文件 1 个：`symptom-dict.js`（词典权威源，纯数据+少量工具函数）。
面板 UI 与交互逻辑内联在各 index.html 现有 `<script>` 区（复用 showModal/closeModal 基建，参照辨证选方弹窗模式），**不新建独立 JS 逻辑文件**，降低 build.files 分发风险。

---

## 3. 数据层设计

### 3.1 词典结构（symptom-dict.js）

```js
// 中医症状体征词典（权威源）——纯数据文件，无 DOM 依赖
window.SYMPTOM_DICT = {
  version: 1,                     // 词典版本，P3 自定义词条合并时用
  categories: [
    { id: 'zh', name: '组合模板', order: 0, terms: [ {text:'舌淡红，苔薄白，脉弦', code:''}, ... ] },
    { id: 'tz', name: '舌质',     order: 1, terms: [ {text:'舌淡', code:'sd'}, {text:'舌淡红', code:'sdh'}, ... ] },
    { id: 'tai', name: '舌苔',    order: 2, terms: [ {text:'苔薄白', code:'tbb'}, ... ] },
    { id: 'mai', name: '脉象',    order: 3, terms: [ {text:'脉弦', code:'mx'}, ... ] },
    { id: 'wen', name: '望闻诊',  order: 4, terms: [ {text:'面色萎黄', code:'mswh'}, ... ] },
    { id: 'wd', name: '问诊',     order: 5, terms: [ {text:'恶寒发热', code:'ehfr'}, ... ] }
  ]
};
```

### 3.2 词条规模（G4 约束：首期 80~120 条，不贪多）

| 分类 | 条数 | 示例 |
|---|---|---|
| 组合模板 | 12~15 | 舌淡红，苔薄白，脉弦 / 舌红，苔黄腻，脉滑数 |
| 舌质 | 14~16 | 舌淡/舌淡红/舌红/舌绛/舌紫暗/舌淡胖/边有齿痕/舌有瘀斑 |
| 舌苔 | 14~16 | 苔薄白/苔薄黄/苔白腻/苔黄腻/苔少/苔剥落/苔白滑 |
| 脉象 | 14~16 | 浮沉迟数滑涩弦紧细弱洪濡（28脉取常见） |
| 望闻诊 | 18~24 | 面色萎黄/神疲乏力/语声低微/形体消瘦 |
| 问诊（十问） | 30~40 | 恶寒发热/口干口苦/纳呆食少/大便溏薄/失眠多梦 |

### 3.3 简码规则（Y4 锁定）

- **预置拼音简码**（首字母组合），词典内静态写死，**不做运行时拼音转换**
- 匹配规则：**简码用前缀匹配 startsWith**（输 `mx` 命中 `mx`/`mxi` 开头，不命中中间包含的）；**中文用 includes 包含匹配**（输「舌」出所有含舌词条）
- 一律转小写比较，不区分大小写
- 与药品简码操作习惯完全一致

### 3.4 标点拼接规则（R3 锁定，编码时禁止随意发挥）

| 场景 | 标点 | 示例 |
|---|---|---|
| 跨分类之间（舌→苔→脉→望闻→问诊） | 中文逗号 `，` | 舌淡红，苔薄白，脉弦，恶寒发热 |
| 同分类多词之间 | 中文顿号 `、` | 舌红、舌有瘀斑 |
| 组合模板与后续词条之间 | 中文逗号 `，` | 舌淡红，苔薄白，脉弦，头痛 |
| 问诊词条之间 | 中文逗号 `，` | 恶寒发热，头痛，纳呆 |
| 最终结果末尾 | **不加标点** | 由医生手动续写 |

拼接算法（assembleText）：

```js
function assembleText(selected) {
  // selected: 词条对象数组，含 catId
  // 1. 按 catId 的 order 值升序分组（zh 组合模板 order=0 排最前）
  // 2. 组内用「、」连接（组合模板组内多模板也用「、」）
  // 3. 组间用「，」连接
  // 4. 返回字符串，末尾无标点
}
```

### 3.5 存储设计

| 数据 | 键 | 存储 | 是否备份 | 说明 |
|---|---|---|---|---|
| 使用频次 | `symptom_freq` | setUserItem/getUserItem（按用户隔离，异步） | **P1/P2 不备份**（R4 决策：丢失可接受，用几次即恢复） | `{ "舌淡": 5, "脉弦": 3 }` |
| 自定义词条 | `custom_symptoms` | setUserItem/getUserItem | **P3 纳入 exportData/importData**（新增 `customSymptoms` 字段 + `dataStatistics.customSymptomsCount`） | 本期不实现 |

---

## 4. 交互层设计

### 4.1 入口按钮（Y1 精确约束）

- 位置：`.history-tabs` 容器内、两个现有 tab **右侧追加**，与 tab 等高
- **禁止改动**现有「病史症状」「修改病史」两个 tab 的 DOM（「修改病史」是死样式，不复用不借用）
- 样式：复用 `.history-tab` 基础样式 + 差异化底色（如淡绿），文字「舌脉」，触摸目标 ≥36px
- 追加方式：优先纯 JS `appendChild` 动态注入（界面基线影响最小），或直接 HTML 追加——**二选一在实施时以 check-interface WARN 最少为准**

### 4.2 光标处理（R1 核心修正，必须严格照此实现）

```js
let _symCursor = null;  // 光标缓存，模块级闭包变量

function openSymptomPanel() {
  const ta = document.getElementById('medicalHistory');
  if (!ta) { alert('症状输入框未找到'); return; }
  // ① 第一行立刻缓存光标（弹窗会抢焦点导致 selection 重置）
  _symCursor = { start: ta.selectionStart, end: ta.selectionEnd };
  // ② 渲染面板初始状态（上次会话的分类、频次排序）
  renderSymptomPanel();
  showModal('symptomModal');
}

function insertAtCursor(text) {
  const ta = document.getElementById('medicalHistory');
  if (!ta) return;
  const pos = _symCursor || { start: ta.value.length, end: ta.value.length };
  // 若原文选区有内容且光标在末尾附近，智能补「，」分隔（可选优化，保守起见 P1 只做：插入前若 pos.start>0 且前一个字符不是标点，则前置「，」）
  const before = ta.value.slice(0, pos.start);
  const needComma = before.length > 0 && !/[，、,;；\n]$/.test(before);
  const insertText = (needComma ? '，' : '') + text;
  ta.value = before + insertText + ta.value.slice(pos.end);
  const newPos = pos.start + insertText.length;
  ta.setSelectionRange(newPos, newPos);
  ta.focus();
  _symCursor = { start: newPos, end: newPos };  // 支持连续多次插入
  if (typeof updatePrescriptionPaper === 'function') updatePrescriptionPaper();
}
```

### 4.3 面板结构（新 modal，参照 syndromeModal 模式）

```
symptomModal
├─ header:「舌脉体征快捷录入」+ 关闭 ×
├─ 搜索框（顶部，placeholder：搜索名称或拼音简码：sd=舌淡，mx=脉弦）
├─ 分类 chips 行（组合模板/舌质/舌苔/脉象/望闻诊/问诊，可横滚）
├─ 词条区（flex wrap，max-height 限制 + overflow-y:auto，Y2）
│   └─ 词条按钮：选中态高亮，可反选；APP 端 min-height:36px（Y3）
├─ 已选预览条（实时显示拼接结果，含「清空已选」）
├─ footer: 取消 | 确认插入（主按钮）
└─ 底部小字（G1 首次提示）: 点选词条快速录入，支持拼音简码，Alt+S 唤起
```

### 4.4 焦点与键盘管理（Y2/Y5）

- modal CSS：`position:fixed; top:10%; max-height:80vh; overflow-y:auto`（复用现有 modal-content 样式基础上加约束，不全局改样式）
- 面板本身**不唤起系统键盘**（纯点选）；仅点击搜索框时键盘弹起属预期行为
- 关闭/取消面板后：`closeModal('symptomModal')` + `document.getElementById('medicalHistory').focus()`，医生可无缝继续手动输入（Y5）
- 移动端词条区严格限高，**不超出屏幕**（同「统计图不超出屏幕」规范）

### 4.5 组合模板语义（Y6 锁定）

- 组合模板 = 快捷整串，点击**追加到已选，不替换已选散词**
- 分类下加一行小字提示：「模板为整串插入，不清空已选」
- 示例：先选「恶寒发热」，再点模板「舌淡红，苔薄白，脉弦」→ 结果「舌淡红，苔薄白，脉弦，恶寒发热」（模板 order=0 排前，问诊排后）

### 4.6 频次记忆（P2）

- 每次确认插入，将本次选中词条频次 +1（setUserItem 持久化）
- 词条排序：分类内按频次降序，频次相同按词典原顺序；累计使用 ≥3 次的词条自动排到分类前排
- 面板底部提供「重置频次」小按钮（G2，不占主视觉），点击 confirm 后清空 `symptom_freq`

### 4.7 快捷键（G3）

- **Alt+S** 唤起/关闭面板（Symptom 首字母；已避开 Alt+1 辨证选方、F1~F9 系列）
- 加入 showHelp() 快捷键说明列表（属版本文本 8 处联动之外的 help 文本，仅需追加一行）

---

## 5. 文件分发与打包清单（R2 核心修正）

### 5.1 分发模式决策

采用**独立文件模式**（与 medicine-dict.js 一致），不用 sync-shared-blocks 内联块模式。理由：
1. 词典纯数据 ~10KB，逻辑简单，无需内联
2. 独立文件可被浏览器单独缓存
3. **放置规则：symptom-dict.js 与各 index.html 同目录的 medicine-dict.js 位置一一对应**

### 5.2 分发清单（实施时逐项打勾）

**7 份 index.html 副本，各加 1 行**（紧跟 medicine-dict.js 引用之后）：

- [ ] `index.html`（根，离线/桌面版源码）
- [ ] `public/index.html`（云端网页版 + 云端APP 线上源）
- [ ] `app_project/db-offline/desktop/index.html`（离线桌面版）
- [ ] `app_project/db-offline/index-app.html`（离线APP 源）
- [ ] `app_project/db-offline/app/app/src/main/assets/public/index.html`（离线APP assets）
- [ ] `app_project/db-yunduan/cloud_desktop/index.html`（云端桌面版）
- [ ] `app_project/db-yunduan/cloud_app/app/src/main/assets/public/index.html`（云端APP assets）

```html
<script src="symptom-dict.js"></script>
```

**symptom-dict.js 物理副本**（与上述 7 处 index.html 同目录、与 medicine-dict.js 并列）：

- [ ] 根目录 / public/ / db-offline/desktop/ / db-offline/（index-app.html 同级）/ db-offline/app.../assets/public/ / cloud_desktop/ / cloud_app.../assets/public/
- 实施时以 `Glob **/medicine-dict.js` 的实际命中清单为准逐一对应

**桌面版 package.json build.files**（历史高频事故源，必须全量核对）：

- [ ] 实施时执行 `Grep "medicine-dict.js" --glob **/package.json`，命中的每个 package.json 的 build.files 中，symptom-dict.js 与 medicine-dict.js 同路径并列存在
- 预期至少覆盖：cloud_desktop / cloud_desktop_geren / db-offline/desktop / db-offline/desktop_geren

**云端缓存策略**：

- [ ] `public/_headers` 中为 `symptom-dict.js` 增加 `Cache-Control: public, max-age=86400`（词典低频变更，与 qrcode.min.js/xlsx.full.min.js 同档）；其余业务 JS 维持 max-age=0+must-revalidate 不动
- ⚠️ 词典若日后修订，需同步 bump `SYMPTOM_DICT.version` 并考虑文件名加版本参数（`symptom-dict.js?v=2`）破缓存

---

## 6. 实施分期与任务分解

### P1 核心版（词典+面板+插入）

| # | 任务 | 产出 |
|---|---|---|
| 1 | 跑 check-interface.bat 建立基线 | 基线文件（随代码提交） |
| 2 | 编写 symptom-dict.js 权威源（词典 80~120 条+简码） | 根目录+public/ 两份先行 |
| 3 | 实现面板 modal + 分类 chips + 词条点选 + 拼接预览 | 根 index.html |
| 4 | 实现光标缓存/插入/焦点回归（§4.2 代码） | 根 index.html |
| 5 | 「舌脉」按钮注入 .history-tabs | 根 index.html |
| 6 | 本机三浏览器手动验证插入/拼接/预览同步 | 验证记录 |
| 7 | 分发剩余 5 副本 + build.files + _headers | §5.2 清单全勾 |

### P2 效率版（简码搜索+频次+快捷键）

| # | 任务 | 产出 |
|---|---|---|
| 8 | 搜索框：中文 includes + 简码 startsWith 双匹配 | 各副本 |
| 9 | 频次记忆 + 排序前置 + 重置按钮 | 各副本 |
| 10 | Alt+S 快捷键 + showHelp 说明追加 | 各副本 |
| 11 | 移动端适配验证（词条 36px、面板限高、键盘行为） | APP 端验证 |

### P3 自定义词条（本期不做，预留设计）

- 自定义词条增删 UI（面板内「管理」入口）
- exportData 新增 `customSymptoms` 字段 + importData 恢复 + dataStatistics 计数（R4 已锁定）
- 与内置词典按 `SYMPTOM_DICT.version` 合并去重

### P4 铁闸验证与交付（与 P1/P2 合并执行）

| # | 任务 |
|---|---|
| 12 | copy-consistency 扩展：symptom-dict.js 副本哈希校验 |
| 13 | smoke-runtime 加用例：词典缺失/毒数据（categories 非数组）时面板不白屏 |
| 14 | e2e 加用例：面板渲染+插入+拼接标点断言 |
| 15 | pre-build-check.js 确认新文件被 build.files 覆盖 |
| 16 | check-interface.bat 复验（新增按钮/弹窗导致的预期 WARN → 征求用户同意后重建基线随代码提交） |
| 17 | 版本号跳号（按实施时最新 Setup 版本 +1，避免假包混淆；核对 8 处版本标识联动） |
| 18 | git commit + push（message 含生效方式段落） |

---

## 7. 验证矩阵（交付标准）

| 验证项 | 通过标准 |
|---|---|
| 功能-点选 | 三端（网页/桌面/APP）点选完整舌脉串 ≤5 秒，预览与插入一致 |
| 功能-拼接 | §3.4 标点规则逐场景断言（跨类逗号/同类顿号/末尾无标点） |
| 功能-光标 | textarea 中部手动输入后开面板插入，文字落在原光标处，不覆盖不跳位 |
| 功能-简码 | `mx`→脉弦、`sd`→舌淡、`tbb`→苔薄白 均命中；`sd` 不命中「苔白滑」 |
| 功能-焦点 | 关面板后 focus 回 textarea，可直接续打 |
| 兼容-旧数据 | 打开历史处方，medicalHistory 原样回显，保存/打印/导出不变 |
| 兼容-备份 | 一键备份/恢复不报错（P1/P2 频次不进备份为预期行为） |
| 界面基线 | check-interface 仅新增按钮/弹窗产生的预期差异，经用户同意重建基线 |
| 打包 | 桌面版 build.bat 成功 + pre-build-check PASS + asar 内含 symptom-dict.js |
| 铁闸 | copy-consistency / smoke / e2e 全绿 |

---

## 8. 风险与回滚

| 风险 | 概率 | 缓解 |
|---|---|---|
| 界面基线 WARN | 必然 | 铁律流程：先征用户同意→改动→重建基线随代码提交 |
| build.files 遗漏→exe 缺脚本按钮失灵 | 中 | §5.2 checklist + pre-build-check 兜底 + 铁闸 15 |
| 移动端键盘遮挡/溢出 | 中 | §4.4 约束 + P2 任务 11 实机验证 |
| 词典医疗内容争议 | 低 | 按《中医诊断学》教材标准；用户可 P3 自行增删 |
| 云端缓存不更新 | 低 | _headers 1 天缓存 + 修订时 bump version 破缓存 |

**回滚方案**：功能全部为增量（1 个新文件 + 每副本 1 行 script + 1 个按钮 + 1 个 modal），`git revert` 单提交即可完整回滚，无数据迁移。

---

## 9. 各端生效方式（实施完成后告知用户）

| 端 | 生效方式 |
|---|---|
| 云端网页版 | 推 GitHub 自动部署，刷新即用 |
| 云端APP | 线上 public/ 更新即生效，**无需重打 APK** |
| 云端桌面版 | 重新 build.bat 打包 Setup，重装后生效 |
| 离线桌面版 | 重新 build.bat 打包 exe |
| 离线APP | 重新打包 APK 并重装 |

---

## 10. 审查意见落实对照表

| 审查项 | 落实章节 | 状态 |
|---|---|---|
| 🔴R1 光标缓存 | §4.2 | ✅ 已给出强制代码模式 |
| 🔴R2 分发模式+build.files | §5 | ✅ 独立文件模式+逐项清单 |
| 🔴R3 标点规则 | §3.4 | ✅ 规则表+算法锁定 |
| 🔴R4 备份兼容 | §3.5 | ✅ 频次不备份/P3 纳入，决策记录 |
| 🟡Y1 按钮位置 | §4.1 | ✅ 精确到容器与追加方式 |
| 🟡Y2 modal 限高/键盘 | §4.4 | ✅ 约束写入 |
| 🟡Y3 触摸目标 36px | §4.3/§6-P2 | ✅ |
| 🟡Y4 简码前缀匹配 | §3.3 | ✅ |
| 🟡Y5 焦点回归 | §4.2/§4.4 | ✅ |
| 🟡Y6 模板追加语义 | §4.5 | ✅ 追加不替换 |
| 🟢G1 首次提示 | §4.3 | ✅ |
| 🟢G2 重置频次 | §4.6 | ✅ |
| 🟢G3 Alt+S | §4.7 | ✅ |
| 🟢G4 词条规模 | §3.2 | ✅ 80~120 条 |
| 🟢G5 词典缓存 1 天 | §5.2 | ✅ |

---

## 11. 开工前置条件（Checklist，逐项确认后动工）

- [ ] 用户批准本文档开工
- [ ] check-interface.bat 基线已建立
- [ ] 当前 Git 工作区干净（无未提交改动）
- [ ] 确认实施时最新版本号（跳号用）
- [ ] 界面新增按钮/弹窗的基线重建已获用户预先同意（一次性授权，本文档批准即视为同意）
