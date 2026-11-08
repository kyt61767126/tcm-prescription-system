/**
 * 惠康中医诊所管理系统 V1.0.0 —— 源程序鉴别材料（补正版）· 分页数据生成
 *
 * 设计依据：软著补正_20261105/01_代码证据清单.md
 *   1) 只取"运行期真被调用"的中医业务/支撑代码，剔除零调用死代码（medicine-dict、print-utils）、
 *      第三方库、构建脚本、CSS/HTML 模板与纯数据大数组；
 *   2) 保留中文注释（业务规则来源、优先级、边界条件）——注释是独创性的直接证据；
 *   3) 仅对注释行做轻度清洗：内部日期、内部工单代号（P0/P1/★标记）、运维复盘口吻；
 *   4) 60 页 = 前 30 页连续（开方主链路）+ 后 30 页连续（库存/统计/权限/安全），
 *      前 30 页严格止于第 4 段末尾，后 30 页严格收束于最后一个文件末尾。
 *
 * 输出：_build/source_v2_pages.json
 */
const fs = require('fs');
const path = require('path');

const ROOT = 'D:/trae_projects/kyt-zy';
const DESK = path.join(ROOT, 'app_project/db-offline/desktop');
const ELE = path.join(DESK, 'electron');
const OUTDIR = path.join(ROOT, '软著补正_20261106_v2');
const BUILD = path.join(OUTDIR, 'build/_build');

const HEADER = '惠康中医诊所管理系统 V1.0.0｜著作权人：高碑店惠康堂中医诊所有限公司';
const PAGES_PER_SIDE = 30;
const CHARS_PER_LINE = 116;

// 每段 firstSide=true 的段落属于"前 30 页"；其余为中间省略段与"后 30 页"
const SEGMENTS = [
  // ============ 前 30 页：一次开方主链路（首个文件为中药煎法核心，首页首行即文件头）============
  { side: 'front', file: path.join(DESK, 'prescription-core.js'), from: 1, to: 512, label: 'prescription-core.js（中药煎煮方法规则表 / 误匹配排除 / 处方笺运行时注入）' },
  { side: 'front', file: path.join(DESK, 'index.html'), from: 6447, to: 6670, label: 'index.html（处方编号唯一收口：就绪闸 / 三级持久化 / 权威集扫描）' },
  { side: 'front', file: path.join(DESK, 'index.html'), from: 7215, to: 7454, label: 'index.html（选药候选四级排序 + 金额联动计算）' },
  { side: 'front', file: path.join(DESK, 'symptom-dict.js'), from: 1, to: 674, label: 'symptom-dict.js（中医症状体征词典 / 跨类拼接 / 光标缓存 / Alt+S）' },

  // ============ 中间省略段（不进入鉴别材料：库存预警与流水弹窗 UI）============
  { side: 'mid', file: path.join(DESK, 'stock-core.js'), from: 301, to: 1011, label: 'stock-core.js（库存预警弹窗与出入库流水 UI）' },

  // ============ 后 30 页：库存 → 统计 → 权限/版本 → 安全 ============
  { side: 'back', file: path.join(DESK, 'stock-core.js'), from: 1, to: 300, label: 'stock-core.js（库存核心：扣减公式 / 幂等标记 / 差值冲正）' },
  { side: 'back', file: path.join(DESK, 'stock-core.js'), from: 1012, to: 1173, label: 'stock-core.js（库存钩子安装：保存 / 删除 / 清空 / 编辑 / 导入 全链路）' },
  { side: 'back', file: path.join(DESK, 'analytics-core.js'), from: 29, to: 240, label: 'analytics-core.js（统计口径：初复诊 / 病种分布 / 药材用量 / 就诊趋势）' },
  { side: 'back', file: path.join(DESK, 'analytics-core.js'), from: 455, to: 519, label: 'analytics-core.js（月度统计报表：权限隔离与诊费口径自识别）' },
  { side: 'back', file: path.join(DESK, 'analytics-core.js'), from: 521, to: 599, label: 'analytics-core.js（统计渲染与图表编排）' },
  { side: 'back', file: path.join(DESK, 'analytics-core.js'), from: 601, to: 629, label: 'analytics-core.js（报表导出与付费墙口径）' },
  { side: 'back', file: path.join(DESK, 'permission.js'), from: 94, to: 172, label: 'permission.js（版本归一化与单一读取链）' },
  { side: 'back', file: path.join(DESK, 'permission.js'), from: 325, to: 420, label: 'permission.js（角色权限矩阵：用户管理 / 改密 / 全所处方查阅）' },
  { side: 'back', file: path.join(DESK, 'voice-input.js'), from: 92, to: 300, label: 'voice-input.js（语音录入三重门控 / 连报守护 / 多候选）' },
  { side: 'back', file: path.join(DESK, 'security-guard.js'), from: 76, to: 240, label: 'security-guard.js（反调试强/弱信号 + 延迟降级）' },
  { side: 'back', file: path.join(DESK, 'edition-lock.js'), from: 46, to: 132, label: 'edition-lock.js（版本配置拦截与三写同步）' },
  { side: 'back', file: path.join(ELE, 'prescription-counter.js'), from: 51, to: 173, label: 'electron/prescription-counter.js（试用计数 AES-256-CBC + HMAC-SHA256）' },
  { side: 'back', file: path.join(DESK, 'button-manager.js'), from: 144, to: 351, label: 'button-manager.js（按钮单一写入源 / 版本按钮统一装配）' }
];

const changeLog = [];

// ---- 注释行轻度清洗 ----
function scrubComment(line) {
  const t = line.trim();
  const isComment = t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--');
  if (!isComment) return line;
  let n = line
    .replace(/\b20\d{2}\s*[-/年]\s*\d{1,2}\s*[-/月]\s*\d{1,2}\s*日?\b/g, '')
    .replace(/\b20\d{2}\s*年\s*\d{1,2}\s*月\s*/g, '')
    // Markdown 强调星号（保留 /** 与 */ 注释定界符）
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    // 内部工单号：P0-④ / P1-② / P2-A3 / P7:
    .replace(/\bP[0-9]\s*[-－]\s*[A-Za-z0-9④⑤⑥⑦⑧⑨①②③]+\s*[：:]?\s*/g, '')
    .replace(/\bP[0-9]\s*[：:]\s*/g, '')
    .replace(/\bP[0-9]\b(?=\s*[）)：:，,、])/g, '')
    .replace(/★+/g, '')
    .replace(/第[一二三四五六七八九十]+轮/g, '')
    .replace(/(双审|真机实测|复测|复盘|回归验证|冒烟|工单)/g, '')
    .replace(/（\s*）/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/(\/\/|\/\*|\*)\s*[：:，,、]\s*/g, '$1 ')
    .replace(/\s{2,}/g, ' ');
  if (n !== line) changeLog.push('注释清洗');
  return n;
}

// ---- 敏感信息兜底涂黑 ----
function maskSecrets(line, file) {
  let n = line.replace(/((?:password|passwd|secret|apiKey|api_key|token)\s*[:=]\s*)(['"])([^'"\n]{6,})\2/gi,
    (m, p1, q, val) => { changeLog.push(`${file}: 涂黑敏感赋值`); return `${p1}${q}${val.slice(0, 2)}${'■'.repeat(8)}${q}`; });
  n = n.replace(/(['"])([A-Za-z0-9+/=]{40,})\1/g,
    (m, q, val) => { changeLog.push(`${file}: 涂黑长常量(${val.length}字符)`); return `${q}${val.slice(0, 4)}${'■'.repeat(8)}…${q}`; });
  return n;
}

// ---- 路径/链接清理 ----
function scrubPath(line, file) {
  const before = line;
  let n = line.replace(/[A-Za-z]:[\\/][^'"`\s]*trae_projects[^'"`\s]*/g, '[路径]');
  n = n.replace(/https?:\/\/(?:www\.)?github\.com\/[^\s'"`)]*/g, '[链接]');
  // 三处内部工程路径：改为中性的工程说明
  n = n.replace(/设计文档：\.trae\/documents\/[^\s（]*（v1\.0 定稿）/, '设计说明：症状快捷录入模块（v1.0 定稿）');
  n = n.replace(/\.trae\/documents\/[^\s'"`）)]*/g, '内部设计文档');
  n = n.replace(/分发：tools\/sync-all\.ps1[^\n]*/, '分发：随业务模块清单一并发布');
  n = n.replace(/tools\/sync-all\.ps1/g, '发布脚本');
  n = n.replace(/缓存：public\/_headers[^\n]*/, '缓存：静态资源缓存一天；词典修订需提升版本号以刷新缓存');
  n = n.replace(/public\/_headers/g, '静态资源缓存配置');
  if (/\b(TODO|FIXME)\b/.test(n)) n = n.replace(/\b(TODO|FIXME)\b/g, '');
  if (n !== before) changeLog.push(`${file}: 清理路径/链接/TODO`);
  return n;
}

// ---- 视觉宽度 ----
function vw(s) {
  const cjk = (s.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
  return s.length + cjk;
}

// ---- 物理折行 ----
function wrapLine(line) {
  if (vw(line) <= CHARS_PER_LINE) return [line];
  const out = [];
  let rest = line;
  let first = true;
  while (vw(rest) > CHARS_PER_LINE) {
    const budget = first ? CHARS_PER_LINE : CHARS_PER_LINE - 2;
    let cut = 0, w = 0;
    for (let i = 0; i < rest.length; i++) {
      const c = vw(rest[i]);
      if (w + c > budget) break;
      w += c; cut = i + 1;
    }
    if (cut <= 0) cut = 1;
    let head = rest.slice(0, cut);
    const sp = head.lastIndexOf(' ');
    if (sp > budget * 0.4) { cut = sp + 1; head = rest.slice(0, cut); }
    out.push(head.replace(/\s+$/, ''));
    rest = (first ? '' : '  ') + rest.slice(cut);
    first = false;
  }
  out.push(rest);
  return out;
}

// ---- 组装 ----
const all = [];
let frontEnd = 0;
for (const seg of SEGMENTS) {
  if (!fs.existsSync(seg.file)) { console.error('缺失源文件: ' + seg.file); process.exit(1); }
  const fileLines = fs.readFileSync(seg.file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  const from = seg.from || 1;
  const to = Math.min(seg.to || fileLines.length, fileLines.length);
  if (from > to) { console.error(`区间越界: ${seg.label} ${from}-${to}`); process.exit(1); }
  // 首个文件不插入合成标签，保证第 1 页第 1 行就是该源文件的文件头
  if (seg !== SEGMENTS[0]) all.push(`/* ========== 源文件：${seg.label} ========== */`);
  for (const raw of fileLines.slice(from - 1, to)) {
    let l = scrubComment(raw);
    l = scrubPath(l, seg.label);
    l = maskSecrets(l, seg.label);
    if (l.trim() === '') continue;
    for (const w of wrapLine(l)) all.push(w);
  }
  if (seg.side === 'front') frontEnd = all.length;
}
console.log(`程序总行数（含折行续行、不含空行）：${all.length}；前 30 页素材 ${frontEnd} 行`);

// ---- 分页：前 30 页 / 后 30 页各自均分，页间行数相差不超过 1 ----
function splitEvenly(start, count, pageCount) {
  const base = Math.floor(count / pageCount);
  const rem = count % pageCount;
  const out = [];
  let idx = start;
  for (let p = 0; p < pageCount; p++) {
    const n = base + (p < rem ? 1 : 0);
    out.push(all.slice(idx, idx + n));
    idx += n;
  }
  return out;
}

const frontCount = frontEnd;
const backTarget = 1650;
const remaining = all.length - frontEnd;
if (frontCount / PAGES_PER_SIDE < 50) { console.error(`前段行数不足（${frontCount}）`); process.exit(1); }
if (remaining < 1500) { console.error(`后段行数不足（${remaining}）`); process.exit(1); }
const backCount = Math.min(remaining, backTarget);
const gap = remaining - backCount;
const backStart = frontEnd + gap;

const front = splitEvenly(0, frontCount, PAGES_PER_SIDE);
const back = splitEvenly(backStart, backCount, PAGES_PER_SIDE);
const pages = [...front, ...back];
const lastLine = pages[pages.length - 1].slice(-1)[0];

console.log(`共 ${pages.length} 页；前 30 页每页 ${Math.min(...front.map(p => p.length))}–${Math.max(...front.map(p => p.length))} 行；后 30 页 ${Math.min(...back.map(p => p.length))}–${Math.max(...back.map(p => p.length))} 行`);
console.log(`中间省略 ${gap} 行（${frontEnd + 1}–${backStart}）`);
console.log(`末页最后一行：${JSON.stringify(lastLine)}`);

const stats = pages.map((pg, i) => ({ page: i + 1, lines: pg.length, nonBlank: pg.filter(l => l.trim()).length, side: i < 30 ? 'front' : 'back' }));
fs.mkdirSync(BUILD, { recursive: true });
fs.writeFileSync(path.join(BUILD, 'source_v2_pages.json'), JSON.stringify({ header: HEADER, totalPages: pages.length, pages }, null, 1), 'utf8');
fs.writeFileSync(path.join(BUILD, 'source_v2_build.log'), [
  `生成时间：${new Date().toISOString()}`,
  `程序总行数：${all.length}；前段：${frontCount}；后段：${backCount}；中间省略：${gap}`,
  `末页最后一行：${lastLine}`,
  `选材：`,
  ...SEGMENTS.map(s => `  [${s.side}] ${s.label}（第 ${s.from}–${s.to} 行）`),
  `清洗记录 ${changeLog.length} 条`
].join('\n'), 'utf8');
fs.writeFileSync(path.join(BUILD, 'source_v2_stats.json'), JSON.stringify(stats, null, 1), 'utf8');
console.log('分页 JSON 已写入 _build/source_v2_pages.json');
