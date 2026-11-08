// 说明书（补正版）自动校验：禁止表述、必要内容、图位、目录一致性
// 用法：node verify-manual.cjs
const fs = require('fs');
const path = require('path');

const SC = __dirname;
const MD = path.join(SC, '..', '软著补正_20261105', 'plain', '软件说明书_补正版_通俗版.md');
const out = [];
function ok(name, pass, detail) { out.push({ name, pass, detail: detail || '' }); }

if (!fs.existsSync(MD)) {
  console.log('未找到 软件说明书_补正版.md，无法校验。');
  process.exit(1);
}
const md = fs.readFileSync(MD, 'utf8');

// 1) 禁止表述
const BANNED = [
  '500+', '5000+', '准确率', '≤50ms', '50ms', '拼音首字母加权', '分词优化',
  'db-adapter', 'patient-archive', 'token + 时间戳', '防重放', 'A4', '拖拽排序',
  '批量删除', '复制粘贴', '18 个自研业务模块', '18个自研业务模块', '界面友好', '功能强大',
  '排版规范说明', '一站式', '行业领先'
];
const hit = BANNED.filter((w) => md.includes(w));
ok('禁止表述全部清除', hit.length === 0, hit.length ? '仍出现：' + hit.join('、') : '');

// 2) 必要内容
const NEED = [
  '1.8', '独创性说明', '附录 F', '功能—代码对照表', '煎法', '舌脉', '469', '67',
  '200', '60 万', 'A5', '库存', '语音', '复诊率'
];
const miss = NEED.filter((w) => !md.includes(w));
ok('必要内容齐全', miss.length === 0, miss.length ? '缺少：' + miss.join('、') : '');

// 3) 图位（8 个固定文件名，允许 arch-diagram）
const EXPECT = ['shot1_login.png', 'shot2_main.png', 'shot3_symptom.png', 'shot4_formula.png',
  'shot7_case_history.png', 'shot5_analytics.png', 'shot5_analytics_2.png', 'shot5_analytics_3.png',
  'shot7_stock.png', 'shot7_stock_2.png', 'shot7_tongue.png'];
const refs = [...md.matchAll(/!\[[^\]]*\]\(screenshots\/([^)]+)\)/g)].map((m) => m[1]);
const missing = EXPECT.filter((f) => !refs.includes(f));
const extra = refs.filter((f) => !EXPECT.includes(f) && f !== 'arch-diagram.png');
ok('10 个图位齐全', missing.length === 0, missing.length ? '缺少：' + missing.join('、') : '');
ok('无多余图位', extra.length === 0, extra.length ? '多出：' + extra.join('、') : '');

// 4) 目录与 h2 一致
const h2 = [...md.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1].trim());
const tocLines = [...md.matchAll(/^-\s+(.+?)\s*[·.．]{2,}\s*\d+\s*$/gm)].map((m) => m[1].trim());
const notInToc = h2.filter((t) => t !== '目录' && !tocLines.includes(t));
const notInBody = tocLines.filter((t) => !h2.includes(t));
ok('目录覆盖全部章节标题', notInToc.length === 0, notInToc.length ? '缺目录项：' + notInToc.join('、') : '');
ok('目录无多余项', notInBody.length === 0, notInBody.length ? '多余目录项：' + notInBody.join('、') : '');

// 5) 结构完整性
ok('共 14 章 + 附录 A–F', h2.filter((t) => t.startsWith('第')).length >= 14 && h2.filter((t) => t.startsWith('附录')).length === 6,
  `实际章数 ${h2.filter((t) => t.startsWith('第')).length}，附录数 ${h2.filter((t) => t.startsWith('附录')).length}`);

// 6) 字数（粗略）
const chars = md.replace(/\s/g, '').length;
ok('正文体量足够（≥12000 字）', chars >= 12000, `实际约 ${chars} 字`);

console.log('');
console.log('================ 说明书内容校验 ================');
for (const r of out) console.log(`${r.pass ? '[通过]' : '[问题]'} ${r.name}${r.detail ? ' —— ' + r.detail : ''}`);
const fails = out.filter((r) => !r.pass).length;
console.log('==============================================');
console.log(fails === 0 ? '全部通过。' : `有 ${fails} 项需要修改。`);
console.log(`章节：${h2.length} 个；目录项：${tocLines.length} 个；图位：${refs.length} 个；正文字符：${chars}`);
process.exitCode = 0;
