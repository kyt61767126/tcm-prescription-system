// 源程序 PDF 构建脚本（60页 = 前30连续 + 后30连续）
// 规则：自研JS业务模块优先；剔除Electron/Capacitor框架代码；每页有效代码≥50行（空行/大块注释已剥离）；
//       密钥密码局部涂黑；页眉固定；页脚连续页码1-60；末页为完整代码片段（整个文档以文件末尾收束）
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const SC = __dirname;
const DESK = 'd:/trae_projects/kyt-zy/app_project/db-offline/desktop';
const OUT = path.join(SC, '惠康中医诊所管理系统V1.0.0_源程序.pdf');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

// 自研业务模块（前部：程序入口与核心业务；后部：权限校验+数据保存/备份恢复，保证后30页为完整闭合业务代码；
// 不含 electron/ 框架代码与 afterPack.js 打包钩子——其引用第三方 asarmor，属构建层非业务层）
const FILES = [
  'prescription-core.js',
  'medicine-dict.js',
  'auth-core.js',
  'security-guard.js',
  'patient-archive.js',
  'print-utils.js',
  'performance-utils.js',
  'debug-logger.js',
  'permission.js',
  'db-adapter.js'
];

const HEADER = '惠康中医诊所管理系统 V1.0.0｜著作权人：高碑店惠康堂中医诊所有限公司';
const CHARS_PER_LINE = 116;  // 每行视觉列宽（中文按2列计；A4内容宽190mm/10px等宽≈119列，留裕量）
const VISUAL_BUDGET = 58;     // 每页物理行预算（≥50 硬性达标）
const MIN_SRC_LINES = 50;     // 每页有效代码行硬性下限
const PAGES = 60;

// ---- 剥离块注释/注释行/空行 ----
function cleanLines(code) {
  const out = [];
  let inBlock = false;
  for (const raw of code.split(/\r?\n/)) {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end >= 0) { inBlock = false; line = line.slice(end + 2); } else { continue; }
    }
    // 移除行内块注释（简化处理：同行成对）
    line = line.replace(/\/\*[^]*?\*\//g, '');
    const open = line.indexOf('/*');
    if (open >= 0) { line = line.slice(0, open); inBlock = true; }
    const t = line.trim();
    if (t === '' || t.startsWith('//')) continue;
    out.push(line.replace(/\s+$/, ''));
  }
  return out;
}

// ---- 密钥/密码局部涂黑 ----
const maskLog = [];
function maskSecrets(line, file) {
  let n = line;
  // password/secret/token/apiKey 等赋值字面量：保留前2字符 + 涂黑
  n = n.replace(/((?:password|passwd|secret|apiKey|api_key|token|sig)\s*[:=]\s*)(['"])([^'"\n]{4,})\2/gi,
    (m, p1, q, val) => { maskLog.push(`${file}: ${val.slice(0, 2)}***(${val.length}字)`); return `${p1}${q}${val.slice(0, 2)}${'█'.repeat(Math.min(8, val.length - 2))}${q}`; });
  // 超长疑似密钥/证书常量（40+ 连续base64/hex字符）
  n = n.replace(/(['"])([A-Za-z0-9+/=]{40,})\1/g,
    (m, q, val) => { maskLog.push(`${file}: [长常量${val.length}字]`); return `${q}${val.slice(0, 4)}${'█'.repeat(8)}…${q}`; });
  return n;
}

// ---- 清理 git 路径 / todo 注释 / 第三方 Copyright（注释已整体剥离，此处兜底清洗代码行内残留） ----
const cleanLog = [];
function scrubPath(line, file) {
  let n = line;
  const before = n;
  // 本机 git 工作区路径
  n = n.replace(/[A-Za-z]:[\\/][^'"`\s]*trae_projects[^'"`\s]*/g, '[路径]');
  // 第三方仓库/文档链接
  n = n.replace(/https?:\/\/(?:www\.)?github\.com\/[^\s'"`)]*/g, '[链接]');
  // 行内 TODO/FIXME 标记（注释行已剥离，仅兜底）
  if (/\b(TODO|FIXME)\b/.test(n)) { n = n.replace(/\b(TODO|FIXME)\b[^\n]*/g, ''); cleanLog.push(`${file}: TODO/FIXME`); }
  if (n !== before && !/\b(TODO|FIXME)\b/.test(before)) cleanLog.push(`${file}: 路径/链接`);
  return n;
}

// ---- 视觉宽（中文按2列） ----
function vw(s) {
  const cjk = (s.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
  return s.length + cjk;
}

// ---- 物理折行：超宽行拆为续行（缩进2空格，优先在空格处断） ----
function wrapLine(line) {
  if (vw(line) <= CHARS_PER_LINE) return [line];
  const out = [];
  let rest = line;
  let isFirst = true;
  while (vw(rest) > CHARS_PER_LINE) {
    const budget = isFirst ? CHARS_PER_LINE : CHARS_PER_LINE - 2;
    // 找 budget 内最长前缀
    let cut = 0, w = 0;
    for (let i = 0; i < rest.length; i++) {
      const c = vw(rest[i]);
      if (w + c > budget) break;
      w += c; cut = i + 1;
    }
    if (cut <= 0) cut = 1;
    let head = rest.slice(0, cut);
    // 优先在最后一个空格处断（避免空格开头/结尾的丑行）
    const sp = head.lastIndexOf(' ');
    if (sp > budget * 0.4) { cut = sp + 1; head = rest.slice(0, cut); }
    out.push(head.replace(/\s+$/, ''));
    rest = (isFirst ? '' : '  ') + rest.slice(cut);
    isFirst = false;
  }
  out.push(rest);
  return out;
}

// ---- 组装（清理→涂黑→折行） ----
const all = [];
for (const f of FILES) {
  const code = fs.readFileSync(path.join(DESK, f), 'utf8');
  const lines = cleanLines(code).map(l => scrubPath(maskSecrets(l, f), f));
  all.push(`/* ========== 源文件：${f} ========== */`);
  for (const l of lines) all.push(...wrapLine(l));
}
console.log(`有效代码总行数（含分隔行与折行续行）: ${all.length}`);

// ---- 分页器：每行成本恒为1（已物理折行） ----
function paginateForward(lines, from) {
  let v = 0, i = from;
  while (i < lines.length) {
    if (v + 1 > VISUAL_BUDGET && i > from) break;
    v += 1; i++;
  }
  return [from, i, v];
}

// 前30页
let front = [], idx = 0;
for (let p = 0; p < 30; p++) {
  const [s, e] = paginateForward(all, idx);
  front.push(all.slice(s, e)); idx = e;
}
const frontEnd = idx;
// 后30页：二分找起点，使从该点分页恰好30页
function pageCountFrom(start) {
  let cnt = 0, i = start;
  while (i < all.length && cnt < 31) { const [s, e] = paginateForward(all, i); i = e; cnt++; }
  return cnt;
}
let lo = frontEnd, hi = all.length;
while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (pageCountFrom(mid) > 30) lo = mid + 1; else hi = mid; }
const backStart = lo;
if (backStart < frontEnd) { console.error(`FATAL 源码不足：frontEnd=${frontEnd} backStart=${backStart}`); process.exit(1); }
let back = []; idx = backStart;
for (let p = 0; p < 30; p++) {
  const [s, e] = paginateForward(all, idx);
  back.push(all.slice(s, e)); idx = e;
}
if (idx !== all.length) console.log(`提示：中间省略 ${all.length - idx} 行 + 前后块间隔 ${backStart - frontEnd} 行（前30+后30规则）`);

const pages = [...front, ...back];
// 校验每页有效行数
let minLines = 999;
pages.forEach((pg, i) => { if (pg.length < minLines) minLines = pg.length; });
console.log(`共 ${pages.length} 页，每页最少有效行数 ${minLines}${minLines < MIN_SRC_LINES ? '  !!低于50' : '  (≥50 达标)'}`);
console.log(`涂黑 ${maskLog.length} 处：`); maskLog.slice(0, 20).forEach(m => console.log('  ' + m));
console.log(`路径/TODO清理 ${cleanLog.length} 处：`); cleanLog.slice(0, 20).forEach(m => console.log('  ' + m));

// ---- HTML（每页固定 A4，overflow hidden 保证页边界） ----
function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
const htmlPages = pages.map((pg, i) => `<div class="pg"><div class="hd">${HEADER}</div><pre>${esc(pg.join('\n'))}</pre><div class="ft">第 ${i + 1} 页 / 共 ${PAGES} 页</div></div>`).join('\n');

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>惠康中医诊所管理系统 V1.0.0 源程序</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  body { margin: 0; }
  .pg { width: 210mm; height: 297mm; box-sizing: border-box; padding: 8mm 10mm 7mm; overflow: hidden; page-break-after: always; position: relative; }
  .pg:last-child { page-break-after: auto; }
  .hd { font-family: "SimSun", serif; font-size: 9px; color: #222; text-align: center; border-bottom: 1px solid #999; padding-bottom: 2px; margin-bottom: 4px; }
  pre { font-family: Consolas, "Courier New", monospace; font-size: 10px; line-height: 16.5px; margin: 0; white-space: pre-wrap; word-break: break-all; color: #000; }
  .ft { position: absolute; bottom: 4mm; left: 0; right: 0; text-align: center; font-family: "SimSun", serif; font-size: 9px; color: #222; }
</style></head><body>
${htmlPages}
</body></html>`;

fs.mkdirSync(path.join(SC, '_build'), { recursive: true });
fs.writeFileSync(path.join(SC, '_build', 'source_final.html'), html, 'utf8');

(async () => {
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new' });
  const page = await browser.newPage();
  await page.goto('file:///' + path.join(SC, '_build', 'source_final.html').replace(/\\/g, '/'), { waitUntil: 'networkidle0', timeout: 60000 });
  await page.pdf({ path: OUT, preferCSSPageSize: true, printBackground: true });
  await browser.close();
  const buf = fs.readFileSync(OUT);
  const s = buf.toString('latin1');
  const cnt = ([...s.matchAll(/\/Type\s*\/Page[^s]/g)]).length;
  console.log(`PDF 已生成: ${OUT}`);
  console.log(`大小: ${(buf.length / 1024).toFixed(0)} KB, 页对象数: ${cnt}`);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
