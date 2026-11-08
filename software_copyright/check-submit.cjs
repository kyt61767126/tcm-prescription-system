// 提交前自检：检查两份鉴别材料 PDF 是否齐全、页数是否正确、截图是否齐全
// 用法：双击 提交前自检.bat，或在本目录执行 node check-submit.cjs
const fs = require('fs');
const path = require('path');

const SC = __dirname;
const ROOT = path.dirname(SC);
const FIX_DIR = path.join(ROOT, '软著补正_20261105');

const SRC_PDF = path.join(FIX_DIR, '惠康中医诊所管理系统V1.0.0_源程序_补正版.pdf');
const MAN_PDF = path.join(FIX_DIR, '惠康中医诊所管理系统V1.0.0_软件说明书_补正版.pdf');
const MAN_PDF_FALLBACK = path.join(SC, '惠康中医诊所管理系统V1.0.0_软件说明书_补正版.pdf');
const MD = path.join(SC, '软件说明书_补正版.md');

const SHOTS = [
  'shot1_login.png',
  'shot2_main.png',
  'shot3_symptom.png',
  'shot4_formula.png',
  'shot7_case_history.png',
  'shot5_analytics.png',
  'shot5_analytics_2.png',
  'shot5_analytics_3.png',
  'shot7_stock.png',
  'shot7_stock_2.png',
  'shot7_tongue.png',
  'arch-diagram.png'
];

function pdfPages(file) {
  if (!fs.existsSync(file)) return null;
  const s = fs.readFileSync(file).toString('latin1');
  const count = (s.match(/\/Type\s*\/Page[^s]/g) || []).length;
  if (count) return count;
  const m = s.match(/\/Count\s+(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
}

// 1. 源程序 PDF
const srcPages = pdfPages(SRC_PDF);
check('源程序鉴别材料 PDF 存在', fs.existsSync(SRC_PDF), SRC_PDF);
check('源程序 PDF 页数 = 60', srcPages === 60, `实际：${srcPages === null ? '文件不存在' : srcPages + ' 页'}`);

// 2. 说明书 PDF
const manFile = fs.existsSync(MAN_PDF) ? MAN_PDF : MAN_PDF_FALLBACK;
const manPages = pdfPages(manFile);
check('说明书 PDF 存在（需先补齐截图并重新生成）', fs.existsSync(manFile), manFile);
check('说明书 PDF 页数在 25–60 之间', manPages !== null && manPages >= 25 && manPages <= 60, `实际：${manPages === null ? '文件不存在' : manPages + ' 页'}`);

// 3. 说明书源文件
check('说明书源文件（补正版）存在', fs.existsSync(MD), MD);

// 4. 截图齐全（优先查补正材料包里的 screenshots_staging，其次查本目录 screenshots）
const STAGING = path.join(FIX_DIR, 'screenshots_staging');
for (const s of SHOTS) {
  const p1 = path.join(STAGING, s);
  const p2 = path.join(SC, 'screenshots', s);
  const p = fs.existsSync(p1) ? p1 : p2;
  check(`截图 ${s}`, fs.existsSync(p), fs.existsSync(p) ? '' : '缺失（PDF 中会显示占位框）');
}

console.log('');
console.log('================ 提交前自检 ================');
let fail = 0;
for (const r of results) {
  if (!r.ok) fail++;
  console.log(`${r.ok ? '[通过]' : '[待办]'} ${r.name}${r.detail ? ' —— ' + r.detail : ''}`);
}
console.log('===========================================');
console.log(fail === 0 ? '全部通过，可以提交。' : `还有 ${fail} 项待处理（见上方 [待办]）。`);
console.log('');
process.exitCode = 0;
