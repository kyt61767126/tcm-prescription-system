# 报告计划 — 「导入药品」与「库存管理」合并优化可行性分析

Color preset: Product Teal — cue: 产品功能整合分析（功能对比/工作流/产品洞察）
Intro mode: contained — cue: 技术可行性分析报告，无媒体素材

## 章节
1. 现状盘点（入口布局 + 能力矩阵）
2. 四个发现（语义重叠 / 会计缺口 / 代码重复 / UI 拥挤）
3. 合并方案对比（A 期初流水闭环 / B 解析器收敛 / C UI 重组）
4. 推荐实施路径（分期 + 工作量）
5. 风险与边界（覆盖模式 / 开关关闭 / 各端影响）
6. 结论

## 视觉
- 1 个 Mermaid 流程图：库存变更通道现状（3 通道有账 vs 导入绕账）
- 能力矩阵表 + 方案对比表 + 各端影响表（表格承载，无定量图表）
- 无媒体素材；字体用系统 CJK 栈；Mermaid 本地库 `_shared/js/mermaid.min.js`

## 证据来源（本地代码，无 URL）
- public/index.html L8554–8736（importMedicines / executeImportMethod 三模式）
- public/index.html L8391–8414（exportMedicines 含库存列）
- public/index.html L8521–8552（decodeTextWithAutoEncoding / parseCSVLine / loadXlsxLibrary）
- shared/stock-core.js L103–260（applyStockDelta / pushEntry / stockIn / recordManualAdjust）
- shared/stock-core.js L129（TYPE_LABEL 5 种流水类型）
- shared/stock-core.js L381–399（按钮注入与开关显隐）、L829（编辑弹窗包装记 adj）
