#!/usr/bin/env node
/* =============================================================================
 *  compliance-packaging.js —— 全局打包脚本合规检查（优化版，只读不修改）
 *
 *  依据 project_memory 打包相关硬约束，对项目内所有打包脚本做一次性体检：
 *    R1  .bat 编码：含中文时允许 UTF-8 无 BOM + 开头 chcp 65001（当前可运行约定）；
 *        禁止 UTF-8 带 BOM（cmd 会把它当乱码）；可执行中文命令需在 chcp 65001 之后
 *    R2  .bat 换行：必须 CRLF；纯 LF 会致 cmd 合并行/闪退
 *    R3  .bat 括号：if/for 括号必须平衡（忽略 echo/rem/字符串内括号）
 *    R5  末尾 pause：应为 `if not defined NO_PAUSE pause`，兼容一键打包
 *    R6  桌面 build.bat：具备 build_output_ fallback + POST-BUILD 回搬 dist
 *    R7  build.bat：具备中文进程名查杀 + wmic 路径匹配
 *
 *  用法:
 *    node tools\compliance-packaging.js
 *    node tools\compliance-packaging.js --fix    # 修复 R2(LF->CRLF) 等确定性项
 *
 *  退出码: 0 = 通过 / 1 = 有失败项 / 2 = 脚本自身异常
 * ==========================================================================*/
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const FIX = args.includes('--fix');

const EXCLUDES = [
  /\\(?:node_modules|\.git|build\\intermediates)\\/,
  /(?:^|\\)(?:gradlew|build_command|configure)\.bat$/,
  /\\.git\\/,
];

// ---------- 收集打包脚本 ----------
const bats = [];
const ps1s = [];
function walk(dir) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const ent of ents) {
    const p = path.join(dir, ent.name);
    if (EXCLUDES.some(r => r.test(p))) continue;
    if (ent.isDirectory()) walk(p);
    else if (/\.bat$/i.test(ent.name)) bats.push(p);
    else if (/\.ps1$/i.test(ent.name)) ps1s.push(p);
  }
}
walk(path.join(ROOT, 'app_project'));
walk(path.join(ROOT, 'tools'));
for (const f of fs.readdirSync(ROOT)) if (/\.bat$/i.test(f)) bats.push(path.join(ROOT, f));

// ---------- 字节工具 ----------
function isStrictUtf8(b) {
  let i = 0;
  while (i < b.length) {
    const c = b[i];
    if (c < 0x80) { i++; continue; }
    let n;
    if ((c & 0xe0) === 0xc0) n = 1;
    else if ((c & 0xf0) === 0xe0) n = 2;
    else if ((c & 0xf8) === 0xf0) n = 3;
    else return false;
    if (i + n >= b.length) return false;
    for (let k = 1; k <= n; k++) if ((b[i + k] & 0xc0) !== 0x80) return false;
    i += n + 1;
  }
  return true;
}
function lineStats(b) {
  const latin = b.toString('latin1');
  const crlf = (latin.match(/\r\n/g) || []).length;
  const loneLF = (latin.match(/[^\r]\n/g) || []).length;
  return { crlf, loneLF };
}
function bracketBalance(txt) {
  let open = 0, min = 0;
  const lines = txt.replace(/\r\n/g, '\n').split('\n');
  for (const raw of lines) {
    const t = raw.replace(/^\s*rem\s.*$/i, '').replace(/^\s*@?echo\s.*$/i, '');
    let inQ = false;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (inQ) continue;
      if (ch === '(') open++;
      else if (ch === ')') open--;
      if (open < min) min = open;
    }
  }
  return { open, min };
}

// ---------- 逐文件检查 ----------
let fail = 0, warn = 0, fixCount = 0;
const failures = [];

function report(sev, rel, rule, msg) {
  const line = `  [${sev === 'FAIL' ? 'FAIL' : 'WARN'}] ${rel} :: ${rule} :: ${msg}`;
  console.log(line);
  if (sev === 'FAIL') { fail++; failures.push(line.trim()); }
  else warn++;
}

function toCrlfBytes(b) {
  const out = [];
  for (let i = 0; i < b.length; i++) {
    if (b[i] === 0x0a && (i === 0 || b[i - 1] !== 0x0d)) out.push(0x0d);
    out.push(b[i]);
  }
  return Buffer.from(out);
}

for (const bat of bats) {
  const rel = path.relative(ROOT, bat).replace(/\\/g, '/');
  const b = fs.readFileSync(bat);
  const bom = b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
  const hasNonAscii = b.some(x => x > 127);
  const utf8 = isStrictUtf8(b);
  const ls = lineStats(b);

  // R1 编码
  if (bom) {
    report('FAIL', rel, 'R1-encode', 'UTF-8 BOM 存在：cmd 首行解析会带 BOM 乱码，应去 BOM');
  } else if (hasNonAscii && !utf8) {
    report('WARN', rel, 'R1-encode', '含中文但非合法 UTF-8，未被检测器识别；请确认 cmd 是否 chcp 65001');
  } else if (hasNonAscii && utf8) {
    // 合法 UTF-8：需开头有 chcp 65001（否则 GBK 页乱码）
    const txt = b.toString('utf8').replace(/^\uFEFF/, '');
    const head = txt.split(/\r?\n/).slice(0, 6).join('\n');
    if (!/chcp\s+65001/.test(txt)) {
      report('WARN', rel, 'R1-encode', 'UTF-8 含中文但无 chcp 65001，GBK 代码页下 echo 可能乱码');
    }
  }

  // R2 CRLF
  if (ls.loneLF > 0) {
    const isPureLF = ls.crlf === 0;
    if (FIX) { fs.writeFileSync(bat, toCrlfBytes(b)); fixCount++; report('INFO(fixed)', rel, 'R2-crlf', `${isPureLF ? '纯' : '混合'} LF→CRLF (${ls.loneLF}行)`); }
    else report(isPureLF ? 'FAIL' : 'WARN', rel, 'R2-crlf', isPureLF
      ? `纯 LF 换行(${ls.loneLF})，cmd 会合并行/闪退 → 建议 --fix`
      : `混合换行(LF=${ls.loneLF}, CRLF=${ls.crlf})，建议统一 CRLF`);
  }

  // R3 括号
  const enc = b.toString(isStrictUtf8(b) ? 'utf8' : 'latin1');
  const bal = bracketBalance(enc);
  if (bal.open !== 0 || bal.min < 0) {
    report('FAIL', rel, 'R3-bracket', `括号不平衡 final=${bal.open} min=${bal.min}`);
  }

  // R5 pause
  if (/pause/i.test(enc)) {
    // 兼容单行 `if not defined NO_PAUSE pause` 与多行 `if not defined NO_PAUSE (` 块
    const guardOk = /if not defined NO_PAUSE\s+(?:pause|escape)/.test(enc)
      || /if not defined NO_PAUSE\s*\(/.test(enc);
    if (!guardOk && /(^|\n)[ \t]*pause(\r?\n|$)/m.test(enc)) {
      report('WARN', rel, 'R5-pause', '有裸 pause 但无 `if not defined NO_PAUSE` 保护，一键打包会被卡住');
    }
  }

  // R6/R7 桌面 build.bat 特定
  const name = path.basename(bat).toLowerCase();
  if (name === 'build.bat' && !/^build_command/.test(path.basename(bat))) {
    const txt = enc;
    if (!/POST-BUILD CONSOLIDATION/.test(txt)) report('FAIL', rel, 'R6-consolidate', '缺少构建后回搬 dist(POST-BUILD CONSOLIDATION)');
    if (!/switching to alternate output dir build_output_/.test(txt)) report('FAIL', rel, 'R6-consolidate', '缺清dist失败 fallback build_output_');
    if (!/惠康\*\.exe/.test(txt)) report('FAIL', rel, 'R7-kill', '缺中文进程名查杀 taskkill "惠康*.exe"');
    if (!/wmic process where/.test(txt)) report('WARN', rel, 'R7-kill', '缺 wmic 路径匹配查杀');
  }
}

// ---------- 汇总 ----------
console.log('\n==============================================');
console.log(`  打包脚本合规检查  bat=${bats.length} ps1=${ps1s.length}${FIX ? ' (fix mode)' : ''}`);
console.log(`  FAIL=${fail}  WARN=${warn}  FIXED=${fixCount}`);
console.log('==============================================');
if (fail > 0) {
  console.log('\n  失败项：');
  for (const f of failures) console.log(`   ${f}`);
  process.exit(1);
}
process.exit(0);